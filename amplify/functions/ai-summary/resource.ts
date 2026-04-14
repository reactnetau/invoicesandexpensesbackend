import { defineFunction } from '@aws-amplify/backend';

export const aiSummaryFn = defineFunction({
  name: 'aiSummary',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
