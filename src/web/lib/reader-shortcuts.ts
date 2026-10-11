export type ReaderShortcutAction =
  | "next-page"
  | "previous-page"
  | "section-start"
  | "section-end"
  | "next-section"
  | "previous-section"
  | "toggle-contents"
  | "toggle-bookmarks"
  | "add-bookmark"
  | "toggle-annotations"
  | "toggle-appearance"
  | "increase-font"
  | "decrease-font"
  | "toggle-help";

export type ReaderShortcutKeyInput = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "repeat" | "shiftKey"
>;

// `repeatable`: held keys may keep paging or resizing; toggles and bookmark
// creation fire once per press or they flicker / create duplicates.
// `paging`: the key already means something to a focused control (Space
// presses a button, arrows move within a radio group or select), so it only
// acts when focus is on the page or on nothing in particular.
export const READER_SHORTCUT_BEHAVIOR: Record<
  ReaderShortcutAction,
  { paging: boolean; repeatable: boolean }
> = {
  "next-page": { paging: true, repeatable: true },
  "previous-page": { paging: true, repeatable: true },
  "section-start": { paging: true, repeatable: false },
  "section-end": { paging: true, repeatable: false },
  "next-section": { paging: true, repeatable: true },
  "previous-section": { paging: true, repeatable: true },
  "toggle-contents": { paging: false, repeatable: false },
  "toggle-bookmarks": { paging: false, repeatable: false },
  "add-bookmark": { paging: false, repeatable: false },
  "toggle-annotations": { paging: false, repeatable: false },
  "toggle-appearance": { paging: false, repeatable: false },
  "increase-font": { paging: false, repeatable: true },
  "decrease-font": { paging: false, repeatable: true },
  "toggle-help": { paging: false, repeatable: false },
};

const resolveAction = (event: ReaderShortcutKeyInput): ReaderShortcutAction | null => {
  if (event.altKey) return null;

  if (event.metaKey || event.ctrlKey) {
    if (event.metaKey && event.ctrlKey) return null;
    return !event.shiftKey && event.key.toLowerCase() === "d" ? "add-bookmark" : null;
  }

  // Layout-dependent symbols: "?" and "+" need Shift on some layouts and not
  // on others, so their Shift state is ignored.
  if (event.key === "?") return "toggle-help";
  if (event.key === "+") return "increase-font";

  if (event.shiftKey) {
    switch (event.key) {
      case " ":
        return "previous-page";
      case "ArrowRight":
        return "next-section";
      case "ArrowLeft":
        return "previous-section";
      default:
        return null;
    }
  }

  switch (event.key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
      return "next-page";
    case "ArrowLeft":
    case "PageUp":
      return "previous-page";
    case "Home":
      return "section-start";
    case "End":
      return "section-end";
    case "]":
      return "next-section";
    case "[":
      return "previous-section";
    case "=":
      return "increase-font";
    case "-":
      return "decrease-font";
  }

  // Caps Lock reports uppercase letters without Shift.
  switch (event.key.toLowerCase()) {
    case "c":
      return "toggle-contents";
    case "b":
      return "toggle-bookmarks";
    case "h":
      return "toggle-annotations";
    case "a":
      return "toggle-appearance";
    default:
      return null;
  }
};

export const getReaderShortcutAction = (
  event: ReaderShortcutKeyInput,
): ReaderShortcutAction | null => {
  const action = resolveAction(event);
  if (!action || (event.repeat && !READER_SHORTCUT_BEHAVIOR[action].repeatable)) return null;
  return action;
};

export type ReaderShortcutHelpGroup = {
  title: string;
  shortcuts: ReadonlyArray<{ keys: ReadonlyArray<ReadonlyArray<string>>; label: string }>;
};

// Each entry in `keys` is one alternative; each alternative is a key chord.
export const READER_SHORTCUT_HELP: ReadonlyArray<ReaderShortcutHelpGroup> = [
  {
    title: "Pages",
    shortcuts: [
      { keys: [["→"], ["Space"], ["Page Down"]], label: "Next page" },
      { keys: [["←"], ["Shift", "Space"], ["Page Up"]], label: "Previous page" },
      { keys: [["Home"]], label: "First page of chapter" },
      { keys: [["End"]], label: "Last page of chapter" },
      { keys: [["]"], ["Shift", "→"]], label: "Next chapter" },
      { keys: [["["], ["Shift", "←"]], label: "Previous chapter" },
    ],
  },
  {
    title: "Tools",
    shortcuts: [
      { keys: [["Cmd/Ctrl", "F"]], label: "Search this book" },
      { keys: [["C"]], label: "Contents" },
      { keys: [["B"]], label: "Bookmarks" },
      { keys: [["Cmd/Ctrl", "D"]], label: "Bookmark this page" },
      { keys: [["H"]], label: "Highlights and notes" },
      { keys: [["A"]], label: "Appearance" },
      { keys: [["+"]], label: "Larger text" },
      { keys: [["-"]], label: "Smaller text" },
      { keys: [["Esc"]], label: "Close panel" },
      { keys: [["?"]], label: "Show keyboard shortcuts" },
    ],
  },
];
