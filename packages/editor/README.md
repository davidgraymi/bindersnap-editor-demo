# `src/editor/` — Bindersnap Editor Component

The core Tiptap-based rich text editor. **This is shared code used by both the landing page demo and the real application.**

## Boundary rules

- This directory contains **only the editor itself** — no app shell, no routing, no auth
- It must remain importable standalone (the landing page imports it without any Gitea dependency)
- All Gitea integration is wired at the `src/app/` level, not here
- Editor behavior that requires a Gitea client receives it as a **prop** — never imports from `src/services/gitea/` directly

## Structure

```
Editor.tsx                  — root component, exported as <BindersnapEditor>
components/                 — toolbar, menus, dialogs
extensions/                 — custom Tiptap extensions
  TrackedChanges/           — transaction interceptor + accept/reject
  ApprovalStatus/           — PR state banner (React component, not a ProseMirror node)
services/                   — editor-internal utilities (diff, serialization)
assets/                     — editor-specific CSS
  bindersnap-editor.css     — editor stylesheet (imports tokens from src/assets/css/)
sidebar/                    — sidebar panel components
```

## Demo vs. real usage

| Context | How editor is used |
|---|---|
| Landing page | `<BindersnapEditor readOnly initialContent={DEMO_SNAPSHOT} />` |
| Real app | `<BindersnapEditor documentId={id} giteaClient={client} />` |

The `giteaClient` prop being absent puts the editor into demo mode — no saves, no PRs, no collaboration. This is intentional and must be preserved.
