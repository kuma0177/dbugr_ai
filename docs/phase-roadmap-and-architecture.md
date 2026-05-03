# Dbugr Phase Roadmap And Architecture

## Purpose

This document defines the recommended product scope for Dbugr's first three phases.

## Build Rule

Preserve the current desktop capture, annotation, session-save, and provider-handoff core unless a bug or reliability issue requires a change.

For the initial release scope, most new work should happen around:

- onboarding
- desktop-to-web account linking
- organization and team management
- review feeds
- comments and curation
- AI summary preflight
- submission review and history

The desktop app should evolve by adding hooks into these workflows, not by repeatedly redesigning or destabilizing the capture engine that already works.

The current decision is:

- Phase 1 and Phase 2 should ship as the initial product scope.
- Phase 3 should extend the same product into an enterprise-ready offering.

The architecture should make that extension straightforward. We should not need to rebuild the collaboration model, submission model, or permission model to support larger companies later.

## Product Positioning

### Initial target users

- Hackers
- College students
- Solo builders
- YC founders and startup teams
- Series A through D product, design, and engineering teams

### Enterprise-readiness goal

The initial product should still be credible to F100 design, product, and engineering teams evaluating an internal pilot.

That means:

- local-first credentials by default
- minimal PII on Dbugr servers
- clear org and role boundaries
- explicit visibility controls
- immutable prompt and submission history
- architecture that can later support customer-controlled storage and enterprise auth

## Scope Summary

### Initial scope = Phase 1 + Phase 2

The initial release should include both:

- the best solo capture-to-AI workflow on macOS
- lightweight social collaboration and curation on the web

This is the smallest scope that can still create viral and team-level adoption:

- solo users can use it immediately
- startup teams can collaborate around sessions
- public sharing can drive community discovery

### Phase 3 = enterprise-ready extension

Phase 3 should not change the core product. It should harden and extend the same workflows for larger organizations with stronger requirements.

Phase 3 should add:

- stronger IAM and admin controls
- enterprise auth options
- customer-controlled credential and data options
- deployment and compliance flexibility

## Initial Release Scope

The initial release should include the following end-to-end journey.

Important scoping rule:

- Keep the current desktop capture and handoff engine stable.
- Build most initial-scope expansion around the web collaboration layer and a few carefully chosen desktop integration points.

### 1. Local capture and annotation on macOS

Required:

- capture visible screen content reliably
- capture full screen or a chosen window when needed
- annotate with pins and regions
- add annotation-level notes
- add a single session-level note
- attach repo or local folder context
- save to a new or existing session

Why it matters:

- this is the core habit-forming action
- if this feels unreliable or slow, the social layer will not matter

### 2. Direct AI handoff

Required:

- submit to `Claude CLI`
- submit to `Codex CLI`
- submit to `Cursor`
- show a prompt preview before send
- preserve screenshots, notes, and accepted context
- show submission confirmation and next actions

Why it matters:

- the fastest user value is "I captured the problem and immediately handed the full context to my AI tool"

### 3. Account linking and lightweight auth

Required:

- web sign-in
- desktop-to-web account linking
- user profile
- organization creation
- invite teammates

Why it matters:

- collaboration requires identity
- we should keep the desktop app local-first, but it still needs an account bridge for review and feed workflows

### 4. Session visibility and collaboration

Required:

- `Private` sessions
- `Organization` sessions
- `Public` sessions
- one collaboration website with scoped feeds
- internal review visible only to organization members
- public feed visible on the same website

Why it matters:

- one feed system is simpler than separate products
- the same review object model should power private, team, and public feedback

### 5. Comments and curation

Required:

- session-level comments
- capture-level comments
- annotation-specific comments
- accept / reject / edit / duplicate / needs clarification
- owner-controlled curation board
- only accepted items enter the final AI payload

Why it matters:

- this turns Dbugr into a real collaboration product rather than a screenshot dropbox

### 6. AI summary preflight

Required:

- generate a structured summary from the selected provider route
- group accepted feedback by theme
- identify conflicts or ambiguity
- produce a clear bulleted final prompt
- let the owner edit or approve before final submission

Why it matters:

- this is the layer that keeps Claude/Codex from missing key asks
- it turns collaborative noise into a clean, actionable request

### 7. Minimal IAM and organization policy

Required:

- organizations
- optional teams
- roles
- invites
- permissions
- organization policies for public sharing and credential usage
- audit events for sensitive actions

Why it matters:

