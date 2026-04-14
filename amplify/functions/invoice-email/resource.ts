import { defineFunction } from '@aws-amplify/backend';

export const invoiceEmailFn = defineFunction({
  name: 'invoiceEmail',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
