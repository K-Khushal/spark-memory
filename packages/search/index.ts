// Public entry point of @spark/search: one person's search, instant and
// full mode and More Like This, over the Library's hybrid SQL (ADR-0004).
export {
  createSearch,
  forgetQueryVectors,
  queryVectorsCached,
  searchesTracked,
  type Hit,
  type Mode,
  type Probe,
  type Ranked,
  type Search,
} from "./lib/search";
export { understandQuery } from "./lib/query";
export {
  jevMatchJudge,
  thresholdJudge,
  type Candidate,
  type MatchJudge,
  type Verdict,
} from "./lib/judge";
