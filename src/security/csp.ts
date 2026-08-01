import { createHash } from "node:crypto";

import { themeBootstrapScript } from "../shared/theme";

const themeBootstrapHash = createHash("sha256").update(themeBootstrapScript).digest("base64");

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
