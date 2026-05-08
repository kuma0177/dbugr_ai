# Desktop Layouts

This file defines the main desktop layouts the Swift app should implement.

## 1. Menu Bar Popover

Purpose:

- Quick launcher.
- Status surface.
- Never a required stop before annotation.

Layout:

- Header: Dbugr.ai logo, status dot, connection state.
- Primary action: `New Annotation`.
- Secondary rows: `Sessions`, `Settings`, `Open Web Dashboard`.
- Footer: version/build and `Quit Dbugr`.

Rules:

- The popover should be compact.
- It should not steal focus during capture.
- It should close before capture starts.

## 2. Source Picker

Purpose:

- Choose current screen, browser window/page, or another app window.

Layout:

- Floating rounded panel.
- Title: `Choose screen or window`.
- Subtitle: capture model copy.
- Three equal-width tabs: `Current screen`, `Browser tabs/pages`, `Other apps`.
- Refresh button.
- Scrollable list.
- Back button.

Suggested dimensions:

- Width: 520-620px.
- Max height: 75vh.
- Corner radius: 28px.
- Padding: 24px.

Mobile does not apply to native desktop, but the panel should work on 13-inch MacBook screens.

## 3. Annotation Overlay

Purpose:

- Freeze the screen and annotate what the user was looking at.

Window:

- Borderless.
- Transparent.
- Full-screen bounds of the selected display.
- Above normal app windows.
- Joins all Spaces when needed.
- Does not show in Dock.

Layout:

- Frozen image fills the selected display while preserving pixel mapping.
- Top-left shortcut/status pill at `14px` from top and left.
- Bottom toolbar horizontally centered above the Dock safe area.
- Right note panel near the active annotation, clamped to screen bounds.
- Region rectangle over the exact selected screen area.

Safe areas:

- Keep toolbar at least `24px` above Dock or visible screen bottom.
- Keep note panel at least `24px` from screen edges.
- Keep status pill below menu bar if menu bar is visible.

## 4. Bottom Annotation Toolbar

Purpose:

- Primary control surface during annotation.

Layout:

```text
| Pin | Region | Esc | Add to session |
```

Dimensions:

- Height: 72px.
- Min width: 460px.
- Corner radius: 20px.
- Background: `desktop.toolbarNavy`.
- Text: white or muted blue-gray.
- Active tool: dashed white outline around the icon/label group.
- Primary button: blue pill, `Add to session`.

Behavior:

- It stays visible throughout annotation.
- It should not disappear after session selection.
- It must not block text input in the note panel.

## 5. Annotation Note Panel

Purpose:

- Capture the why behind a pin or region.

Layout:

- Right-side floating white panel.
- Header with title and close button.
- Instruction copy.
- Divider.
- Label: `NOTES`.
- Text area.
- Tags row.
- Save button.

Dimensions:

- Width: 360-420px.
- Min height: 330px.
- Corner radius: 24px.

## 6. Session Target Sheet

Purpose:

- Decide where the captured annotation belongs.

Layout:

- Center or right floating sheet.
- Title: `Where should this go?`
- Subtitle: `Choose an existing session or start a new one.`
- Existing session rows.
- `Close` and `+ New session` footer buttons.

Session row:

- Thumbnail.
- Title.
- Note count.
- Last updated time.
- Right arrow.

Empty state:

> No sessions yet. Create your first session to save this annotation.

## 7. New Session Sheet

Purpose:

- Create project context before saving.

Fields:

- Session title.
- Session note.
- Local folder.
- GitHub repo.
- Sharing path: Direct to AI, Team review, Public feed.

Rules:

- If more than one annotation exists, require session note before send-to-AI.
- Explain visibility clearly.
- Do not ask for provider credentials here.

## 8. Desktop Session Screen

Purpose:

- Local native session management, not full web feed replacement.

Layout:

- Left session list.
- Right selected-session detail.
- Capture thumbnail strip.
- Annotation notes.
- Buttons: `Add annotation`, `Open web board`, `Prepare handoff`.

Rules:

- Session boards, team comments, public feed, admin, and curation belong on web.
- Native session screen should stay focused on local captures and quick handoff.

## 9. Permission Recovery Screen

Purpose:

- Explain what to do when macOS blocks capture.

Layout:

- Small centered card or source picker inline warning.
- Human-readable status.
- `Open Screen Recording settings`.
- `Refresh`.
- `Quit and reopen Dbugr` hint.

Do not present a large blocking Dbugr overlay on top of macOS permission dialogs.

