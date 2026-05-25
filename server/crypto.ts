import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ENCRYPTION_KEY must be a 64-character hex string (32 bytes = 256-bit key)
let ENC_KEY: Buffer;

function getKey(): Buffer {
  if (!ENC_KEY) {
    const hexKey = process.env.ENCRYPTION_KEY;
    if (!hexKey || hexKey.length !== 64) {
      throw new Error('FATAL: ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
    }
    ENC_KEY = Buffer.from(hexKey, 'hex');
  }
  return ENC_KEY;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-delimited string: iv:authTag:ciphertext (all hex-encoded).
 */
export function encrypt(text: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM payload produced by `encrypt()`.
 * Throws if the payload is tampered or the key is wrong.
 */
export function decrypt(payload: string): string {
  const key = getKey();
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload format.');
  const [ivHex, tagHex, encHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

/** Returns true if the string looks like an encrypted payload (has 3 colon-delimited hex parts). */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every(p => /^[0-9a-f]+$/i.test(p));
}
