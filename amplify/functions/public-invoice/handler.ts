import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const INVOICE_TABLE = env.invoiceTableName;
const USER_PROFILE_TABLE = env.userProfileTableName;

interface Args {
  publicId: string;
}

interface Result {
  clientName: string | null;
  clientEmail: string | null;
  amount: number | null;
  status: string | null;
  dueDate: string | null;
  publicId: string | null;
  businessName: string | null;
  payid: string | null;
  found: boolean;
}

/**
 * Unauthenticated public invoice lookup.
 * Secured via publicApiKey authorization in the schema.
 * Only returns data when isPublic === true.
 * PayID is NOT returned from this endpoint — it's only in the PDF.
 */
export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const { publicId } = event.arguments;
  if (!publicId) return notFound();

  // Look up invoice by publicId GSI
  const result = await ddb.send(
    new QueryCommand({
      TableName: INVOICE_TABLE,
      IndexName: 'publicId-index',
      KeyConditionExpression: 'publicId = :pid',
      ExpressionAttributeValues: { ':pid': publicId },
      Limit: 1,
    })
  );

  const invoice = result.Items?.[0];
  if (!invoice || !invoice.isPublic) return notFound();

  // Fetch business name from owner's profile
  let businessName: string | null = null;
  try {
    const profileResult = await ddb.send(
      new QueryCommand({
        TableName: USER_PROFILE_TABLE,
        IndexName: 'byOwner',
        KeyConditionExpression: '#owner = :owner',
        ExpressionAttributeNames: { '#owner': 'owner' },
        ExpressionAttributeValues: { ':owner': invoice.owner },
        Limit: 1,
        ProjectionExpression: 'businessName',
      })
    );
    businessName = profileResult.Items?.[0]?.businessName ?? null;
  } catch {
    // Non-fatal — just show the invoice without business name
  }

  return {
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail ?? null,
    amount: invoice.amount,
    status: invoice.status,
    dueDate: invoice.dueDate,
    publicId: invoice.publicId,
    businessName,
    payid: null, // PayID is only included in the PDF, never the public API
    found: true,
  };
};

function notFound(): Result {
  return {
    clientName: null,
    clientEmail: null,
    amount: null,
    status: null,
    dueDate: null,
    publicId: null,
    businessName: null,
    payid: null,
    found: false,
  };
}
