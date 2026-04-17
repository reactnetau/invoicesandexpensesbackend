import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface InvoicePdfInput {
  clientName: string;
  clientEmail?: string | null;
  amount: number;
  dueDate: Date;
  publicId: string;
  status: string;
  appUrl: string;
  currency?: string | null;
  payid?: string | null;
  businessName?: string | null;
  fullName?: string | null;
  phone?: string | null;
  address?: string | null;
  abn?: string | null;
  /** Raw image bytes for the company logo (PNG or JPEG). When provided the
   *  logo is drawn in the right side of the header band.  If null/undefined
   *  the header renders exactly as before. */
  logoImageBytes?: Buffer | null;
}

function formatAmount(amount: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Returns 'png' when the buffer starts with the PNG magic bytes, otherwise
 * assumes JPEG.  We only support PNG and JPEG/JPG uploads from the client.
 */
function detectImageFormat(bytes: Buffer): 'png' | 'jpg' {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  return 'jpg';
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

  // ── Logo OR sender details in the right side of the header ───────────────
  // When a logo is present it occupies the top-right of the header band;
  // the condensed sender-detail lines are skipped to avoid overlap.
  // When there is no logo, sender details render exactly as before.
  const hasLogo = !!(input.logoImageBytes && input.logoImageBytes.length > 0);

  if (hasLogo) {
    try {
      const fmt = detectImageFormat(input.logoImageBytes!);
      const logoImage =
        fmt === 'png'
          ? await pdfDoc.embedPng(input.logoImageBytes!)
          : await pdfDoc.embedJpg(input.logoImageBytes!);

      const maxW = 120;
      const maxH = 72;
      const dims = logoImage.scale(1);
      const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
      const scaledW = Math.round(dims.width * scale);
      const scaledH = Math.round(dims.height * scale);

      // Vertically center inside the 140-pt header band
      const logoX = width - 48 - scaledW;
      const logoY = height - 140 + Math.round((140 - scaledH) / 2);

      page.drawImage(logoImage, {
        x: logoX,
        y: logoY,
        width: scaledW,
        height: scaledH,
      });
    } catch {
      // Logo embed failed — continue generating the PDF without it.
      console.warn('[pdf] Logo embed failed, continuing without logo.');
    }
  } else {
    // Sender details top-right (existing behaviour)
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
  }

  page.drawText(`Amount due: ${formatAmount(input.amount, input.currency ?? 'AUD')}`, {
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
