import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { analyzeAudio, predictQuality } from './authApi';
import { useAuth } from './useAuth';
import { useWebRtcCall } from './useWebRtcCall';

jest.mock('./authApi', () => ({
  analyzeAudio: jest.fn(),
  predictQuality: jest.fn(),
}));
jest.mock('./useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('./useWebRtcCall', () => ({ useWebRtcCall: jest.fn() }));
const mockAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockCall = useWebRtcCall as jest.MockedFunction<typeof useWebRtcCall>;
const mockPredictQuality = predictQuality as jest.MockedFunction<
  typeof predictQuality
>;
const mockAnalyzeAudio = analyzeAudio as jest.MockedFunction<
  typeof analyzeAudio
>;

const authenticated = {
  loading: false,
  user: {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  accessToken: 'access-token',
  login: jest.fn(),
  register: jest.fn(),
  logout: jest.fn(),
};

const idleCall = {
  roomId: '',
  status: 'idle' as const,
  statusLabel: 'Ready',
  muted: false,
  error: '',
  recoveryMessage: '',
  candidateType: 'discovering',
  qosMetric: null,
  qosHistory: [],
  durationSeconds: 0,
  quality: {
    quality: 'Unknown' as const,
    score: null,
    limitingFactors: ['Waiting for complete WebRTC statistics'],
  },
  audioChunk: null,
  remoteAudioRef: { current: null },
  createCall: jest.fn(),
  joinCall: jest.fn(),
  toggleMute: jest.fn(),
  endCall: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockAuth.mockReturnValue(authenticated);
  mockCall.mockReturnValue(idleCall);
  mockPredictQuality.mockResolvedValue({
    quality: 'excellent',
    confidence: 0.96,
  });
  mockAnalyzeAudio.mockResolvedValue({
    label: 'speech',
    confidence: 0.91,
    durationMs: 341,
    features: {
      rmsEnergy: 0.125,
      zeroCrossingRate: 0.083,
      spectralCentroidHz: 1280,
      mfcc: Array(13).fill(0),
      melSpectrogram: Array(16).fill(0),
    },
  });
});

test('requires authentication before showing call controls', async () => {
  const register = jest.fn().mockResolvedValue(undefined);
  mockAuth.mockReturnValue({
    ...authenticated,
    user: null,
    accessToken: '',
    register,
  });
  render(<App />);

  expect(screen.queryByRole('button', { name: 'Create Call' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'New User' },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'new@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'StrongPass1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

  await waitFor(() =>
    expect(register).toHaveBeenCalledWith({
      name: 'New User',
      email: 'new@example.com',
      password: 'StrongPass1',
    }),
  );
});

test('explains which password requirement is missing', async () => {
  const register = jest.fn().mockResolvedValue(undefined);
  mockAuth.mockReturnValue({
    ...authenticated,
    user: null,
    accessToken: '',
    register,
  });
  render(<App />);

  fireEvent.click(screen.getByRole('tab', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'New User' },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'new@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'lowercase' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

  expect(
    await screen.findByText(
      'Password must include an uppercase letter and a number.',
    ),
  ).toBeInTheDocument();
  expect(register).not.toHaveBeenCalled();
});

test('allows anonymous users to enter join-only guest mode', () => {
  mockAuth.mockReturnValue({
    ...authenticated,
    user: null,
    accessToken: '',
  });
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: 'Join a call as guest' }));

  expect(screen.getByText('Guest')).toBeInTheDocument();
  expect(screen.getByText('Join-only access')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create Call' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Join Call' })).toBeInTheDocument();
  expect(mockCall).toHaveBeenCalledWith('', true, false);
  expect(sessionStorage.getItem('rtc-sentinel.guest-mode')).toBe('1');
});

test('offers call creation and room joining', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', { name: 'RTC Sentinel' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create Call' }));
  expect(idleCall.createCall).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Room ID'), {
    target: { value: 'abc123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Join Call' }));
  expect(idleCall.joinCall).toHaveBeenCalledWith('ABC123');
});

test('shows active call state, ML prediction, and controls', async () => {
  const metric = {
    timestamp: new Date(0).toISOString(),
    rtt: 82,
    jitter: 11,
    packetsSent: 100,
    packetsReceived: 99,
    packetsLost: 1,
    packetLoss: 1,
    bytesSent: 2000,
    bytesReceived: 1000,
    bitrate: 45000,
    codec: 'audio/opus',
    audioLevel: 0.42,
    candidateType: 'relay',
  };
  const active = {
    ...idleCall,
    roomId: 'ABC123',
    status: 'connected' as const,
    statusLabel: 'Connected',
    candidateType: 'relay',
    qosMetric: metric,
    qosHistory: [metric, metric],
    durationSeconds: 65,
    quality: {
      quality: 'Excellent' as const,
      score: 100,
      limitingFactors: ['round-trip time'],
    },
  };
  mockCall.mockReturnValue(active);
  render(<App />);
  expect(screen.getByText('ABC123')).toBeInTheDocument();
  expect(screen.getByText('Connected')).toBeInTheDocument();
  expect(screen.getByText('RELAY')).toBeInTheDocument();
  expect(screen.getByText('01:05')).toBeInTheDocument();
  expect(screen.getByText('82 ms')).toBeInTheDocument();
  expect(screen.getByText('45.0 kbps')).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Recent round trip time' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Excellent')).toBeInTheDocument();
  expect(screen.getByText(/Score 100\/100/)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText('96% model confidence')).toBeInTheDocument(),
  );
  expect(mockPredictQuality).toHaveBeenCalledWith(
    'access-token',
    expect.objectContaining({ rtt: 82, audioLevel: 0.42 }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
  fireEvent.click(screen.getByRole('button', { name: 'End Call' }));
  expect(active.toggleMute).toHaveBeenCalled();
  expect(active.endCall).toHaveBeenCalled();
});

test('runs opt-in audio signal analysis for signed-in calls', async () => {
  const active = {
    ...idleCall,
    roomId: 'ABC123',
    status: 'connected' as const,
    statusLabel: 'Connected',
    audioChunk: {
      encoding: 'pcm_s16le' as const,
      sampleRate: 48000,
      pcmBase64: 'AAAAAA==',
    },
  };
  mockCall.mockReturnValue(active);
  render(<App />);

  expect(screen.getByText('Off')).toBeInTheDocument();
  expect(mockAnalyzeAudio).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Enable audio analysis' }),
  );

  await waitFor(() =>
    expect(mockAnalyzeAudio).toHaveBeenCalledWith(
      'access-token',
      active.audioChunk,
    ),
  );
  expect(await screen.findByText('Speech')).toBeInTheDocument();
  expect(screen.getByText('91%')).toBeInTheDocument();
  expect(mockCall).toHaveBeenLastCalledWith('access-token', false, true);
});
