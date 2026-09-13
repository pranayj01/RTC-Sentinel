import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export interface HttpSecurityOptions {
  allowedOrigins?: string[];
  apiRateLimit?: number;
  authRateLimit?: number;
  rateLimitWindowMs?: number;
  requestBodyLimit?: string;
  trustProxyHops?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function configuredOrigins(value = process.env.CORS_ORIGINS): string[] {
  if (!value) return LOCAL_ORIGINS;
  return [
    ...new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
}

function rateLimitHandler(_request: Request, response: Response): void {
  response.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  });
}

export function applyHttpSecurity(
  app: Express,
  options: HttpSecurityOptions = {},
): void {
  const origins = new Set(options.allowedOrigins ?? configuredOrigins());
  const trustProxyHops =
    options.trustProxyHops ??
    Math.max(0, Number(process.env.TRUST_PROXY_HOPS ?? 0));
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      origin(origin, callback) {
        callback(null, !origin || origins.has(origin));
      },
    }),
  );

  const windowMs =
    options.rateLimitWindowMs ??
    positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
  app.use(
    rateLimit({
      windowMs,
      limit:
        options.apiRateLimit ??
        positiveInteger(process.env.API_RATE_LIMIT_MAX, 300),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (request) => request.path === '/health',
      handler: rateLimitHandler,
    }),
  );
  app.use(
    '/auth',
    rateLimit({
      windowMs,
      limit:
        options.authRateLimit ??
        positiveInteger(process.env.AUTH_RATE_LIMIT_MAX, 20),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      skip: (request) => !['/login', '/register'].includes(request.path),
      handler: rateLimitHandler,
    }),
  );
  app.use('/auth', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    express.json({
      limit:
        options.requestBodyLimit ?? process.env.REQUEST_BODY_LIMIT ?? '64kb',
      strict: true,
      type: 'application/json',
    }),
  );
}

function isUnsafeSecret(secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return true;
  const normalized = secret.toLowerCase();
  return (
    normalized.includes('change-me') || normalized.includes('replace-with')
  );
}

export function validateProductionSecurity(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== 'production') return;
  const accessSecret = environment.JWT_ACCESS_SECRET;
  const refreshSecret = environment.JWT_REFRESH_SECRET;
  if (isUnsafeSecret(accessSecret)) {
    throw new Error(
      'JWT_ACCESS_SECRET must be a non-placeholder value of at least 32 characters',
    );
  }
  if (isUnsafeSecret(refreshSecret)) {
    throw new Error(
      'JWT_REFRESH_SECRET must be a non-placeholder value of at least 32 characters',
    );
  }
  if (accessSecret === refreshSecret) {
    throw new Error('JWT access and refresh secrets must be different');
  }

  if (!environment.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS is required in production');
  }
  const origins = configuredOrigins(environment.CORS_ORIGINS);
  if (origins.includes('*'))
    throw new Error('Wildcard CORS origins are not allowed');
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    ) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }
}
