import { defineFunction } from '@aws-amplify/backend';

export const createUserProfileFn = defineFunction({
  name: 'createUserProfile',
  entry: './handler.ts',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
});
