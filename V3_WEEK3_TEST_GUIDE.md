# V3 Week 3: End-to-End Test Guide

## Setup

### 1. Start Development Servers

```bash
# Terminal 1: Web + API + Worker
pnpm dev
# This starts:
# - Web app on http://localhost:3000
# - API on http://localhost:3001
# - Worker on http://localhost:3002
```

### 2. Verify Services Are Running

```bash
# Check API health
curl http://localhost:3001/health
# Expected: {"ok":true}

# Check web dashboard
open http://localhost:3000
```

---

## End-to-End Test Flow

### Phase 1: Record Feedback

1. **Navigate to Recorder**
   ```
   http://localhost:3000/record
   ```

2. **Enter Feedback Title**
   - Example: "Checkout button not responsive on mobile"

3. **Click "Start Recording"**
   - Browser will request screen + microphone permissions
   - Select your screen to share
   - Grant microphone access

4. **Narrate Your Feedback**
   - Talk about the issue while showing it on screen
   - Duration: 30-60 seconds

5. **Take Screenshots (Optional)**
   - Click "Take Screenshot" button to capture key frames
   - These are saved locally in your browser

6. **Click "Stop"**
   - Recording stops
   - Video is combined (screen + audio)
   - Status shows: "✓ Stopped"
   - Screenshot count displays

7. **Click "Upload & Annotate"**
   - Uploads video to: `POST /feedback-sessions/upload`
   - API creates draft session
   - Browser redirects to annotation page
   - Check terminal logs for:
     ```
     [upload] Session created: sess_xxxxx, video: /tmp/feedbackagent-videos/xxxxx
     ```

---

### Phase 2: Annotate Feedback

1. **Canvas Should Display**
   - Video frame appears on canvas
   - Timeline scrubber at bottom shows progress

2. **Draw Boxes on Frame**
   - Click and drag on canvas to draw bounding box
   - Dashed preview shows while dragging
   - Box color matches selected color picker

3. **Add Description**
   - Type in "Description" text area
   - Example: "Button not centered on mobile"

4. **Click "Add Annotation"**
   - Box + text becomes annotation
   - Appears in list on right sidebar
   - Canvas redraws with filled box

5. **Scrub Timeline**
   - Use range slider to move through video
   - Canvas updates to show frame at that timestamp
   - Add more annotations at different timestamps

6. **Finalize**
   - Click "Finalize & Continue" button
   - Sends: `POST /feedback-sessions/{id}/finalize`
   - Payload includes:
     ```json
     {
       "durationMs": 45000,
       "cursorEvents": [
         { "timestampMs": 5000, "x": 100, "y": 200, "type": "click" },
         ...
       ]
     }
     ```
   - Check API logs for:
     ```
     [finalize] Session status changed to processing
     [worker] Processing session sess_xxxxx
     ```

---

### Phase 3: Worker Processing

The worker processes asynchronously. Check Terminal 1 logs:

1. **Transcript Cleanup**
   ```
   [worker] AI transcript cleanup done (intent: bug)
   ```

2. **Frame Extraction**
   ```
   [worker] Created 15 placeholder frames
   ```

3. **AI Summarization**
   ```
   [worker] AI summarization done (severity: high)
   ```

4. **Session Ready**
   ```
   [worker] Session sess_xxxxx ready
   ```

---

### Phase 4: View Results

1. **Navigate to Session Detail**
   ```
   http://localhost:3000/sessions/sess_xxxxx
   ```

2. **See Summary**
   - AI-generated summary at top
   - Status should show: "✓ ready"

3. **View Frames Tab**
   - Shows extracted frames (currently placeholders)
   - Each shows timestamp, cursor position, annotation

4. **Check Task Panel**
   - Right sidebar shows "AI Task Brief" if generated
   - Can create improvement tasks from here

---

### Phase 5: Send to Claude Code (MCP Handoff)

1. **Click "Send to Claude Code" Button**
   - Purple gradient card with white button
   - Button says: "→ Send to Claude Code"

2. **See Success Message**
   ```
   ✓ Feedback pushed to Claude Code.
   Your Claude Code instance can now access the full context and generate code changes.
   ```

3. **Claude Code Can Now:**
   - Call MCP: `get_feedback_details` with feedback_id
   - Retrieve full context (summary, frames, annotations)
   - Generate code changes
   - Create GitHub PR
   - Call MCP: `register_completed_task` with PR details

---

## Expected API Calls

### 1. Upload Video
```
POST /feedback-sessions/upload
Content-Type: multipart/form-data

video: [binary WebM file]
title: "Checkout button broken"
durationMs: "45000"
screenshotCount: "3"

Response: 201
{
  "data": {
    "id": "sess_abc123"
  }
}
```

### 2. Finalize Annotations
```
POST /feedback-sessions/sess_abc123/finalize
Content-Type: application/json

{
  "durationMs": 45000,
  "cursorEvents": [
    {
      "timestampMs": 5000,
      "x": 100,
      "y": 200,
      "type": "click"
    }
  ]
}

Response: 200
{
  "data": {
    "id": "sess_abc123",
    "status": "processing"
  }
}
```

### 3. Send to Claude
```
POST /feedback-sessions/sess_abc123/send-to-claude
Content-Type: application/json

{
  "target": "claude"
}

Response: 201
{
  "data": {
    "task_id": "task_xyz",
    "feedback_id": "sess_abc123",
    "message": "Feedback sent to claude...",
    "mcp_instructions": "..."
  }
}
```

---

## Troubleshooting

### Issue: Video upload fails
- Check `/tmp/feedbackagent-videos` directory exists
- Verify API has write permissions
- Check file size < 500 MB
- Check Content-Type is `multipart/form-data`

### Issue: Worker doesn't process
- Verify worker is running: `curl http://localhost:3002/health` 
- Check API is calling worker: `curl http://localhost:3002/process/sess_xxxxx -X POST`
- Check logs for: `[worker] Processing session...`

### Issue: Canvas shows "Video loading..."
- Ensure video file was uploaded (check `/tmp/feedbackagent-videos`)
- Check videoUrl is stored in database
- Verify CORS is enabled for video blob

### Issue: Annotations not saving
- Check browser localStorage has enough space
- Check annotations array is populated before finalize
- Check POST to finalize returns 200

---

## File Locations

- **Videos**: `/tmp/feedbackagent-videos/`
- **Database**: SQLite at repo root (check .env)
- **Logs**: Check terminal output from `pnpm dev`

---

## Next Steps After Testing

1. **Fix any bugs** found during testing
2. **Add transcript generation** via Whisper API (currently mocked)
3. **Improve frame extraction** (currently placeholders)
4. **Deploy to Railway** and test live
5. **Test Claude Code integration** with real MCP calls

---

## How to Monitor Progress

```bash
# Watch API logs
pnpm --filter @feedbackagent/api dev

# Watch worker logs  
pnpm --filter @feedbackagent/worker dev

# Watch web build
pnpm --filter @feedbackagent/web dev

# Check database
# Open SQLite viewer to see:
# - FeedbackSession records
# - FeedbackFrame records
# - ImprovementTask records
```

---

## Test Checklist

- [ ] Recorder starts and captures screen + audio
- [ ] Upload endpoint creates session
- [ ] Redirect to annotation page works
- [ ] Canvas displays video frame
- [ ] Timeline scrubber moves video
- [ ] Drawing boxes works on canvas
- [ ] Annotations save and display
- [ ] Finalize sends cursorEvents
- [ ] Worker processes session
- [ ] Summary is generated
- [ ] Task panel shows ready status
- [ ] "Send to Claude Code" button works
- [ ] MCP instructions display correctly
