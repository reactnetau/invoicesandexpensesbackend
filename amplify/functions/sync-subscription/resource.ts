import { defineFunction } from '@aws-amplify/backend';

export const syncSubscriptionFn = defineFunction({
  name: 'syncSubscription',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
});