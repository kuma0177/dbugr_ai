# Debugr Native Mac Prototype

This is the native macOS-first prototype for Debugr. It intentionally lives beside the existing Tauri app while we prove the risky native path: source listing, ScreenCaptureKit capture, validation, and debug artifact persistence.

## Run

```bash
cd apps/desktop-native-mac
swift run debugr-native-mac
```

Terminal smoke test:

```bash
swift run debugr-native-mac --capture-smoke
```

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
- Screen Recording permission diagnostics.
- Global shortcut scaffold using Carbon (`Command-Control-Z`).

## Not Yet Included

- Native annotation overlay.
- Session persistence parity with `apps/desktop`.
- Claude/Codex provider settings.
- Send-to-agent flow.
- App bundle/signing/notarization.

Keep `apps/desktop` as the reference implementation until this prototype reaches capture and annotation parity.
