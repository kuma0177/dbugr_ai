# Debugr V2 E2E Journey Prompts

This repo now includes a desktop-oriented V2 journey for Debugr with:

- local Google-auth style onboarding flow
- MCP connection launchers for Claude, Codex, and Cursor
- background annotation capture
- session framing fields
- direct, team-review, and public-feed submission paths
- curated AI submission and response handling

These prompts are meant to help validate the whole journey end to end in the current local build.

## Assumptions

- The Tauri desktop app runs on macOS.
- OAuth is represented locally in-app for now.
- MCP connection commands are real Terminal launchers.
- AI responses may come from the API when configured, or from the built-in mock fallback.
- Session metadata persists locally in app state and is also sent through the API handoff path.

## 1. Launch + Sign In

Prompt:

```text
Open Debugr and verify the onboarding screen appears. Click Continue with Google and confirm the app marks the user as authenticated. Then connect at least one AI provider and finish setup.
```

Expected:

- onboarding card is visible
- Google sign-in button transitions to connected
- MCP provider list becomes actionable
- Finish setup becomes enabled after at least one provider is connected

## 2. MCP Connections

Prompt:

```text
From the home screen, connect Claude, Codex, and Cursor one by one. Use the MCP option for one provider and the background script option for another. Confirm Debugr opens Terminal with the correct helper command.
```

Expected:

- provider cards move from Not connected to Connected
- method badge reflects `MCP` or `SCRIPT`
- no provider selection is limited to Claude and Codex only

## 3. Background Capture

Prompt:

```text
Start background mode, trigger the global shortcut, create at least one annotation, and save it into a new session.
```

Expected:

- overlay opens from the shortcut
- save returns to the confirmation state
- a new session appears in the desktop workspace

## 4. Session Framing

Prompt:

```text
Open the session workspace and fill in the title, about field, session note, project folder, and GitHub repo. Confirm the helper copy makes it clear why each field matters.
```

Expected:

- title is editable
- about field shows a 200-character counter
- session note is separate from the about field
- folder/repo helper copy explains how AI uses repo context

## 5. Submission Flow Choice

Prompt:

```text
Switch between Direct to AI, Submit for team review, and Share on public feed. Verify the selected path changes the next stage of the journey.
```

Expected:

- direct flow moves toward submit
- team flow moves toward collaboration and curation
- public flow moves toward community review and curation

## 6. Collaboration

Prompt:

```text
Choose the team-review flow, collect collaboration context, and confirm that additional notes appear for curation.
```

Expected:

- collaboration panel seeds review items
- review context references the active session and annotations
- curated count updates after review choices change

## 7. Review & Curate

Prompt:

```text
Open the review stage and reject one contribution while keeping the others. Confirm the curated payload count changes.
```

Expected:

- each contribution has an include/exclude control
- curated count reflects accepted items only

## 8. Submit to AI

Prompt:

```text
Go to Submit, choose Claude, Codex, and Cursor in turn, and verify the active target changes. Then submit the session.
```

Expected:

- target cards support all three providers
- submit requires the selected provider to be connected
- payload includes session context, captures, review items, and context toggles

## 9. AI Insights

Prompt:

```text
After submission, confirm the Insights panel shows a summary, likely root cause, suggested fix, and next steps.
```

Expected:

- session moves to submitted, then responded
- insights panel renders the response
- fallback mock response still shows useful implementation guidance when the API is unavailable

## Edge Cases

Prompt:

```text
Verify the app still behaves well when there are no sessions, no captures, or no connected providers.
```

Expected:

- clear empty states
- no dead-end screens
- user can still return home or create a new capture
