export interface PasswordHasher {
  hash(plainText: string): Promise<string>;
  compare(plainText: string, passwordHash: string): Promise<boolean>;
}
