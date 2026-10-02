/**
 * RFC 4180 CSV parsing (quoted fields, escaped quotes, CRLF, embedded newlines). Used for FIRMS,
 * URLhaus, OurAirports, gpsjam, OpenSanctions and VRS routes. Owner: lead. Isomorphic.
 */

/** Yield rows as string arrays. */
export function* csvRows(text: string, delimiter = ','): Generator<string[]> {
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) yield row;
      row = [];
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) yield row;
  }
}

/** Parse with a header row into objects keyed by header name (trimmed). */
export function parseCsv(text: string, delimiter = ','): Record<string, string>[] {
  const it = csvRows(text, delimiter);
  const first = it.next();
  if (first.done) return [];
  const header = first.value.map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const r of it) {
    const o: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) o[header[i]!] = r[i] ?? '';
    out.push(o);
  }
  return out;
}
