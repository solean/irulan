import type { FormEvent } from "react";
import {
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { BookshelfSummary, SettingsPayload } from "../../shared/types";
import { ArrowLeftIcon } from "../components/icons";
import { SettingsSkeleton } from "../components/skeletons";
import { useDocumentTitle } from "../hooks/use-document-title";
import { useToast } from "../hooks/use-toast";
import { api } from "../lib/api";
import { numberFormatter } from "../lib/format";


type BookshelfFormState = {
  name: string;
  kindleEmail: string;
};
const toBookshelfFormState = (bookshelf: BookshelfSummary): BookshelfFormState => ({
  name: bookshelf.name,
  kindleEmail: bookshelf.kindleEmail ?? "",
});

const toBookshelfFormMap = (bookshelves: BookshelfSummary[]) =>
  Object.fromEntries(
    bookshelves.map((bookshelf) => [bookshelf.id, toBookshelfFormState(bookshelf)]),
  );
export const BookshelvesPage = () => {
  useDocumentTitle("Bookshelves \u2014 Irulan");
  const toast = useToast();

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [bookshelves, setBookshelves] = useState<BookshelfSummary[]>([]);
  const [bookshelfForms, setBookshelfForms] = useState<Record<string, BookshelfFormState>>({});
  const [newBookshelf, setNewBookshelf] = useState<BookshelfFormState>({
    name: "",
    kindleEmail: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingBookshelfId, setSavingBookshelfId] = useState<string | null>(null);
  const [deletingBookshelfId, setDeletingBookshelfId] = useState<string | null>(null);
  const [creatingBookshelf, setCreatingBookshelf] = useState(false);
  const [testingBookshelfId, setTestingBookshelfId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadBookshelvesPage = useEffectEvent(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [payload, shelfList] = await Promise.all([
        api.getSettings(),
        api.listBookshelves(),
      ]);
      const nextBookshelves = shelfList.bookshelves;
      setSettings(payload);
      setBookshelves(nextBookshelves);
      setBookshelfForms(toBookshelfFormMap(nextBookshelves));
    } catch (requestError) {
      setLoadError(
        requestError instanceof Error ? requestError.message : "Could not load bookshelves.",
      );
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadBookshelvesPage();
  }, []);

  const refreshBookshelves = async () => {
    const { bookshelves: nextBookshelves } = await api.listBookshelves();
    setBookshelves(nextBookshelves);
    setBookshelfForms(toBookshelfFormMap(nextBookshelves));
    return nextBookshelves;
  };

  const onSaveBookshelf = async (bookshelfId: string) => {
    const form = bookshelfForms[bookshelfId];
    if (!form || savingBookshelfId) return;

    setSavingBookshelfId(bookshelfId);

    try {
      await api.updateBookshelf(bookshelfId, form.name.trim(), form.kindleEmail.trim() || null);
      await refreshBookshelves();
      toast({
        title: "Bookshelf saved",
        description: "Bookshelf settings saved.",
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not save bookshelf",
        description:
          requestError instanceof Error ? requestError.message : "Could not save bookshelf.",
        variant: "error",
      });
    } finally {
      setSavingBookshelfId(null);
    }
  };

  const onCreateBookshelf = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatingBookshelf(true);

    try {
      const created = await api.createBookshelf(
        newBookshelf.name.trim(),
        newBookshelf.kindleEmail.trim() || null,
      );
      await refreshBookshelves();
      setNewBookshelf({ name: "", kindleEmail: "" });
      toast({
        title: "Bookshelf created",
        description: `${created.name} is ready.`,
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not create bookshelf",
        description:
          requestError instanceof Error ? requestError.message : "Could not create bookshelf.",
        variant: "error",
      });
    } finally {
      setCreatingBookshelf(false);
    }
  };

  const onDeleteBookshelf = async (bookshelf: BookshelfSummary) => {
    if (deletingBookshelfId) return;
    const confirmed = window.confirm(
      `Remove "${bookshelf.name}"? Books remain in the shared library.`,
    );
    if (!confirmed) return;

    setDeletingBookshelfId(bookshelf.id);

    try {
      const deletion = await api.deleteBookshelf(bookshelf.id);
      await refreshBookshelves();
      toast({
        title: "Bookshelf removed",
        description: deletion.message,
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not remove bookshelf",
        description:
          requestError instanceof Error ? requestError.message : "Could not remove bookshelf.",
        variant: "error",
      });
    } finally {
      setDeletingBookshelfId(null);
    }
  };

  const onSendBookshelfTest = async (bookshelf: BookshelfSummary) => {
    const form = bookshelfForms[bookshelf.id] ?? toBookshelfFormState(bookshelf);
    const recipient = form.kindleEmail.trim();
    if (!recipient) return;

    setTestingBookshelfId(bookshelf.id);

    try {
      await api.sendTestEmail(recipient);
      toast({
        title: "Test email sent",
        description: `SMTP test email sent to ${recipient}.`,
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not send test email",
        description:
          requestError instanceof Error
            ? requestError.message
            : "Could not send the test email.",
        variant: "error",
      });
    } finally {
      setTestingBookshelfId(null);
    }
  };

  if (loading && !settings) {
    return <SettingsSkeleton />;
  }

  const smtpConfigured = Boolean(settings?.smtp.configured);
  const isBookshelfDirty = (bookshelf: BookshelfSummary) => {
    const form = bookshelfForms[bookshelf.id];
    if (!form) return false;
    return (
      form.name.trim() !== bookshelf.name ||
      (form.kindleEmail.trim() || null) !== (bookshelf.kindleEmail ?? null)
    );
  };

  return (
    <div className="page page-narrow stack-lg">
      <Button asChild className="backlink" variant="ghost">
        <Link to="/">
          <ArrowLeftIcon />
          Back to bookshelf
        </Link>
      </Button>

      {loadError ? <p className="inline-error">{loadError}</p> : null}

      <Card className="panel stack-md">
        <div className="stack-xs">
          <div className="section-heading">
            <h2>Bookshelves</h2>
            <Badge className="status-pill" variant="outline">
              {numberFormatter.format(bookshelves.length)} shelves
            </Badge>
          </div>
          <p className="lede">
            Each bookshelf keeps its own Kindle destination. Books can belong to more than one
            shelf without duplicating the EPUB file.
          </p>
          {!smtpConfigured ? (
            <p className="bookshelves-page-note">
              <Link to="/settings">Configure SMTP</Link> before sending test email from a shelf.
            </p>
          ) : null}
        </div>

        <div className="settings-bookshelf-list">
          {bookshelves.map((bookshelf) => {
            const form = bookshelfForms[bookshelf.id] ?? toBookshelfFormState(bookshelf);
            const dirty = isBookshelfDirty(bookshelf);
            const saving = savingBookshelfId === bookshelf.id;
            const deleting = deletingBookshelfId === bookshelf.id;
            const testing = testingBookshelfId === bookshelf.id;

            return (
              <form
                className="settings-bookshelf-row"
                key={bookshelf.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSaveBookshelf(bookshelf.id);
                }}
              >
                <div className="settings-bookshelf-fields">
                  <div className="stack-xs">
                    <Label className="field-label" htmlFor={`bookshelf-name-${bookshelf.id}`}>
                      Shelf name
                    </Label>
                    <Input
                      autoComplete="off"
                      id={`bookshelf-name-${bookshelf.id}`}
                      name={`bookshelf_name_${bookshelf.id}`}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setBookshelfForms((current) => ({
                          ...current,
                          [bookshelf.id]: {
                            ...form,
                            name: value,
                          },
                        }));
                      }}
                      placeholder="Me"
                      spellCheck={false}
                      type="text"
                      value={form.name}
                    />
                  </div>
                  <div className="stack-xs">
                    <Label className="field-label" htmlFor={`bookshelf-kindle-${bookshelf.id}`}>
                      Kindle email
                    </Label>
                    <Input
                      autoComplete="email"
                      id={`bookshelf-kindle-${bookshelf.id}`}
                      name={`bookshelf_kindle_${bookshelf.id}`}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setBookshelfForms((current) => ({
                          ...current,
                          [bookshelf.id]: {
                            ...form,
                            kindleEmail: value,
                          },
                        }));
                      }}
                      placeholder="name@kindle.com"
                      spellCheck={false}
                      type="email"
                      value={form.kindleEmail}
                    />
                  </div>
                </div>
                <div className="settings-bookshelf-meta">
                  <span>{numberFormatter.format(bookshelf.bookCount)} books</span>
                  {!smtpConfigured ? <span>SMTP not configured.</span> : null}
                </div>
                <div className="inline-actions">
                  <Button
                    disabled={!dirty || saving || deleting}
                    type="submit"
                  >
                    {saving ? "Saving\u2026" : "Save shelf"}
                  </Button>
                  <Button
                    disabled={
                      testing ||
                      deleting ||
                      !form.kindleEmail.trim() ||
                      !smtpConfigured
                    }
                    onClick={() => {
                      void onSendBookshelfTest(bookshelf);
                    }}
                    type="button"
                    variant="outline"
                  >
                    {testing ? "Sending\u2026" : "Send test email"}
                  </Button>
                  <Button
                    disabled={bookshelves.length <= 1 || saving || deleting}
                    onClick={() => {
                      void onDeleteBookshelf(bookshelf);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    {deleting ? "Removing\u2026" : "Remove"}
                  </Button>
                </div>
              </form>
            );
          })}
        </div>

        <form className="settings-bookshelf-create" onSubmit={onCreateBookshelf}>
          <div className="settings-bookshelf-fields">
            <div className="stack-xs">
              <Label className="field-label" htmlFor="new-bookshelf-name">
                New shelf name
              </Label>
              <Input
                autoComplete="off"
                id="new-bookshelf-name"
                name="new_bookshelf_name"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setNewBookshelf((current) => ({ ...current, name: value }));
                }}
                placeholder="bookshelf name"
                spellCheck={false}
                type="text"
                value={newBookshelf.name}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="new-bookshelf-kindle">
                Kindle email
              </Label>
              <Input
                autoComplete="email"
                id="new-bookshelf-kindle"
                name="new_bookshelf_kindle"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setNewBookshelf((current) => ({ ...current, kindleEmail: value }));
                }}
                placeholder="name@kindle.com"
                spellCheck={false}
                type="email"
                value={newBookshelf.kindleEmail}
              />
            </div>
          </div>
          <div className="inline-actions">
            <Button disabled={creatingBookshelf || !newBookshelf.name.trim()} type="submit">
              {creatingBookshelf ? "Creating\u2026" : "Create bookshelf"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};