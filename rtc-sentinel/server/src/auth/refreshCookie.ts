import type { Request, Response } from 'express';

export const REFRESH_COOKIE_NAME = 'rtc_sentinel_refresh';

function cookieMaxAge(): number {
  const configured = Number(process.env.JWT_REFRESH_COOKIE_MAX_AGE_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : 7 * 24 * 60 * 60 * 1_000;
}

export function setRefreshCookie(response: Response, token: string): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/auth',
    maxAge: cookieMaxAge(),
    priority: 'high',
  });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/auth',
    priority: 'high',
  });
}

export function readRefreshCookie(request: Request): string | null {
  const cookies = request.header('cookie');
  if (!cookies) return null;
  const match = cookies
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(REFRESH_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}
