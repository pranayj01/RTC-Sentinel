import request from 'supertest';
import type { AudioAnalyzer, QualityPredictor } from './analytics/types.js';
import { createApp } from './app.js';
import type { UserRepository } from './auth/types.js';
import type { CallRepository } from './calls/types.js';
import type { MetricRepository } from './metrics/types.js';
import {
  type HttpSecurityOptions,
  validateProductionSecurity,
} from './security.js';

function secureApp(options: HttpSecurityOptions = {}) {
  const users: UserRepository = {
    findByEmail: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
  };
  return {
    app: createApp(
      users,
      {} as CallRepository,
      () => new Date(),
      {} as MetricRepository,
      {} as QualityPredictor,
      {} as AudioAnalyzer,
      options,
    ),
    users,
  };
}

describe('HTTP security', () => {
  it('sets defensive headers and only reflects an allowed CORS origin', async () => {
    const { app } = secureApp({ allowedOrigins: ['https://rtc.example.com'] });
    const allowed = await request(app)
      .get('/health')
      .set('Origin', 'https://rtc.example.com');
    const denied = await request(app)
      .get('/health')
      .set('Origin', 'https://attacker.example');

    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://rtc.example.com',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits API spam with a stable error response', async () => {
    const { app } = secureApp({ apiRateLimit: 1, rateLimitWindowMs: 60_000 });

    expect((await request(app).get('/users/me')).status).toBe(401);
    const limited = await request(app).get('/users/me');

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers.ratelimit).toEqual(expect.any(String));
  });

  it('applies a stricter limiter to failed authentication attempts', async () => {
    const { app } = secureApp({
      apiRateLimit: 100,
      authRateLimit: 2,
      rateLimitWindowMs: 60_000,
    });
    const invalid = { email: 'invalid', password: 'WrongPass1' };

    expect((await request(app).post('/auth/login').send(invalid)).status).toBe(
      400,
    );
    expect((await request(app).post('/auth/login').send(invalid)).status).toBe(
      400,
    );
    const limited = await request(app).post('/auth/login').send(invalid);

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects oversized JSON before it reaches a route', async () => {
    const { app } = secureApp({ requestBodyLimit: '1kb' });
    const response = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a'.repeat(2_000) }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects SQL-injection-shaped input during validation', async () => {
    const { app, users } = secureApp();
    const response = await request(app).post('/auth/login').send({
      email: "' OR 1=1--",
      password: 'StrongPass1',
    });

    expect(response.status).toBe(400);
    expect(users.findByEmail).not.toHaveBeenCalled();
  });
});

describe('production security configuration', () => {
  const valid = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    CORS_ORIGINS: 'https://rtc.example.com',
  } as NodeJS.ProcessEnv;

  it('accepts distinct strong secrets and exact origins', () => {
    expect(() => validateProductionSecurity(valid)).not.toThrow();
  });

  it.each([
    [{ ...valid, JWT_ACCESS_SECRET: 'short' }, 'JWT_ACCESS_SECRET'],
    [{ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET }, 'different'],
    [{ ...valid, CORS_ORIGINS: '*' }, 'Wildcard'],
  ])('rejects unsafe production configuration', (environment, message) => {
    expect(() => validateProductionSecurity(environment)).toThrow(message);
  });
});
