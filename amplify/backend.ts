import { defineBackend, secret } from '@aws-amplify/backend';
import { CfnOutput } from 'aws-cdk-lib';
import { CfnUserPool } from 'aws-cdk-lib/aws-cognito';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

import { auth } from './auth/resource';
import { data } from './data/resource';
import { createUserProfileFn } from './functions/create-user-profile/resource';
import { createInvoiceFn } from './functions/create-invoice/resource';
import { stripeCheckoutFn } from './functions/stripe-checkout/resource';
import { stripePortalFn } from './functions/stripe-portal/resource';
import { stripeCancelFn } from './functions/stripe-cancel/resource';
import { stripeWebhookFn } from './functions/stripe-webhook/resource';
import { invoiceEmailFn } from './functions/invoice-email/resource';
import { csvExportFn } from './functions/csv-export/resource';
import { aiSummaryFn } from './functions/ai-summary/resource';
import { publicInvoiceFn } from './functions/public-invoice/resource';
import { payidFn } from './functions/payid/resource';

const backend = defineBackend({
  auth,
  data,
  createUserProfileFn,
  createInvoiceFn,
  stripeCheckoutFn,
  stripePortalFn,
  stripeCancelFn,
  stripeWebhookFn,
  invoiceEmailFn,
  csvExportFn,
  aiSummaryFn,
  publicInvoiceFn,
  payidFn,
});

const userPool = backend.auth.resources.userPool.node.defaultChild as CfnUserPool;
userPool.addPropertyOverride('Policies.PasswordPolicy.MinimumLength', 8);
userPool.addPropertyOverride('Policies.PasswordPolicy.RequireLowercase', false);
userPool.addPropertyOverride('Policies.PasswordPolicy.RequireUppercase', false);
userPool.addPropertyOverride('Policies.PasswordPolicy.RequireNumbers', false);
userPool.addPropertyOverride('Policies.PasswordPolicy.RequireSymbols', false);

backend.auth.resources.cfnResources.cfnUserPoolClient.explicitAuthFlows = [
  'ALLOW_USER_AUTH',
  'ALLOW_USER_SRP_AUTH',
  'ALLOW_USER_PASSWORD_AUTH',
  'ALLOW_REFRESH_TOKEN_AUTH',
];

// ── Stripe Webhook HTTP endpoint ─────────────────────────────────────────────
// Stripe needs a plain HTTP POST endpoint — we expose the Lambda via API Gateway.
const webhookStack = backend.createStack('StripeWebhookStack');

const webhookApi = new HttpApi(webhookStack, 'StripeWebhookApi', {
  apiName: 'invoices-stripe-webhook',
  description: 'Stripe webhook receiver for Invoices & Expenses',
  corsPreflight: {
    allowOrigins: ['https://api.stripe.com'],
    allowMethods: [CorsHttpMethod.POST],
  },
});

const webhookIntegration = new HttpLambdaIntegration(
  'StripeWebhookIntegration',
  backend.stripeWebhookFn.resources.lambda
);

webhookApi.addRoutes({
  path: '/webhook/stripe',
  methods: [HttpMethod.POST],
  integration: webhookIntegration,
});

// Expose the webhook URL as a stack output so it can be added to Stripe dashboard
new CfnOutput(webhookStack, 'StripeWebhookUrl', {
  value: `${webhookApi.apiEndpoint}/webhook/stripe`,
  description:
    'Add this URL to your Stripe Dashboard > Webhooks > Add Endpoint. ' +
    'Events to subscribe: checkout.session.completed, invoice.paid, customer.subscription.deleted',
});

// ── Function environment variables ───────────────────────────────────────────
const appUrl = process.env.APP_URL ?? 'https://invoicesandexpenses.com';
const tables = backend.data.resources.tables;

const tableEnvironment = {
  USER_PROFILE_TABLE_NAME: tables.UserProfile.tableName,
  INVOICE_TABLE_NAME: tables.Invoice.tableName,
  EXPENSE_TABLE_NAME: tables.Expense.tableName,
};

const sharedEnvironment = {
  APP_URL: appUrl,
};

function grantIndexQueryAccess(
  lambda: { addToRolePolicy: (statement: PolicyStatement) => void },
  tableArns: string[]
) {
  lambda.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:Query'],
      resources: tableArns.map((tableArn) => `${tableArn}/index/*`),
    })
  );
}

// These functions use the DynamoDB SDK directly, so they need IAM table grants
// in addition to the AppSync resource authorization in amplify/data/resource.ts.
tables.UserProfile.grantReadWriteData(backend.createUserProfileFn.resources.lambda);
tables.UserProfile.grantReadData(backend.createInvoiceFn.resources.lambda);
tables.UserProfile.grantReadData(backend.stripeCheckoutFn.resources.lambda);
tables.UserProfile.grantReadData(backend.stripePortalFn.resources.lambda);
tables.UserProfile.grantReadData(backend.stripeCancelFn.resources.lambda);
tables.UserProfile.grantReadWriteData(backend.stripeWebhookFn.resources.lambda);
tables.UserProfile.grantReadData(backend.invoiceEmailFn.resources.lambda);
tables.UserProfile.grantReadData(backend.csvExportFn.resources.lambda);
tables.UserProfile.grantReadData(backend.aiSummaryFn.resources.lambda);
tables.UserProfile.grantReadData(backend.publicInvoiceFn.resources.lambda);
tables.UserProfile.grantReadWriteData(backend.payidFn.resources.lambda);

tables.Invoice.grantReadWriteData(backend.createInvoiceFn.resources.lambda);
tables.Invoice.grantReadData(backend.invoiceEmailFn.resources.lambda);
tables.Invoice.grantReadData(backend.csvExportFn.resources.lambda);
tables.Invoice.grantReadData(backend.aiSummaryFn.resources.lambda);
tables.Invoice.grantReadData(backend.publicInvoiceFn.resources.lambda);

