import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getFyDateRange, getFyLabel } from './financialYear';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;
const INVOICE_TABLE = env.invoiceTableName;
const EXPENSE_TABLE = env.expenseTableName;

interface Args {
  fyStart?: number;
}

interface Result {
  content: string | null;
  error: string | null;
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return { content: null, error: 'Unauthorized' };

  // Check Pro subscription
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
  if (!profile) return { content: null, error: 'User profile not found' };

  if (profile.subscriptionStatus !== 'active') {
    return { content: null, error: 'pro_required' };
  }

  const now = new Date();
  const currentFyStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStartYear = Number.isInteger(event.arguments.fyStart) ? event.arguments.fyStart! : currentFyStart;
  const { startDate, endDate } = getFyDateRange(fyStartYear);
  const label = getFyLabel(fyStartYear);

  // Fetch invoices and expenses in parallel
  const [invoicesResult, expensesResult] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: INVOICE_TABLE,
        IndexName: 'byOwner',
        KeyConditionExpression: '#owner = :owner',
        FilterExpression: '#createdAt >= :start AND #createdAt < :end',
        ExpressionAttributeNames: { '#owner': 'owner', '#createdAt': 'createdAt' },
        ExpressionAttributeValues: { ':owner': sub, ':start': startDate.toISOString(), ':end': endDate.toISOString() },
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: EXPENSE_TABLE,
        IndexName: 'byOwner',
        KeyConditionExpression: '#owner = :owner',
        FilterExpression: '#date >= :start AND #date < :end',
        ExpressionAttributeNames: { '#owner': 'owner', '#date': 'date' },
        ExpressionAttributeValues: { ':owner': sub, ':start': startDate.toISOString(), ':end': endDate.toISOString() },
      })
    ),
  ]);

  const invoices = invoicesResult.Items ?? [];
  const expenses = expensesResult.Items ?? [];

  const endInclusive = new Date(endDate.getTime() - 1);
  const lines: string[] = [];
  lines.push(label);
  lines.push(`Period,${startDate.toISOString().split('T')[0]} to ${endInclusive.toISOString().split('T')[0]}`);
  lines.push('');
  lines.push('INVOICES');
  lines.push('Client Name,Client Email,Amount,Status,Due Date,Paid At,Created At');
  for (const inv of invoices) {
    lines.push([
      `"${inv.clientName}"`,
      `"${inv.clientEmail ?? ''}"`,
      String(inv.amount),
      inv.status,
      inv.dueDate?.split('T')[0] ?? '',
      inv.paidAt ? inv.paidAt.split('T')[0] : '',
      inv.createdAt?.split('T')[0] ?? '',
    ].join(','));
  }

  lines.push('');
  lines.push('EXPENSES');
  lines.push('Category,Amount,Date,Created At');
  for (const exp of expenses) {
    lines.push([
      `"${exp.category}"`,
      String(exp.amount),
      exp.date?.split('T')[0] ?? '',
      exp.createdAt?.split('T')[0] ?? '',
    ].join(','));
  }

  return { content: lines.join('\n'), error: null };
};
