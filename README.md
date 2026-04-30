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
- **Completion Notifications:** Visual notifications (Obsidian Notice) triggered when a countdown reaches zero.
- **Stop All Command:** A global command to stop all running timers across your entire vault (Command Palette only, no default hotkey).
- **Countdowns & Stopwatches:** Choose between open-ended stopwatches or goal-oriented countdowns with a configurable default duration.
- **Clickable Widgets:** Interactive badges in both **Live Preview** and **Reading View**. Click or right-click to open the context menu.
- **Rich Context Menu:** Right-click any timer to access Pause, Resume, Stop, Reset, Delete, or **Change Time** manually.
- **Auto-Restore & Crash Protection:** Running timers are automatically paused upon plugin unload and recovered when restarted. Safe across devices and through app crashes.
- **One Timer Per Line:** Enforces a clean layout by preventing multiple timers on the same line.
- **Native Integration:** Uses Obsidian's internal CSS variables to perfectly adapt to your theme (Light/Dark). Fully compatible with Obsidian v1.4.0+.
- **Zero External Dependencies:** Built with pure TypeScript and CodeMirror 6 for maximum stability and speed.

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
- **Menu:** Click or right-click the badge to open the context menu.

### Timer States

1. **Running (⏳):** Actively ticking. The badge has a breathing glow animation.
2. **Paused (⏳):** Temporarily halted. Resuming picks up from the last recorded elapsed time.
3. **Stopped (⏹️):** Archive state. Retains the final time display. Resuming a stopped timer resets elapsed to zero and starts fresh.

### Editing Time

Need to adjust the time? Use the **Change timer/countdown time** command or right-click the badge and select **Change time**. Accepts `mm:ss`, `hh:mm:ss`, or a plain number (interpreted as minutes).

### Settings

- **Insert position:** Where new timers appear on a line — end of line (default), start of line, or at cursor.
- **Default countdown:** Duration used when creating a new countdown with `Ctrl/Cmd+Shift+C`. Default: 25:00.

## Developer Information

### Architecture
- **Rendering:** Uses CodeMirror 6 `ViewPlugin` and `WidgetType` for efficient, non-destructive UI overlays in Live Preview. `MarkdownPostProcessor` + `MarkdownRenderChild` for Reading View.
- **Data Storage:** Timers are stored as small, text-based tags in your markdown: `⏳[id|kind|state|elapsed|startedAt|target]`.
- **State Management:** No external state files. The markdown text is the single source of truth. Recovery works by scanning vault files on plugin load.

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
