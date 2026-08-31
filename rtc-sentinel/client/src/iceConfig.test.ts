import { createIceConfiguration } from './iceConfig';

test('configures authenticated STUN and TURN over UDP and TCP', () => {
  const config = createIceConfiguration('rtc.test');
  expect(config.iceServers).toEqual([
    { urls: 'stun:rtc.test:3478' },
    {
      urls: ['turn:rtc.test:3478?transport=udp', 'turn:rtc.test:3478?transport=tcp'],
      username: 'rtc-sentinel', credential: 'local-development-turn-secret',
    },
  ]);
  expect(config.iceTransportPolicy).toBe('all');
});

test('supports forced relay testing and deployment overrides', () => {
  const config = createIceConfiguration('ignored', {
    stunUrl: 'stun:stun.example.com:3478', turnUrl: 'turn:turn.example.com:3478?transport=udp',
    turnTcpUrl: 'turn:turn.example.com:3478?transport=tcp', turnUsername: 'user', turnCredential: 'secret',
  }, true);
  expect(config.iceTransportPolicy).toBe('relay');
  expect(config.iceServers?.[1]).toMatchObject({ username: 'user', credential: 'secret' });
});
