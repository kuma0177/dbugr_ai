# Agent Rules

Before changing Debugr desktop capture, annotation, overlay, Screen Recording permission, session-save, provider-handoff, web review feed, team/public submission, desktop-sync API, seed/smoke data, or review-curation code, read and apply `docs/desktop-regression-ledger.md`.

Every fix in those areas must preserve the ledger invariants, add/update the relevant regression test, and update the ledger when a new regression class is discovered.
