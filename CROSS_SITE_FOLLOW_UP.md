# Cross-Site Follow-Up Checklist

Future work for the broader cross-site recording and annotation experience.

## Browser Extension Path

- Inject overlay UI on arbitrary third-party websites
- Capture DOM-relative box coordinates reliably across scroll/zoom states
- Sync controller commands into the extension session
- Handle extension auth/session handoff to FeedbackAgent

## Desktop Wrapper / Native Path

- Evaluate Tauri wrapper for cross-site browser capture control
- Support always-on-top annotation palette
- Support global hotkeys for note start/stop
- Handle system-level permissions for screen capture + microphone

## Recording / Timeline Model

- Persist timestamped box notes to the backend instead of session memory
- Support text note up to 1000 characters per box
- Support voice note up to 30 seconds per box
- Add playback UI showing note markers directly on the recording timeline

## Mobile Controller

- Harden mobile join flow with QR code and one-tap session join
- Add reliable microphone upload for controller voice notes on mobile Safari
- Improve recorder/controller reconnect behavior on flaky networks

## Product / UX

- Show explicit “screen + mic recording is active” state everywhere
- Add better recorder-to-controller onboarding copy
- Add session-level summary of unresolved box notes before handoff
