# Native macOS Migration Guide

## Purpose

Debugr should be macOS-native first. The current desktop app is a Tauri 2 + TypeScript application with native Rust and Objective-C capture code, but the fragile product surface is the exact surface macOS should own directly: screen/window capture, overlay windows, global shortcuts, focus behavior, and Screen Recording permission diagnostics.

This guide is a handoff document for Codex, Codecloud, or another agent picking up the migration in a later session. It explains the context, why the migration is worth doing, what not to rewrite first, and the phased plan.

## Current Context

- Current desktop app lives in `apps/desktop`.
- Main workspace UI is `apps/desktop/src/main.tsx`.
- Overlay UI is `apps/desktop/src/overlay.ts`.
- Tauri/Rust backend is `apps/desktop/src-tauri/src/main.rs`.
- Current native ScreenCaptureKit bridge is `apps/desktop/src-tauri/src/macos_screencapturekit.m`.
- The app already uses native macOS APIs through Rust/Objective-C, so capture bugs are not caused only by React or web UI.
- The recent regression involved a focused app/window going into the background and an empty-looking image being returned.
- A real native capture smoke test from the current runtime failed with `CoreGraphics did not return a display image`.
- Raw `screencapture -x /tmp/debugr-current-screen.png` also failed from the same environment with `could not create image from display`.

## Recommendation

Move toward a native Swift/AppKit macOS app, but do not do a big-bang rewrite.

The migration should start with the most macOS-sensitive parts of Debugr: capture, overlay, focus, permissions, and validation. Keep the existing data model, session shape, API contracts, and agent handoff behavior until native capture and annotation have parity.

## Product Direction

The native macOS app should not merely reproduce the current Tauri flow. It should move toward a simpler capture-first product experience with clearer session management and less picker noise.

### Desired User Flow

#### A. Start new session

`Start new session` -> `Capture / annotate screenshot` -> `Choose existing session or create new session` -> `Add annotation text note with screenshot`

#### B. Save notes into a session

`Submit notes to session` -> `Show confirmation that the session was saved` -> `Offer next action: submit to Claude/Codex/Cursor or add more annotations to an existing/new session`

#### C. Session context on creation

When a user creates a new session, Debugr should ask for:

- GitHub repo, or
- Local project folder

That repo/folder becomes part of the session context before the handoff to Claude, Codex, or Cursor.

#### D. Submit to Claude / Codex / Cursor

`User chooses provider with a radio selector` -> `First-time connection flow if provider is not yet linked` -> `Show the exact prompt/summary being submitted` -> `Show immediate provider response and/or handoff confirmation`

The connection mechanism may differ by provider:

- Claude / Codex: CLI, MCP, local auth, or API key path
- Cursor: local handoff / background integration

The UX goal is consistent even if the plumbing differs.

## Experience Review

### What is missing from the current docs

The current [README.md](/Users/kumar/debugr/README.md:1) and this guide cover the technical migration, but they do not yet fully specify:

- The exact user journey after a save.
- The explicit “save confirmation -> choose next action” state.
- The rule that repo/folder context belongs to session creation.
- The provider selection UX as a first-class decision.
- The requirement to show the prompt summary that gets sent.
- The fact that the capture picker should optimize for “content on screen” rather than a raw dump of system windows.

### What is missing from the current app experience

Based on the current Tauri flow and the screenshots of the picker:

- The source picker is too noisy. It exposes raw OS windows such as helper windows, untitled windows, app internals, and Debugr itself.
- The picker implies a technical model (“choose any SCWindow”) rather than the user’s model (“capture the thing I’m looking at”).
- Browser tabs are not represented as first-class items. On macOS, ScreenCaptureKit lists windows, not tabs, so the UX should not promise tab-level precision unless we build browser-specific integrations.
- The current flow mixes session selection, session creation, source selection, and annotation in a way that still feels operational rather than calm and obvious.
- The save step is underspecified from a user-feedback perspective. Saving should clearly end one unit of work and tee up the next action.

## Capture Picker Decision

The product should prefer a simpler capture model:

1. Default action: capture visible content on screen.
2. Secondary action: capture an entire display.
3. Advanced action: choose a specific window from a filtered list.

If a window list is shown, it should be curated:

- Hide Debugr’s own windows.
- Hide obvious helper/service windows.
- Hide duplicate untitled utility windows when possible.
- Group by owning app.
- Prefer app name first, then meaningful title.
- Put browser windows in a dedicated section.

Important constraint:

- ScreenCaptureKit gives us windows, not browser tabs.
- If users want tab-level targeting, the right long-term solution is likely browser-aware capture integration, not a raw ScreenCaptureKit window list.

