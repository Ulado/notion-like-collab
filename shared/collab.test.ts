import { describe, expect, it } from "vitest";
import { MARKDOWN_SHORTCUTS } from "./collab";

function resolveShortcutType(input: string) {
  return MARKDOWN_SHORTCUTS.find(shortcut => shortcut.match.test(input))?.type ?? null;
}

describe("MARKDOWN_SHORTCUTS", () => {
  it("maps heading syntax to heading block types", () => {
    expect(resolveShortcutType("# Title")).toBe("heading-1");
    expect(resolveShortcutType("## Section")).toBe("heading-2");
    expect(resolveShortcutType("### Detail")).toBe("heading-3");
  });

  it("maps list syntax to the correct list-style block types", () => {
    expect(resolveShortcutType("- Bullet item")).toBe("bulleted-list");
    expect(resolveShortcutType("1. Numbered item")).toBe("numbered-list");
    expect(resolveShortcutType("[ ] Todo item")).toBe("todo");
  });

  it("maps quote and fenced code syntax to their corresponding block types", () => {
    expect(resolveShortcutType("> Highlight this note")).toBe("quote");
    expect(resolveShortcutType("```const answer = 42;")).toBe("code");
  });
});
