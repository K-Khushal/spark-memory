import type { Results } from "./use-search";

/** What the ⌘K list says where results would be. */
export type SearchNote = "No Memories Match" | "No Direct Matches";

/**
 * What the ⌘K list shows for the answer in hand. An empty answer is only
 * news once nothing more is coming (`settled`: the full search answered or
 * failed). Until then the previous rows stay (`kept`, the last answer that
 * had any) and the list is busy: the instant answer for a few letters often
 * finds nothing that the full one then does, and a note in between flashes.
 */
export function searchList(
  answer: Results,
  kept: Results | undefined
): { rows: Results | undefined; note?: SearchNote; busy: boolean } {
  const total = answer.direct.length + answer.related.length;
  if (total === 0)
    return answer.settled
      ? { rows: answer, note: "No Memories Match", busy: false }
      : { rows: kept, busy: true };
  if (answer.direct.length === 0)
    return answer.settled
      ? { rows: answer, note: "No Direct Matches", busy: false }
      : { rows: answer, busy: true };
  return { rows: answer, busy: !answer.settled };
}
