import type { SVGProps } from "react";

import logoMarkSpriteUrl from "../../../packages/ui-tokens/img/logo-mark.svg";

export function BindersnapLogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 18 18" fill="none" {...props}>
      <use href={`${logoMarkSpriteUrl}#bindersnap-logo-mark`} />
    </svg>
  );
}
