const DEFAULT_APP_URL = 'https://invoicesandexpenses.com';
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

export const env = {
  get anthropicApiKey() {
    return optionalEnv('ANTHROPIC_API_KEY');
  },
  get appUrl() {
    return process.env.APP_URL ?? DEFAULT_APP_URL;
  },
  get awsRegion() {
    return process.env.AWS_REGION;
  },
  get encryptionKey() {
    return requiredEnv('ENCRYPTION_KEY');
  },
  get expenseTableName() {
    return requiredEnv('EXPENSE_TABLE_NAME');
  },
  get foundingMembers() {
    return optionalEnv('FOUNDING_MEMBERS') ?? 'false';
  },
  get invoiceTableName() {
    return requiredEnv('INVOICE_TABLE_NAME');
  },
  get sesFromEmail() {
    return requiredEnv('SES_FROM_EMAIL');
  },
  get stripePriceId() {
    return optionalEnv('STRIPE_PRICE_ID');
  },
  get stripeSecretKey() {
    return optionalEnv('STRIPE_SECRET_KEY');
  },
  get stripeWebhookSecret() {
    return optionalEnv('STRIPE_WEBHOOK_SECRET');
  },
  get userProfileTableName() {
    return requiredEnv('USER_PROFILE_TABLE_NAME');
  },
};
