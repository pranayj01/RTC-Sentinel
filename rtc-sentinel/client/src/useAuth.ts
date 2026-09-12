import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getCurrentUser,
  login as loginRequest,
  refresh,
  register as registerRequest,
  type AuthSession,
  type PublicUser,
} from './authApi';

const STORAGE_KEY = 'rtc-sentinel.auth';

function readStoredSession(): AuthSession | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as AuthSession) : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

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
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) throw new ApiError('No active session.', 401);
    const tokens = await refresh(current.refreshToken);
    saveSession({ ...current, ...tokens });
  }, [saveSession]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const stored = readStoredSession();
      if (!stored) {
        if (active) setLoading(false);
        return;
      }
      try {
        const user = await getCurrentUser(stored.accessToken);
        if (active) saveSession({ ...stored, user });
      } catch {
        try {
          const tokens = await refresh(stored.refreshToken);
          const user = await getCurrentUser(tokens.accessToken);
          if (active) saveSession({ user, ...tokens });
        } catch {
          if (active) saveSession(null);
        }
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
  const logout = useCallback(() => saveSession(null), [saveSession]);

  return {
    loading,
    user: session?.user ?? null,
    accessToken: session?.accessToken ?? '',
    login,
    register,
    logout,
  };
}
