import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * Surfaces that live outside a panel's subtree but belong to the same piece of
 * work: the control that toggles the panel (its `aria-expanded` is true while the
 * panel is open, so its own handler owns the close), the reader's floating
 * selection toolbar, and dialogs that render through a portal.
 */
const RELATED_SURFACE_SELECTOR = [
  '[aria-expanded="true"]',
  ".reader-selection-toolbar",
  '[data-slot="dialog-overlay"]',
  '[data-slot="dialog-content"]',
].join(", ");

/**
 * Dismiss a panel when a press lands outside it. Listening in the capture phase
 * on `pointerdown` keeps the dismissal independent of handlers that stop
 * propagation, and closes the panel on the same press that acts on the page
 * underneath.
 */
export function useDismissOnOutsidePress(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
) {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target) || target.closest(RELATED_SURFACE_SELECTOR)) return;
      dismiss();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, panelRef]);
}
