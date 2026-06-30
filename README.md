# Claude Code Visualizer

A desktop app for browsing, reading, and editing your [Claude Code](https://claude.com/claude-code) chat history — beautifully rendered, **100% offline**.

> **Your conversations never leave your machine.** There is no server, no upload, no telemetry. The app reads the JSONL files Claude Code already writes to `~/.claude/projects/`, on your computer, locally. It's open source — read the code and see for yourself.

## Why

Claude Code stores every session as JSONL on disk, but there's no good way to *read* it back — thinking blocks, tool calls, subagent conversations, and results are buried in raw JSON. This app renders all of it as a clean, navigable conversation, and lets you edit or prune history when you need to.

## Features

- **Auto-discovery** — finds `~/.claude/projects/` automatically (no folder picking), lists every session grouped by project, sortable and searchable by title and date.
- **Full rendering** — user and assistant messages, collapsible thinking blocks, tool calls with inputs, tool results (correct success/error state), and nested subagent conversations.
- **Editing with a safety net** — edit, delete, or reorder messages. Saving to a *copy* is the default; overwriting the original file is gated behind an explicit warning. Every overwrite is snapshotted first.
- **Versioned backups & undo** — in-session undo/redo, plus a per-session version history you can restore from at any time. Backups live in `~/.claude/.ccviz-backups/`.
- **Export** — save any conversation as a standalone, self-contained HTML file.
- **Light / dark themes.**

## Install

Download the installer for your platform from the [latest release](https://github.com/zhangxingeng/claude-code-visualizer/releases):

| Platform | File |
|----------|------|
| Windows  | `.msi` or `.exe` |
| macOS    | `.dmg` (Apple Silicon and Intel) |
| Linux    | `.AppImage` or `.deb` |

### A note on the first-launch warning

These builds are **unsigned** (code-signing certificates are a paid, per-platform expense for a free tool). The app is safe and open source, but your OS doesn't know that, so on first launch:

- **Windows** — SmartScreen may say "Windows protected your PC." Click **More info → Run anyway**.
- **macOS** — Gatekeeper may refuse to open it. **Right-click the app → Open**, then confirm. (Or System Settings → Privacy & Security → Open Anyway.)
- **Linux** — `chmod +x` the AppImage if needed, then run it.

## Privacy

- No network access. The app never makes a single outbound request.
- No analytics, no telemetry, no accounts.
- All reading, editing, and backups happen on your local filesystem.
- Open source under the MIT license — audit it yourself.

## Build from source

Requires [Node.js](https://nodejs.org), [Rust](https://rust-lang.org), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce a native installer
```

## Tech

Tauri v2 (Rust shell, native file access) + SvelteKit (Svelte 5, TypeScript) static frontend. The Rust layer does only filesystem work; all parsing and rendering is in the frontend. See `ARCHITECTURE.md`.

## License

MIT
