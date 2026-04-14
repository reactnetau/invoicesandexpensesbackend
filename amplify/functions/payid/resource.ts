import { defineFunction } from '@aws-amplify/backend';

export const payidFn = defineFunction({
  name: 'payid',
  entry: './handler.ts',
  timeoutSeconds: 10,
});
