import { extractPage } from "@spark/capture/page";
import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
export default defineUnlistedScript(() => {
  const page = extractPage(document, location.href);
  void browser.runtime.sendMessage({
    type: "extracted",
    url: location.href,
    page,
  });
});
