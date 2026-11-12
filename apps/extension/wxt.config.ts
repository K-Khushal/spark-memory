import { defineConfig } from "wxt";

const origin = new URL(process.env.WXT_API_ORIGIN || "https://sparkmemory.xyz");
if (
  origin.protocol !== "https:" &&
  !(origin.protocol === "http:" && origin.hostname === "localhost")
)
  throw new Error("Invalid API origin");
export default defineConfig({
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
    permissions: ["activeTab", "storage", "scripting", "alarms"],
    host_permissions: [
      `${origin.origin}/*`,
      ...(process.env.WXT_E2E === "1" ? ["<all_urls>"] : []),
    ],
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Save This Page",
      },
    },
  },
});
