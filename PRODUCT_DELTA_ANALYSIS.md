# Debugr Product: Design Handoff vs. Actual Implementation

**Date**: April 28, 2026
**Analysis**: Delta between `/Users/kumar/Downloads/debugr_annotation_ux_handoff/` (design) and `/Users/kumar/debugr/apps/desktop/` (actual Tauri app)

---

## Executive Summary

✅ **The desktop app EXISTS** and is substantially complete — it's a fully functional Tauri app, not a stub.

❌ **The design handoff is a marketing/onboarding narrative** — a 6-step flow showing the macOS desktop experience, but it's **not what the current product does**.

**Key finding**: The actual product has shifted from "macOS annotation overlay HUD" (what the design shows) to a **dedicated desktop app with a 2-pane capture + annotation interface**. This is a **significant UX pivot**.

---

## 1. Design Handoff Overview (What Was Specified)

**Source**: `/Users/kumar/Downloads/debugr_annotation_ux_handoff/`

### The 6-Step Flow (from handoff):

1. **Launch Debugr once** → App arms global shortcut (⌘⌥A), then background mode
2. **App runs in menu bar** → Popover shows ready status + recent sessions
3. **Shortcut opens annotation HUD** → Floating overlay with toolbar (select, pin, text, arrow, blur, save)
4. **Click to annotate** → Numbered pins on clicked elements, note cards appear in situ
5. **Save session timeline** → Sidebar with sessions + capture list
6. **Send to Claude/Codex** → Bundle + AI response

### Visual Style (from design-system.md):
- White + light blue surfaces
- Rounded macOS windows
- Numbered blue pins (annotation markers)
- Floating glass toolbar for annotation mode
- Minimal shadows, crisp borders
- Green for saved/synced, Orange for Claude, Dark for Codex

### Key Concept:
**Background-first, global shortcut overlay**. User launches once, uses shortcut to annotate any screen (browser, app, etc.).

---

## 2. Actual Desktop App (Tauri Implementation)

**Source**: `/Users/kumar/debugr/apps/desktop/`

### Architecture:
- **Tauri 2.0** + React (TypeScript)
- **Vite** for bundling
- **Builds to DMG** (macOS only for now)
- **Communicates with API** at `http://127.0.0.1:3001` (local dev server)

### Actual UX Flow:

**Step 1: Launch App** → Opens a dedicated desktop window (1320×920)

**Step 2: Capture Stage (Left Pane)**
- "Start Capture" button → Opens native macOS screenshot tool (via Tauri `capture_interactive_screenshot` Rust command)
- OR "Import Image" → File picker for existing screenshots
- Canvas displays the screenshot
- User drags to create numbered boxes (capture areas)
- Each box can have typed notes

**Step 3: Annotation Detail (Right Pane)**
- Preview of the screenshot
- Title input (e.g., "Onboarding flow bug")
- Session notes textarea
- Voice note recording (optional, captures microphone audio)
- Context toggles: Console logs, Network logs, Environment info
- Capture state checklist

**Step 4: Save Capture** → Creates a session on the backend
- Timestamp, boxes, notes, audio all bundled
- Viewable in session list (left sidebar)

**Step 5: Choose Target** → Claude or Codex
- Select which AI agent to send to
- Choose context to include
- "Send to Claude/Codex" button

**Step 6: View Feedback** → App displays AI response
- Agent feedback + suggested fix + next steps
- "Open Summary" button → Links to web dashboard
- "New Capture" → Start over

### Key Implementation Details:

**Sidebar (Left)**:
- Brand lockup: "D" mark + "Debugr" + "Capture. Share. Improve."
- "+ New Capture" button
- Session list (grouped by Today/Yesterday/Date)
- Permission card (screen capture access status)

**Main Grid (Top)**:
- Topbar with step number, title, copy, status pill
- Canvas card (screenshot + annotation)
- Detail card (preview + form)

**Bottom Grid**:
- Annotations list (numbered selections + note inputs)
- Activity log (timestamped actions)

**State Management**:
- `viewMode`: 'capture', 'review', 'saved', 'feedback'
- `boxes`: Array of {id, x, y, width, height, notes}
- `audioNote`: Stores microphone recording as data URL
- `handoffContext`: Repo info + target (Claude/Codex)

