import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;
const FOUNDING_MEMBER_LIMIT = 50;

interface Args {
  email: string;
  currency?: string;
}

interface Result {
  id: string | null;
  isFoundingMember: boolean | null;
  subscriptionStatus: string | null;
  error: string | null;
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { id: null, isFoundingMember: null, subscriptionStatus: null, error: 'Unauthorized' };

  const { email, currency = 'USD' } = event.arguments;

  // Idempotency: return existing profile if already created
  const existing = await ddb.send(
    new QueryCommand({
      TableName: USER_PROFILE_TABLE,
      IndexName: 'byOwner',
      KeyConditionExpression: '#owner = :owner',
      ExpressionAttributeNames: { '#owner': 'owner' },
      ExpressionAttributeValues: { ':owner': sub },
      Limit: 1,
    })
  );

  if (existing.Items?.length) {
    const p = existing.Items[0];
    return {
      id: p.id,
      isFoundingMember: p.isFoundingMember ?? false,
      subscriptionStatus: p.subscriptionStatus ?? 'inactive',
      error: null,
    };
  }

  // Founding member check
  const allowFounding = env.foundingMembers === 'true';
  let isFoundingMember = false;

  if (allowFounding) {
    const countResult = await ddb.send(
      new ScanCommand({
        TableName: USER_PROFILE_TABLE,
        Select: 'COUNT',
      })
    );
    const totalUsers = countResult.Count ?? 0;
    isFoundingMember = totalUsers < FOUNDING_MEMBER_LIMIT;
  }

  const subscriptionStatus = isFoundingMember ? 'active' : 'inactive';
  const id = randomUUID();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: USER_PROFILE_TABLE,
      Item: {
        id,
        owner: sub, // Amplify Data owner field
        email,
        currency,
        isFoundingMember,
        subscriptionStatus,
        createdAt: now,
        updatedAt: now,
        __typename: 'UserProfile',
      },
      ConditionExpression: 'attribute_not_exists(id)',
    })
  );

  return { id, isFoundingMember, subscriptionStatus, error: null };
};
