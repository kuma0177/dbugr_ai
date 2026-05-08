# Dbugr Desktop Client Design Source Of Truth

This folder is the source of truth for converting the Dbugr desktop client into a polished native Swift/AppKit macOS app.

The goal is simple: keep the web app for account, team, feed, admin, and review workflows, while moving the local capture and annotation experience into native macOS code so it feels fast, reliable, and impossible to confuse with a web overlay.

## Product Principle

The native app must reproduce the polished capture experience from the stable desktop release, not the gray AppKit prototype screen.

The stable target experience has:

- A top-left shortcut/status pill.
- A frozen screenshot canvas that matches what the user was looking at.
- A bottom floating annotation toolbar.
- A draggable/resizable region box with visible handles.
- Numbered pin annotations.
- A right-side annotation note panel.
- A clear session target step before saving.
- A confirmation state after adding notes.

The current native prototype window is useful for testing ScreenCaptureKit and persistence, but it is not the final user experience.

## Native vs Web Ownership

Native Swift/AppKit owns:

- Menu bar app lifecycle.
- Global shortcut.
- Screen Recording permission checks.
- macOS permission prompt and recovery.
- Screen/window/source picker.
- Frozen screenshot capture.
- Annotation overlay window.
- Region crop and pin placement.
- Note entry panel.
- Local session save and secure device identity.
- Sync calls to the web/API after the user chooses Direct, Team, or Public.

Web owns:

- Sign-up and sign-in.
- Organization and team management.
- Notes feed: Private, Team, Public.
- Session boards.
- Admin.
- AI handoff settings.
- Public/community review.
- Digest emails and review notifications.

## Design Files

- [Design Tokens](./design-tokens.md)
- [Annotation Flow](./annotation-flow.md)
- [Layouts](./layouts.md)
- [Components](./components.md)
- [Swift Implementation Contract](./swift-implementation-contract.md)
- [Copy And States](./copy-and-states.md)

## Non-Negotiables

- Do not show a blank gray native control panel as the main desktop experience.
- Do not let Dbugr's own windows appear in the capture unless the user explicitly captures Dbugr.
- Do not use a Tauri or web overlay for native capture once the Swift path is ready.
- Do not prompt for Screen Recording if native preflight says access is already granted.
- Do not block macOS permission dialogs with Dbugr overlays.
- Do not lose keyboard focus inside annotation notes.
- Do not save an empty image object.
- Do not silently accept blank or transparent captures.

## Stable Reference

Use `stable-macos-claude-codex-cli` / commit `45b262ff47b769b6801eff493ab1f55b59c55e38` as the behavioral recovery point for the local annotation flow.

The native implementation can improve internals, but it should preserve the stable product rhythm:

1. Start annotation.
2. Pick what to capture.
3. Freeze the screen.
4. Annotate with pin or region.
5. Choose or create a session.
6. Save and confirm.
7. Continue annotation or open the session board.

