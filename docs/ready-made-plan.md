# Plan: ready-made parts that come with Panel (loading animations, colour scales and icons)

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, `CLAUDE.md`, `unugly.md` and `README.md` before touching anything. When you finish, write the report described at the end and stop.

## Why

The designer's words: "good design partially also comes from having good resources and references; having good things pre-installed in Panel and making it use them is a pretty good move."

Today, when a sketch needs a loading state, FRIDAY draws a spinner from nothing. When a project has no colours decided, it invents a palette. When it needs an icon, it draws one by hand or reaches for an emoji. All three are places where good, tested material beats a fresh guess.

The designer collected such material by hand in `~/Desktop/jakub-library` (read `README.md`, `RIGHTS.md`, `COMPONENTS.md` and `PALETTES.md` there first):

- **36 loading animations** by Jakub Krehel and Paul Faivret: `source/loading/src/*.tsx`, MIT licence (`source/loading/LICENSE.md`). They are React components, each a small SVG with CSS; their timings live in `src/motion.ts`, `src/easing.ts` and the helpers beside them.
- **37 colour scales** in OKLCH, each with 12 light and 12 dark steps: `data/palettes.json`, described in `PALETTES.md` and `palettes/*.md`. `RIGHTS.md` says what these are: colour values as facts, with their source links; not a licence over the site they came from.

The collection has rules for icons but no icon set. The designer chose one: **Phosphor** (`@phosphor-icons/core` version 2.1.1, MIT licence). It has 1,512 icons, each in six weights: thin, light, regular, bold, fill and duotone. Every icon is one small SVG that takes its colour from the text around it.

This step puts all three inside Panel, lets FRIDAY use them in sketches, and gives the designer a page to see them.

A name to watch: Panel already calls a project's logos and pictures its "brand kit" (`[[brandkit:id]]`, `get_brand_assets`). Don't call the new thing a kit anywhere, in code or on screen. It is **ready-made parts**, "Ready-made" on screen.

## Another session is working in this folder right now

Read this twice. A session is building skills (part 4, `docs/skill-leads-plan.md`) at the same time, in the same folder, and it is testing on the shared copy.