---

## 3. Major Deltas (Design vs. Reality)

| Aspect | Design (Handoff) | Actual (Desktop App) | Delta |
|--------|------------------|----------------------|-------|
| **Interaction Model** | Global shortcut overlay (⌘⌥A) | Dedicated app window | ⚠️ MAJOR CHANGE |
| **Annotation Trigger** | Right-click on page, click element | Manual drag on screenshot canvas | ⚠️ WORKFLOW PIVOT |
| **Where User Works** | "Over any screen" (browser, app, OS) | In a dedicated Debugr window only | 🔴 SIGNIFICANT UX SHIFT |
| **Annotation Type** | Click-based pins on live UI elements | Drag-to-create numbered boxes | Different metaphor |
| **Capture Method** | User's current screen (automatic) | Explicit screenshot or file import | Requires extra step |
| **Voice Notes** | Not mentioned in design | Fully implemented (MediaRecorder API) | ✅ ADDITION |
| **Session Management** | Menu bar popover | Left sidebar in main window | ✅ REDESIGNED |
| **Feedback Display** | Suggested fix in modal | "Open Summary" → navigate to web | Defers to web app |
| **Platform** | macOS (annotation HUD) | macOS desktop app (can extend to Windows/Linux) | Cross-platform ready |
| **Global Keyboard Access** | Central (⌘⌥A anytime) | Launch app, then work inside | 🔴 NOT GLOBAL |
| **CSS Design System** | Matches handoff tokens (blue, green, etc.) | Same tokens, applied to app UI | ✅ CONSISTENT |

---

## 4. Why the Shift Happened

**Hypothesis (based on code inspection)**:

1. **Annotation HUD complexity**: Creating a floating overlay that works across all macOS apps (browser, IDE, OS windows) is hard. Tauri doesn't have a built-in global overlay API. Would require:
   - Custom Rust code to capture floating windows
   - Handling z-order / always-on-top
   - Click-through to underlying windows (tricky)

2. **Dedicated App UX**: Simpler and more reliable:
   - User explicitly opens Debugr
   - Captures screenshot (native macOS tool)
   - Annotates in a controlled environment
   - Sends when ready

3. **Voice notes**: The app added audio recording (not in design). This suggests the team discovered that typing notes isn't always enough — verbal context is valuable.

4. **Desktop-first** (not web-first): The handoff was for a web-based bookmarklet or extension. The team built a **native desktop app** instead, which is more performant and has access to system APIs (screen capture, microphone, permissions).

---

## 5. What's Missing from Design → Now in App

✅ **Implemented & Better**:
- Native screenshot tool (higher quality, permission-aware)
- Audio recording (verbal context)
- Permission gating (macOS screen capture access)
- Session grouping by date
- Activity log (timestamped actions)
- Context toggles (logs, network, environment)

❌ **In Design but NOT in App**:
- Global keyboard shortcut (⌘⌥A) — no longer works; app must be open
- Right-click context menu — replaced by dedicated app
- Floating overlay — replaced by dedicated window
- Pins on live UI elements — replaced by manual drag-to-box

---

## 6. Current Gaps (App vs. Full Vision)

### What's NOT Implemented Yet

1. **Global Shortcut Integration**
   - Design shows ⌘⌥A working anytime
   - App requires explicit launch
   - Would need Tauri `GlobalShortcut` plugin to reopen app

2. **Web Dashboard Integration**
   - App has UI but "Open Summary" navigates away
   - Session list links to web dashboard at `http://127.0.0.1:3000`
   - No deep linking back to app context

3. **Real Feedback Loop**
   - `agentFeedback` object is mocked in code (see `renderFeedbackConversation()`)
   - Actual API response from Claude/Codex not fully integrated
   - Suggested fix shows dummy code: `if (!prefs) return <SetupWizard />`

4. **MCP Server Integration**
   - No MCP client in desktop app
   - Cannot read repo files, create GitHub issues, etc.
   - Web app has bookmarklet + API, but desktop app doesn't replicate that

