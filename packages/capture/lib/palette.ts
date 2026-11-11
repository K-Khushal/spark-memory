/**
 * An image's dominant colours from its RGBA pixels, most of the image first:
 * pixels are grouped into 4,096 colour boxes (4 bits a channel), and the
 * fullest boxes that differ visibly from those already picked are kept.
 * Runs in the browser on the small ThumbHash canvas at Capture, because the
 * Worker cannot decode images within its CPU limit without heavy code.
 */
export function dominantColours(rgba: ArrayLike<number>, max = 5): string[] {
  const boxes = new Map<
    number,
    { n: number; r: number; g: number; b: number }
  >();
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    const [r, g, b] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const box = boxes.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    box.n++;
    box.r += r;
    box.g += g;
    box.b += b;
    boxes.set(key, box);
    total++;
  }
  const picked: [number, number, number][] = [];
  for (const box of [...boxes.values()].sort((a, b) => b.n - a.n)) {
    // Under 3% of the image is a detail, not a dominant colour.
    if (picked.length >= max || box.n < total * 0.03) break;
    const colour: [number, number, number] = [
      Math.round(box.r / box.n),
      Math.round(box.g / box.n),
      Math.round(box.b / box.n),
    ];
    const near = picked.some(
      (p) =>
        Math.hypot(p[0] - colour[0], p[1] - colour[1], p[2] - colour[2]) < 48
    );
    if (!near) picked.push(colour);
  }
  return picked.map(
    (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`
  );
}
