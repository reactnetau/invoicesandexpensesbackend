import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { generateInvoicePdf } from '../create-invoice/pdf';
import { sendInvoiceEmailSES } from '../create-invoice/ses';
import { decrypt } from '../create-invoice/crypto';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;
const INVOICE_TABLE = env.invoiceTableName;

interface Args {
  invoiceId: string;
  includeBusinessName?: boolean;
  includeFullName?: boolean;
  includePhone?: boolean;
  includeAddress?: boolean;
  includeAbn?: boolean;
  includePayid?: boolean;
}

interface Result {
  ok: boolean;
  error: string | null;
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { ok: false, error: 'Unauthorized' };

  const {
    invoiceId,
    includeBusinessName = false,
    includeFullName = false,
    includePhone = false,
    includeAddress = false,
    includeAbn = false,
    includePayid = false,
  } = event.arguments;

  // Fetch invoice and verify ownership
  const invoiceResult = await ddb.send(
    new GetCommand({ TableName: INVOICE_TABLE, Key: { id: invoiceId } })
  );
  const invoice = invoiceResult.Item;
  if (!invoice) return { ok: false, error: 'Invoice not found' };
  if (invoice.owner !== sub) return { ok: false, error: 'Forbidden' };
  if (!invoice.clientEmail) return { ok: false, error: 'Invoice has no client email address' };

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
  if (!profile) return { ok: false, error: 'User profile not found' };

  let payid: string | null = null;
  if (includePayid && profile.payidEncrypted) {
    try { payid = decrypt(profile.payidEncrypted); } catch { payid = null; }
  }

  const appUrl = env.appUrl;

  try {
    const pdfBuffer = await generateInvoicePdf({
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail,
      amount: invoice.amount,
      dueDate: new Date(invoice.dueDate),
      publicId: invoice.publicId,
      status: invoice.status,
      appUrl,
      currency: profile.currency ?? 'AUD',
      payid,
      businessName: includeBusinessName ? (profile.businessName ?? null) : null,
      fullName: includeFullName ? (profile.fullName ?? null) : null,
      phone: includePhone ? (profile.phone ?? null) : null,
      address: includeAddress ? (profile.address ?? null) : null,
      abn: includeAbn ? (profile.abn ?? null) : null,
    });

    await sendInvoiceEmailSES({
      to: invoice.clientEmail,
      clientName: invoice.clientName,
      amount: invoice.amount,
      dueDate: new Date(invoice.dueDate),
      publicId: invoice.publicId,
      pdfBuffer,
      appUrl,
      currency: profile.currency ?? 'AUD',
      businessName: profile.businessName ?? null,
    });

    return { ok: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[invoiceEmail]', {
      error: msg,
      name: err instanceof Error ? err.name : undefined,
      to: invoice.clientEmail,
      from: env.sesFromEmail,
      region: env.awsRegion,
    });
    return { ok: false, error: msg };
  }
};
