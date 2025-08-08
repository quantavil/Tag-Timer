# Tag Timer

An Obsidian plugin to add timers to tags and get analytics on how long you spend on each task.

## Features

-   **Cross-Platform:** Works on both desktop and mobile versions of Obsidian.
-   **Flexible Timer Control:**
    -   Start, pause, and resume timers with ease.
    -   Timers can be controlled via the command palette or a right-click context menu in the editor.
-   **Persistent Timers:** Timers are saved with your notes and will be restored when you reopen Obsidian.
-   **Analytics:**
    -   View daily and weekly analytics of your timed tasks.
    -   Visualize your time spent with bar and doughnut charts.
    -   Reset analytics data when needed.
-   **Customizable:**
    -   Configure where the timer is inserted in the line (beginning or end).
    -   Choose when to automatically stop timers (on file close, on Obsidian quit, or never).

## Usage

### Toggling Timers

-   **Command Palette:**
    -   Open the command palette (`Ctrl+P` or `Cmd+P`).
    -   Search for "Tag Timer: Toggle timer" to start, pause, or resume a timer on the current line.
    -   Search for "Tag Timer: Delete timer" to remove a timer from the current line.
-   **Editor Menu:**
    -   Right-click on a line in the editor to open the context menu.
    -   Select "Start timer", "Pause timer", "Continue timer", or "Delete timer".

### Analytics

-   **Open Analytics View:**
    -   Click the "pie-chart" icon in the ribbon to open the timer analytics view.
    -   Alternatively, use the command "Tag Timer: Open Timer Analytics" or "Tag Timer: Open Weekly Timer Analytics".
-   **Reset Analytics:**
    -   Use the commands "Tag Timer: Reset Daily Timer Analytics" or "Tag Timer: Reset Weekly Timer Analytics" to clear the respective analytics data.

## Installation

1.  Open Obsidian's settings.
2.  Go to "Community plugins" and turn off "Safe mode".
3.  Click "Browse" and search for "Tag Timer".
4.  Click "Install" and then "Enable".

## Configuration

To configure the plugin, go to the "Tag Timer Settings" in Obsidian's settings.

-   **Daily Analytics Reset:** Automatically reset all analytics data at the start of a new day.
-   **Weekly Analytics Reset:** Automatically reset weekly analytics data at the start of a new week (Monday).
-   **Auto-stop timers:** Choose when to automatically stop running timers:
    -   **Never:** Timers will continue running until manually stopped.
    -   **On Obsidian quit:** Timers will be paused when you quit Obsidian.
    -   **On file close:** Timers will be paused when you close the file they are in.
-   **Timer insert location:** Choose where to insert the timer in the line:
    -   **Beginning of line:** The timer will be inserted at the beginning of the line.
    -   **End of line:** The timer will be inserted at the end of the line.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue on the [GitHub repository](https://github.com/quantavil/tag-timer).

## License

This project is licensed under the MIT License.
