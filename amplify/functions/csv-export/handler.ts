import type { AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getFyDateRange, getFyLabel } from './financialYear';
import { env } from '../env';
import { csvCell } from '../security';

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

type Row = Record<string, any>;

function getOwnerCandidates(identity: any): string[] {
  const sub = identity?.sub as string | undefined;
  const username = (identity?.username ?? identity?.claims?.['cognito:username'] ?? identity?.claims?.username) as
    | string
    | undefined;

  return Array.from(
    new Set(
      [
        sub,
        username,
        sub && username ? `${sub}::${username}` : undefined,
        sub && username ? `${username}::${sub}` : undefined,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );
}

async function queryRowsForOwners({
  tableName,
  ownerCandidates,
  dateField,
  startIso,
  endIso,
}: {
  tableName: string;
  ownerCandidates: string[];
  dateField: string;
  startIso: string;
  endIso: string;
}): Promise<Row[]> {
  const rowsById = new Map<string, Row>();

  for (const owner of ownerCandidates) {
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const result = await ddb.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'byOwner',
          KeyConditionExpression: '#owner = :owner',
          FilterExpression: '#dateField >= :start AND #dateField < :end',
          ExpressionAttributeNames: { '#owner': 'owner', '#dateField': dateField },
          ExpressionAttributeValues: { ':owner': owner, ':start': startIso, ':end': endIso },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      for (const row of result.Items ?? []) {
        const key = String(row.id ?? `${owner}:${row.createdAt ?? ''}:${row.date ?? row.dueDate ?? ''}:${row.amount ?? ''}`);
        rowsById.set(key, row);
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastEvaluatedKey);
  }

  return [...rowsById.values()];
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const identity = event.identity as any;
  const sub = identity?.sub as string | undefined;
  if (!sub) return { content: null, error: 'Unauthorized' };
  const ownerCandidates = getOwnerCandidates(identity);

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
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  // Fetch invoices and expenses in parallel
  const [invoices, expenses] = await Promise.all([
    queryRowsForOwners({
      tableName: INVOICE_TABLE,
      ownerCandidates,
      dateField: 'createdAt',
      startIso,
      endIso,
    }),
    queryRowsForOwners({
      tableName: EXPENSE_TABLE,
      ownerCandidates,
      dateField: 'date',
      startIso,
      endIso,
    }),
  ]);

  const endInclusive = new Date(endDate.getTime() - 1);
  const lines: string[] = [];
  lines.push(label);
  lines.push(`Period,${startDate.toISOString().split('T')[0]} to ${endInclusive.toISOString().split('T')[0]}`);
  lines.push('');
  lines.push('INVOICES');
  lines.push('Client Name,Client Email,Amount,Status,Due Date,Paid At,Created At');
  for (const inv of invoices) {
    lines.push([
      csvCell(inv.clientName),
      csvCell(inv.clientEmail),
      String(inv.amount),
      csvCell(inv.status),
      csvCell(inv.dueDate?.split('T')[0]),
      inv.paidAt ? inv.paidAt.split('T')[0] : '',
      inv.createdAt?.split('T')[0] ?? '',
    ].join(','));
  }

  lines.push('');
  lines.push('EXPENSES');
  lines.push('Category,Amount,Date,Created At');
  for (const exp of expenses) {
    lines.push([
      csvCell(exp.category),
      String(exp.amount),
      csvCell(exp.date?.split('T')[0]),
      exp.createdAt?.split('T')[0] ?? '',
    ].join(','));
  }

  return { content: lines.join('\n'), error: null };
};
