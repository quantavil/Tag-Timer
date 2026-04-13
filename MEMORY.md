# Project: Tag-Timer

## Overview
Obsidian plugin that injects and manages inline timers within markdown notes. Renders interactive stopwatch/countdown badges in both Edit mode (via CodeMirror widget) and Reading mode (via MarkdownPostProcessor). It serializes timer state directly into markdown text (`⏳[id|kind|state|elapsed...]`).

## Structure

```
src/
├── commands.ts      # Command handlers for interacting with timers.
├── contextMenu.ts   # Context menu builder for editor selections.
├── controller.ts    # Unified mutation dispatcher spanning reading view and editor.
├── editor.ts        # Markdown line mutation utilities, Regex, parse definitions.
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
- **Type strictness:** Uses extensive inline regex validation and extracting parsed match groups arrays repeatedly.
- **Dynamic tracking:** Discarded array-based timer tracking to rely on real-time asynchronous vault queries mapping directly to regex match signatures via `app.vault.process`.

## Dependencies & Setup
- Bun lockfile used (`bun.lock` existing alongside `package.json`).
- Dependencies successfully bumped to `@latest` (including `obsidian@latest`, `typescript@latest`).
- Current version: `2.1.0`.

## Critical Information
- Known dependency install issue: "lockfile had changes, but lockfile is frozen". 
- Shared global match tracking removed; strict local-variable based regex instantiation resolves prior context memory leak risks.

## Insights
- Using `setInterval` per file parsing loop leads to memory pressure if many timers run simultaneously across unmounted editors. 
- The module-level variable `_app` in `widget.ts` violates independent instantiation isolation.

## Blunders
