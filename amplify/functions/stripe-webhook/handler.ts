import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;

/**
 * HTTP POST /webhook/stripe
 * Exposed via API Gateway (configured in amplify/backend.ts).
 *
 * Subscribe to these Stripe events:
 *   - checkout.session.completed
 *   - invoice.paid
 *   - customer.subscription.deleted
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const stripeKey = env.stripeSecretKey;
  const webhookSecret = env.stripeWebhookSecret;

  if (!stripeKey || !webhookSecret) {
    console.error('[stripeWebhook] Missing Stripe env vars');
    return { statusCode: 500, body: 'Server misconfiguration' };
  }

  const sig = event.headers['stripe-signature'];
  if (!sig) {
    return { statusCode: 400, body: 'Missing stripe-signature header' };
  }

  const stripe = new Stripe(stripeKey);
  let stripeEvent: Stripe.Event;
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64')
    : event.body ?? '';

  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[stripeWebhook] Signature verification failed:', err);
    return { statusCode: 400, body: 'Invalid webhook signature' };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;
        const ownerSub = session.metadata?.ownerSub;
        if (!ownerSub) break;

        // Mark provider as stripe so sync-subscription knows Stripe is the
        // active provider and won't overwrite this when RevenueCat reports inactive.
        await updateProfileByOwner(ownerSub, {
          stripeCustomerId: session.customer as string,
          subscriptionStatus: 'active',
          subscriptionProvider: 'stripe',
        });
        break;
      }

      case 'invoice.paid': {
        const inv = stripeEvent.data.object as Stripe.Invoice;
        if (!inv.customer) break;

        const periodEnd = inv.period_end
          ? new Date(inv.period_end * 1000).toISOString()
          : null;

        await updateProfileByStripeCustomerId(
          inv.customer as string,
          {
            subscriptionStatus: 'active',
            subscriptionProvider: 'stripe',
            ...(periodEnd ? { subscriptionEndDate: periodEnd } : {}),
          },
          (profile) => !profile.isFoundingMember,
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object as Stripe.Subscription;

        // Only deactivate if Stripe is currently the active provider. If the
        // user has a live RevenueCat entitlement the provider will be 'revenuecat'
        // and Stripe expiry must not override it.
        await updateProfileByStripeCustomerId(
          sub.customer as string,
          { subscriptionStatus: 'inactive', subscriptionProvider: 'stripe' },
          (profile) => !profile.isFoundingMember && profile.subscriptionProvider !== 'revenuecat',
        );
        break;
      }
    }
  } catch (err) {
    console.error('[stripeWebhook] Processing error:', err);
    // Return 200 to prevent Stripe from retrying non-recoverable errors
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function updateProfileByOwner(
  ownerSub: string,
  updates: Record<string, unknown>
) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: USER_PROFILE_TABLE,
      IndexName: 'byOwner',
      KeyConditionExpression: '#owner = :owner',
      ExpressionAttributeNames: { '#owner': 'owner' },
      ExpressionAttributeValues: { ':owner': ownerSub },
      Limit: 1,
    })
  );

  const profile = result.Items?.[0];
  if (!profile) return;

  await applyUpdates(profile.id, updates);
}

async function updateProfileByStripeCustomerId(
  customerId: string,
  updates: Record<string, unknown>,
  guard: (profile: Record<string, unknown>) => boolean,
) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: USER_PROFILE_TABLE,
      IndexName: 'stripeCustomerId-index',
      KeyConditionExpression: 'stripeCustomerId = :cid',
      ExpressionAttributeValues: { ':cid': customerId },
      Limit: 1,
    })
  );

  const profile = result.Items?.[0];
  if (!profile) return;
  if (!guard(profile)) return;

  await applyUpdates(profile.id, updates);
}

async function applyUpdates(id: string, updates: Record<string, unknown>) {
  const setExpressions: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  let i = 0;
  for (const [key, val] of Object.entries(updates)) {
    const nameKey = `#f${i}`;
    const valKey = `:v${i}`;
    setExpressions.push(`${nameKey} = ${valKey}`);
    names[nameKey] = key;
    values[valKey] = val;
    i++;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: USER_PROFILE_TABLE,
      Key: { id },
      UpdateExpression: `SET ${setExpressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}
