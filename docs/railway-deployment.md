# Railway Deployment Guide

This guide describes the Phase 2 web deployment target for Dbugr.

## Deployment Shape

Use Railway as two services from the same GitHub repository:

- `dbugr-web`: Next.js web app
- `dbugr-api`: Express API

Keep the macOS desktop app local. The deployed web/API layer is for onboarding, organization management, review feeds, comments, curation, and AI preflight state.

## Current Database Note

The repo currently uses Prisma with local SQLite for the stable local development path.

For an early private Railway preview, use a Railway volume-backed SQLite database for the API service. Before a public multi-user launch, move the API database to Railway Postgres and update the Prisma provider/migrations in a dedicated database migration milestone.

Do not put personal Claude, Codex, Cursor, Anthropic, OpenAI, or GitHub user keys on Railway for normal personal usage. Phase 2 is designed so user/provider credentials can remain local to the user's device unless an organization explicitly enables org-managed credentials later.

## Required Railway Variables

API service:

```bash
NODE_ENV=production
DATABASE_URL=file:/data/debugr.db
PORT=${{PORT}}
```

Web service:

```bash
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://<your-api-service>.up.railway.app/api
PORT=${{PORT}}
```

Future production auth/email variables:

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_SECRET=
RESEND_API_KEY=
TRUST_SAFETY_EMAIL=
```

## API Service

Create a Railway service connected to the GitHub repo.

Set service commands:

```bash
pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @feedbackagent/shared build && pnpm --filter @feedbackagent/api build
```

Start command:

```bash
pnpm railway:api:start
```

Attach a Railway volume mounted at:

```text
/data
```

Then initialize the database once from the Railway shell:

```bash
pnpm db:push
pnpm db:seed
```

After that first initialization, ongoing API deploys should rely on the start command above. It runs:

```bash
pnpm railway:api:prepare-db
```

before starting the API, so schema additions like `organization.logoUrl` are applied automatically against the Railway `DATABASE_URL`.

## Web Service

Create a second Railway service connected to the same GitHub repo.

Set service commands:

```bash
pnpm install --frozen-lockfile && pnpm --filter @feedbackagent/shared build && pnpm --filter @feedbackagent/web build
```

Start command:

```bash
pnpm --filter @feedbackagent/web exec next start -p $PORT
```

## Smoke Test

After the API deploys, run the Phase 2 endpoint smoke locally against Railway:

```bash
PHASE2_API_BASE_URL=https://<your-api-service>.up.railway.app/api pnpm --filter @feedbackagent/api test:phase2
```

Expected coverage:

- onboarding creates or updates a demo Google-shaped identity
- organization membership exists
- review feed loads
- contribution is created
- owner curation accepts a contribution
- AI preflight creates a bulleted prompt draft

## Public Launch Gate

Before inviting real public users:

- [ ] Replace demo auth with real Google OAuth.
- [ ] Move from SQLite-on-volume to Railway Postgres.
- [ ] Add production session/cookie security.
- [ ] Add invitation email sending.
- [ ] Add public redaction confirmation UI.
- [ ] Move organization logo storage from inline/data URLs to blob/object storage while keeping `organization.logoUrl` as the API contract.
- [ ] Add rate limiting and report/moderation workflow for public feed.
- [ ] Confirm audit events exist for invites, visibility changes, curation, and preflight.
