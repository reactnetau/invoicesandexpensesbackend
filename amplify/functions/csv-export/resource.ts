import { defineFunction } from '@aws-amplify/backend';

export const csvExportFn = defineFunction({
  name: 'csvExport',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
