<p align="center">
  <img src="assets/banner.png" alt="Tag Timer Banner">
</p>

# Tag Timer

A minimal, high-performance Obsidian plugin for adding inline timers and countdowns directly into your notes.

## Features

- **Lightning Fast Interaction:**
  - `Ctrl/Cmd+Shift+S`: Toggle Stopwatch (Start / Pause / Resume)
  - `Ctrl/Cmd+Shift+C`: Toggle Countdown (Start / Pause / Resume)
  - `Ctrl/Cmd+Shift+D`: Delete Timer on current line
- **Countdowns & Stopwatches:** Choose between open-ended stopwatches or goal-oriented countdowns with a configurable default duration.
- **Analytics Panel:** A dedicated sidebar view tracking your time. Includes daily/weekly totals, streak tracking, file-by-file time breakdowns, a weekly trend chart, and a history of recent sessions.
- **Audio & Visual Notifications:** Choose from multiple completion sounds (`chime`, `bell`, `beep`, `digital`, `synth`) and visual notifications when a countdown reaches zero.
- **Clickable Widgets & Mobile Support:** Interactive badges in both **Live Preview** and **Reading View**. Click, right-click, or **long-press (on mobile)** to open the context menu.
- **Rich Context Menu:** Access Pause, Resume, Stop, Reset, Delete, or **Change Time** manually directly from the timer badge.
- **Auto-Restore & Background Expiry:** Running timers are automatically paused upon plugin unload and recovered when restarted. Countdowns cleanly expire in the background even if the note is closed or rendered in a Canvas.
- **Accessible (ARIA):** Full screen-reader support with dynamically updating ARIA labels on all timer widgets.
- **Native Integration:** Uses Obsidian's internal CSS variables to perfectly adapt to your theme (Light/Dark).

## Installation via BRAT

You can install beta versions of Tag Timer using the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin:

1. Install the **Obsidian42 - BRAT** plugin from the Community Plugins list.
2. Enable the BRAT plugin in your settings.
3. Open the BRAT settings and click **Add Beta plugin**.
4. Enter the GitHub repository URL: `quantavil/Tag-Timer`.
5. Go to the **Community Plugins** tab, reload the plugins list, and enable **Tag Timer**.

## Usage

### Hotkeys & Interactions

Position your cursor anywhere on a line with a timer, or interact directly with the badge:

- **Toggle (Stopwatch):** `Ctrl/Cmd+Shift+S` — Creates a new stopwatch if none exists, otherwise pauses/resumes.
- **Toggle (Countdown):** `Ctrl/Cmd+Shift+C` — Creates a new countdown (default: 25 min) if none exists, otherwise pauses/resumes.
- **Delete:** `Ctrl/Cmd+Shift+D` — Removes the timer tag from the current line.
- **Stop All:** Search for "Stop all running timers" in the Command Palette (`Cmd/Ctrl+P`).
- **Menu:** Click, right-click, or long-press the badge to open the context menu.

### Timer States

1. **Running (⌛):** Actively ticking. The badge features a smooth, breathing glow animation.
2. **Paused (⏳):** Temporarily halted. Resuming picks up from the last recorded elapsed time.
3. **Stopped (⏹️):** Archive state. Retains the final time display. Resuming a stopped timer resets elapsed to zero and starts fresh.

### Editing Time

Need to adjust the time? Use the **Change timer/countdown time** command or right-click the badge and select **Change time**. Accepts `mm:ss`, `hh:mm:ss`, or a plain number (interpreted as minutes).

### Settings

- **Insert position:** Where new timers appear on a line — end of line (default), start of line, or at cursor.
- **Play sound on completion:** Toggle text-editor friendly sounds when countdowns finish.
- **Sound type:** Choose your preferred alarm (`Soft Chime`, `Gentle Bell`, `Classic Beep`, `Digital Alarm`, `Synth Pulse`).
- **Default countdown:** Duration used when creating a new countdown with `Ctrl/Cmd+Shift+C`. Default: 25:00.
- **Enable analytics panel:** Toggle the time-tracking sidebar panel.

## Developer Information

### Architecture
- **Rendering:** Uses CodeMirror 6 `ViewPlugin` and `WidgetType` for efficient, non-destructive UI overlays in Live Preview. `MarkdownPostProcessor` + `MarkdownRenderChild` for Reading View.
- **Data Storage:** Timers are stored as small, text-based tags in your markdown: `⏳[id|kind|state|elapsed|startedAt|target]`.
- **State Management:** No external state files. The markdown text is the single source of truth. Background vault scanners periodically sync and expire timers dynamically without memory leaks.

### Build Instructions

This project uses [Bun](https://bun.sh/) for builds.

```bash
# Install dependencies
bun install

# Development mode (watch)
bun dev

# Production build
bun run build
```

Production builds output to `dist/` with `manifest.json` and `styles.css` copied alongside the bundled `main.js`.

## License

MIT License. Developed by [quantavil](https://github.com/quantavil).
