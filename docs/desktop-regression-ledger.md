# Desktop And Review Regression Ledger

This file is the required pre-change checklist for Dbugr desktop capture, annotation, permission, overlay, session-save, provider-handoff, desktop-sync API, team/public review feed, seed/smoke data, and review-curation work.

Before editing any of these files, read this ledger and update it when a new regression is found:

- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src/overlay.ts`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/core.ts`
- `apps/api/src/routes/phase2.ts`
- `apps/api/src/routes/feedbackSessions.ts`
- `apps/api/src/lib/seed.ts`
- `apps/api/src/lib/phase2-api-smoke.ts`
- `apps/web/src/app/feed/page.tsx`
- `apps/web/src/lib/api.ts`
- `apps/desktop/src/__tests__/permission-flow.test.ts`
- `apps/desktop/src/__tests__/phase2-web-handoff.test.ts`
- `apps/desktop/src/__tests__/session-picker.test.ts`
- `apps/desktop/e2e/playwright/specs/*`
- `apps/desktop-native-mac/**`

## Non-Negotiable Flow Invariants

- New annotation must never open the session board unless the user explicitly chooses to open the board.
- New annotation must not show Dbugr overlay UI on top of the macOS Screen Recording permission modal.
- Screen Recording permission must be checked before showing annotation tools.
- If Screen Recording permission is missing, request permission first, then stop. Tell the user to restart/retry annotation after permission is granted.
- After permission is granted in the running app, preserve the runtime request result. Do not rely only on `CGPreflightScreenCaptureAccess` immediately after the prompt, because it can still report false until restart.
- Once permission is effectively granted, New Annotation must hide Dbugr UI, show the annotation overlay, and expose the Region tool without routing through session setup.
- Passive permission checks must never run a screenshot/capture probe. They may use the macOS permissions plugin / preflight checks only.
- Capture/source listing failures must not automatically mean permission denied. If permission is granted but source listing fails, show source-list recovery, not permission copy.
- Saving annotations must send screenshot reference, annotation geometry/text, and target session id back to the session board.
- Appending a new capture to an existing session must bypass the picker when launched from that session.
- Deleting a session must remove it locally, persist a tombstone, and delete the remote API record when one exists so API refreshes cannot resurrect it.
- The New Annotation session picker must reflect the same active, deleted-session-filtered workspace sessions as the session sidebar, including sessions that do not have captures yet.
- Team/Public review sync must preserve the original desktop annotation, screenshot path, and stable web session id.
- Cleanup/test operations must never delete a real synced user session unless the user explicitly asks to delete that session.
- Smoke/demo sessions must never dominate or pollute the normal user-facing team/public review feed.
- Review feed cards must not duplicate identical capture note and annotation text.
- Review feed actions must be clear and actionable; do not expose ambiguous controls such as `Duplicate` unless the duplicate workflow is implemented and tested end-to-end.
- Desktop owner annotations must not be fabricated as review comments; review comments are only notes explicitly posted from the review UI.
- A user may have only one top-level review note per session; posting again edits that note and clears stale curation decisions so it returns to review.
- When a real account has multiple local memberships, the API must prefer that user's real/owned workspace over the seeded `org_demo` workspace for web review context.
- When an older desktop link points at `org_demo`, the API must still route that real user to their real/owned workspace before syncing team/public sessions.
- Desktop link redemption must import the linked web organization as desktop Company and the user's web profile/job role as desktop Role without confusing either with organization membership roles.
- Cursor handoff must visibly confirm that Cursor.app opened and the prompt was copied, and must surface copy/open failures instead of silently staying on Submit.
- Team/Public flow selection must update locally even when the web API is unavailable; API reachability should only block the later collaboration sync/open step.
- Downloaded desktop builds must use the hosted API URL from web onboarding or build config, not stale localhost discovery; localhost port probing and pid diagnostics are local-dev only.
- Web review frame images must authorize with the same local viewer identity as the feed JSON request; image tags cannot send custom auth headers.
- Public visibility controls shown in the review feed must have a working API path for session owners/org admins, including older org rows created before public sharing was enabled by default.
- Publicly published sessions must have a discoverable web URL that can be read without login, while public comments require sign-in/sign-up and never fall back to `Demo User`.
- Public feed and public frame-image reads must not depend on seeded demo records; production databases may start without `user_demo`.
- Public feed responses must not expose private viewer/creator emails to unauthenticated readers.
- Public pages must not show duplicate anonymous sign-in/sign-up entry points that compete with the global header CTAs.
- Email-code sign-in must never dead-end when outbound email delivery is misconfigured; it should either send email or expose the explicit preview-code fallback unless strict delivery is enabled.
- Review and public feed layouts must keep navigation, hero, and cards readable at desktop, split-screen, tablet, and mobile widths with aligned content columns.
- Small-screen review feed must not bury the feed below duplicate/global and sidebar navigation; the primary content and scope controls must be reachable before secondary workspace links.
- Mobile global navigation must reset tablet/narrow-desktop flex sizing so top-nav pills stay compact and do not create large vertical whitespace.
- Web dev startup must not reuse a partial `.next` route cache that can leave review-feed routes without server `page.js` files.
- Signed-in web review/admin surfaces must always expose account exit and profile access; users must be able to view membership details and initiate account deletion without returning to onboarding.
- Downloaded desktop builds must ship as an installable DMG with an Applications folder target; app-only artifacts are for explicit local diagnostics only, scripted installs must copy the mounted `Dbugr.app` into `/Applications`, re-sign it with the stable Screen Recording bundle identifier, run the startup Screen Recording registration argument, and the Finder-visible installed app name must be `Dbugr.app`.
- LSUIElement menu-bar builds must activate the app before showing the annotation overlay window, including immediately after the macOS Screen Recording prompt returns, while still avoiding main-window focus steals.

