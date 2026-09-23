import type { MouseEvent } from "react";

/*
 * Shared-element transition for a book cover between the library grid and the
 * book detail page.
 *
 * BrowserRouter ignores `<Link viewTransition>` (only data routers call
 * startViewTransition), and the destination page renders a skeleton until its
 * fetch resolves. So we start the transition ourselves and keep the old frame
 * up until the destination cover is in the DOM, capped at READY_TIMEOUT_MS.
 * If the cover never shows up, the transition degrades to the root crossfade.
 */

const COVER_TRANSITION_NAME = "book-cover";
const READY_TIMEOUT_MS = 400;

const waitForDestinationCover = (selector: string, origin: Element) => {
  const { promise, resolve } = Promise.withResolvers<HTMLElement | null>();
  const find = () => {
    const candidate = document.querySelector<HTMLElement>(selector);
    return candidate && candidate !== origin ? candidate : null;
  };
  const finish = (found: HTMLElement | null) => {
    observer.disconnect();
    window.clearTimeout(timer);
    resolve(found);
  };
  const observer = new MutationObserver(() => {
    const found = find();
    if (found) finish(found);
  });
  const timer = window.setTimeout(() => finish(null), READY_TIMEOUT_MS);

  const immediate = find();
  if (immediate) finish(immediate);
  else observer.observe(document.body, { childList: true, subtree: true });
  return promise;
};

const waitForImage = async (cover: HTMLElement) => {
  const image = cover.querySelector("img");
  if (!image || image.complete) return;
  const { promise: timeout, resolve } = Promise.withResolvers<void>();
  window.setTimeout(resolve, READY_TIMEOUT_MS);
  await Promise.race([image.decode().catch(() => undefined), timeout]);
};

const isInViewport = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
};

/**
 * Click handler for links that move a book cover between pages. Falls through
 * to normal navigation for modified clicks, reduced motion, unsupported
 * browsers, or when the origin cover is off screen.
 */
export const navigateWithCoverTransition = (
  event: MouseEvent<HTMLElement>,
  bookId: string,
  navigate: () => void,
) => {
  if (
    // detail === 0: keyboard activation. Keyboard navigation stays instant.
    event.detail === 0 ||
    event.button !== 0 ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const selector = `[data-cover-transition="${CSS.escape(bookId)}"]`;
  const origin =
    event.currentTarget.querySelector<HTMLElement>(selector) ??
    document.querySelector<HTMLElement>(selector);
  if (!origin || !isInViewport(origin)) return;

  event.preventDefault();
  origin.style.viewTransitionName = COVER_TRANSITION_NAME;
  let destination: HTMLElement | null = null;

  const transition = document.startViewTransition(async () => {
    // Two elements may not share a name when the new state is captured.
    origin.style.viewTransitionName = "";
    navigate();
    const found = await waitForDestinationCover(selector, origin);
    if (!found) return;
    await waitForImage(found);
    if (isInViewport(found)) {
      found.style.viewTransitionName = COVER_TRANSITION_NAME;
      destination = found;
    }
  });

  transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      if (destination) destination.style.viewTransitionName = "";
    });
};