Because of that, the native app should likely support:

- `Capture visible area`
- `Capture full screen`
- `Choose app window` as an advanced path

Instead of leading with a long OS window dump.

## Four-Point Plan

### 1. Native macOS capture and overlay first

Build a new native macOS app shell focused on the capture workflow:

- Menu bar app or lightweight launcher.
- Global shortcut.
- Screen/window picker using ScreenCaptureKit.
- Transparent annotation overlay using AppKit windows.
- Screenshot freeze and annotation drawing over the frozen frame.
- Screen Recording permission checks and user-facing diagnostics.
- Debug output that saves the actual captured image when capture fails or appears blank.

This is the part most likely to benefit from Swift/AppKit because it can directly control `NSApplication`, `NSWindow`, activation policy, window levels, Spaces behavior, and ScreenCaptureKit lifecycle.

### 2. Keep current TypeScript app logic temporarily

Do not throw away working product logic while replacing the shell.

Keep or mirror these existing contracts:

- Session and capture model from `apps/desktop/src/core.ts`.
- Stored session shape used by the current desktop app.
- API contracts in `apps/api`.
- MCP server expectations in `apps/mcp-server`.
- Claude/Codex provider configuration behavior.
- Web dashboard compatibility.

The first native implementation can export saved sessions/screenshots in the same shape the current app uses. This keeps the web dashboard and MCP server useful during migration.

### 3. Replace the Tauri shell gradually

After native capture and annotation are reliable, migrate outward:

- Native workspace/session list.
- Native capture detail view.
- Native provider settings for Claude, Codex, and Cursor.
- Native send-to-agent confirmation flow.
- Native persistence and screenshot asset management.
- Native error/reporting surfaces.

Until those pieces exist, the current Tauri desktop app remains the fallback and reference implementation.

### 4. Retire Tauri after parity

Only remove the Tauri desktop app once the native app supports:

- Launch and global shortcut.
- Capture source selection.
- Actual screenshot validation against the visible screen/window.
- Annotation creation, editing, deletion, and save.
- Session persistence.
- Screenshot asset persistence.
- Provider configuration.
- Send-to-Claude/Codex flow.
- Web dashboard/MCP compatibility.
- Release packaging and signing.

Do not delete or rewrite the existing desktop app until the native implementation has a tested equivalent for the core flow.

## Proposed Repository Shape

Start with a separate app so the migration can proceed safely:

```text
apps/
  desktop/             # Existing Tauri app, kept as reference/fallback
  desktop-native-mac/  # New Swift/AppKit app
```

Recommended initial contents:

```text
apps/desktop-native-mac/
  README.md
  DebugrMac.xcodeproj or Package.swift
  Sources/
    AppDelegate.swift
    Capture/
    Overlay/
    Permissions/
    Persistence/
    Models/
  Tests/
```

Prefer Swift/AppKit for the capture and overlay layer. SwiftUI is fine for ordinary app screens, but AppKit should own the overlay and window-management pieces because those are the current failure points.

## First Milestone

Create the smallest native app that proves the risky path:

1. Launches as a macOS app.
2. Registers a global shortcut.
3. Lists available displays/windows.
4. Captures a selected display/window with ScreenCaptureKit.
5. Displays the captured image in a native preview.
6. Runs a basic blank-image validation.
7. Saves the captured PNG to `~/Library/Application Support/debugr/native-capture-debug/`.

Success criteria:

- The saved debug PNG visibly matches the selected source.
- If the capture is blank, transparent, or too small, the app reports a failure instead of silently accepting it.
- Permission errors identify the exact running app/bundle path that needs Screen Recording access.

### Status: Started

`apps/desktop-native-mac` now exists as a Swift Package/AppKit prototype.

Current verified behavior:

- `swift build` succeeds.
- `swift run debugr-native-mac --capture-smoke` lists ScreenCaptureKit sources.
- The smoke command captured the actual display and saved debug artifacts.
- The saved PNG was visually inspected and matched the real desktop, including the active Codex window.
- Validation reported the capture as valid rather than trusting byte count alone.
- The native prototype now exposes a simpler chooser model: `Visible area`, `Full screen`, and `App window`.
- The advanced window path filters obvious helper/service windows and sorts browser windows first.
- The native prototype now persists local sessions under `~/Library/Application Support/debugr/native-workspace/`.
- A captured frame can now be reviewed, annotated with note text, and saved into an existing or new native session.
- The native app now includes a first-pass workspace panel with session summary, provider target chooser, prompt preview, and immediate handoff-status copy.

Latest verified smoke output shape:

