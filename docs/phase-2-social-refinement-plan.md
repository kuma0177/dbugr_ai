# Phase 2 Social Refinement Plan

This document is the detailed implementation checklist for the social-review portion of the initial Dbugr release.

Use it together with:

- [docs/phase-roadmap-and-architecture.md](/Users/kumar/debugr/docs/phase-roadmap-and-architecture.md:1) for overall phase scope and architecture
- [docs/design-system-dbugr.md](/Users/kumar/debugr/docs/design-system-dbugr.md:1) for product design language
- [docs/railway-deployment.md](/Users/kumar/debugr/docs/railway-deployment.md:1) for Railway web/API deployment guidance

## Purpose

Phase 2 turns Dbugr from a solo annotation-to-AI handoff tool into a collaborative feedback system.

The desktop app should remain the fastest way to capture and annotate. The web app becomes the social review hub where people sign in, join organizations, comment on sessions, accept or reject suggestions, and prepare a clean AI-ready payload for Claude CLI, Codex CLI, or Cursor.

This plan is a draft for confirmation before implementation.

## Build Status

Current implementation status as of 2026-05-06:

- [x] Phase 2 schema spine exists for IAM, organization policy, social contributions, curation, AI preflight, provider credential metadata, submissions, and audit events.
- [x] Phase 2 API endpoints exist for onboarding, bootstrap, invite acceptance, desktop-link creation/redeem, scoped feed loading, contribution creation, curation decisions, visibility changes, AI preflight prompt generation, and frozen submission snapshots.
- [x] Phase 2 web pages exist for onboarding, invite-link acceptance, workspace setup, desktop-link handoff, scoped review feeds, curation, provider preflight, and submission snapshot creation using the Dbugr design language.
- [x] Phase 2 endpoint smoke script exists: `pnpm --filter @feedbackagent/api test:phase2`.
- [x] Phase 2 smoke now verifies onboarding -> invite accept -> bootstrap -> desktop link -> feed -> contribution -> curation -> preflight -> visibility -> submission.
- [x] Railway deployment plan exists for web/API services.
- [x] Desktop-to-web account-link API contract exists with one-time code hashing, expiry, redeem endpoint, and audit events.
- [x] Invite links are one-time token links with hashed storage and an accept endpoint.
- [x] Desktop session sync API contract exists for mapping Mac `Direct to AI`, `Team review`, and `Public feed` choices into web/API visibility and review state.
- [x] Phase 2 smoke now verifies desktop session sync mappings for `direct`, `team`, and `public` flows.
- [x] The product plan records the 10-minute batched comment digest requirement for team/public review notifications.
- [ ] Real Google OAuth is not wired yet; current web flow is a local Google-shaped preview and must be replaced with production OAuth before public launch.
- [x] Native desktop `dbugr://` redeem handler is wired to redeem the web link code and persist the returned desktop token through the macOS Keychain command bridge.
- [ ] Real invite email sending is not wired yet; onboarding currently displays shareable invite links.
- [x] Desktop app calls the desktop session sync endpoint when the user chooses `Direct`, `Team`, or `Public`, and again after later annotation saves for synced/social sessions.
- [x] Desktop app stores the redeemed desktop token in Keychain and attaches it to sync calls as a bearer token; the API stores only the token hash.
- [x] Web review board has a Stitch-inspired first pass with scoped feeds, screenshot previews, Direct/Team/Public routing, comments, curation, provider preflight, and frozen submission snapshots.
- [x] Batched comment digest worker/email sender is implemented as `pnpm phase2:comment-digest`; it groups comments after a 10-minute window, skips author self-notifications, and logs delivery decisions without raw tokens.
- [ ] Public redaction/moderation controls are policy-gated and audited, but not production-moderated yet.
- [ ] Railway Postgres migration is still pending before public multi-user launch.

## Build Rule

Treat the current desktop capture, annotation, session-save, and provider-handoff flow as the stable product core.

Phase 2 should primarily add value through:

- onboarding
- account linking
- team and organization management
- review feeds
- comments and curation
- AI-ready output preparation

Desktop changes in this phase should be minimal and targeted:

- authentication and account-link state
- session sync hooks
- visibility and submission-flow selection
- "open review board" and related deep links
- displaying curated-output and submission status

Avoid broad rewrites of the existing capture and annotation engine unless a bug, reliability problem, or clear product blocker requires it.

## Product Principles

1. One collaboration website should support private sessions, internal review, and public feed.
2. Internal review is organization-scoped and visible only to invited members.
3. Public feed is broadly visible, but publishing must include redaction warnings and poster approval controls.
4. The original poster owns the final payload. Comments do not enter Claude/Codex unless accepted.
5. Before final submission, the selected AI tool should generate a structured summary so key asks are not missed.
6. IAM should be a first-class layer: organizations, teams, roles, permissions, and invites.
7. Desktop should not become a social network. It captures, annotates, syncs, and deep-links into the web review board.
8. Enterprise readiness should be credible but lightweight: support org-scoped auth, roles, audit events, and controlled public sharing without overbuilding SSO/SCIM/KMS on day one.

## Minimal Enterprise Posture

Dbugr is a one-person-company product, so Phase 2 should avoid heavy enterprise platform work while still being credible for larger companies that care about privacy and control.

Minimum enterprise-friendly commitments:

