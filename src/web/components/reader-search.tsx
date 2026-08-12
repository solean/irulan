import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_BOOK_SEARCH_PAGE_SIZE,
  MAX_BOOK_SEARCH_QUERY_LENGTH,
  type BookSearchResult,
  type ReaderTextRange,
} from "../../shared/types";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { api } from "../lib/api";
import { numberFormatter } from "../lib/format";

type ReaderSearchProps = {
  bookId: string;
  onNavigate: (range: ReaderTextRange) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const SEARCH_DEBOUNCE_MS = 180;

export const ReaderSearch = ({ bookId, onNavigate, onOpenChange, open }: ReaderSearchProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const latestRequest = useRef(0);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [requestedQuery, setRequestedQuery] = useState("");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRequestedQuery(debouncedQuery.trim());
  }, [debouncedQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        onOpenChange(true);
        return;
      }

      if (open && event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;

    if (!requestedQuery) {
      setResults([]);
      setTotal(0);
      setActiveIndex(-1);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    void api
      .searchBook(bookId, requestedQuery, { limit: MAX_BOOK_SEARCH_PAGE_SIZE })
      .then((page) => {
        if (latestRequest.current !== requestId) return;
        setResults(page.results);
        setTotal(page.total);
        setActiveIndex(page.results.length > 0 ? 0 : -1);
      })
      .catch((requestError) => {
        if (latestRequest.current !== requestId) return;
        setResults([]);
        setTotal(0);
        setActiveIndex(-1);
        setError(requestError instanceof Error ? requestError.message : "Could not search this book.");
      })
      .finally(() => {
        if (latestRequest.current === requestId) setLoading(false);
      });
  }, [bookId, requestedQuery]);

  const submitSearch = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      setRequestedQuery(query.trim());
    },
    [query],
  );

  const navigateToResult = useCallback(
    (result: BookSearchResult) => {
      onNavigate(result.range);
      onOpenChange(false);
    },
    [onNavigate, onOpenChange],
  );

  const onSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(results.length - 1, Math.max(0, current + 1)));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          current < 0 ? Math.max(0, results.length - 1) : Math.max(0, current - 1),
        );
        return;
      }

      if (event.key === "Enter" && query.trim() === requestedQuery && activeIndex >= 0) {
        event.preventDefault();
        const result = results[activeIndex];
        if (result) navigateToResult(result);
      }
    },
    [activeIndex, navigateToResult, query, requestedQuery, results],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || results.length >= total || !requestedQuery) return;
    const requestId = latestRequest.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.searchBook(bookId, requestedQuery, {
        offset: results.length,
        limit: MAX_BOOK_SEARCH_PAGE_SIZE,
      });
      if (latestRequest.current !== requestId) return;
      setResults((current) => [...current, ...page.results]);
      setTotal(page.total);
    } catch (requestError) {
      if (latestRequest.current !== requestId) return;
      setError(requestError instanceof Error ? requestError.message : "Could not load more results.");
    } finally {
      if (latestRequest.current === requestId) setLoadingMore(false);
    }
  }, [bookId, loadingMore, requestedQuery, results.length, total]);

  if (!open) return null;

  return (
    <aside aria-label="Search this book" className="reader-tool-panel" role="dialog">
      <div className="reader-tool-panel-header">
        <div>
          <p className="eyebrow">Reader search</p>
          <h2>Search this book</h2>
        </div>
        <Button aria-label="Close search" onClick={() => onOpenChange(false)} size="sm" variant="ghost">
          Close
        </Button>
      </div>

      <form className="reader-search-form" onSubmit={submitSearch} role="search">
        <label className="sr-only" htmlFor="reader-book-search">
          Search the full book
        </label>
        <Input
          aria-activedescendant={activeIndex >= 0 ? `reader-search-result-${activeIndex}` : undefined}
          aria-controls="reader-search-results"
          autoComplete="off"
          id="reader-book-search"
          maxLength={MAX_BOOK_SEARCH_QUERY_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search every section…"
          ref={inputRef}
          type="search"
          value={query}
        />
        <Button disabled={!query.trim() || loading} type="submit">
          Search
        </Button>
      </form>

      <div aria-live="polite" className="reader-search-status">
        {loading
          ? "Searching…"
          : requestedQuery
            ? `${numberFormatter.format(total)} ${total === 1 ? "result" : "results"}`
            : "Enter a word or phrase."}
      </div>

      {error ? <p className="inline-error">{error}</p> : null}

      <div className="reader-search-results" id="reader-search-results" role="listbox">
        {results.map((result, index) => (
          <div key={`${result.sectionHref}:${result.range.offset}`}>
            <button
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "reader-search-result active" : "reader-search-result"}
              id={`reader-search-result-${index}`}
              onClick={() => navigateToResult(result)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span className="reader-search-result-section">{result.sectionLabel}</span>
              <span className="reader-search-result-snippet">{result.snippet}</span>
            </button>
          </div>
        ))}
      </div>

      {results.length < total ? (
        <Button disabled={loadingMore} onClick={() => void loadMore()} type="button" variant="outline">
          {loadingMore ? "Loading…" : `Load more (${numberFormatter.format(total - results.length)} remaining)`}
        </Button>
      ) : null}
    </aside>
  );
};
