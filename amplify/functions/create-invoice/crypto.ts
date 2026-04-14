import { createDecipheriv } from 'crypto';
import { env } from '../env';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = env.encryptionKey;
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return buf;
}

export function decrypt(stored: string): string {
  const [ivHex, tagHex, cipherHex] = stored.split(':');
  if (!ivHex || !tagHex || !cipherHex) throw new Error('Invalid encrypted value format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
