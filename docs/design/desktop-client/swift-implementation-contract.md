# Swift/AppKit Implementation Contract

This contract maps the desktop design to native implementation responsibilities.

## App Structure

Recommended native modules:

```text
apps/desktop-native-mac/
  Sources/DebugrNativeMac/
    App/
      AppDelegate.swift
      StatusItemController.swift
      HotKeyController.swift
    Permissions/
      ScreenRecordingPermissionService.swift
      PermissionDiagnostics.swift
    Capture/
      CaptureCoordinator.swift
      CaptureSourceProvider.swift
      CaptureService.swift
      CaptureValidator.swift
    Overlay/
      AnnotationOverlayWindowController.swift
      AnnotationOverlayView.swift
      RegionSelectionView.swift
      PinMarkerView.swift
      BottomToolbarView.swift
      ShortcutPillView.swift
      AnnotationNotePanelController.swift
    Sessions/
      SessionStore.swift
      SessionTargetController.swift
      AddedConfirmationController.swift
    Sync/
      WebSyncClient.swift
      KeychainDeviceTokenStore.swift
```

## Window Rules

### Menu Bar App

- `LSUIElement` should be true for the production menu bar app.
- The app should not show in Dock during normal operation.
- If a debug window exists, it must be explicitly debug-only.

### Overlay Window

Use an AppKit `NSWindow`:

- `styleMask: [.borderless]`
- `isOpaque = false`
- `backgroundColor = .clear`
- `level = .screenSaver` or appropriate high floating level.
- `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`
- `ignoresMouseEvents = false`
- Full selected display frame.

The overlay should render the frozen screenshot itself. It should not depend on the live desktop remaining visible underneath.

### Note Panel

The note panel must support text entry:

- It can be a child window or custom subview.
- It must be able to become key/main when editing.
- It must place an editable `NSTextView` in the responder chain.
- Global hotkeys must be suspended or ignored while text editing is active.

## Permission Flow

Use native permission APIs directly:

- `CGPreflightScreenCaptureAccess()`
- `CGRequestScreenCaptureAccess()`

Do not infer permission solely from an empty source list.

If permission is granted but source listing fails:

- Treat it as `sourceListUnavailable`, not `permissionDenied`.
- Tell the user to refresh or restart Dbugr.
- Log bundle ID, executable path, signing identity, and source count.

## Capture Source Rules

Use ScreenCaptureKit where possible:

- `SCShareableContent.current`
- `SCDisplay`
- `SCWindow`

Source filtering:

- Hide Dbugr bundle IDs.
- Hide windows with empty titles unless app is a browser and no better title exists.
- Hide known helper services.
- Group browsers separately.
- Sort frontmost or recently active sources first when possible.

## Geometry Contract

Store annotation geometry in screenshot pixel coordinates.

Each annotation should contain:

```json
{
  "id": "annotation-id",
  "kind": "region | pin",
  "imagePixelRect": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "imagePixelPoint": { "x": 0, "y": 0 },
  "screenPointRect": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "note": "User note",
  "tags": ["Bug", "UX"],
  "createdAt": "ISO-8601"
}
```

The overlay may draw in screen points, but persistence must survive different display scaling.

## Local Persistence

Native sessions should persist under:

```text
~/Library/Application Support/debugr/native-workspace/
```

Screenshot assets should be durable files, not temporary image objects.

Each session should include:

- Session ID.
- Title.
- Session note.
- Local folder or GitHub repo.
- Visibility path: Direct, Team, Public.
- Captures.
- Annotation metadata.
- Sync status.

## Secure Identity

After web-to-Mac linking:

- Store the device token in Keychain.
- Never store provider API keys in the web server by default.
- Attach the device token to sync calls.
- Relink should replace the local token safely.

## Logging Contract

Use structured logs with stable event names.

Required fields:

- `event`
- `timestamp`
- `bundleID`
- `executablePath`
- `sessionID` when available
- `captureID` when available
- `sourceID` when available
- `result`
- `errorCode`
- `durationMs`

Core events:

- `desktop.annotation.start_requested`
- `desktop.permission.preflight`
- `desktop.source_picker.opened`
- `desktop.source_picker.refreshed`
- `desktop.capture.started`
- `desktop.capture.validation_failed`
- `desktop.overlay.opened`
- `desktop.note.saved`
- `desktop.session.created`
- `desktop.annotation.saved_to_session`
- `desktop.session.sync_failed`

## Test Contract

Unit tests:

- Permission state mapping.
- Source filtering and grouping.
- Geometry conversion between screen points and image pixels.
- Session persistence and asset paths.
- Web sync payload shape.

Manual/functional tests:

1. Start Dbugr from Applications.
2. Confirm menu bar item appears.
3. Start New Annotation.
4. Confirm no Dbugr debug window appears.
5. Confirm Screen Recording permission is not requested if already granted.
6. Pick Current screen.
7. Confirm the frozen screenshot matches the visible screen.
8. Draw region.
9. Type note text.
10. Save note.
11. Add to existing session.
12. Create new session.
13. Confirm saved screenshot thumbnail is real.
14. Confirm Direct/Team/Public sync path is attached.
15. Confirm relaunch preserves sessions and account link.

Regression tests against stable release:

- Toolbar remains visible after session selection.
- Region selector remains draggable/resizable.
- Pin selector creates a numbered marker.
- Note field accepts typed input.
- Session target sheet does not steal the background image.
- macOS permission dialog is not blocked by an overlay.

