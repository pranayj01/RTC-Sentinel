import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { useWebRtcCall } from './useWebRtcCall';

jest.mock('./useWebRtcCall', () => ({ useWebRtcCall: jest.fn() }));
const mockCall = useWebRtcCall as jest.MockedFunction<typeof useWebRtcCall>;

const idleCall = {
  roomId: '', status: 'idle' as const, statusLabel: 'Ready', muted: false, error: '', candidateType: 'discovering',
  qosMetric: null, qosHistory: [], durationSeconds: 0,
  remoteAudioRef: { current: null }, createCall: jest.fn(), joinCall: jest.fn(),
  toggleMute: jest.fn(), endCall: jest.fn(),
};

beforeEach(() => { jest.clearAllMocks(); mockCall.mockReturnValue(idleCall); });

test('offers call creation and room joining', () => {
  render(<App />); expect(screen.getByRole('heading', { name: 'RTC Sentinel' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create Call' })); expect(idleCall.createCall).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Room ID'), { target: { value: 'abc123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Join Call' })); expect(idleCall.joinCall).toHaveBeenCalledWith('ABC123');
});

test('shows active call state and controls', () => {
  const metric = { timestamp: new Date(0).toISOString(), rtt: 82, jitter: 11, packetsSent: 100, packetsReceived: 99, packetsLost: 1, packetLoss: 1, bytesSent: 2000, bytesReceived: 1000, bitrate: 45000, codec: 'audio/opus', audioLevel: 0.42, candidateType: 'relay' };
  const active = { ...idleCall, roomId: 'ABC123', status: 'connected' as const, statusLabel: 'Connected', candidateType: 'relay', qosMetric: metric, qosHistory: [metric, metric], durationSeconds: 65 };
  mockCall.mockReturnValue(active); render(<App />);
  expect(screen.getByText('ABC123')).toBeInTheDocument(); expect(screen.getByText('Connected')).toBeInTheDocument();
  expect(screen.getByText('RELAY')).toBeInTheDocument();
  expect(screen.getByText('01:05')).toBeInTheDocument(); expect(screen.getByText('82 ms')).toBeInTheDocument();
  expect(screen.getByText('45.0 kbps')).toBeInTheDocument(); expect(screen.getByRole('img', { name: 'Recent round trip time' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mute' })); fireEvent.click(screen.getByRole('button', { name: 'End Call' }));
  expect(active.toggleMute).toHaveBeenCalled(); expect(active.endCall).toHaveBeenCalled();
});
