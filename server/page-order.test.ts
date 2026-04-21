import { describe, expect, it } from "vitest";
import { normalizePageOrder } from "./db";

describe("normalizePageOrder", () => {
  it("keeps sequential ordering when no moved page is specified", () => {
    expect(normalizePageOrder([11, 12, 13])).toEqual([
      { id: 11, sortOrder: 0 },
      { id: 12, sortOrder: 1 },
      { id: 13, sortOrder: 2 },
    ]);
  });

  it("repositions a page within the same level and reindexes siblings sequentially", () => {
    expect(normalizePageOrder([11, 12, 13, 14], 13, 1)).toEqual([
      { id: 11, sortOrder: 0 },
      { id: 13, sortOrder: 1 },
      { id: 12, sortOrder: 2 },
      { id: 14, sortOrder: 3 },
    ]);
  });

  it("inserts a moved page at the end when the target sort order exceeds sibling length", () => {
    expect(normalizePageOrder([21, 22, 23], 21, 99)).toEqual([
      { id: 22, sortOrder: 0 },
      { id: 23, sortOrder: 1 },
      { id: 21, sortOrder: 2 },
    ]);
  });
});
