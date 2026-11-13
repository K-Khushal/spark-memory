export type Activation = "recorded" | "unchanged" | "failed";

/**
 * The first successful search is recorded once per account. Once the client
 * knows it, opening a search result no longer calls the server.
 */
export function createActivation(
  post: (memoryId: string) => Promise<Activation>
) {
  let known = false;
  return {
    know() {
      known = true;
    },
    async activate(memoryId: string): Promise<Activation | "known"> {
      if (known) return "known";
      const result = await post(memoryId);
      if (result === "recorded") known = true;
      return result;
    },
  };
}
