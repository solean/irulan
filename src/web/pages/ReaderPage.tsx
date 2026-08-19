import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  BookReader,
  ReaderBookmark,
  BookReaderSection,
  ReaderTextLocation,
  ReaderTextRange,
} from "../../shared/types";
import { SkeletonLine } from "../components/bookshelf";
import { ReaderAnnotations } from "../components/reader-annotations";
import { ReaderBookmarks } from "../components/reader-bookmarks";
import {
  ReaderFontSelect,
  ReaderFontSizeToggle,
  ReaderSpacingToggle,
  ReaderToneToggle,
} from "../components/reader-appearance-controls";
import { ReaderSearch } from "../components/reader-search";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ContentsIcon,
  HighlightIcon,
  SearchIcon,
} from "../components/icons";
import { useDocumentTitle } from "../hooks/use-document-title";
import { api } from "../lib/api";
import { numberFormatter } from "../lib/format";
import { getBookHref } from "../lib/navigation";
import {
  createReaderAssetSection,
  getReaderDocumentTitle,
  getReaderBookPagePosition,
  parseReaderMarkup,
  renderReaderDocument,
  resolveReaderSectionLabels,
  type ReaderLinkTarget,
} from "../lib/reader";
import {
  hasReaderTextLocationOnPage,
  resolveReaderTextLocation,
  resolveReaderTextRange,
  serializeReaderViewportLocation,
} from "../lib/reader-location";
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_SPACING,
  getStoredReaderFont,
  getStoredReaderFontScale,
  getStoredReaderProgress,
  getStoredReaderSpacing,
  getStoredReaderTone,
  READER_FONTS,
  READER_MAX_FONT_SCALE,
  READER_MIN_FONT_SCALE,
  READER_SPACINGS,
  setStoredReaderFont,
  setStoredReaderFontScale,
  setStoredReaderProgress,
  setStoredReaderSpacing,
  setStoredReaderTone,
  type ReaderFontId,
  type ReaderSpacingId,
  type ReaderTone,
} from "../lib/storage";

// Sentinel used when paging backwards across a chapter boundary. The previous
// chapter length is unknown until it loads and is measured, so the target is
// clamped to the real final page after measurement.
const READER_LAST_PAGE = Number.MAX_SAFE_INTEGER;
const DEFAULT_READER_CHARACTERS_PER_PAGE = 1_100;
const MIN_READER_CALIBRATION_PAGES = 4;
const READER_TEXT_FLOW_EFFICIENCY = 0.82;

type ReaderBookPagination = Readonly<{
  bookId: string;
  charactersPerPage: number;
  sectionPageCounts: ReadonlyMap<string, number>;
  signature: string;
}>;

type ReaderBookmarksState = Readonly<{
  bookId: string;
  bookmarks: ReaderBookmark[];
  error: string | null;
  loading: boolean;
}>;

