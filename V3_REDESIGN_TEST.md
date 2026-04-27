# V3 Redesigned Flow - Test Guide

## New Architecture

```
Homepage (/) 
  ↓ [Redirects]
  ↓
Sessions List (/sessions)
  ├─ "Create Session" button
  └─ Modal: Enter Title
      ↓
      "Start Recording" button opens NEW TAB
      ↓
Recording Tab A (/sessions/[id]/record)
  ├─ Full-screen recording
  ├─ Right-click + drag = draw box
  ├─ Click box = add note (voice or text)
  ├─ Max 5 boxes
  ├─ Voice: 30s max each
  ├─ Text: 1000 char max each
  └─ Submit button
      ↓
Summary Page (/sessions/[id]/summary)
  ├─ All boxes + coordinates
  ├─ All notes (text + voice)
  └─ Send to Claude / Codex buttons
```

## Test Steps

### Step 1: Start Dev Server
```bash
cd /Users/kumar/debugr
pnpm dev
```

Wait for all services to start (~30 seconds):
- Web: http://localhost:3000
- API: http://localhost:3001
- Worker: http://localhost:3002

### Step 2: Navigate to Homepage
```
http://localhost:3000
```
Should redirect automatically to `/sessions`

### Step 3: Create Session
1. Click "Create Session" button
2. Modal appears: "New Debug Session"
3. Enter title: `"Checkout button broken on mobile"`
4. Click "Start Recording" button

**Expected:**
- New browser tab (Tab A) opens automatically
- Shows full-screen recording with HUD
- Video preview of your screen
- Bottom left: "Recording..." instructions
- Bottom right: "Boxes: 0/5" counter
- Top right: Submit button

### Step 4: Record in Tab A
1. Right-click on the screen (Tab A)
2. Drag to draw rectangle (dashed yellow box preview)
3. Release mouse

**Expected:**
- Dashed box becomes solid red box
- Box automatically selected
- Modal pops up: "Add Note to Box"
- Two options: 📝 Text or 🎤 Voice

### Step 5: Add Text Note
1. Select "📝 Text" (default)
2. Type: `"The checkout button moves when window resizes"`
3. Click "Add Note" button

**Expected:**
- Modal closes
- Box still visible on screen
- Box counter shows: "Boxes: 1/5"

### Step 6: Add Voice Note (Optional)
1. Right-click again + drag to create another box
2. Modal appears
3. Click "🎤 Voice" tab
4. Click "Start Recording"
5. Speak for 10 seconds: `"This breaks the entire flow on mobile"`
6. Click "Stop Recording"
7. Click "Add Note"

**Expected:**
- Voice timer shows: 0s → 10s
- Recording stops after 30s automatically
- Note shows: "[Voice note: 10s]"

### Step 7: Add More Boxes (Up to 5)
Repeat steps 4-6 to add up to 5 boxes total.

**Expected:**
- Each box is tracked in counter
- Can't create more than 5 boxes (alert message)

### Step 8: Submit Session
1. Click "✓ Submit Session" button (bottom right)

**Expected:**
- Recording stops
- Browser redirects to `/sessions/{id}/summary`
- Boxes page shows all recorded boxes

### Step 9: View Summary
Summary page displays:
- **Title:** "Checkout button broken on mobile"
- **Boxes Count:** Shows number of boxes created
- **Box Cards:** Each box shows:
  - COORDINATES: x, y, width, height (pixels)
  - NOTES: All notes added to that box
  - Note type: 📝 Text or 🎤 Voice
  - Duration: If voice, shows seconds

### Step 10: Send to Claude
1. Click "→ Send to Claude" button
2. Alert appears: "✓ Sent to Claude Code!..."
3. Redirected back to `/sessions`

**Expected:**
- Session still exists in list
- Can now test real Claude Code integration

---

## Data Structure

### Box (Stored in sessionStorage)
```typescript
interface Box {
  id: string;              // "box_1234567890"
  x: number;               // Pixel X coordinate
  y: number;               // Pixel Y coordinate
  width: number;           // Box width in pixels
  height: number;          // Box height in pixels
  notes: Note[];            // Array of notes
}
```

