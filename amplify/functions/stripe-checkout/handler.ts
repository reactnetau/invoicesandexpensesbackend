import type { AppSyncResolverHandler } from 'aws-lambda';
import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;

type Result = { url: string | null; error: string | null };

export const handler: AppSyncResolverHandler<Record<string, never>, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { url: null, error: 'Unauthorized' };

  const stripeKey = env.stripeSecretKey;
  const priceId = env.stripePriceId;
  const appUrl = env.appUrl;

  if (!stripeKey || !priceId) {
    return { url: null, error: 'Stripe not configured' };
  }

  // Look up the user's profile by owner (Cognito sub)
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
  if (!profile) return { url: null, error: 'User profile not found' };

  try {
    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: profile.stripeCustomerId ? undefined : profile.email,
      customer: profile.stripeCustomerId ?? undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: profile.id, ownerSub: sub },
      // Deep link back to the app after checkout
      success_url: `${appUrl}/stripe-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/stripe-cancel`,
    });

    return { url: session.url, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error';
    console.error('[stripeCheckout]', msg);
    return { url: null, error: msg };
  }
};
