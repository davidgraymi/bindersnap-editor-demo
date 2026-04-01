# Bindersnap Editor Demo

A document editor backed by Gitea for version control, supporting real-time collaboration, approval workflows, and `.docx` import/export.

## Local Development

### Prerequisites
- [Bun](https://bun.sh) v1.x
- [Docker](https://www.docker.com) + Docker Compose

### 1. Start the dev stack

```bash
bun run up
```

This starts:
- **Gitea** at `http://localhost:3000` (git backend + API)
- **Hocuspocus** at `ws://localhost:1234` (real-time collaboration)
- **App** at `http://localhost:5173`

The seed script runs automatically and prints setup values:

```
==================================================
OAUTH_CLIENT_ID=abc123...
Add to dev/.env:
  BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID=abc123...
==================================================
```

### 2. Configure environment

```bash
cp dev/.env.example dev/.env
# Then fill in BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID from seed output above
```

### 3. Run the app locally (outside Docker)

```bash
bun install
bun dev
```

The app runs at `http://localhost:5173`. With `BUN_PUBLIC_DEV_AUTO_LOGIN=true` set (default), it logs in automatically using the seeded `alice` admin account.

To test the PKCE OAuth2 flow instead, set `BUN_PUBLIC_DEV_AUTO_LOGIN=false` in `dev/.env` and ensure `BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID` is filled in.

---

## Scripts

| Command | Description |
|---|---|
| `bun dev` | Dev server with hot reload |
| `bun start` | Production server |
| `bun run build` | Build to `dist/` |
| `bun run up` | Start Docker dev stack (Gitea + app) |
| `bun run down` | Stop and remove Docker volumes |
| `bun run test:integration` | Run Playwright integration tests |

---

## Production Deployment

See [`dev/railway.env.example`](dev/railway.env.example) for Railway environment variables to deploy the Gitea backend.

The SPA is deployed to S3 + CloudFront via the GitHub Actions workflow in `.github/workflows/`.
