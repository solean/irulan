import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { MoreIcon } from "./icons";
export type OverflowMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
};

type OverflowMenuProps = {
  label: string;
  items: OverflowMenuItem[];
};

type BookActionMenuProps = {
  items: OverflowMenuItem[];
  onClose: () => void;
  x: number;
  y: number;
};

export const OverflowMenu = ({ label, items }: OverflowMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="overflow-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="overflow-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="overflow-menu-popover" role="menu">
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
                setOpen(false);
                item.onSelect();
              }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const BookActionMenu = ({ items, onClose, x, y }: BookActionMenuProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const firstItem = containerRef.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    firstItem?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
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
  }, [onClose]);

  return (
    <div
      aria-label="Book actions"
      className="overflow-menu-popover context-menu-popover"
      ref={containerRef}
      role="menu"
      style={{ left: x, top: y }}
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

