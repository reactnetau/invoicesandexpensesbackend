import type { AppSyncResolverHandler } from 'aws-lambda';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = env.encryptionKey;
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return buf;
}

function encryptPayid(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptPayid(stored: string): string {
  const [ivHex, tagHex, cipherHex] = stored.split(':');
  if (!ivHex || !tagHex || !cipherHex) throw new Error('Invalid encrypted value format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Handles both getDecryptedPayid and updateEncryptedPayid via fieldName dispatch.
 */
export const handler: AppSyncResolverHandler<any, any> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { payid: null, ok: false, error: 'Unauthorized' };

  const fieldName = event.info?.fieldName as string;

  const profileResult = await ddb.send(
    new QueryCommand({
      TableName: USER_PROFILE_TABLE,
      IndexName: 'byOwner',
      KeyConditionExpression: '#owner = :owner',
      ExpressionAttributeNames: { '#owner': 'owner' },
      ExpressionAttributeValues: { ':owner': sub },
      Limit: 1,
    })
  );
  const profile = profileResult.Items?.[0];
  if (!profile) return { payid: null, ok: false, error: 'User profile not found' };

  if (fieldName === 'getDecryptedPayid') {
    if (!profile.payidEncrypted) return { payid: null };
    try {
      const payid = decryptPayid(profile.payidEncrypted);
      return { payid };
    } catch {
      return { payid: null };
    }
  }

  if (fieldName === 'updateEncryptedPayid') {
    const { payid } = event.arguments as { payid: string };
    if (!payid) return { ok: false, error: 'payid is required' };

    try {
      const encrypted = encryptPayid(payid.trim());
      await ddb.send(
        new UpdateCommand({
          TableName: USER_PROFILE_TABLE,
          Key: { id: profile.id },
          UpdateExpression: 'SET payidEncrypted = :enc, updatedAt = :now',
          ExpressionAttributeValues: {
            ':enc': encrypted,
            ':now': new Date().toISOString(),
          },
        })
      );
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Encryption failed' };
    }
  }

  return { ok: false, error: `Unknown operation: ${fieldName}` };
};
