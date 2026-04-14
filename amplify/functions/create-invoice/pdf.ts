import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface InvoicePdfInput {
  clientName: string;
  clientEmail?: string | null;
  amount: number;
  dueDate: Date;
  publicId: string;
  status: string;
  appUrl: string;
  payid?: string | null;
  businessName?: string | null;
  fullName?: string | null;
  phone?: string | null;
  address?: string | null;
  abn?: string | null;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const invoiceUrl = `${input.appUrl}/invoice/${input.publicId}`;

  // Header band
  page.drawRectangle({
    x: 0,
    y: height - 140,
    width,
    height: 140,
    color: rgb(0.93, 0.96, 1),
  });

  page.drawText('Invoice', {
    x: 48,
    y: height - 72,
    size: 30,
    font: boldFont,
    color: rgb(0.05, 0.09, 0.18),
  });

  const senderLine = input.businessName || input.fullName || 'Invoice';
  page.drawText(senderLine, {
    x: 48,
    y: height - 104,
    size: 14,
    font,
    color: rgb(0.2, 0.3, 0.45),
  });

  // Sender details top-right
  const senderDetails: string[] = [];
  if (input.fullName && input.businessName) senderDetails.push(input.fullName);
  if (input.phone) senderDetails.push(input.phone);
  if (input.abn) senderDetails.push(`ABN: ${input.abn}`);
  let detailY = height - 56;
  for (const line of senderDetails) {
    const lineWidth = font.widthOfTextAtSize(line, 10);
    page.drawText(line, {
      x: width - 48 - lineWidth,
      y: detailY,
      size: 10,
      font,
      color: rgb(0.39, 0.45, 0.55),
    });
    detailY -= 16;
  }

  page.drawText(`Amount due: ${formatAmount(input.amount)}`, {
    x: 48,
    y: height - 190,
    size: 22,
    font: boldFont,
    color: rgb(0.02, 0.07, 0.15),
  });

  const lines: [string, string][] = [
    ['Client', input.clientName],
    ['Client email', input.clientEmail || 'No email on file'],
    ['Due date', formatDate(input.dueDate)],
    ['Status', input.status],
    ['Public link', invoiceUrl],
  ];

  let y = height - 250;
  for (const [label, value] of lines) {
    page.drawText(label, { x: 48, y, size: 11, font: boldFont, color: rgb(0.39, 0.45, 0.55) });
    page.drawText(value, { x: 180, y, size: 11, font, color: rgb(0.1, 0.14, 0.2), maxWidth: 360 });
    y -= 34;
  }

  page.drawLine({
    start: { x: 48, y: y + 10 },
    end: { x: width - 48, y: y + 10 },
    thickness: 1,
    color: rgb(0.88, 0.91, 0.95),
  });

  page.drawText('Share the public link above to let your client view the invoice online.', {
    x: 48, y: y - 24, size: 11, font, color: rgb(0.39, 0.45, 0.55), maxWidth: width - 96,
  });

  // Payment details box
  const payY = y - 80;
  page.drawRectangle({
    x: 48, y: payY - 110, width: width - 96, height: 120,
    color: rgb(0.96, 0.98, 1),
    borderColor: rgb(0.82, 0.88, 0.96),
    borderWidth: 1,
  });

  page.drawText('Payment Details', {
    x: 64, y: payY - 24, size: 12, font: boldFont, color: rgb(0.05, 0.09, 0.18),
  });

  const paymentLines: [string, string][] = input.payid
    ? [['PayID', input.payid], ['Reference', `INV-${input.publicId.slice(0, 8).toUpperCase()}`]]
    : [['Reference', `INV-${input.publicId.slice(0, 8).toUpperCase()}`]];

  let py = payY - 48;
  for (const [label, value] of paymentLines) {
    page.drawText(label, { x: 64, y: py, size: 10, font: boldFont, color: rgb(0.39, 0.45, 0.55) });
    page.drawText(value, { x: 180, y: py, size: 10, font, color: rgb(0.1, 0.14, 0.2) });
    py -= 20;
  }

  return Buffer.from(await pdfDoc.save());
}
