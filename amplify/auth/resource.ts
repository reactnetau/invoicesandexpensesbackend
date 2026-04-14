import { defineAuth } from '@aws-amplify/backend';

/**
 * Cognito User Pool replacing the custom JWT auth in the original Next.js app.
 * Password reset is now handled by Cognito natively — no PasswordReset model needed.
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'Verify your Invoices & Expenses account',
      verificationEmailBody: (createCode) =>
        `Your verification code is: ${createCode()}`,
    },
  },
  accountRecovery: 'EMAIL_ONLY',
  userAttributes: {
    email: { required: true, mutable: true },
  },
});