- Users belong to organizations.
- Organizations have roles and invite-controlled membership.
- Sessions are private by default.
- Organization review is visible only to organization members with permission.
- Public sharing is disabled or approval-gated by organization policy.
- Provider credentials can be personal or organization-managed.
- Every sensitive action creates an audit event.
- Public sessions require an explicit redaction confirmation.
- Only accepted comments enter an AI payload.
- Final AI submissions store an immutable prompt snapshot.

Things to defer until there is real customer demand:

- SAML/OIDC SSO.
- SCIM provisioning.
- Customer-managed encryption keys.
- Full DLP scanning.
- Region-specific data residency.
- Dedicated single-tenant deployments.
- Legal hold and advanced retention workflows.

This gives F100 buyers a plausible internal pilot story without forcing the product into a long enterprise detour.

## Target Journey

### 1. Sign In And Create Workspace

Entry point:

- User opens the Dbugr website or receives a teammate invite link.
- User signs in on web with Google OAuth or email one-time code.
- If the user is new, web asks them to create an organization/workspace.
- If the user was invited, web accepts the invite after sign-in and joins them to the existing organization.
- Web prompts the user to download and install the macOS `.dmg` if the Mac app is not installed.
- Web shows `Link this Mac` after account/workspace membership is ready.
- Web creates a short-lived, one-time desktop link code.
- Browser opens `dbugr://link?code=...`.
- The native macOS app redeems the code with the API and stores a device token in macOS Keychain.
- Desktop shows the linked identity and workspace before enabling sync or team sharing.

Onboarding asks for:

- User name
- Organization or startup name
- Role, optional
- Team name, optional
- Invite teammates, optional
- Default session visibility: `Private`, `Organization`, or `Public`

Expected result:

- User exists.
- Organization exists.
- User is org owner.
- Invited teammates can join an existing org instead of creating a duplicate org.
- Desktop is linked to the signed-in account and selected workspace.
- Desktop can show `Signed in as`, email, workspace, role, and available teammates.
- User can capture locally and sync sessions to the web review hub.

Team-based flow:

- Workspace owner signs up on web.
- Owner creates an organization and invites teammates by email.
- Invited teammate signs in with Google or email.
- If the teammate already has a Dbugr account, accepting the invite attaches a new membership to that existing account.
- If the teammate is new, accepting the invite creates the account first, then attaches membership.
- Each teammate downloads and links their own Mac app through the same web deep-link flow.
- Each linked desktop uses the member's credentials and permissions when syncing sessions, viewing teammates, and sharing for review.

Native app account context:

- The Mac app should never ask users to create a separate local account.
- Identity is delegated to the web app, similar to Codex linking through ChatGPT.
- The Mac app should show `Linked as [name] <email>`, `Workspace: [org]`, `Role: [role]`, and `Device: [device name]`.
- The Mac app should support unlink/logout, relink, and workspace switching if the user belongs to multiple organizations.
- AI provider credentials remain local by default and are separate from Dbugr web identity.

Submission flow bridge:

- The Mac app remains the source of truth for the user's initial submission choice after annotation save.
- `Direct to AI` in the Mac app maps to web/API `visibility=private` and `submissionFlow=direct`.
- `Team review` in the Mac app maps to web/API `visibility=org` and `submissionFlow=internal_review`.
- `Public feed` in the Mac app maps to web/API `visibility=public` and `submissionFlow=public_feed`.
- Desktop session sync must send the selected flow, session title, session note, project folder or GitHub repo, screenshot assets, captures, annotations, and selected provider target.
- Direct sessions can remain mostly local and fast; web may store a private snapshot or audit trail later, but should not force the user into the social review hub.
- Team and public sessions should open the matching web review board/feed after sync so users continue the journey in the right context.
- Public flow must require redaction confirmation and poster approval controls before a session becomes broadly visible.
- Web curation must send only accepted comments and edits back into the final AI-ready prompt.
- Final provider execution should still default to the user's local Claude CLI, Codex CLI, or Cursor handoff unless the organization explicitly enables managed credentials later.

### 2. Capture And Annotate On Desktop

The desktop app remains focused on:

- Capture current screen, browser/page window, or app/window.
- Add pins and regions.
- Add annotation notes.
- Add one session-level note.
- Attach local folder or GitHub repo context.
- Save to a new or existing session.

After save, desktop shows:

- Session saved confirmation.
- Add more annotations.
- Open session board.
- Choose submission flow.

Expected result:

- Session is saved locally.
- Screenshot assets are persisted.
- Session can sync to the web account when authenticated.

### 3. Choose Submission Flow

The user chooses one flow:

| Flow | Visibility | Review behavior |
| --- | --- | --- |
| Direct to AI | Private by default | No social review required |
| Internal review | Organization scoped | Invited org/team members can comment |
| Public feed | Public | Anyone allowed by public rules can comment; poster approval required |

Important behavior:

- A session can move from private to organization or public.
- A public session should require an explicit confirmation step.
- The app should warn before public sharing if screenshots may contain secrets or private data.
- The owner can return a public/team session back to private only if policy allows and no public submission has been finalized.
- Organization admins can disable public sharing or require admin approval before a session appears publicly.

### 4. Web Collaboration Hub

The website should have one collaboration hub with scoped feeds.

Primary navigation:

- `My Sessions`
- `Team Review`
- `Public Feed`
- `Submissions`
- `Settings`

Feed scopes:

- `Private`: sessions owned by the current user.
- `Organization`: sessions visible to the user's organization or team.
- `Public`: sessions shared publicly.

Each feed card should show:

- Screenshot thumbnail
- Session title
- Owner
- Team/org, if relevant
- Visibility badge
- Annotation count
- Comment count
- Accepted suggestion count
- Submission status
- Last activity time

