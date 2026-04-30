# Project: Tag-Timer

## Overview
Obsidian plugin that injects and manages inline timers within markdown notes. Renders interactive stopwatch/countdown badges in both Edit mode (via CodeMirror widget) and Reading mode (via MarkdownPostProcessor). It serializes timer state directly into markdown text (`⏳[id|kind|state|elapsed...]`).

## Structure

```
src/
├── analytics/
│   ├── scanner.ts   # Vault-wide timer tag scanner + aggregation into VaultAnalytics.
│   ├── renderer.ts  # DOM builder for sidebar panel (stats, file bars, weekly trend, recent).
│   └── view.ts      # AnalyticsView (ItemView) + ANALYTICS_VIEW_TYPE constant.
├── commands.ts      # Command handlers for interacting with timers.
├── contextMenu.ts   # Context menu builder for editor selections.
├── controller.ts    # Unified mutation dispatcher spanning reading view and editor.
├── editor.ts        # Markdown line mutation utilities, Regex, parse definitions.
├── longPress.ts     # Mobile long-press gesture utility.
├── menu.ts          # Shared dropdown menu utilities.
├── postProcessor.ts # Reading view widget processing (MarkdownRenderChild logic).
├── recovery.ts      # Automated saving/pausing operations and vault scans.
├── settings.ts      # Plugin settings state and configuration UI tab.
├── timeModal.ts     # Setting modal logic for changing time dynamically.
├── timer.ts         # Business logic (duration math, states, remaining logic).
├── types.ts         # Interfaces and union types.
└── widget.ts        # CodeMirror Live Preview widget registry.
main.ts              # Primary Plugin entrypoint. Lean lifecycle manager.
```

## Conventions
- **State Storage:** No independent filesystem JSON state; the plugin treats the Markdown raw string as the exclusive source of truth for timer states. 
- **Type strictness:** Consolidated regex logic into `timerRegex()` factory in `editor.ts`. `strict: true` enabled in `tsconfig.json`.
- **Dynamic tracking:** Discarded array-based timer tracking to rely on real-time asynchronous vault queries mapping directly to regex match signatures via `app.vault.process`.

## Dependencies & Setup
- Bun lockfile used (`bun.lock` existing alongside `package.json`).
- Dependencies successfully bumped to `@latest` (including `obsidian@latest`, `typescript@latest`).
- Current version: `2.2.0`.

## Critical Information
- Known dependency install issue: "lockfile had changes, but lockfile is frozen". 
- Shared global match tracking removed; strict local-variable based regex instantiation resolves prior context memory leak risks.

## Insights
- Using `setInterval` per file parsing loop leads to memory pressure if many timers run simultaneously across unmounted editors. 
- The module-level variable `_app` in `widget.ts` violates independent instantiation isolation.

- **Stale State Management:** Context menu actions now re-parse the line on click to avoid stale index offset mutations.
- **Mobile Support:** Implemented custom long-press gesture to trigger context menus on touch devices.
- **Build Target:** Aligned ESBuild and TS targets to `ES2022`.

## Blunders
- [2026-04-23] Transition to `strict` mode initially left redundant `noImplicitAny` flag; cleaned up in followup.
- [2026-04-23] `versions.json` was untracked due to broad `.json` ignore rule; fixed with gitignore exception.
- [2026-04-30] Missing background expiry check for countdowns caused stale "running" states when notes were closed, leading to "Failed to open" and Canvas rendering errors due to `vault.process` sync conflicts. Fixed by adding a 30s background scan `expireFinishedCountdowns`.
- [2026-04-30] Timer badges lacked ARIA attributes (role/tabindex/aria-label) causing accessibility issues, and a redundant `ariaLabel` formatting function existed unused. Fixed by wiring the function into the DOM element.
