# Contributing to Dbugr

Thanks for taking a look at Dbugr. The project is a local-first macOS feedback capture app for AI coding workflows, with a Tauri desktop app, Next.js web review surface, Express API, worker, shared packages, and MCP experiments.

## Development Setup

Requirements:

- macOS 13+
- Node.js 20+
- pnpm 9+
- Rust toolchain
- Xcode Command Line Tools

```bash
git clone https://github.com/kuma0177/debgr_ai.git
cd debgr_ai
cp .env.example .env
pnpm install
pnpm db:setup
```

Run the local stack:

```bash
pnpm dev
```

You can also run the services separately:

```bash
pnpm --filter @feedbackagent/api dev
pnpm --filter @feedbackagent/web dev
pnpm --filter @feedbackagent/worker dev
pnpm --filter @feedbackagent/desktop dev
```

## Before Opening a Pull Request

Run the checks that match your change:

```bash
pnpm --filter @feedbackagent/desktop test
pnpm --filter @feedbackagent/api build
pnpm --filter @feedbackagent/web build
```

For desktop native/Tauri changes:

```bash
cd apps/desktop/src-tauri
cargo fmt --check
cargo check
```

If you touch desktop capture, annotation, overlay, Screen Recording permission, session save, provider handoff, desktop sync, team/public review, seed/smoke data, or review curation code, read and follow `docs/desktop-regression-ledger.md` before changing code.

## Pull Request Guidelines

- Keep changes focused and explain the user-facing behavior.
- Add or update regression tests for fixed bugs.
- Do not commit local `.env` files, screenshots with private data, API keys, or generated build artifacts.
- Preserve local-first behavior: provider API keys should stay on the user's machine unless a feature explicitly documents otherwise.

## Release Builds

Packaged macOS builds are distributed through GitHub Releases. Maintainers can create a release tag and let the desktop release workflow build the DMG, or upload a locally built DMG with the GitHub CLI.
