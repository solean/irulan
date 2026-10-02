import { createHash } from "node:crypto";

import { themeBootstrapScript } from "../shared/theme";

const themeBootstrapHash = createHash("sha256").update(themeBootstrapScript).digest("base64");

// EPUB assets are untrusted. A direct document navigation must have an opaque
// origin and no active capabilities; the reader can still fetch their bytes.
export const readerAssetContentSecurityPolicy = [
  "sandbox",
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

type ContentSecurityPolicyOptions = {
  allowViteHmr?: boolean;
};

export const contentSecurityPolicy = ({
  allowViteHmr = false,
}: ContentSecurityPolicyOptions = {}) => {
  const scriptSource = allowViteHmr
    ? "script-src 'self' 'unsafe-inline'"
    : `script-src 'self' 'sha256-${themeBootstrapHash}'`;

  return [
    "default-src 'self'",
    scriptSource,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${allowViteHmr ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};
