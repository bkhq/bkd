import type { FmZipEntry } from "../core/schema";
import type { FmDriver } from "./driver";
import { FmError } from "../core/errors";
import { readAll } from "./driver";

interface ZipRecord extends FmZipEntry {
  method: number;
  localOffset: number;
}

const EOCD = 0x06054B50;
const EOCD64 = 0x06064B50;
const EOCD64_LOCATOR = 0x07064B50;
const CENTRAL = 0x02014B50;
const LOCAL = 0x04034B50;
/** EOCD (22) + the longest comment. */
const TAIL = 22 + 0xFFFF;

const notZip = () => new FmError("INVALID", "Not a zip archive");

async function bytes(d: FmDriver, path: string, start: number, end: number) {
  return readAll((await d.read(path, { start, end })).body);
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function dosTime(date: number, time: number) {
  return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).toISOString();
}

/** Central directory location: offset, size and entry count (Zip64 aware). */
async function directory(d: FmDriver, path: string) {
  const { size } = await d.stat(path);
  if (size < 22)
    throw notZip();
  const tailStart = Math.max(0, size - TAIL);
  const tail = await bytes(d, path, tailStart, size - 1);
  const v = view(tail);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0)
    throw notZip();
  let count = v.getUint16(at + 10, true);
  let cdSize = v.getUint32(at + 12, true);
  let cdOffset = v.getUint32(at + 16, true);
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    const loc = at - 20;
    if (loc < 0 || v.getUint32(loc, true) !== EOCD64_LOCATOR)
      throw notZip();
    const recOffset = Number(v.getBigUint64(loc + 8, true));
    const rec = view(await bytes(d, path, recOffset, recOffset + 55));
    if (rec.getUint32(0, true) !== EOCD64)
      throw notZip();
    count = Number(rec.getBigUint64(32, true));
    cdSize = Number(rec.getBigUint64(40, true));
    cdOffset = Number(rec.getBigUint64(48, true));
  }
  if (cdOffset + cdSize > size)
    throw notZip();
  return { cdOffset, cdSize, count };
}

/** Parses up to `max` central directory records. */
async function records(d: FmDriver, path: string, max: number): Promise<{ records: ZipRecord[]; truncated: boolean }> {
  const { cdOffset, cdSize, count } = await directory(d, path);
  const cd = cdSize > 0
    ? await bytes(d, path, cdOffset, cdOffset + cdSize - 1)
    : new Uint8Array();
  const v = view(cd);
  const out: ZipRecord[] = [];
  let p = 0;
  while (p + 46 <= cd.length && out.length < max) {
    if (v.getUint32(p, true) !== CENTRAL)
      throw notZip();
    const flags = v.getUint16(p + 8, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    let compressedSize = v.getUint32(p + 20, true);
    let size = v.getUint32(p + 24, true);
    let localOffset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    // Zip64 extra field: 64-bit values for the fields marked 0xFFFFFFFF, in this order.
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen;) {
      const id = v.getUint16(e, true);
      const len = v.getUint16(e + 2, true);
      if (id === 1) {
        let f = e + 4;
        const next = () => {
          const n = Number(v.getBigUint64(f, true));
          f += 8;
          return n;
        };
        if (size === 0xFFFFFFFF)
          size = next();
        if (compressedSize === 0xFFFFFFFF)
          compressedSize = next();
        if (localOffset === 0xFFFFFFFF)
          localOffset = next();
      }
      e += 4 + len;
    }
    out.push({
      path: name,
      dir: name.endsWith("/"),
      size,
      compressedSize,
      mtime: dosTime(v.getUint16(p + 14, true), v.getUint16(p + 12, true)),
      encrypted: (flags & 1) === 1,
      method: v.getUint16(p + 10, true),
      localOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { records: out, truncated: count > out.length };
}

/** Entries of a zip archive, read from its central directory with ranged reads. */
export async function readZipEntries(d: FmDriver, path: string, max: number): Promise<{ entries: FmZipEntry[]; truncated: boolean }> {
  const r = await records(d, path, max);
  return {
    entries: r.records.map(({ method: _m, localOffset: _o, ...e }) => e),
    truncated: r.truncated,
  };
}

/** Streams one entry (stored or deflate), decompressed. */
export async function openZipEntry(d: FmDriver, path: string, name: string, max = Number.POSITIVE_INFINITY): Promise<{ entry: FmZipEntry; size: number; body: ReadableStream<Uint8Array> }> {
  const rec = (await records(d, path, max)).records.find(r => r.path === name);
  if (!rec || rec.dir)
    throw new FmError("NOT_FOUND", "Archive entry not found");
  if (rec.encrypted || (rec.method !== 0 && rec.method !== 8))
    throw new FmError("UNSUPPORTED", "Encrypted or unsupported compression");
  const head = view(await bytes(d, path, rec.localOffset, rec.localOffset + 29));
  if (head.getUint32(0, true) !== LOCAL)
    throw notZip();
  const start = rec.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = rec.compressedSize > 0
    ? (await d.read(path, { start, end: start + rec.compressedSize - 1 })).body
    : new Blob([]).stream();
  const body = rec.method === 8
    ? raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    : raw;
  const { method: _m, localOffset: _o, ...entry } = rec;
  return { entry, size: rec.size, body };
}
