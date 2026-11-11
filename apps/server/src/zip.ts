/**
 * A streamed ZIP writer: files are stored (not compressed: images already
 * are) and read once, front to back, so memory stays flat however large the
 * Library. Each entry's CRC and size follow its data (a data descriptor), so
 * nothing has to be known up front. No ZIP64: a Library is far below 4 GiB
 * (the Free allowance is 1 GB), and anything that is not throws.
 */
export type ZipEntry = {
  name: string;
  modified: Date;
  /** The bytes, or undefined to leave the entry out (the file is gone). */
  body: () => Promise<AsyncIterable<Uint8Array> | undefined>;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return ~c >>> 0;
}

/** MS-DOS date and time, in UTC. */
function dosTime(at: Date) {
  const year = Math.max(at.getUTCFullYear(), 1980);
  return {
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      (at.getUTCSeconds() >> 1),
    date:
      ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

/** Bit 3: sizes and CRC in a data descriptor. Bit 11: UTF-8 names. */
const FLAGS = 0x0808;
const VERSION = 20;
const MAX_32 = 0xffffffff;

function record(size: number, fill: (view: DataView) => void) {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

type Written = {
  name: Uint8Array;
  time: number;
  date: number;
  crc: number;
  size: number;
  offset: number;
};

/** The ZIP of `entries`, as chunks in order. */
export async function* zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>
): AsyncGenerator<Uint8Array> {
  const written: Written[] = [];
  let offset = 0;
  for await (const entry of entries) {
    const body = await entry.body();
    if (!body) continue;
    const name = new TextEncoder().encode(entry.name);
    const { time, date } = dosTime(entry.modified);
    const header = record(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, VERSION, true);
      v.setUint16(6, FLAGS, true);
      v.setUint16(8, 0, true);
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      // CRC and sizes: 0 here, in the descriptor after the data.
      v.setUint16(26, name.length, true);
    });
    yield header;
    yield name;
    let crc = 0;
    let size = 0;
    for await (const chunk of body) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      yield chunk;
    }
    yield record(16, (v) => {
      v.setUint32(0, 0x08074b50, true);
      v.setUint32(4, crc, true);
      v.setUint32(8, size, true);
      v.setUint32(12, size, true);
    });
    written.push({ name, time, date, crc, size, offset });
    offset += 30 + name.length + size + 16;
    if (offset > MAX_32 || written.length > 0xffff) {
      throw new Error("zip: too large without ZIP64");
    }
  }
  const start = offset;
  for (const f of written) {
    yield record(46, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, VERSION, true);
      v.setUint16(6, VERSION, true);
      v.setUint16(8, FLAGS, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, f.time, true);
      v.setUint16(14, f.date, true);
      v.setUint32(16, f.crc, true);
      v.setUint32(20, f.size, true);
      v.setUint32(24, f.size, true);
      v.setUint16(28, f.name.length, true);
      v.setUint32(42, f.offset, true);
    });
    yield f.name;
    offset += 46 + f.name.length;
  }
  if (offset > MAX_32) throw new Error("zip: too large without ZIP64");
  yield record(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, written.length, true);
    v.setUint16(10, written.length, true);
    v.setUint32(12, offset - start, true);
    v.setUint32(16, start, true);
  });
}

/**
 * Regroups chunks into parts of exactly `size` bytes (the last may be
 * smaller), as R2 multipart uploads require. Holds at most one part.
 */
export async function* fixedParts(
  chunks: AsyncIterable<Uint8Array>,
  size: number
): AsyncGenerator<Uint8Array> {
  let part = new Uint8Array(size);
  let filled = 0;
  for await (let chunk of chunks) {
    while (chunk.length) {
      const take = Math.min(size - filled, chunk.length);
      part.set(chunk.subarray(0, take), filled);
      filled += take;
      chunk = chunk.subarray(take);
      if (filled === size) {
        yield part;
        part = new Uint8Array(size);
        filled = 0;
      }
    }
  }
  if (filled) yield part.subarray(0, filled);
}