Card actions:

- Open review board
- Comment
- Curate, if owner or permitted role
- Submit to AI, if owner or permitted role

### 5. Comment And Suggest

Users can contribute at three levels:

- Session-level comment
- Capture-level comment
- Annotation-specific comment

Contribution types:

- Comment
- Suggested edit
- Clarifying question
- Risk note
- Reproduction note
- Suggested implementation requirement

Each contribution should include:

- Author
- Organization/team membership context
- Source scope: owner, teammate, public, system
- Target object: session, capture, annotation
- Body
- Optional suggested replacement text
- Timestamp
- Edited timestamp
- Visibility

Expected result:

- Sessions collect structured feedback without polluting the final AI payload automatically.

### 6. Review And Curate

The poster gets a curation board.

Layout:

- Left: screenshot/capture preview with annotations.
- Middle: annotation and comment thread.
- Right: curation tray.

Curation actions:

- Accept
- Reject
- Edit then accept
- Mark as duplicate
- Ask for clarification

Accepted items become part of the final AI context.

Rejected items remain visible in the social thread but are excluded from the AI payload.

Owner should see a summary:

- Total comments
- Accepted comments
- Rejected comments
- Unreviewed comments
- Conflicts detected
- Ready to submit status

### 7. AI Summary Preflight

Before final submission, Dbugr should generate a structured summary using the selected AI route.

Goal:

- Make sure all accepted comments are considered.
- Align feedback with the original poster's intent.
- Produce a clear, bulleted prompt so Claude/Codex/Cursor does not miss key asks.

Inputs:

- Session title
- Session-level note
- Screenshots
- Original annotations
- Accepted teammate comments
- Accepted public comments
- Accepted suggested edits
- Project folder
- GitHub repo
- Provider target

Preflight output:

- Main goal
- Key requested changes
- Accepted feedback grouped by theme
- Conflicts or ambiguity
- What not to change
- Screenshot and annotation references
- Final AI prompt preview

The owner can:

- Approve preflight summary
- Edit prompt before submission
- Regenerate summary
- Return to curation

Example final prompt shape:

```text
Goal:
- Make the onboarding UI feel closer to the approved Dbugr design system.

Must change:
- Use #0086fc for primary CTAs.
- Keep session-level note as the single framing field.
- Make Claude/Codex labels explicit as CLI handoffs.

Accepted feedback:
- Sarah: The status pill should not say "Responded"; use clearer user-facing status.
- Mike: The submit screen should show provider logos and a single-choice destination list.

Screenshots:
- Capture 1: /path/to/screenshot.png
- Annotation 1: Header pills do not match the design system.

Do not change:
- Do not replace the current Claude CLI handoff.
- Do not make the desktop app proactively open the session board after capture.
```

### 8. Submit To AI

Supported targets:

- Claude CLI
- Codex CLI
- Cursor

Submission should freeze:

- Accepted context
- Preflight summary
- Final edited prompt
- Screenshot asset references
- Provider target
- Submission timestamp
- Submitting user

After submit:

- Store submission record.
- Store provider response when available.
- Show response summary and next actions.
- Link response back to the original session.

Credential behavior:

- In personal mode, the desktop app can keep using local provider credentials for Claude CLI and Codex CLI.
- In organization mode, admins can define provider credentials at the organization level.
- Members should not see raw organization credentials.
- Submissions should record whether the credential source was `personal` or `organization`.
- If an organization disables personal provider use, members must submit through the org-managed credential path.

## IAM And Organization Model

Phase 2 needs proper identity and access management.

### Core IAM Objects

| Object | Purpose |
| --- | --- |
| User | Person using Dbugr |
| Organization | Company/startup/workspace container |
| Team | Optional subgroup inside organization |
| Membership | User's relationship to org/team |
| Role | Named permission bundle |
| Permission | Specific allowed action |
| Invite | Pending invitation to org/team |
| ProviderCredential | Personal or org-scoped provider connection metadata |
| OrganizationPolicy | Basic policy flags for public sharing, credential usage, and approvals |
| AuditEvent | Record of important access and submission actions |

### Suggested Roles

| Role | Permissions |
| --- | --- |
| Owner | Manage org, billing, members, sessions, provider settings, all submissions |
| Admin | Invite members, manage teams, moderate org sessions |
| Member | Create sessions, comment, submit own sessions |
| Reviewer | View assigned/team sessions, comment, suggest edits |
| Guest | Limited access to explicitly shared sessions |

### Important Permissions

- `session:create`
- `session:view_private`
- `session:view_org`
- `session:view_public`
- `session:comment`
- `session:curate`
- `session:submit`
- `session:change_visibility`
- `org:invite`
- `org:manage_members`
- `org:manage_roles`
- `provider:manage_org_credentials`
- `provider:use_org_credentials`
- `policy:manage_org`
- `public:moderate`
- `public:approve_publish`

### Minimal Organization Policies

| Policy | Default | Purpose |
| --- | --- | --- |
| `allowPublicSharing` | `false` for orgs, `true` for solo users | Controls whether org sessions can be posted publicly |
| `requirePublicApproval` | `true` | Requires owner/admin approval before public publish |
| `allowPersonalProviderKeys` | `true` | Allows members to use local/personal Claude/Codex credentials |
| `allowOrgProviderKeys` | `true` | Allows admins to set org-managed provider credentials |
| `defaultSessionVisibility` | `private` | Keeps new sessions private unless changed |
| `requireRedactionConfirmation` | `true` | Requires explicit confirmation before public publish |

