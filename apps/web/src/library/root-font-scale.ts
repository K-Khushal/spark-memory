// One computed-style read per frame, shared by every virtualised tile.
let frameScale: number | undefined;
export const rootFontScale = () => {
  if (frameScale === undefined) {
    frameScale =
      parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
    requestAnimationFrame(() => {
      frameScale = undefined;
    });
  }
  return frameScale;
};
