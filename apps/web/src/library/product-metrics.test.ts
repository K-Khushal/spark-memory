import { describe, expect, it } from "vitest";
import type { ProductEvent } from "@spark/core";
import { productMetrics } from "./product-metrics";

describe("product metrics", () => {
  it("records a successful search, a reformulation and the time to find, without the query", () => {
    let time = 1_000;
    const events: ProductEvent[] = [];
    const metrics = productMetrics(
      (event) => events.push(event),
      () => time
    );
    metrics.searchOpened();
    time = 1_500;
    metrics.committedSearch("cardamom buns", { direct: 1, related: 0 });
    time = 1_800;
    metrics.committedSearch("cardamom", { direct: 1, related: 2 });
    time = 2_000;
    metrics.found();
    expect(events).toEqual([
      { event: "search_success", properties: { direct: 1, related: 0 } },
      { event: "search_reformulated", properties: {} },
      { event: "search_success", properties: { direct: 1, related: 2 } },
      { event: "time_to_find", properties: { milliseconds: 1_000 } },
    ]);
    expect(JSON.stringify(events)).not.toContain("cardamom");
  });

  it("records the search when a result is opened from the menu", () => {
    let time = 1_000;
    const events: ProductEvent[] = [];
    const metrics = productMetrics(
      (event) => events.push(event),
      () => time
    );
    metrics.searchOpened();
    metrics.committedSearch("cardamom buns", { direct: 1, related: 0 });
    time = 4_000;
    metrics.choseResult("cardamom", { direct: 2, related: 1 });
    metrics.abandoned();
    expect(events).toEqual([
      { event: "search_success", properties: { direct: 1, related: 0 } },
      { event: "search_reformulated", properties: {} },
      { event: "search_success", properties: { direct: 2, related: 1 } },
      { event: "time_to_find", properties: { milliseconds: 3_000 } },
    ]);
    expect(JSON.stringify(events)).not.toContain("cardamom");
  });

  it("does not count a tile opened after the menu was closed with no search", () => {
    const events: ProductEvent[] = [];
    const metrics = productMetrics((event) => events.push(event));
    metrics.searchOpened();
    metrics.abandoned();
    metrics.found();
    expect(events).toEqual([]);
  });

  it("skips an empty result, and a cleared search is not a reformulation", () => {
    const events: ProductEvent[] = [];
    const metrics = productMetrics((event) => events.push(event));
    metrics.committedSearch("nothing", { direct: 0, related: 0 });
    metrics.committedSearch("found", { direct: 0, related: 1 });
    metrics.cleared();
    metrics.committedSearch("again", { direct: 1, related: 0 });
    expect(events).toEqual([
      { event: "search_reformulated", properties: {} },
      { event: "search_success", properties: { direct: 0, related: 1 } },
      { event: "search_success", properties: { direct: 1, related: 0 } },
    ]);
  });
});
