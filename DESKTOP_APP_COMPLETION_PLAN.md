# Desktop App Completion Plan

**Goal**: Take the existing Tauri app from ~70% complete to production-ready by:
1. Adding global shortcut support (⌘⌥A to launch/focus)
2. Wiring real Claude/Codex feedback
3. Implementing MCP server for repo context
4. End-to-end testing of the capture → feedback flow

**Estimated effort**: 2–3 weeks

---

## Phase 1: Global Shortcut Integration (1–2 days)

### Current State
- App must be explicitly launched
- User opens via Finder or CLI
- No way to trigger from keyboard

### Goal
- ⌘⌥A opens Debugr (or focuses if already open)
- Works while any other app is active
- Matches design spec

### Implementation

**Step 1: Add Tauri GlobalShortcut Plugin**

```bash
cd /Users/kumar/debugr/apps/desktop
cargo add tauri-plugin-global-shortcut
```

**Step 2: Update `src-tauri/tauri.conf.json`**

```json
{
  "plugins": {
    "global-shortcut": {
      "enable": true
    }
  }
}
```

**Step 3: Add Rust Command** (`src-tauri/src/lib.rs`)

```rust
use tauri_plugin_global_shortcut::ShortcutState;
use tauri::{AppHandle, Wry};

#[tauri::command]
pub fn register_global_shortcut(app: AppHandle<Wry>) -> Result<(), String> {
    let shortcut = if cfg!(target_os = "macos") {
        "cmd+alt+a"
    } else {
        "ctrl+alt+a"
    };

    app.plugin(tauri_plugin_global_shortcut::init())
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_| {
            if let Some(window) = app_clone.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
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

**Step 4: Call from Frontend** (`src/main.tsx`)

```typescript
const { invoke } = await import('@tauri-apps/api/core');