```text
debugr_native_smoke_sources=20
debugr_native_smoke_source=Screen - 1728x1117 pt
debugr_native_smoke_validation=valid 1728x1117, dominant=0.83, transparent=0.00
debugr_native_smoke_png=~/Library/Application Support/debugr/native-capture-debug/<stamp>-display-1.png
debugr_native_smoke_json=~/Library/Application Support/debugr/native-capture-debug/<stamp>-display-1.json
```

Build and smoke commands:

```bash
cd apps/desktop-native-mac
swift build
swift run debugr-native-mac --capture-smoke
```

Note: SwiftPM may need normal user cache access for `~/Library/Caches/org.swift.swiftpm` and `~/.cache/clang`. In sandboxed agent sessions, `swift build` / `swift run` may require elevated execution.

## Next Milestones

### Milestone 2: Native capture UX cleanup

Build a user-friendly capture chooser before the full annotation rewrite:

- Add `Capture visible area` as the default path.
- Add `Entire screen` as a one-click option.
- Keep `Choose window` as an advanced option.
- Filter and group noisy ScreenCaptureKit windows.
- Exclude Debugr’s own windows and obvious helper/system rows.

Success criteria:

- The picker no longer looks like a raw OS debugger list.
- A user can capture what they are already looking at without understanding macOS window internals.

### Milestone 3: Native annotation overlay

- Freeze the captured frame.
- Draw box/region annotations over it.
- Add note text per annotation.
- Save screenshot + notes into a session payload.
- Show a clear “saved to session” confirmation state.

Status update:

- `Save screenshot + notes into a session payload` has started in the native app.
- The current Swift prototype supports text-note annotations tied to a captured screenshot and saves them into native session storage.
- The missing piece is the true native visual overlay/editor for box or region placement on top of the frozen frame.

### Milestone 4: Session and handoff flow

- Choose existing session or create a new one after annotation.
- Require repo/folder context on new-session creation.
- Add provider radio selector for Claude / Codex / Cursor.
- Show provider connection status and first-run linking UX.
- Show the prompt summary before send.
- Show immediate response or handoff confirmation after send.

Status update:

- `Choose existing session or create a new one` is now started in the Swift prototype.
- Repo/folder fields, provider target selection, prompt preview, and immediate response copy all exist in first-pass native form.
- Real provider connection plumbing and real send execution still need to be implemented.

## Capture Validation Requirements

The native app must not trust byte length alone.

Validate captured frames by checking:

- Image width and height are non-zero.
- PNG/JPEG decode succeeds.
- Pixel sample is not fully transparent.
- Pixel sample is not overwhelmingly a single blank color unless the source is genuinely blank.
- Captured dimensions match the expected display/window bounds within a reasonable tolerance.

When validation fails:

- Save the raw frame if one exists.
- Save a small JSON diagnostic file next to it.
- Show a user-facing recovery message.
- Log capture source, bundle id, executable path, permission state, and window/display metadata.

## Existing Bugs This Migration Should Address

- Overlay focus/background race around capture.
- Empty or blank images being accepted as successful captures.
- Debuggability gap where the app does not always preserve the actual frame it captured.
- Tauri/WebView overlay lifecycle racing native macOS window behavior.
- Screen Recording permission confusion between dev binary, bundled app, and shell tools.

## Things Not To Do First

- Do not rewrite the whole workspace UI before proving native capture.
- Do not delete `apps/desktop`.
- Do not change API contracts unless native capture requires it.
- Do not depend on Playwright mocks as proof that capture works.
- Do not consider a capture successful only because `ScreenCaptureKit` returned bytes.

## Suggested Next Task For A New Agent

The next practical implementation step is to finish Milestone 3 and harden Milestone 4.

Concretely:

- Replace the text-note-only draft flow with a true native box/region annotation overlay on the frozen frame.
- Persist annotation geometry along with note text.
- Promote the current workspace panel into a fuller native session browser with saved capture previews.
- Replace the prototype provider toggle with real Claude/Codex/Cursor connection flows.
- Wire the native prompt preview panel into real send execution and immediate provider responses.

Use the current Tauri app only as a behavior/reference source where it helps, especially:

- `apps/desktop/src/core.ts` for model semantics.
- `apps/desktop/src-tauri/src/macos_screencapturekit.m` for existing ScreenCaptureKit assumptions.
- `apps/desktop/src-tauri/src/main.rs` for current persistence paths and permission diagnostics.

When the native prototype reaches the next milestone, update this document with:

- Build/run instructions.
- Manual verification steps.
- Known macOS permission behavior.
- Remaining parity checklist.
