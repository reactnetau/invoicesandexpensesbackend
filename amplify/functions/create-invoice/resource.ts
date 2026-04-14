import { defineFunction } from '@aws-amplify/backend';

export const createInvoiceFn = defineFunction({
  name: 'createInvoice',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
