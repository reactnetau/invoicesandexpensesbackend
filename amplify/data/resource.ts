import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

import { createUserProfileFn } from '../functions/create-user-profile/resource';
import { createInvoiceFn } from '../functions/create-invoice/resource';
import { syncSubscriptionFn } from '../functions/sync-subscription/resource';
import { stripeCheckoutFn } from '../functions/stripe-checkout/resource';
import { stripePortalFn } from '../functions/stripe-portal/resource';
import { stripeCancelFn } from '../functions/stripe-cancel/resource';
import { invoiceEmailFn } from '../functions/invoice-email/resource';
import { csvExportFn } from '../functions/csv-export/resource';
import { aiSummaryFn } from '../functions/ai-summary/resource';
import { publicInvoiceFn } from '../functions/public-invoice/resource';
import { payidFn } from '../functions/payid/resource';
import { foundingMembersFn } from '../functions/founding-members/resource';

const schema = a
  .schema({
    // ── Data models ─────────────────────────────────────────────────────────

    /**
     * UserProfile stores subscription state, business details, and encrypted PayID.
     * Cognito handles identity; this model extends it with app-specific data.
     * The `owner` field stores the Cognito user's sub so backend Lambdas and
     * client-side model access use the same identifier.
     */
    UserProfile: a
      .model({
        owner: a.string(),
        email: a.string().required(),
        stripeCustomerId: a.string(),
        revenueCatAppUserId: a.string(),
        subscriptionProvider: a.string(),
        subscriptionProductId: a.string(),
        subscriptionStatus: a.string().default('inactive'),
        subscriptionEndDate: a.datetime(),
        isFoundingMember: a.boolean().default(false),
        payidEncrypted: a.string(),
        currency: a.string().default('USD'),
        businessName: a.string(),
        fullName: a.string(),
        phone: a.string(),
        address: a.string(),
        abn: a.string(),
        companyLogoKey: a.string(),
      })
      .secondaryIndexes((index) => [
        index('stripeCustomerId').name('stripeCustomerId-index'),
        index('owner').name('byOwner'),
      ])
      .authorization((allow) => [
        allow.ownerDefinedIn('owner').identityClaim('sub'),
      ]),

    Client: a
      .model({
        name: a.string().required(),
        email: a.string(),
        phone: a.string(),
        company: a.string(),
        address: a.string(),
      })
      .authorization((allow) => [allow.owner()]),

    /**
     * Invoice model.
     * `publicId` has a secondary index so the publicInvoiceFn can look up by it
     * without requiring authentication.
     */
    Invoice: a
      .model({
        owner: a.string(),
        clientId: a.id(),
        clientName: a.string().required(),
        clientEmail: a.string(),
        amount: a.float().required(),
        status: a.string().default('unpaid'),
        dueDate: a.datetime().required(),
        paidAt: a.datetime(),
        publicId: a.string().required(),
        isPublic: a.boolean().default(true),
      })
      .secondaryIndexes((index) => [
        index('publicId').name('publicId-index'),
        index('owner').name('byOwner'),
      ])
      .authorization((allow) => [
        allow.owner(),
      ]),

    Expense: a
      .model({
        owner: a.string(),
        category: a.string().required(),
        amount: a.float().required(),
        date: a.datetime().required(),
      })
      .secondaryIndexes((index) => [index('owner').name('byOwner')])
      .authorization((allow) => [
        allow.owner(),
      ]),

    // ── Custom mutations / queries ──────────────────────────────────────────

    /**
     * Called immediately after Cognito sign-up to create the UserProfile record.
     * Checks founding member eligibility (first 50 users when FOUNDING_MEMBERS=true).
     */
    initializeUserProfile: a
      .mutation()
      .arguments({
        email: a.string().required(),
        currency: a.string(),
      })
      .returns(
        a.customType({
          id: a.string(),
          isFoundingMember: a.boolean(),
          subscriptionStatus: a.string(),
          error: a.string(),
        })
      )
      .handler(a.handler.function(createUserProfileFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Creates an invoice with monthly-limit enforcement for free-tier users.
     * Optionally generates a PDF and emails it to the client (via AWS SES).
     */
    issueInvoice: a
      .mutation()
      .arguments({
        clientId: a.string(),
        clientName: a.string().required(),
        clientEmail: a.string(),
        amount: a.float().required(),
        dueDate: a.string().required(),
        sendEmail: a.boolean(),
        includeBusinessName: a.boolean(),
        includeFullName: a.boolean(),
        includePhone: a.boolean(),
        includeAddress: a.boolean(),
        includeAbn: a.boolean(),
        includePayid: a.boolean(),
      })
      .returns(
        a.customType({
          id: a.string(),
          publicId: a.string(),
          emailSent: a.boolean(),
          emailError: a.string(),
          error: a.string(),
          errorCode: a.string(),
        })
      )
      .handler(a.handler.function(createInvoiceFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Syncs subscription state from RevenueCat into the user's profile so
     * backend-gated features (invoice limits, CSV export) remain in sync.
     */
    syncSubscriptionState: a
      .mutation()
      .arguments({
        appUserId: a.string(),
        entitlementIdentifier: a.string().required(),
        entitlementActive: a.boolean().required(),
        productIdentifier: a.string(),
        expirationDate: a.datetime(),
      })
      .returns(
        a.customType({
          ok: a.boolean(),
          subscriptionStatus: a.string(),
          subscriptionEndDate: a.datetime(),
          isFoundingMember: a.boolean(),
          error: a.string(),
        })
      )
      .handler(a.handler.function(syncSubscriptionFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Creates a Stripe Checkout session for the Pro subscription ($7/month).
     * Returns the hosted checkout URL.
     */
    stripeCreateCheckout: a
      .query()
      .arguments({
        returnUrl: a.string(),
      })
      .returns(a.customType({ url: a.string(), error: a.string() }))
      .handler(a.handler.function(stripeCheckoutFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Creates a Stripe Customer Portal session for subscription management.
     */
    stripeCreatePortal: a
      .query()
      .arguments({
        returnUrl: a.string(),
      })
      .returns(a.customType({ url: a.string(), error: a.string() }))
      .handler(a.handler.function(stripePortalFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Cancels the Stripe subscription at period end.
     * Founding members cannot cancel their subscription this way.
     */
    stripeCancelSubscription: a
      .mutation()
      .returns(a.customType({ ok: a.boolean(), error: a.string() }))
      .handler(a.handler.function(stripeCancelFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Generates an invoice PDF and emails it to the client via AWS SES.
     * Server-side only — preserves business details and encrypted PayID.
     */
    sendInvoiceEmail: a
      .mutation()
      .arguments({
        invoiceId: a.string().required(),
        includeBusinessName: a.boolean(),
        includeFullName: a.boolean(),
        includePhone: a.boolean(),
        includeAddress: a.boolean(),
        includeAbn: a.boolean(),
        includePayid: a.boolean(),
      })
      .returns(a.customType({ ok: a.boolean(), error: a.string() }))
      .handler(a.handler.function(invoiceEmailFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Generates a CSV export of invoices and expenses for the selected AU financial year.
     * Pro users only. Returns the CSV content as a string (client saves it as a file).
     */
    exportCsv: a
      .query()
      .arguments({ fyStart: a.integer() })
      .returns(a.customType({ content: a.string(), error: a.string() }))
      .handler(a.handler.function(csvExportFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Generates a Claude AI summary of the selected AU financial year.
     * Only aggregate metrics (totals, counts) are sent to Anthropic — never raw rows.
     */
    getAiSummary: a
      .query()
      .arguments({
        fyStart: a.integer(),
        income: a.float(),
        expenses: a.float(),
        profit: a.float(),
        unpaidCount: a.integer(),
        unpaidTotal: a.float(),
        currency: a.string(),
      })
      .returns(
        a.customType({
          summary: a.string(),
          income: a.float(),
          expenses: a.float(),
          profit: a.float(),
          unpaidCount: a.integer(),
          unpaidTotal: a.float(),
          currency: a.string(),
          error: a.string(),
        })
      )
      .handler(a.handler.function(aiSummaryFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Answers a custom question about aggregate financial year metrics.
     * Only aggregate metrics (totals, counts) are sent to Anthropic — never raw rows.
     */
    askAi: a
      .query()
      .arguments({
        fyStart: a.integer(),
        question: a.string().required(),
        income: a.float(),
        expenses: a.float(),
        profit: a.float(),
        unpaidCount: a.integer(),
        unpaidTotal: a.float(),
        currency: a.string(),
      })
      .returns(a.customType({ answer: a.string(), error: a.string() }))
      .handler(a.handler.function(aiSummaryFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Returns decrypted PayID for the authenticated user.
     * Decryption happens server-side; the raw key never reaches the client.
     */
    getDecryptedPayid: a
      .query()
      .returns(a.customType({ payid: a.string() }))
      .handler(a.handler.function(payidFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Encrypts and stores a new PayID for the authenticated user.
     */
    updateEncryptedPayid: a
      .mutation()
      .arguments({ payid: a.string().required() })
      .returns(a.customType({ ok: a.boolean(), error: a.string() }))
      .handler(a.handler.function(payidFn))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Returns public invoice data by publicId. No authentication required.
     * Only returns data when `isPublic === true`.
     */
    getPublicInvoice: a
      .query()
      .arguments({ publicId: a.string().required() })
      .returns(
        a.customType({
          clientName: a.string(),
          amount: a.float(),
          status: a.string(),
          dueDate: a.string(),
          publicId: a.string(),
          businessName: a.string(),
          payid: a.string(),
          found: a.boolean(),
        })
      )
      .handler(a.handler.function(publicInvoiceFn))
      .authorization((allow) => [allow.publicApiKey()]),

    /**
     * Returns the public founding member availability count for the homepage.
     */
    getFoundingMemberStatus: a
      .query()
      .returns(
        a.customType({
          enabled: a.boolean(),
          claimed: a.integer(),
          limit: a.integer(),
          available: a.integer(),
          error: a.string(),
        })
      )
      .handler(a.handler.function(foundingMembersFn))
      .authorization((allow) => [allow.publicApiKey()]),
  })
  // Grant function resources access to data models they need
  .authorization((allow) => [
    allow.resource(createUserProfileFn),
    allow.resource(createInvoiceFn),
    allow.resource(syncSubscriptionFn),
    allow.resource(stripeCheckoutFn),
    allow.resource(stripePortalFn),
    allow.resource(stripeCancelFn),
    allow.resource(invoiceEmailFn),
    allow.resource(csvExportFn),
    allow.resource(aiSummaryFn),
    allow.resource(publicInvoiceFn),
    allow.resource(payidFn),
    allow.resource(foundingMembersFn),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    // API key required for unauthenticated getPublicInvoice queries
    apiKeyAuthorizationMode: { expiresInDays: 30 },
  },
});
