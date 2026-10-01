/**
 * PNG decoding and paint statistics for the map-canvas screenshot taken by
 * tools/lighthouse/map-paint-gatherer.mjs (owner: pages-docs-privacy-ops). Plain Node (zlib), so
 * the gatherer needs no image library and the statistics are unit-tested on recorded screenshots.
 */
import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';

/** @typedef {{width: number, height: number, channels: 3 | 4, data: Uint8Array}} DecodedImage */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Decodes the 8-bit, non-interlaced RGB or RGBA PNG that Chromium's Page.captureScreenshot returns.
 * Anything else throws (the caller records the error as missing paint evidence).
 * @param {Uint8Array} bytes
 * @return {DecodedImage}
 */
export function decodePng(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) throw new Error('not a PNG');
  let off = 8;
  let header = null;
  /** @type {Buffer[]} */
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], type: data[9], interlace: data[12] };
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (!header) throw new Error('PNG without IHDR');
  const { width, height, depth, type, interlace } = header;
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${type}, interlace ${interlace})`);
  /** @type {3 | 4} */
  const channels = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('truncated PNG');
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[dst + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * @typedef {{width: number, height: number, distinctColours: number, dominantShare: number, dominantColour: string}} PaintStats
 */

/**
 * Colour statistics of an image: distinct colours after quantising every channel to 4 bits
 * (4,096 buckets, so anti-aliasing noise does not count), and the share of the most common one.
 * A canvas that drew nothing is one colour (share 1).
 * @param {DecodedImage} img
 * @return {PaintStats}
 */
export function paintStats(img) {
  const counts = new Uint32Array(4096);
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const o = i * img.channels;
    counts[((img.data[o] >> 4) << 8) | ((img.data[o + 1] >> 4) << 4) | (img.data[o + 2] >> 4)]++;
  }
  let distinct = 0;
  let top = 0;
  for (let k = 0; k < counts.length; k++) {
    if (counts[k] > 0) distinct++;
    if (counts[k] > counts[top]) top = k;
  }
  // Bucket centre, e.g. "#080808" for the darkest bucket.
  const hex = [top >> 8, (top >> 4) & 15, top & 15].map((v) => ((v << 4) | 8).toString(16).padStart(2, '0')).join('');
  return { width: img.width, height: img.height, distinctColours: distinct, dominantShare: n ? Number((counts[top] / n).toFixed(4)) : 1, dominantColour: `#${hex}` };
}
