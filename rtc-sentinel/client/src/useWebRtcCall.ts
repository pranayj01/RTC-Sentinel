import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { mediaErrorMessage } from './mediaErrors';
import { createIceConfiguration, selectedCandidateType } from './iceConfig';
import { collectQosMetric, type QosBaseline, type QosMetric } from './qos';
import { assessCallQuality, type QualityAssessment } from './quality';
import {
  createAudioSampler,
  type AudioSampler,
  type PcmAudioChunk,
} from './audioCapture';
import {
  clearActiveCall,
  readActiveCall,
  saveActiveCall,
  type ActiveCallSession,
  type CallRole,
} from './callSession';

type Status =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'error';
type Ack = {
  ok: boolean;
  roomId?: string;
  error?: string;
  peerPresent?: boolean;
  resumeToken?: string;
};
type SignalMessage<T> = { roomId: string; signal: T };
const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ?? window.location.origin;
const forceRelay =
  new URLSearchParams(window.location.search).get('relay') === '1';
const iceConfiguration = createIceConfiguration(
  window.location.hostname,
  {
    stunUrl: import.meta.env.VITE_STUN_URL,
    turnUrl: import.meta.env.VITE_TURN_URL,
    turnTcpUrl: import.meta.env.VITE_TURN_TCP_URL,
    turnUsername: import.meta.env.VITE_TURN_USERNAME,
    turnCredential: import.meta.env.VITE_TURN_CREDENTIAL,
    transportPolicy: import.meta.env.VITE_ICE_TRANSPORT_POLICY as
      RTCIceTransportPolicy | undefined,
  },
  forceRelay,
);

function emitWithAck(
  socket: Socket,
  event: string,
  payload?: unknown,
): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const acknowledge = (error: Error | null, response: Ack) => {
      if (error) reject(error);
      else resolve(response);
    };
    if (payload === undefined) socket.timeout(5_000).emit(event, acknowledge);
    else socket.timeout(5_000).emit(event, payload, acknowledge);
  });
}

export interface WebRtcCall {
  roomId: string;
  status: Status;
  statusLabel: string;
  muted: boolean;
  error: string;
  recoveryMessage: string;
  candidateType: string;
  qosMetric: QosMetric | null;
  qosHistory: QosMetric[];
  durationSeconds: number;
  quality: QualityAssessment;
  audioChunk: PcmAudioChunk | null;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  createCall(): Promise<void>;
  joinCall(roomId: string): Promise<void>;
  toggleMute(): void;
  endCall(): void;
}

