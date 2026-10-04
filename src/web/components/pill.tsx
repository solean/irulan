import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Compact rounded label. `tone` colors the dot; only "danger" tints the whole pill (see .pill). */
export const Pill = ({
  children,
  className,
  dot = false,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { dot?: boolean; tone?: PillTone }) => (
  <span className={cn("pill", `pill-${tone}`, dot && "pill-dot", className)} {...props}>
    <span className="pill-label">{children}</span>
  </span>
);
