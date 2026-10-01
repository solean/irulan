import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { BookshelfSummary } from "../../shared/types";
import { useFileDropTarget } from "../hooks/use-file-drop-target";
import { getImportableFiles } from "../lib/file-import";
import { numberFormatter } from "../lib/format";
import { UploadIcon } from "./icons";


type ImportBooksModalProps = {
  disabled?: boolean;
  open: boolean;
  onClose: () => void;
  onImportFiles: (files: File[]) => void;
  onRejectFiles?: () => void;
};

export const ImportBooksModal = ({
  disabled = false,
  open,
  onClose,
  onImportFiles,
  onRejectFiles,
}: ImportBooksModalProps) => {
  const browseButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const submitFiles = useCallback(
    (files: File[]) => {
      const importableFiles = getImportableFiles(files);
      if (importableFiles.length === 0) {
        onRejectFiles?.();
        onClose();
        return;
      }

      onImportFiles(importableFiles);
      onClose();
    },
    [onClose, onImportFiles, onRejectFiles],
  );
  const {
    isActive: isDropTargetActive,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    reset,
  } = useFileDropTarget({
    enabled: open && !disabled,
    onDropFiles: submitFiles,
  });

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    browseButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      reset();
      previousActiveElement?.focus();
    };
  }, [open, reset]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="import-modal gap-6 sm:max-w-[560px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          browseButtonRef.current?.focus();
        }}
        showCloseButton={false}
      >
        <div className="import-modal-header">
          <DialogHeader className="stack-xs import-modal-copy gap-1">
            <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em]">
              Add EPUBs
            </DialogTitle>
          </DialogHeader>
          <Button className="import-modal-dismiss" onClick={onClose} type="button" variant="outline">
            Close
          </Button>
        </div>

        {/* Drag-and-drop is a pointer-only shortcut. The "Browse files" button
            below is the keyboard-accessible path and does the same import, so
            the drop surface itself needs no role. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: supplementary pointer affordance */}
        <div
          className={cn("import-dropzone", isDropTargetActive && "import-dropzone-active")}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <div className="import-dropzone-icon">
            <UploadIcon />
          </div>
          <p className="import-dropzone-title">
            {isDropTargetActive ? "Release to upload" : "Drag and Drop here"}
          </p>
          <p className="import-dropzone-divider">or</p>
          <Button
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            ref={browseButtonRef}
            size="lg"
            type="button"
          >
            Browse files
          </Button>
          <input
            accept=".epub,application/epub+zip"
            aria-hidden="true"
            className="sr-only"
            disabled={disabled}
            multiple
            onChange={(event) => {
              submitFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ImportTargetModalProps = {
  disabled?: boolean;
  fileCount: number;
  bookshelves: BookshelfSummary[];
  open: boolean;
  selectedBookshelfIds: string[];
  onClose: () => void;
  onConfirm: () => void;
  onClearBookshelves: () => void;
  onSelectAllBookshelves: () => void;
  onToggleBookshelf: (bookshelfId: string) => void;
};

export const ImportTargetModal = ({
  disabled = false,
  fileCount,
  bookshelves,
  open,
  selectedBookshelfIds,
  onClose,
  onConfirm,
  onClearBookshelves,
  onSelectAllBookshelves,
  onToggleBookshelf,
}: ImportTargetModalProps) => {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileLabel =
    fileCount === 1
      ? "1 EPUB is ready to import."
      : `${numberFormatter.format(fileCount)} EPUBs are ready to import.`;
  const selectedCount = selectedBookshelfIds.length;
  const selectedLabel =
    selectedCount === 1
      ? "1 bookshelf selected"
      : `${numberFormatter.format(selectedCount)} bookshelves selected`;
  const confirmLabel =
    selectedCount === 1
      ? "Import to 1 bookshelf"
      : `Import to ${numberFormatter.format(selectedCount)} bookshelves`;
  const allBookshelvesSelected =
    bookshelves.length > 0 && selectedBookshelfIds.length === bookshelves.length;

  useEffect(() => {
    if (open) {
      confirmButtonRef.current?.focus();
    }
  }, [open]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!disabled && !nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="import-target-modal gap-5 sm:max-w-[480px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
        showCloseButton={false}
      >
        <DialogHeader className="stack-xs gap-1">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em]">
            Choose bookshelves
          </DialogTitle>
          <p className="import-target-copy">
            {fileLabel} {selectedLabel}.
          </p>
        </DialogHeader>

        <div className="import-target-actions">
          <Button
            disabled={disabled || allBookshelvesSelected}
            onClick={onSelectAllBookshelves}
            size="sm"
            type="button"
            variant="outline"
          >
            Select all
          </Button>
          <Button
            disabled={disabled || selectedCount === 0}
            onClick={onClearBookshelves}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        </div>

        <fieldset className="import-target-list">
          <legend className="sr-only">Import destination</legend>
          {bookshelves.map((bookshelf) => (
            <label className="import-target-row" key={bookshelf.id}>
              <input
                checked={selectedBookshelfIds.includes(bookshelf.id)}
                disabled={disabled}
                name={`import_bookshelf_${bookshelf.id}`}
                onChange={() => onToggleBookshelf(bookshelf.id)}
                type="checkbox"
                value={bookshelf.id}
              />
              <span className="import-target-copy-block">
                <span className="import-target-name">{bookshelf.name}</span>
                <span className="import-target-meta">
                  {numberFormatter.format(bookshelf.bookCount)} books
                  {bookshelf.kindleEmail ? ` · ${bookshelf.kindleEmail}` : ""}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="confirm-modal-actions">
          <Button disabled={disabled} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            className="import-target-confirm"
            disabled={disabled || selectedCount === 0}
            onClick={onConfirm}
            ref={confirmButtonRef}
            type="button"
          >
            {disabled ? "Importing\u2026" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmModalProps = {
  open: boolean;
  pending: boolean;
  error?: string | null;
  eyebrow: string;
  title: string;
  description: ReactNode;
  /** Names the consequence ("Delete book"), so the dialog answers without reading the body. */
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export const ConfirmModal = ({
  open,
  pending,
  error = null,
  eyebrow,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  onClose,
  onConfirm,
}: ConfirmModalProps) => (
  <AlertDialog
    onOpenChange={(nextOpen) => {
      if (!pending && !nextOpen) {
        onClose();
      }
    }}
    open={open}
  >
    <AlertDialogContent
      // Same modifier chain as AlertDialogContent's own max-width so tailwind-merge
      // replaces it; a bare `sm:max-w-*` loses to the data-attribute variant.
      className="confirm-modal gap-6 data-[size=default]:sm:max-w-[460px]"
      onEscapeKeyDown={(event) => {
        if (pending) {
          event.preventDefault();
        }
      }}
    >
      <div className="stack-sm">
        <div className="stack-xs">
          <p className="eyebrow">{eyebrow}</p>
          <AlertDialogTitle className="text-left text-[20px] font-semibold tracking-[-0.02em]">
            {title}
          </AlertDialogTitle>
        </div>
        <AlertDialogDescription className="confirm-modal-copy text-left">
          {description}
        </AlertDialogDescription>
      </div>

      {error ? (
        <p aria-live="polite" className="inline-error">
          {error}
        </p>
      ) : null}

      <div className="confirm-modal-actions">
        <AlertDialogCancel disabled={pending} onClick={onClose}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          disabled={pending}
          onClick={(event) => {
            event.preventDefault();
            if (!pending) {
              onConfirm();
            }
          }}
          variant={destructive ? "destructive" : "default"}
        >
          {pending ? pendingLabel : confirmLabel}
        </AlertDialogAction>
      </div>
    </AlertDialogContent>
  </AlertDialog>
);

type DeleteBookModalProps = {
  open: boolean;
  deleting: boolean;
  error: string | null;
  bookTitle: string;
  onClose: () => void;
  onConfirm: () => void;
};

export const DeleteBookModal = ({
  open,
  deleting,
  error,
  bookTitle,
  onClose,
  onConfirm,
}: DeleteBookModalProps) => (
  <ConfirmModal
    confirmLabel="Delete book"
    description={
      <>
        <strong className="font-semibold text-[var(--text-primary)]">{bookTitle}</strong> and its
        delivery history will be removed. This cannot be undone.
      </>
    }
    destructive
    error={error}
    eyebrow="Delete book"
    onClose={onClose}
    onConfirm={onConfirm}
    open={open}
    pending={deleting}
    pendingLabel={"Deleting\u2026"}
    title="Remove this title from your library?"
  />
);

type SendBookModalProps = {
  open: boolean;
  sending: boolean;
  error: string | null;
  bookTitle: string;
  recipientEmail: string;
  onClose: () => void;
  onConfirm: () => void;
};

export const SendBookModal = ({
  open,
  sending,
  error,
  bookTitle,
  recipientEmail,
  onClose,
  onConfirm,
}: SendBookModalProps) => (
  <ConfirmModal
    confirmLabel="Send to Kindle"
    description={
      <>
        <strong className="font-semibold text-[var(--text-primary)]">{bookTitle}</strong> will be
        emailed to <strong className="font-semibold text-[var(--text-primary)]">{recipientEmail}</strong>.
        Amazon may still reject it if the sender is not approved.
      </>
    }
    error={error}
    eyebrow="Send to Kindle"
    onClose={onClose}
    onConfirm={onConfirm}
    open={open}
    pending={sending}
    pendingLabel={"Sending\u2026"}
    title="Send this book to your Kindle?"
  />
);