5. **Cross-Platform Testing**
   - Only `dmg` bundle target (macOS)
   - No Windows/Linux builds configured
   - Tauri supports them, but not enabled

---

## 7. Recommendations

### **Option A: Ship Current App** (Fastest Path)
1. **Add global shortcut** (`GlobalShortcut` plugin) to reopen/focus app
2. **Wire up real Claude/Codex feedback** (integrate with MCP or API)
3. **Build MCP server in desktop app** for repo context
4. **Test & ship DMG** for beta

**Timeline**: 2–3 weeks

---

### **Option B: Implement Handoff Design** (More Ambitious)
1. **Build floating HUD overlay** (custom Rust + WebView)
2. **Keep web bookmarklet** (current state) for lower-barrier entry
3. **Implement click-based annotations** on live UI
4. **Sync between web + desktop** (MCP + IPC)

**Timeline**: 4–6 weeks, significantly more complex

---

### **Option C: Hybrid** (Recommended)
1. **Keep the desktop app as primary** (it's better UX for detailed annotations)
2. **Add global shortcut** to launch it
3. **Enhance web bookmarklet** (copy-to-clipboard + manual creation, as you've already started)
4. **Make both feed into the same session backend** (already does via API)

**Timeline**: 2–3 weeks

---

## 8. File Structure Comparison

### Design (Handoff):
```
debugr_annotation_ux_handoff/
├── README.md (product spec)
├── index.html (6-step visual flow)
├── styles.css (design system)
└── design-system.md (component specs)
```

### Actual (Desktop App):
```
apps/desktop/
├── src/
│   ├── main.tsx (1241 lines, full app logic)
│   └── index.css (~500+ lines, styled system)
├── src-tauri/
│   ├── tauri.conf.json (DMG config)
│   └── src/ (Rust commands)
├── vite.config.ts (bundler config)
└── package.json (Tauri + Vite dependencies)
```

---

## 9. Summary Table

| Metric | Design | Actual |
|--------|--------|--------|
| **App Type** | Web bookmarklet + HUD overlay | Native Tauri desktop app |
| **Launch Method** | Global shortcut (⌘⌥A) | Explicit app open |
| **Annotation Method** | Click on UI elements | Drag on screenshot |
| **Where You Work** | Over any screen | Inside dedicated window |
| **Voice Notes** | Not mentioned | Fully supported |
| **Session Management** | Menu bar popover | Sidebar in app |
| **Lines of Code** | Design spec only | 1241 lines (main.tsx) + Rust |
| **Completion** | ~30% (design only) | ~70% (functional, needs feedback loop) |
| **Ready to Ship?** | No (never built) | 80% (needs global shortcut + real feedback) |

---

## 10. Next Steps (Recommended)

### Immediate (This Sprint)
- [ ] Add `GlobalShortcut` plugin to desktop app
- [ ] Trigger app open/focus on ⌘⌥A
- [ ] Wire up real Claude/Codex API calls (not mocked)
- [ ] Test session → feedback → summary flow end-to-end

### Short Term (Next Sprint)
- [ ] Implement MCP server in desktop app for repo context
- [ ] Add GitHub issue creation from annotations
- [ ] Polish detail panel UI (voice player, context options)

### Medium Term
- [ ] Decide: Keep web bookmarklet or deprecate it?
- [ ] If keeping: Make it a fallback for non-macOS users
- [ ] Build session sync between web + desktop
- [ ] Enable Windows/Linux builds

---

## 11. Conclusion

**You already have a desktop app.** It's not what the handoff showed, but it's arguably better:
- ✅ Native performance (Tauri)
- ✅ System integration (microphone, screenshot permissions)
- ✅ Rich UI (canvas-based annotations)
- ✅ Voice notes (added bonus)
- ✅ Structured session management

**The handoff was a UI/UX spec for a different product** (floating overlay annotation). The desktop app pivoted to a **dedicated, focused interface** — a valid choice, though it loses the "works over any screen" magic.

**Recommendation**: Ship the desktop app with:
1. Global shortcut support (get back that ⌘⌥A magic)
2. Real feedback integration (wire up Claude/Codex)
3. MCP server (add repo context)

This will give you a **product parity with the design vision** in a simpler, more maintainable way.
