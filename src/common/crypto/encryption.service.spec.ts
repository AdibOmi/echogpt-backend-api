import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service.js';

const makeService = (key = randomBytes(32).toString('hex')) =>
  new EncryptionService({ getOrThrow: () => key } as unknown as ConfigService);

describe('EncryptionService (AES-256-GCM)', () => {
  const service = makeService();

  it('round-trips a secret', () => {
    const secret = 'sk-proj-abc123-very-secret';
    expect(service.decrypt(service.encrypt(secret))).toBe(secret);
  });

  it('uses a fresh IV, so the same plaintext encrypts differently each time', () => {
    const a = service.encrypt('same');
    const b = service.encrypt('same');
    expect(a).not.toBe(b);
    expect(a.split(':')).toHaveLength(3); // iv:authTag:ciphertext
  });

  it('never contains the plaintext', () => {
    expect(service.encrypt('sk-PLAINTEXT')).not.toContain('PLAINTEXT');
  });

  it('detects tampering via the auth tag', () => {
    const [iv, tag, ct] = service.encrypt('secret').split(':');
    const bytes = Buffer.from(ct, 'base64');
    bytes[0] ^= 0xff; // flip bits in the ciphertext
    expect(() =>
      service.decrypt([iv, tag, bytes.toString('base64')].join(':')),
    ).toThrow();
  });

  it('fails to decrypt with a different key', () => {
    const encrypted = service.encrypt('secret');
    expect(() => makeService().decrypt(encrypted)).toThrow();
  });
});
