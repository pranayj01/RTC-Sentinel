import {
  ACTIVE_CALL_KEY,
  ACTIVE_CALL_MAX_AGE_MS,
  readActiveCall,
  saveActiveCall,
} from './callSession';

const resumeToken = 'a'.repeat(43);

beforeEach(() => {
  sessionStorage.clear();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-13T05:00:00Z'));
});

afterEach(() => jest.useRealTimers());

test('restores a valid active call from the current browser session', () => {
  saveActiveCall('ABC123', 'host', resumeToken);

  expect(readActiveCall()).toEqual({
    roomId: 'ABC123',
    role: 'host',
    resumeToken,
    savedAt: Date.now(),
  });
});

test('removes an expired active call', () => {
  saveActiveCall('ABC123', 'participant', resumeToken);
  jest.advanceTimersByTime(ACTIVE_CALL_MAX_AGE_MS + 1);

  expect(readActiveCall()).toBeNull();
  expect(sessionStorage.getItem(ACTIVE_CALL_KEY)).toBeNull();
});

test('rejects malformed session data', () => {
  sessionStorage.setItem(
    ACTIVE_CALL_KEY,
    JSON.stringify({ roomId: 'unsafe', role: 'host', resumeToken }),
  );

  expect(readActiveCall()).toBeNull();
  expect(sessionStorage.getItem(ACTIVE_CALL_KEY)).toBeNull();
});
