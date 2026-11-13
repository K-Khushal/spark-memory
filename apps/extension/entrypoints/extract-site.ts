import { extractPage } from "@spark/capture/page";
import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { readSite } from "../lib/sites";
/**
 * Injected, once the person has granted a site's host, instead of extract.ts:
 * the site's own post when its adapter reads it, else the generic reader.
 */
export default defineUnlistedScript(() => {
  let result;
  try {
    result = {
      page:
        readSite(document, location.href) ??
        extractPage(document, location.href),
    };
  } catch {
    result = { failed: true };
  }
  void browser.runtime.sendMessage({
    type: "extracted",
    url: location.href,
    ...result,
  });
});
