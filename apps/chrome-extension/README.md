# FeedbackAgent Auto Overlay Extension

This extension auto-injects the FeedbackAgent annotation overlay onto the active tab after you click `Launch Overlay` in the web app.

## Install (one-time, local dev)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this folder: `/Users/kumar/debugr/apps/chrome-extension`.

## How it works

1. In FeedbackAgent, create a session and click `Launch Overlay`.
2. The web app queues an overlay command in the local API.
3. Extension polls the active tab and auto-injects the overlay when URL matches.
4. You annotate immediately on the real page, no bookmarklet click required.

## Notes

- Requires local API (`http://localhost:3001`) and web app (`http://localhost:3000`) running.
- This is a development extension and not Chrome Web Store packaged.
