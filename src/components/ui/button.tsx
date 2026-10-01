import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-(length:--fs-base) font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-(--duration-press) ease-(--ease-out) select-none motion-safe:active:not-aria-[haspopup]:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--button-primary)] text-[var(--button-primary-foreground)] hover:bg-[var(--button-primary-hover)]",
        outline:
          "border-border bg-background text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/12 dark:hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // Pixel sizes, not rem: the root font size is 14px, which would shrink
        // rem-based heights off the 32px grid that inputs and selects use.
        default:
          "h-[32px] gap-1.5 px-[12px] has-data-[icon=inline-end]:pr-[10px] has-data-[icon=inline-start]:pl-[10px]",
        xs: "h-[24px] gap-1 rounded-[min(var(--radius-md),10px)] px-[8px] text-(length:--fs-sm) in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-[6px] has-data-[icon=inline-start]:pl-[6px] [&_svg:not([class*='size-'])]:size-[12px]",
        sm: "h-[28px] gap-1 rounded-[min(var(--radius-md),12px)] px-[10px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-[8px] has-data-[icon=inline-start]:pl-[8px] [&_svg:not([class*='size-'])]:size-[14px]",
        lg: "h-[36px] gap-1.5 px-[14px] has-data-[icon=inline-end]:pr-[12px] has-data-[icon=inline-start]:pl-[12px]",
        icon: "size-[32px]",
        "icon-xs":
          "size-[24px] rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-[12px]",
        "icon-sm":
          "size-[28px] rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-[36px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