void (async () => {
  // ... existing init code ...
  await invoke('register_global_shortcut').catch(err => {
    console.error('Failed to register global shortcut:', err);
    appendLog('Global shortcut registration failed');
  });
})();
```

### Testing
- Launch app
- Click Debugr window → minimize it
- Press ⌘⌥A → should reappear and focus
- Open another app (e.g., Chrome)
- Press ⌘⌥A → Debugr should come to foreground

**Files to Modify**:
- `src-tauri/Cargo.toml` (add dependency)
- `src-tauri/tauri.conf.json` (plugin config)
- `src-tauri/src/lib.rs` or `src-tauri/src/main.rs` (register shortcut)
- `src/main.tsx` (invoke on startup)

---

## Phase 2: Real Claude/Codex Integration (3–5 days)

### Current State
- `sendSavedSession()` function makes API call to `/api/feedback-sessions/{id}/send-to-claude`
- Backend returns mock `agentFeedback` object
- Frontend displays hardcoded suggestion: `if (!prefs) return <SetupWizard />`

### Goal
- Fetch real Claude/Codex response
- Stream or display actual feedback
- Link task back to session

### Implementation

**Step 1: Verify API Contract** (`/Users/kumar/debugr/apps/api/src/routes/feedbackSessions.ts`)

Check what `POST /api/feedback-sessions/{id}/send-to-claude` actually returns.

Expected response:
```json
{
  "data": {
    "task_id": "task_12345",
    "feedback_id": "feedback_67890",
    "message": "...",
    "agent_feedback": {
      "title": "Setup crash root cause",
      "summary": "The optional setup path crashes when preferences are missing.",
      "next_steps": [
        "Guard the preferences object before rendering",
        "Add unit tests for optional setup path"
      ]
    }
  }
}
```

If the backend returns different structure, update `SubmissionResult` interface in `main.tsx`.

**Step 2: Fetch Real Feedback**

Update `sendSavedSession()` to handle streaming (if Claude API supports it):

```typescript
async function sendSavedSession() {
  if (!currentSessionId) {
    setStatus('Save the capture first.');
    return;
  }

  try {
    const payload = buildCapturePayload();
    await patchSession(currentSessionId, payload);

    // Show loading state
    viewMode = 'feedback';
    submissionResult = {
      sessionId: currentSessionId,
      taskId: 'pending',
      feedbackId: 'pending',
      target,
      message: `Sending to ${getTargetLabel(target)}...`,
    };
    renderDetailPanel();
    setStatus(`Sending to ${getTargetLabel(target)}...`);

    // Send and wait for response
    const sendRes = await fetch(`${API_BASE}/feedback-sessions/${currentSessionId}/send-to-claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });

    if (!sendRes.ok) {
      throw new Error(await sendRes.text());
    }

    const json = await sendRes.json();
    submissionResult = {
      sessionId: currentSessionId,
      taskId: json.data.task_id,
      feedbackId: json.data.feedback_id,
      target,
      message: json.data.message,
      agentFeedback: json.data.agent_feedback,
    };

    renderDetailPanel();
    setStatus(`Feedback received from ${getTargetLabel(target)}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to send session.');
    submissionResult = null;
    renderDetailPanel();
  }
}
```

**Step 3: Verify Backend Implementation**

Check `/Users/kumar/debugr/apps/api/src/routes/feedbackSessions.ts`:

The `send-to-claude` endpoint should:
1. Create an `ImprovementTask` in DB
2. Call Claude API (or MCP) with session context
3. Return feedback with `task_id` + `feedback_id`

If it returns mock data, wire it up to the real Claude API:

```typescript
// Example (pseudocode)
const claudeResponse = await callClaude({
  systemPrompt: 'You are a code reviewer...',
  userMessage: sessionContext,
  sessionId: id,
});

return {
  task_id: task.id,
  feedback_id: feedback.id,
  message: claudeResponse.text,
  agent_feedback: parseAgentFeedback(claudeResponse),
};
```

### Testing
- Create a capture with annotations
- Click "Send to Claude"
- Verify response appears (not mock)
- Click "Open Summary" → should navigate to web dashboard with feedback

**Files to Modify**:
- `src/main.tsx` (update `sendSavedSession()`)
- `apps/api/src/routes/feedbackSessions.ts` (if backend returns mock)

---

## Phase 3: MCP Server Integration (5–7 days)

### Current State
- Desktop app can capture and annotate
- Backend has MCP server (`apps/mcp-server`) with repo tools
- No connection between them

### Goal
- Desktop app acts as MCP **client** (calls backend MCP server)
- Can read repo files, list files, create GitHub issues
- MCP server calls Claude/Codex with rich context

### Implementation

**Step 1: Add MCP Client to Backend**

Already exists in `/Users/kumar/debugr/apps/api/src/routes/`. Verify it can:
- Call FeedbackAgent MCP server
- Call GitHub MCP server (optional, if implementing issue creation)

**Step 2: Extend API Endpoints** (in `apps/api`)

Add new endpoints that the desktop app can call:

```typescript
// GET /api/system/repo-context
// Returns: { repoUrl, repoBranch, files[], canCreatePR }

// GET /api/system/repo-files?path=src/
// Returns: { files: [{name, type, path}] }

// POST /api/system/repo-file?path=src/app.tsx
// Returns: { contents, language }

// POST /api/system/create-github-issue
// Body: { title, body, labels }
// Returns: { issueUrl, issueNumber }
```

**Step 3: Update Desktop App** (`src/main.tsx`)

Add functions to call new endpoints:

```typescript
async function loadRepoContext(nextTarget: Target) {
  const res = await fetch(`${API_BASE}/system/repo-context?target=${nextTarget}`);
  if (!res.ok) throw new Error('Failed to load repo context');
  return await res.json();
}

async function createGitHubIssueFromSession(sessionId: string) {
  const res = await fetch(`${API_BASE}/feedback-sessions/${sessionId}/create-github-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to create issue');
  return await res.json();
}
```

**Step 4: Wire Into UI**

In the "saved" view (step 5), add:
- Repo context badge (shows linked repo)
- "Create GitHub Issue" button (if allowed)
- Link to repo files (if available)

**Step 5: Test End-to-End**

1. Open desktop app
2. Capture screenshot
3. Add annotations
4. Save session
5. See repo context (owner/repo/branch)
6. Send to Claude
7. Verify Claude feedback includes repo files (via MCP)
8. Click "Create GitHub Issue" → issue created in real repo

**Files to Modify**:
- `apps/api/src/routes/system.ts` (add new endpoints)
- `src/main.tsx` (add MCP client functions)
- `src/main.tsx` (update detail panel to show repo actions)

---

## Phase 4: Polish & Testing (2–3 days)

### Testing Checklist

- [ ] **Startup**: App launches, permission card shows correct state
- [ ] **Capture**: Click "Start Capture" → macOS screenshot tool opens → import screenshot
- [ ] **Annotate**: Drag on screenshot → box appears → numbered label shows
- [ ] **Notes**: Add typed note to box → appears in annotations list
- [ ] **Voice**: Record voice note → plays back → duration shows
- [ ] **Save**: Click "Save Capture" → appears in session list, viewMode changes to 'saved'
- [ ] **Select Target**: Toggle Claude/Codex → handoff context loads
- [ ] **Send**: Click "Send to Claude" → feedback appears (not mocked)
- [ ] **View Feedback**: Feedback displays with title + summary + next steps
- [ ] **Open Summary**: Click "Open Summary" → navigates to web dashboard
- [ ] **Global Shortcut**: Press ⌘⌥A → app opens/focuses
- [ ] **New Capture**: Click "New Capture" → state clears, ready for next session
- [ ] **Session List**: Sessions grouped by date, clicking opens in web dashboard
- [ ] **Repo Context**: Repo name/branch displays, "Create Issue" button available (if MCP integrated)
- [ ] **Permissions**: Deny screen capture → permission card shows "Grant" button
- [ ] **Error Handling**: Network timeout → clear error message, retry possible

### UI Polish
- [ ] Dark mode support (optional, but design spec is light-only for now)
- [ ] Loading states (spinners, disabled buttons)
- [ ] Empty states (no sessions, no screenshot, no captures)
- [ ] Responsive canvas (large screenshots, zoom/pan if needed)
- [ ] Keyboard shortcuts (Esc to cancel, Cmd+S to save?)

### Performance
- [ ] Large screenshot (4K) → canvas renders smoothly
- [ ] Many boxes (20+) → rendering fast, no lag
- [ ] Audio recording → no stutter, accurate duration
- [ ] Session list → loads in <500ms

**Files to Review**:
- `src/main.tsx` (main app logic)
- `src/index.css` (styling, responsive design)
- `src-tauri/src/lib.rs` (Rust commands, error handling)

---

## Phase 5: Build & Distribute (1 day)

### Build DMG

```bash
cd /Users/kumar/debugr/apps/desktop
pnpm install
pnpm tauri build
```

Outputs to: `src-tauri/target/release/bundle/dmg/debugr.ai_0.0.1_x64.dmg`

### Sign & Notarize (if shipping to beta)

```bash
# Requires Apple Developer certificate
codesign -s "Developer ID Application" debugr.app
xcrun notarytool submit debugr.dmg --apple-id <email> --password <app-password> --team-id <team-id>
```

### Release Notes

```markdown
# Debugr 0.0.1 (Initial Release)

## New
- Native macOS app (Tauri)
- Screenshot capture (native tool integration)
- Canvas-based annotations (drag-to-create boxes)
- Voice note recording (optional context)
- Session management (save, view history)
- Claude & Codex integration (send for feedback)
- Global keyboard shortcut (⌘⌥A)

## Known Limitations
- macOS only (Intel + Apple Silicon)
- Requires local API server (http://127.0.0.1:3001)
- No offline mode yet

## System Requirements
- macOS 13.0+
- Microphone (for voice notes, optional)
- 100MB disk space
```

---

## File Checklist

| File | Purpose | Status | Priority |
|------|---------|--------|----------|
| `src-tauri/src/lib.rs` | Rust backend (screenshot, perms, shortcuts) | Needs review | P0 |
| `src/main.tsx` | Main app logic (states, flows, API calls) | Needs enhancement | P0 |
| `src/index.css` | Styling | Mostly done | P2 |
| `src-tauri/tauri.conf.json` | Tauri config (permissions, DMG) | Needs polish | P1 |
| `apps/api/src/routes/feedbackSessions.ts` | Backend API | Needs real Claude wiring | P0 |
| `apps/api/src/routes/system.ts` | System endpoints (repo context, etc.) | Needs creation | P1 |

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Global shortcut doesn't work | High | Test on clean macOS, check plugin docs |
| Screen capture permission denied | Medium | Clear messaging + link to System Settings |
| Large screenshot kills performance | Medium | Lazy-load canvas, implement zoom/pan |
| Claude API timeout | Medium | Show loading state, allow retry |
| Session sync (web ↔ desktop) | Low | Use session IDs, assume stateless API |

---

## Success Criteria

- [ ] App launches without errors
- [ ] Global shortcut (⌘⌥A) works reliably
- [ ] Capture → Annotate → Send → Feedback flow is end-to-end functional
- [ ] Real Claude/Codex feedback displays (not mocked)
- [ ] All manual tests pass
- [ ] DMG builds successfully
- [ ] Signed & notarized (if shipping)

---

## Timeline

| Phase | Effort | Start | End | Owner |
|-------|--------|-------|-----|-------|
| 1. Global Shortcut | 1–2 days | Week 1 Mon | Week 1 Tue | Backend/Rust |
| 2. Real Feedback | 3–5 days | Week 1 Wed | Week 2 Fri | API/Frontend |
| 3. MCP Integration | 5–7 days | Week 3 Mon | Week 4 Fri | API/MCP |
| 4. Testing & Polish | 2–3 days | Week 5 Mon | Week 5 Wed | QA/Frontend |
| 5. Build & Release | 1 day | Week 5 Thu | Week 5 Fri | DevOps |
| **Total** | **12–18 days** | | | |

---

## Next Immediate Actions

1. **Review `src-tauri/src/lib.rs`** to understand current Rust commands
2. **Add GlobalShortcut plugin** to Cargo.toml
3. **Implement `register_global_shortcut` command** (Rust)
4. **Test ⌘⌥A shortcut** locally
5. **Verify backend API** returns real feedback (not mocked)
6. **Wire up desktop app to use real response**
7. **Test capture → feedback flow end-to-end**
8. **Create GitHub issue creation endpoint** (if time permits)

---

## Reference Docs

- Tauri GlobalShortcut: https://plugins.tauri.app/plugins/global-shortcut
- Tauri Screen Capture: https://tauri.app/docs/features/screenshot/
- Tauri Config: https://tauri.app/docs/api/config/
- ClaudeAI API: https://anthropic.com/api (requires Anthropic API key)
