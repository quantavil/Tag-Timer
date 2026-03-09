# Tag Timer

A minimal, highly-efficient Obsidian plugin for adding inline timers directly into your notes.

This is a complete redesign from v1.x, strictly focusing on performance, zero external dependencies, and adhering to the DRY principle.

## Features

- **Inline Timers:** Add a timer to any line in your notes.
- **Lightning Fast Hotkeys:**
  - `Alt+S`: Toggle timer (Start / Pause / Resume)
  - `Alt+D`: Delete timer
- **Clickable Badges:** Click any timer badge directly in the Editor or Reading View to instantly toggle it.
- **Auto-Restore & Crash Protection:** Running timers are automatically paused when you close the plugin and restored when you reopen. Safe against mobile force-closes.
- **One Timer Per Line:** Clean and organized. Automatically prevents you from accidentally clustering multiple timers on a single line.
- **Smart Formatting:** Timers use Obsidian's native CSS variables and elegantly adapt to your light/dark themes.
- **Zero Dependencies:** No heavy charting libraries; purely relies on Obsidian's internal APIs.

## Usage

### Hotkeys & Interactions

Position your cursor anywhere on a line with a timer, or simply **click** the timer badge!

- **Toggle (Start/Pause/Resume):** Press `Alt+S` or click the badge.
- **Delete:** Press `Alt+D`.

### Timer States (Pause vs. Stop)

Timers can exist in a few different states:
1. **Running (⌛):** Actively ticking up time.
2. **Paused (⏳):** Temporarily halted. Resuming a paused timer picks up exactly where it left off.
3. **Stopped (⏹️):** Finished or archived. A stopped timer retains its final time on the screen as a record, but if you choose to "Resume" a stopped timer, it will start over from `0s`.

### Command Palette & Context Menu

Right-click anywhere on a line in the editor (or use the Command Palette) to access:
- **Start / Pause / Resume timer**
- **Stop timer:** Marks the timer as finished (⏹️). 
- **Reset timer:** Leaves the timer paused, but sets the elapsed time back to `0s`.
- **Delete timer:** Removes the timer entirely.

### Settings

Go to **Settings > Community plugins > Tag Timer** to configure:

- **Insert position:** Choose whether new timers are inserted at the **end of the line**, the **start of the line**, or exactly at your **cursor**.

## Installation (Manual)

1. Download the latest `main.js`, `manifest.json`, and `styles.css` from the `dist/` folder.
2. Create a folder named `tag-timer` inside your vault's `.obsidian/plugins/` directory.
3. Place the downloaded files into that folder.
4. Reload Obsidian.
5. Go to **Settings > Community plugins**, turn off "Safe mode", and enable **Tag Timer**.

## Contributing

Contributions are welcome! If you encounter any issues or have feature requests, please open an issue or submit a pull request on the [GitHub repository](https://github.com/quantavil/tag-timer).

## License

This project is licensed under the MIT License.
