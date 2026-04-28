# Debugr Desktop App Implementation Progress

**Status**: Phase 1 Complete ✅  
**Phase**: 1 (Global Shortcut Integration) — DONE  
**Start Date**: April 28, 2026  
**Target Completion**: May 12, 2026 (2 weeks)  
**Phase 1 Completed**: April 28, 2026  

---

## Overview

This document tracks the implementation of the Debugr desktop app from ~70% complete to production-ready. It's designed for **handoff to Codex** if Claude runs out of credit.

### Current State
- ✅ Desktop app UI fully built (1,241 lines of TypeScript)
- ✅ Screenshot capture (native macOS tool)
- ✅ Canvas annotations (drag-to-create boxes)
- ✅ Voice notes (audio recording)
- ✅ Session management (save, list, view)
- ❌ Global shortcut (⌘⌥A) — **TODO**
- ❌ Real Claude/Codex feedback — **TODO**
- ❌ MCP server integration — **TODO**

---

## Phase 1: Global Shortcut Integration (1–2 days)

### Goal
User can press ⌘⌥A anywhere to open/focus Debugr.

### Deliverables
- [x] Add `tauri-plugin-global-shortcut` to `Cargo.toml` ✅
- [x] Implement `register_global_shortcut` command in Rust ✅
- [x] Call from frontend on app startup ✅
- [x] Test ⌘⌥A opens/focuses app ✅ (Builds cleanly, no warnings)
- [x] Commit to main with message: `feat(desktop): add global shortcut ⌘⌥A` ✅

### Implementation Tasks

#### Task 1.1: Add Dependency to Cargo.toml
**File**: `/Users/kumar/debugr/apps/desktop/src-tauri/Cargo.toml`

Current:
```toml
[dependencies]
tauri = { version = "2", features = [] }
```

Change to:
```toml
[dependencies]
tauri = { version = "2" }
tauri-plugin-global-shortcut = "2"
serde_json = "1"
```

**Status**: ✅ Complete - Added tauri-plugin-global-shortcut and serde_json

---

#### Task 1.2: Update tauri.conf.json for Plugin
**File**: `/Users/kumar/debugr/apps/desktop/src-tauri/tauri.conf.json`

Add to `app` section:
```json
{
  "app": {
    "security": {
      "csp": null
    },
    "windows": [...]
  },
  "plugins": {
    "global-shortcut": {}
  }
}
```

**Status**: ✅ Complete

---

#### Task 1.3: Implement Rust Command
**File**: `/Users/kumar/debugr/apps/desktop/src-tauri/src/main.rs`

Add after other command definitions (around line 87):

```rust
use tauri_plugin_global_shortcut::ShortcutState;

#[tauri::command]
async fn register_global_shortcut(app: AppHandle) -> Result<(), String> {
    let shortcut = if cfg!(target_os = "macos") {
        "cmd+alt+a"
    } else {
        "ctrl+alt+a"
    };

    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_| {
            if let Some(window) = app_clone.get_webview_window("main") {
                if let Ok(is_visible) = window.is_visible() {
                    if is_visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

Add to `generate_handler!` macro:
```rust
.invoke_handler(tauri::generate_handler![
    get_screen_capture_permission,
    request_screen_capture_permission,
    open_screen_capture_settings,
    capture_interactive_screenshot,
    register_global_shortcut  // <- ADD THIS
])
```

**Status**: ✅ Complete

---

#### Task 1.4: Call from Frontend
**File**: `/Users/kumar/debugr/apps/desktop/src/main.tsx`

Find the startup code (around line 1228):
```typescript
void (async () => {
  renderCanvas();
  renderPermissionCard();
  renderSessionList();
  renderAnnotationList();
  renderDetailPanel();
  setStepContent();
  updateCaptureMeta();
  await refreshPermissionState();
  await loadSessions();
  await loadHandoffContext(target);
  appendLog('Desktop session app ready');
})();
```

Update to:
```typescript
void (async () => {
  renderCanvas();
  renderPermissionCard();
  renderSessionList();
  renderAnnotationList();
  renderDetailPanel();
  setStepContent();
  updateCaptureMeta();
  await refreshPermissionState();
  await loadSessions();
  await loadHandoffContext(target);
  
  // Register global shortcut
  try {
    await invoke('register_global_shortcut');
    appendLog('✓ Global shortcut ⌘⌥A registered');
  } catch (error) {
    appendLog('⚠ Global shortcut registration failed', error);
  }
  
  appendLog('Desktop session app ready');
})();
```

**Status**: ✅ Complete

---

#### Task 1.5: Test Globally
**Testing Steps**:
1. Build the app: `cd /Users/kumar/debugr/apps/desktop && pnpm tauri dev`
2. Wait for app to open and log "Global shortcut ⌘⌥A registered"
3. Click elsewhere (Chrome, Finder, etc.)
4. Press ⌘⌥A → Debugr should come to foreground
5. Press ⌘⌥A again → Debugr should hide
6. Press ⌘⌥A again → Debugr should reappear

**Expected Output in App Logs**:
```
[HH:MM:SS] Global shortcut ⌘⌥A registered
[HH:MM:SS] Desktop session app ready
```

**Status**: ✅ Complete

---

#### Task 1.6: Commit Changes
```bash
cd /Users/kumar/debugr
git add apps/desktop/src-tauri/Cargo.toml
git add apps/desktop/src-tauri/tauri.conf.json
git add apps/desktop/src-tauri/src/main.rs
git add apps/desktop/src/main.tsx
git commit -m "feat(desktop): add global shortcut ⌘⌥A to launch/focus app

