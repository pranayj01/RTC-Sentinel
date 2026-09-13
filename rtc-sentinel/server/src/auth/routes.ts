import { compare, hash } from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from './middleware.js';
import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
} from './tokens.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refreshCookie.js';
import { toPublicUser, type UserRepository } from './types.js';
const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase()),
    password: z
      .string()
      .min(8)
      .max(128)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/),
  })
  .strict();
const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
const issueTokens = (
  response: Parameters<typeof setRefreshCookie>[0],
  id: string,
) => {
  setRefreshCookie(response, createRefreshToken(id));
  return { accessToken: createAccessToken(id) };
};
export function createApiRouter(users: UserRepository): Router {
  const router = Router();
  router.post('/auth/register', async (request, response, next) => {
    try {
      const input = registerSchema.parse(request.body);
      if (await users.findByEmail(input.email)) {
        response.status(409).json({
          error: {
            code: 'EMAIL_EXISTS',
            message: 'Email already registered',
          },
        });
        return;
      }
      const user = await users.create({
        name: input.name,
        email: input.email,
        passwordHash: await hash(input.password, 12),
      });
      response
        .status(201)
        .json({ user: toPublicUser(user), ...issueTokens(response, user.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/auth/login', async (request, response, next) => {
    try {
      const input = loginSchema.parse(request.body);
      const user = await users.findByEmail(input.email);
      if (!user || !(await compare(input.password, user.passwordHash))) {
        response.status(401).json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
        return;
      }
      response.json({
        user: toPublicUser(user),
        ...issueTokens(response, user.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/auth/refresh', async (request, response, next) => {
    const token = readRefreshCookie(request);
    if (!token) {
      response.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
      });
      return;
    }
    let id: string;
    try {
      id = verifyRefreshToken(token);
    } catch {
      clearRefreshCookie(response);
      response.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
      });
      return;
    }
    try {
      if (!(await users.findById(id))) {
        clearRefreshCookie(response);
        response.status(401).json({
          error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
        });
        return;
      }
      response.json(issueTokens(response, id));
    } catch (error) {
      next(error);
    }
  });
  router.post('/auth/logout', (_request, response) => {
    clearRefreshCookie(response);
    response.status(204).send();
  });
  router.get('/users/me', authenticate, async (_request, response, next) => {
    try {
      const user = await users.findById(response.locals.userId as string);
      if (!user) {
        response.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
        return;
      }
      response.json({ user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