## Known Regression Cases

| ID | Regression | Guardrail |
| --- | --- | --- |
| DSK-001 | New Annotation opened the session board instead of annotation tools. | Permission-blocked paths must not call `show_session_window`; successful paths must emit `overlay-will-show`. |
| DSK-002 | Dbugr overlay appeared above the macOS Screen Recording modal, blocking the user from granting permission. | Missing-permission path must return before `overlay-will-show` or `show_overlay_window`. |
| DSK-003 | After permission was granted, New Annotation still did not show Region tools. | Preserve `CGRequestScreenCaptureAccess()` runtime result as `SCREEN_RECORDING_GRANTED_THIS_RUN`; effective grant is `requested || preflight`. |
| DSK-004 | Passive diagnostics triggered macOS permission prompts or capture side effects. | Passive checks must not call screenshot/capture routines. |
| DSK-005 | Opening New Capture from an existing session forced the picker/session setup again. | `skipPicker` launches must call `startPreparedSession` and enter annotation for the target session. |
| DSK-006 | A saved annotation lacked a screenshot payload or preview. | Save path must persist or pass screenshot data before emitting `annotations-saved`. |
| DSK-007 | Main Dbugr window was captured instead of the user’s current app/screen. | Hide main before capture, then show overlay; never capture while main is visible. |
| DSK-008 | Overlay state reset while capture was in progress. | Respect `OVERLAY_HIDDEN_FOR_SCREENSHOT` / `captureInProgress` guards before handling new overlay triggers. |
| DSK-009 | Toolbar New Annotation appeared to do nothing when permission was blocked and the main window was hidden/missing. | Permission-blocked tray paths must recreate/open the main window and show a clear permission card with the exact running binary path. |
| DSK-010 | Non-technical users had to run `tccutil` manually to recover stale Screen Recording permission state. | New Annotation must auto-reset Dbugr's stale ScreenCapture TCC entry once, request permission again, and continue if granted; the permission card must also offer one-click repair/retry. |
| DSK-011 | Deleted sessions came back after reopening or refreshing because the desktop only hid them locally while `/feedback-sessions` still returned the remote record. | Session delete must persist `deletedSessionIds` and call `DELETE /feedback-sessions/:id`; the API delete route must remove child rows before deleting the session. |
| DSK-012 | New Annotation picker/modal did not match the session sidebar because it only used local sessions with existing captures. | Picker cache and `request-sessions` events must use the same active workspace sessions as the sidebar and refresh stale API data before emitting. |
| DSK-013 | Team/Public flow selection only changed local desktop state or created a web snapshot, so accepted review feedback never reached the local AI handoff. | The visible Start collaboration action must await web sync and open the matching feed, and web submission must open a desktop handoff link that fetches the frozen prompt before launching Claude/Codex/Cursor. |
| DSK-014 | Team/Public review sync failed whenever the local API was not on the default `3001` port. | The API must advertise its active base URL in the shared Dbugr app-data folder, and desktop sync must probe that plus common local ports before showing an unreachable-API error. |
| DSK-015 | Synced team/public sessions appeared twice in the desktop picker/sidebar because API refresh matched only local ids and not `webSessionId`. | Remote API rows whose id equals a local session's `webSessionId` must merge into that local session instead of creating a second zero-capture row. |
| DSK-016 | Desktop sync crashed the API because epoch millisecond capture timestamps overflowed `FeedbackFrame.timestampMs`. | Desktop must send session-relative capture offsets, and the API must normalize legacy epoch payloads before writing frames. |
| DSK-017 | Web review feed repeated the same note because frame descriptions concatenated duplicate capture note and annotation text. | API frame-description construction must de-dupe identical non-empty note strings before saving or returning review frames. |
| DSK-018 | The web review feed showed an unclear `Duplicate` curation button beside `Accept` and `Decline`. | Feed curation controls must only show implemented, user-clear actions; duplicate handling stays hidden until it has a real tested workflow. |
| DSK-019 | Smoke/demo sessions appeared instead of the user's real synced annotation in the review feed. | Seed/smoke data must be isolated from user-facing local review feeds, and restore/cleanup scripts must verify the real session remains queryable by its original web id. |
| DSK-020 | Manual cleanup of test data deleted the real synced web session row while the desktop still had the local annotation. | Test cleanup must target only records with explicit test identifiers and verify the local session's `webSessionId` still exists before finishing. |
| DSK-021 | Restoring a session with a demo desktop-link token created a fake `Demo User` review comment that the user never posted. | Desktop annotations must sync as frame/capture context only, not as visible review comments; restore operations must use the real user token or repair ownership afterward. |
| DSK-022 | The review feed allowed the same user to post multiple top-level notes on one session. | Contribution POST must upsert the user's existing top-level team/public note for that session and reset old curation decisions on edit. |
| DSK-023 | The web feed selected `Demo Organization` for a real user because the API picked the oldest active membership. | Header-authenticated web context must prefer the user's owned/non-demo workspace when multiple memberships exist. |
| DSK-024 | An old desktop link still pointed at `org_demo`, so future desktop syncs could recreate duplicate/missing review sessions even after the web feed used the real workspace. | Desktop-token context must prefer the real/owned workspace over `org_demo` for real multi-membership users while preserving the exact linked org for non-demo links. |
| DSK-025 | The web feed loaded the session through header auth, but frame `<img>` requests had no header, fell back to demo context, and returned `Capture not found`. | Frame image URLs must carry the local viewer email for the asset endpoint, and `/phase2/frames/:id/image` must accept that viewer query only for image authorization. |
| DSK-026 | The review feed showed a `Public` visibility button, but the API rejected it for an older real workspace whose `allowPublicSharing` flag was still false. | Onboarding must enable public sharing for this review workflow, and legacy policy blocks must not prevent session owners/org admins from publishing a visible public-review session. |
| DSK-027 | Public sessions had no real discovery URL, and unauthenticated contribution calls could fall back to `Demo User`. | `/public` must load public sessions without onboarding, expose a shareable session URL, scrub public emails, and the contribution API must require a signed-in web identity before posting. |
| DSK-028 | Review feed cards and hero widths did not align, the sidebar stayed fixed too long, and split-screen widths made fonts/cards feel cramped. | Review/public CSS must share one content max-width, collapse heavyweight sidebar navigation at medium widths, and avoid re-applying generic `.main` padding to review pages. |
| DSK-029 | Mobile and narrow desktop web rendered the global nav and then the full review sidebar, pushing the actual feed below admin/session/workspace links. | At small-screen widths, hide heavyweight review sidebars, keep the top nav from colliding, and expose compact in-content feed scope controls before the feed hero/cards. |
| DSK-030 | The narrow-desktop nav fix gave `.nav-links` a large flex basis that leaked into mobile column layout, creating giant gaps between signed-in and feed/admin pills. | Mobile nav rules must reset inherited flex basis to compact sizing after switching the nav to a column layout. |
| DSK-031 | Linking the Mac imported name/email/company but dropped the web onboarding profile role, leaving desktop Optional profile incomplete. | Persist web onboarding's human profile role separately from membership/platform roles, return it from desktop-link redeem, and hydrate desktop Role from that profile field only. |
| DSK-032 | Sending to Cursor appeared to do nothing because no CLI opens for Cursor and Dbugr did not switch to a visible confirmation/failure state. | Cursor sends must copy the prompt without swallowing failures, open Cursor.app, switch to Insights with clear paste instructions, and include native stderr when launch fails. |
| DSK-033 | Team/Public flow cards could not stay selected while the local web API was down because selection attempted sync immediately and rolled back to Direct. | Flow card clicks must commit the local selection without API calls; Start collaboration performs the required web sync and reports API errors without losing the selected flow. |
| DSK-034 | Production desktop links could fall back to `localhost:3001/api` and expose local-dev port/pid diagnostics to downloaded app users. | Web-created desktop links must advertise a public API URL from env or request origin, and desktop builds must ignore localhost candidates unless local API discovery is explicitly enabled. |
| DSK-035 | Opening `/feed` in local dev could throw `ENOENT ... .next/server/app/feed/page.js` after `.next` contained only a partial client manifest for that route. | Web dev startup must clear `.next` before launching so Next regenerates server and client route artifacts together. |
| DSK-036 | Signed-in users could reach Admin or Notes Feed without any visible way to sign out, inspect their profile, review their organization/team membership, or delete their account. | Global signed-in navigation, review sidebars, and the profile route must keep Profile, Sign out, team/member details, admin summary access, and account deletion wired together. |
| DSK-037 | Production public feed crashed with `No User found` because anonymous `/phase2/feed?scope=public` tried to load seeded demo context in a database without `user_demo`. | Public feed and public frame image endpoints must use anonymous public-safe reads when no viewer identity is present, and only load request context for signed-in/private/org access. |
| DSK-038 | Public discovery repeated anonymous sign-in/sign-up links in the sidebar while the global header already showed auth CTAs, and email-code sign-in could fail hard when Resend was configured but rejected delivery. | Anonymous public sidebar navigation should stay focused on feed links, and email-code requests should return the stored preview fallback on delivery failure unless `EMAIL_DELIVERY_STRICT=1`; the auth regression suite simulates delivery failure and verifies the fallback code. |
| DSK-039 | Downloaded desktop builds could be produced as a loose `.app` instead of an installable DMG, scripted install paths could leave the app mounted but not copied into `/Applications` or signed with the stable TCC identity, the installed app could be named `dbugr.ai.app` instead of Finder-searchable `Dbugr.app`, the app could fail to appear in macOS Screen Recording because no startup request was made for the new bundle, and the LSUIElement overlay could fail to surface the Region toolbar after the Screen Recording prompt released focus. | The normal desktop build must produce the configured DMG with an Applications shortcut and product name `Dbugr`, app-only builds must be explicit diagnostics, scripted installs must mount the DMG, `ditto` `Dbugr.app` into `/Applications`, re-sign it as `com.feedbackagent.desktop`, launch it with `--request-screen-recording-permission`, and `show_overlay_window` must activate before `show()` without focusing the main window. |

