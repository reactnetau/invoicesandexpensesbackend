const EMAIL_RE = /^[^\s@<>"'(),;:\\]+@[^\s@<>"'(),;:\\]+\.[^\s@<>"'(),;:\\]+$/;
const SPREADSHEET_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHeaderValue(value: unknown, fallback = ''): string {
  return String(value ?? fallback)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, 120) || fallback;
}

export function normalizeEmailAddress(value: unknown): string {
  const email = sanitizeHeaderValue(value).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error('Invalid email address');
  }
  return email;
}

export function csvCell(value: unknown): string {
  let text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  if (SPREADSHEET_FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
