# Desktop Copy And States

Use this copy as the product baseline for the native desktop client.

## Source Picker

Title:

> Choose screen or window

Subtitle:

> Capture the current screen, a browser page, or another app window. Dbugr freezes it once, then you annotate on top.

Tabs:

- Current screen
- Browser tabs/pages
- Other apps

Refresh:

> Refresh list

Back:

> Back

Empty state:

> No windows found yet.
> Refresh once. If the list is still empty, quit and reopen Dbugr so macOS refreshes Screen Recording access.

## Permission States

Denied:

> Screen Recording access is needed.
> Dbugr needs this once so it can list screens and windows. Enable Dbugr in System Settings, then quit and reopen Dbugr.

Granted but empty source list:

> macOS did not return any windows yet.
> Tap Refresh list first. If the list still stays empty, quit and reopen Dbugr once so macOS refreshes the Screen Recording grant.

Wrong binary:

> Screen Recording may be enabled for a different Dbugr build.
> The running app is `[bundle path]`. Make sure this exact app is enabled in System Settings.

## Annotation Overlay

Top-left status:

> 1 annotation - save each note, then tap Finish below.

Toolbar:

- Pin
- Region
- Esc
- Add to session

Note panel title:

> Annotation 1

Note panel helper:

> Drag handles to resize. Save note closes this panel - Finish opens Dbugr.

Notes placeholder:

> What should Claude, Codex, or Cursor know about this area?

Save:

> Save note

Tags:

- Bug
- UX
- Blocking
- Question

## Session Target

Title:

> Where should this go?

Subtitle:

> Choose an existing session or start a new one.

Helper:

> Click a session row to continue. Scroll for more.

Empty state:

> No sessions yet. Create your first session to save this annotation.

Buttons:

- Close
- + New session

## New Session

Title:

> Create a session

Session title placeholder:

> Checkout flow cleanup

Session note placeholder:

> Explain what changed, what is broken, or what the AI should preserve.

Project context:

> Add a local folder or GitHub repo so the AI handoff has code context.

Visibility:

> Choose where this session starts. You can change visibility later before review or AI handoff.

Options:

- Direct to AI
- Team review
- Public feed

## Save Confirmation

Title:

> Added to session

Body:

> `[Session name]` added 1 annotation.
> Nothing was sent yet. Open the session board when you are ready, or add another annotation.

Buttons:

- Close
- + Add more
- Open session board

## Error States

Blank capture:

> Dbugr captured an empty image.
> Try Refresh list, then capture again. If this keeps happening, restart Dbugr so macOS refreshes the capture permission.

Note missing:

> Add a short note before saving.

Session missing:

> Choose a session or create a new one before saving.

Sync failed:

> Saved locally. Web sync did not finish yet.
> Dbugr will retry when the connection is available.

