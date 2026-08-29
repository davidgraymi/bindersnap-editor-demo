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

const ICON_SIZE_VAR: Record<AppIconSize, string> = {
  xs: "var(--brand-icon-xs)",
  sm: "var(--brand-icon-sm)",
  md: "var(--brand-icon-md)",
  lg: "var(--brand-icon-lg)",
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
        heavy ? "var(--brand-icon-stroke-heavy)" : "var(--brand-icon-stroke)"
      }
      className={className}
      aria-hidden={ariaHidden}
      {...rest}
    />
  );
}
