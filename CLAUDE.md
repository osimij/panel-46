# Panel

A designer's private, local-first library of design references, with project canvases, an assistant (FRIDAY) and sketches. One designer uses it every day on real work. Read [README.md](README.md) for what each part does.

## Never touch the real library

- The real library is `~/DesignLibrary` and the real app runs on port **4646** (kept running by launchd, `scripts/autostart.sh`).
- **Try every change on a copy**: `scripts/copy.sh` makes `.copy/lib` (cloned, nearly free on disk) and builds the UI into `.copy/dist`. Run it on port **4747** with the `panel-copy` server in `.claude/launch.json`, or:
  `PANEL_PORT=4747 PANEL_LIBRARY_DIR=.copy/lib PANEL_DIST=.copy/dist bun server/index.ts`
- After changing `web/`, rebuild only the copy's UI: `scripts/copy.sh --build`. **Never run `bun run build` or `bun run start` to test**: they overwrite `dist/`, which the real app serves, so the real app would get new UI against old server code.
- Reading the real database is fine with `sqlite3 -readonly`. Never write to it.
- Restart the real app (`scripts/autostart.sh restart`) only after the designer says so. Before restarting, check that no FRIDAY answer or build is running.
- Commit only when asked.

## Checks

- `bun run typecheck`
- `bun test tests`: starts a companion of its own on a spare port with an empty library in a temp folder (see `tests/helpers.ts`). Add a test there when you add a route or a tool.
- Anything visible: look at it in the browser on the 4747 copy before saying it works.
- Calls to Claude (FRIDAY, design reads, builds) spend the designer's plan. On the copy, reads are off (`ai_auto = 0`); test FRIDAY with one or two short messages, not a batch.

## How it's laid out

- `server/` (Bun): `index.ts` is the whole HTTP router; `db.ts` the schema (columns are added in place at start, there are no migration files); `library.ts` the search the AI tools use (an in-memory index rebuilt when the library changes); `mcp-tools.ts` the MCP tools; `chat.ts` FRIDAY (Claude Code through the Agent SDK, with only Panel's tools); `projects.ts` + `board.ts` the canvases (every change is an op in `project_events`, with its undo); `sketches.ts` sketch files and rendering in headless Chrome; `builds.ts` handing a sketch to Claude Code; `read.ts` design reads; `capture.ts`, `site.ts`, `social.ts`, `media.ts` saving; `backup.ts` daily snapshots.
- `web/src/` (React 19 + Vite, no state library, no router): `App.tsx` the library page, `Grid.tsx` the masonry, `Detail.tsx` one save, `Canvas.tsx` a project (React Flow, loaded lazily), `Studio.tsx` a sketch full size, `Assistant.tsx` FRIDAY's panel, `api.ts` every call to the server and its types.
- `extension/`: the browser extension that sends bookmarks to Panel.
- `unugly.md`: the designer's rules for every design. FRIDAY reads it on every message.

## House style

- The designer is not an engineer. Write comments, labels, errors and messages in plain words that say what happens ("Moved to Trash"), not how.
- Comments explain why, in full sentences, at the top of a file and above anything non-obvious. Keep that up.
- UI: grayscale, Inter, quiet. Reuse the classes in `styles.css` before adding new ones. Corners use `corner-shape: var(--corner)` (Apple-style smoothing). Read `unugly.md` before designing anything, including Panel's own UI.
- Motion is part of the design (card glides, view transitions). Respect `prefersReducedMotion()`.
- No new dependency without a reason worth its weight; say so when you add one.
- Routes that change things or spend the Claude plan are guarded with `fromPanel(req)`. Sketches run in a sandbox with no access to Panel. Keep both.