## Data Model Additions

### User

Fields:

- `id`
- `email`
- `name`
- `avatarUrl`
- `authProvider`
- `createdAt`
- `lastSeenAt`

### Organization

Fields:

- `id`
- `name`
- `slug`
- `createdByUserId`
- `defaultVisibility`
- `allowPublicSharing`
- `requirePublicApproval`
- `allowPersonalProviderKeys`
- `allowOrgProviderKeys`
- `requireRedactionConfirmation`
- `createdAt`

### Team

Fields:

- `id`
- `orgId`
- `name`
- `slug`
- `createdAt`

### Membership

Fields:

- `id`
- `userId`
- `orgId`
- `teamId`
- `role`
- `status`
- `createdAt`

### Invite

Fields:

- `id`
- `orgId`
- `teamId`
- `email`
- `role`
- `tokenHash`
- `invitedByUserId`
- `expiresAt`
- `acceptedAt`
- `revokedAt`

### Session

Add fields:

- `ownerId`
- `orgId`
- `teamId`
- `visibility`: `private`, `organization`, `public`, `link`
- `submissionFlow`: `direct`, `internal_review`, `public_feed`
- `reviewStatus`: `draft`, `collecting_feedback`, `curating`, `ready_to_submit`, `submitted`
- `publicPublishedAt`
- `redactionConfirmedAt`
- `publicApprovedByUserId`
- `publicApprovedAt`

### Contribution

Fields:

- `id`
- `sessionId`
- `captureId`
- `annotationId`
- `authorId`
- `sourceScope`: `owner`, `team`, `public`, `system`
- `type`: `comment`, `suggested_edit`, `question`, `risk`, `requirement`
- `body`
- `suggestedText`
- `visibility`
- `createdAt`
- `updatedAt`

### CurationDecision

Fields:

- `id`
- `contributionId`
- `sessionId`
- `decidedByUserId`
- `decision`: `accepted`, `rejected`, `edited`, `duplicate`, `needs_clarification`
- `editedText`
- `reason`
- `includedInPayload`
- `createdAt`

### AIReviewSummary

Fields:

- `id`
- `sessionId`
- `providerTarget`
- `inputContributionIds`
- `goal`
- `keyAsks`
- `acceptedFeedbackSummary`
- `conflicts`
- `doNotChange`
- `finalPromptDraft`
- `createdByUserId`
- `approvedAt`
- `editedPrompt`
- `createdAt`

### ProviderCredential

Fields:

- `id`
- `ownerUserId`
- `orgId`
- `provider`: `claude`, `codex`, `cursor`
- `scope`: `personal`, `organization`
- `method`: `cli`, `api_key`, `mcp`, `installed`
- `displayName`
- `encryptedSecretRef`
- `createdByUserId`
- `lastUsedAt`
- `revokedAt`
- `createdAt`

Important note:

- For Phase 2, the `encryptedSecretRef` can point to an encrypted application secret record or managed secret store later.
- Raw secrets should never be returned to the desktop or web UI after save.
- Claude CLI and Codex CLI local handoff can continue using personal local credentials in solo mode.

### Submission

Fields:

- `id`
- `sessionId`
- `submittedByUserId`
- `providerTarget`
- `credentialScope`: `personal`, `organization`, `none`
- `providerCredentialId`
- `aiReviewSummaryId`
- `finalPrompt`
- `screenshotAssetIds`
- `status`
- `providerResponse`
- `createdAt`
- `completedAt`

### AuditEvent

Fields:

- `id`
- `orgId`
- `actorUserId`
- `entityType`
- `entityId`
- `action`
- `metadata`
- `createdAt`

Minimum audit events:

- User signed in.
- Desktop linked.
- Member invited.
- Member role changed.
- Session visibility changed.
- Session published publicly.
- Public publish approved.
- Comment accepted or rejected.
- AI preflight summary generated.
- Session submitted to AI.
- Provider credential created, used, or revoked.

## Web Routes

Suggested app routes:

- `/login`
- `/link-device`
- `/onboarding`
- `/org/[orgSlug]`
- `/org/[orgSlug]/sessions`
- `/org/[orgSlug]/team-review`
- `/public`
- `/session/[sessionId]`
- `/session/[sessionId]/curate`
- `/session/[sessionId]/submit`
- `/settings/members`
- `/settings/roles`
- `/settings/integrations`

## API Surface

Auth and linking:

- `POST /auth/device/start`
- `POST /auth/device/confirm`
- `GET /auth/device/poll`
- `POST /auth/logout`

Current implementation naming may use `/phase2/desktop-link` style endpoints during scaffolding. The production contract should converge on one concept: web-authenticated device linking with one-time, short-lived, replay-safe codes that redeem into a Keychain-stored desktop device token.

Organizations:

- `POST /orgs`
- `GET /orgs`
- `GET /orgs/:orgId`
- `PATCH /orgs/:orgId`

Organization policies:

- `GET /orgs/:orgId/policies`
- `PATCH /orgs/:orgId/policies`

Members and invites:

- `POST /orgs/:orgId/invites`
- `GET /orgs/:orgId/members`
- `PATCH /orgs/:orgId/members/:membershipId`
- `DELETE /orgs/:orgId/members/:membershipId`

Sessions:

- `POST /sessions`
- `GET /sessions`
- `GET /sessions/:sessionId`
- `PATCH /sessions/:sessionId`
- `POST /sessions/:sessionId/publish`
- `POST /sessions/:sessionId/approve-publication`
- `POST /sessions/:sessionId/redaction-confirm`

