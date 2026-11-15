import type { SearchChips } from "@spark/core";
import type { ImageQuery } from "./image-query";
import type { Memory } from "./use-library";

type LibraryView = {
  owner: string;
  query: string;
  chips: SearchChips;
  visual?: ImageQuery;
  like?: Memory;
  scroll: number;
};

/** Only the current owner's transient view survives a route change, never a session. */
let libraryView: LibraryView | undefined;

export function clearLibraryView() {
  libraryView = undefined;
}

export function readLibraryView(owner: string) {
  if (libraryView?.owner !== owner) clearLibraryView();
  return libraryView;
}

export function rememberLibraryView(view: LibraryView) {
  libraryView = view;
}
