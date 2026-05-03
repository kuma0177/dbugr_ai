# Local Development Guide

## Goal

This guide is for someone who just cloned the repo and wants to build and use Dbugr locally on macOS.

## What You Need

Install these first:

- macOS
- Node.js `20+`
- `pnpm 9+`
- Rust toolchain
- Xcode Command Line Tools

Quick verification:

```bash
node -v
pnpm -v
rustc -V
xcode-select -p
```

If `xcode-select -p` fails, install Command Line Tools:

```bash
xcode-select --install
```

If Rust is missing:

```bash
curl https://sh.rustup.rs -sSf | sh
```

Then restart your terminal.

## Clone And Install

```bash
git clone <repo-url>
cd debugr
cp .env.example .env
pnpm install
pnpm db:setup
```

What this does:

- copies the local env template
- installs all monorepo dependencies
- generates Prisma client code
- creates the local SQLite DB
- seeds local data

## Main Local Run Path

The current primary app experience is the Tauri desktop app in `apps/desktop`.

Open four terminals:

```bash
# Terminal 1
cd apps/desktop
pnpm dev

# Terminal 2
cd apps/api
pnpm dev

# Terminal 3
cd apps/worker
pnpm dev

# Terminal 4
cd apps/web
pnpm dev
```

You should then have:

- desktop preview on `http://127.0.0.1:5173`
- web dashboard on `http://127.0.0.1:3000`
- API on `http://127.0.0.1:3001`
- worker on `http://127.0.0.1:3002`

## Native macOS Prototype

The Swift/AppKit migration prototype lives in `apps/desktop-native-mac`.

Run it with:

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac
```

Smoke test capture:

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac --capture-smoke
```

## Environment Variables

The default `.env.example` is enough for many local runs.

Important values:

- `DATABASE_URL` uses local SQLite
- `NEXT_PUBLIC_API_URL` points to local API
- `ANTHROPIC_API_KEY` is optional
- `GITHUB_*` and `JIRA_*` values are optional unless you are testing those integrations

## First-Run Permissions

On macOS, screen capture requires Screen Recording permission.

If capture fails:

1. Open `System Settings -> Privacy & Security -> Screen Recording`
2. Enable permission for the app or terminal used to launch Dbugr
3. Restart the app

Some workflows may also need Accessibility permission for shortcut or focus handling.

## Useful Commands

Root workspace:

```bash
pnpm build
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm db:migrate
```

Desktop app:

```bash
cd apps/desktop
pnpm test
pnpm build
```

Native mac prototype:

```bash
cd apps/desktop-native-mac
swift build
swift run debugr-native-mac --capture-smoke
```

## What Is Production-Ready Vs In Progress

Usable locally today:

- Tauri desktop app flow
- local session persistence
- review dashboard
- API and worker services
- MCP server
- native macOS prototype for capture and migration work

Still in progress:

- full native macOS parity
- deeper provider-aware routing
- auth
- durable cloud asset storage
- async/background job processing

## Troubleshooting

### `pnpm install` fails

Make sure you are using a supported Node version and `pnpm 9+`.

### Desktop app does not build

Make sure both Rust and Xcode Command Line Tools are installed.

### Capture returns blank or empty image

Re-check Screen Recording permission and restart the app after granting access.

### The web app loads but data is missing

Make sure `apps/api` and `apps/worker` are both running.

### Database errors

Try:

```bash
pnpm db:push
pnpm db:seed
```

## Related Docs

- [README.md](/Users/kumar/debugr/README.md:1)
- [docs/native-macos-migration.md](/Users/kumar/debugr/docs/native-macos-migration.md:1)
- [apps/desktop-native-mac/README.md](/Users/kumar/debugr/apps/desktop-native-mac/README.md:1)
