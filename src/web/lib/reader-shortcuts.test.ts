import { expect, test } from "vitest";
import { getReaderShortcutAction, type ReaderShortcutKeyInput } from "./reader-shortcuts";

const press = (key: string, modifiers: Partial<ReaderShortcutKeyInput> = {}) =>
  getReaderShortcutAction({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    key,
    ...modifiers,
  });

test("Shift reverses Space and turns arrows into chapter jumps", () => {
  expect(press(" ")).toBe("next-page");
  expect(press(" ", { shiftKey: true })).toBe("previous-page");
  expect(press("ArrowRight", { shiftKey: true })).toBe("next-section");
  expect(press("ArrowLeft", { shiftKey: true })).toBe("previous-section");
});

test("leaves Shift+letters to the app (Shift+D toggles the theme)", () => {
  expect(press("D", { shiftKey: true })).toBeNull();
  expect(press("B", { shiftKey: true })).toBeNull();
  // Caps Lock reports uppercase without Shift and still works.
  expect(press("B")).toBe("toggle-bookmarks");
});

test("only a lone Cmd or Ctrl chord adds a bookmark", () => {
  expect(press("d", { metaKey: true })).toBe("add-bookmark");
  expect(press("d", { ctrlKey: true })).toBe("add-bookmark");
  expect(press("d", { metaKey: true, shiftKey: true })).toBeNull();
  expect(press("d", { ctrlKey: true, metaKey: true })).toBeNull();
  expect(press("ArrowRight", { metaKey: true })).toBeNull();
  expect(press("ArrowRight", { altKey: true })).toBeNull();
});

test("layout-dependent symbols match with or without Shift", () => {
  expect(press("?", { shiftKey: true })).toBe("toggle-help");
  expect(press("?")).toBe("toggle-help");
  expect(press("+", { shiftKey: true })).toBe("increase-font");
  expect(press("=")).toBe("increase-font");
});

test("key repeat keeps paging but never re-fires toggles or bookmarking", () => {
  expect(press("ArrowRight", { repeat: true })).toBe("next-page");
  expect(press("-", { repeat: true })).toBe("decrease-font");
  expect(press("b", { repeat: true })).toBeNull();
  expect(press("?", { repeat: true })).toBeNull();
  expect(press("d", { metaKey: true, repeat: true })).toBeNull();
});
