import type { AriaAttributes, SVGAttributes } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * A lucide icon at one of the four sizes on the icon scale, so two icons
 * placed side by side always match (see docs/design/design-system-audit.md,
 * Task 12). Named AppIcon rather than Icon because several components
 * already use `Icon` as a local variable name for a dynamically chosen
 * lucide component (`const Icon = TONE_ICONS[tone]`) — pass that variable
 * as the `icon` prop here instead.
 */
export type AppIconSize = "xs" | "sm" | "md" | "lg";

/**
 * A var() in an SVG presentation attribute resolves, but an *undefined*
 * one collapses the icon to 0x0 rather than falling back to lucide's
 * default — so every reference carries the scale value as a fallback.
 */
const ICON_SIZE_VAR: Record<AppIconSize, string> = {
  xs: "var(--brand-icon-xs, 12px)",
  sm: "var(--brand-icon-sm, 14px)",
  md: "var(--brand-icon-md, 16px)",
  lg: "var(--brand-icon-lg, 20px)",
};

export function AppIcon({
  icon: Icon,
  size = "sm",
  heavy = false,
  className,
  "aria-hidden": ariaHidden = "true",
  ...rest
}: {
  icon: LucideIcon;
  size?: AppIconSize;
  /** Use the heavier stroke for emphasis only — 1.5 is the default weight. */
  heavy?: boolean;
  className?: string;
  "aria-hidden"?: AriaAttributes["aria-hidden"];
} & Omit<SVGAttributes<SVGSVGElement>, "size">) {
  return (
    <Icon
      size={ICON_SIZE_VAR[size]}
      strokeWidth={
        heavy
          ? "var(--brand-icon-stroke-heavy, 2)"
          : "var(--brand-icon-stroke, 1.5)"
      }
      className={className}
      aria-hidden={ariaHidden}
      {...rest}
    />
  );
}