- startup teams need basic control immediately
- enterprise pilots need a plausible permission model from day one

### 8. Minimal public-community loop

Required:

- publish a session publicly with explicit confirmation
- require redaction confirmation before publish
- allow public comments
- keep poster approval in control of final AI payload inclusion
- allow owners to curate public suggestions before AI submission

Why it matters:

- public sharing creates discovery and adoption
- it also creates the "social proof" loop that can help Dbugr spread

## What Should Not Be In The Initial Release

Do not include these in the first combined Phase 1 + 2 scope:

- SAML / SCIM
- dedicated single-tenant deployment
- customer-managed keys
- full DLP scanning
- legal hold workflows
- region-specific storage controls
- advanced billing and seat management
- complex external admin portals
- deep browser extension work for tab-level capture

These are Phase 3 or later concerns.

## Recommended Phase Breakdown

### Phase 1: Solo Core

Ship the product so a single user can:

- install locally
- capture and annotate
- save sessions
- attach repo/folder context
- submit to Claude CLI, Codex CLI, or Cursor
- review prompt preview
- revisit prior sessions

Exit criteria:

- capture flow is stable and fast
- session persistence is reliable
- AI handoff works repeatedly
- install and run instructions are clean enough for GitHub-driven adoption

Milestone checklist:

- [ ] Stable macOS capture flow
- [ ] Stable annotation and session-save flow
- [ ] Stable session history and reopen flow
- [ ] Stable Claude CLI handoff
- [ ] Stable Codex CLI handoff
- [ ] Stable Cursor handoff
- [ ] Prompt preview before submission
- [ ] Repo / local-folder context attached to session
- [ ] Local-first persistence for screenshots and notes
- [ ] Clear local install and run documentation
- [ ] Native migration direction documented without disrupting the current stable desktop flow

### Phase 2: Social Review

Add collaboration on top of the solo core:

- sign in and link desktop to web
- create org
- invite team members
- review sessions on web
- comment on sessions, captures, and annotations
- curate accepted feedback
- generate AI summary preflight
- submit curated payload
- optionally publish publicly

Exit criteria:

- internal review works for startup teams
- public sharing exists with basic controls
- accepted comments correctly shape the final AI prompt
- org-level visibility and roles work predictably

Milestone checklist:

- [ ] Web auth and desktop account linking
- [ ] User profile and organization creation
- [ ] Team invites and lightweight roles
- [ ] Session sync between desktop and web
- [ ] Visibility controls for `Private`, `Organization`, and `Public`
- [ ] Internal review feed
- [ ] Public feed on the same website
- [ ] Session-level comments
- [ ] Capture-level comments
- [ ] Annotation-specific comments
- [ ] Curation board with accept / reject / edit decisions
- [ ] AI summary preflight
- [ ] Final prompt approval before send
- [ ] Submission history with frozen prompt snapshots
- [ ] Basic org policy controls for public sharing and credential usage
- [ ] Audit events for sensitive collaboration and submission actions

### Phase 3: Enterprise-Ready

Extend the same product for larger organizations:

- enterprise auth and identity
- stronger audit and admin controls
- customer-controlled storage or deployment options
- stricter provider credential policies
- compliance and retention controls
- deployment flexibility

Exit criteria:

- a larger company can evaluate Dbugr without asking us to redesign the core data, permission, or submission model

Milestone checklist:

- [ ] Stronger org admin controls
- [ ] Enterprise auth path planned or implemented
- [ ] Organization-managed credential model hardened
- [ ] Customer-controlled storage / deployment path defined
- [ ] Retention and audit posture expanded
- [ ] Compliance-oriented policy layer extended without changing the core product model

## Architecture Principles

To make Phase 2 extend cleanly into Phase 3, use these architecture rules from the beginning.

### 1. Local-first credentials

Default behavior:

- personal AI credentials stay on the user's device
- local CLI auth stays on the user's device
- Dbugr servers should not become a warehouse for personal provider secrets

Phase 3 extension:

- allow organization-managed credentials as an optional capability
- keep them scoped and abstracted behind a provider credential layer

### 2. Minimal PII by default

Store only what collaboration requires:

- email
- display name
- avatar, optional
- org membership
- session and contribution state

Avoid unnecessary personal profile collection.

Phase 3 extension:

- customer-controlled profile sources via enterprise auth

### 3. One collaboration model, three visibility scopes

Use one session and contribution model for:

- `Private`
- `Organization`
- `Public`

