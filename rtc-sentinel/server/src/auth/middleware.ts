import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './tokens.js';
export function authenticate(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const authorization = request.header('authorization');
  const bearer = authorization?.match(
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/,
  );
  if (!bearer) {
    response.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Access token required' },
    });
    return;
  }
  try {
    response.locals.userId = verifyAccessToken(bearer[1]);
    next();
  } catch {
    response.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }
}
