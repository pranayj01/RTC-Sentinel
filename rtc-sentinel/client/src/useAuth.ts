import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  refresh,
  register as registerRequest,
  type AuthSession,
  type PublicUser,
} from './authApi';

const LEGACY_STORAGE_KEY = 'rtc-sentinel.auth';

function millisecondsUntilRefresh(token: string): number {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
    ) as { exp?: number };
    if (!payload.exp) return 14 * 60 * 1000;
    return Math.max(1_000, payload.exp * 1000 - Date.now() - 30_000);
  } catch {
    return 14 * 60 * 1000;
  }
}

export interface Authentication {
  loading: boolean;
  user: PublicUser | null;
  accessToken: string;
  login(input: { email: string; password: string }): Promise<void>;
  register(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<void>;
  logout(): void;
}

export function useAuth(): Authentication {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);

  const saveSession = useCallback((next: AuthSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const refreshSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) throw new ApiError('No active session.', 401);
    const tokens = await refresh();
    saveSession({ ...current, ...tokens });
  }, [saveSession]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      try {
        const tokens = await refresh();
        const user = await getCurrentUser(tokens.accessToken);
        if (active) saveSession({ user, ...tokens });
      } catch {
        if (active) saveSession(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, [saveSession]);

  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setTimeout(() => {
      void refreshSession().catch(() => saveSession(null));
    }, millisecondsUntilRefresh(session.accessToken));
    return () => window.clearTimeout(timer);
  }, [refreshSession, saveSession, session]);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      saveSession(await loginRequest(input));
    },
    [saveSession],
  );
  const register = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      saveSession(await registerRequest(input));
    },
    [saveSession],
  );
  const logout = useCallback(() => {
    saveSession(null);
    void logoutRequest().catch(() => undefined);
  }, [saveSession]);

  return {
    loading,
    user: session?.user ?? null,
    accessToken: session?.accessToken ?? '',
    login,
    register,
    logout,
  };
}
