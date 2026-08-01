// Which URLs the shell will act on. Kept in its own module so the rules are
// testable without booting Electron.

// The reader resolves in-book links to http(s) and passes mailto:/tel: through
// verbatim — see getReaderLinkTarget in src/web/lib/reader.tsx. Anything outside
// this set did not come from a link the reader meant to offer.
const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Whether a URL may be handed to shell.openExternal.
 *
 * EPUB content is untrusted input and openExternal dispatches through the OS
 * handler registry, so `file:`, `smb:`, and any app-registered custom scheme
 * would launch whatever is bound to them. Only the schemes the reader actually
 * produces get through; everything else is dropped.
 */
const isExternallyOpenable = (rawUrl) => {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return false;
  }

  try {
    // The URL parser lowercases the scheme, so "JavaScript:" cannot slip past.
    return OPENABLE_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
};

/** Whether a URL belongs to the locally served app rather than the outside world. */
const isSameOrigin = (rawUrl, appUrl) => {
  if (typeof rawUrl !== "string" || typeof appUrl !== "string") {
    return false;
  }

  try {
    return new URL(rawUrl).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
};

module.exports = { OPENABLE_PROTOCOLS, isExternallyOpenable, isSameOrigin };
