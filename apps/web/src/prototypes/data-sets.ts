/** The fake Library states break-ui needs: worst case, empty, 1,000 Memories. */
export const DATA_SETS = ["library", "empty", "huge"] as const;
export type DataSet = (typeof DATA_SETS)[number];
