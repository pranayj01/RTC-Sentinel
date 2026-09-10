import { MemoryRealtimeStateStore } from './realtimeState.js';

const metric = {
  timestamp: new Date('2026-09-11T10:00:00.000Z'),
  rtt: 80,
  jitter: 10,
  packetsSent: 10,
  packetsReceived: 9,
  packetsLost: 1,
  packetLoss: 10,
  bytesSent: 1000,
  bytesReceived: 900,
  bitrate: 50000,
  codec: 'audio/opus',
  audioLevel: 0.4,
  candidateType: 'relay',
  quality: 'Critical' as const,
  qualityScore: 20,
};

describe('real-time state lifecycle', () => {
  it('cleans socket and room mappings on disconnect', async () => {
    const state = new MemoryRealtimeStateStore();
    await state.registerSocket('socket-a');
    expect(await state.createRoom('ABC123', 'socket-a')).toBe(true);

    await expect(state.unregisterSocket('socket-a')).resolves.toEqual([
      'ABC123',
    ]);
    await expect(state.isSocketActive('socket-a')).resolves.toBe(false);
    await expect(state.getRoomMembers('ABC123')).resolves.toEqual([]);
  });

  it('expires active sockets, rooms, and call sessions after the TTL', async () => {
    let now = 1_000;
    const state = new MemoryRealtimeStateStore(2, () => now);
    await state.registerSocket('socket-a');
    await state.createRoom('ABC123', 'socket-a');
    await state.setCallStatus('ABC123', 'CONNECTED');

    now += 2_001;

    await expect(state.isSocketActive('socket-a')).resolves.toBe(false);
    await expect(state.getRoomMembers('ABC123')).resolves.toEqual([]);
    await expect(state.getCallStatus('ABC123')).resolves.toBeNull();
  });

  it('refreshes socket and room TTLs while signaling is active', async () => {
    let now = 1_000;
    const state = new MemoryRealtimeStateStore(2, () => now);
    await state.registerSocket('socket-a');
    await state.createRoom('ABC123', 'socket-a');

    now += 1_500;
    await expect(state.isRoomMember('ABC123', 'socket-a')).resolves.toBe(true);
    now += 1_000;

    await expect(state.isSocketActive('socket-a')).resolves.toBe(true);
    await expect(state.getRoomMembers('ABC123')).resolves.toEqual(['socket-a']);
  });

  it('starts clean after an ephemeral state restart', async () => {
    const beforeRestart = new MemoryRealtimeStateStore();
    await beforeRestart.registerSocket('socket-a');
    await beforeRestart.createRoom('ABC123', 'socket-a');

    const afterRestart = new MemoryRealtimeStateStore();
    await expect(afterRestart.getRoomMembers('ABC123')).resolves.toEqual([]);
    await expect(afterRestart.createRoom('ABC123', 'socket-b')).resolves.toBe(
      true,
    );
  });

  it('buffers recent QoS metrics and expires them', async () => {
    let now = 1_000;
    const state = new MemoryRealtimeStateStore(2, () => now);
    await state.appendMetric('ABC123', metric);
    await expect(state.getRecentMetrics('ABC123')).resolves.toEqual([metric]);
    now += 2_001;
    await expect(state.getRecentMetrics('ABC123')).resolves.toEqual([]);
  });
});
