import { defineFunction } from '@aws-amplify/backend';

export const createUserProfileFn = defineFunction({
  name: 'createUserProfile',
  entry: './handler.ts',
  timeoutSeconds: 15,
});
