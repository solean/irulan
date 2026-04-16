import type { FormEvent } from "react";
import { startTransition, useDeferredValue, useEffect, useEffectEvent, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

import type {
  BookDetail,
  BookSummary,
  DeliveryRecord,
  ImportResult,
  SettingsPayload,
} from "../shared/types";
import { api } from "./lib/api";

const numberFormatter = new Intl.NumberFormat(undefined);
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}\u00A0B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}\u00A0KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}\u00A0MB`;
};

const formatDate = (value: string | null) => {
  if (!value) return "\u2014";
  return dateFormatter.format(new Date(value));
};

const useDocumentTitle = (title: string) => {
  useEffect(() => {
    document.title = title;
  }, [title]);
};

const BookIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 3h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H2V3Z" />
    <path d="M14 3H9.5a2 2 0 0 0-2 2v9A1.5 1.5 0 0 1 9 12.5H14V3Z" />
  </svg>
);

const SettingsIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    <path d="M6.7 2.2a.7.7 0 0 1 .7-.7h1.2a.7.7 0 0 1 .7.7l.2 1.1a4.7 4.7 0 0 1 1.1.7l1-.4a.7.7 0 0 1 .8.3l.6 1a.7.7 0 0 1-.1.9l-.9.8v1.2l.9.7a.7.7 0 0 1 .1 1l-.6 1a.7.7 0 0 1-.8.3l-1-.4a4.8 4.8 0 0 1-1.1.7l-.2 1a.7.7 0 0 1-.7.7H7.4a.7.7 0 0 1-.7-.6l-.2-1.1a4.7 4.7 0 0 1-1.1-.7l-1 .4a.7.7 0 0 1-.9-.3l-.6-1a.7.7 0 0 1 .2-.9l.8-.8V7.5l-.8-.7a.7.7 0 0 1-.2-1l.6-1a.7.7 0 0 1 .9-.3l1 .4a4.7 4.7 0 0 1 1-.7l.3-1Z" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 12 6 8l4-4" />
  </svg>
);

const PlaceholderCover = ({ title }: { title: string }) => (
  <div className="book-cover-fallback" aria-hidden="true">
    <span>{title.trim().charAt(0).toUpperCase() || "B"}</span>
  </div>
);

const BookCover = ({ book, large = false }: { book: BookSummary; large?: boolean }) => (
  <div className={`book-cover ${large ? "book-cover-large" : ""}`}>
    {book.coverUrl ? (
      <img
        alt=""
        aria-hidden="true"
        className="book-cover-image"
        src={book.coverUrl}
        width={large ? 280 : 160}
        height={large ? 373 : 213}
        loading={large ? "eager" : "lazy"}
      />
    ) : (
      <PlaceholderCover title={book.title} />
    )}
  </div>
);

const UploadResults = ({ results }: { results: ImportResult[] }) => {
  if (results.length === 0) return null;

  return (
    <section aria-live="polite" className="panel stack-sm">
      <div className="section-heading">
        <h2>Import results</h2>
        <span>{numberFormatter.format(results.length)} file(s)</span>
      </div>
      <ul className="result-list">
        {results.map((result, index) => (
          <li
            className={`result-item result-${result.status}`}
            key={`${result.status}-${index}-${result.message}`}
          >
            <strong>{result.status}</strong>
            <span>{result.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

const Shell = () => {
  const location = useLocation();

  const pageTitle = (() => {
    if (location.pathname === "/settings") return "Settings";
    if (location.pathname.startsWith("/books/")) return "Book detail";
    return "Bookshelf";
  })();

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-icon">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 3h4.5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5H2V3Z" />
                <path d="M14 3H9.5a2 2 0 0 0-2 2v9A1.5 1.5 0 0 1 9 12.5H14V3Z" />
              </svg>
            </div>
            <h1>ebooks</h1>
          </div>
          <nav aria-label="Primary">
            <NavLink
              className={({ isActive }) => (isActive ? "navlink active" : "navlink")}
              to="/"
              end
            >
              <BookIcon />
              Bookshelf
            </NavLink>
            <NavLink
              className={({ isActive }) => (isActive ? "navlink active" : "navlink")}
              to="/settings"
            >
              <SettingsIcon />
              Settings
            </NavLink>
          </nav>
        </aside>
        <div className="main-area">
          <header className="main-header">
            <h2 className="main-header-title">{pageTitle}</h2>
          </header>
          <main className="content" id="content">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
};

const BookshelfPage = () => {
  useDocumentTitle("Bookshelf \u2022 ebook manager");

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);

  const deferredQuery = useDeferredValue(query);

  const loadBooks = useEffectEvent(async (term: string) => {
    setLoading(true);
    setError(null);

    try {
      const [nextBooks, nextSettings] = await Promise.all([
        api.listBooks(term),
        api.getSettings(),
      ]);
      setBooks(nextBooks);
      setSettings(nextSettings);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load books.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadBooks(deferredQuery);
  }, [deferredQuery]);

  useEffect(() => {
    const nextQuery = searchParams.get("q") ?? "";
    setQuery((current) => (current === nextQuery ? current : nextQuery));
  }, [searchParams]);

  const onPickFiles = async (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const nextResults = await api.importBooks(files);
      setResults(nextResults);
      await loadBooks(deferredQuery);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Import failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="page stack-lg">
      <section className="hero-panel">
        <div className="hero-copy">
          <h2>Your bookshelf</h2>
        </div>
        <div className="hero-actions">
          <label className="button button-primary">
            {uploading ? "Importing\u2026" : "Add EPUBs"}
            <input
              accept=".epub,application/epub+zip"
              className="sr-only"
              multiple
              onChange={(event) => {
                void onPickFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
          {!settings?.defaultKindleEmail && (
            <Link className="button button-secondary" to="/settings">
              Add Kindle address
            </Link>
          )}
        </div>
      </section>

      <section className="toolbar">
        <div className="searchbox">
          <input
            aria-label="Search library"
            autoComplete="off"
            id="library-search"
            inputMode="search"
            name="library_search"
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setQuery(nextValue);
              startTransition(() => {
                setSearchParams(nextValue ? { q: nextValue } : {});
              });
            }}
            placeholder="Search by title, author\u2026"
            type="search"
            value={query}
          />
        </div>
        <div className="stat-chip">
          <strong>{numberFormatter.format(books.length)}</strong>
          <span>books</span>
        </div>
      </section>

      {error ? <p className="inline-error">{error}</p> : null}
      <UploadResults results={results} />

      {loading ? (
        <section className="empty-state">
          <h2>Loading\u2026</h2>
        </section>
      ) : books.length === 0 ? (
        <section className="empty-state stack-sm">
          <h2>No books yet</h2>
          <p>Import EPUB files to populate your shelf.</p>
        </section>
      ) : (
        <section aria-label="Bookshelf" className="books-grid">
          {books.map((book) => (
            <Link className="book-card" key={book.id} to={`/books/${book.id}`}>
              <BookCover book={book} />
              <div className="book-card-copy stack-xs">
                <strong className="book-title">{book.title}</strong>
                <span className="book-author">{book.author}</span>
                <span className="book-meta">{formatBytes(book.fileSizeBytes)}</span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
};

const BookDetailPage = () => {
  const { bookId = "" } = useParams();
  useDocumentTitle("Book detail \u2022 ebook manager");

  const [book, setBook] = useState<BookDetail | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBook = useEffectEvent(async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextBook, nextDeliveries, nextSettings] = await Promise.all([
        api.getBook(bookId),
        api.getDeliveries(bookId),
        api.getSettings(),
      ]);

      setBook(nextBook);
      setDeliveries(nextDeliveries);
      setSettings(nextSettings);
      setRecipientEmail((current) => current || nextSettings.defaultKindleEmail || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load the book.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadBook();
  }, [bookId]);

  const onSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    setMessage(null);

    try {
      const delivery = await api.sendBook(bookId, recipientEmail);
      setDeliveries((current) => [delivery, ...current]);
      setMessage(
        "Email accepted by SMTP. Amazon may still reject it if the sender is not approved.",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <section className="empty-state">
        <h2>Loading\u2026</h2>
      </section>
    );
  }

  if (!book) {
    return (
      <section className="empty-state stack-sm">
        <h2>Book unavailable</h2>
        <p>{error ?? "This record could not be loaded."}</p>
      </section>
    );
  }

  return (
    <div className="page stack-lg">
      <Link className="backlink" to="/">
        <ArrowLeftIcon />
        Back to shelf
      </Link>

      <section className="panel detail-layout">
        <BookCover book={book} large />
        <div className="stack-md">
          <div className="stack-xs">
            <h2>{book.title}</h2>
            <p className="detail-author">{book.author}</p>
          </div>

          <dl className="metadata-grid">
            <div>
              <dt>Filename</dt>
              <dd>{book.sourceFilename}</dd>
            </div>
            <div>
              <dt>Imported</dt>
              <dd>{formatDate(book.importedAt)}</dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>{formatBytes(book.fileSizeBytes)}</dd>
            </div>
            <div>
              <dt>Kindle</dt>
              <dd>{settings?.defaultKindleEmail ?? "Not configured"}</dd>
            </div>
          </dl>

          <form className="stack-sm" onSubmit={onSend}>
            <div className="stack-xs">
              <label className="field-label" htmlFor="recipient-email">
                Kindle address
              </label>
              <input
                autoComplete="email"
                id="recipient-email"
                name="recipient_email"
                onChange={(event) => setRecipientEmail(event.currentTarget.value)}
                placeholder="yourname@kindle.com"
                spellCheck={false}
                type="email"
                value={recipientEmail}
              />
            </div>
            <div className="inline-actions">
              <button className="button button-primary" disabled={sending} type="submit">
                {sending ? "Sending\u2026" : "Send to Kindle"}
              </button>
              <Link className="button button-secondary" to="/settings">
                Delivery settings
              </Link>
            </div>
            {message ? (
              <p aria-live="polite" className="inline-success">
                {message}
              </p>
            ) : null}
            {error ? <p className="inline-error">{error}</p> : null}
          </form>
        </div>
      </section>

      <section className="panel stack-sm">
        <div className="section-heading">
          <h2>Delivery history</h2>
          <span>{numberFormatter.format(deliveries.length)} attempts</span>
        </div>
        {deliveries.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No sends yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Created</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td>
                      <span className={`status-pill status-${delivery.status}`}>
                        {delivery.status}
                      </span>
                    </td>
                    <td>{delivery.recipientEmail}</td>
                    <td>{formatDate(delivery.createdAt)}</td>
                    <td>{formatDate(delivery.sentAt)}</td>
                    <td>{delivery.errorMessage ?? "\u2014"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

const SettingsPage = () => {
  useDocumentTitle("Settings \u2022 ebook manager");

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [defaultEmail, setDefaultEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useEffectEvent(async () => {
    setLoading(true);
    setError(null);

    try {
      const payload = await api.getSettings();
      setSettings(payload);
      setDefaultEmail(payload.defaultKindleEmail ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadSettings();
  }, []);

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await api.saveSettings(defaultEmail.trim() || null);
      setSettings(payload);
      setMessage("Default Kindle address saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const onSendTest = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);

    try {
      await api.sendTestEmail(defaultEmail.trim());
      setMessage("SMTP test email sent.");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Could not send the test email.",
      );
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <section className="empty-state">
        <h2>Loading\u2026</h2>
      </section>
    );
  }

  return (
    <div className="page stack-lg">
      <section className="panel stack-md">
        <div className="stack-xs">
          <h2>Kindle destination</h2>
          <p className="lede">
            Set a default Kindle email. SMTP credentials are read from <code>.env</code>.
          </p>
        </div>

        <form className="stack-sm" onSubmit={onSave}>
          <div className="stack-xs">
            <label className="field-label" htmlFor="default-kindle-email">
              Default Kindle email
            </label>
            <input
              autoComplete="email"
              id="default-kindle-email"
              name="default_kindle_email"
              onChange={(event) => setDefaultEmail(event.currentTarget.value)}
              placeholder="yourname@kindle.com"
              spellCheck={false}
              type="email"
              value={defaultEmail}
            />
          </div>
          <div className="inline-actions">
            <button className="button button-primary" disabled={saving} type="submit">
              {saving ? "Saving\u2026" : "Save"}
            </button>
            <button
              className="button button-secondary"
              disabled={testing || !defaultEmail.trim()}
              onClick={onSendTest}
              type="button"
            >
              {testing ? "Sending\u2026" : "Send test email"}
            </button>
          </div>
          {message ? (
            <p aria-live="polite" className="inline-success">
              {message}
            </p>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
        </form>
      </section>

      <section className="panel stack-sm">
        <div className="section-heading">
          <h2>SMTP status</h2>
          <span className={`status-pill ${settings?.smtpConfigured ? "status-sent" : "status-failed"}`}>
            {settings?.smtpConfigured ? "Configured" : "Missing"}
          </span>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0 }}>
          Sender: <strong>{settings?.smtpFrom ?? "Not set"}</strong>
        </p>
        <p style={{ color: "var(--text-tertiary)", fontSize: 13, margin: 0 }}>
          Amazon requires the sender email on your approved personal document sender list.
          SMTP success does not guarantee Kindle acceptance.
        </p>
        <pre className="env-snippet">
{`SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=sender@example.com
SMTP_PASS=replace-me
SMTP_FROM=sender@example.com`}
        </pre>
      </section>
    </div>
  );
};

const AppRoutes = () => (
  <Routes>
    <Route element={<Shell />}>
      <Route element={<BookshelfPage />} path="/" />
      <Route element={<BookDetailPage />} path="/books/:bookId" />
      <Route element={<SettingsPage />} path="/settings" />
    </Route>
  </Routes>
);

export default function App() {
  return <AppRoutes />;
}
