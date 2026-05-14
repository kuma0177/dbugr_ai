## Summary

What changed and why?

## Verification

- [ ] `pnpm --filter @feedbackagent/desktop test`
- [ ] `pnpm --filter @feedbackagent/api build`
- [ ] `pnpm --filter @feedbackagent/web build`
- [ ] `cargo fmt --check && cargo check` in `apps/desktop/src-tauri` if desktop native/Tauri changed

## Regression Ledger

- [ ] I checked `docs/desktop-regression-ledger.md` if this touches desktop capture, annotation, overlay, permissions, session save, provider handoff, desktop sync, team/public review, seed/smoke data, or review curation.

## Screenshots

Add screenshots or screen recordings for visible UI changes.
