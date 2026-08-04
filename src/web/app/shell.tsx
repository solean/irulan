import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  LibraryBig,
  Monitor,
  Moon,
  MoreHorizontal,
  Settings2,
  Sun,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { useTheme } from "../hooks/use-theme";
import { BookIcon } from "../components/icons";
const getFocusableMenuItems = (container: HTMLElement | null) =>
  Array.from(
    container?.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  );

const AppMenu = () => {
  const location = useLocation();
  const { setThemePreference, themePreference } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuActive = location.pathname === "/settings" || location.pathname === "/bookshelves";

  const closeMenu = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const firstItem = getFocusableMenuItems(popoverRef.current)[0];
    firstItem?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const items = getFocusableMenuItems(popoverRef.current);
    if (items.length === 0) return;

    event.preventDefault();
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (activeIndex + 1) % items.length
            : (activeIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <div className="app-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open app menu"
        className={cn("main-header-action app-menu-trigger", menuActive && "active")}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {open ? (
        <div
          aria-label="App menu"
          className="app-menu-popover"
          onKeyDown={onMenuKeyDown}
          ref={popoverRef}
          role="menu"
        >
          <Link
            className="app-menu-item"
            onClick={() => closeMenu()}
            role="menuitem"
            to="/settings"
          >
            <Settings2 aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <Link
            className="app-menu-item"
            onClick={() => closeMenu()}
            role="menuitem"
            to="/bookshelves"
          >
            <LibraryBig aria-hidden="true" />
            <span>Bookshelves</span>
          </Link>

          <div className="app-menu-separator" role="separator" />

          <div aria-label="Theme" className="app-menu-theme-row" role="group">
            <span className="app-menu-theme-label">Theme</span>
            <div className="app-menu-theme-toggle">
              <button
                aria-checked={themePreference === "system"}
                aria-label="Use system theme"
                className={cn("app-menu-theme-button", themePreference === "system" && "active")}
                onClick={() => setThemePreference("system")}
                role="menuitemradio"
                type="button"
              >
                <Monitor aria-hidden="true" />
              </button>
              <button
                aria-checked={themePreference === "light"}
                aria-label="Use light mode"
                className={cn("app-menu-theme-button", themePreference === "light" && "active")}
                onClick={() => setThemePreference("light")}
                role="menuitemradio"
                type="button"
              >
                <Sun aria-hidden="true" />
              </button>
              <button
                aria-checked={themePreference === "dark"}
                aria-label="Use dark mode"
                className={cn("app-menu-theme-button", themePreference === "dark" && "active")}
                onClick={() => setThemePreference("dark")}
                role="menuitemradio"
                type="button"
              >
                <Moon aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const Shell = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isPopout = searchParams.get("popout") === "1";

  // React Router keeps the window's scroll offset across client-side
  // navigations, so moving from a scrolled-down bookshelf into a book detail
  // would land partway down the new page. Reset to the top whenever the path
  // changes (search-only changes, e.g. ?shelf=…, are intentionally ignored).
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  const pageTitle = (() => {
    if (location.pathname === "/settings") return "Settings";
    if (location.pathname === "/bookshelves") return "Bookshelves";
    if (location.pathname.startsWith("/books/") && location.pathname.endsWith("/read")) {
      return "Reader";
    }
    if (location.pathname.startsWith("/books/")) return "Book detail";
    return "Bookshelf";
  })();

  // A popped-out reader window drops the app chrome entirely — just a slim
  // draggable strip (so the macOS traffic lights have somewhere to live) and
  // the reader itself. Same ReaderPage component, no second implementation.
  if (isPopout) {
    return (
      <>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <div className="app-shell app-shell-popout">
          <main className="popout-main" id="content">
            <h1 className="sr-only">{pageTitle}</h1>
            <Outlet />
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div className="app-shell">
        <header className="main-header">
          <div className="main-header-inner">
            <Link aria-label="Irulan home" className="main-header-home" to="/">
              <span className="main-header-brand-icon" aria-hidden="true">
                <BookIcon />
              </span>
              <span className="main-header-brand-name">irulan</span>
            </Link>
            <div className="header-spacer" />
            <div aria-label="App controls" className="main-header-actions" role="group">
              <AppMenu />
            </div>
          </div>
        </header>
        <main className="content" id="content">
          <h1 className="sr-only">{pageTitle}</h1>
          <Outlet />
        </main>
      </div>
    </>
  );
};

