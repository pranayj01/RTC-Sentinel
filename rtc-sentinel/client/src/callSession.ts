export type CallRole = 'host' | 'participant';

export interface ActiveCallSession {
  roomId: string;
  role: CallRole;
  resumeToken: string;
  savedAt: number;
}

export const ACTIVE_CALL_KEY = 'rtc-sentinel.active-call';
export const ACTIVE_CALL_MAX_AGE_MS = 2 * 60 * 1000;

export function readActiveCall(): ActiveCallSession | null {
  try {
    const value = sessionStorage.getItem(ACTIVE_CALL_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ActiveCallSession>;
    if (
      typeof parsed.roomId !== 'string' ||
      !/^[A-Z0-9]{6}$/.test(parsed.roomId) ||
      !['host', 'participant'].includes(parsed.role ?? '') ||
      typeof parsed.resumeToken !== 'string' ||
      parsed.resumeToken.length < 32 ||
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > ACTIVE_CALL_MAX_AGE_MS
    ) {
      clearActiveCall();
      return null;
    }
    return parsed as ActiveCallSession;
  } catch {
    clearActiveCall();
    return null;
  }
}

export function saveActiveCall(
  roomId: string,
  role: CallRole,
  resumeToken: string,
): void {
  sessionStorage.setItem(
    ACTIVE_CALL_KEY,
    JSON.stringify({ roomId, role, resumeToken, savedAt: Date.now() }),
  );
}

export function clearActiveCall(): void {
  sessionStorage.removeItem(ACTIVE_CALL_KEY);
}
