import { DocumentCollaborators } from "./DocumentCollaborators";
import { DocumentPermissions } from "./DocumentPermissions";

interface DocumentAccessProps {
  owner: string;
  repo: string;
  currentUsername: string;
}

/**
 * Access & approvals — one page, because it was always one question.
 *
 * "Team" said who could see the document and "Settings" said how many of them
 * had to sign off before it published. Splitting those across two tabs meant
 * adding an approver and requiring their approval were two different errands.
 * They are the same errand, so this is the page that answers it: who is on
 * this document, then what has to happen before anything lands.
 */
export function DocumentAccess({
  owner,
  repo,
  currentUsername,
}: DocumentAccessProps) {
  return (
    <div className="doc-access">
      <section className="doc-access-section" aria-label="Who has access">
        <h2 className="doc-access-heading">Who has access</h2>
        <DocumentCollaborators
          owner={owner}
          repo={repo}
          currentUsername={currentUsername}
        />
      </section>

      <section className="doc-access-section" aria-label="Approval rules">
        <h2 className="doc-access-heading">Approval rules</h2>
        <DocumentPermissions
          owner={owner}
          repo={repo}
          currentUsername={currentUsername}
        />
      </section>
    </div>
  );
}
