# Releasing the macOS DMG

Dbugr distributes packaged macOS builds through the public web app and can also mirror them to GitHub Releases.

## Automated Release

1. Make sure `main` is green:

   ```bash
   pnpm --filter @feedbackagent/desktop test
   pnpm --filter @feedbackagent/api build
   pnpm --filter @feedbackagent/web build
   cd apps/desktop/src-tauri
   cargo fmt --check
   cargo check
   ```

2. Create and push a release tag:

   ```bash
   git tag -a v0.0.1 -m "Dbugr macOS v0.0.1"
   git push origin v0.0.1
   ```

3. GitHub Actions runs `.github/workflows/release-desktop.yml`, builds the DMG on macOS, and uploads:

   ```text
   Dbugr_0.0.1_aarch64.dmg
   ```

4. Copy the DMG to `apps/web/public/downloads/Dbugr_0.0.1_aarch64.dmg` before deploying the hosted web app. Set `NEXT_PUBLIC_MAC_DMG_URL` only when overriding that public download path.

## Manual Release

Build locally:

```bash
pnpm --filter @feedbackagent/desktop bundle
```

Upload the generated DMG:

```bash
gh release create <tag> \
  apps/desktop/src-tauri/target/release/bundle/dmg/Dbugr_0.0.1_aarch64.dmg \
  --repo kuma0177/debgr_ai \
  --title "Dbugr macOS <tag>" \
  --notes "Packaged macOS build for local use."
```

If the release already exists:

```bash
gh release upload <tag> \
  apps/desktop/src-tauri/target/release/bundle/dmg/Dbugr_0.0.1_aarch64.dmg \
  --repo kuma0177/debgr_ai \
  --clobber
```

## macOS Notes

- Minimum supported macOS version is 13.0.
- Users must grant Screen Recording permission before captures work.
- Claude, Codex, and Cursor handoffs depend on tools installed locally on the user's Mac.
- Unsigned or locally signed builds may trigger macOS security prompts. Document any signing/notarization status in each release.
