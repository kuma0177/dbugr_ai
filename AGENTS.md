# Agent Rules

Before changing Debugr desktop capture, annotation, overlay, Screen Recording permission, session-save, or provider-handoff code, read and apply `docs/desktop-regression-ledger.md`.

Every fix in those areas must preserve the ledger invariants, add/update the relevant regression test, and update the ledger when a new regression class is discovered.