tables.Expense.grantReadData(backend.csvExportFn.resources.lambda);
tables.Expense.grantReadData(backend.aiSummaryFn.resources.lambda);

grantIndexQueryAccess(backend.createUserProfileFn.resources.lambda, [tables.UserProfile.tableArn]);
grantIndexQueryAccess(backend.createInvoiceFn.resources.lambda, [
  tables.UserProfile.tableArn,
  tables.Invoice.tableArn,
]);
grantIndexQueryAccess(backend.stripeCheckoutFn.resources.lambda, [tables.UserProfile.tableArn]);
grantIndexQueryAccess(backend.stripePortalFn.resources.lambda, [tables.UserProfile.tableArn]);
grantIndexQueryAccess(backend.stripeCancelFn.resources.lambda, [tables.UserProfile.tableArn]);
grantIndexQueryAccess(backend.stripeWebhookFn.resources.lambda, [tables.UserProfile.tableArn]);
grantIndexQueryAccess(backend.invoiceEmailFn.resources.lambda, [
  tables.UserProfile.tableArn,
  tables.Invoice.tableArn,
]);
grantIndexQueryAccess(backend.csvExportFn.resources.lambda, [
  tables.UserProfile.tableArn,
  tables.Invoice.tableArn,
  tables.Expense.tableArn,
]);
grantIndexQueryAccess(backend.aiSummaryFn.resources.lambda, [
  tables.UserProfile.tableArn,
  tables.Invoice.tableArn,
  tables.Expense.tableArn,
]);
grantIndexQueryAccess(backend.publicInvoiceFn.resources.lambda, [
  tables.UserProfile.tableArn,
  tables.Invoice.tableArn,
]);
grantIndexQueryAccess(backend.payidFn.resources.lambda, [tables.UserProfile.tableArn]);

backend.createUserProfileFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.createUserProfileFn.addEnvironment('FOUNDING_MEMBERS', secret('FOUNDING_MEMBERS'));

backend.createInvoiceFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.createInvoiceFn.addEnvironment('INVOICE_TABLE_NAME', tableEnvironment.INVOICE_TABLE_NAME);
backend.createInvoiceFn.addEnvironment('APP_URL', sharedEnvironment.APP_URL);
backend.createInvoiceFn.addEnvironment('ENCRYPTION_KEY', secret('ENCRYPTION_KEY'));
backend.createInvoiceFn.addEnvironment('SES_FROM_EMAIL', secret('SES_FROM_EMAIL'));

backend.stripeCheckoutFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.stripeCheckoutFn.addEnvironment('APP_URL', sharedEnvironment.APP_URL);
backend.stripeCheckoutFn.addEnvironment('STRIPE_SECRET_KEY', secret('STRIPE_SECRET_KEY'));
backend.stripeCheckoutFn.addEnvironment('STRIPE_PRICE_ID', secret('STRIPE_PRICE_ID'));

backend.stripePortalFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.stripePortalFn.addEnvironment('APP_URL', sharedEnvironment.APP_URL);
backend.stripePortalFn.addEnvironment('STRIPE_SECRET_KEY', secret('STRIPE_SECRET_KEY'));

backend.stripeCancelFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.stripeCancelFn.addEnvironment('STRIPE_SECRET_KEY', secret('STRIPE_SECRET_KEY'));

backend.stripeWebhookFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.stripeWebhookFn.addEnvironment('STRIPE_SECRET_KEY', secret('STRIPE_SECRET_KEY'));
backend.stripeWebhookFn.addEnvironment('STRIPE_WEBHOOK_SECRET', secret('STRIPE_WEBHOOK_SECRET'));

backend.invoiceEmailFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.invoiceEmailFn.addEnvironment('INVOICE_TABLE_NAME', tableEnvironment.INVOICE_TABLE_NAME);
backend.invoiceEmailFn.addEnvironment('APP_URL', sharedEnvironment.APP_URL);
backend.invoiceEmailFn.addEnvironment('ENCRYPTION_KEY', secret('ENCRYPTION_KEY'));
backend.invoiceEmailFn.addEnvironment('SES_FROM_EMAIL', secret('SES_FROM_EMAIL'));

const sesSendPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['ses:SendRawEmail'],
  resources: ['*'],
});

backend.createInvoiceFn.resources.lambda.addToRolePolicy(sesSendPolicy);
backend.invoiceEmailFn.resources.lambda.addToRolePolicy(sesSendPolicy);

backend.csvExportFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.csvExportFn.addEnvironment('INVOICE_TABLE_NAME', tableEnvironment.INVOICE_TABLE_NAME);
backend.csvExportFn.addEnvironment('EXPENSE_TABLE_NAME', tableEnvironment.EXPENSE_TABLE_NAME);

backend.aiSummaryFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.aiSummaryFn.addEnvironment('INVOICE_TABLE_NAME', tableEnvironment.INVOICE_TABLE_NAME);
backend.aiSummaryFn.addEnvironment('EXPENSE_TABLE_NAME', tableEnvironment.EXPENSE_TABLE_NAME);
backend.aiSummaryFn.addEnvironment('ANTHROPIC_API_KEY', secret('ANTHROPIC_API_KEY'));

backend.publicInvoiceFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.publicInvoiceFn.addEnvironment('INVOICE_TABLE_NAME', tableEnvironment.INVOICE_TABLE_NAME);

backend.payidFn.addEnvironment('USER_PROFILE_TABLE_NAME', tableEnvironment.USER_PROFILE_TABLE_NAME);
backend.payidFn.addEnvironment('ENCRYPTION_KEY', secret('ENCRYPTION_KEY'));

export { backend };
