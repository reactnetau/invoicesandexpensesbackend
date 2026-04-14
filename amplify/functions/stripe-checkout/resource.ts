import { defineFunction } from '@aws-amplify/backend';

export const stripeCheckoutFn = defineFunction({
  name: 'stripeCheckout',
  entry: './handler.ts',
  timeoutSeconds: 15,
});
