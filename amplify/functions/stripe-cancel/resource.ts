import { defineFunction } from '@aws-amplify/backend';

export const stripeCancelFn = defineFunction({
  name: 'stripeCancel',
  entry: './handler.ts',
  timeoutSeconds: 15,
});
