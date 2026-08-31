import { hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../app.js';
import type { UserRecord, UserRepository } from './types.js';

class MemoryUsers implements UserRepository {
  users: UserRecord[] = [];
  async findByEmail(email: string) { return this.users.find((u) => u.email === email) ?? null; }
  async findById(id: string) { return this.users.find((u) => u.id === id) ?? null; }
  async create(input: { name: string; email: string; passwordHash: string }) {
    const now = new Date(); const user = { id: `user-${this.users.length + 1}`, ...input, createdAt: now, updatedAt: now };
    this.users.push(user); return user;
  }
}
const valid = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'StrongPass1' };
describe('authentication API', () => {
  let users: MemoryUsers;
  beforeEach(() => { users = new MemoryUsers(); process.env.JWT_ACCESS_SECRET = 'test-access-secret'; process.env.JWT_REFRESH_SECRET = 'test-refresh-secret'; });
  it('valid registration', async () => {
    const response = await request(createApp(users)).post('/auth/register').send(valid);
    expect(response.status).toBe(201); expect(response.body.user.email).toBe(valid.email);
    expect(response.body.user.passwordHash).toBeUndefined(); expect(users.users[0].passwordHash).not.toBe(valid.password);
  });
  it('duplicate registration', async () => {
    const app = createApp(users); await request(app).post('/auth/register').send(valid);
    const response = await request(app).post('/auth/register').send(valid);
    expect(response.status).toBe(409); expect(response.body.error.code).toBe('EMAIL_EXISTS');
  });
  it('invalid email', async () => {
    const response = await request(createApp(users)).post('/auth/register').send({ ...valid, email: 'bad' });
    expect(response.status).toBe(400);
  });
  it('weak password', async () => {
    const response = await request(createApp(users)).post('/auth/register').send({ ...valid, password: 'password' });
    expect(response.status).toBe(400);
  });
  it('successful login', async () => {
    const now = new Date(); users.users.push({ id: 'user-1', name: valid.name, email: valid.email, passwordHash: await hash(valid.password, 4), createdAt: now, updatedAt: now });
    const response = await request(createApp(users)).post('/auth/login').send({ email: valid.email, password: valid.password });
    expect(response.status).toBe(200); expect(response.body.accessToken).toEqual(expect.any(String));
  });
  it('wrong password', async () => {
    const app = createApp(users); await request(app).post('/auth/register').send(valid);
    const response = await request(app).post('/auth/login').send({ email: valid.email, password: 'WrongPass1' });
    expect(response.status).toBe(401);
  });
  it('expired JWT', async () => {
    const token = jwt.sign({ type: 'access' }, 'test-access-secret', { subject: 'user-1', expiresIn: -1 });
    const response = await request(createApp(users)).get('/users/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401); expect(response.body.error.code).toBe('INVALID_TOKEN');
  });
  it('protected API without JWT', async () => {
    const response = await request(createApp(users)).get('/users/me'); expect(response.status).toBe(401);
  });
  it('protected route and token refresh work', async () => {
    const app = createApp(users); const registered = await request(app).post('/auth/register').send(valid);
    const me = await request(app).get('/users/me').set('Authorization', `Bearer ${registered.body.accessToken}`);
    expect(me.status).toBe(200); expect(me.body.user.email).toBe(valid.email);
    const refreshed = await request(app).post('/auth/refresh').send({ refreshToken: registered.body.refreshToken });
    expect(refreshed.status).toBe(200); expect(refreshed.body.accessToken).toEqual(expect.any(String));
  });
});