Provider credentials:

- `GET /provider-credentials`
- `POST /provider-credentials`
- `DELETE /provider-credentials/:credentialId`

Feeds:

- `GET /feed/private`
- `GET /feed/org/:orgId`
- `GET /feed/public`

Contributions:

- `POST /sessions/:sessionId/contributions`
- `PATCH /contributions/:contributionId`
- `DELETE /contributions/:contributionId`

Curation:

- `POST /contributions/:contributionId/curation`
- `GET /sessions/:sessionId/curation`
- `POST /sessions/:sessionId/curation/finalize`

AI preflight:

- `POST /sessions/:sessionId/ai-summary`
- `PATCH /ai-summary/:summaryId`
- `POST /ai-summary/:summaryId/approve`

Submission:

- `POST /sessions/:sessionId/submit`
- `GET /submissions/:submissionId`

## Desktop Responsibilities

Desktop should own:

- Native capture
- Annotation UI
- Local screenshot persistence
- Save to session
- Sync authenticated sessions
- Choose flow at a high level
- Open web review board
- Direct-to-AI handoff for local/private sessions

Desktop should not own:

- Full team feed
- Public feed browsing
- Invite management
- Role management
- Public moderation
- Long-form curation

## Web Responsibilities

Web should own:

- Login
- Device linking
- Organization setup
- Invites and IAM
- Private/org/public feeds
- Comments and suggested edits
- Review and curation
- AI summary preflight
- Final payload approval
- Submission history

## Step-By-Step Execution Checklist

Use this checklist when implementing Phase 2. Do not skip ahead unless the earlier dependency is already complete.

### 0. Foundation And Decisions

- [ ] Confirm auth provider for V1.
- [ ] Confirm production database provider.
- [ ] Confirm screenshot/object storage provider.
- [ ] Confirm email provider for invites and notifications.
- [ ] Confirm whether org-managed provider credentials are built in Phase 2 or only modeled.
- [ ] Confirm public feed policy defaults: recommended default is public sharing disabled for organizations.
- [ ] Confirm whether public viewing requires sign-in.
- [ ] Confirm whether external guests are allowed in internal review.
- [ ] Update `.env.example` with all required Phase 2 keys before implementation begins.
- [ ] Add a local seed scenario with one owner, one member, one org session, and one public session.

### 1. Auth And Desktop Linking

- [ ] Add web login route.
- [ ] Add user session handling on web.
- [ ] Add post-auth onboarding state that distinguishes new owner, invited new user, invited existing user, and returning member.
- [ ] Add macOS `.dmg` download step after workspace membership is confirmed.
- [ ] Add `Link this Mac` web CTA that only appears after web auth and workspace membership are ready.
- [ ] Add device-link start endpoint.
- [ ] Add device-link confirmation page.
- [ ] Add device-link polling endpoint for desktop.
- [ ] Add `dbugr://link?code=...` deep-link handler in the native macOS app.
- [ ] Add one-time desktop-link code hashing, expiry, replay prevention, and account/workspace binding.
- [x] Add desktop token storage for linked account.
- [x] Store linked desktop token in macOS Keychain, not in plain local storage.
- [x] Add desktop account context UI: signed-in name, email, workspace, role, and device name.
- [ ] Add desktop workspace switcher for users who belong to multiple organizations.
- [ ] Add desktop unlink/logout action.
- [ ] Add audit event for sign-in.
- [x] Add audit event for desktop linking.
- [ ] Add audit event for desktop unlink/logout.
- [ ] Verify desktop can show authenticated user/org state.

Exit criteria:

- [ ] User can sign in on web.
- [ ] New owner can create a workspace, download the DMG, link the Mac app, and see their identity in the Mac app.
- [ ] Invited existing user can accept a team invite, download/link the Mac app, and see the invited workspace in the Mac app.
- [ ] Invited new user can create a Dbugr account from the invite, download/link the Mac app, and see the invited workspace in the Mac app.
- [ ] Desktop can link to the signed-in account and selected workspace.
- [ ] Desktop can relaunch and remain linked.
- [ ] Desktop can unlink cleanly.
- [ ] Expired or reused link codes are rejected.
- [ ] Logs prove the flow without exposing raw tokens.

### 2. Organization, Team, Roles, And Invites

- [ ] Add `Organization` model.
- [ ] Add `Team` model.
- [ ] Add `Membership` model.
- [ ] Add `Invite` model.
- [ ] Add role enum: `owner`, `admin`, `member`, `reviewer`, `guest`.
- [ ] Add basic permission helper.
- [ ] Add onboarding screen for organization name.
- [ ] Add optional role/team setup.
- [ ] Add invite teammate form.
- [ ] Add invite email send path.
- [ ] Add invite accept route.
- [ ] Add settings page for members.
- [ ] Add audit event for invite created.
- [ ] Add audit event for invite accepted.
- [ ] Add audit event for role changed.

Exit criteria:

- [ ] New user can create an organization.
- [ ] Owner can invite a teammate.
- [ ] Invited teammate can join.
- [ ] Member cannot manage org settings.

### 3. Organization Policies

- [ ] Add `OrganizationPolicy` fields or table.
- [ ] Default org sessions to `private`.
- [ ] Default `allowPublicSharing` to `false` for organizations.
- [ ] Default `requirePublicApproval` to `true`.
- [ ] Default `allowPersonalProviderKeys` to `true`.
- [ ] Default `allowOrgProviderKeys` to `true`.
- [ ] Default `requireRedactionConfirmation` to `true`.
- [ ] Add settings UI for policy management.
- [ ] Gate policy management to owner/admin.
- [ ] Add audit event for policy changes.

