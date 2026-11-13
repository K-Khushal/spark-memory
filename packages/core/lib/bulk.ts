import { z } from "zod";
import { Categories } from "./categories";
/** Small transactions; clients send large selections as consecutive batches. */
export const BULK_LIMIT = 200;
const ids = z.array(z.uuid()).min(1).max(BULK_LIMIT);
export const BulkMemories = z.discriminatedUnion("operation", [
  z.object({ ids, operation: z.literal("delete") }).strict(),
  z
    .object({ ids, operation: z.literal("categories"), categories: Categories })
    .strict(),
]);
export type BulkMemories = z.infer<typeof BulkMemories>;
