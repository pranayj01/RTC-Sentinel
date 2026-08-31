export interface UserRecord {
  id: string; name: string; email: string; passwordHash: string; createdAt: Date; updatedAt: Date;
}
export type PublicUser = Omit<UserRecord, 'passwordHash'>;
export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: { name: string; email: string; passwordHash: string }): Promise<UserRecord>;
}
export function toPublicUser(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
