# V3 Week 2: Annotation Editor — Complete

## What Was Built

### 1. **Annotation Editor Page** (`/apps/web/src/app/sessions/[id]/annotate/page.tsx`)
A full-featured canvas-based annotation interface with:

**Core Features:**
- Canvas rendering with live video frame display
- Draw bounding boxes on video frames
- Color picker (7 colors: red, orange, yellow, green, blue, purple, pink)
- Text descriptions for each annotation
- Timestamp tracking (auto-captured from timeline position)

**Timeline Controls:**
- Video scrubber (range input) to seek through recording
- Play/Pause button
- ±5 second skip buttons
- Live frame extraction (canvas draws current video frame)
- Duration display (MM:SS / MM:SS)

**Annotation Management:**
- Add new annotations with box + description
- Edit existing annotations (click to select, modify, update)
- Delete annotations
- List view showing all annotations with:
  - Timestamp (in seconds)
  - Description text
  - Visual color indicator
  - Delete button

**Finalization:**
- "Finalize & Annotate" button (enabled only when 1+ annotations exist)
- Sends to `/feedback-sessions/{id}/finalize` with:
  - `durationMs`: total recording length
  - `cursorEvents`: array of annotation boxes converted to click events
- Changes session status to 'processing'
- Triggers worker to extract frames, generate transcript, summarize
- Stores annotations in sessionStorage temporarily
- Redirects to `/sessions/{id}` (task panel)

**UI/UX Details:**
- Dark canvas background (#1a1a1a) for contrast
- Dashed box drawing preview while dragging
- Annotation labels rendered over boxes with color-coded backgrounds
- Sidebar with drawing tools on right
- Main canvas area takes priority (67% width)
- Responsive grid layout

### 2. **Video Upload Endpoint** (`POST /feedback-sessions/upload`)
New API route in `feedbackSessions.ts`:
- Accepts FormData from recorder with: title, durationMs, video blob, screenshot count
- Creates draft FeedbackSession record
- Returns `{ data: { id: sessionId } }` to redirect recorder
- Sets visibility to 'private' by default
- Status: 'draft' (awaiting finalization)

### 3. **Recorder Type Fix**
Fixed TypeScript error in recorder's `getDisplayMedia()` call:
- `cursor: 'always'` is not in TypeScript's MediaTrackConstraints type definitions
- Applied `as any` type assertion (non-standard API but supported by browsers)

## Data Flow: Recording → Annotation → Task Creation

```
1. RECORDER (record/page.tsx)
   └─ User records screen + audio
   └─ Adds title
   └─ Clicks "Upload & Annotate"
   └─ POST /feedback-sessions/upload
       → Creates draft session
       → Returns sessionId
       → Redirects to /sessions/{sessionId}/annotate

2. ANNOTATION EDITOR (/sessions/[id]/annotate/page.tsx)
   └─ Loads session (fetches from GET /feedback-sessions/{id})
   └─ Displays video with timeline
   └─ User scrubs timeline (live canvas frame extraction)
   └─ User draws boxes on frames
   └─ User adds text descriptions
   └─ Annotations stored in React state
   └─ Clicks "Finalize & Continue"
   └─ POST /feedback-sessions/{id}/finalize
       → Converts annotations to cursorEvents
       → Changes status to 'processing'
       → Triggers worker
       → Stores annotations in sessionStorage
       → Redirects to /sessions/{id}

3. WORKER (async processing)
   └─ Extracts frames from video (placeholder)
   └─ Generates transcript from audio (future: Whisper API)
   └─ Summarizes via Claude AI
   └─ Extracts task brief
   └─ Updates session status to 'ready'

4. TASK PANEL (/sessions/[id]/page.tsx)
   └─ Displays session with summary
   └─ Shows frames extracted from video
   └─ "Send to Claude Code" button (MCP handoff)
   └─ Task creation and approval workflow

5. CLAUDE CODE (User's local machine)
   └─ Receives feedback via MCP: push_feedback_to_claude
   └─ Calls MCP: get_feedback_details
   └─ Generates code changes
   └─ Creates PR on GitHub
   └─ Calls MCP: register_completed_task
   └─ PR linked to feedback session

6. TASK STATUS: routed ✓
```

## Technical Details

### Canvas Drawing Mechanism
```typescript
// Draw flow:
1. User presses mouse down → setStartPos, setIsDrawing = true
2. User moves mouse → compute width/height, draw dashed preview
3. User releases mouse → setIsDrawing = false
4. User adds description → creates Annotation object
5. New annotations trigger redraw via useEffect dependency

// Redraw happens when:
- Annotations array changes
- Drawing box changes  
- Selected color changes
- Video time updates (live frame display)
- User scrubs timeline
```

### Annotation Data Structure
```typescript
interface Annotation {
  id: string;                // Unique ID (ann_{timestamp})
  x: number;                 // Canvas X (pixels)
  y: number;                 // Canvas Y (pixels)
  width: number;             // Box width (pixels)
  height: number;            // Box height (pixels)
  description: string;       // User's text
  timestamp: number;         // Video time (seconds)
  color: string;             // Hex color (#ef4444, etc)
}
```

### Video Frame Extraction
Canvas displays video frame via: `ctx.drawImage(videoRef.current, ...)`
- Happens in `redrawCanvas()` which is called on:
  - User scrubs timeline (onChange event)
  - Video plays (onTimeUpdate event)
  - Annotations change (useEffect)
- Falls back to dark canvas with "Video loading..." message if video not ready

## Files Created/Modified

**Created:**
- `/apps/web/src/app/sessions/[id]/annotate/page.tsx` (400 lines)

**Modified:**
- `/apps/api/src/routes/feedbackSessions.ts` (added upload endpoint)
- `/apps/web/src/app/record/page.tsx` (fixed TypeScript `cursor` type)

**Build Status:**
- Web app: ✓ Compiles successfully (5 routes)
- API app: ✓ Compiles successfully (8 endpoints)

## What's Next (Week 3)

1. **Video File Handling**
   - Store video blob on server (currently lost on page refresh)
   - Use multer + local storage or S3
   - Return videoUrl in session response

2. **Frame Extraction**
   - Worker extracts frames from WebM video at key timestamps
   - Uses FFmpeg or Canvas frame capture
   - Store frame images
   - Update FeedbackFrame records with imageUrl

3. **Transcript Generation**
   - Capture audio track from recording
   - Send to Whisper API (OpenAI) or similar
   - Generate transcript with timestamps
   - Store in session.transcript

4. **End-to-End Test**
   - Record feedback
   - Annotate with boxes
   - Finalize and observe:
     - Session status changes to 'processing' then 'ready'
     - AI summary appears
     - Task brief is generated
   - Send to Claude Code via MCP
   - Verify Claude can retrieve full feedback context

5. **Polish**
   - Handle video load errors gracefully
   - Add undo/redo for annotations
   - Keyboard shortcuts (delete, undo, etc.)
   - Mobile responsiveness testing

## Current State: Ready for Testing

The complete V3 Week 1→2 flow is now buildable and deployable:
- ✓ Record page: full MediaRecorder implementation
- ✓ Upload endpoint: creates draft session
- ✓ Annotation page: canvas drawing, timeline scrubbing, annotation management
- ✓ Finalize: converts annotations to events, triggers worker
- ✓ Type checking: all TypeScript errors resolved

Next: Test the flow end-to-end, then add video/frame/transcript processing in Week 3.
