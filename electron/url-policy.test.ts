import { describe, expect, test } from "bun:test";

import { isExternallyOpenable, isSameOrigin } from "./url-policy.cjs";

describe("isExternallyOpenable", () => {
  test("allows the schemes the reader produces", () => {
    expect(isExternallyOpenable("https://example.com/book")).toBe(true);
    expect(isExternallyOpenable("http://example.com/book")).toBe(true);
    expect(isExternallyOpenable("mailto:reader@example.com")).toBe(true);
    expect(isExternallyOpenable("tel:+15551234567")).toBe(true);
  });

  test("normalizes the scheme before matching", () => {
    expect(isExternallyOpenable("HTTPS://example.com")).toBe(true);
    expect(isExternallyOpenable("MailTo:reader@example.com")).toBe(true);
    // The parser strips leading control characters and spaces.
    expect(isExternallyOpenable("  https://example.com")).toBe(true);
    expect(isExternallyOpenable("JavaScript:alert(1)")).toBe(false);
  });

  test("refuses schemes that reach the local machine", () => {
    expect(isExternallyOpenable("file:///etc/passwd")).toBe(false);
    expect(isExternallyOpenable("file://localhost/Users/me/.ssh/id_rsa")).toBe(false);
    expect(isExternallyOpenable("smb://attacker.example.com/share")).toBe(false);
    expect(isExternallyOpenable("ftp://example.com/payload")).toBe(false);
  });

  test("refuses scripting and data URLs", () => {
    expect(isExternallyOpenable("javascript:alert(1)")).toBe(false);
    expect(isExternallyOpenable("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isExternallyOpenable("vbscript:msgbox(1)")).toBe(false);
  });

  test("refuses app-registered custom schemes", () => {
    // The real risk of an unfiltered openExternal: whatever the OS has bound.
    expect(isExternallyOpenable("zoommtg://zoom.us/join?confno=1")).toBe(false);
    expect(isExternallyOpenable("ms-msdt:/id PCWDiagnostic")).toBe(false);
    expect(isExternallyOpenable("irulan://whatever")).toBe(false);
  });

  test("refuses anything that is not a parseable URL", () => {
    expect(isExternallyOpenable("")).toBe(false);
    expect(isExternallyOpenable("   ")).toBe(false);
    expect(isExternallyOpenable("not a url")).toBe(false);
    expect(isExternallyOpenable("/relative/path")).toBe(false);
    expect(isExternallyOpenable("example.com")).toBe(false);
    expect(isExternallyOpenable(undefined)).toBe(false);
    expect(isExternallyOpenable(null)).toBe(false);
    expect(isExternallyOpenable(42)).toBe(false);
    expect(isExternallyOpenable({ toString: () => "https://example.com" })).toBe(false);
  });
});

describe("isSameOrigin", () => {
  const appUrl = "http://127.0.0.1:52341";

  test("accepts the app's own origin", () => {
    expect(isSameOrigin("http://127.0.0.1:52341", appUrl)).toBe(true);
    expect(isSameOrigin("http://127.0.0.1:52341/books/abc/read", appUrl)).toBe(true);
    expect(isSameOrigin("http://127.0.0.1:52341/api/books?q=dune", appUrl)).toBe(true);
  });

  test("rejects a different port, host, or scheme", () => {
    // The server binds an ephemeral port, so a neighbouring port is not us.
    expect(isSameOrigin("http://127.0.0.1:52342/", appUrl)).toBe(false);
    expect(isSameOrigin("http://localhost:52341/", appUrl)).toBe(false);
    expect(isSameOrigin("https://127.0.0.1:52341/", appUrl)).toBe(false);
    expect(isSameOrigin("http://evil.example.com/", appUrl)).toBe(false);
  });

  test("rejects unparseable input on either side", () => {
    expect(isSameOrigin("not a url", appUrl)).toBe(false);
    expect(isSameOrigin("http://127.0.0.1:52341", "not a url")).toBe(false);
    expect(isSameOrigin(undefined, appUrl)).toBe(false);
    expect(isSameOrigin("http://127.0.0.1:52341", undefined)).toBe(false);
  });
});