### Note (Stored in Box)
```typescript
interface Note {
  id: string;              // "note_1234567890"
  type: 'voice' | 'text';  // Note type
  content: string;         // Text or "[Voice note: 30s]"
  duration?: number;       // Seconds (voice only)
  timestamp: number;       // When added (ms from session start)
}
```

### Example Payload to Summary Page
```json
{
  "boxes": [
    {
      "id": "box_1711850000000",
      "x": 150,
      "y": 200,
      "width": 300,
      "height": 100,
      "notes": [
        {
          "id": "note_1711850010000",
          "type": "text",
          "content": "The checkout button moves when window resizes",
          "timestamp": 5000
        },
        {
          "id": "note_1711850015000",
          "type": "voice",
          "content": "[Voice note: 15s]",
          "duration": 15,
          "timestamp": 10000
        }
      ]
    }
  ]
}
```

---

## Expected Behavior Checklist

- [ ] `/` redirects to `/sessions`
- [ ] `/sessions` loads without errors
- [ ] "Create Session" button opens modal
- [ ] Title input works
- [ ] "Start Recording" opens new tab (Tab A)
- [ ] Tab A shows full-screen recording
- [ ] Right-click + drag creates box
- [ ] Box modal appears automatically
- [ ] Text note input works
- [ ] Text note saves to box
- [ ] Voice recording button works
- [ ] Voice timer counts up to 30s
- [ ] Voice recording stops at 30s
- [ ] Voice note saves with duration
- [ ] Box counter updates (0→5)
- [ ] Can't create 6th box (alert shown)
- [ ] Submit button redirects to summary
- [ ] Summary shows all boxes
- [ ] Summary shows coordinates
- [ ] Summary shows all notes
- [ ] "Send to Claude" button works
- [ ] Alert confirms send to Claude
- [ ] Back to sessions after send

---

## Troubleshooting

### Tab A doesn't open
- Check browser pop-up blocker settings
- Check console for errors (F12)
- Verify API endpoint is correct in logs

### Video preview is blank
- Grant screen sharing permission when prompted
- Check that a screen is actually being shared
- Verify browser supports getDisplayMedia API

### Boxes aren't appearing
- Right-click and drag (not just click)
- Check that drag distance > 20 pixels
- Verify mouse coordinates are on canvas

### Notes not saving
- Check browser console for errors
- Verify sessionStorage is available (not in private mode)
- Check that note content is not empty

### Voice recording doesn't work
- Grant microphone permission when prompted
- Check audio device is connected
- Verify browser supports getUserMedia API

### Redirect to summary doesn't happen
- Check API response in network tab
- Verify sessionStorage has `session_{id}_boxes`
- Check browser console for redirect errors

---

## Performance Notes

- Recording quality: VP9 codec, full screen resolution
- File size: ~2-10 MB per 1 minute of recording
- Voice notes: PCM audio, ~100 KB per 10 seconds
- Coordinates: Saved as pixel values (real coordinates)

---

## Next Steps After Testing

If everything works:
1. ✅ Record a test session
2. ✅ Annotate with 3-5 boxes
3. ✅ Add text + voice notes
4. ✅ View summary
5. ✅ Send to Claude

Then:
- [ ] Connect to real Claude Code instance
- [ ] Test MCP handoff (`get_feedback_details` call)
- [ ] Verify Claude can access box coordinates and notes
- [ ] Test code generation from feedback

---

## Files to Check

If debugging needed, check these files:

```
apps/web/src/app/
├── page.tsx                        # Main page (redirects)
├── sessions/
│   ├── page.tsx                    # Sessions list + create modal
│   └── [id]/
│       ├── record/page.tsx         # Tab A full-screen recording
│       └── summary/page.tsx        # Summary with boxes + notes
└── sessions/[id]/
    └── page.tsx                    # Original session detail (unused now)
```

Most logic is in `/sessions/[id]/record/page.tsx` - this is where all the box drawing and note recording happens.
