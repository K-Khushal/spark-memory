import { z } from "zod";

export const OnboardingUpdate = z.object({
  step: z.enum([
    "disclosure",
    "extension",
    "capture",
    "indexing",
    "search",
    "done",
  ]),
  paused: z.boolean(),
});
export const SearchActivation = z.object({ memoryId: z.uuid() });
