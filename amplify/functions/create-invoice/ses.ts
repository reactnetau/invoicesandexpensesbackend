import {
  SESClient,
  SendRawEmailCommand,
} from '@aws-sdk/client-ses';
import { env } from '../env';
import { escapeHtml, normalizeEmailAddress, sanitizeHeaderValue } from '../security';

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

function encodeBase64Lines(value: string | Buffer): string {
  const base64 = Buffer.isBuffer(value)
    ? value.toString('base64')
    : Buffer.from(value, 'utf-8').toString('base64');

  return base64.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

export async function sendInvoiceEmailSES(input: InvoiceEmailInput): Promise<void> {
  const fromEmail = normalizeEmailAddress(env.sesFromEmail);
  const toEmail = normalizeEmailAddress(input.to);
  const senderName = sanitizeHeaderValue(input.businessName, 'Invoices & Expenses');
  const invoiceUrl = `${input.appUrl}/invoice/${input.publicId}`;
  const subject = sanitizeHeaderValue(`Invoice from ${senderName} - ${formatAmount(input.amount)}`);
  const safeClientName = escapeHtml(input.clientName);
  const safeInvoiceUrl = escapeHtml(invoiceUrl);
  const safeAmount = escapeHtml(formatAmount(input.amount));
  const safeDueDate = escapeHtml(formatDate(input.dueDate));
  const textBody = [
    `Hi ${input.clientName},`,
    '',
    'Your invoice is ready. A PDF copy is attached for your records.',
    `Amount due: ${formatAmount(input.amount)}`,
    `Due date: ${formatDate(input.dueDate)}`,
    `View invoice online: ${invoiceUrl}`,
    '',
    'If you have any questions, just reply to this email.',
  ].join('\n');

  const htmlBody = `
<p>Hi ${safeClientName},</p>
<p>Your invoice is ready. A PDF copy is attached for your records.</p>
<p><strong>Amount due:</strong> ${safeAmount}</p>
<p><strong>Due date:</strong> ${safeDueDate}</p>
<p>
  <a href="${safeInvoiceUrl}" style="display:inline-block;padding:12px 20px;background-color:#2563eb;color:#ffffff;font-weight:bold;text-decoration:none;border-radius:8px;">
    View invoice online
  </a>
</p>
<p>If you have any questions, just reply to this email.</p>
  `.trim();

  const boundary = `invoice-${Date.now()}`;
  const alternativeBoundary = `${boundary}-alt`;
  const filename = `invoice-${input.publicId}.pdf`;

  const rawEmail = [
    `From: "${senderName.replace(/["\\]/g, '')}" <${fromEmail}>`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Lines(textBody),
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Lines(htmlBody),
    '',
    `--${alternativeBoundary}--`,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    encodeBase64Lines(input.pdfBuffer),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  await ses.send(
    new SendRawEmailCommand({
      Source: fromEmail,
      Destinations: [toEmail],
      RawMessage: { Data: Buffer.from(rawEmail, 'utf-8') },
    })
  );
}
