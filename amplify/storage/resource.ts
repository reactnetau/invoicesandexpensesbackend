import { defineStorage } from '@aws-amplify/backend';

/**
 * Secure per-user storage for company logo images.
 * Each user can read, write, and delete only their own objects under
 * `logos/{identityId}/...`.  Nothing is publicly accessible.
 */
export const storage = defineStorage({
  name: 'invoiceLogos',
  access: (allow) => ({
    'logos/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});