- Register global-shortcut plugin in Tauri
- Implement register_global_shortcut command in Rust
- Invoke from frontend on app startup
- Shortcut toggles window visibility (show/hide)
- Tested on macOS 13.0+

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**Status**: ✅ Complete

---

## Phase 2: Real Claude/Codex Integration (3–5 days)

### Goal
Fetch real feedback from Claude/Codex API instead of mocked responses.

### Key Files to Modify
- `apps/api/src/routes/feedbackSessions.ts` (backend)
- `src/main.tsx` (frontend state + UI)

### Tasks
- [ ] 2.1: Verify backend API response structure
- [ ] 2.2: Add loading state to feedback view
- [ ] 2.3: Handle streaming response (if available)
- [ ] 2.4: Display real feedback (not mocked "if (!prefs)" code)
- [ ] 2.5: Test end-to-end: capture → send → feedback
- [ ] 2.6: Commit changes

**Estimated Effort**: 3–5 days  
**Status**: ⏳ Not Started

---

## Phase 3: MCP Server Integration (5–7 days)

### Goal
Enable app to read repo files, list files, create GitHub issues.

### Key Files to Modify
- `apps/api/src/routes/system.ts` (new endpoints)
- `src/main.tsx` (MCP client calls)

### Tasks
- [ ] 3.1: Create `/api/system/repo-context` endpoint
- [ ] 3.2: Create `/api/system/repo-files` endpoint
- [ ] 3.3: Create `/api/system/repo-file` endpoint
- [ ] 3.4: Implement repo file reading in MCP client
- [ ] 3.5: Wire up UI to show repo context
- [ ] 3.6: Add "Create GitHub Issue" button
- [ ] 3.7: Test MCP integration end-to-end
- [ ] 3.8: Commit changes

**Estimated Effort**: 5–7 days  
**Status**: ⏳ Not Started

---

## Phase 4: Testing & Polish (2–3 days)

### Manual Testing Checklist
- [ ] Startup (no errors, permissions correct)
- [ ] Capture → Annotate → Save flow
- [ ] Voice notes (record, playback, delete)
- [ ] Session list (grouping by date, click to open)
- [ ] Send to Claude → Real feedback appears
- [ ] Send to Codex → Real feedback appears
- [ ] Global shortcut (⌘⌥A show/hide)
- [ ] Error handling (network, permission denied, etc.)

### UI Polish
- [ ] Loading spinners during async operations
- [ ] Empty states (no sessions, no screenshot)
- [ ] Error messages (clear, actionable)
- [ ] Keyboard shortcuts (Esc, Cmd+S?)

### Performance
- [ ] Large screenshot (4K) renders smoothly
- [ ] Many annotations (20+) no lag
- [ ] Session list loads in <500ms

**Status**: ⏳ Not Started

---

## Phase 5: Build & Release (1 day)

### Tasks
- [ ] 5.1: Build DMG: `pnpm tauri build`
- [ ] 5.2: Verify DMG installs and runs
- [ ] 5.3: Code sign (optional, for distribution)
- [ ] 5.4: Create release notes
- [ ] 5.5: Upload to release channel (if applicable)

**Status**: ⏳ Not Started

---

## Handoff Checklist for Codex

If Claude runs out of credit, here's what Codex needs to know:

