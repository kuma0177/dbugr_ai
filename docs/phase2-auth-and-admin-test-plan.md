# Phase 2 Auth, Onboarding, and Admin Regression Plan

This checklist is the quality gate for dbugr.ai Phase 2 web onboarding, team setup, and admin management. The goal is simple: a new user, an existing user, an invited teammate, and the dbugr super admin should each land in the right product state without guessing, refreshing, or repeating completed setup.

## Executable Regression Suite

Run the API locally, then run:

```bash
pnpm --filter @feedbackagent/api test:phase2:auth
```

The suite uses a non-production header, `x-dbugr-test-preview-email: 1`, so it can verify email-code flows deterministically without depending on Resend delivery. Production ignores this test shortcut.

## User-State Regression Checklist

- [ ] New email sign-up requests a code, reports `accountExists=false`, verifies the code, creates a user, and keeps the user in workspace setup until an organization is created.
- [ ] Existing email with an active workspace requests a code, reports `accountExists=true`, verifies the code, and returns a workspace payload so the web app can route directly to dashboard.
- [ ] Existing email without an active workspace requests a code, reports `accountExists=true`, verifies the code, and stays in workspace setup because there is no organization membership yet.
- [ ] Incorrect email code returns the exact friendly message: `Incorrect Code Received. Enter the 6-digit code from your email.`
- [ ] Google sign-in/sign-up with an email that already exists resolves to the same user record and returns that user’s existing workspace.
- [ ] Owner/admin users can load workspace admin overview with members, invites, teams, and audit events.
- [ ] Platform admin endpoints reject non-super-admin users unless `DEBUGR_SUPER_ADMIN_EMAILS` explicitly grants access.

## Functional Product Checklist

- [ ] Homepage email entry carries the typed email into onboarding.
- [ ] Top navigation shows signed-out actions only when no local Dbugr identity exists.
- [ ] Sign-up copy uses `sign up`; sign-in copy uses `sign in`.
- [ ] Existing-account detection switches the onboarding card from “Choose how to sign up” to “Choose how to sign in.”
- [ ] Existing users with a workspace are routed to dashboard after verification instead of seeing workspace setup again.
- [ ] Workspace setup supports organization name, default visibility, role, team, logo, and up to 10 invite emails.
- [ ] Admin dashboard supports member search, team filtering, role/status management, invite revocation, audit deletion, and platform-admin search when enabled.
- [ ] Mac link step explains download, install, link, and relink in plain language.

## Logging Quality Gate

Every auth and admin path should log a structured event with a redacted email, user/workspace state, and outcome.

- [ ] `email_code.requested` logs account existence, delivery provider, and whether test preview delivery was forced.
- [ ] `email_code.verify_completed` logs created/reused user state and whether an active workspace was found.
- [ ] `identity.ensure_completed` logs Google/email account resolution and workspace state.
- [ ] `onboarding.completed` logs organization, team, and invite count.
- [ ] Admin endpoints log forbidden access, successful overview loads, member changes, invite revocations, and audit deletions.
- [ ] Web API client logs request start, completion, failures, HTTP status, duration, and readable user-facing errors.

## Unit-Test Candidates

These are not all automated yet, but they are the next unit-level seams to extract and test.

- [ ] `deriveNameFromEmail` handles dotted, dashed, numeric, and empty local parts.
- [ ] `mergeAuthProviders` deduplicates `email`, `google`, and legacy `demo` providers.
- [ ] Email-code validation rejects non-six-digit values before calling the API.
- [ ] API error formatting never renders `[object Object]`.
- [ ] Onboarding local-state read/write emits `dbugr-auth-changed` and updates nav state.