Exit criteria:

- [ ] Org owner can update policies.
- [ ] Non-admin cannot update policies.
- [ ] Public sharing can be blocked by policy.

### 4. Session Sync And Visibility

- [ ] Add `ownerId`, `orgId`, and `teamId` to sessions.
- [ ] Add `visibility`: `private`, `organization`, `public`, `link`.
- [ ] Add `reviewStatus`.
- [x] Add desktop sync endpoint for sessions.
- [x] Add desktop sync endpoint for captures/screenshots.
- [ ] Add web session list.
- [ ] Add private session access check.
- [ ] Add organization session access check.
- [ ] Add public session access check.
- [ ] Add visibility change UI.
- [ ] Add redaction confirmation before public publish.
- [ ] Add public approval gate when required by policy.
- [ ] Add audit event for visibility changes.
- [ ] Add audit event for public publish.
- [ ] Add audit event for public approval.

Exit criteria:

- [ ] Desktop session appears on web.
- [ ] Private session is visible only to owner.
- [ ] Organization session is visible only to org members.
- [ ] Public session appears in public feed only after required confirmations.

### 5. Internal Review Feed

- [ ] Add `Team Review` web route.
- [x] Add organization feed API.
- [x] Add feed cards with screenshot thumbnail, owner, visibility, annotation count, comment count, accepted count, and status.
- [ ] Add session detail route.
- [ ] Add capture preview in session detail.
- [ ] Add annotation list in session detail.
- [ ] Add comment composer.
- [ ] Add suggested edit composer.
- [ ] Add contribution type: `comment`.
- [ ] Add contribution type: `suggested_edit`.
- [ ] Add contribution target: session.
- [ ] Add contribution target: capture.
- [ ] Add contribution target: annotation.
- [ ] Add audit event for contribution created.

Exit criteria:

- [ ] Org member can comment on an org-visible session.
- [ ] Non-member cannot view or comment on org session.
- [x] Owner sees all team feedback in one review board.

### 6. Curation Board

- [ ] Add `CurationDecision` model.
- [ ] Add accept action.
- [ ] Add reject action.
- [ ] Add edit-then-accept action.
- [ ] Add duplicate action.
- [ ] Add needs-clarification action.
- [ ] Add curation tray UI.
- [ ] Add filter for accepted, rejected, and unreviewed contributions.
- [ ] Add accepted context preview.
- [ ] Add audit event for accept/reject/edit decisions.
- [ ] Add role check for who can curate.

Exit criteria:

- [x] Owner can accept feedback.
- [x] Owner can reject feedback.
- [x] Accepted feedback appears in final context preview.
- [x] Rejected feedback is excluded from final context.

### 7. AI Summary Preflight

- [ ] Add `AIReviewSummary` model.
- [ ] Build accepted-context prompt builder.
- [ ] Include session note.
- [ ] Include original annotations.
- [ ] Include accepted team comments.
- [ ] Include accepted public comments.
- [ ] Include screenshot references.
- [ ] Include repo/folder context.
- [ ] Add AI summary generation endpoint.
- [ ] Add summary review screen.
- [ ] Add edit prompt action.
- [ ] Add regenerate action.
- [ ] Add approve summary action.
- [ ] Add audit event for summary generated.
- [ ] Add audit event for summary approved.

Exit criteria:

- [ ] Generated summary includes every accepted contribution.
- [ ] Rejected contributions are absent.
- [ ] Final prompt is bulleted and reviewable.
- [ ] Owner can approve the final prompt.

### 8. Provider Credentials And Submission

- [ ] Add `ProviderCredential` model.
- [ ] Add credential scope: `personal`, `organization`.
- [ ] Add credential method: `cli`, `api_key`, `mcp`, `installed`.
- [ ] Add org credential settings UI.
- [ ] Hide raw org credentials after save.
- [ ] Add provider credential audit events.
- [ ] Enforce `allowPersonalProviderKeys`.
- [ ] Enforce `allowOrgProviderKeys`.
- [ ] Add `Submission` model.
- [ ] Store final prompt snapshot.
- [ ] Store provider target.
- [ ] Store credential source.
- [ ] Store screenshot asset references.
- [ ] Submit approved prompt to Claude CLI path.
- [ ] Submit approved prompt to Codex CLI path.
- [ ] Submit approved prompt to Cursor handoff path.
- [ ] Add audit event for submission.

Exit criteria:

- [ ] Final submission uses the approved preflight prompt.
- [ ] Submission snapshot is immutable.
- [ ] Credential source is recorded.
- [ ] Org credentials are never shown to non-admin users.

### 9. Public Feed

- [ ] Add public feed route.
- [x] Add public feed API.
- [ ] Add public session card.
- [ ] Add public comment path.
- [ ] Add public suggested edit path.
- [ ] Add owner approval controls for public comments entering AI payload.
- [ ] Add report/moderation placeholder.
- [ ] Add unpublish action.
- [ ] Enforce org public sharing policy.
- [ ] Enforce redaction confirmation.
- [ ] Enforce public approval when required.

Exit criteria:

- [ ] Public sessions are visible publicly only after policy gates pass.
- [ ] Public comments do not enter the AI payload unless accepted.
- [ ] Owner can unpublish or moderate according to policy.

### 10. Notifications And Polish