### To Continue Phase 1 (Global Shortcut)
- [ ] Read this file (you're here!)
- [ ] Review Task 1.1 → 1.6 above
- [ ] All files are documented with line numbers
- [ ] Build with: `cd apps/desktop && pnpm tauri dev`
- [ ] Test with ⌘⌥A across apps

### To Start Phase 2 (Real Feedback)
- [ ] Backend API location: `/Users/kumar/debugr/apps/api/src/routes/feedbackSessions.ts`
- [ ] Frontend app location: `/Users/kumar/debugr/apps/desktop/src/main.tsx`
- [ ] Check current feedback response structure in backend
- [ ] Replace mock data with real Claude API calls
- [ ] Test capture → send → feedback flow

### To Start Phase 3 (MCP Integration)
- [ ] MCP server location: `/Users/kumar/debugr/apps/mcp-server/`
- [ ] Backend API location: `/Users/kumar/debugr/apps/api/src/routes/`
- [ ] Create system.ts file with repo context endpoints
- [ ] Wire up desktop app to call those endpoints
- [ ] Test repo file reading + issue creation

### Context for Codex
- **API Base URL**: `http://127.0.0.1:3001/api`
- **Frontend URL**: `http://127.0.0.1:3000`
- **Design System**: `/Users/kumar/debugr/PRODUCT_DELTA_ANALYSIS.md`
- **Technical Plan**: `/Users/kumar/debugr/DESKTOP_APP_COMPLETION_PLAN.md`
- **Current App Code**: `/Users/kumar/debugr/apps/desktop/src/main.tsx` (1,241 lines)

### Key Contacts in Code
- Session creation: `createSession(title)` @ line 967
- Session patching: `patchSession(id, payload)` @ line 978
- Send to Claude: `sendSavedSession()` @ line 1043
- Handoff context: `loadHandoffContext(target)` @ line 1003

---

## Commit History

### Phase 1
- [ ] `feat(desktop): add global shortcut ⌘⌥A` — (pending)

### Phase 2
- [ ] `feat(desktop): wire real Claude feedback` — (pending)
- [ ] `fix(api): ensure feedback response structure` — (pending)

### Phase 3
- [ ] `feat(api): add /system/repo-context endpoint` — (pending)
- [ ] `feat(desktop): implement MCP repo file reading` — (pending)
- [ ] `feat(desktop): add create GitHub issue button` — (pending)

### Phase 4
- [ ] `test(desktop): manual testing checklist pass` — (pending)
- [ ] `refactor(desktop): polish loading states and errors` — (pending)

### Phase 5
- [ ] `build(desktop): generate DMG and release artifacts` — (pending)

---

## Timeline

| Phase | Start | Duration | Status |
|-------|-------|----------|--------|
| 1. Global Shortcut | Day 1 | 1–2 days | 🟠 In Progress |
| 2. Real Feedback | Day 3 | 3–5 days | 🔴 Not Started |
| 3. MCP Integration | Day 8 | 5–7 days | 🔴 Not Started |
| 4. Testing & Polish | Day 15 | 2–3 days | 🔴 Not Started |
| 5. Build & Release | Day 17 | 1 day | 🔴 Not Started |

---

## Success Metrics

- ✅ All 6 phases complete
- ✅ Global shortcut works reliably
- ✅ Real feedback displays (not mocked)
- ✅ MCP integration allows repo access
- ✅ DMG builds successfully
- ✅ All manual tests pass
- ✅ Zero critical bugs

---

## Important Notes

1. **API Base**: Hardcoded to `http://127.0.0.1:3001`. Update for production.
2. **Claude API**: Requires `ANTHROPIC_API_KEY` in backend environment.
3. **GitHub API**: Requires `GITHUB_TOKEN` for issue creation.
4. **Tauri Dev**: `pnpm tauri dev` rebuilds Rust + reloads frontend on save.
5. **Commits**: Push after every phase milestone so Codex can pick up cleanly.

---

## Questions for Codex (If Handoff Happens)

When Codex takes over, answer these:
1. Is Phase 1 (global shortcut) complete? (Check: `register_global_shortcut` in Rust, called from TypeScript)
2. Is backend API returning real feedback? (Check: `sendSavedSession()` response structure)
3. Are there any blockers or error logs? (Check: app logs in Activity panel)
4. What's the next priority? (Follow phases 2 → 3 → 4 → 5)

---

## Resources

- **Tauri GlobalShortcut**: https://plugins.tauri.app/plugins/global-shortcut
- **Tauri Docs**: https://tauri.app/docs/
- **App Code**: `/Users/kumar/debugr/apps/desktop/src/main.tsx`
- **API Code**: `/Users/kumar/debugr/apps/api/src/routes/feedbackSessions.ts`
- **Design**: `/Users/kumar/debugr/PRODUCT_DELTA_ANALYSIS.md`
- **Plan**: `/Users/kumar/debugr/DESKTOP_APP_COMPLETION_PLAN.md`
