import {
  FREE_ALLOWANCE,
  IMPORT_LIMITS,
  ImportItem,
  normaliseUrl,
} from "@spark/core";

/** Client-only, inert document parsing; never attaches export markup to the page. */
export function parseImport(text: string): {
  items: ImportItem[];
  skipped: number;
} {
  if (new TextEncoder().encode(text).byteLength > IMPORT_LIMITS.bytes)
    throw new Error("File Exceeds 10 MB");
  const items: ImportItem[] = [];
  let skipped = 0;
  let count = 0;
  const add = (url: string, title = "", note = "", date = "") => {
    if (++count > IMPORT_LIMITS.urls)
      throw new Error("Export Exceeds 10,000 URLs");
    if (!normaliseUrl(url)) {
      skipped++;
      return;
    }
    const at = /^\d+$/.test(date)
      ? new Date(Number(date) * 1000)
      : new Date(date);
    const item = ImportItem.safeParse({
      url: url.trim(),
      ...(title.trim() && {
        title: title.trim().slice(0, FREE_ALLOWANCE.titleMaxChars),
      }),
      ...(note.trim() && {
        captureNote: note.trim().slice(0, FREE_ALLOWANCE.captureNoteMaxChars),
      }),
      ...(!Number.isNaN(at.getTime()) && { savedAt: at.toISOString() }),
    });
    if (item.success) items.push(item.data);
    else skipped++;
  };
  if (/^\s*<(?:!DOCTYPE|!--|html|dl|a|h1|ul|meta|title)\b/i.test(text)) {
    const template = document.createElement("template");
    template.innerHTML = text;
    const walk = (node: Element | DocumentFragment, folders: string[]) => {
      let folder = "";
      for (const child of node.children) {
        if (child.tagName === "H3") folder = child.textContent ?? "";
        else if (child.tagName === "A")
          add(
            child.getAttribute("href") ?? "",
            child.textContent ?? "",
            [...folders, child.getAttribute("tags") ?? ""]
              .filter(Boolean)
              .join(" · "),
            child.getAttribute("add_date") ??
              child.getAttribute("time_added") ??
              ""
          );
        else {
          walk(
            child,
            child.tagName === "DL" && folder ? [...folders, folder] : folders
          );
        }
        // Netscape's omitted </DT> leaves the heading and nested DL in one DT.
        if (child.tagName === "DT")
          folder = child.querySelector(":scope > h3")?.textContent ?? folder;
      }
    };
    walk(template.content, []);
  } else {
    const rows = csv(text.replace(/^\uFEFF/, ""));
    const header = rows[0]?.map((v) => v.trim().toLowerCase()) ?? [];
    const urlIndex = header.findIndex((v) =>
      ["url", "link", "resolved_url", "given_url"].includes(v)
    );
    if (urlIndex >= 0) {
      const field = (row: string[], names: string[]) =>
        row[header.findIndex((h) => names.includes(h))] ?? "";
      for (const row of rows.slice(1))
        add(
          row[urlIndex] ?? "",
          field(row, ["title", "given_title", "resolved_title"]),
          [
            field(row, ["folder", "collection"]),
            field(row, ["tags"]),
            field(row, ["excerpt", "note"]),
          ]
            .filter(Boolean)
            .join(" · "),
          field(row, ["time_added", "created", "created_at", "added", "date"])
        );
    } else
      for (const line of text.split(/\r?\n/)) if (line.trim()) add(line.trim());
  }
  return { items, skipped };
}

/** RFC 4180 quoted fields (including commas, escaped quotes and newlines). */
function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (quoted) throw new Error("CSV Is Incomplete");
  row.push(field.replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
