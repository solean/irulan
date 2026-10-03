import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveWindowState, trackWindowState } from "./window-state.cjs";

const primary = { workArea: { x: 0, y: 25, width: 1920, height: 1055 } };
const resolve = (stored?: unknown, display = primary) =>
  resolveWindowState("library", stored, [display], display);

afterEach(() => vi.useRealTimers());

describe("window restoration", () => {
  test("centers the larger default within 90% of the usable screen", () => {
    expect(resolve().options).toEqual({ x: 240, y: 78, width: 1440, height: 949, minWidth: 960, minHeight: 640 });
    const small = { workArea: { x: 0, y: 25, width: 800, height: 575 } };
    expect(resolve(undefined, small).options).toMatchObject({ width: 720, height: 517, minWidth: 720, minHeight: 517 });
  });

  test("restores an intentional size larger than the first-launch cap", () => {
    const bounds = { x: 0, y: 25, width: 1900, height: 1000 };
    expect(resolve({ bounds, maximized: true })).toMatchObject({ options: bounds, maximized: true });
  });

  test("keeps windows on a connected display with negative coordinates", () => {
    const secondary = { workArea: { x: -1920, y: 0, width: 1920, height: 1080 } };
    const bounds = { x: -1800, y: 50, width: 1440, height: 960 };
    expect(resolveWindowState("library", { bounds }, [primary, secondary], primary).options).toMatchObject(bounds);
  });

  test("recenters a disconnected display's window and fits oversized bounds", () => {
    expect(resolve({ bounds: { x: -4000, y: 50, width: 2000, height: 1500 } }).options)
      .toMatchObject({ x: 0, y: 25, width: 1920, height: 1055 });
    expect(resolve({ bounds: { x: 1800, y: 1000, width: 1440, height: 960 } }).options)
      .toMatchObject({ x: 480, y: 120, width: 1440, height: 960 });
  });

  test("ignores corrupt state and keeps reader defaults separate", () => {
    for (const bounds of [null, {}, { x: 0, y: 0, width: -1, height: 900 }, { x: "0", y: 0, width: 1440, height: 900 }]) {
      expect(resolve({ bounds, maximized: true })).toEqual(resolve());
    }
    expect(resolveWindowState("reader", null, [primary], primary).options)
      .toMatchObject({ width: 820, height: 940, minWidth: 480, minHeight: 600 });
  });

  test("debounces moves, saves normal bounds while maximized, and flushes on close", () => {
    vi.useFakeTimers();
    const bounds = { x: 10, y: 25, width: 1440, height: 960 };
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isMaximized: () => false,
      getNormalBounds: () => bounds,
    });
    const save = vi.fn();
    trackWindowState(window, save);
    window.emit("move");
    window.emit("resize");
    window.emit("maximize");
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenLastCalledWith({ bounds, maximized: true });
    window.emit("unmaximize");
    window.emit("close");
    expect(save).toHaveBeenLastCalledWith({ bounds, maximized: false });
    window.emit("closed");
    vi.runAllTimers();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
