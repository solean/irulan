import { BookOpen, Download, ExternalLink, Mail, RotateCcw } from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

import type {
  BookshelfSummary,
  SettingsPayload,
} from "../../shared/types";
import { ArrowLeftIcon } from "../components/icons";
import { SettingsSkeleton } from "../components/skeletons";
import { useDocumentTitle } from "../hooks/use-document-title";
import { useToast } from "../hooks/use-toast";
import { api } from "../lib/api";
import { numberFormatter } from "../lib/format";
import { getStatusBadgeVariant } from "../lib/status";

type SmtpFormState = {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  password: string;
  clearPassword: boolean;
  editingPassword: boolean;
  from: string;
};
const toSmtpFormState = (smtp: SettingsPayload["smtp"]): SmtpFormState => ({
  host: smtp.host,
  port: String(smtp.port),
  secure: smtp.secure,
  user: smtp.user,
  password: "",
  clearPassword: false,
  editingPassword: !smtp.hasPassword,
  from: smtp.from,
});
export const SettingsPage = () => {
  useDocumentTitle("Settings \u2014 Irulan");
  const toast = useToast();
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [bookshelves, setBookshelves] = useState<BookshelfSummary[]>([]);
  const [smtpForm, setSmtpForm] = useState<SmtpFormState>({
    host: "",
    port: "587",
    secure: false,
    user: "",
    password: "",
    clearPassword: false,
    editingPassword: true,
    from: "",
  });
  const [loading, setLoading] = useState(true);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const loadSettings = useEffectEvent(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [payload, shelfList] = await Promise.all([
        api.getSettings(),
        api.listBookshelves(),
      ]);
      setSettings(payload);
      setBookshelves(shelfList.bookshelves);
      setSmtpForm(toSmtpFormState(payload.smtp));
    } catch (requestError) {
      setLoadError(
        requestError instanceof Error ? requestError.message : "Could not load settings.",
      );
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (smtpForm.editingPassword && settings?.smtp.hasPassword && !smtpForm.clearPassword) {
      passwordInputRef.current?.focus();
    }
  }, [settings?.smtp.hasPassword, smtpForm.clearPassword, smtpForm.editingPassword]);

  const onSaveSmtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingSmtp(true);

    const nextPort = Number.parseInt(smtpForm.port.trim(), 10);
    if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      setSavingSmtp(false);
      toast({
        title: "Invalid SMTP port",
        description: "SMTP port must be a whole number between 1 and 65535.",
        variant: "error",
      });
      return;
    }

    try {
      const payload = await api.saveSmtpSettings({
        host: smtpForm.host.trim(),
        port: nextPort,
        secure: smtpForm.secure,
        user: smtpForm.user.trim(),
        password: smtpForm.password || undefined,
        clearPassword: smtpForm.clearPassword,
        from: smtpForm.from.trim(),
      });
      setSettings(payload);
      setSmtpForm(toSmtpFormState(payload.smtp));
      toast({
        title: "SMTP settings saved",
        description: payload.smtp.configured
          ? "SMTP settings saved."
          : "Add at least a host and sender address to finish setup.",
        variant: payload.smtp.configured ? "success" : "warning",
      });
    } catch (requestError) {
      toast({
        title: "Could not save SMTP",
        description:
          requestError instanceof Error
            ? requestError.message
            : "Could not save SMTP settings.",
        variant: "error",
      });
    } finally {
      setSavingSmtp(false);
    }
  };

  const onDownloadBackup = async () => {
    setBackingUp(true);
    try {
      const backup = await api.downloadLibraryBackup();
      const href = URL.createObjectURL(backup.blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = backup.fileName;
      link.click();
      URL.revokeObjectURL(href);
      toast({
        title: "Library backup created",
        description: "The complete library backup was downloaded.",
        variant: "success",
      });
    } catch (requestError) {
      toast({
        title: "Could not create backup",
        description:
          requestError instanceof Error ? requestError.message : "The library backup failed.",
        variant: "error",
      });
    } finally {
      setBackingUp(false);
    }
  };

  const onRestoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (
      !window.confirm(
        "Restore this backup? It will replace the current library, including books, shelves, settings, bookmarks, highlights, and notes.",
      )
    ) {
      return;
    }

    setRestoring(true);
    try {
      const result = await api.restoreLibraryBackup(file);
      toast({
        title: "Library restored",
        description: `${numberFormatter.format(result.bookCount)} ${result.bookCount === 1 ? "book was" : "books were"} restored. Reloading the library…`,
        variant: "success",
      });
      window.setTimeout(() => window.location.assign("/"), 400);
    } catch (requestError) {
      toast({
        title: "Could not restore backup",
        description:
          requestError instanceof Error
            ? requestError.message
            : "The current library was left unchanged.",
        variant: "error",
      });
      setRestoring(false);
    }
  };

  if (loading && !settings) {
    return <SettingsSkeleton />;
  }

  const smtpConfigured = Boolean(settings?.smtp.configured);
  const smtpSender = settings?.smtp.from.trim() || null;
  const kindleDestinationCount = bookshelves.filter((bookshelf) => bookshelf.kindleEmail?.trim()).length;
  const normalizedSmtpPort = Number.parseInt(smtpForm.port.trim(), 10);
  const smtpDirty = Boolean(
    settings &&
      (smtpForm.host.trim() !== settings.smtp.host ||
        (!Number.isInteger(normalizedSmtpPort) || normalizedSmtpPort !== settings.smtp.port) ||
        smtpForm.secure !== settings.smtp.secure ||
        smtpForm.user.trim() !== settings.smtp.user ||
        smtpForm.password.length > 0 ||
        smtpForm.clearPassword ||
        smtpForm.from.trim() !== settings.smtp.from),
  );

  return (
    <div className="page page-narrow settings-page">
      <Button asChild className="backlink" variant="ghost">
        <Link to="/">
          <ArrowLeftIcon />
          Back to bookshelf
        </Link>
      </Button>

      {loadError ? <p className="inline-error">{loadError}</p> : null}

      <section className="settings-intro" aria-labelledby="kindle-settings-title">
        <h2 id="kindle-settings-title">Send to Kindle</h2>
        <p>Configure email delivery so you can send EPUBs to your Kindle.</p>
      </section>

      <Card className="panel settings-mail-panel">
        <div className="stack-xs">
          <div className="section-heading">
            <h2>Mail connection</h2>
            <Badge
              className={cn("status-pill", smtpConfigured ? "status-sent" : "status-failed")}
              variant={getStatusBadgeVariant(smtpConfigured ? "configured" : "missing")}
            >
              {smtpConfigured ? "Configured" : "Not configured"}
            </Badge>
          </div>
          <p className="lede">
            Use the SMTP settings from your mail provider.
          </p>
        </div>

        <form className="settings-mail-form" onSubmit={onSaveSmtp}>
          <div className="settings-form-grid">
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-host">
                SMTP host
              </Label>
              <Input
                autoComplete="url"
                id="smtp-host"
                name="smtp_host"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, host: value }));
                }}
                placeholder="smtp.example.com"
                spellCheck={false}
                type="text"
                value={smtpForm.host}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-port">
                SMTP port
              </Label>
              <Input
                id="smtp-port"
                inputMode="numeric"
                name="smtp_port"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, port: value }));
                }}
                placeholder="587"
                spellCheck={false}
                type="text"
                value={smtpForm.port}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-security">
                Security mode
              </Label>
              <Select
                onValueChange={(value) =>
                  setSmtpForm((current) => ({ ...current, secure: value === "true" }))
                }
                value={smtpForm.secure ? "true" : "false"}
              >
                <SelectTrigger className="w-full" id="smtp-security">
                  <SelectValue placeholder="Choose a security mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">STARTTLS or opportunistic TLS</SelectItem>
                  <SelectItem value="true">Direct TLS / SSL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-user">
                Username
              </Label>
              <Input
                autoComplete="username"
                id="smtp-user"
                name="smtp_user"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, user: value }));
                }}
                placeholder="sender@example.com"
                spellCheck={false}
                type="text"
                value={smtpForm.user}
              />
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-from">
                Sender address
              </Label>
              <Input
                autoComplete="email"
                aria-describedby="smtp-from-help"
                id="smtp-from"
                name="smtp_from"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({ ...current, from: value }));
                }}
                placeholder="sender@example.com"
                spellCheck={false}
                type="email"
                value={smtpForm.from}
              />
              <p className="settings-help" id="smtp-from-help">This is the address Amazon must approve.</p>
            </div>
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-password">
                Password or app password
              </Label>
              <Input
                autoComplete="new-password"
                disabled={smtpForm.clearPassword || !smtpForm.editingPassword}
                id="smtp-password"
                name="smtp_password"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setSmtpForm((current) => ({
                    ...current,
                    password: value,
                    clearPassword: false,
                  }));
                }}
                placeholder={
                  smtpForm.clearPassword
                    ? "Password will be removed"
                    : smtpForm.editingPassword
                      ? settings?.smtp.hasPassword
                        ? "Enter a new password"
                        : "Required by many providers"
                      : settings?.smtp.passwordSource === "environment"
                        ? "Managed by environment"
                        : "Password saved"
                }
                ref={passwordInputRef}
                spellCheck={false}
                type="password"
                value={smtpForm.password}
              />
              {settings?.smtp.hasPassword ? (
                <div
                  aria-live="polite"
                  className={cn(
                    "smtp-password-state",
                    smtpForm.clearPassword && "smtp-password-state-pending",
                  )}
                >
                  {smtpForm.clearPassword ? (
                    <>
                      <span>Will be removed on save.</span>
                      <Button
                        onClick={() =>
                          setSmtpForm((current) => ({
                            ...current,
                            clearPassword: false,
                            editingPassword: false,
                          }))
                        }
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        Undo
                      </Button>
                    </>
                  ) : smtpForm.editingPassword ? (
                    <>
                      <span>Enter a replacement password.</span>
                      <Button
                        onClick={() =>
                          setSmtpForm((current) => ({
                            ...current,
                            password: "",
                            editingPassword: false,
                          }))
                        }
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={() =>
                          setSmtpForm((current) => ({
                            ...current,
                            editingPassword: true,
                          }))
                        }
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        Change password
                      </Button>
                      {settings.smtp.passwordSource === "app" ? (
                        <Button
                          onClick={() =>
                            setSmtpForm((current) => ({
                              ...current,
                              clearPassword: true,
                              editingPassword: false,
                              password: "",
                            }))
                          }
                          size="xs"
                          type="button"
                          variant="destructive"
                        >
                          Remove
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="settings-form-footer">
            <p className="settings-help">
              Leave the password blank to keep the existing credential.
              Saving overrides environment settings for this library.
            </p>
            <Button disabled={savingSmtp || restoring || !settings || !smtpDirty} type="submit">
              {savingSmtp ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>

      <section aria-labelledby="amazon-sender-title" className="settings-action-row settings-amazon-row">
        <Mail aria-hidden="true" className="settings-row-icon" />
        <div className="settings-row-copy">
          <h2 id="amazon-sender-title">Approve your sender in Amazon</h2>
          <p>
            {smtpSender ? <>Add <code>{smtpSender}</code> to your approved senders.</> : "Save a sender address above, then add it to your approved senders in Amazon."}
          </p>
          <details className="settings-disclosure">
            <summary>View instructions</summary>
            <ol className="smtp-amazon-guide-list">
              <li>In Amazon, open <strong>Manage Your Content and Devices &gt; Preferences &gt; Personal Document Settings</strong>.</li>
              <li>Add your saved sender address to the <strong>Approved Personal Document E-mail List</strong>.</li>
              <li>Find your Kindle email address and save it on a bookshelf, then send a test from that bookshelf.</li>
            </ol>
            <p className="settings-help">Approval happens in Amazon. A saved mail connection does not verify approval or guarantee delivery.</p>
          </details>
        </div>
        <Button asChild variant="outline">
          <a href="https://www.amazon.com/sendtokindle/email" rel="noreferrer" target="_blank">
            Open Amazon’s guide <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </section>

      <section aria-labelledby="kindle-destinations-title" className="settings-action-row">
        <BookOpen aria-hidden="true" className="settings-row-icon" />
        <div className="settings-row-copy">
          <h2 id="kindle-destinations-title">Kindle destinations</h2>
          <p>{kindleDestinationCount > 0
            ? `${numberFormatter.format(kindleDestinationCount)} ${kindleDestinationCount === 1 ? "bookshelf has" : "bookshelves have"} a Kindle address.`
            : "Add a Kindle address to a bookshelf to start sending books."}</p>
        </div>
        <Button asChild variant="outline"><Link to="/bookshelves">Manage bookshelves</Link></Button>
      </section>

      <details className="settings-disclosure settings-troubleshooting">
        <summary>Having trouble with delivery?</summary>
        <p>Check your SMTP port and security mode, and whether your provider requires an app password. Confirm your sender is approved in Amazon and the bookshelf has the correct Kindle address. Your mail server accepting a message does not guarantee Amazon will deliver it.</p>
      </details>

      <section aria-labelledby="library-backup-title" className="settings-backup">
        <div className="settings-row-copy">
          <h2 id="library-backup-title">Library backup</h2>
          <p>Export your books, covers, notes, and library data.</p>
        </div>
        <div className="settings-backup-controls">
          <div className="settings-backup-actions">
            <Button disabled={backingUp || restoring} onClick={() => void onDownloadBackup()} type="button">
              <Download aria-hidden="true" />{backingUp ? "Creating backup…" : "Download backup"}
            </Button>
            <Button disabled={backingUp || restoring || savingSmtp} onClick={() => restoreInputRef.current?.click()} type="button" variant="outline">
              <RotateCcw aria-hidden="true" />{restoring ? "Restoring…" : "Restore backup"}
            </Button>
          </div>
          <p className="settings-help">Restoring replaces your current library. If validation fails, your library is kept.</p>
          <input accept=".zip,application/zip" aria-label="Choose library backup" className="sr-only" disabled={backingUp || restoring || savingSmtp} onChange={(event) => void onRestoreBackup(event)} ref={restoreInputRef} type="file" />
        </div>
      </section>
    </div>
  );
};
