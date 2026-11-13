import { expect, it } from "vitest";
import {
  Categories,
  CATEGORY_NAMES,
  checkCategoryName,
  CATEGORISING,
  chooseCategories,
  cosine,
  JevChoiceReply,
} from "../index";

it("keeps the strongest three Categories at the threshold, else Other", () => {
  expect(
    chooseCategories(
      { Recipe: 0.9, Tutorial: 0.8, Article: 0.7, Code: 0.6, Other: 1 },
      0.5
    )
  ).toEqual(["Recipe", "Tutorial", "Article"]);
  expect(chooseCategories({ Recipe: 0.5, Code: 0.5 }, 0.5)).toEqual([
    "Recipe",
    "Code",
  ]);
  expect(chooseCategories({ Recipe: 0.1 }, 0.5)).toEqual(["Other"]);
  expect(chooseCategories({ Recipe: NaN, Code: Infinity }, 0.5)).toEqual([
    "Code",
  ]);
  expect(chooseCategories({}, 0.5)).toEqual(["Other"]);
});

it("accepts one to three distinct names, built-in or the owner's own", () => {
  expect(Categories.safeParse(["Recipe", "Tutorial"]).success).toBe(true);
  expect(Categories.safeParse(["Recipe", "Gardening"]).success).toBe(true);
  for (const bad of [
    [],
    ["Recipe", "Recipe"],
    [""],
    ["x".repeat(41)],
    ["Recipe", "Code", "Article", "Video"],
  ]) {
    expect(Categories.safeParse(bad).success).toBe(false);
  }
});

it("checks a new Category name", () => {
  const own = ["Gardening", "Cat Photos"];
  // Trimmed, spaces inside kept as one, otherwise as typed.
  expect(checkCategoryName("  Home Lab ", own)).toEqual({ name: "Home Lab" });
  expect(checkCategoryName("Home   Lab", own)).toEqual({ name: "Home Lab" });
  expect(checkCategoryName("UX Research", own)).toEqual({
    name: "UX Research",
  });
  expect(checkCategoryName("Books to Read", own)).toEqual({
    name: "Books to Read",
  });
  expect(checkCategoryName("दादी की रेसिपी", own)).toEqual({
    name: "दादी की रेसिपी",
  });
  expect(checkCategoryName("2026 Trips", own)).toEqual({ name: "2026 Trips" });

  const problem = (name: string) => checkCategoryName(name, own);
  expect(problem("")).toEqual({ problem: "empty" });
  expect(problem("   ")).toEqual({ problem: "empty" });
  expect(problem("x".repeat(41))).toEqual({ problem: "long" });
  expect(problem("home lab")).toEqual({ problem: "case" });
  expect(problem("to Read")).toEqual({ problem: "case" });
  expect(problem("Line\nBreak")).toEqual({ problem: "characters" });
  expect(problem("Tab\there")).toEqual({ problem: "characters" });
  // Against the built-ins and the owner's own, whatever the case.
  expect(problem("recipe")).toEqual({ problem: "duplicate" });
  expect(problem("Receipt Or Document")).toEqual({ problem: "duplicate" });
  expect(problem("GARDENING")).toEqual({ problem: "duplicate" });
  expect(problem("Gardening ")).toEqual({ problem: "duplicate" });
  // A name may be changed in case alone: only the others count.
  expect(checkCategoryName("GARDENING", ["Cat Photos"])).toEqual({
    name: "GARDENING",
  });
});

it("compares by cosine and refuses vectors it cannot compare", () => {
  expect(cosine([3, 0], [2, 0])).toBeCloseTo(1);
  expect(cosine([1, 0], [0, 1])).toBe(0);
  expect(cosine([0, 0], [1, 0])).toBe(-1);
  expect(cosine([1], [1, 0])).toBe(-1);
  expect(cosine([NaN, 1], [1, 1])).toBe(-1);
});

it("has a prototype for every Category", () => {
  expect(Object.keys(CATEGORISING.prototypes).sort()).toEqual(
    [...CATEGORY_NAMES].sort()
  );
});

it("reads only well-formed Jev replies", () => {
  const ok = {
    answers: { category: { probabilities: { Recipe: 0.9, Other: 0.1 } } },
    usage: { input_tokens: 40 },
  };
  expect(JevChoiceReply.safeParse(ok).success).toBe(true);
  expect(
    JevChoiceReply.safeParse({ ...ok, usage: { input_tokens: -1 } }).success
  ).toBe(false);
  expect(
    JevChoiceReply.safeParse({
      ...ok,
      answers: { category: { probabilities: { Recipe: 2 } } },
    }).success
  ).toBe(false);
});
