import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;
const FOUNDING_MEMBER_LIMIT = 50;

type Result = {
  enabled: boolean | null;
  claimed: number | null;
  limit: number | null;
  available: number | null;
  error: string | null;
};

export const handler: AppSyncResolverHandler<Record<string, never>, Result> = async () => {
  try {
    let claimed = 0;
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: USER_PROFILE_TABLE,
          Select: 'COUNT',
          FilterExpression: '#isFoundingMember = :true',
          ExpressionAttributeNames: { '#isFoundingMember': 'isFoundingMember' },
          ExpressionAttributeValues: { ':true': true },
          ExclusiveStartKey: lastKey,
        })
      );

      claimed += result.Count ?? 0;
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const limit = FOUNDING_MEMBER_LIMIT;
    const enabled = env.foundingMembers === 'true' && claimed < limit;

    return {
      enabled,
      claimed,
      limit,
      available: Math.max(limit - claimed, 0),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load founding member count';
    console.error('[foundingMembers]', message);
    return { enabled: null, claimed: null, limit: FOUNDING_MEMBER_LIMIT, available: null, error: message };
  }
};
