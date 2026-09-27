/**
 * Erzeugt ein minimales, gültiges PDF als Platzhalter für Dokumente im Demo-Modus.
 * Nur ASCII-Text (Umlaute werden umschrieben), eine Seite, Standardschrift Helvetica.
 */

function ascii(text: string): string {
  return text
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[()\\]/g, ' ');
}

export function makeDemoPdf(lines: string[]): string {
  const content = [
    'BT',
    '/F1 18 Tf',
    '56 780 Td',
    `(${ascii(lines[0] ?? 'Beispieldokument')}) Tj`,
    '/F1 11 Tf',
    ...lines.slice(1).flatMap((l) => ['0 -22 Td', `(${ascii(l)}) Tj`]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${off.toString().padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

/** Base64 ohne Plattformabhängigkeit (btoa fehlt in manchen Umgebungen). */
export function toBase64(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i) & 0xff;
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : 0;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : 0;
    const n = (a << 16) | (b << 8) | c;
    out += chars[(n >> 18) & 63]! + chars[(n >> 12) & 63]!;
    out += i + 1 < input.length ? chars[(n >> 6) & 63]! : '=';
    out += i + 2 < input.length ? chars[n & 63]! : '=';
  }
  return out;
}
