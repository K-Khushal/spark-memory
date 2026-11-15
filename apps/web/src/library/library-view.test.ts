import { afterEach, expect, it } from "vitest";
import {
  clearLibraryView,
  readLibraryView,
  rememberLibraryView,
} from "./library-view";

afterEach(clearLibraryView);
const view = { owner: "ana", query: "private query", chips: {}, scroll: 400 };

it("keeps the current owner's view across Library remounts", () => {
  rememberLibraryView(view);
  expect(readLibraryView("ana")).toEqual(view);
});

it("forgets the view at the end of the session, even for the same returning owner", () => {
  rememberLibraryView(view);
  clearLibraryView();
  expect(readLibraryView("ana")).toBeUndefined();
});

it("discards the previous owner's view when the session changes", () => {
  rememberLibraryView(view);
  expect(readLibraryView("bea")).toBeUndefined();
  expect(readLibraryView("ana")).toBeUndefined();
});
