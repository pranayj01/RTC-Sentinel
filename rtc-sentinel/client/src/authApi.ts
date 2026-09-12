const API_BASE_URL = '/api';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface MlQualityPrediction {
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  confidence: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  } & T;
  if (!response.ok) {
    throw new ApiError(
      body.error?.message ?? 'The server could not complete the request.',
      response.status,
      body.error?.code,
    );
  }
  return body;
}

export function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthSession> {
  return request<AuthSession>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function login(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  return request<AuthSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function refresh(refreshToken: string): Promise<TokenPair> {
  return request<TokenPair>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function getCurrentUser(accessToken: string): Promise<PublicUser> {
  const response = await request<{ user: PublicUser }>(
    '/users/me',
    {},
    accessToken,
  );
  return response.user;
}

export async function predictQuality(
  accessToken: string,
  features: {
    rtt: number;
    jitter: number;
    packetLoss: number;
    bitrate: number;
    audioLevel?: number;
  },
): Promise<MlQualityPrediction> {
  const response = await request<{ prediction: MlQualityPrediction }>(
    '/analytics/predict-quality',
    { method: 'POST', body: JSON.stringify(features) },
    accessToken,
  );
  return response.prediction;
}
