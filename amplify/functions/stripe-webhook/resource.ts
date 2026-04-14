import { defineFunction } from '@aws-amplify/backend';

export const stripeWebhookFn = defineFunction({
  name: 'stripeWebhook',
  entry: './handler.ts',
  timeoutSeconds: 15,
});
