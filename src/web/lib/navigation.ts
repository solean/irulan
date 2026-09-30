export const getBookshelfHref = (bookshelfId?: string | null) => {
  if (!bookshelfId) return "/";
  const params = new URLSearchParams({ shelf: bookshelfId });
  return `/?${params.toString()}`;
};

export const getBookHref = (bookId: string, bookshelfId?: string | null) => {
  if (!bookshelfId) return `/books/${bookId}`;
  const params = new URLSearchParams({ shelf: bookshelfId });
  return `/books/${bookId}?${params.toString()}`;
};

export const getReaderHref = (bookId: string, bookshelfId?: string | null) => {
  if (!bookshelfId) return `/books/${bookId}/read`;
  const params = new URLSearchParams({ shelf: bookshelfId });
  return `/books/${bookId}/read?${params.toString()}`;
};

export const getReaderSearch = (bookshelfId?: string | null) =>
  bookshelfId ? new URLSearchParams({ shelf: bookshelfId }).toString() : "";

// The window never scrolls; each shell's <main id="content"> is the page's
// scroll pane, so scroll resets target it rather than `window`.
export const scrollContentToTop = () => {
  document.getElementById("content")?.scrollTo({ top: 0, behavior: "auto" });
};

// Reading always happens in a dedicated window: a native window via the
// Electron bridge, or a separate browser window as a fallback. `search` is the
// reader query string (e.g. "shelf=…") without the leading "?".
export const openReaderWindow = (bookId: string, search = "") => {
  const bridge = typeof window !== "undefined" ? window.irulan : undefined;
  if (bridge?.openReader) {
    void bridge.openReader(bookId, search);
    return;
  }

  const popoutSearch = search ? `${search}&popout=1` : "popout=1";
  window.open(
    `/books/${bookId}/read?${popoutSearch}`,
    "_blank",
    "noopener,width=900,height=1000",
  );
};
