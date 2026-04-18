import { defineFunction } from '@aws-amplify/backend';

export const foundingMembersFn = defineFunction({
  name: 'foundingMembers',
  entry: './handler.ts',
  resourceGroupName: 'data',
});
