import { defineFunction } from '@aws-amplify/backend';

export const stripePortalFn = defineFunction({
  name: 'stripePortal',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
});
