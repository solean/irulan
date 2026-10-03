const WINDOW_DEFAULTS = {
  library: { width: 1440, height: 960, minWidth: 960, minHeight: 640 },
  reader: { width: 820, height: 940, minWidth: 480, minHeight: 600 },
};

const validBounds = (bounds) =>
  bounds &&
  [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) &&
  bounds.width > 0 && bounds.height > 0;

// Choose the display with the largest overlap. A disconnected display falls
// back to the primary display, including when its old coordinates are negative.
const resolveWindowState = (kind, stored, displays, primary) => {
  const defaults = WINDOW_DEFAULTS[kind];
  const bounds = validBounds(stored?.bounds) ? stored.bounds : null;
  let display = primary;
  let largestOverlap = 0;
  if (bounds) {
    for (const candidate of displays) {
      const area = candidate.workArea;
      const overlap = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)) *
        Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
      if (overlap > largestOverlap) {
        display = candidate;
        largestOverlap = overlap;
      }
    }
  }
  const area = display.workArea;
  const minWidth = Math.min(defaults.minWidth, Math.floor(area.width * 0.9));
  const minHeight = Math.min(defaults.minHeight, Math.floor(area.height * 0.9));
  const width = bounds
    ? Math.min(area.width, Math.max(minWidth, bounds.width))
    : Math.min(defaults.width, Math.floor(area.width * 0.9));
  const height = bounds
    ? Math.min(area.height, Math.max(minHeight, bounds.height))
    : Math.min(defaults.height, Math.floor(area.height * 0.9));
  const x = bounds && largestOverlap > 0
    ? Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))
    : area.x + Math.round((area.width - width) / 2);
  const y = bounds && largestOverlap > 0
    ? Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
    : area.y + Math.round((area.height - height) / 2);
  return { options: { x, y, width, height, minWidth, minHeight }, maximized: !!bounds && stored.maximized === true };
};

const trackWindowState = (window, save) => {
  let timer;
  let maximized = window.isMaximized();
  const persist = () => {
    clearTimeout(timer);
    if (window.isDestroyed()) return;
    // Normal bounds survive maximization and fullscreen; never save the
    // fullscreen rectangle as the user's preferred window size.
    save({ bounds: window.getNormalBounds(), maximized });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, 300);
  };
  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", () => { maximized = true; schedule(); });
  window.on("unmaximize", () => { maximized = false; schedule(); });
  window.on("close", persist);
  window.on("closed", () => clearTimeout(timer));
};

module.exports = { resolveWindowState, trackWindowState };