- [ ] Send invite email.
- [x] Send batched new-comment notification email.
- [x] Batch team and public comment notifications per session for 10 minutes before sending.
- [x] Re-run the comment digest job every 10 minutes so active threads produce grouped updates instead of one email per comment.
- [x] Include all new comments since the last digest, grouped by session, comment scope, author, and target: session, capture, or annotation.
- [x] Send digests to the session owner and relevant watchers/team members; do not notify the comment author about their own comment.
- [ ] For public comments, notify the poster/owner that comments are waiting for review and that only accepted comments enter the AI payload.
- [ ] Add unsubscribe/notification preference hooks before public launch.
- [x] Log notification queued, digest window opened, digest sent, digest skipped, and delivery failure without logging full private comment bodies.
- [ ] Send ready-to-curate notification.
- [ ] Send ready-to-submit notification.
- [ ] Add activity history.
- [ ] Add feed filters.
- [ ] Add feed search.
- [ ] Add empty states using `docs/design-system-dbugr.md`.
- [ ] Add e2e tests for the full internal review flow.

Exit criteria:

- [ ] Owner knows when feedback arrives without getting spammed by one email per comment.
- [ ] Multiple comments posted inside a 10-minute window produce a single digest email.
- [ ] Team review digest links the owner back to the internal review board.
- [ ] Public feedback digest links the owner back to the public curation view with redaction and approval controls.
- [ ] Reviewers know when they are invited or mentioned.
- [ ] Internal review flow passes end-to-end.

## Provisioning Checklist

These are the external accounts, keys, and environment values needed to make Phase 2 work. Provision only what is needed for the milestone being implemented.

### Required For Phase 2 MVP

- [ ] Production database.
  Suggested providers: Neon Postgres, Supabase Postgres, Railway Postgres.
  Env: `DATABASE_URL`

- [ ] Auth provider.
  Suggested providers: Clerk, Auth0, Supabase Auth, NextAuth/Auth.js with Google OAuth.
  Env examples: `AUTH_SECRET`, `AUTH_URL`, `AUTH_PROVIDER`

- [ ] Google OAuth app for sign-in.
  Required if using Google login.
  Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

- [ ] Email provider for invites and notifications.
  Suggested providers: Resend, Postmark, SendGrid.
  Env: `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN` or `SENDGRID_API_KEY`

- [ ] Object storage for screenshots and artifacts.
  Suggested providers: S3, Cloudflare R2, Supabase Storage, Vercel Blob.
  Env examples: `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_BASE_URL`

- [ ] App encryption secret for sensitive stored values.
  Used for provider credential records if org-managed credentials are enabled.
  Env: `APP_ENCRYPTION_KEY`

- [ ] Desktop link token secret.
  Used to sign or verify desktop linking tokens.
  Env: `DESKTOP_LINK_SECRET`

- [ ] Web app base URL.
  Used in invite links, desktop linking, and callbacks.
  Env: `APP_URL`, `NEXT_PUBLIC_APP_URL`

- [ ] API base URL.
  Used by desktop and web clients.
  Env: `API_URL`, `NEXT_PUBLIC_API_URL`

### AI And Provider Handoff

- [ ] Anthropic API key for AI summary preflight.
  Env: `ANTHROPIC_API_KEY`

- [ ] Optional Claude API key alias if keeping existing naming.
  Env: `CLAUDE_API_KEY`

- [ ] OpenAI API key for Codex/OpenAI summary or provider validation.
  Env: `OPENAI_API_KEY`

- [ ] Optional org-managed Claude credential.
  Stored through app credential flow, not committed to `.env`.

- [ ] Optional org-managed OpenAI/Codex credential.
  Stored through app credential flow, not committed to `.env`.

- [ ] Cursor detection remains local for desktop.
  No cloud key required for V1 Cursor handoff.

### GitHub And Integration Work

- [ ] GitHub OAuth app, if users will connect GitHub accounts.
  Env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

