import { THEMES } from "@spark/ui/tokens";

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
const vars = (theme: Record<string, string>) =>
  Object.entries(theme)
    .map(([key, value]) => `--${key}:${value}`)
    .join(";");
/** Small server-rendered authorization surface; no third-party assets or script. */
export function assistantPage(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} · Spark</title><style>
@font-face{font-family:"Instrument Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/assistant-instrument-sans.woff2") format("woff2")}
:root{${vars(THEMES.light)}}@media(prefers-color-scheme:dark){:root{${vars(THEMES.dark)}}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.6 "Instrument Sans",system-ui,sans-serif}main{max-width:440px;margin:12vh auto;padding:24px}h1{font-size:28px;line-height:1.25;letter-spacing:-.02em;margin:0 0 24px}h2{font-size:17px;overflow-wrap:anywhere}a{color:inherit}button,input{font:inherit;border:1px solid var(--line-strong);border-radius:8px;padding:10px 14px;background:var(--surface);color:var(--ink);min-height:44px}button{cursor:pointer}button.primary{background:var(--ink);color:var(--canvas);border-color:var(--ink)}:focus-visible{outline:2px solid var(--ring);outline-offset:2px}form{margin:16px 0}nav{display:flex;gap:12px;flex-wrap:wrap}label{display:block;margin-bottom:8px}input{width:100%;margin-bottom:12px}p{margin:16px 0}ul{padding-left:20px}
</style></head><body><main><a href="/">Spark</a><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`;
}
