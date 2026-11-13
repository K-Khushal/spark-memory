/** What the wall does by itself when a Category changes, as the server does it. */

type Named = { categories: string[] };

/** The Memories as the server leaves them after a rename. */
export function renamedIn<T extends Named>(
  memories: T[],
  from: string,
  to: string
): T[] {
  return memories.map((m) =>
    m.categories.includes(from)
      ? { ...m, categories: m.categories.map((c) => (c === from ? to : c)) }
      : m
  );
}

/** The Memories as the server leaves them after a delete: none left means Other. */
export function withoutIn<T extends Named>(memories: T[], name: string): T[] {
  return memories.map((m) => {
    if (!m.categories.includes(name)) return m;
    const left = m.categories.filter((c) => c !== name);
    return { ...m, categories: left.length ? left : ["Other"] };
  });
}
