import { defineFunction } from '@aws-amplify/backend';

export const publicInvoiceFn = defineFunction({
  name: 'publicInvoice',
  entry: './handler.ts',
  timeoutSeconds: 10,
});
