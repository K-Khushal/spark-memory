// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { extractPage } from "../page";

it("extracts the article and metadata without fetching or changing the page", () => {
  document.body.innerHTML = `<nav>Navigation</nav><article><h1>Growing Basil</h1><p>${"Basil likes sunny windows and regular watering. ".repeat(40)}</p></article>`;
  document.head.innerHTML = `<title>Basil</title><meta property="og:description" content="A garden guide"><script type="application/ld+json">{"@type":"Article","author":{"name":"Ana"}}</script>`;
  const before = document.documentElement.outerHTML;
  const fetch = vi.spyOn(globalThis, "fetch");
  const result = extractPage(document, "https://garden.test/basil");
  expect(result.text).toContain("Basil likes sunny windows");
  expect(result.description).toBe("A garden guide");
  expect(result.author).toBe("Ana");
  expect(document.documentElement.outerHTML).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});
it("keeps readable content when an image URL exceeds the schema limit", () => {
  document.head.innerHTML = `<title>Basil</title><meta property="og:image" content="https://garden.test/${"x".repeat(2500)}">`;
  document.body.innerHTML = `<article><p>${"Basil likes sunny windows and regular watering. ".repeat(40)}</p></article>`;
  expect(extractPage(document, "https://garden.test").text).toContain(
    "Basil likes sunny windows"
  );
});