const getReaderSectionMarkup = async (
  section: BookReaderSection,
  markupCache: Map<string, string>,
) => {
  const cachedMarkup = markupCache.get(section.href);
  if (cachedMarkup) return cachedMarkup;

  const response = await fetch(section.url, {
    headers: {
      Accept: "application/xhtml+xml, text/html;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}.`);
  }

  const markup = await response.text();
  markupCache.set(section.href, markup);
  return markup;
};

const measureReaderSectionPagination = (body: HTMLElement, pageWidth: number) => {
  const columnGap = Number.parseFloat(window.getComputedStyle(body).columnGap || "0");
  const stride = pageWidth + columnGap;
  if (stride <= 0) return null;

  // scrollWidth spans whole column boxes, so total / stride rounds to the exact
  // column count. Deriving the span back out keeps every page edge aligned.
  const total = body.scrollWidth + columnGap;
  const pageCount = Math.max(1, Math.round(total / stride));
  return {
    pageCount,
    pageSpan: total / pageCount,
  };
};
const estimateReaderCharactersPerPage = (body: HTMLElement, bounds: DOMRect) => {
  const style = window.getComputedStyle(body);
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.5;
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return DEFAULT_READER_CHARACTERS_PER_PAGE;

  context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  const sample = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz 0123456789";
  const averageCharacterWidth = context.measureText(sample).width / sample.length + letterSpacing;
  if (averageCharacterWidth <= 0 || lineHeight <= 0) {
    return DEFAULT_READER_CHARACTERS_PER_PAGE;
  }

  const charactersPerLine = bounds.width / averageCharacterWidth;
  const linesPerPage = bounds.height / lineHeight;
  return Math.max(
    1,
    Math.round(charactersPerLine * linesPerPage * READER_TEXT_FLOW_EFFICIENCY),
  );
};




export const ReaderPage = () => {
  const { bookId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const readerViewportRef = useRef<HTMLDivElement | null>(null);
  const readerBodyRef = useRef<HTMLElement | null>(null);
  const sectionMarkupCache = useRef(new Map<string, string>());
  const latestSectionRequest = useRef(0);
  // In-flight drag gesture on the reading viewport, if any. Lives in a ref so
  // pointermove never re-renders; only engage/release touch React state.
  const readerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    prevX: number;
    prevTime: number;
    lastX: number;
    lastTime: number;
    engaged: boolean;
    rejected: boolean;
  } | null>(null);
  // Swallow the click that follows a completed page drag so it doesn't
  // activate a link the pointer happened to be over.
  const suppressPageClickRef = useRef(false);

  const [reader, setReader] = useState<BookReader | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionDocument, setSectionDocument] = useState<Document | null>(null);
  // Href of the section currently shown by sectionDocument. Updated atomically
  // with the document so the displayed chapter never lags the URL during loads.
  const [displayedHref, setDisplayedHref] = useState<string | null>(null);
  const [sectionTitle, setSectionTitle] = useState<string | null>(null);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageSpan, setPageSpan] = useState(0);
  const [bookPagination, setBookPagination] = useState<ReaderBookPagination | null>(null);
  // Transform of the on-screen chapter, held steady while a new chapter loads
  // so the outgoing one doesn't snap back to its start mid-fetch.
  const frozenOffsetRef = useRef(0);
  const [tone, setTone] = useState<ReaderTone>(() => getStoredReaderTone() ?? "paper");
  const [fontScale, setFontScale] = useState(() => getStoredReaderFontScale() ?? 1);
  const [fontFamily, setFontFamily] = useState<ReaderFontId>(
    () => getStoredReaderFont() ?? DEFAULT_READER_FONT,
  );
  const [lineSpacing, setLineSpacing] = useState<ReaderSpacingId>(
    () => getStoredReaderSpacing() ?? DEFAULT_READER_SPACING,
  );
  // Which immersive (popout) popover is open, if any.
  const [readerPanel, setReaderPanel] = useState<null | "contents" | "appearance">(null);
  // True while a pointer drag is actively moving the page (suppresses text
  // selection and switches the cursor).
  const [isDraggingPage, setIsDraggingPage] = useState(false);
  const [readerToolPanel, setReaderToolPanel] = useState<
    null | "search" | "bookmarks" | "annotations"
  >(null);
  const [activeSearchRange, setActiveSearchRange] = useState<ReaderTextRange | null>(null);
  const [pendingReaderTarget, setPendingReaderTarget] = useState<
    ReaderTextLocation | ReaderTextRange | null
  >(null);
  const [readerToolNavigationError, setReaderToolNavigationError] = useState<string | null>(null);
  const [readerBookmarksState, setReaderBookmarksState] = useState<ReaderBookmarksState>(() => ({
    bookId,
    bookmarks: [],
    error: null,
    loading: true,
  }));
  const [bookmarkedPage, setBookmarkedPage] = useState<{
    bookId: string;
    page: number;
    sectionHref: string;
  } | null>(null);
  const readerBookmarks =
    readerBookmarksState.bookId === bookId ? readerBookmarksState.bookmarks : [];
  const readerBookmarksLoading =
    readerBookmarksState.bookId !== bookId || readerBookmarksState.loading;
  const readerBookmarksLoadError =
    readerBookmarksState.bookId === bookId ? readerBookmarksState.error : null;
  const displayedBookmarkLocations = useMemo(() => {
    if (!displayedHref) return [];
    const locations: ReaderTextLocation[] = [];
    for (const bookmark of readerBookmarks) {
      if (bookmark.location.sectionHref === displayedHref) {
        locations.push(bookmark.location);
      }
    }
    return locations;
  }, [displayedHref, readerBookmarks]);

  const selectedHref = searchParams.get("section")?.trim() ?? "";
  const anchorId = searchParams.get("anchor")?.trim() ?? null;
  const readerBookshelfId = searchParams.get("shelf");
  const bookDetailHref = getBookHref(bookId, readerBookshelfId);
  const isPopout = searchParams.get("popout") === "1";
  const currentPage = Math.max(
    1,
    Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
  );
  // Memoized so its identity only changes when the section actually does: the
  // asset fallback allocates a fresh object, and the section-loading effect
  // below depends on this value.
  const activeSection = useMemo(() => {
    if (!reader) return null;
    if (!selectedHref) return reader.sections[0] ?? null;

    return (
      reader.sections.find((section) => section.href === selectedHref) ??
      createReaderAssetSection(bookId, selectedHref)
    );
  }, [bookId, reader, selectedHref]);
  const currentSectionIndex =
    reader && activeSection
      ? reader.sections.findIndex((section) => section.href === activeSection.href)
      : -1;
  const previousSection =
    reader && currentSectionIndex > 0 ? reader.sections[currentSectionIndex - 1] : null;
  const nextSection =
    reader && currentSectionIndex >= 0 && currentSectionIndex < reader.sections.length - 1
      ? reader.sections[currentSectionIndex + 1]
      : null;
  const sectionLabels = useMemo(
    () => (reader ? resolveReaderSectionLabels(reader.sections, reader.title) : []),
    [reader],
  );
  const activeSectionLabel =
    sectionTitle ??
    (currentSectionIndex >= 0 ? sectionLabels[currentSectionIndex] : activeSection?.label) ??
    reader?.title ??
    "Reader";
  const readerFontStack =
    READER_FONTS.find((font) => font.id === fontFamily)?.stack ?? READER_FONTS[0].stack;
  const readerLineHeight =
    READER_SPACINGS.find((spacing) => spacing.id === lineSpacing)?.value ?? READER_SPACINGS[1].value;
  const readerStyle = {
    "--reader-font-scale": `${fontScale}`,
    "--reader-font-family": readerFontStack,
    "--reader-line-height": readerLineHeight,
  } as CSSProperties;
  const currentPageIndex = Math.min(Math.max(0, currentPage - 1), Math.max(0, pageCount - 1));
  const pageOffset = pageSpan > 0 ? currentPageIndex * pageSpan : 0;
  const currentBookPagination = bookPagination?.bookId === bookId ? bookPagination : null;
  const bookPagePosition = useMemo(() => {
    if (!reader || !activeSection) return null;

    return getReaderBookPagePosition(
      reader.sections,
      currentBookPagination?.sectionPageCounts ?? null,
      activeSection.href,
      currentPageIndex + 1,
      currentBookPagination?.charactersPerPage ?? DEFAULT_READER_CHARACTERS_PER_PAGE,
    );
  }, [activeSection, currentBookPagination, currentPageIndex, reader]);
  const readerPageStatus = bookPagePosition
    ? `Page ${numberFormatter.format(bookPagePosition.currentPage)} of ${numberFormatter.format(bookPagePosition.totalPages)}`
    : !activeSection
      ? "No readable pages"
      : "Linked section";

  // While a new (uncached) chapter is fetching, the displayed document still
  // belongs to the previous section. Hold it steady at its last offset so it
  // doesn't snap; the atomic swap in loadSection then remounts the new chapter.
  const isSwappingSection =
    sectionDocument !== null && displayedHref !== null && displayedHref !== activeSection?.href;
  const displayedOffset = isSwappingSection ? frozenOffsetRef.current : pageOffset;
  // The section the on-screen document belongs to (the previous one mid-swap).
  const displayedSection =
    (displayedHref
      ? reader?.sections.find((section) => section.href === displayedHref)
      : null) ?? activeSection;

  useLayoutEffect(() => {
    const root = readerBodyRef.current;
    const isBookmarked =
      root !== null &&
      displayedHref !== null &&
      pageSpan > 0 &&
      !sectionLoading &&
      !isSwappingSection &&
      hasReaderTextLocationOnPage(
        root,
        pageSpan,
        currentPage,
        displayedBookmarkLocations,
      );

    setBookmarkedPage(
      isBookmarked
        ? {
            bookId,
            page: currentPage,
            sectionHref: displayedHref,
          }
        : null,
    );
  }, [
    bookId,
    currentPage,
    displayedBookmarkLocations,
    displayedHref,
    fontFamily,
    fontScale,
    isSwappingSection,
    lineSpacing,
    pageSpan,
    sectionDocument,
    sectionLoading,
  ]);

  const isCurrentPageBookmarked =
    !sectionLoading &&
    !isSwappingSection &&
    bookmarkedPage?.bookId === bookId &&
    bookmarkedPage.page === currentPage &&
    bookmarkedPage.sectionHref === displayedHref;

  useEffect(() => {
    if (!isSwappingSection) {
      frozenOffsetRef.current = pageOffset;
    }
  }, [isSwappingSection, pageOffset]);

  useDocumentTitle(
    reader
      ? `${activeSectionLabel} \u2022 ${reader.title} \u2022 Irulan`
      : "Reader \u2022 Irulan",
  );

  useEffect(() => {
    setStoredReaderTone(tone);
  }, [tone]);

  useEffect(() => {
    setStoredReaderFontScale(fontScale);
  }, [fontScale]);

  useEffect(() => {
    setStoredReaderFont(fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    setStoredReaderSpacing(lineSpacing);
  }, [lineSpacing]);


  const goToSection = useCallback(
    (
      href: string,
      options: {
        anchor?: string | null;
        page?: number | null;
        replace?: boolean;
      } = {},
    ) => {
      if (!href) return;

      const params = new URLSearchParams();
      params.set("section", href);
      if (readerBookshelfId) {
        params.set("shelf", readerBookshelfId);
      }
      if (isPopout) {
        params.set("popout", "1");
      }

      if (options.anchor) {
        params.set("anchor", options.anchor);
      }

      if (typeof options.page === "number" && Number.isFinite(options.page)) {
        params.set("page", String(Math.max(1, Math.round(options.page))));
      } else if (!options.anchor) {
        params.set("page", "1");
      }

      startTransition(() => {
        setSearchParams(params, { replace: options.replace });
      });
    },
    [isPopout, readerBookshelfId, setSearchParams],
  );

  const goToPage = useCallback(
    (
      nextPage: number,
      options: {
        preserveAnchor?: boolean;
        replace?: boolean;
      } = {},
    ) => {
      if (!activeSection?.href) return;

      const params = new URLSearchParams();
      params.set("section", activeSection.href);
      params.set("page", String(Math.max(1, Math.round(nextPage))));
      if (readerBookshelfId) {
        params.set("shelf", readerBookshelfId);
      }
      if (isPopout) {
        params.set("popout", "1");
      }

      if (options.preserveAnchor && anchorId) {
        params.set("anchor", anchorId);
      }

      startTransition(() => {
        setSearchParams(params, { replace: options.replace });
      });
    },
    [activeSection?.href, anchorId, isPopout, readerBookshelfId, setSearchParams],
  );

  const navigateToReaderTarget = useCallback(
    (target: ReaderTextLocation | ReaderTextRange) => {
      setPendingReaderTarget(target);
      setReaderToolNavigationError(null);
      goToSection(target.sectionHref, {
        replace: target.sectionHref === activeSection?.href,
      });
    },
    [activeSection?.href, goToSection],
  );

  const navigateToSearchRange = useCallback(
    (range: ReaderTextRange) => {
      setActiveSearchRange(range);
      navigateToReaderTarget(range);
    },
    [navigateToReaderTarget],
  );

  const getCurrentReaderLocation = useCallback(() => {
    const root = readerBodyRef.current;
    const viewport = readerViewportRef.current;
    if (
      !root ||
      !viewport ||
      !displayedHref ||
      displayedHref !== activeSection?.href ||
      sectionLoading ||
      isSwappingSection
    ) {
      return null;
    }
    return serializeReaderViewportLocation(displayedHref, root, viewport);
  }, [activeSection?.href, displayedHref, isSwappingSection, sectionLoading]);

  const persistReaderProgress = useEffectEvent(() => {
    if (!reader || !selectedHref || pendingReaderTarget || pageSpan <= 0) return;
    const location = getCurrentReaderLocation();
    if (location) setStoredReaderProgress(bookId, location);
  });

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(persistReaderProgress);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    bookId,
    currentPage,
    displayedHref,
    isSwappingSection,
    pageSpan,
    pendingReaderTarget,
    reader,
    sectionDocument,
    sectionLoading,
    selectedHref,
  ]);

  const getReaderSectionLabel = useCallback(
    (href: string) => {
      const index = reader?.sections.findIndex((section) => section.href === href) ?? -1;
      return index >= 0 ? (sectionLabels[index] ?? reader?.sections[index]?.label ?? href) : href;
    },
    [reader, sectionLabels],
  );

  const setReaderSearchOpen = useCallback((open: boolean) => {
    if (open) setReaderPanel(null);
    setReaderToolPanel(open ? "search" : null);
  }, []);

  const setReaderBookmarksOpen = useCallback((open: boolean) => {
    if (open) setReaderPanel(null);
    setReaderToolPanel(open ? "bookmarks" : null);
  }, []);

  const setReaderAnnotationsOpen = useCallback((open: boolean) => {
    if (open) setReaderPanel(null);
    setReaderToolPanel(open ? "annotations" : null);
  }, []);

  const onReaderBookmarkAdded = useCallback((bookmark: ReaderBookmark) => {
    setReaderBookmarksState((current) =>
      current.bookId === bookmark.bookId
        ? { ...current, bookmarks: [bookmark, ...current.bookmarks] }
        : current,
    );
  }, []);

  const onReaderBookmarkUpdated = useCallback((bookmark: ReaderBookmark) => {
    setReaderBookmarksState((current) =>
      current.bookId === bookmark.bookId
        ? {
            ...current,
            bookmarks: current.bookmarks.map((currentBookmark) =>
              currentBookmark.id === bookmark.id ? bookmark : currentBookmark,
            ),
          }
        : current,
    );
  }, []);

  const onReaderBookmarkDeleted = useCallback(
    (bookmarkId: string) => {
      setReaderBookmarksState((current) =>
        current.bookId === bookId
          ? {
              ...current,
              bookmarks: current.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
            }
          : current,
      );
    },
    [bookId],
  );

  useEffect(() => {
    let active = true;
    setReaderBookmarksState({
      bookId,
      bookmarks: [],
      error: null,
      loading: true,
    });

    void api
      .listReaderBookmarks(bookId)
      .then((bookmarks) => {
        if (active) {
          setReaderBookmarksState({ bookId, bookmarks, error: null, loading: false });
        }
      })
      .catch((requestError) => {
        if (active) {
          setReaderBookmarksState({
            bookId,
            bookmarks: [],
            error:
              requestError instanceof Error
                ? requestError.message
                : "Could not load bookmarks.",
            loading: false,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [bookId]);

  const loadReader = useEffectEvent(async () => {
    setLoading(true);
    setError(null);

    try {
      setReader(await api.getBookReader(bookId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load this EPUB.");
    } finally {
      setLoading(false);
    }
  });

  const loadSection = useEffectEvent(async (section: BookReaderSection) => {
    const requestId = latestSectionRequest.current + 1;
    latestSectionRequest.current = requestId;

    setSectionLoading(true);
    setSectionError(null);

    try {
      const markup = await getReaderSectionMarkup(section, sectionMarkupCache.current);

      const nextDocument = parseReaderMarkup(markup);

      if (requestId !== latestSectionRequest.current) {
        return;
      }

      setSectionDocument(nextDocument);
      setDisplayedHref(section.href);
      setSectionTitle(getReaderDocumentTitle(nextDocument));
    } catch (requestError) {
      if (requestId !== latestSectionRequest.current) {
        return;
      }

      setSectionDocument(null);
      setDisplayedHref(null);
      setSectionTitle(null);
      setSectionError(
        requestError instanceof Error ? requestError.message : "Could not load this section.",
      );
    } finally {
      if (requestId === latestSectionRequest.current) {
        setSectionLoading(false);
      }
    }
  });

  useEffect(() => {
    sectionMarkupCache.current.clear();
    setReader(null);
    setError(null);
    setSectionDocument(null);
    setSectionTitle(null);
    setSectionError(null);
    setBookPagination(null);
    void loadReader();
  }, [bookId]);

  useEffect(() => {
    if (!reader || reader.sections.length === 0 || selectedHref) {
      return;
    }

    // No section in the URL means the reader was just opened: resume the saved
    // position if one belongs to this book's spine, otherwise start at the top.
    const saved = getStoredReaderProgress(bookId);
    if (saved && reader.sections.some((section) => section.href === saved.sectionHref)) {
      setPendingReaderTarget(saved);
      goToSection(saved.sectionHref, { replace: true });
      return;
    }

    goToSection(reader.sections[0]?.href ?? "", { replace: true });
  }, [bookId, goToSection, reader, selectedHref]);

  useEffect(() => {
    setSectionError(null);

    if (!activeSection) {
      setSectionDocument(null);
      setDisplayedHref(null);
      setSectionTitle(null);
      setSectionLoading(false);
      setPageCount(1);
      setPageSpan(0);
      return;
    }

    // Synchronous path for already-fetched chapters: parse and swap in the
    // same commit so we never flash the skeleton between sections. Bump the
    // request id so any in-flight fetch for a prior section is discarded.
    const cachedMarkup = sectionMarkupCache.current.get(activeSection.href);
    if (cachedMarkup) {
      latestSectionRequest.current += 1;
      const nextDocument = parseReaderMarkup(cachedMarkup);
      setSectionDocument(nextDocument);
      setDisplayedHref(activeSection.href);
      setSectionTitle(getReaderDocumentTitle(nextDocument));
      setSectionLoading(false);
      return;
    }

    // Uncached: keep the current chapter on screen (frozen via frozenOffsetRef)
    // while we fetch the new one, then swap atomically in loadSection. The
    // skeleton only appears on the very first load, when there's nothing yet to
    // hold in place. We deliberately do NOT null the document or reset
    // pagination here, so the outgoing chapter stays put during the fetch.
    void loadSection(activeSection);
  }, [activeSection]);

  const measurePagination = useEffectEvent(() => {
    const viewport = readerViewportRef.current;
    const body = readerBodyRef.current;
    if (!viewport || !body) {
      setPageCount(1);
      setPageSpan(0);
      return;
    }

    // Use the fractional content width, not the integer clientWidth: a sub-pixel
    // gap between the CSS column width and our page stride accumulates across a
    // chapter and eventually clips a few px of text at the viewport edge.
    const viewportBounds = viewport.getBoundingClientRect();
    const pageWidth = viewportBounds.width;
    body.style.setProperty("--reader-page-width", `${pageWidth}px`);

    const pagination = measureReaderSectionPagination(body, pageWidth);
    if (!pagination || viewportBounds.height <= 0) {
      setPageCount(1);
      setPageSpan(0);
      return;
    }

    const signature = [
      bookId,
      isPopout ? "immersive" : "windowed",
      fontFamily,
      fontScale,
      lineSpacing,
      viewportBounds.width.toFixed(3),
      viewportBounds.height.toFixed(3),
    ].join(":");
    const measuredSection = reader?.sections.find((section) => section.href === displayedHref);
    const typographyEstimate = estimateReaderCharactersPerPage(body, viewportBounds);

    setBookPagination((current) => {
      const sameLayout = current?.bookId === bookId && current.signature === signature;
      const sectionPageCounts = new Map(
        sameLayout ? current.sectionPageCounts : undefined,
      );
      if (measuredSection) {
        sectionPageCounts.set(measuredSection.href, pagination.pageCount);
      }

      let calibratedCharacters = 0;
      let calibratedPages = 0;
      for (const section of reader?.sections ?? []) {
        const measuredPages = sectionPageCounts.get(section.href);
        if (
          measuredPages !== undefined &&
          measuredPages >= MIN_READER_CALIBRATION_PAGES &&
          section.textLength > 0
        ) {
          calibratedCharacters += section.textLength;
          calibratedPages += measuredPages;
        }
      }
      const charactersPerPage =
        calibratedPages > 0 ? calibratedCharacters / calibratedPages : typographyEstimate;

      if (
        sameLayout &&
        current.charactersPerPage === charactersPerPage &&
        (!measuredSection ||
          current.sectionPageCounts.get(measuredSection.href) === pagination.pageCount)
      ) {
        return current;
      }

      return {
        bookId,
        charactersPerPage,
        sectionPageCounts,
        signature,
      };
    });
    setPageSpan(pagination.pageSpan);
    setPageCount(pagination.pageCount);
  });

  // Measure synchronously before the browser paints the new section so the
  // column width is correct on the first frame. A post-paint effect would let
  // the content render at the fallback column width and then reflow — the
  // visible "flash" when changing chapters.
  useLayoutEffect(() => {
    if (!sectionDocument || sectionLoading) {
      return;
    }

    measurePagination();

    const viewport = readerViewportRef.current;
    const body = readerBodyRef.current;
    if (!viewport || !body) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measurePagination();
    });

    observer.observe(viewport);
    observer.observe(body);
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) measurePagination();
    });


    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [fontFamily, fontScale, lineSpacing, sectionDocument, sectionLoading]);

  useEffect(() => {
    if (!activeSection?.href) {
      return;
    }

    // Wait for the swap to finish: mid-swap, pageCount still belongs to the
    // outgoing section, so clamping here would snap a restored page back to 1.
    if (sectionLoading || pageSpan <= 0 || isSwappingSection) {
      return;
    }

    const clampedPage = Math.max(1, Math.min(currentPage, pageCount));
    if (clampedPage !== currentPage) {
      goToPage(clampedPage, { preserveAnchor: true, replace: true });
    }
  }, [
    activeSection?.href,
    currentPage,
    goToPage,
    isSwappingSection,
    pageCount,
    pageSpan,
    sectionLoading,
  ]);

  useEffect(() => {
    if (sectionLoading || pageSpan <= 0) {
      return;
    }

    const root = readerBodyRef.current;
    if (!root) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (anchorId) {
        const escapedId =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(anchorId)
            : anchorId.replace(/[^\w-]/g, "\\$&");
        const escapedName = anchorId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const anchorTarget = root.querySelector<HTMLElement>(
          `#${escapedId}, [name="${escapedName}"]`,
        );

        if (anchorTarget) {
          const rootBounds = root.getBoundingClientRect();
          const targetBounds = anchorTarget.getBoundingClientRect();
          const absoluteLeft = targetBounds.left - rootBounds.left + pageOffset;
          const nextPage = Math.max(1, Math.floor(absoluteLeft / pageSpan) + 1);

          if (nextPage !== currentPage) {
            goToPage(nextPage, { preserveAnchor: true, replace: true });
            return;
          }

          return;
        }
      }

      if (currentPage !== 1) {
        return;
      }

      window.scrollTo({ top: 0, behavior: "auto" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [anchorId, currentPage, goToPage, pageOffset, pageSpan, sectionDocument, sectionLoading]);

  useLayoutEffect(() => {
    if (
      !pendingReaderTarget ||
      pendingReaderTarget.sectionHref !== displayedHref ||
      sectionLoading ||
      isSwappingSection ||
      pageSpan <= 0
    ) {
      return;
    }

    const root = readerBodyRef.current;
    if (!root) return;

    const animationFrame = window.requestAnimationFrame(() => {
      const resolved =
        "endOffset" in pendingReaderTarget
          ? resolveReaderTextRange(root, pendingReaderTarget)
          : resolveReaderTextLocation(root, pendingReaderTarget);
      if (!resolved) {
        setPendingReaderTarget(null);
        setReaderToolNavigationError("The saved text could not be located in this section.");
        return;
      }

      const targetBounds = resolved.getClientRects()[0] ?? resolved.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      const absoluteLeft = Math.max(0, targetBounds.left - rootBounds.left);
      const nextPage = Math.max(1, Math.min(pageCount, Math.floor(absoluteLeft / pageSpan) + 1));

      setPendingReaderTarget(null);
      if (nextPage !== currentPage) {
        goToPage(nextPage, { replace: true });
      }
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    currentPage,
    displayedHref,
    goToPage,
    isSwappingSection,
    pageCount,
    pageSpan,
    pendingReaderTarget,
    sectionLoading,
  ]);

  useLayoutEffect(() => {
    const highlightName = "reader-search-result";
    if (
      typeof CSS === "undefined" ||
      !CSS.highlights ||
      typeof Highlight === "undefined"
    ) {
      return;
    }

    CSS.highlights.delete(highlightName);
    const root = readerBodyRef.current;
    if (!root || !activeSearchRange || activeSearchRange.sectionHref !== displayedHref) {
      return;
    }

    const resolved = resolveReaderTextRange(root, activeSearchRange);
    if (!resolved) return;
    CSS.highlights.set(highlightName, new Highlight(resolved));

    return () => {
      CSS.highlights.delete(highlightName);
    };
  }, [activeSearchRange, displayedHref, sectionDocument]);

  const onInternalReaderLinkClick = useCallback(
    (
      event: MouseEvent<HTMLAnchorElement>,
      target: Extract<ReaderLinkTarget, { kind: "internal" }>,
    ) => {
      event.preventDefault();
      goToSection(target.href, {
        anchor: target.anchor,
        replace: target.href === activeSection?.href,
      });
    },
    [activeSection?.href, goToSection],
  );

  const onAdjustFontScale = useCallback((delta: number) => {
    setFontScale((current) => {
      const next = Number((current + delta).toFixed(2));
      return Math.max(READER_MIN_FONT_SCALE, Math.min(READER_MAX_FONT_SCALE, next));
    });
  }, []);

  const onTurnPage = useCallback(
    (direction: "previous" | "next") => {
      if (direction === "previous") {
        if (currentPage > 1) {
          goToPage(currentPage - 1);
          return;
        }

        if (previousSection) {
          // Land on the previous chapter's last page, not its first.
          goToSection(previousSection.href, { page: READER_LAST_PAGE });
        }
        return;
      }

      if (currentPage < pageCount) {
        goToPage(currentPage + 1);
        return;
      }

      if (nextSection) {
        goToSection(nextSection.href, { page: 1 });
      }
    },
    [currentPage, goToPage, goToSection, nextSection, pageCount, previousSection],
  );

  const handleReaderShortcut = useCallback(
    (key: string) => {
      if (key === "ArrowRight" || key === "PageDown" || key === " ") {
        onTurnPage("next");
        return true;
      }

      if (key === "ArrowLeft" || key === "PageUp") {
        onTurnPage("previous");
        return true;
      }

      if (key === "Home") {
        goToPage(1, { preserveAnchor: false });
        return true;
      }

      if (key === "End") {
        goToPage(pageCount, { preserveAnchor: false });
        return true;
      }

      return false;
    },
    [goToPage, onTurnPage, pageCount],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      const target =
        event.target instanceof HTMLElement || event.target instanceof SVGElement
          ? event.target
          : null;
      if (
        target?.closest(
          'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="combobox"], [role="dialog"], [role="link"], [role="listbox"], [role="menu"], [role="textbox"]',
        )
      ) {
        return;
      }

      if (target instanceof HTMLElement && target.isContentEditable) {
        return;
      }

      if (handleReaderShortcut(event.key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [handleReaderShortcut]);

  useEffect(() => {
    if (!readerPanel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReaderPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readerPanel]);

  const onReaderViewportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (handleReaderShortcut(event.key)) {
        event.preventDefault();
      }
    },
    [handleReaderShortcut],
  );

  // Slide the page body to a target offset with a short ease-out, then drop
  // the inline transition so React-driven jumps (chapter swaps) stay instant.
  const settleReaderBody = useCallback((offset: number) => {
    const body = readerBodyRef.current;
    if (!body) return;

    body.style.transition = "transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)";
    body.style.transform = `translate3d(${-offset}px, 0, 0)`;

    const clear = () => {
      body.style.transition = "";
      body.removeEventListener("transitionend", clear);
    };
    body.addEventListener("transitionend", clear);
    window.setTimeout(clear, 360);
  }, []);

  // Page turn with the slide animation. Within a chapter the body glides to
  // the neighbouring page; at chapter bounds it settles back and the regular
  // (instant) section turn takes over.
  const turnPageAnimated = useCallback(
    (direction: "previous" | "next") => {
      if (direction === "next" && currentPage < pageCount) {
        settleReaderBody(pageOffset + pageSpan);
        goToPage(currentPage + 1);
        return;
      }

      if (direction === "previous" && currentPage > 1) {
        settleReaderBody(pageOffset - pageSpan);
        goToPage(currentPage - 1);
        return;
      }

      settleReaderBody(pageOffset);
      onTurnPage(direction);
    },
    [currentPage, goToPage, onTurnPage, pageCount, pageOffset, pageSpan, settleReaderBody],
  );

  const turnPageAnimatedRef = useRef(turnPageAnimated);
  useEffect(() => {
    turnPageAnimatedRef.current = turnPageAnimated;
  });

  const onReaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      suppressPageClickRef.current = false;
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }
      if (isSwappingSection || pageSpan <= 0) {
        return;
      }

      readerDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        prevX: event.clientX,
        prevTime: event.timeStamp,
        lastX: event.clientX,
        lastTime: event.timeStamp,
        engaged: false,
        rejected: false,
      };
    },
    [isSwappingSection, pageSpan],
  );

  const onReaderPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = readerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || drag.rejected) {
        return;
      }

      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;

      if (!drag.engaged) {
        if (Math.abs(deltaY) > 18 && Math.abs(deltaY) > Math.abs(deltaX)) {
          // Vertical gesture — leave it to scrolling.
          drag.rejected = true;
          return;
        }
        if (Math.abs(deltaX) < 10 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
          return;
        }

        // A mouse drag that is already extending a text selection is the
        // user selecting, not page-turning.
        const selection = window.getSelection();
        if (event.pointerType === "mouse" && selection && !selection.isCollapsed) {
          drag.rejected = true;
          return;
        }

        drag.engaged = true;
        suppressPageClickRef.current = true;
        setIsDraggingPage(true);
        selection?.removeAllRanges();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer already released — the up/cancel handler will clean up.
        }
        const body = readerBodyRef.current;
        if (body) {
          body.style.transition = "none";
        }
      }

      drag.prevX = drag.lastX;
      drag.prevTime = drag.lastTime;
      drag.lastX = event.clientX;
      drag.lastTime = event.timeStamp;

      const body = readerBodyRef.current;
      if (!body) return;

      // Follow the pointer, with rubber-band resistance past either end of
      // the chapter.
      const maxOffset = Math.max(0, (pageCount - 1) * pageSpan);
      let target = displayedOffset - deltaX;
      if (target < 0) {
        target *= 0.35;
      } else if (target > maxOffset) {
        target = maxOffset + (target - maxOffset) * 0.35;
      }
      body.style.transform = `translate3d(${-target}px, 0, 0)`;
    },
    [displayedOffset, pageCount, pageSpan],
  );

  const finishReaderDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const drag = readerDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      readerDragRef.current = null;
      if (!drag.engaged) {
        return;
      }

      setIsDraggingPage(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const deltaX = event.clientX - drag.startX;
      const elapsed = event.timeStamp - drag.prevTime;
      const velocity = cancelled || elapsed <= 0 ? 0 : (event.clientX - drag.prevX) / elapsed;

      // Commit the turn past a quarter page, or on a quick flick.
      const distanceThreshold = Math.min(pageSpan * 0.25, 220);
      const isFlick = Math.abs(velocity) > 0.4 && Math.abs(deltaX) > 24;
      let direction: "previous" | "next" | null = null;
      if (!cancelled) {
        if (deltaX <= -distanceThreshold || (isFlick && velocity < 0)) {
          direction = "next";
        } else if (deltaX >= distanceThreshold || (isFlick && velocity > 0)) {
          direction = "previous";
        }
      }

      if (direction) {
        turnPageAnimated(direction);
        return;
      }

      settleReaderBody(displayedOffset);
    },
    [displayedOffset, pageSpan, settleReaderBody, turnPageAnimated],
  );

  const onReaderPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishReaderDrag(event, false);
    },
    [finishReaderDrag],
  );

  const onReaderPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishReaderDrag(event, true);
    },
    [finishReaderDrag],
  );

  const onReaderClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!suppressPageClickRef.current) return;
    suppressPageClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // Trackpad two-finger swipe (horizontal wheel) turns pages, Apple
  // Books-style. Attached manually: React wheel listeners are passive, and
  // preventDefault is needed to stop the browser's history-swipe gesture.
  const hasReadingSurface = Boolean(sectionDocument && displayedSection);
  useEffect(() => {
    if (!hasReadingSurface) return;
    const viewport = readerViewportRef.current;
    if (!viewport) return;

    let accumulated = 0;
    let lastEventTime = 0;
    let lastFlipTime = 0;
    let coolingDown = false;
    let recentMagnitudes: number[] = [];

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        return;
      }
      event.preventDefault();

      const now = event.timeStamp;
      const gap = now - lastEventTime;
      lastEventTime = now;
      const magnitude = Math.abs(event.deltaX);

      if (coolingDown) {
        // Momentum from the swipe that already turned the page decays
        // steadily, so a fresh swipe announces itself one of two ways: the
        // event stream goes quiet first, or the delta suddenly rises above
        // the decaying tail while the flip is comfortably in the past.
        const quiet = gap > 160;
        const rising =
          now - lastFlipTime > 250 &&
          magnitude >= 10 &&
          magnitude > Math.max(...recentMagnitudes, 0);
        if (!quiet && !rising) {
          recentMagnitudes = [...recentMagnitudes.slice(-2), magnitude];
          return;
        }
        coolingDown = false;
        accumulated = 0;
      } else if (gap > 300) {
        accumulated = 0;
      }

      recentMagnitudes = [...recentMagnitudes.slice(-2), magnitude];
      accumulated += event.deltaX;
      if (Math.abs(accumulated) < 90) {
        return;
      }

      const direction = accumulated > 0 ? "next" : "previous";
      accumulated = 0;
      coolingDown = true;
      lastFlipTime = now;
      turnPageAnimatedRef.current(direction);
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [hasReadingSurface]);

  if (loading && !reader) {
    return (
      <div className="page stack-lg">
        <Button asChild className="backlink" variant="ghost">
          <Link to={bookDetailHref}>
            <ArrowLeftIcon />
            Back to book
          </Link>
        </Button>

        <section aria-busy="true" className="reader-shell">
          <aside aria-hidden="true" className="panel reader-sidebar stack-sm">
            <div className="stack-xs">
              <SkeletonLine className="skeleton-line-small" />
              <SkeletonLine className="skeleton-line-heading" />
              <SkeletonLine className="skeleton-line-medium" />
            </div>
            <div className="skeleton-input" />
            <div className="stack-xs">
              {Array.from({ length: 6 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders; position is the only identity
                <div className="skeleton-button" key={`reader-skeleton-nav-${index}`} />
              ))}
            </div>
          </aside>
          <section aria-hidden="true" className="reader-content stack-sm">
            <div className="reader-toolbar">
              <div className="skeleton-button skeleton-button-secondary" />
              <SkeletonLine className="skeleton-line-medium" />
              <div className="skeleton-button skeleton-button-secondary" />
            </div>
            <div className="reader-canvas">
              <div className="reader-paper">
                <div className="stack-sm">
                  {Array.from({ length: 8 }, (_, index) => (
                    <SkeletonLine
                      className={index === 0 ? "skeleton-line-heading" : "skeleton-line-paragraph"}
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders; position is the only identity
                      key={`reader-paper-skeleton-${index}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </section>
      </div>
    );
  }

  if (!reader) {
    return (
      <div className="page stack-lg">
        <Button asChild className="backlink" variant="ghost">
          <Link to={bookDetailHref}>
            <ArrowLeftIcon />
            Back to book
          </Link>
        </Button>

        <section className="empty-state stack-sm">
          <h2>Reader unavailable</h2>
          <p>{error ?? "This EPUB could not be opened in the browser."}</p>
        </section>
      </div>
    );
  }

  const prevDisabled = currentPage === 1 && !previousSection;
  const nextDisabled = currentPage >= pageCount && !nextSection;

  const renderTocNav = (onAfterSelect?: () => void) => (
    <nav aria-label="Table of contents" className="reader-toc">
      {reader.sections.map((section, index) => (
        <Button
          aria-current={section.href === activeSection?.href ? "page" : undefined}
          className={cn(
            "reader-toc-item",
            section.href === activeSection?.href && "active",
          )}
          key={section.id}
          onClick={() => {
            goToSection(section.href);
            onAfterSelect?.();
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="reader-toc-index">{index + 1}</span>
          <span className="reader-toc-label">{sectionLabels[index] ?? section.label}</span>
        </Button>
      ))}
    </nav>
  );

  const toneToggle = <ReaderToneToggle onChange={setTone} tone={tone} />;
  const fontToggle = (
    <ReaderFontSizeToggle fontScale={fontScale} onAdjust={onAdjustFontScale} />
  );
  const fontFamilySelect = (
    <ReaderFontSelect fontFamily={fontFamily} onChange={setFontFamily} tone={tone} />
  );
  const spacingToggle = (
    <ReaderSpacingToggle onChange={setLineSpacing} spacing={lineSpacing} />
  );

  const readerTools = (
    <div className="reader-tone-scope reader-tools" data-reader-tone={tone}>
      <ReaderSearch
        bookId={bookId}
        onNavigate={navigateToSearchRange}
        onOpenChange={setReaderSearchOpen}
        open={readerToolPanel === "search"}
      />
      <ReaderBookmarks
        bookId={bookId}
        bookmarks={readerBookmarks}
        getCurrentLocation={getCurrentReaderLocation}
        getSectionLabel={getReaderSectionLabel}
        loadError={readerBookmarksLoadError}
        loading={readerBookmarksLoading}
        onBookmarkAdded={onReaderBookmarkAdded}
        onBookmarkDeleted={onReaderBookmarkDeleted}
        onBookmarkUpdated={onReaderBookmarkUpdated}
        onNavigate={navigateToReaderTarget}
        onOpenChange={setReaderBookmarksOpen}
        open={readerToolPanel === "bookmarks"}
      />
      <ReaderAnnotations
        bookId={bookId}
        contentRevision={sectionDocument}
        getSectionLabel={getReaderSectionLabel}
        onNavigate={navigateToReaderTarget}
        onOpenChange={setReaderAnnotationsOpen}
        open={readerToolPanel === "annotations"}
        readerRootRef={readerBodyRef}
        sectionHref={displayedHref}
        viewportRef={readerViewportRef}
      />
    </div>
  );

  // The reading surface (tinted ground + floating page + paginated body) is
  // identical in both layouts — only the surrounding chrome differs.
  const readingSurface = (
    <div
      className={cn("reader-canvas", isPopout && "reader-canvas-immersive")}
      data-reader-tone={tone}
      style={readerStyle}
    >
      <div className="reader-paper">
        {isCurrentPageBookmarked ? (
          <span
            aria-label="This page is bookmarked"
            className="reader-page-bookmark-indicator"
            role="img"
            title="Bookmarked page"
          >
            <BookmarkIcon />
          </span>
        ) : null}
        {sectionError ? <p className="inline-error">{sectionError}</p> : null}

        {!sectionDocument || !displayedSection ? (
          activeSection && !sectionError ? (
            <div aria-hidden="true" className="reader-loading stack-sm">
              {Array.from({ length: 9 }, (_, index) => (
                <SkeletonLine
                  className={index === 0 ? "skeleton-line-heading" : "skeleton-line-paragraph"}
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholders; position is the only identity
                  key={`reader-body-skeleton-${index}`}
                />
              ))}
            </div>
          ) : !sectionError ? (
            <div className="empty-state stack-sm">
              <h2>No readable sections</h2>
              <p>This EPUB does not include any linear spine items to display.</p>
            </div>
          ) : null
        ) : (
          // The viewport is a labelled region that also takes focus, so arrow
          // keys and swipes can turn pages without first clicking a control.
          <div
            aria-label={`Reading viewport, ${readerPageStatus}`}
            className={cn(
              "reader-page-window",
              isSwappingSection && "reader-page-window-loading",
              isDraggingPage && "reader-page-window-dragging",
            )}
            onClickCapture={onReaderClickCapture}
            onKeyDown={onReaderViewportKeyDown}
            onPointerCancel={onReaderPointerCancel}
            onPointerDown={onReaderPointerDown}
            onPointerMove={onReaderPointerMove}
            onPointerUp={onReaderPointerUp}
            ref={readerViewportRef}
            role="group"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: paging needs a keyboard focus target that is not a control
            tabIndex={0}
          >
            <article
              className="reader-body reader-body-paginated"
              key={displayedSection.href}
              onLoadCapture={() => {
                measurePagination();
              }}
              ref={readerBodyRef}
              style={{
                transform: `translate3d(-${displayedOffset}px, 0, 0)`,
              }}
            >
              {renderReaderDocument({
                bookId,
                document: sectionDocument,
                onInternalLinkClick: onInternalReaderLinkClick,
                section: displayedSection,
              })}
            </article>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Immersive layout (popped-out window) ───
  // The page owns the window; Contents and Appearance live in popovers, page
  // turns happen at the edges, and progress sits quietly at the bottom.
  if (isPopout) {
    return (
      <div className="reader-immersive reader-tone-scope" data-reader-tone={tone}>
        <header
          className="reader-immersive-bar"
          onPointerEnter={() => window.irulan?.setReaderWindowButtonsVisible(true)}
          onPointerLeave={() => window.irulan?.setReaderWindowButtonsVisible(false)}
        >
          <div className="reader-immersive-bar-group">
            <button
              aria-expanded={readerPanel === "contents"}
              aria-haspopup="dialog"
              aria-label="Contents"
              className={cn("reader-immersive-control", readerPanel === "contents" && "active")}
              onClick={() => setReaderPanel((panel) => (panel === "contents" ? null : "contents"))}
              type="button"
            >
              <ContentsIcon />
            </button>
            <button
              aria-expanded={readerToolPanel === "search"}
              aria-keyshortcuts="Meta+F Control+F"
              aria-label="Search this book"
              className={cn(
                "reader-immersive-control",
                readerToolPanel === "search" && "active",
              )}
              onClick={() => setReaderSearchOpen(readerToolPanel !== "search")}
              title="Search this book (Cmd/Ctrl+F)"
              type="button"
            >
              <SearchIcon />
            </button>
            <button
              aria-expanded={readerToolPanel === "bookmarks"}
              aria-label="Bookmarks"
              className={cn(
                "reader-immersive-control",
                readerToolPanel === "bookmarks" && "active",
              )}
              onClick={() => setReaderBookmarksOpen(readerToolPanel !== "bookmarks")}
              type="button"
            >
              <BookmarkIcon />
            </button>
            <button
              aria-expanded={readerToolPanel === "annotations"}
              aria-label="Highlights and notes"
              className={cn(
                "reader-immersive-control",
                readerToolPanel === "annotations" && "active",
              )}
              onClick={() => setReaderAnnotationsOpen(readerToolPanel !== "annotations")}
              type="button"
            >
              <HighlightIcon />
            </button>
          </div>

          <span className="reader-immersive-title">{reader.title}</span>

          <div className="reader-immersive-bar-group reader-immersive-bar-trail">
            <button
              aria-expanded={readerPanel === "appearance"}
              aria-haspopup="dialog"
              aria-label="Appearance"
              className={cn(
                "reader-immersive-control reader-immersive-control-aa",
                readerPanel === "appearance" && "active",
              )}
              onClick={() =>
                setReaderPanel((panel) => (panel === "appearance" ? null : "appearance"))
              }
              type="button"
            >
              Aa
            </button>
          </div>
        </header>

        <div className="reader-immersive-stage">
          <button
            aria-label="Previous page"
            className="reader-edge reader-edge-prev"
            disabled={prevDisabled}
            onClick={() => onTurnPage("previous")}
            type="button"
          >
            <ChevronLeftIcon />
          </button>

          {readingSurface}

          <button
            aria-label="Next page"
            className="reader-edge reader-edge-next"
            disabled={nextDisabled}
            onClick={() => onTurnPage("next")}
            type="button"
          >
            <ChevronRightIcon />
          </button>
        </div>

        <footer className="reader-immersive-footer">
          <span aria-live="polite" className="reader-immersive-page">
            {readerPageStatus}
          </span>
        </footer>

        {error ? <p className="inline-error reader-immersive-error">{error}</p> : null}
        {readerToolNavigationError ? (
          <p aria-live="polite" className="inline-error reader-immersive-error">
            {readerToolNavigationError}
          </p>
        ) : null}

        {readerPanel ? (
          <>
            <button
              aria-label="Close menu"
              className="reader-immersive-scrim"
              onClick={() => setReaderPanel(null)}
              type="button"
            />
            {readerPanel === "contents" ? (
              <div
                aria-label="Contents"
                className="reader-immersive-panel reader-immersive-panel-contents"
                role="dialog"
              >
                <div className="reader-immersive-panel-head stack-xs">
                  <p className="eyebrow">Contents</p>
                  <p className="reader-immersive-panel-title">{reader.title}</p>
                  <p className="detail-author">{reader.author}</p>
                </div>
                {renderTocNav(() => setReaderPanel(null))}
              </div>
            ) : (
              <div
                aria-label="Appearance"
                className="reader-immersive-panel reader-immersive-panel-appearance"
                role="dialog"
              >
                <div className="reader-immersive-field">
                  <span className="reader-immersive-field-label">Theme</span>
                  {toneToggle}
                </div>
                <div className="reader-immersive-field">
                  <span className="reader-immersive-field-label">Font</span>
                  {fontFamilySelect}
                </div>
                <div className="reader-immersive-field">
                  <span className="reader-immersive-field-label">Text size</span>
                  {fontToggle}
                </div>
                <div className="reader-immersive-field">
                  <span className="reader-immersive-field-label">Line spacing</span>
                  {spacingToggle}
                </div>
              </div>
            )}
          </>
        ) : null}
        {readerTools}
      </div>
    );
  }

  // ─── Standard in-window layout ───
  return (
    <div className="page stack-lg">
      <Button asChild className="backlink" variant="ghost">
        <Link to={bookDetailHref}>
          <ArrowLeftIcon />
          Back to book
        </Link>
      </Button>

      {error ? <p className="inline-error">{error}</p> : null}
      {readerToolNavigationError ? (
        <p aria-live="polite" className="inline-error">
          {readerToolNavigationError}
        </p>
      ) : null}

      <section className="reader-shell">
        <Card className="panel reader-sidebar stack-sm">
          <div className="stack-xs">
            <p className="eyebrow">Now reading</p>
            <h2>{reader.title}</h2>
            <p className="detail-author">{reader.author}</p>
          </div>

          {currentSectionIndex >= 0 ? (
            <div className="stat-chip reader-progress">
              <strong>{numberFormatter.format(currentSectionIndex + 1)}</strong>
              <span>of {numberFormatter.format(reader.sections.length)} sections</span>
            </div>
          ) : (
            <div className="stat-chip reader-progress">
              <strong>Linked</strong>
              <span>section</span>
            </div>
          )}

          <p className="eyebrow reader-toc-eyebrow">Contents</p>
          {renderTocNav()}
        </Card>

        <section className="reader-content">
          <div className="reader-toolbar">
            <div className="reader-toolbar-nav">
              <Button
                aria-keyshortcuts="ArrowLeft"
                disabled={prevDisabled}
                onClick={() => onTurnPage("previous")}
                title="Previous page (Left arrow)"
                type="button"
                variant="outline"
              >
                Previous page
              </Button>
              <Button
                aria-keyshortcuts="ArrowRight"
                disabled={nextDisabled}
                onClick={() => onTurnPage("next")}
                title="Next page (Right arrow)"
                type="button"
                variant="outline"
              >
                Next page
              </Button>
            </div>

            <div className="reader-toolbar-status">
              <strong className="reader-current-label">{activeSectionLabel}</strong>
              <span aria-live="polite" className="reader-page-status">
                {readerPageStatus}
              </span>
            </div>

            <div className="reader-toolbar-controls">
              <Button
                aria-expanded={readerToolPanel === "search"}
                aria-keyshortcuts="Meta+F Control+F"
                onClick={() => setReaderSearchOpen(readerToolPanel !== "search")}
                title="Search this book (Cmd/Ctrl+F)"
                type="button"
                variant="outline"
              >
                <SearchIcon />
                Search
              </Button>
              <Button
                aria-expanded={readerToolPanel === "bookmarks"}
                onClick={() => setReaderBookmarksOpen(readerToolPanel !== "bookmarks")}
                type="button"
                variant="outline"
              >
                <BookmarkIcon />
                Bookmarks
              </Button>
              <Button
                aria-expanded={readerToolPanel === "annotations"}
                onClick={() => setReaderAnnotationsOpen(readerToolPanel !== "annotations")}
                type="button"
                variant="outline"
              >
                <HighlightIcon />
                Highlights
              </Button>
              {toneToggle}
              {fontFamilySelect}
              {fontToggle}
              {spacingToggle}
            </div>
          </div>

          {readingSurface}
        </section>
      </section>
      {readerTools}
    </div>
  );
};
