import { crc32 } from "node:zlib";

/**
 * Reads a stored ZIP by its central directory, as an unzip tool does, and
 * checks every entry's CRC with Node's own crc32: an independent check of
 * src/zip.ts.
 */
export function unzip(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error("no EOCD");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad CD");
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      zip.subarray(at + 46, at + 46 + nameLength)
    );
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("bad LH");
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`bad CRC for ${name}`);
    const descriptor = new DataView(zip.buffer, zip.byteOffset + start + size);
    if (descriptor.getUint32(0, true) !== 0x08074b50) throw new Error("no DD");
    if (descriptor.getUint32(4, true) !== crc) throw new Error("bad DD CRC");
    files.set(name, data);
    at += 46 + nameLength;
  }
  return files;
}
