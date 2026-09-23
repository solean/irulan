import { type CSSProperties, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type OverflowMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
};

type BookActionMenuProps = {
  items: OverflowMenuItem[];
  onClose: () => void;
  x: number;
  y: number;
  originX: number;
  originY: number;
  /** True while the menu plays its exit transition; it ignores input. */
  closing: boolean;
};

export const BookActionMenu = ({ items, onClose, x, y, originX, originY, closing }: BookActionMenuProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const firstItem = containerRef.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    firstItem?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (closing) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const closeOnViewportChange = () => onClose();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [closing, onClose]);

  return (
    <div
      aria-label="Book actions"
      className="overflow-menu-popover context-menu-popover"
      data-state={closing ? "closed" : "open"}
      inert={closing}
      ref={containerRef}
      role="menu"
      style={{ left: x, top: y, "--menu-origin": `${originX}px ${originY}px` } as CSSProperties}
    >
      {items.map((item) => (
        <button
          className={cn(
            "overflow-menu-item",
            item.variant === "destructive" && "destructive",
          )}
          disabled={item.disabled}
          key={item.id}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

