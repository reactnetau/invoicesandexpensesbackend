import type { AppSyncResolverHandler } from 'aws-lambda';
import Anthropic from '@anthropic-ai/sdk';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../env';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const USER_PROFILE_TABLE = env.userProfileTableName;
const INVOICE_TABLE = env.invoiceTableName;
const EXPENSE_TABLE = env.expenseTableName;

interface Args {
  fyStart?: number;
  question?: string;
  income?: number;
  expenses?: number;
  profit?: number;
  unpaidCount?: number;
  unpaidTotal?: number;
  currency?: string;
}

interface Result {
  answer?: string | null;
  summary: string | null;
  income: number | null;
  expenses: number | null;
  profit: number | null;
  unpaidCount: number | null;
  unpaidTotal: number | null;
  currency: string | null;
  error: string | null;
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const sub = (event.identity as any)?.sub as string | undefined;
  if (!sub) return nullResult('Unauthorized');
  const fieldName = event.info?.fieldName;

  const now = new Date();
  const currentFyStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStartYear = Number.isInteger(event.arguments.fyStart) ? event.arguments.fyStart! : currentFyStart;
  const question = typeof event.arguments.question === 'string'
    ? event.arguments.question.trim().slice(0, 500)
    : '';
  if (fieldName === 'askAi' && !question) {
    return { answer: null, summary: null, income: null, expenses: null, profit: null, unpaidCount: null, unpaidTotal: null, currency: null, error: 'Question is required' };
  }
  const startDate = new Date(fyStartYear, 6, 1);
  const endDate = new Date(fyStartYear + 1, 6, 1);
  const fyLabel = `FY ${fyStartYear}/${String(fyStartYear + 1).slice(-2)}`;

  // Fetch user profile for currency
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
  const currency = sanitizeCurrency(event.arguments.currency) ?? profile?.currency ?? 'USD';

  // Fetch all invoices and expenses in the financial year
  // SECURITY: We aggregate here — raw records are NEVER sent to the AI model
  const [invoicesResult, expensesResult] = await Promise.all([
    ddb.send(
      new QueryCommand({
        TableName: INVOICE_TABLE,
        IndexName: 'byOwner',
        KeyConditionExpression: '#owner = :owner',
        FilterExpression: '#createdAt >= :start AND #createdAt < :end',
        ExpressionAttributeNames: { '#owner': 'owner', '#createdAt': 'createdAt' },
        ExpressionAttributeValues: {
          ':owner': sub,
          ':start': startDate.toISOString(),
          ':end': endDate.toISOString(),
        },
      })
    ),
    ddb.send(
      new QueryCommand({
        TableName: EXPENSE_TABLE,
        IndexName: 'byOwner',
        KeyConditionExpression: '#owner = :owner',
        FilterExpression: '#date >= :start AND #date < :end',
        ExpressionAttributeNames: { '#owner': 'owner', '#date': 'date' },
        ExpressionAttributeValues: {
          ':owner': sub,
          ':start': startDate.toISOString(),
          ':end': endDate.toISOString(),
        },
      })
    ),
  ]);

  const invoices = invoicesResult.Items ?? [];
  const expenseItems = expensesResult.Items ?? [];

  // Compute aggregates only
  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const unpaidInvoices = invoices.filter((i) => i.status !== 'paid');

  const computedIncome = paidInvoices.reduce((s, i) => s + Number(i.amount), 0);
  const computedUnpaidTotal = unpaidInvoices.reduce((s, i) => s + Number(i.amount), 0);
  const computedExpenseTotal = expenseItems.reduce((s, e) => s + Number(e.amount), 0);
  const computedProfit = computedIncome - computedExpenseTotal;

  const income = safeNumber(event.arguments.income) ?? computedIncome;
  const expenseTotal = safeNumber(event.arguments.expenses) ?? computedExpenseTotal;
  const unpaidCount = safeInteger(event.arguments.unpaidCount) ?? unpaidInvoices.length;
  const unpaidTotal = safeNumber(event.arguments.unpaidTotal) ?? computedUnpaidTotal;
  const profit = safeNumber(event.arguments.profit) ?? income - expenseTotal;

  // Only aggregate metrics — no client names, amounts, or raw rows — are sent to AI
  const metrics = {
    financial_year: fyLabel,
    currency,
    income,
    expenses: expenseTotal,
    profit,
    unpaid_invoices: unpaidCount,
    unpaid_total: unpaidTotal,
  };

  const apiKey = env.anthropicApiKey;
  if (!apiKey) return { summary: null, income, expenses: expenseTotal, profit, unpaidCount, unpaidTotal, currency, error: 'AI not configured' };

  try {
    const client = new Anthropic({ apiKey });
    const userPrompt = fieldName === 'askAi'
      ? `You are answering a custom user question about aggregate financial metrics. Directly answer the user's question first, in 3 short sentences or fewer. Do not provide a generic summary unless the question asks for a summary. Do not claim access to individual invoices, clients, or expense rows. If the question cannot be answered from the aggregate metrics, say exactly what is missing. Always format monetary values using the currency code provided (${currency}) — do not use any other currency symbol.\n\nQuestion: ${JSON.stringify(question)}\nAggregate metrics: ${JSON.stringify(metrics)}`
      : `You are a helpful financial assistant. Summarise this financial year data in 2 short sentences. Be clear and concise. Always format monetary values using the currency code provided (${currency}) — do not use any other currency symbol.\n\n${JSON.stringify(metrics)}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: fieldName === 'askAi' ? 180 : 120,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const block = response.content[0];
    const summary = block.type === 'text' ? block.text.trim() : '';

    return {
      answer: fieldName === 'askAi' ? summary : null,
      summary: fieldName === 'askAi' ? null : summary,
      income,
      expenses: expenseTotal,
      profit,
      unpaidCount,
      unpaidTotal,
      currency,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[aiSummary]', msg);
    return {
      answer: null,
      summary: null,
      income,
      expenses: expenseTotal,
      profit,
      unpaidCount,
      unpaidTotal,
      currency,
      error: msg,
    };
  }
};

function nullResult(error: string): Result {
  return { answer: null, summary: null, income: null, expenses: null, profit: null, unpaidCount: null, unpaidTotal: null, currency: null, error };
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function safeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function sanitizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}