- [ ] GitHub fine-grained PAT or GitHub App credentials, if Dbugr creates issues/PRs.
  Existing env: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`

- [ ] Target repo defaults for local development.
  Existing env: `TARGET_REPO_URL`, `TARGET_REPO_BRANCH`

- [ ] Jira integration keys, optional.
  Existing env: `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`

### Public Feed And Safety

- [ ] Moderation provider, optional for V1.
  Suggested providers: OpenAI moderation, Perspective API, custom admin review.
  Env examples: `MODERATION_PROVIDER`, `MODERATION_API_KEY`

- [ ] Abuse/report notification email.
  Env: `TRUST_SAFETY_EMAIL`

- [ ] Public asset CDN/base URL.
  Needed if public screenshots use sanitized copies.
  Env: `PUBLIC_ASSET_BASE_URL`

### Deployment And Operations

- [ ] Hosting provider for web and API.
  Suggested providers: Vercel for web, Railway/Fly/Render for API/worker, or one unified platform.

- [ ] Production domain.
  Env: `APP_URL`

- [ ] Error monitoring.
  Suggested providers: Sentry, Highlight.
  Env: `SENTRY_DSN`

- [ ] Analytics, optional.
  Suggested providers: PostHog, Vercel Web Analytics.
  Env examples: `POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`

- [ ] Cron/background job secret.
  Used for notification jobs and cleanup tasks.
  Env: `JOB_SECRET`

- [ ] Webhook signing secret.
  Used for provider callbacks or future billing/events.
  Env: `WEBHOOK_SECRET`

## Implementation Milestones

### Milestone 1: Auth, Device Linking, And Org Setup

Build:

- Web login.
- Device linking flow for desktop.
- Organization creation.
- Team name and role onboarding.
- Invite teammate UI.
- Initial membership roles.
- Basic organization policy defaults.
- Minimal audit event table.

Success criteria:

- User can sign in on web.
- Desktop can link to that web account.
- User can create an organization.
- User can invite another member.
- New org sessions default to private.
- Invite and role changes create audit events.

### Milestone 2: Session Sync And Visibility

Build:

- Session owner/org fields.
- Visibility field.
- Desktop sync of sessions and screenshots.
- Web session list.
- Private/org/public visibility gates.
- Public publish confirmation.
- Organization policy check for public sharing.

Success criteria:

- Desktop-created sessions appear on web.
- Private sessions are visible only to owner.
- Org sessions are visible only to members.
- Public sessions are visible in public feed.
- Public sharing can be disabled for an organization.
- Public publish requires redaction confirmation when enabled.

### Milestone 3: Internal Review Feed

Build:

- Organization feed.
- Session cards.
- Session detail page.
- Annotation-level comment thread.
- Team member comments and suggested edits.

Success criteria:

- Team members can comment on shared sessions.
- Owner sees all team feedback in one place.
- Non-members cannot view org sessions.

### Milestone 4: Curation Board

Build:

- Accept/reject/edit controls.
- Curation tray.
- Contribution status filters.
- Final accepted context preview.

Success criteria:

- Owner can curate comments.
- Accepted comments appear in final context.
- Rejected comments are excluded from AI payload.

### Milestone 5: AI Summary Preflight

Build:

- AI summary generation endpoint.
- Prompt builder for accepted context.
- Summary review screen.
- Edit/regenerate/approve controls.

Success criteria:

- Summary includes all accepted comments.
- Summary groups asks clearly.
- Final prompt is bulleted and reviewable before submission.

### Milestone 6: Submit Curated Payload

Build:

- Submit approved prompt to Claude CLI, Codex CLI, or Cursor handoff path.
- Store frozen submission snapshot.
- Store response or handoff status.
- Show result in web and desktop.
- Store credential source on submission.
- Enforce org policy for personal vs org-managed credentials.

Success criteria:

- Submitted payload matches approved preflight prompt.
- Screenshot references are preserved.
- Submission history is visible.
- Submission audit event is recorded.
- Org-managed credentials are never exposed to non-admin users.

### Milestone 7: Public Feed

Build:

- Public feed page.
- Public comment path.
- Redaction warning before publish.
- Public comment approval path.
- Basic moderation/report controls.
- Admin approval path when org policy requires it.

Success criteria:

- Public sessions are visible publicly.
- Public comments do not enter payload unless accepted.
- Owner can unpublish or moderate according to policy.
- Organization policy can block public publishing.

### Milestone 8: Notifications And Polish

Build:

- Notifications for new comments.
- Ready-to-curate notification.
- Ready-to-submit notification.
- Activity history.
- Filters and search.

Success criteria:

- Owners know when review feedback arrives.
- Reviewers know when they are invited or mentioned.
- Users can find active sessions quickly.

## Testing Strategy

Auth/IAM:

- User can create org.
- Owner can invite member.
- Member cannot manage org settings.
- Guest cannot view unshared sessions.
- Admin can update basic org policy.
- Provider admin can create org credential.
- Member cannot view raw org credential.

Visibility:

- Private session hidden from org members.
- Org session visible to org members only.
- Public session visible without org membership.
- Public publish requires redaction confirmation.
- Public publish is blocked when org policy disables it.
- Public publish waits for approval when org policy requires it.

Comments:

- Team member can comment on org session.
- Public user can comment on public session.
- Comment can target session/capture/annotation.

Curation:

- Owner can accept/reject/edit.
- Non-owner cannot finalize unless role permits.
- Rejected comments are excluded from payload.

AI preflight:

- Accepted comments are included.
- Rejected comments are excluded.
- Conflicting asks are surfaced.
- Prompt is bulleted and clear.

Submission:

- Final prompt snapshot is immutable after submit.
- Provider target is stored.
- Credential source is stored.
- Org policy is enforced before submit.
- Screenshot references survive handoff.

Desktop sync:

- Desktop-created session appears on web.
- Web comments sync back into desktop status summaries.
- Offline desktop capture can sync later.

## Open Questions For Confirmation

1. Should public feed allow anonymous viewing, or require sign-in to view and comment?
2. Should public comments require owner approval before appearing publicly, or only before entering AI payload?
3. Should `Team` be mandatory inside an organization, or should organization-level membership be enough for V1?
4. Should external guests be allowed for internal review without joining the full organization?
5. Should AI preflight use the selected provider only, or should Dbugr use one standard summarizer regardless of final target?
6. Should desktop support full curation later, or should curation remain web-only?
7. Should public sessions support redacted duplicate screenshots, or should redaction be crop/blur on the original asset?
8. Should org-managed provider credentials ship in Phase 2, or should Phase 2 only store metadata and keep actual Claude/Codex execution local?
9. Should public sharing be disabled by default for every organization until an admin enables it?

## Recommended Build Order

Start with internal review before public feed.

The first valuable Phase 2 slice:

1. Web login and desktop linking.
2. Organization creation and invites.
3. Basic roles, policies, and audit events.
4. Desktop session sync to web.
5. Organization feed.
6. Team comments on annotations.
7. Owner accept/reject.
8. AI preflight summary.
9. Curated Claude CLI / Codex CLI handoff.

Public feed should follow after the internal review loop feels reliable.
