import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;

interface Args {
  appUserId?: string | null;
  entitlementIdentifier: string;
  entitlementActive: boolean;
  productIdentifier?: string | null;
  expirationDate?: string | null;
}

interface Result {
  ok: boolean;
  subscriptionStatus: string | null;
  subscriptionEndDate: string | null;
  isFoundingMember: boolean | null;
  error: string | null;
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) {
    return {
      ok: false,
      subscriptionStatus: null,
      subscriptionEndDate: null,
      isFoundingMember: null,
      error: 'Unauthorized',
    };
  }

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
  if (!profile?.id) {
    return {
      ok: false,
      subscriptionStatus: null,
      subscriptionEndDate: null,
      isFoundingMember: null,
      error: 'Profile not found',
    };
  }

  const isFoundingMember = profile.isFoundingMember === true;
  const hasActiveRevenueCatEntitlement = event.arguments.entitlementActive === true;
  const hasActiveStripeSubscription =
    !isFoundingMember &&
    !hasActiveRevenueCatEntitlement &&
    profile.subscriptionStatus === 'active' &&
    profile.subscriptionProvider !== 'revenuecat' &&
    !!profile.stripeCustomerId;

  if (hasActiveStripeSubscription) {
    await ddb.send(
      new UpdateCommand({
        TableName: USER_PROFILE_TABLE,
        Key: { id: profile.id },
        UpdateExpression: 'SET revenueCatAppUserId = :revenueCatAppUserId, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':revenueCatAppUserId': event.arguments.appUserId ?? sub,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    return {
      ok: true,
      subscriptionStatus: 'active',
      subscriptionEndDate: profile.subscriptionEndDate ?? null,
      isFoundingMember,
      error: null,
    };
  }

  const subscriptionStatus = isFoundingMember || hasActiveRevenueCatEntitlement ? 'active' : 'inactive';
  const subscriptionEndDate = hasActiveRevenueCatEntitlement
    ? event.arguments.expirationDate ?? null
    : null;
  const subscriptionProvider = isFoundingMember && !hasActiveRevenueCatEntitlement
    ? 'founding_member'
    : 'revenuecat';

  await ddb.send(
    new UpdateCommand({
      TableName: USER_PROFILE_TABLE,
      Key: { id: profile.id },
      UpdateExpression: [
        'SET subscriptionStatus = :subscriptionStatus',
        'subscriptionEndDate = :subscriptionEndDate',
        'subscriptionProvider = :subscriptionProvider',
        'subscriptionProductId = :subscriptionProductId',
        'revenueCatAppUserId = :revenueCatAppUserId',
        'updatedAt = :updatedAt',
      ].join(', '),
      ExpressionAttributeValues: {
        ':subscriptionStatus': subscriptionStatus,
        ':subscriptionEndDate': subscriptionEndDate,
        ':subscriptionProvider': subscriptionProvider,
        ':subscriptionProductId': event.arguments.productIdentifier ?? null,
        ':revenueCatAppUserId': event.arguments.appUserId ?? sub,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );

  return {
    ok: true,
    subscriptionStatus,
    subscriptionEndDate,
    isFoundingMember,
    error: null,
  };
};
