import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import type { DatabaseRecovery } from "../../shared/types";
import { api } from "../lib/api";
import { formatDate, formatRelative } from "../lib/format";

/**
 * Tells someone their library was rebuilt from its backup copy.
 *
 * Mounted in the shell rather than on a single page: unlike the onboarding
 * card, this has to reach a reader who deep-linked straight to a book. The
 * server only ever sets `databaseRecovery` for genuine corruption, so this
 * renders nothing on an ordinary boot and nothing after a crash mid-save.
 */
export const DatabaseRecoveryNotice = () => {
  const [recovery, setRecovery] = useState<DatabaseRecovery | null>(null);
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void api
      .getSettings()
      .then((settings) => {
        if (!cancelled) setRecovery(settings.databaseRecovery);
      })
      .catch(() => {
        // Whatever page is mounted below will report its own load failure. A
        // second error for the notice that could not be fetched adds noise.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!recovery) return null;

  const acknowledge = async () => {
    setIsAcknowledging(true);
    try {
      const settings = await api.acknowledgeDatabaseRecovery(recovery.recoveredAt);
      setRecovery(settings.databaseRecovery);
    } catch {
      // Leave the notice up. It is the only record the user has that data went
      // missing, so failing to dismiss it is the safe direction to fail in.
      setIsAcknowledging(false);
    }
  };

  const restoredAt = formatRelative(recovery.recoveredAt);

  return (
    <Card className="panel recovery-notice stack-md" role="alert">
      <div className="recovery-notice-header">
        <div className="stack-xs">
          <h2 className="recovery-notice-title">Your library was restored from a backup</h2>
          <p className="recovery-notice-copy">
            {recovery.backupModifiedAt ? (
              <>
                The main library file could not be read{restoredAt ? ` ${restoredAt}` : ""}, so
                Irulan fell back to its backup copy from{" "}
                <strong>{formatDate(recovery.backupModifiedAt)}</strong>. Anything added, edited
                or deleted after that time is gone and will need doing again.
              </>
            ) : (
              <>
                The main library file could not be read{restoredAt ? ` ${restoredAt}` : ""}, so
                Irulan fell back to its backup copy. Recent additions, edits and deletions may
                be missing and will need doing again.
              </>
            )}
          </p>
        </div>
        <Button
          className="recovery-notice-dismiss"
          disabled={isAcknowledging}
          onClick={() => void acknowledge()}
          size="sm"
          type="button"
          variant="ghost"
        >
          Dismiss
        </Button>
      </div>
    </Card>
  );
};
