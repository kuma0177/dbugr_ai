# Native Annotation Flow

This is the canonical desktop annotation flow. Swift/AppKit should implement this path before adding broader workspace screens.

## 1. Start Annotation

Entry points:

- Menu bar: `New Annotation`.
- Global shortcut: `Control + Command + Z`.
- Web deep link after account connection: opens the app, but should not start capture unless explicitly requested.

Required behavior:

- Hide or close Dbugr session/admin windows before capture.
- Do not activate a large Dbugr window.
- Do not push the user's current app/browser into the background.
- Do not show Dbugr in the captured source list unless the user explicitly asks to capture Dbugr.

Telemetry:

- `desktop.annotation.start_requested`
- `desktop.annotation.preflight_started`
- `desktop.annotation.dbugr_windows_hidden`

## 2. Permission Preflight

Native code must check Screen Recording before showing any source picker that depends on system source lists.

Implementation expectations:

- Use `CGPreflightScreenCaptureAccess`.
- Use `CGRequestScreenCaptureAccess` only when the user asks or preflight fails.
- Never show the permission prompt under a Dbugr overlay.
- If access is already granted, do not show copy that says permission is off.
- If macOS requires an app restart after permission changes, say that clearly.

Good recovery copy:

> Screen Recording access is needed.
> Dbugr needs this once so it can list screens and windows. Enable Dbugr in System Settings, then quit and reopen Dbugr.

Telemetry:

- `desktop.permission.preflight`
- `desktop.permission.request_opened`
- `desktop.permission.settings_opened`
- `desktop.permission.restart_hint_shown`

## 3. Source Picker

The picker should match the user's model: "what do I want to capture?"

Top tabs:

- `Current screen`
- `Browser tabs/pages`
- `Other apps`

Important constraint:

- macOS does not expose true browser tabs through ScreenCaptureKit.
- The browser tab/page section should group browser windows and use page/window titles.
- Do not promise tab-level precision unless a browser integration is available.

Picker copy:

> Capture the current screen, a browser page, or another app window. Dbugr freezes it once, then you annotate on top.

Picker content:

- Current screen: one primary card for the display under the cursor, plus other displays if connected.
- Browser tabs/pages: browser windows grouped by app, sorted by visible/frontmost likelihood.
- Other apps: non-browser app windows, filtered to remove helpers and Dbugr.

Empty state:

> macOS did not return any windows yet. Refresh once. If the list is still empty, quit and reopen Dbugr so macOS refreshes the Screen Recording grant.

Telemetry:

- `desktop.source_picker.opened`
- `desktop.source_picker.refreshed`
- `desktop.source_picker.source_selected`
- `desktop.source_picker.empty`

## 4. Freeze Capture

After source selection:

1. Hide the source picker.
2. Capture the selected screen/window.
3. Validate the image.
4. Show the frozen image as the canvas.

Validation rules:

- Reject missing image data.
- Reject images below minimum dimensions.
- Reject fully transparent or near-blank captures.
- Save debug artifacts when validation fails.

Telemetry:

- `desktop.capture.started`
- `desktop.capture.finished`
- `desktop.capture.validation_passed`
- `desktop.capture.validation_failed`

## 5. Annotation Canvas

The overlay is a native full-screen AppKit window, not a Tauri webview.

Visible elements:

- Top-left shortcut/status pill.
- Bottom floating toolbar.
- Frozen screenshot.
- Region rectangle or pin marker.
- Right annotation note panel when an annotation is active.

Top-left pill:

> `⌃` `⌘` `Z` 1 annotation - save each note, then tap Finish below.

Bottom toolbar:

- `Pin`
- `Region`
- `Esc`
- `Add to session`

Toolbar behavior:

- Pin mode places a numbered marker.
- Region mode creates or edits a resizable rectangle.
- Esc exits/clears according to state.
- Add to session opens the session target sheet once at least one note exists.

Telemetry:

- `desktop.overlay.opened`
- `desktop.overlay.pin_mode_selected`
- `desktop.overlay.region_mode_selected`
- `desktop.overlay.region_drag_started`
- `desktop.overlay.region_drag_finished`
- `desktop.overlay.closed`

## 6. Note Panel

The note panel appears to the right of the active annotation and connects with a thin dashed line.

Panel sections:

- `Annotation 1`
- short instruction copy
- Notes textarea
- Tags
- Save note button

Required text entry behavior:

- The text area must accept keyboard input immediately after focus.
- Global shortcut handlers must not swallow keys while the text area is focused.
- Use a real editable `NSTextView` backed by `NSTextStorage`, `NSLayoutManager`, and `NSTextContainer`.
- The note panel window/view must be able to become key.

Tags:

- Bug
- UX
- Blocking
- Question

Telemetry:

- `desktop.note_panel.opened`
- `desktop.note.text_changed`
- `desktop.note.saved`
- `desktop.note.validation_failed`

## 7. Session Target

After `Add to session`, ask:

> Where should this go?
> Choose an existing session or create a new one.

Options:

- Existing session list with thumbnails, title, note count, and updated time.
- `+ New session`.

New session fields:

- Session title.
- Session note.
- Local folder or GitHub repo context.
- Default sharing path: Direct to AI, Team review, or Public feed.

Do not show fake smoke sessions in production.

Telemetry:

- `desktop.session_target.opened`
- `desktop.session.existing_selected`
- `desktop.session.new_started`
- `desktop.session.created`

## 8. Save Confirmation

After save:

> Added to session
> `[Session name]` added 1 annotation.
> Nothing was sent yet. Open the session board when you are ready, or add another annotation.

Actions:

- `Close`
- `+ Add more`
- `Open session board`

Telemetry:

- `desktop.annotation.saved_to_session`
- `desktop.annotation.confirmation_shown`
- `desktop.annotation.open_session_board_clicked`

## 9. Sync Path

Once a session is saved, the native app can sync metadata to the web/API depending on the selected path.

Paths:

- Direct: private session, ready for local Claude/Codex/Cursor handoff.
- Team: visible in organization review feed.
- Public: visible in public feed only after redaction/approval controls.

Telemetry:

- `desktop.session.sync_started`
- `desktop.session.sync_finished`
- `desktop.session.sync_failed`