Do not build three separate products.

Phase 3 extension:

- add `Link-only`
- add stricter org policy controls
- add external guest workflows if needed

### 4. Separate control plane from data plane

Conceptually separate:

- identity, roles, policies, and workflow orchestration
- content storage, prompt storage, and collaboration data

This does not mean fully building enterprise deployment now. It means keeping service boundaries clean enough that we can later swap storage ownership models.

Phase 3 extension:

- customer-hosted or enterprise-controlled collaboration data plane

### 5. Treat submission as a frozen artifact

Every final AI submission should freeze:

- accepted context
- generated summary
- final edited prompt
- provider target
- screenshot references
- submission metadata

Why:

- this supports reproducibility
- this supports trust and auditing
- this makes enterprise extension much easier

### 6. Keep desktop and web responsibilities separate

Desktop should own:

- capture
- annotation
- local persistence
- local credential use
- fast save flow
- deep links into review and submit flows

Web should own:

- auth
- organizations
- invites
- feed visibility
- comments and curation
- prompt review
- public feed
- organization policy controls

Phase 3 extension:

- richer admin and audit surfaces in the web app

### 7. Build policy gates, not hardcoded assumptions

Examples:

- can this org publish publicly?
- does this org require approval before public posting?
- can this org use personal provider credentials?
- can this role submit to AI?

Represent these as policy and permission checks rather than scattered UI rules.

Phase 3 extension:

- new enterprise policies can be added without reshaping the product flow

## Recommended System Shape

### Desktop app

Responsibilities:

- capture and annotate
- store local screenshot assets
- create and update sessions
- use local provider integrations
- sync sessions to web account when linked
- open the web review board when collaboration is needed

### Web app

Responsibilities:

- sign in
- org and team management
- internal review feed
- public feed
- comments and curation
- final prompt preview
- AI summary preflight review
- submission history
- org policy settings

### API

Responsibilities:

- auth/session bridge
- session sync
- feed queries
- comments and curation mutations
- policy evaluation
- audit event storage
- final submission record storage

### Worker

Responsibilities:

- async summary generation
- notification fanout
- public-feed processing
- future moderation hooks

## Phase 3 Extension Map

These are the explicit seams we should preserve.

### Credentials

Initial:

- personal local credentials
- optional org-managed credentials modeled, possibly limited

Phase 3:

- stricter org-managed credential controls
- enterprise credential routing

### Identity

Initial:

- email/social login
- org invites
- roles

Phase 3:

- SSO / SCIM
- domain-based org enforcement

### Storage ownership

Initial:

- Dbugr-hosted collaboration data
- local-first personal credentials

Phase 3:

- customer-controlled storage or hosted enterprise deployment option

### Compliance

Initial:

- audit events
- immutable prompt snapshots
- redaction confirmation

Phase 3:

- retention controls
- stronger moderation and DLP
- legal/compliance policies

## Recommended Build Order

1. Preserve and lightly harden the existing desktop capture and AI handoff loop.
2. Add account linking and web auth.
3. Add organizations, invites, roles, and visibility scopes.
4. Add session sync and deep links between desktop and web.
5. Add internal review feed and comments.
6. Add curation board and accepted-comment payload building.
7. Add AI summary preflight and final prompt approval.
8. Add public feed with redaction confirmation and approval controls.
9. Add policy and audit hardening.
10. Add Phase 3 seams deliberately, without fully building enterprise features yet.

## Tracking Guidance

Use this roadmap file to track milestone completion at the phase level.

Use [docs/phase-2-social-refinement-plan.md](/Users/kumar/debugr/docs/phase-2-social-refinement-plan.md:1) to track the detailed implementation sequence for collaboration, IAM, curation, and submission work.

Rule of thumb:

- update this roadmap when a milestone is meaningfully complete
- update the detailed social refinement plan as sub-steps are implemented
- avoid copying low-level implementation tasks back into this roadmap unless they change phase scope or milestone status

## Final Recommendation

The best product shape is:

- **Initial scope:** Phase 1 + Phase 2 together
- **Market wedge:** solo-to-team capture and AI collaboration for hackers, students, YC startups, and growth-stage startup teams
- **Phase 3 path:** enterprise-ready extension without redoing the product model

This gives Dbugr:

- immediate individual value
- collaborative team value
- public growth loops
- a credible long-term story for larger companies

The key is not to build enterprise features too early. It is to build the initial product on clean seams that let enterprise requirements attach later.
