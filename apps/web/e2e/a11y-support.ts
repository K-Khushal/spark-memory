import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// WCAG 2.2 AA, scanned by axe on every screen and state in both themes. A new
// violation fails this file, so the app cannot regress without a person
// choosing to. Contrast is checked by axe in the rendered colours.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Waits for fades and slides to finish: axe reads colour mid-fade as low
 * contrast. Quiet means no finite animation for two looks 150ms apart, so one
 * that starts a frame late is still caught.
 */
export async function settle(page: Page) {
  let quiet = 0;
  for (let i = 0; i < 20 && quiet < 2; i++) {
    const running = await page.evaluate(async () => {
      const finite = document
        .getAnimations()
        // A spinner never finishes; only fades and slides are waited for.
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
      return finite.length;
    });
    quiet = running === 0 ? quiet + 1 : 0;
    await page.waitForTimeout(150);
  }
}

/**
 * Scans the page for WCAG 2.2 AA. Toasts are left out unless asked for: they
 * come and go on their own timers and stack while a walk makes many; one is
 * scanned on its own, still and alone.
 */
export async function scan(page: Page, label: string, { toasts = false } = {}) {
  await settle(page);
  const axe = new AxeBuilder({ page }).withTags(TAGS);
  if (!toasts) axe.exclude("[data-sonner-toaster]");
  const { violations } = await axe.analyze();
  expect
    .soft(
      violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        nodes: v.nodes
          .slice(0, 4)
          .map(
            (n) =>
              `${n.target.join(" ")} :: ${n.any[0]?.message ?? n.failureSummary}`
          ),
      })),
      label
    )
    .toEqual([]);
}

/** ⌘V outside a text field, with `text` on the clipboard. */
export async function paste(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true })
    );
  }, text);
}

/** Drops a real small PNG on the page, as a person dragging it in would. */
export async function dropImage(page: Page) {
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 48);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f6fe0";
    context.fillRect(0, 0, 64, 48);
    context.fillStyle = "#ffe15a";
    context.fillRect(8, 8, 24, 24);
    const png = await canvas.convertToBlob({ type: "image/png" });
    const data = new DataTransfer();
    data.items.add(new File([png], "square.png", { type: "image/png" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      window.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true })
      );
    }
  });
}

/** A small real one-page PDF (Helvetica, uncompressed). */
function pdfOf(text: string) {
  const stream = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

export async function dropPdf(page: Page, text: string) {
  await page.evaluate(
    ({ text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], "scan.pdf", { type: "application/pdf" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        window.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true })
        );
      }
    },
    { text: pdfOf(text) }
  );
}
