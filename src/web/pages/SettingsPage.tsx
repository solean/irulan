import type { FormEvent } from "react";
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

  if (loading && !settings) {
    return <SettingsSkeleton />;
  }

  const smtpConfigured = Boolean(settings?.smtp.configured);
  const smtpSender = settings?.smtp.from.trim() || null;
  const hasAnyKindleEmail = bookshelves.some((bookshelf) => bookshelf.kindleEmail?.trim());
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
          <h2>Send to Kindle setup</h2>
          <p className="lede">
            Irulan emails EPUBs through your SMTP provider, then Amazon decides whether the
            message is allowed to reach your Kindle library.
          </p>
        </div>

        <div className="smtp-onboarding-grid">
          <div className="smtp-onboarding-callout stack-xs">
            <p className="smtp-onboarding-eyebrow">What Amazon checks</p>
            <p className="smtp-onboarding-copy">
              Amazon must see the exact sender address from <code>SMTP_FROM</code>. Add that
              address to your approved personal document sender list before you test delivery.
            </p>
          </div>
        </div>

        <section aria-labelledby="amazon-kindle-email-guide" className="smtp-amazon-guide stack-sm">
          <div className="section-heading">
            <h3 id="amazon-kindle-email-guide">Amazon Kindle email setup</h3>
            <a
              href="https://www.amazon.com/sendtokindle/email"
              rel="noreferrer"
              target="_blank"
            >
              Open Amazon&apos;s guide
            </a>
          </div>
          <ol className="smtp-amazon-guide-list">
            <li>
              Find your Kindle email address in{" "}
              <strong>Manage Your Content and Devices &gt; Preferences &gt; Personal Document
              Settings</strong>
              .
            </li>
            <li>
              Add the sender address shown above to Amazon&apos;s{" "}
              <strong>Approved Personal Document E-mail List</strong>.
            </li>
            <li>
              Send to Kindle by attaching the EPUB to that Kindle email address. No subject line is
              required.
            </li>
          </ol>
          <p className="smtp-onboarding-step-meta">
            Amazon lists EPUB as a supported Send to Kindle file type. Amazon can reject a message
            even after your SMTP server accepts it.
          </p>
        </section>

        <ol className="smtp-onboarding-steps">
          <li className="smtp-onboarding-step">
            <span aria-hidden="true" className="smtp-onboarding-step-number">
              1
            </span>
            <div className="stack-xs">
              <div className="smtp-onboarding-step-heading">
                <p className="smtp-onboarding-step-title">Save your SMTP connection in Irulan</p>
                <Badge
                  className={cn("status-pill", smtpConfigured ? "status-sent" : "status-failed")}
                  variant={getStatusBadgeVariant(smtpConfigured ? "configured" : "missing")}
                >
                  {smtpConfigured ? "Ready" : "Needs SMTP"}
                </Badge>
              </div>
              <p className="smtp-onboarding-step-copy">
                Use the SMTP form below to set the server, port, security mode, optional auth, and
                sender address. Irulan uses the saved values immediately after you press save.
              </p>
            </div>
          </li>
          <li className="smtp-onboarding-step">
            <span aria-hidden="true" className="smtp-onboarding-step-number">
              2
            </span>
            <div className="stack-xs">
              <div className="smtp-onboarding-step-heading">
                <p className="smtp-onboarding-step-title">Approve the sender in Amazon</p>
                <Badge className="status-pill status-pending" variant="outline">
                  Manual step
                </Badge>
              </div>
              <p className="smtp-onboarding-step-copy">
                In Amazon Kindle settings, add{" "}
                <code>{smtpSender ?? "the address from SMTP_FROM"}</code> to the Approved Personal
                Document E-mail List. SMTP success only means your mail server accepted the
                message. Amazon can still reject it after that.
              </p>
            </div>
          </li>
          <li className="smtp-onboarding-step">
            <span aria-hidden="true" className="smtp-onboarding-step-number">
              3
            </span>
            <div className="stack-xs">
              <div className="smtp-onboarding-step-heading">
                <p className="smtp-onboarding-step-title">Create bookshelves and send tests</p>
                <Badge
                  className={cn(
                    "status-pill",
                    hasAnyKindleEmail ? "status-sent" : "status-pending",
                  )}
                  variant={getStatusBadgeVariant(hasAnyKindleEmail ? "configured" : "pending")}
                >
                  {hasAnyKindleEmail ? "Ready" : "Needs address"}
                </Badge>
              </div>
              <p className="smtp-onboarding-step-copy">
                Save a Kindle destination on each bookshelf that should send books to a device,
                then send a test email from the bookshelf page.
              </p>
              {hasAnyKindleEmail ? (
                <p className="smtp-onboarding-step-meta">
                  {numberFormatter.format(bookshelves.filter((bookshelf) => bookshelf.kindleEmail).length)}{" "}
                  shelves have Kindle destinations.
                </p>
              ) : null}
              <Button asChild size="sm" variant="outline">
                <Link to="/bookshelves">Open bookshelves</Link>
              </Button>
            </div>
          </li>
        </ol>

        <p className="smtp-onboarding-note">
          If saving works but sending still fails, the usual causes are the wrong port, the wrong
          TLS mode, or a provider that expects an app password instead of your normal mailbox
          password.
        </p>
      </Card>

      <Card className="panel stack-md">
        <div className="stack-xs">
          <div className="section-heading">
            <h2>SMTP connection</h2>
            <Badge
              className={cn("status-pill", smtpConfigured ? "status-sent" : "status-failed")}
              variant={getStatusBadgeVariant(smtpConfigured ? "configured" : "missing")}
            >
              {smtpConfigured ? "Configured" : "Not configured"}
            </Badge>
          </div>
          <p className="lede">
            Store the mail server Irulan should use for Send to Kindle. If these values are
            currently coming from the environment, saving here overrides them for this library.
          </p>
        </div>

        <form className="stack-md" onSubmit={onSaveSmtp}>
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
            <div className="stack-xs">
              <Label className="field-label" htmlFor="smtp-from">
                Sender address
              </Label>
              <Input
                autoComplete="email"
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
            </div>
          </div>

          <p className="smtp-onboarding-step-meta">
            Leave the password blank to keep the existing credential. Environment credentials are
            managed outside this form.
          </p>

          <div className="inline-actions">
            <Button disabled={savingSmtp || !smtpDirty} type="submit">
              {savingSmtp ? "Saving\u2026" : "Save SMTP"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
