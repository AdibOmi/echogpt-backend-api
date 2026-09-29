import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV is the recommended size for GCM

/**
 * Encrypts secrets at rest (AI provider API keys) with AES-256-GCM.
 *
 * Why encryption and not hashing? We must send the real key to OpenAI etc.,
 * so we need to get it back — hashing is one-way, encryption is reversible.
 * Why GCM? It's "authenticated" encryption: the auth tag detects tampering,
 * so a modified ciphertext fails to decrypt instead of producing garbage.
 *
 * Stored format: base64(iv):base64(authTag):base64(ciphertext)
 * A fresh random IV per encryption means the same key encrypts differently each time.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('ENCRYPTION_KEY'), 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
  }

  decrypt(payload: string): string {
    const [iv, authTag, ciphertext] = payload
      .split(':')
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(), // throws if the data or tag was tampered with
    ]).toString('utf8');
  }
}
