# Desktop Components

These components should be implemented as native AppKit views or lightweight SwiftUI views hosted in AppKit only where appropriate. The annotation overlay itself should be AppKit-owned.

## `FloatingShortcutPill`

Purpose:

- Shows the shortcut and annotation progress.

Content:

- Key chips: `⌃`, `⌘`, `Z`.
- Status text: `1 annotation - save each note, then tap Finish below.`

States:

- `idle`
- `annotating`
- `saving`
- `saved`
- `error`

## `SourceChooserPanel`

Purpose:

- Lists capture sources without exposing raw OS noise.

Children:

- `SourceSegmentedControl`
- `SourceList`
- `PermissionRecoveryCard`
- `RefreshButton`
- `BackButton`

Rules:

- Hide Dbugr windows.
- Group browser windows.
- Filter helper windows.
- Keep row labels human-readable.

## `SourceSegmentedControl`

Segments:

- `Current screen`
- `Browser tabs/pages`
- `Other apps`

Active state:

- Blue border.
- Soft blue fill.
- Blue text.

## `BottomAnnotationToolbar`

Children:

- `ToolButton.Pin`
- `ToolButton.Region`
- `ToolButton.Esc`
- `PrimaryActionButton.AddToSession`

Rules:

- Always visible during annotation.
- Floats above Dock.
- Uses dark navy background.
- Primary action uses `#0090FF`.

## `ToolButton`

States:

- Default.
- Hover.
- Active.
- Disabled.

Active:

- Dashed white outline.
- Slightly brighter icon.

## `RegionSelectionBox`

Purpose:

- Visually anchors the selected area.

Visual:

- 2px blue stroke.
- 8 circular resize handles.
- Slight translucent blue fill, max 12% opacity.
- Small close `x` button near top-right handle.
- Optional numbered marker inside or near the region.

Behavior:

- Drag from inside moves.
- Drag handles resize.
- Escape cancels active region.
- Geometry is stored in screenshot pixel coordinates, not only screen points.

## `PinMarker`

Purpose:

- Numbered annotation point.

Visual:

- Blue circular marker.
- White border.
- White number.
- Subtle shadow.

Behavior:

- Click selects related note.
- Drag moves the pin.

## `AnnotationNotePanel`

Purpose:

- The main note entry surface.

Fields:

- Annotation title.
- Instruction text.
- Editable notes field.
- Tags.
- Save button.

Text field requirements:

- Must use an editable `NSTextView`.
- Must initialize `NSTextStorage`, `NSLayoutManager`, and `NSTextContainer` explicitly if using a custom text view.
- Must become first responder when opened.
- Must not share keyboard events with global shortcuts while focused.

## `SessionTargetSheet`

Purpose:

- Choose existing or new session.

Rows:

- Thumbnail.
- Session title.
- Annotation count.
- Updated time.
- Disclosure arrow.

Footer:

- `Close`
- `+ New session`

## `AddedConfirmationSheet`

Purpose:

- Close the save loop with confidence.

Copy:

> Added to session
> `[Session name]` added 1 annotation.
> Nothing was sent yet. Open the session board when you are ready, or add another annotation.

Actions:

- `Close`
- `+ Add more`
- `Open session board`

## `PermissionRecoveryCard`

Purpose:

- Help users recover from Screen Recording issues.

Copy should be state-aware:

- If permission denied: ask the user to enable it.
- If permission granted but no list: ask them to refresh or restart Dbugr.
- If wrong binary has permission: show the exact running bundle path.

Actions:

- `Refresh list`
- `Open Screen Recording settings`
- `Ask macOS for screen capture`

Only show `Ask macOS for screen capture` when preflight fails.

## `SessionListRow`

Purpose:

- Local session picker row.

Content:

- Thumbnail.
- Title.
- Session note preview.
- Annotation count.
- Updated time.
- Disclosure arrow.

Empty image state:

- Do not show a broken image icon.
- Show a soft placeholder with text: `No screenshot yet`.

