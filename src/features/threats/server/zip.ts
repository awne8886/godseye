/**
 * Minimal ZIP reader for GDELT's single-entry `*.export.CSV.zip` files (stored or deflate). Reads
 * the central directory (sizes are authoritative there even when the local header uses a data
 * descriptor) and inflates the first entry with a size cap. Owner: layers-threats-network. Server-only.
 */
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export function unzipFirst(buf: Buffer, maxBytes = 64 * 1024 * 1024): { name: string; data: Buffer } {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cenOffset) !== CEN) throw new Error('zip: bad central directory');
  const method = buf.readUInt16LE(cenOffset + 10);
  const compSize = buf.readUInt32LE(cenOffset + 20);
  const size = buf.readUInt32LE(cenOffset + 24);
  const nameLen = buf.readUInt16LE(cenOffset + 28);
  const localOffset = buf.readUInt32LE(cenOffset + 42);
  const name = buf.subarray(cenOffset + 46, cenOffset + 46 + nameLen).toString('utf8');
  if (size > maxBytes) throw new Error(`zip: entry of ${size} bytes exceeds the cap`);
  if (buf.readUInt32LE(localOffset) !== LOC) throw new Error('zip: bad local header');
  const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
  const raw = buf.subarray(start, start + compSize);
  if (method === 0) return { name, data: Buffer.from(raw) };
  if (method !== 8) throw new Error(`zip: unsupported method ${method}`);
  return { name, data: inflateRawSync(raw, { maxOutputLength: maxBytes }) };
}
