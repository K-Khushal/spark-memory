#!/usr/bin/env node
// Writes the PWA PNG icons from DESIGN.md tokens (ink + spark).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INK = [0x11, 0x12, 0x14, 0xff];
const SPARK = [0xff, 0xe1, 0x5a, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([len, payload, crc]);
}

function png(size, paint) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size);
      const i = y * stride + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Ink field, spark disc, edges antialiased by 4x4 supersampling. */
function mark(fill) {
  return (x, y, size) => {
    const c = size / 2;
    const r = (size * fill) / 2;
    let hit = 0;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const dx = x + (i + 0.5) / 4 - c;
        const dy = y + (j + 0.5) / 4 - c;
        if (dx * dx + dy * dy <= r * r) hit++;
      }
    const t = hit / 16;
    return INK.map((v, k) => Math.round(v + (SPARK[k] - v) * t));
  };
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "../public/icons");
writeFileSync(join(dir, "icon-192.png"), png(192, mark(0.84)));
writeFileSync(join(dir, "icon-512.png"), png(512, mark(0.84)));
writeFileSync(join(dir, "maskable-192.png"), png(192, mark(0.56)));
writeFileSync(join(dir, "maskable-512.png"), png(512, mark(0.56)));
