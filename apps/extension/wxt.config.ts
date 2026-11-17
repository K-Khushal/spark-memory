import { defineConfig } from "wxt";

const origin = new URL(process.env.WXT_API_ORIGIN || "https://sparkmemory.xyz");
if (
  origin.protocol !== "https:" &&
  !(origin.protocol === "http:" && origin.hostname === "localhost")
)
  throw new Error("Invalid API origin");
const uploadOrigin = new URL(process.env.WXT_UPLOAD_ORIGIN || origin.origin);
if (uploadOrigin.protocol !== "https:" && uploadOrigin.origin !== origin.origin)
  throw new Error("Invalid upload origin");
export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Spark",
    description: "Save This Page to Your Library",
    ...(origin.hostname == "localhost"
      ? {
          key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxbJdiUFZRTRPpiAEMSFFLeey4EsFO3yfprGxe1qZ3pFr9VGQLJsAFbHZn7T5PkIiSFsfX5ch8yUqsTSPg7GF1T5LbHZM7VsTtEU4d2LdfQ+CZ+Rlj89drSgpv+84qe1wckF6SU/91EQYW+cB8rWUrPbaLL/8w1emlfTb62bc9aMP/yNV1F1cZ5Yx+t2Vk98jXRPT0MB3U+Kan9B7Pt2FoxnC3/JKv7h7jjnsWJ/EcbtGgHrXstPVSZutMUiu1y1xfdNZ/7w+7E7Dd2zsVumP294pNPRNGg4/aeKC9PGRGyCscpV5Wu/hJO8LrWhOief/urQ5G37WnRYGzW5/cL5ZIwIDAQAB",
        }
      : process.env.WXT_EXTENSION_KEY
        ? { key: process.env.WXT_EXTENSION_KEY }
        : {}),
    web_accessible_resources: [
      { resources: ["fonts/instrument.woff2"], matches: ["<all_urls>"] },
    ],
    permissions: [
      "activeTab",
      "storage",
      "scripting",
      "alarms",
      "contextMenus",
    ],
    browser_specific_settings: {
      gecko: {
        id: "spark@sparkmemory.xyz",
        strict_min_version: "142.0",
        data_collection_permissions: { required: ["websiteContent"] },
      },
    },
    optional_host_permissions: ["http://*/*", "https://*/*"],
    host_permissions: [
      ...new Set([`${origin.origin}/*`, `${uploadOrigin.origin}/*`]),
      ...(process.env.WXT_E2E === "1" ? ["<all_urls>"] : []),
    ],
    commands: {
      "save-page": {
        suggested_key: { default: "Alt+Shift+P" },
        description: "Save Page",
      },
      "save-selection": {
        suggested_key: { default: "Alt+Shift+T" },
        description: "Save Selection",
      },
      "save-region": { description: "Save Region" },
      _execute_action: {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Save This Page",
      },
    },
  },
});
