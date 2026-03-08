export const CONSTANTS = {
    UPDATE_INTERVAL_MS: 1000, // 1s tick
    BASE62_CHARS: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    RETENTION_DAYS: 30,
    ANALYTICS_VIEW_TYPE: "timer-analytics-view",
    MAX_UPDATE_STEP_SEC: 5,      // cap a single accrual step to <= 5s
    SLEEP_GAP_SEC: 60,           // treat gaps > 60s as "sleep" (add 0s; reset timestamp)
    REGEX: {
        ORDERED_LIST: /(^\s*>?\s*\d+\.\s)/,
        UNORDERED_LIST: /(^\s*>?\s*[-+*]\s)/,
        HEADER: /(^\s*#+\s)/,
        TIMER_SPAN: /<span class="timer-[rp]"[^>]*>.*?<\/span>/,
        NEW_FORMAT: /<span class="(timer-r|timer-p)" id="([^"]+)" data-dur="(\d+)" data-ts="(\d+)">.*?<\/span>/g,
        HASHTAGS: /#\w+/g
    }
};

export const LANG = {
    command_name: { toggle: "Toggle timer", delete: "Delete timer" },
    action_start: "Start timer", action_paused: "Pause timer", action_continue: "Continue timer",
    notice: {
        update_in_preview: "Cannot update timer in preview mode, please switch to edit mode.",
        invalid_insert: "Cannot find valid position to insert timer.",
        invalid_time: "Please enter a valid number of seconds.",
        deleted: "Timer deleted"
    },
    settings: {
        name: "Tag-Timer Settings", desc: "Configure how timers behave.",
        tutorial: "Welcome to Tag-Timer! Check out the documentation and examples on our ",
        askforvote: "If you like this plugin, consider giving it a star on GitHub!",
        issue: "If you encounter any bugs, please report them on the GitHub issue page.",
        sections: { basic: { name: "Basic Setup", desc: "Core configuration" } },
        autostop: { name: "Auto stop rule", desc: "When should running timers be automatically stopped?", choice: { never: "Never (keep running across sessions)", quit: "Only when Obsidian quits", close: "When Obsidian quits OR the file is closed" } },
        insertlocation: { name: "Insert Location", desc: "Where should new timers be inserted when triggered from the command palette?", choice: { cursor: "At cursor position", head: "Start of the line", tail: "End of the line" } }
    }
};
