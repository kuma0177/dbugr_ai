# Install Dbugr on a Mac

This guide is for people who want to use the Dbugr Mac app without setting up the developer repo.

## What You Need

- A Mac running macOS 13 or newer.
- Access to the Dbugr web app.
- Optional: Claude Code, Codex CLI, or Cursor if you want to send sessions directly to an AI coding tool.

You do not need Node, pnpm, Rust, Xcode, or Terminal for the normal DMG install.

## Install the Mac App

1. Open the Dbugr homepage or onboarding page.
2. Click **Download for macOS** or **Download macOS DMG**.
3. Open the downloaded `.dmg` file from your Downloads folder.
4. Drag **Dbugr.ai** into **Applications**.
5. Open **Dbugr.ai** from Applications.
6. If macOS asks whether you are sure you want to open it, choose **Open**.

Download link:

https://github.com/kuma0177/debgr_ai/releases/download/pre-open-source-ready-stable/dbugr-ai-0.0.1-macos-aarch64.dmg

## Link the App to Your Account

1. Go to Dbugr web onboarding.
2. Sign in or create your workspace.
3. Click **Link this MacOS app**.
4. macOS should switch to Dbugr and connect this Mac to your account.

Use **Relink Mac app** if you reinstalled Dbugr, moved to a new Mac, signed out, or the app stopped recognizing your workspace.

## Allow Screen Recording

Dbugr needs Screen Recording permission so it can capture the part of the screen you annotate.

1. Open **System Settings**.
2. Go to **Privacy & Security**.
3. Open **Screen Recording**.
4. Turn on **Dbugr.ai**.
5. Quit and reopen Dbugr after changing the permission.

If the capture is blank, Screen Recording permission is usually the reason.

## Connect an AI Tool

Dbugr can send sessions to:

- Claude Code
- Codex CLI
- Cursor

Cursor only needs the Cursor app installed. Claude Code and Codex CLI are separate command-line tools from their providers. Dbugr does not silently install them or bypass macOS security warnings.

If you do not have an AI tool connected yet, you can still capture and review sessions in Dbugr.

## Optional Terminal Installer

If you are comfortable pasting one command into Terminal, this installs the DMG from GitHub Releases:

```bash
curl -L https://raw.githubusercontent.com/kuma0177/debgr_ai/main/scripts/install-macos.sh | bash
```

This script downloads the DMG, copies Dbugr into Applications, and opens the app. It does not bypass macOS security prompts.

## Common Problems

### macOS says Dbugr cannot be opened

Open Dbugr from Applications again and choose **Open** if macOS shows a first-run safety prompt. If your organization manages your Mac, you may need admin approval.

### Capture is blank

Turn on Screen Recording permission for Dbugr.ai, then quit and reopen the app.

### Link this Mac does not work

Open Dbugr.ai first, then return to web onboarding and click **Relink Mac app**.

### Cursor opens but no prompt appears

For Cursor, Dbugr copies the prompt to your clipboard and opens Cursor. Paste into Cursor chat to continue.

### Team/Public review cannot connect

Check your internet connection and relink the Mac from web onboarding. Direct-to-AI/local capture should still work without the web API.
