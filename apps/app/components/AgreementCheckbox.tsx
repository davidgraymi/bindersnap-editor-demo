import { Fragment, type ReactNode } from "react";

import {
  AGREEMENT_WORDS,
  type AgreementScope,
  PRIVACY_PATH,
  TERMS_PATH,
} from "../../../packages/utils/legal";

/**
 * The box a person ticks to agree to the Terms, worded as `AGREEMENT_WORDS`
 * says, with the documents one click away in a new tab.
 *
 * Unticked to start, every time: agreeing is something a person does, not
 * something the form assumes.
 */
export function AgreementCheckbox({
  scope,
  organization,
  checked,
  onChange,
}: {
  scope: AgreementScope;
  /** The organization's name, for `organization` agreements. */
  organization?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="app-check-row app-terms-row">
      <input
        className="app-check-input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{agreementSentence(scope, organization)}</span>
    </label>
  );
}

function agreementSentence(
  scope: AgreementScope,
  organization: string | undefined,
): ReactNode[] {
  const links: Record<string, ReactNode> = {
    terms: (
      <a href={TERMS_PATH} target="_blank" rel="noopener">
        Terms of Service
      </a>
    ),
    privacy: (
      <a href={PRIVACY_PATH} target="_blank" rel="noopener">
        Privacy Policy
      </a>
    ),
    organization: <strong>{organization || "this organization"}</strong>,
  };

  return AGREEMENT_WORDS[scope]
    .split(/(\{[a-z]+\})/)
    .map((part, index) => (
      <Fragment key={index}>
        {part.startsWith("{") ? links[part.slice(1, -1)] : part}
      </Fragment>
    ));
}
