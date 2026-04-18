import type { AppSyncResolverHandler } from 'aws-lambda';
import Stripe from 'stripe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;

type Result = { url: string | null; error: string | null };
type Arguments = { returnUrl?: string | null };

function appPath(appUrl: string, path: string) {
  return `${appUrl}${path}`;
}

function resolveAppUrl(returnUrl: string | null | undefined) {
  if (!returnUrl) return env.appUrl;

  try {
    const fallback = new URL(env.appUrl);
    const requested = new URL(returnUrl);
    const hostname = requested.hostname.toLowerCase();
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const isAmplifyApp = hostname.endsWith('.amplifyapp.com');
    const isPrimaryDomain = hostname === 'invoicesandexpenses.com' || hostname.endsWith('.invoicesandexpenses.com');
    const matchesConfiguredApp = requested.origin === fallback.origin;
    const usesAllowedProtocol = requested.protocol === 'https:' || (isLocalhost && requested.protocol === 'http:');

    if (usesAllowedProtocol && (matchesConfiguredApp || isAmplifyApp || isPrimaryDomain || isLocalhost)) {
      return requested.origin;
    }
  } catch {
    // Fall back to the configured app URL if the client passed a malformed URL.
  }

  return env.appUrl;
}

export const handler: AppSyncResolverHandler<Arguments, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { url: null, error: 'Unauthorized' };

  const stripeKey = env.stripeSecretKey;
  const appUrl = resolveAppUrl(event.arguments.returnUrl);

  if (!stripeKey) return { url: null, error: 'Stripe not configured' };

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
  if (!profile?.stripeCustomerId) {
    return { url: null, error: 'No active subscription found' };
  }

  try {
    const stripe = new Stripe(stripeKey);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: appPath(appUrl, '/account'),
    });

    return { url: portalSession.url, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error';
    console.error('[stripePortal]', msg);
    return { url: null, error: msg };
  }
};
