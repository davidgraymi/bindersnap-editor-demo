# bindersnap-editor-demo

## Workflow

1. Drafting: The user edits in Editor. Changes are automatically saved to a temporary "Draft" database so the user can keep a draft between sessions and across devices. Multiple people can even work on drafts at the same time with Y.js.
2. The "Commit": The user clicks "Propose Changes." Behind the scenes, bindersnap takes the Tiptap JSON, formats it cleanly, and performs a git commit on a new branch.
3. The "Pull Request": Bindersnap creates a PR via the GitHub API.
4. Verification: The managed Git service verifies the user's OIDC (OpenID Connect) token or digital signature.
5. Rules: The PR remains "Locked" until the repos specific rules (e.g., "Must be signed by an Admin") are met.
6. Merges: After a PR is approved and merged to main all drafts must be pulled and conflicts resolved. Try to auto-merge but fall back to a 3-way guided merge in the editor.

## Getting Started

To install dependencies:

```bash
bun install
```

To start a development server:

```bash
bun dev
```

To run for production:

```bash
bun start
```

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
