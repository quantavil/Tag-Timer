# Tag Timer

A minimal, highly-efficient Obsidian plugin for adding inline timers directly into your notes.

This is a complete redesign from v1.x, strictly focusing on performance, zero external dependencies, and adhering to the DRY principle.

## Features

- **Inline Timers:** Add a timer to any line in your notes.
- **Lightning Fast Hotkeys:**
  - `Alt+S`: Toggle timer (Start / Pause / Resume)
  - `Alt+D`: Delete timer
- **Auto-Restore:** Running timers are automatically paused when you close the plugin and resumed when you reopen your notes.
- **Smart Formatting:** Timers use Obsidian's native CSS variables and elegantly adapt to your light/dark themes.
- **Zero Dependencies:** No heavy charting libraries; purely relies on Obsidian's internal APIs.

## Usage

### Hotkeys (Recommended)

Position your cursor anywhere on a line:

- **Start/Pause/Resume:** Press `Alt+S` to toggle a timer. 
- **Delete:** Press `Alt+D` to delete a timer from the current line.

### Context Menu

- Right-click anywhere on a line in the editor to open the context menu.
- Select **Start timer**, **Pause timer**, **Resume timer**, or **Delete timer** depending on the timer's current state.

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
