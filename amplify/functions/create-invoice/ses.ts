import {
  SESClient,
  SendRawEmailCommand,
} from '@aws-sdk/client-ses';
import { env } from '../env';

const ses = new SESClient({ region: env.awsRegion });

interface InvoiceEmailInput {
  to: string;
  clientName: string;
  amount: number;
  dueDate: Date;
  publicId: string;
  pdfBuffer: Buffer;
  appUrl: string;
  businessName?: string | null;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-AU', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export async function sendInvoiceEmailSES(input: InvoiceEmailInput): Promise<void> {
  const fromEmail = env.sesFromEmail;
  const senderName = input.businessName?.trim() || 'Invoices & Expenses';
  const invoiceUrl = `${input.appUrl}/invoice/${input.publicId}`;
  const subject = `Invoice from ${senderName} - ${formatAmount(input.amount)}`;

  const htmlBody = `
<p>Hi ${input.clientName},</p>
<p>Your invoice is ready. A PDF copy is attached for your records.</p>
<p><strong>Amount due:</strong> ${formatAmount(input.amount)}</p>
<p><strong>Due date:</strong> ${formatDate(input.dueDate)}</p>
<p>
  <a href="${invoiceUrl}" style="display:inline-block;padding:12px 20px;background-color:#2563eb;color:#ffffff;font-weight:bold;text-decoration:none;border-radius:8px;">
    View invoice online
  </a>
</p>
<p>If you have any questions, just reply to this email.</p>
  `.trim();

  const boundary = `invoice-${Date.now()}`;
  const filename = `invoice-${input.publicId}.pdf`;

  const rawEmail = [
    `From: ${senderName} <${fromEmail}>`,
    `To: ${input.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody, 'utf-8').toString('base64'),
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    input.pdfBuffer.toString('base64'),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  await ses.send(
    new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rawEmail, 'utf-8') },
    })
  );
}
