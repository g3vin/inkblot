/**
 * xml.ts — escaping for the XML exports write by hand (DOCX, FDX).
 *
 * Text and attribute values alike: `&`, `<`, `>` and both quotes. Characters XML 1.0
 * cannot hold at all — the C0 controls other than tab, line feed and return — are
 * dropped rather than written, since one of them makes Word refuse the whole file.
 */

// eslint-disable-next-line no-control-regex
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

export const escapeXml = (value: unknown): string => String(value ?? '')
  .replace(INVALID, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')
