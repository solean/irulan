import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { READER_SHORTCUT_HELP } from "../lib/reader-shortcuts";

type ReaderShortcutsDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export const ReaderShortcutsDialog = ({ onOpenChange, open }: ReaderShortcutsDialogProps) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="reader-shortcuts-modal gap-5 sm:max-w-[520px]" showCloseButton={false}>
      <div className="import-modal-header">
        <DialogHeader className="stack-xs gap-1">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em]">
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="confirm-modal-copy text-left">
            Letter keys are ignored while you type in a field.
          </DialogDescription>
        </DialogHeader>
        <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
          Close
        </Button>
      </div>

      <div className="reader-shortcuts-groups">
        {READER_SHORTCUT_HELP.map((group) => (
          <section className="stack-xs" key={group.title}>
            <h3 className="eyebrow">{group.title}</h3>
            <dl className="reader-shortcuts-list">
              {group.shortcuts.map((shortcut) => (
                <div className="reader-shortcuts-row" key={shortcut.label}>
                  <dt>{shortcut.label}</dt>
                  <dd>
                    {shortcut.keys.map((chord, chordIndex) => (
                      <span className="reader-shortcuts-chord" key={chord.join("+")}>
                        {chordIndex > 0 ? <span className="reader-shortcuts-or">or</span> : null}
                        {chord.map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
