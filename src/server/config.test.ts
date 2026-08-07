import { describe, expect, test } from "vitest";

import { parseNumber, parsePort } from "./config";

describe("parseNumber", () => {
  test("reads a value that is set", () => {
    expect(parseNumber("4173", 5173, "WEB_PORT")).toBe(4173);
    expect(parseNumber("0.5", 1, "RATE")).toBe(0.5);
    expect(parseNumber("-3", 1, "OFFSET")).toBe(-3);
  });

  test("falls back when the variable is unset", () => {
    expect(parseNumber(undefined, 5173, "WEB_PORT")).toBe(5173);
  });

  test("falls back when the variable is set but blank", () => {
    // `Number("")` is 0, not NaN, so a bare `PORT=` in .env used to bind a
    // random port instead of the default.
    expect(parseNumber("", 5173, "WEB_PORT")).toBe(5173);
    expect(parseNumber("   ", 5173, "WEB_PORT")).toBe(5173);
    expect(parseNumber("\t\n", 8787, "PORT")).toBe(8787);
  });

  test("tolerates surrounding whitespace around a real value", () => {
    expect(parseNumber("  4173  ", 5173, "WEB_PORT")).toBe(4173);
  });

  test("rejects a value that is not a number", () => {
    expect(() => parseNumber("abc", 5173, "WEB_PORT")).toThrow(
      "WEB_PORT must be a valid number.",
    );
    expect(() => parseNumber("80eighty", 5173, "WEB_PORT")).toThrow("WEB_PORT");
  });

  test("rejects a value that is not finite", () => {
    expect(() => parseNumber("Infinity", 120, "SERVER_IDLE_TIMEOUT_SECONDS")).toThrow(
      "SERVER_IDLE_TIMEOUT_SECONDS must be a valid number.",
    );
    expect(() => parseNumber("NaN", 120, "SERVER_IDLE_TIMEOUT_SECONDS")).toThrow(
      "SERVER_IDLE_TIMEOUT_SECONDS",
    );
  });
});

describe("parsePort", () => {
  test("accepts a port in range", () => {
    expect(parsePort("8787", 8787, "PORT")).toBe(8787);
    expect(parsePort("65535", 8787, "PORT")).toBe(65535);
  });

  test("keeps port 0 legal", () => {
    // The Electron shell sets PORT=0 to have the OS pick a free port.
    expect(parsePort("0", 8787, "PORT")).toBe(0);
  });

  test("falls back on a blank value rather than binding port 0", () => {
    expect(parsePort("", 8787, "PORT")).toBe(8787);
    expect(parsePort(undefined, 5173, "WEB_PORT")).toBe(5173);
  });

  test("rejects a port outside the valid range", () => {
    expect(() => parsePort("65536", 8787, "PORT")).toThrow(
      "PORT must be a whole number between 0 and 65535.",
    );
    expect(() => parsePort("-1", 8787, "PORT")).toThrow("PORT must be a whole number");
  });

  test("rejects a fractional port", () => {
    expect(() => parsePort("80.5", 8787, "PORT")).toThrow("PORT must be a whole number");
  });

  test("rejects a port that is not a number at all", () => {
    expect(() => parsePort("http", 8787, "PORT")).toThrow("PORT must be a valid number.");
  });
});
