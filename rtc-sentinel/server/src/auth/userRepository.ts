import type { PrismaClient } from '@prisma/client';
import type { UserRecord, UserRepository } from './types.js';
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}
  findByEmail(email: string): Promise<UserRecord | null> { return this.prisma.user.findUnique({ where: { email } }); }
  findById(id: string): Promise<UserRecord | null> { return this.prisma.user.findUnique({ where: { id } }); }
  create(input: { name: string; email: string; passwordHash: string }): Promise<UserRecord> {
    return this.prisma.user.create({ data: input });
  }
}
