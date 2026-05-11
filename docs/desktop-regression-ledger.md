# Desktop Regression Ledger

This file is the required pre-change checklist for Debugr desktop capture, annotation, permission, overlay, session-save, and provider-handoff work.

Before editing any of these files, read this ledger and update it when a new regression is found:

- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src/overlay.ts`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/__tests__/permission-flow.test.ts`
- `apps/desktop/e2e/playwright/specs/*`
- `apps/desktop-native-mac/**`

## Non-Negotiable Flow Invariants

- New annotation must never open the session board unless the user explicitly chooses to open the board.
- New annotation must not show Debugr overlay UI on top of the macOS Screen Recording permission modal.
- Screen Recording permission must be checked before showing annotation tools.
- If Screen Recording permission is missing, request permission first, then stop. Tell the user to restart/retry annotation after permission is granted.
- After permission is granted in the running app, preserve the runtime request result. Do not rely only on `CGPreflightScreenCaptureAccess` immediately after the prompt, because it can still report false until restart.
- Once permission is effectively granted, New Annotation must hide Debugr UI, show the annotation overlay, and expose the Region tool without routing through session setup.
- Passive permission checks must never run a screenshot/capture probe. They may use the macOS permissions plugin / preflight checks only.
- Capture/source listing failures must not automatically mean permission denied. If permission is granted but source listing fails, show source-list recovery, not permission copy.
- Saving annotations must send screenshot reference, annotation geometry/text, and target session id back to the session board.
- Appending a new capture to an existing session must bypass the picker when launched from that session.

## Known Regression Cases

| ID | Regression | Guardrail |
| --- | --- | --- |
| DSK-001 | New Annotation opened the session board instead of annotation tools. | Permission-blocked paths must not call `show_session_window`; successful paths must emit `overlay-will-show`. |
| DSK-002 | Debugr overlay appeared above the macOS Screen Recording modal, blocking the user from granting permission. | Missing-permission path must return before `overlay-will-show` or `show_overlay_window`. |
| DSK-003 | After permission was granted, New Annotation still did not show Region tools. | Preserve `CGRequestScreenCaptureAccess()` runtime result as `SCREEN_RECORDING_GRANTED_THIS_RUN`; effective grant is `requested || preflight`. |
| DSK-004 | Passive diagnostics triggered macOS permission prompts or capture side effects. | Passive checks must not call screenshot/capture routines. |
| DSK-005 | Opening New Capture from an existing session forced the picker/session setup again. | `skipPicker` launches must call `startPreparedSession` and enter annotation for the target session. |
| DSK-006 | A saved annotation lacked a screenshot payload or preview. | Save path must persist or pass screenshot data before emitting `annotations-saved`. |
| DSK-007 | Main Debugr window was captured instead of the user’s current app/screen. | Hide main before capture, then show overlay; never capture while main is visible. |
| DSK-008 | Overlay state reset while capture was in progress. | Respect `OVERLAY_HIDDEN_FOR_SCREENSHOT` / `captureInProgress` guards before handling new overlay triggers. |
| DSK-009 | Toolbar New Annotation appeared to do nothing when permission was blocked and the main window was hidden/missing. | Permission-blocked tray paths must recreate/open the main window and show a clear permission card with the exact running binary path. |
| DSK-010 | Non-technical users had to run `tccutil` manually to recover stale Screen Recording permission state. | New Annotation must auto-reset Debugr's stale ScreenCapture TCC entry once, request permission again, and continue if granted; the permission card must also offer one-click repair/retry. |

## Required Checks

Run these after desktop capture, overlay, permission, or session-save changes:

```bash
pnpm --filter @feedbackagent/desktop test
cd apps/desktop/src-tauri && cargo fmt --check && cargo check
```

For macOS permission or real capture changes, also manually verify:

- Fresh install / permission missing: New Annotation opens macOS permission flow without showing overlay tools over the modal.
- Permission missing after a toolbar click: Debugr shows a visible permission-blocked state instead of silently doing nothing.
- Stale/denied TCC entry: New Annotation should auto-reset its own ScreenCapture entry, ask macOS again, and continue if granted. The permission card should also offer `Repair Screen Recording & retry`.
- Same running app after granting permission: New Annotation opens the overlay Region tool.
- Restarted app with permission already granted: New Annotation opens overlay Region tool without permission copy.
- Existing session -> New Capture: annotation is appended to that session and the picker is skipped.
- Save annotation: session board shows the capture, note, count, and screenshot preview.

## Test Ownership

- Add or update `apps/desktop/src/__tests__/permission-flow.test.ts` for every permission/order regression.
- Add or update Playwright specs when the regression requires user-level UI flow coverage.
- If a regression cannot be automated, document the manual verification steps in this ledger before finishing the change.
