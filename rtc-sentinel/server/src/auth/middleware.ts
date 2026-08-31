import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './tokens.js';
export function authenticate(request: Request, response: Response, next: NextFunction): void {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Access token required' } }); return;
  }
  try { response.locals.userId = verifyAccessToken(authorization.slice(7)); next(); }
  catch { response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } }); }
}
