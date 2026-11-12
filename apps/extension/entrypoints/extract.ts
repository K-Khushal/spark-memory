import { extractPage } from "@spark/capture/page";
import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
export default defineUnlistedScript(() => {
  let result;
  try {
    result = { page: extractPage(document, location.href) };
  } catch {
    result = { failed: true };
  }
  void browser.runtime.sendMessage({
    type: "extracted",
    url: location.href,
    ...result,
    time: document.querySelector?.("video")?.currentTime,
  });
});