export function useWebRtcCall(
  accessToken: string,
  guest = false,
  audioAnalysisEnabled = false,
): WebRtcCall {
  const accessTokenRef = useRef(accessToken);
  const guestRef = useRef(guest);
  const audioAnalysisEnabledRef = useRef(audioAnalysisEnabled);
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioSamplerRef = useRef<AudioSampler | null>(null);
  const roomRef = useRef('');
  const roleRef = useRef<CallRole | null>(null);
  const resumeTokenRef = useRef('');
  const iceRecoveryTimer = useRef<number | undefined>(undefined);
  const iceRecoveryAttempts = useRef(0);
  const sendOfferRef = useRef<(iceRestart?: boolean) => Promise<void>>(
    async () => undefined,
  );
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const qosBaseline = useRef<QosBaseline | undefined>(undefined);
  const qosTimer = useRef<number | undefined>(undefined);
  const durationTimer = useRef<number | undefined>(undefined);
  const collectingQos = useRef(false);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [roomId, setRoomId] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [candidateType, setCandidateType] = useState('discovering');
  const [qosMetric, setQosMetric] = useState<QosMetric | null>(null);
  const [qosHistory, setQosHistory] = useState<QosMetric[]>([]);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [quality, setQuality] = useState<QualityAssessment>({
    quality: 'Unknown',
    score: null,
    limitingFactors: ['Waiting for complete WebRTC statistics'],
  });
  const [audioChunk, setAudioChunk] = useState<PcmAudioChunk | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
    guestRef.current = guest;
    if (socketRef.current) {
      socketRef.current.auth = accessToken
        ? { token: accessToken }
        : { guest: guestRef.current };
    }
  }, [accessToken, guest]);

  useEffect(() => {
    audioAnalysisEnabledRef.current = audioAnalysisEnabled;
    if (!audioAnalysisEnabled) setAudioChunk(null);
  }, [audioAnalysisEnabled]);

  const stopMonitoring = useCallback(() => {
    if (qosTimer.current) window.clearInterval(qosTimer.current);
    if (durationTimer.current) window.clearInterval(durationTimer.current);
    qosTimer.current = undefined;
    durationTimer.current = undefined;
    qosBaseline.current = undefined;
    collectingQos.current = false;
  }, []);

  const startMonitoring = useCallback((peer: RTCPeerConnection) => {
    if (qosTimer.current) return;
    setDurationSeconds(0);
    const startedAt = Date.now();
    const sample = async () => {
      if (collectingQos.current || peer.connectionState !== 'connected') return;
      collectingQos.current = true;
      try {
        const result = await collectQosMetric(peer, qosBaseline.current);
        qosBaseline.current = result.baseline;
        setQosMetric(result.metric);
        setQuality(assessCallQuality(result.metric));
        setQosHistory((history) => [...history, result.metric].slice(-20));
        if (result.metric.candidateType)
          setCandidateType(result.metric.candidateType);
        if (roomRef.current) {
          socketRef.current?.emit(
            'qos-metric',
            { roomId: roomRef.current, metric: result.metric },
            () => undefined,
          );
          if (roleRef.current && resumeTokenRef.current)
            saveActiveCall(
              roomRef.current,
              roleRef.current,
              resumeTokenRef.current,
            );
        }
        if (audioAnalysisEnabledRef.current && audioSamplerRef.current) {
          setAudioChunk(audioSamplerRef.current.sample());
        }
      } catch {
        /* A later interval retries transient stats failures. */
      } finally {
        collectingQos.current = false;
      }
    };
    void sample();
    qosTimer.current = window.setInterval(() => void sample(), 3000);
    durationTimer.current = window.setInterval(
      () => setDurationSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
  }, []);

  const ensureMedia = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;
      try {
        audioSamplerRef.current = createAudioSampler(stream);
      } catch {
        audioSamplerRef.current = null;
      }
      return stream;
    } catch (cause) {
      setError(mediaErrorMessage(cause));
      setStatus('error');
      throw cause;
    }
  }, []);

  const ensurePeer = useCallback(async () => {
    if (peerRef.current) return peerRef.current;
    const stream = await ensureMedia();
    const peer = new RTCPeerConnection(iceConfiguration);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && roomRef.current)
        socketRef.current?.emit(
          'ice-candidate',
          { roomId: roomRef.current, signal: candidate.toJSON() },
          () => undefined,
        );
    };
    peer.ontrack = ({ streams }) => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = streams[0];
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        if (iceRecoveryTimer.current)
          window.clearTimeout(iceRecoveryTimer.current);
        iceRecoveryTimer.current = undefined;
        iceRecoveryAttempts.current = 0;
        setError('');
        setRecoveryMessage('');
        setStatus('connected');
        if (roomRef.current && roleRef.current && resumeTokenRef.current)
          saveActiveCall(
            roomRef.current,
            roleRef.current,
            resumeTokenRef.current,
          );
        socketRef.current?.emit(
          'call-start',
          { roomId: roomRef.current },
          () => undefined,
        );
        startMonitoring(peer);
        const inspect = async (attempt = 0): Promise<void> => {
          const type = await selectedCandidateType(peer);
          if (type !== 'unknown' || attempt >= 5) setCandidateType(type);
          else window.setTimeout(() => void inspect(attempt + 1), 500);
        };
        void inspect();
      }
      if (['failed', 'disconnected'].includes(peer.connectionState)) {
        setStatus('reconnecting');
        setRecoveryMessage('Network interrupted. Trying to reconnect…');
        if (!iceRecoveryTimer.current) {
          const delay = peer.connectionState === 'failed' ? 0 : 4_000;
          iceRecoveryTimer.current = window.setTimeout(() => {
            iceRecoveryTimer.current = undefined;
            if (!['failed', 'disconnected'].includes(peer.connectionState))
              return;
            if (iceRecoveryAttempts.current >= 2) {
              stopMonitoring();
              setRecoveryMessage('');
              setError(
                forceRelay
                  ? 'The TURN relay could not be reached.'
                  : 'The peer connection could not be recovered.',
              );
              setStatus('error');
              return;
            }
            iceRecoveryAttempts.current += 1;
            peer.restartIce();
            if (roleRef.current === 'host' && socketRef.current?.connected) {
              void sendOfferRef.current(true).catch(() => {
                setRecoveryMessage(
                  'Waiting for the signaling server to recover…',
                );
              });
            }
            iceRecoveryTimer.current = window.setTimeout(() => {
              iceRecoveryTimer.current = undefined;
              if (['failed', 'disconnected'].includes(peer.connectionState))
                peer.onconnectionstatechange?.(
                  new Event('connectionstatechange'),
                );
            }, 7_000);
          }, delay);
        }
      }
      if (peer.connectionState === 'closed') setStatus('ended');
    };
    peerRef.current = peer;
    return peer;
  }, [ensureMedia, startMonitoring, stopMonitoring]);

  const sendOffer = useCallback(
    async (iceRestart = false) => {
      const socket = socketRef.current;
      if (!socket?.connected || !roomRef.current)
        throw new Error('Signaling is unavailable');
      const peer = await ensurePeer();
      const offer = await peer.createOffer({ iceRestart });
      await peer.setLocalDescription(offer);
      const ack = await emitWithAck(socket, 'offer', {
        roomId: roomRef.current,
        signal: offer,
      });
      if (!ack.ok) throw new Error(ack.error ?? 'Offer was rejected');
    },
    [ensurePeer],
  );
  sendOfferRef.current = sendOffer;

  const closePeer = useCallback(
    (stopMedia = true) => {
      stopMonitoring();
      peerRef.current?.close();
      peerRef.current = null;
      if (iceRecoveryTimer.current)
        window.clearTimeout(iceRecoveryTimer.current);
      iceRecoveryTimer.current = undefined;
      iceRecoveryAttempts.current = 0;
      pendingIce.current = [];
      if (stopMedia) {
        audioSamplerRef.current?.close();
        audioSamplerRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setAudioChunk(null);
      }
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    },
    [stopMonitoring],
  );

  const waitForSignaling = useCallback(
    (): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket) {
          reject(new Error('Signaling client unavailable'));
          return;
        }
        if (socket.connected) {
          resolve(socket);
          return;
        }
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error('Signaling connection timed out'));
        }, 5000);
        const connected = () => {
          cleanup();
          resolve(socket);
        };
        const failed = () => {
          cleanup();
          reject(new Error('Signaling connection failed'));
        };
        const cleanup = () => {
          window.clearTimeout(timeout);
          socket.off('connect', connected);
          socket.off('connect_error', failed);
        };
        socket.once('connect', connected);
        socket.once('connect_error', failed);
      }),
    [],
  );

  useEffect(() => {
    const socket = io(SIGNALING_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      randomizationFactor: 0.4,
      timeout: 5_000,
      auth: accessTokenRef.current
        ? { token: accessTokenRef.current }
        : { guest: guestRef.current },
    });
    socketRef.current = socket;
    const resumeRoom = async (session: ActiveCallSession) => {
      roomRef.current = session.roomId;
      roleRef.current = session.role;
      resumeTokenRef.current = session.resumeToken;
      setRoomId(session.roomId);
      setStatus('reconnecting');
      setRecoveryMessage('Restoring the active call…');
      try {
        const ack = await emitWithAck(socket, 'resume-room', {
          roomId: session.roomId,
          resumeToken: session.resumeToken,
        });
        if (!ack.ok || !ack.roomId || !ack.resumeToken) {
          clearActiveCall();
          roomRef.current = '';
          roleRef.current = null;
          resumeTokenRef.current = '';
          closePeer();
          setRecoveryMessage('');
          setError('The previous call session has expired.');
          setStatus('ended');
          return;
        }
        resumeTokenRef.current = ack.resumeToken;
        saveActiveCall(ack.roomId, session.role, ack.resumeToken);
        await ensureMedia();
        setRecoveryMessage('');
        setError('');
        if (peerRef.current?.connectionState === 'connected') {
          setStatus('connected');
          return;
        }
        if (!ack.peerPresent) {
          setStatus('waiting');
          return;
        }
        setStatus('connecting');
        await ensurePeer();
        if (session.role === 'host') await sendOffer(true);
      } catch {
        setStatus('reconnecting');
        setRecoveryMessage('Signaling is unavailable. Retrying…');
      }
    };
    socket.on('connect', () => {
      const active =
        roomRef.current && roleRef.current && resumeTokenRef.current
          ? {
              roomId: roomRef.current,
              role: roleRef.current,
              resumeToken: resumeTokenRef.current,
              savedAt: Date.now(),
            }
          : readActiveCall();
      if (!active) {
        setRecoveryMessage('');
        return;
      }
      if (socket.recovered && peerRef.current) {
        setRecoveryMessage('');
        setError('');
        setStatus(
          peerRef.current.connectionState === 'connected'
            ? 'connected'
            : 'reconnecting',
        );
        return;
      }
      void resumeRoom(active);
    });
    socket.on('disconnect', () => {
      if (!roomRef.current) return;
      setStatus('reconnecting');
      setRecoveryMessage('Signaling interrupted. Reconnecting…');
    });
    socket.on('peer-joined', async () => {
      try {
        setStatus('connecting');
        await sendOffer();
      } catch {
        setRecoveryMessage('Waiting for signaling to recover…');
      }
    });
    socket.on('peer-reconnected', () => {
      if (roleRef.current !== 'host') return;
      setStatus('reconnecting');
      setRecoveryMessage('Reconnecting to the other participant…');
      void sendOffer(true).catch(() => {
        setRecoveryMessage('Waiting for signaling to recover…');
      });
    });
    socket.on(
      'offer',
      async ({ signal }: SignalMessage<RTCSessionDescriptionInit>) => {
        try {
          setStatus('connecting');
          const peer = await ensurePeer();
          await peer.setRemoteDescription(signal);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit(
            'answer',
            { roomId: roomRef.current, signal: answer },
            () => undefined,
          );
          for (const candidate of pendingIce.current.splice(0))
            await peer.addIceCandidate(candidate);
        } catch {
          setError('WebRTC negotiation failed.');
          setStatus('error');
        }
      },
    );
    socket.on(
      'answer',
      async ({ signal }: SignalMessage<RTCSessionDescriptionInit>) => {
        try {
          const peer = await ensurePeer();
          await peer.setRemoteDescription(signal);
          for (const candidate of pendingIce.current.splice(0))
            await peer.addIceCandidate(candidate);
        } catch {
          setError('WebRTC negotiation failed.');
          setStatus('error');
        }
      },
    );
    socket.on(
      'ice-candidate',
      async ({ signal }: SignalMessage<RTCIceCandidateInit>) => {
        const peer = peerRef.current;
        if (!peer?.remoteDescription) pendingIce.current.push(signal);
        else
          try {
            await peer.addIceCandidate(signal);
          } catch {
            setError('A network candidate was rejected.');
          }
      },
    );
    const peerLeft = () => {
      clearActiveCall();
      roomRef.current = '';
      roleRef.current = null;
      resumeTokenRef.current = '';
      closePeer();
      setError('The other participant left the call.');
      setRecoveryMessage('');
      setStatus('ended');
    };
    socket.on('peer-left', peerLeft);
    socket.on('call-end', peerLeft);
    socket.on('connect_error', () => {
      if (roomRef.current || readActiveCall()) {
        setStatus('reconnecting');
        setRecoveryMessage('Signaling is unavailable. Retrying…');
      } else {
        setError('Signaling server is unavailable.');
      }
    });
    return () => {
      closePeer();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [closePeer, ensureMedia, ensurePeer, sendOffer]);

  const createCall = useCallback(async () => {
    setError('');
    setRecoveryMessage('');
    setStatus('connecting');
    setQosMetric(null);
    setQosHistory([]);
    setDurationSeconds(0);
    setQuality({
      quality: 'Unknown',
      score: null,
      limitingFactors: ['Waiting for complete WebRTC statistics'],
    });
    try {
      await ensureMedia();
    } catch {
      return;
    }
    try {
      const socket = await waitForSignaling();
      const ack = await emitWithAck(socket, 'create-room');
      if (!ack.ok || !ack.roomId || !ack.resumeToken) {
        closePeer();
        setError('Unable to create a room.');
        setStatus('error');
        return;
      }
      roomRef.current = ack.roomId;
      roleRef.current = 'host';
      resumeTokenRef.current = ack.resumeToken;
      saveActiveCall(ack.roomId, 'host', ack.resumeToken);
      setRoomId(ack.roomId);
      setStatus('waiting');
    } catch {
      setError('Signaling server is unavailable.');
      setStatus('error');
    }
  }, [closePeer, ensureMedia, waitForSignaling]);

  const joinCall = useCallback(
    async (requestedRoom: string) => {
      setError('');
      setRecoveryMessage('');
      setStatus('connecting');
      setQosMetric(null);
      setQosHistory([]);
      setDurationSeconds(0);
      setQuality({
        quality: 'Unknown',
        score: null,
        limitingFactors: ['Waiting for complete WebRTC statistics'],
      });
      try {
        await ensureMedia();
      } catch {
        return;
      }
      try {
        const socket = await waitForSignaling();
        const ack = await emitWithAck(socket, 'join-room', {
          roomId: requestedRoom.trim().toUpperCase(),
        });
        if (!ack.ok || !ack.roomId || !ack.resumeToken) {
          closePeer();
          setError(
            ack.error === 'ROOM_FULL'
              ? 'This room already has two participants.'
              : 'Room not found.',
          );
          setStatus('error');
          return;
        }
        roomRef.current = ack.roomId;
        roleRef.current = 'participant';
        resumeTokenRef.current = ack.resumeToken;
        saveActiveCall(ack.roomId, 'participant', ack.resumeToken);
        setRoomId(ack.roomId);
        setStatus('connecting');
      } catch {
        setError('Signaling server is unavailable.');
        setStatus('error');
      }
    },
    [closePeer, ensureMedia, waitForSignaling],
  );

  const toggleMute = useCallback(() => {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, [muted]);
  const endCall = useCallback(() => {
    if (roomRef.current) {
      const socket = socketRef.current;
      const roomId = roomRef.current;
      socket?.emit('call-end', { roomId }, () =>
        socket.emit('leave-room', { roomId }, () => undefined),
      );
    }
    clearActiveCall();
    roomRef.current = '';
    roleRef.current = null;
    resumeTokenRef.current = '';
    closePeer();
    setMuted(false);
    setCandidateType('discovering');
    setRecoveryMessage('');
    setStatus('ended');
  }, [closePeer]);
  const labels: Record<Status, string> = {
    idle: 'Ready',
    connecting: 'Connecting',
    waiting: 'Waiting for peer',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    ended: 'Ended',
    error: 'Error',
  };
  return {
    roomId,
    status,
    statusLabel: labels[status],
    muted,
    error,
    recoveryMessage,
    candidateType,
    qosMetric,
    qosHistory,
    durationSeconds,
    quality,
    audioChunk,
    remoteAudioRef,
    createCall,
    joinCall,
    toggleMute,
    endCall,
  };
}
