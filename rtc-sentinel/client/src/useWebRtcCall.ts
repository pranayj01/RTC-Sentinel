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

type Status =
  'idle' | 'connecting' | 'waiting' | 'connected' | 'ended' | 'error';
type Ack = { ok: boolean; roomId?: string; error?: string };
type SignalMessage<T> = { roomId: string; signal: T };
const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL ??
  `http://${window.location.hostname}:3000`;
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

export interface WebRtcCall {
  roomId: string;
  status: Status;
  statusLabel: string;
  muted: boolean;
  error: string;
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

  const startMonitoring = useCallback(
    (peer: RTCPeerConnection) => {
      stopMonitoring();
      setDurationSeconds(0);
      const startedAt = Date.now();
      const sample = async () => {
        if (collectingQos.current || peer.connectionState !== 'connected')
          return;
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
    },
    [stopMonitoring],
  );

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
        setStatus('connected');
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
        setError('Peer connection was lost.');
        setStatus('error');
      }
      if (peer.connectionState === 'closed') setStatus('ended');
    };
    peerRef.current = peer;
    return peer;
  }, [ensureMedia, startMonitoring]);

  const closePeer = useCallback(
    (stopMedia = true) => {
      stopMonitoring();
      peerRef.current?.close();
      peerRef.current = null;
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
      auth: accessTokenRef.current
        ? { token: accessTokenRef.current }
        : { guest: guestRef.current },
    });
    socketRef.current = socket;
    socket.on('peer-joined', async () => {
      try {
        setStatus('connecting');
        const peer = await ensurePeer();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit(
          'offer',
          { roomId: roomRef.current, signal: offer },
          () => undefined,
        );
      } catch {
        /* ensureMedia reports errors */
      }
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
      closePeer();
      setError('The other participant left the call.');
      setStatus('ended');
    };
    socket.on('peer-left', peerLeft);
    socket.on('call-end', peerLeft);
    socket.on('connect_error', () => {
      setError('Signaling server is unavailable.');
      setStatus('error');
    });
    return () => {
      closePeer();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [closePeer, ensurePeer]);

  const createCall = useCallback(async () => {
    setError('');
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
      socket.emit('create-room', (ack: Ack) => {
        if (!ack.ok || !ack.roomId) {
          setError('Unable to create a room.');
          setStatus('error');
          return;
        }
        roomRef.current = ack.roomId;
        setRoomId(ack.roomId);
        setStatus('waiting');
      });
    } catch {
      setError('Signaling server is unavailable.');
      setStatus('error');
    }
  }, [ensureMedia, waitForSignaling]);

  const joinCall = useCallback(
    async (requestedRoom: string) => {
      setError('');
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
        socket.emit(
          'join-room',
          { roomId: requestedRoom.trim().toUpperCase() },
          (ack: Ack) => {
            if (!ack.ok || !ack.roomId) {
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
            setRoomId(ack.roomId);
            setStatus('connecting');
          },
        );
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
      socketRef.current?.emit(
        'call-end',
        { roomId: roomRef.current },
        () => undefined,
      );
      socketRef.current?.emit(
        'leave-room',
        { roomId: roomRef.current },
        () => undefined,
      );
    }
    roomRef.current = '';
    closePeer();
    setMuted(false);
    setCandidateType('discovering');
    setStatus('ended');
  }, [closePeer]);
  const labels: Record<Status, string> = {
    idle: 'Ready',
    connecting: 'Connecting',
    waiting: 'Waiting for peer',
    connected: 'Connected',
    ended: 'Ended',
    error: 'Error',
  };
  return {
    roomId,
    status,
    statusLabel: labels[status],
    muted,
    error,
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
