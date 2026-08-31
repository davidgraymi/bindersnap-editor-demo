# Gitea Spec

## gitea.d.ts

Auto-generated from `bun run generate:api`, which reads `swagger.v1.json` off a
running Gitea. The committed types were generated from 1.26.1.

The stack now runs Gitea 1.27.3. That is deliberate and safe: 1.27 removes no
API path, no method and no response field the BFF reads — it only adds
endpoints and optional fields this app does not use — so the committed types
still describe every call in `services/api/gitea-client/`. Regenerate against a
1.27 instance (`bun run up`, then `bun run generate:gitea-client`) when the BFF
needs one of the endpoints or fields 1.27 added.

## extensions.json

Maitained by Bindersnap. Used to extend the openapi spec with additional information. Typically used for adding enumerations to `string` types.
