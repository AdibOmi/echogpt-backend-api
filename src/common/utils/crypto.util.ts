import { createHash, randomBytes } from 'node:crypto';

/**
 * SHA-256 is right for high-entropy random tokens (refresh tokens, email
 * verification tokens): they can't be brute-forced, so a slow hash like bcrypt
 * adds nothing — and bcrypt silently truncates input at 72 bytes, which would
 * make long JWTs collide. Passwords are low-entropy, so they use bcrypt.
 */
export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('hex');
