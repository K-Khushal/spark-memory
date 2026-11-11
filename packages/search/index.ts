// Public entry point of @spark/search: one person's search, instant and
// full mode and More Like This, over the Library's hybrid SQL (ADR-0004).
export {
  createSearch,
  split,
  type Hit,
  type Mode,
  type Probe,
  type Ranked,
  type Search,
} from "./lib/search";
