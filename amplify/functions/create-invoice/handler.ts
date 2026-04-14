import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { generateInvoicePdf } from './pdf';
import { sendInvoiceEmailSES } from './ses';
import { decrypt } from './crypto';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;
const INVOICE_TABLE = env.invoiceTableName;
const FREE_INVOICE_LIMIT = 5;

interface Args {
  clientId?: string;
  clientName: string;
  clientEmail?: string;
  amount: number;
  dueDate: string;
  sendEmail?: boolean;
  includeBusinessName?: boolean;
  includeFullName?: boolean;
  includePhone?: boolean;
  includeAddress?: boolean;
  includeAbn?: boolean;
  includePayid?: boolean;
}

interface Result {
  id: string | null;
  publicId: string | null;
  emailSent: boolean | null;
  emailError: string | null;
  error: string | null;
  errorCode: string | null;
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { id: null, publicId: null, emailSent: null, emailError: null, error: 'Unauthorized', errorCode: 'unauthorized' };

  const {
    clientId,
    clientName,
    clientEmail,
    amount,
    dueDate,
    sendEmail = false,
    includeBusinessName = false,
    includeFullName = false,
    includePhone = false,
    includeAddress = false,
    includeAbn = false,
    includePayid = false,
  } = event.arguments;

  if (!clientName || !amount || !dueDate) {
    return { id: null, publicId: null, emailSent: null, emailError: null, error: 'clientName, amount, and dueDate are required', errorCode: 'validation' };
  }

  if (sendEmail && !clientEmail) {
    return { id: null, publicId: null, emailSent: null, emailError: null, error: 'Client does not have an email address', errorCode: 'no_email' };
  }

  // Fetch user profile
  const profileResult = await ddb.send(
    new QueryCommand({
      TableName: USER_PROFILE_TABLE,
      IndexName: 'byOwner',
      KeyConditionExpression: '#owner = :owner',
      ExpressionAttributeNames: { '#owner': 'owner' },
      ExpressionAttributeValues: { ':owner': sub },
      Limit: 1,
    })
  );

  const profile = profileResult.Items?.[0];
  if (!profile) {
    return { id: null, publicId: null, emailSent: null, emailError: null, error: 'User profile not found', errorCode: 'no_profile' };
  }

  const isPro = profile.subscriptionStatus === 'active';

  // Enforce free-tier monthly invoice limit
  if (!isPro) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyCount = await ddb.send(
      new QueryCommand({
        TableName: INVOICE_TABLE,
        IndexName: 'byOwner',
        KeyConditionExpression: '#owner = :owner',
        FilterExpression: '#createdAt >= :startOfMonth',
        ExpressionAttributeNames: { '#owner': 'owner', '#createdAt': 'createdAt' },
        ExpressionAttributeValues: {
          ':owner': sub,
          ':startOfMonth': startOfMonth.toISOString(),
        },
        Select: 'COUNT',
      })
    );

    if ((monthlyCount.Count ?? 0) >= FREE_INVOICE_LIMIT) {
      return {
        id: null,
        publicId: null,
        emailSent: null,
        emailError: null,
        error: `Free plan is limited to ${FREE_INVOICE_LIMIT} invoices per month. Upgrade to Pro for unlimited invoices.`,
        errorCode: 'limit_reached',
      };
    }
  }

  // Create invoice
  const id = randomUUID();
  const publicId = randomUUID();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: INVOICE_TABLE,
      Item: {
        id,
        owner: sub,
        clientId: clientId ?? null,
        clientName,
        clientEmail: clientEmail ?? null,
        amount,
        status: 'unpaid',
        dueDate: new Date(dueDate).toISOString(),
        paidAt: null,
        publicId,
        isPublic: true,
        createdAt: now,
        updatedAt: now,
        __typename: 'Invoice',
      },
    })
  );

  let emailSent = false;
  let emailError: string | null = null;

  if (sendEmail && clientEmail) {
    try {
      let payid: string | null = null;
      if (includePayid && profile.payidEncrypted) {
        try {
          payid = decrypt(profile.payidEncrypted);
        } catch {
          payid = null;
        }
      }

      const appUrl = env.appUrl;
      const pdfBuffer = await generateInvoicePdf({
        clientName,
        clientEmail: clientEmail ?? null,
        amount,
        dueDate: new Date(dueDate),
        publicId,
        status: 'unpaid',
        appUrl,
        payid,
        businessName: includeBusinessName ? (profile.businessName ?? null) : null,
        fullName: includeFullName ? (profile.fullName ?? null) : null,
        phone: includePhone ? (profile.phone ?? null) : null,
        address: includeAddress ? (profile.address ?? null) : null,
        abn: includeAbn ? (profile.abn ?? null) : null,
      });

      await sendInvoiceEmailSES({
        to: clientEmail,
        clientName,
        amount,
        dueDate: new Date(dueDate),
        publicId,
        pdfBuffer,
        appUrl,
        businessName: profile.businessName ?? null,
      });

      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Unknown email error';
      console.error('[createInvoice] Email failed:', emailError);
    }
  }

  return { id, publicId, emailSent, emailError, error: null, errorCode: null };
};
