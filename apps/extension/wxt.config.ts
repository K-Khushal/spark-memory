import { defineConfig } from "wxt";

// Permissions stay minimal (activeTab); site adapters request optional host
// permissions only when they need them. See ADR-0006 and ADR-0010.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Spark",
    description: "Save anything. Find it whenever you need it.",
    permissions: ["activeTab", "storage"],
  },
});
