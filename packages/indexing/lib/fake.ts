import type { Provider } from "./provider";

/** A word only the fake provider writes, so a test can find a Memory by it. */
export const FAKE_WORD = "quillfeather";

/**
 * A stand-in provider for local development and the smoke test, chosen with
 * INDEXING_PROVIDER=fake: no keys, no network, nothing leaves the machine.
 * Content containing "fake:fail" gets an answer that is not JSON, every
 * time: the corrective retry fails too, so the Memory shows Failed at once.
 */
export function fakeProvider(): Provider {
  return {
    name: "fake",
    model: "fake",
    async extract({ user, image }) {
      if (user.includes("fake:fail")) {
        return { text: "not json", usage: { inputTokens: 0, outputTokens: 0 } };
      }
      const text = /<text>\n([^\n]*)/.exec(user)?.[1]?.trim();
      const output = {
        title: image ? "Fake Image Title" : (text?.slice(0, 60) ?? "Untitled"),
        description: `Described locally by the fake provider: ${FAKE_WORD}.`,
        ocrText: "",
        entities: [],
        tags: ["fake"],
        language: "en",
      };
      return {
        text: JSON.stringify(output),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
