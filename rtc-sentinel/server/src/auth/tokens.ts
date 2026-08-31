import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
type TokenKind = 'access' | 'refresh';
function secretFor(kind: TokenKind): string {
  const name = kind === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET';
  const secret = process.env[name];
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error(`${name} is required`);
  return `rtc-sentinel-development-${kind}-secret`;
}
function expiryFor(kind: TokenKind): SignOptions['expiresIn'] {
  const value = process.env[kind === 'access' ? 'JWT_ACCESS_EXPIRES_IN' : 'JWT_REFRESH_EXPIRES_IN'];
  return (value ?? (kind === 'access' ? '15m' : '7d')) as SignOptions['expiresIn'];
}
function sign(userId: string, kind: TokenKind): string {
  return jwt.sign({ type: kind }, secretFor(kind), { subject: userId, expiresIn: expiryFor(kind) });
}
function verify(token: string, kind: TokenKind): string {
  const payload = jwt.verify(token, secretFor(kind)) as JwtPayload;
  if (payload.type !== kind || typeof payload.sub !== 'string') throw new jwt.JsonWebTokenError('Invalid token type');
  return payload.sub;
}
export const createAccessToken = (id: string) => sign(id, 'access');
export const createRefreshToken = (id: string) => sign(id, 'refresh');
export const verifyAccessToken = (token: string) => verify(token, 'access');
export const verifyRefreshToken = (token: string) => verify(token, 'refresh');
