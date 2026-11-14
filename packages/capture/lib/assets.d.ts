/** A bundled file's URL (Vite's `?url` import). */
declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*?raw" {
  const text: string;
  export default text;
}
