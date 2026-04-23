import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Check,
  Clock3,
  FileText,
  Globe,
  Lock,
  Moon,
  PencilLine,
  SunMedium,
  Users,
  X,
} from "lucide-react";
import { createRoot } from "react-dom/client";

const icons: Record<string, LucideIcon> = {
  "badge-check": BadgeCheck,
  check: Check,
  "clock-3": Clock3,
  "file-text": FileText,
  globe: Globe,
  lock: Lock,
  moon: Moon,
  "pencil-line": PencilLine,
  "sun-medium": SunMedium,
  users: Users,
  x: X,
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mountLandingIcons(root: ParentNode = document): void {
  const iconNodes = root.querySelectorAll<HTMLElement>("[data-lucide-icon]");

  for (const node of iconNodes) {
    if (node.dataset.lucideMounted === "true") {
      continue;
    }

    const Icon = icons[node.dataset.lucideIcon ?? ""];
    if (!Icon) {
      continue;
    }

    const iconRoot = createRoot(node);
    iconRoot.render(
      <Icon
        aria-hidden="true"
        color={node.dataset.lucideColor}
        focusable="false"
        size={parseNumber(node.dataset.lucideSize, 24)}
        strokeWidth={parseNumber(node.dataset.lucideStrokeWidth, 2)}
      />,
    );
    node.dataset.lucideMounted = "true";
  }
}
