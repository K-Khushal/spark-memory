import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

// PDF Capture end to end on the local stack: pdf.js draws the pages in the
// browser, the files go to local storage, and Indexing reads the text with
// the fake reader (INDEXING_PROVIDER=fake), which reads simple PDFs.

/** A small real PDF: one page per text, Helvetica, uncompressed. */
function pdfOf(pages: string[]) {
  const objects: string[] = [];
  const font = 3 + pages.length * 2;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`
  );
  pages.forEach((text, i) => {
    const stream = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
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

/** Drops a PDF on the page as a person dragging it in would. */
async function dropPdf(page: Page, name: string, pages: string[]) {
  await page.evaluate(
    ({ name, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type: "application/pdf" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        window.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true })
        );
      }
    },
    { name, text: pdfOf(pages) }
  );
}

test("drop a PDF: its pages are drawn and uploaded, its text is Indexed, and a search opens it at the page that matched", async ({
  page,
}) => {
  await signIn(page);
  await dropPdf(page, "Allotment rules.pdf", [
    "Welcome to the allotment",
    "Plots are mowed on Tuesdays",
    "Compost bins stay by the shed",
  ]);

  const wall = page.getByRole("list", { name: "All Memories" });
  const tile = wall.getByRole("listitem", { name: "Allotment rules, PDF" });
  await expect(tile).toBeVisible();
  await expect(tile.getByText("PDF", { exact: true })).toBeVisible();
  await expect(tile.getByRole("progressbar")).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 20_000,
    })
    .toMatchObject({
      memories: [{ kind: "pdf", pages: 3, indexState: "searchable" }],
    });

  // A word on the third page: the result opens the viewer there.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search…").fill("compost");
  await expect(
    page.getByRole("listbox").getByRole("option", { name: "Allotment rules" })
  ).toBeVisible();
  await page.keyboard.press("Enter");
  const direct = page.getByRole("list", { name: "Direct Matches" });
  await direct.getByRole("listitem", { name: /^Allotment rules, PDF/ }).click();
  const viewer = page.getByRole("dialog");
  const third = viewer.getByRole("img", { name: "Page 3" });
  await expect(third).toBeInViewport();
  await expect(third).not.toHaveJSProperty("naturalWidth", 0);
  await expect(viewer.getByRole("link", { name: "Open PDF" })).toHaveAttribute(
    "href",
    /.+/
  );
  // ← goes a page back.
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("img", { name: "Page 2" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // Deleted from the viewer: gone, files and all.
  await page.getByRole("button", { name: "Clear Search" }).click();
  await tile.click();
  await viewer.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(tile).toBeHidden();
  await expect
    .poll(async () => (await page.request.get("/api/memories")).json(), {
      timeout: 10_000,
    })
    .toMatchObject({ memories: [] });
});