## Required Checks

Run these after desktop capture, overlay, permission, or session-save changes:

```bash
pnpm --filter @feedbackagent/desktop test
cd apps/desktop/src-tauri && cargo fmt --check && cargo check
```

Run these after desktop-sync API, team/public feed, seed/smoke, or review-curation changes:

```bash
pnpm --filter @feedbackagent/desktop test
pnpm --filter @feedbackagent/api build
pnpm --filter @feedbackagent/web build
```

For macOS permission or real capture changes, also manually verify:

- Fresh install / permission missing: New Annotation opens macOS permission flow without showing overlay tools over the modal.
- Permission missing after a toolbar click: Dbugr shows a visible permission-blocked state instead of silently doing nothing.
- Stale/denied TCC entry: New Annotation should auto-reset its own ScreenCapture entry, ask macOS again, and continue if granted. The permission card should also offer `Repair Screen Recording & retry`.
- Same running app after granting permission: New Annotation opens the overlay Region tool.
- Restarted app with permission already granted: New Annotation opens overlay Region tool without permission copy.
- Existing session -> New Capture: annotation is appended to that session and the picker is skipped.
- Save annotation: session board shows the capture, note, count, and screenshot preview.
- Delete session: row disappears immediately and stays gone after reopening the desktop or refreshing sessions from the API.
- New Annotation picker: session choices match the sidebar count/order after deleting, refreshing, or reopening.
- Team/Public review sync: start the API on a non-default local port and verify desktop discovers it before showing an unreachable-API error.
- Team/Public review sync: refresh sessions after sync and confirm the local annotated session and its web row render as one picker/sidebar entry.
- Team/Public review feed: the original synced session opens by its stable `webSessionId` and shows the real screenshot, frame note, and owner annotation.
- Team/Public review feed: identical capture note and annotation text appears once in the frame card, while the owner annotation appears once as a review note/comment.
- Team/Public review feed: smoke/demo records do not appear in the normal organization/public feed unless explicitly running a smoke/demo scenario.
- Team/Public review feed: only `Accept` and `Decline` curation actions are visible until duplicate handling has a tested product behavior.
- Team/Public review feed: desktop annotation text appears as capture context, not as a fake owner comment.
- Team/Public review feed: posting a second note from the same user edits the existing note and leaves only one top-level comment for that user/session.
- Team/Public review feed: a real signed-in user with a seeded demo membership still loads their real workspace sessions, not `Demo Organization`.
- Team/Public desktop sync: a real user's existing desktop link with `org_demo` still syncs into the real workspace rather than creating a duplicate demo-org session.
- Team/Public review feed: frame image `<img>` requests return the actual saved screenshot for the same signed-in viewer that loaded the feed.
- Team/Public review feed: clicking `Public` on a session owned by the signed-in user moves it to public review rather than failing because of a stale org policy flag.
- Public discovery: `/public` shows public sessions without onboarding, `/public?sessionId=...` opens a specific public session, and unauthenticated visitors see sign-in/sign-up before commenting.
- Responsive review/public feed: desktop cards align with the hero, split-screen/tablet hides heavyweight sidebar navigation, and mobile keeps readable text and card widths.
- Small-screen review feed: after the global nav, the feed scope controls and review content appear before secondary workspace/admin/session navigation.
- Mobile global nav: signed-in, feed, and admin controls remain compact without inherited tablet flex spacing.
- Test cleanup: after any smoke/manual cleanup, query the DB or API and confirm the user's real synced session still exists.

## Test Ownership

- Add or update `apps/desktop/src/__tests__/permission-flow.test.ts` for every permission/order regression.
- Add or update `apps/desktop/src/__tests__/session-delete.test.ts` for session delete persistence regressions.
- Add or update `apps/desktop/src/__tests__/session-picker.test.ts` for sidebar/picker session parity regressions.
- Add or update `apps/desktop/src/__tests__/phase2-web-handoff.test.ts` for desktop-sync API, feed rendering, web handoff, curation, timestamp, and duplicate/identity regressions.
- Add or update Playwright specs when the regression requires user-level UI flow coverage.
- If a regression cannot be automated, document the manual verification steps in this ledger before finishing the change.
