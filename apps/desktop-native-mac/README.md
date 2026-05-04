# Debugr Native Mac Prototype

This is the native macOS-first prototype for Debugr. It intentionally lives beside the existing Tauri app while we prove the risky native path: source listing, ScreenCaptureKit capture, validation, annotation save flow, native session persistence, and provider payload review.

## Run

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac
```

Terminal smoke test:

```bash
swift run debugr-native-mac --capture-smoke
```

This is the Phase 1 macOS capture gate. The older Tauri `DEBUGR_CAPTURE_SMOKE=1`
CoreGraphics probe is retained only as a deprecated legacy diagnostic while the
product moves capture and overlay ownership into Swift/AppKit.

The app saves capture debug artifacts to:

```text
~/Library/Application Support/debugr/native-capture-debug/
```

Each capture writes a PNG plus a JSON diagnostic file. The app should reject blank or invalid captures instead of silently accepting them.

## Current Scope

- Native AppKit window.
- ScreenCaptureKit source listing with simpler capture modes.
- Default `Visible area` capture based on the display under the mouse pointer.
- `Full screen` capture for whole-display snapshots.
- Advanced `App window` capture with filtered windows and browser-first ordering.
- Display/window capture through ScreenCaptureKit.
- Pixel-level blank-image validation.
- Debug PNG and JSON persistence.
- Native local session persistence under `~/Library/Application Support/debugr/native-workspace/`.
- Draft annotation note add / update / delete flow before save.
- Save captured screenshots into native sessions with durable asset paths.
- Native workspace panel with saved-session summary and prompt preview.
- Provider target selector for Claude, Codex, and Cursor with prototype connection state + payload preparation.
- Screen Recording permission diagnostics.
- Global shortcut scaffold using Carbon (`Command-Control-Z`).

## Not Yet Included

- Native overlay drawing/editing over the frozen frame.
- Full session workspace parity with `apps/desktop`.
- Real Claude/Codex/Cursor connection plumbing.
- Real send-to-agent execution and streaming response handling.
- App bundle/signing/notarization.

Keep `apps/desktop` as the reference implementation until this prototype reaches capture and annotation parity.