- **Never run `scripts/copy.sh`**, with or without `--build`. Without it, it deletes `.copy/lib`; with it, it rebuilds `.copy/dist`. The other session is using both.
- **Make your own copy**: `.copy/lib-ready` for the library and `.copy/dist-ready` for the UI, on port **4787**. Read `scripts/copy.sh` and do the same steps by hand into `.copy/lib-ready` (the safe database backup from the real library, opened read-only; the cloned folders; the same settings it sets so nothing is read or downloaded by itself). Build the UI with `bunx vite build --outDir .copy/dist-ready --emptyOutDir`. Add one `panel-copy-ready` entry to `.claude/launch.json` and start it with that.
- **Stay out of the skills files entirely**: `server/skills.ts`, `server/skilluse.ts`, `server/skillread.ts`, `server/skillreads.ts`, `server/skillpacks.ts`, `server/skillcheck.ts`, `web/src/SkillRead.tsx`, `web/src/Packs.tsx`, `web/src/Detail.tsx`, `web/src/Grid.tsx`, and every skills test.
- **In files you both need** (`server/mcp-tools.ts`, `server/index.ts`, `server/chat.ts`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/styles.css`): add your own small block and nothing else. Read the file again right before each edit. Never rewrite or reformat a file.
- **If the type check or a test fails in a file you didn't touch**, that is the other session in the middle of its work. Wait a few minutes and try again. If it still fails, say so in the report. Don't fix it.
- Also stay out of `web/src/Canvas.tsx`, `web/src/canvas.css`, `web/src/Review.tsx`, `server/projects.ts`, `server/board.ts` (a third session).

## Rules for this job

- Follow `CLAUDE.md`: never touch `~/DesignLibrary` (reading it with `sqlite3 -readonly` to make your copy is fine) or port 4646; never `bun run build` or `bun run start`; do not restart the real app; do not commit. Never `git stash`, `git checkout` or `git reset`.
- **The database doesn't change at all in this step.** Ready-made parts are files in this folder that ship with Panel's code.
- **No new dependency**, and nothing from `~/Desktop/jakub-library` or from the icon package is installed, imported or run. You read the components and write plain versions by hand; you read the icons as text.
- **One download, which the designer has approved**: the Phosphor package at exactly version 2.1.1, from the npm registry (`https://registry.npmjs.org/@phosphor-icons/core/-/core-2.1.1.tgz`, about 6.5 MB unpacked, 9,081 files). Put it in a new empty folder in your scratch space, outside this project, and keep your own scripts in another folder. Download nothing else.
- Plain words everywhere. Anything you can see follows `unugly.md` and the house style; reuse what is in `styles.css`; look at it in the browser on your copy.
- **Keep the licence with the work.** The loading animations and the icons are MIT: each notice, the authors' names and the link travel with them.
- This step spends the designer's Claude plan only on the **two FRIDAY messages** under "Live check".

## What to build

### 1. The parts, as files

A new folder `ready/` at the top of this project:

- `ready/loading/<name>.html`, one per animation, 36 in all. Each is a small piece to paste into a page: the SVG and one `<style>`, nothing else.
  - Plain HTML and CSS. No React, no script, no link to anything outside the file.
  - The same shapes, keyframes, durations, delays and curves as the original, **to the digit**. Work them out from the component and the helpers it uses.
  - Colour is `currentColor`. Size follows the text around it (or one CSS variable). So a sketch's knobs can change both.
  - It keeps what the original does for people who ask for less motion.
  - Class and keyframe names keep the original's `ld-` prefix, so two animations on one page never collide.
- `ready/loading/index.json`: for each, its name, one plain line saying what it looks like ("three dots that bounce in turn"), and what it suits when the source says so.
- `ready/palettes.json`: the 37 scales, light and dark, with each one's name and source link, and what each of the 12 steps is for, as `PALETTES.md` describes it. Values exactly as collected.
- `ready/icons/<weight>.json`, six files, one per weight: each icon's name and the inside of its SVG, exactly as in the package. Packing them this way keeps the project at six files, not nine thousand.
- `ready/icons/index.json`: every icon's name with the search words and categories the package gives it. Take these from the package's catalogue by reading it as text; if that can't be done without running the package's code, use the names alone and say so in the report.
- `scripts/pack-icons.ts`: the small script of your own that turns an unpacked copy of the package into those files, so it can be done again for a newer version. It reads files as text and runs nothing from the package.
- `ready/NOTICE.md`: where each thing came from, the MIT notices for the loading animations and for Phosphor in full with their authors, and what `RIGHTS.md` says about the colour values.

### 2. FRIDAY can use them

One new tool, `get_ready_made`, in `server/mcp-tools.ts` (the reading side in a new `server/ready.ts`):

- with nothing: a short list. The loading animations by name with their one line; the colour scales by name. Short enough to scan.
- with `loading: "<name>"`: that animation's piece, ready to paste, and one line on how to size and colour it.
- with `palette: "<name>"`: its light and dark steps and what each step is for.
- with `find_icons: "trash, settings, arrow right"`: several words at once, separated by commas. For each, the few best icon names, found by name and by the package's search words. Names only, no drawings.
- with `icons: ["trash", "gear"]` (up to 12 at once) and an optional `weight` (regular when not given): each icon as one SVG ready to paste, sized `1em`, coloured by `currentColor`, hidden from screen readers unless it is given a label.
- a wrong name answers with the list (for an icon: with the closest names).

Add it to the tools FRIDAY may use (`server/chat.ts`), and to Panel's instructions for AI apps (`INSTRUCTIONS` in `server/mcp-tools.ts`) in a few sentences:

- Panel comes with ready-made parts. When a sketch needs a loading state, use one of them, don't draw your own.
- When a sketch needs an icon, take it from Panel's icons. Never draw one by hand, never use an emoji as an icon. Look for all the icons a page needs in one call. Keep to one weight on a page, with the filled one only to mark what is active, unless the designer or a skill says otherwise. A project's own brand icons (`get_brand_assets`) come first.
- A colour scale is a starting point only when the project has no colours of its own. A project's locked decisions, its brand assets and the designer's rules always come first.
- Paste the piece into the sketch: a sketch stays one self-contained file.

Keep the tool's description short. Say in the report what the `TOOLS` line of `scripts/measure-search.ts` was before and after; it should grow by no more than about 1,100 characters.

### 3. The designer can see them

A new page, **Ready-made**, reached the way the font manager is (`web/src/Fonts.tsx`; put it beside it). New file `web/src/Ready.tsx`.

- **Loading**: all 36 playing in a quiet grid, each with its name. Clicking one shows it large with its line and a **Copy** button for its code.
- **Colours**: the 37 scales as rows of 12 swatches, with a light / dark switch. Clicking a swatch copies its value.
- **Icons**: a search box, a quiet switch for the six weights, and the icons in a grid with their names. Clicking one copies its SVG. All 1,512 must scroll smoothly: draw only what is on screen, or let the browser skip what isn't.
- A small line at the bottom: who made the loading animations and the icons, with the links, and "MIT licence".
- Motion respects `prefersReducedMotion()`.

The pieces are shown inside the page safely: they are Panel's own files, but treat them as you would a sketch (no way for one to reach Panel).

The routes that serve the list and one part are read-only.

## Tests (no Claude, no internet)

`tests/ready.test.ts`:

- the list holds 36 animations, 37 scales and 1,512 icons in each of six weights;
- every icon: no `<script`, no `http` other than the SVG namespace, no event handlers; `find_icons` with several words; `icons` with a weight, with more than 12 names, and with a wrong name;
- every animation file: no `<script`, no `http`, no `import`, uses `currentColor`, has a `prefers-reduced-motion` block, and its class and keyframe names start with `ld-`;
- `get_ready_made` with nothing, with a loading name, with a palette name, with a wrong name;
- every scale has 12 light and 12 dark steps;
- `ready/NOTICE.md` is there and holds both MIT notices.

Then `bun run typecheck`, `bun test tests`, and `PANEL_PORT=4798 PANEL_LIBRARY_DIR=.copy/lib-ready bun scripts/measure-search.ts` (every search line and `ORDER` line as before your change; only `TOOLS` may grow). The script refuses a library outside `.copy`, so it will take yours.

## Live check, on your own copy (port 4787)

1. **Every animation, checked against its source.** Render all 36 on one page in the browser. Take two screenshots a moment apart to show they move. For twelve of them (pick ones with the most parts), list each duration, delay and curve beside the value in the original file.
2. **The icons, checked against the package.** For twenty icons picked across the weights, compare what Panel gives with the package's file, character for character. Say how thick each weight's line is when an icon is drawn at 16px and at 24px.
3. **The page.** Screenshots of Ready-made: the loading grid, one animation large, the colours in light and in dark, the icons in two weights, and a search.
4. **Two FRIDAY messages**, One model, each a new conversation with no project:
   - "Sketch a file upload screen: a drop area, a list of three files, one of them still uploading. One screen."
   - "Sketch a small settings page for a notes app: a few switches, a text field, a save button. No brand yet, pick calm colours. One screen."

   For each: did FRIDAY call `get_ready_made`, what did it take (loading, colours, icons), is each piece in the page exactly as given, and did it draw any icon of its own or use an emoji? Save the pages and pictures.
5. Save everything in `.copy/` with names starting `ready-`. Delete the downloaded package from your scratch space at the end.

## The report

Write `docs/ready-made-report.md`:

1. **What changed**, file by file; anything done differently from this plan and why.
2. **The 36 animations**: a table with each name, its line, and whether its values were checked against the source. Anything you couldn't carry over exactly, and why.
3. **The colour scales**: how many, what the 12 steps mean, anything odd in the data.
4. **The icons**: how many, the size of the six files, where the search words came from, the twenty checked, and each weight's line thickness at 16px and 24px.
5. **The download**: exactly what was fetched, from where, where it was put, and that it is gone.
6. **The two sketches**: what FRIDAY did, and your own read of whether the ready-made parts made the page better.
7. **Checks**: typecheck, tests, the measuring script, `TOOLS` before and after.
8. **Working beside the other session**: every shared file you touched and what you added; any failure you saw that wasn't yours.
9. **Doubts**, and what the next step should know: whether a real build should get the original `loading` and Phosphor packages instead of the plain pieces; which weight suits which text weight.
10. **Note for the designer**, a few plain sentences: where the Ready-made page is, what FRIDAY now does with it, that the real Panel has none of it until restarted, that nothing was committed.

## Not in this step

- Mentioning a ready-made part with `@` in FRIDAY.
- Ready-made parts in real builds.
- Checking that a sketch's icons really come from Panel's set.
