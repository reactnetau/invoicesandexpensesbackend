import type { AppSyncResolverHandler } from 'aws-lambda';
import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;

type Result = { ok: boolean; error: string | null };

export const handler: AppSyncResolverHandler<Record<string, never>, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { ok: false, error: 'Unauthorized' };

  const stripeKey = env.stripeSecretKey;
  if (!stripeKey) return { ok: false, error: 'Stripe not configured' };

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
  if (!profile) return { ok: false, error: 'User profile not found' };

  // Founding members cannot cancel — their Pro is permanent
  if (profile.isFoundingMember) {
    return { ok: false, error: 'Founding members have permanent Pro access' };
  }

  if (!profile.stripeCustomerId) {
    return { ok: false, error: 'No active subscription found' };
  }

  try {
    const stripe = new Stripe(stripeKey);

    // Find the active subscription for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripeCustomerId,
      status: 'active',
      limit: 1,
    });

    if (!subscriptions.data.length) {
      return { ok: false, error: 'No active subscription found' };
    }

    // Cancel at period end so the user keeps access until they paid through
    await stripe.subscriptions.update(subscriptions.data[0].id, {
      cancel_at_period_end: true,
    });

    return { ok: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error';
    console.error('[stripeCancel]', msg);
    return { ok: false, error: msg };
  }
};
