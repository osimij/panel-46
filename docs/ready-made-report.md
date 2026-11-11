# Report: ready-made parts that come with Panel

Carried out from [ready-made-plan.md](ready-made-plan.md) on 11 Nov 2026, on my own copy (`.copy/lib-ready`, UI in `.copy/dist-ready`, port 4787). Nothing was committed, the real library and the real app were not touched, and the database did not change.

## 1. What changed

New files:

- `ready/loading/<name>.html` (36): one piece each, the original's `<style>` and markup with React taken out. Each starts with a one-line HTML comment naming the authors and pointing to the notice (no link in it, so the "no http" check holds).
- `ready/loading/index.json`: name, title, the one line, and the original's cycle length in ms, plus one `how` line on sizing and colour.
- `ready/palettes.json`: the 37 palettes, values untouched, each with name, title, `kind` (`scale` or `set`, see 3), source link, light and dark; the 12 step roles; the rights line.
- `ready/icons/{thin,light,regular,bold,fill,duotone}.json`: each icon's name and the inside of its SVG, exactly as in the package. `ready/icons/index.json`: every icon's name, search words, categories, and its older name where the package gives one, plus the package's MIT notice.
- `ready/NOTICE.md`: where each thing came from, both MIT notices in full with their authors, and what `RIGHTS.md` says about the colour values.
- `scripts/pack-icons.ts`: turns an unpacked copy of the package into the seven icon files. It reads files as text only and refuses a package whose icons don't open and close like 2.1.1's.
- `server/ready.ts`: reads the files (once each, kept in memory) for the tool and the page; the icon search; the whole `get_ready_made` answer.
- `web/src/Ready.tsx` and `web/src/ready.css`: the Ready-made page (its own CSS file, the way Fonts has `fonts.css`, so `styles.css` is untouched).
- `tests/ready.test.ts`: 8 tests.

Small blocks added to shared files: see 8.

Done differently from the plan, and why:

- **Not every palette has 12 steps.** The plan says 37 scales of 12 light and 12 dark steps. The data has 16 such scales (gray, slate, red, blue, green, yellow, orange, purple, pink, cyan, teal, indigo, amber, lime, mint, tomato); the other 21 are sets of 5 to 10 colours (forest has 5, sand 5, olive-garden 6, steel 9, deep-sea 10, the rest 8). I kept all 37 exactly as collected and marked each `scale` or `set`. The test checks 12 + 12 for every scale and 5–10 (light and dark the same count) for every set.
- **What the 12 steps are for doesn't come from `PALETTES.md`.** That file says the opposite: "Step numbers below are sequence positions, not inferred semantic roles." The roles (page background, subtle background, … high-contrast text) come from the same collection's `better-colors` skill (`palette-structure.md`, Radix's 12 roles, MIT). They're given for the 12-step scales only; a set is "colours in order, with no role for each step". `NOTICE.md` says where the roles come from.
- **Size.** The original's default is 20px; the pieces use `var(--ld-size, 1.25em)`, which is 20px in 16px text and otherwise follows the text, as the plan asks.
- **Not only SVG.** 16 of the 36 originals are built from `<div>`s, not an SVG (atom, blocks, bouncing-dots, classic, comet, eclipse, flip, gather, leap, linear-dots, morph, orbit, ripple, slide, swirl, wave). They stay `<div>`s: rebuilding them as SVG would change them.
- **The page draws icons from their outlines**, not as pictures. A CSS mask per icon scrolled at about 25 ms a frame; drawing each from its path data (`d`, and `opacity` for duotone) runs at the screen's own rate. Only outlines reach the page: a drawing that isn't purely `<path d="…">` draws nothing (all 9,072 are).
- **Copying falls back** to the older select-and-copy way when the browser refuses clipboard access. Claude's browser pane refuses it outright (permission "denied"), so without this nothing could be copied there. Panel's other copy buttons don't have the fallback.
- **"Colors" on screen, not "Colours".** Panel's own labels say Color (the canvas topic, the knobs). FRIDAY's text says "colour" as the plan wrote it.
- The search words drop the package's `*new*` and `*updated*` markers, which mark versions, not meanings.

## 2. The 36 animations

Every piece was written from its component and the helpers it uses (`motion.ts`, `easing.ts`, `fade.ts`, `cap.ts`, `frame.tsx`) with the default options. I re-typed those helpers in a small generator of my own (in my scratch space, not in the project) and copied each component's CSS template into it, so durations, delays, curves and keyframes are the original's to the digit; values the original works out in code (cascade's dash lengths, trace's perimeter, gather's 21.1%, slide's 158.8%, phases' 20.5px) are worked out by the same expressions. Nothing from the collection was imported or run.

"Checked" below: **browser** means every animated element's duration, delay, curve, count and direction were read in the browser (`getComputedStyle`) on one page with all 36 pasted in, and compared with the value worked out from the source (delay = duration × (step − count) ÷ count). All matched. **source** means transcribed and looked at moving, not read back value by value.

| Name | What it looks like | ms | Checked |
| --- | --- | --- | --- |
| arc | A single open stroke rotating in a circle. | 800 | source |
| atom | Three rings tumbling inside a circle. | 1000 | source |
| blocks | Nine blocks shrinking and growing in a sweep across a grid. | 1300 | browser: 9 cells, −1.3 −1.04 −0.78 −1.04 −0.78 −0.52 −0.78 −0.52 −0.26 s, ease-in-out |
| bouncing-dots | Three staggered dots bouncing up and down. | 500 | source |
| cascade | Three nested arcs fanning into a spiral and snapping back in line. | 1500 | browser: −1.5 −1.4375 −1.375 s, cubic-bezier(0.68, −0.75, 0.265, 1.75) |
| chevrons | Three chevrons lighting up in turn, pointing forward. | 1000 | source |
| circular-dots | Eight dots in a ring, the brightest hopping around. | 800 | browser: −0.8 … −0.1 s, linear |
| classic | Twelve fading bars arranged in a radial pattern. | 1200 | browser: 12 bars, −1.2 … −0.1 s, linear |
| classic-v2 | Two lit ticks stepping around a ring of eight. | 800 | browser: −0.8 … −0.1 s, linear |
| clock | A clock hand sweeping around a faint face. | 1200 | source |
| comet | A full ring fading into its tail. | 700 | source |
| compass | Four ticks turning a quarter turn at a time. | 500 | source |
| dual | Two arcs turning in opposite directions. | 1000 | source |
| eclipse | Two dots trading places, one passing behind the other. | 1200 | browser: two animations each (slide, depth), −1.2 and −0.6 s, ease-in-out |
| fill | A circle filling clockwise like a pie, then emptying. | 1600 | source |
| flip | A square flipping over on one axis, then the other. | 1200 | source |
| gather | Four blocks pulling together, turning, and pushing apart. | 1600 | browser: group turn + 4 pulls, no delay, ease-in-out |
| leap | Three dots in a row, the last one leaping to the front. | 1800 | source |
| linear-dots | Three dots lighting up in turn from left to right. | 900 | source |
| loading | The loading.dev mark, its brightest block circling the ring. | 1000 | browser: −1 −0.875 … −0.125 s, linear |
| loop | A dash running along a figure-eight. | 1600 | source |
| morph | A square rounding into a circle and back as it turns. | 1200 | source |
| orbit | A fading half-arc rotating around a dot. | 750 | source |
| phases | A moon moving through its phases. | 3000 | source |
| pulse | A ring rippling outward from a dot. | 1200 | source |
| radar | A fading beam sweeping around a faint dish. | 1500 | source |
| ring | An arc rotating in a faint circle. | 800 | source |
| ripple | Three rings spreading out from the center. | 1200 | source |
| scan | A line sweeping down a page and back up. | 1800 | source |
| slide | Three dots sliding into the empty corner of a square. | 2400 | browser: −2.4 −1.6 −0.8 s, ease-in-out |
| snake | An arc stretching and shrinking as it circles. | 1400 | source |
| split | A dot splitting in two and merging back. | 1400 | source |
| steps | Four segments lighting up in turn, then clearing in turn. | 1600 | browser: slots 8, −1.6 −1.4 −1.2 −1 s, linear |
| swirl | A bright cell chasing its trail around a square. | 1200 | browser: places 0,1,2,7,3,6,5,4 → −1.2 −1.05 −0.9 −0.15 −0.75 −0.3 −0.45 −0.6 s, linear |
| trace | A dash tracing the outline of a rounded square. | 1200 | source |
| wave | Five bars rising and falling in a wave. | 900 | browser: −0.9 −0.72 −0.54 −0.36 −0.18 s, ease-in-out |

The lines are the first line of each component's page on loading.dev (in the collection's `docs/loading/`). The source never says what one suits, so no piece has a "suits" line.

What could not be carried over exactly:

- **Options are left at their defaults**: round caps, linear spin, blocks' diagonal sweep, steps' single row, wave from the centre, ripple outward. The CSS for the other easings, sweeps, `ld-ripple-ring-in` and `ld-wave-bar-bottom` is kept as the original has it, so a class swap still works where only a class differs.
- **phases and radar** used React's `useId()` for their mask and gradient. They now use fixed ids (`ld-phases-mask`, `ld-radar-beam`). Two of the same on one page share the first one's mask or gradient: they still look the same, unless the second is a different colour (radar's beam would take the first's colour). Rename the id in the second when that matters.
- React put each style in the page once, however many copies; pasted twice, the same `<style>` is there twice. Harmless.
- The original's `color`, `duration` and `playState` props are its CSS variables and `color` here: `color: …`, `--ld-duration`, `--ld-play-state`.
- Every piece keeps the original's reduced-motion rules: the shared one (`animation: none` on the piece and everything in it) and each component's own resting state.

Pictures: `.copy/ready-all-loading-1.jpg` and `-2.jpg` (all 36 on one page, a moment apart; they move), the page itself at `.copy/ready-all-loading.html`, the values read back in `.copy/ready-timings-check.txt`.

## 3. The colour scales

37 palettes from oklch.fyi, values exactly as collected (checked against `data/palettes.json` one by one): 16 scales of 12 steps, with different light and dark steps, and 21 sets of 5 to 10 colours. In 7 of the sets (deep-sea, forest-fresh, neon-nights, midnight-blue, autumn-leaves, tropical-paradise, berry-burst) light and dark are the same values.

The 12 steps, as Radix and the `better-colors` skill use them: 1 page background, 2 subtle background, 3 component background, 4 component hover, 5 component active or selected, 6 subtle border or separator, 7 border or focus ring, 8 hovered border, 9 solid fill (the colour itself, buttons), 10 solid fill hover, 11 low-contrast text, 12 high-contrast text. Each mode's step plays the same role, so step 9 is the same value in light and dark for every scale.

Odd in the data: the step counts above; nothing marked "unknown" mode; no values outside `oklch(L C H)`. Gamut and contrast are not certified by the source, and I didn't check them.

## 4. The icons

1,512 icons in each of 6 weights (9,072 drawings), from `@phosphor-icons/core` 2.1.1. Files: thin 706 KB, light 706 KB, regular 660 KB, bold 657 KB, fill 581 KB, duotone 842 KB, `index.json` 190 KB; 4.2 MB in all.

Search words and categories come from the package's catalogue, read as text from `dist/icons.d.ts` (its type declarations list every icon with its tags and categories as plain text; category names from `dist/types.d.ts`). Nothing of the package's code was run. Every icon has search words and at least one category; 18 have an older name (`caduceus` is now `asclepius`, `archive-box` is `box-arrow-down`…), which the search also finds.

Every one of the 9,072 drawings was compared with its file: all identical. Twenty were also checked through `get_ready_made` itself, character for character (`.copy/ready-icons-check.txt`): trash (regular), gear (thin), house (light), user (bold), bell (fill), heart (duotone), magnifying-glass (regular), arrow-right (thin), upload-simple (light), file (bold), check (fill), x (duotone), cloud-arrow-up (regular), toggle-right (thin), floppy-disk (light), note (bold), calendar (fill), lock (duotone), paper-plane-tilt (regular), dots-three (bold). All 20: the drawing identical, the opening tag the package's own plus `width="1em" height="1em"` and `aria-hidden="true"`.

Line thickness, measured from the icons' own shapes (minus, trash) on their 256 grid:

| Weight | On the grid | At 16px | At 24px |
| --- | --- | --- | --- |
| thin | 8 | 0.5px | 0.75px |
| light | 12 | 0.75px | 1.125px |
| regular | 16 | 1px | 1.5px |
| bold | 24 | 1.5px | 2.25px |
| fill | solid shapes | | |
| duotone | regular's 16, plus a 20% filled shape | 1px | 1.5px |

Find quality, from `find_icons`: trash → trash; settings → wrench, gear, gear-six; search → magnifying-glass; arrow right → arrow-right; home → house; done → check; menu → dots-three (the package files "hamburger menu" under list, which comes later). "close" finds arrows-in-line first and x fifth, because the package tags x as "closed", not "close". An earlier word in an icon's own list counts for more.

## 5. The download

One download, as approved: `https://registry.npmjs.org/@phosphor-icons/core/-/core-2.1.1.tgz` (1,443,064 bytes, SHA-1 `62a4cfbec9772f1a613a647da214fbb96f3ad39d`), fetched with curl into a new empty folder in my scratch space (`…/scratchpad/phosphor-dl/`), outside the project, and unpacked there: 9,080 files, 6.15 MB of content. My own scripts were in a separate folder. Nothing else was downloaded. After the checks the whole folder (the .tgz and the unpacked copy) was deleted; only my own scripts are left in scratch.

## 6. The two sketches

Two rounds: the plan's two messages as asked, then (with the designer's yes) the same two again after one change to FRIDAY's own instructions.

### First round, as the plan asked

**The short answer: FRIDAY didn't use the ready-made parts in either one.** Both ran on the copy with one model (Opus 5.5, effort high), each in a new conversation with no project. Saved: `.copy/ready-friday-1.json`, `.copy/ready-friday-2.json` (the whole conversations, with every tool call), `.copy/ready-friday-1-sketch.html` and `.jpg`.

**1. "Sketch a file upload screen…"** (130 s). FRIDAY called list_projects, get_verdicts, get_project (twice), get_sketch, get_project_material (three times, for the spec's file limits), make_sketch and edit_sketch. **It never called get_ready_made.** Since a sketch needs a project and there was none, it chose HUJJAT and said so. The page is good: the drop area is HUJJAT's own cut-corner sheet, the file icons are small copies of that sheet in CSS (`clip-path`), and the file still uploading shows "Загружается, 62%" with a line growing along its row. So:
- loading: none taken. It didn't draw a spinner either; progress is a line and a percentage, which suits a file upload better than a spinner would.
- colours: none taken; the project has its own.
- icons: none taken, no SVG in the page at all. The file icons are drawn by hand in CSS, but as the brand's own document shape, which the project's decisions call for. No emoji.

**2. "Sketch a small settings page for a notes app… pick calm colours"** (20 s). FRIDAY called list_projects and get_verdicts, then stopped to ask which project to put it on: none of the three fits a notes app, and it can't make a project. It made no sketch. In its plan it **picked colours of its own** (#EEF1EC, #1F2A24, #5E7F6B), the very case where a colour scale was meant to be the starting point, and didn't look at get_ready_made.

Why: the plan put the new lines in `INSTRUCTIONS` in `mcp-tools.ts`, the text any AI app gets from Panel's MCP server. FRIDAY runs with its own system prompt (`SYSTEM` in `chat.ts`), which describes making sketches in detail and said nothing about ready-made parts; the tool's one-line description alone didn't make it reach for them.

### Second round, after telling FRIDAY itself

The change: one bullet in FRIDAY's sketch instructions (`SYSTEM` in `chat.ts`, after "Pass uses"), saying in its own words what `INSTRUCTIONS` says: get the parts a sketch needs before writing it, a loading state uses one of the animations, every icon comes from Panel's icons (all found in one call), one weight a page, brand icons first, a colour scale only when the project has no colours of its own. The copy was restarted to pick it up. So the second message had somewhere to land, I added an empty project "Notes" on the copy first; both messages were word for word the same, each in a new conversation with no project. Saved: `.copy/ready-friday-rerun-1.json`, `-rerun-2.json`, and each sketch's page and picture (`.copy/ready-friday-rerun-1-sketch.html` / `.jpg`, `-rerun-2-sketch…`).

**Both called get_ready_made, before writing the page, the way the instructions say.**

**1. File upload** (140 s), put on Notes. Calls: the list; `find_icons` once for all nine icons it needed; `icons` for eight of them; `palette: slate`; `loading: ring`; then make_sketch and one edit.
- Loading: the **ring** spins beside "Uploading 63%". Its markup is in the page character for character; its CSS was put on single lines but every value is the same (800 ms, linear, the reduced-motion rule kept). It's sized with `--ld-size: 13px`, as the tool says.
- Icons: 13 in the page (15 SVGs, two of them the ring), all Phosphor regular (one weight, as asked). 10 are character for character what the tool gave (cloud-arrow-up, file-pdf, check-circle ×3, trash ×3, x ×2). 3 (file-image, file-xls, and a second file-pdf) have the same shapes but a few numbers written with a trailing zero (`13.32` became `13.320`), so they draw exactly the same but aren't the same text. No icon drawn by hand, no emoji.
- Colours: Notes has none, so it started from **Slate**: two of its steps exactly (1 and 3 as the page and card backgrounds), and greys of its own in the same hue (256) for text, plus one blue and one green of its own for progress and "uploaded". It said so in its reply.

**2. Settings page** (110 s), put on Notes. Calls: the list; `palette: sand` and `palette: teal`; `find_icons` once; `loading: arc`; `icons` for eight; then make_sketch, one edit, and two looks at its other states.
- Loading: the **arc** spins in the Save button while saving. Its CSS and markup are both in the page character for character.
- Icons: 7 in the page (8 SVGs, one of them the arc), all regular. 4 are what the tool gave exactly (caret-left, lock, warning-circle, check). 3 (cloud-check, bell, moon) have the same trailing-zero slips. No hand-drawn icon, no emoji.
- Colours: it read Sand and Teal but used **none of their values**. It wrote a warm paper and sage palette of its own in their hues (85 and 165). Not what the instructions ask ("start from one of its colour scales"), though it follows them in spirit. Sand is one of the 5-colour sets, not a scale, which may be why it set it aside.

Both pages: see `.copy/ready-friday-rerun-1-sketch.jpg` and `-2-sketch.jpg`.

My read: yes, the parts made these pages better. Compared with the first round, the icons are a real set at one weight, sitting on the text line, instead of nothing or CSS shapes; the waiting states move with a tested animation instead of only a bar or nothing, and stop for people who ask for less motion. The pages look calm and of a piece. Two things to watch:
- **Copying long numbers.** 6 of the 20 icons came back with `13.320` for `13.32`. They look identical, but it shows FRIDAY retypes the drawings rather than pasting them. A later step could let a sketch say `<panel-icon name="trash">` and have Panel put the drawing in, so nothing is retyped.
- **Colours.** In the second message it read two palettes and then made its own. If the designer wants the scales used as they are, the line could say "use its values as they are".

One thing that isn't the parts: in both rounds FRIDAY said one of the designer's fonts didn't load. That's my copy, not Panel: the copy steps (`copy.sh`, which I followed by hand) don't copy the `fonts/` folder, so the files are missing there. The real Panel has them.

## 7. Checks

- `bun run typecheck`: clean.
- `bun test tests`: 174 pass, 0 fail, across 20 files (8 of them new in `tests/ready.test.ts`). Again after the change to FRIDAY's instructions: 173 pass, 1 skipped, 0 fail. The skipped one is the Figma test, which skips itself when it can't reach the internet.
- `PANEL_PORT=4798 PANEL_LIBRARY_DIR=.copy/lib-ready bun scripts/measure-search.ts`, before and after: every search line and every `ORDER` line the same. `TOOLS` before: 28 tools, 31,533 characters (about 9,854 tokens). After: 29 tools, 32,440 characters (about 10,138 tokens). It grew by 907 characters, exactly the new tool's definition plus its comma. The instruction lines added to `INSTRUCTIONS` are read once per conversation too, but aren't counted in `TOOLS`; they are 694 characters with their line break. Files: `.copy/ready-measure-before.txt`, `.copy/ready-measure-after.txt`.
- Scrolling all 1,512 icons at 120px a frame: 8.3 ms median, 9.0 ms at the 95th, 16.6 ms at worst, the same as the page sitting still (8.3 ms, a 120 Hz screen).

## 8. Working beside the other session

I never ran `scripts/copy.sh`; my copy was made by hand into `.copy/lib-ready` with the same steps (the `.backup` of the real database opened read-only, the cloned folders, the same settings so nothing is read or downloaded by itself). I stayed out of every skills file, `Detail.tsx`, `Grid.tsx`, `Canvas.tsx`, `canvas.css`, `Review.tsx`, `projects.ts` and `board.ts`.

Shared files I touched, each with one small block and nothing else:

- `server/mcp-tools.ts`: one import line; one bullet in `INSTRUCTIONS` (after the skills line); the `get_ready_made` tool, placed after `get_brand_assets`.
- `server/index.ts`: one import line; one block of read-only routes (`GET /api/ready`, `GET /api/ready/icons/<weight>`, `GET /api/ready/loading/<name>`, the last as plain text) just above the fonts routes.
- `server/chat.ts`: `get_ready_made` added to `READ_TOOLS`, the tools the planner may use when two models answer (with one model FRIDAY already has every Panel tool). In the second round, one bullet in `SYSTEM`'s sketch section (after "Pass uses"); this goes beyond the plan, with the designer's yes.
- `web/src/api.ts`: one block after `fontApi` (types and `readyApi`).
- `web/src/App.tsx`: the import, the `ready` scope, its place in the main area, the dock and the title, and the sidebar link under Fonts.
- `.claude/launch.json`: the `panel-copy-ready` entry.
- `web/src/styles.css`: not touched.

Failures that weren't mine: none. The type check and the whole test suite passed every time I ran them. One mistake of mine, fixed: the first UI build went to `web/.copy/dist-ready` (Vite builds from `web/`), and I removed that folder and built to `.copy/dist-ready` by full path.

## 9. Doubts, and what the next step should know

- **FRIDAY needed telling in its own instructions** (see 6). That's done; anything that changes how FRIDAY works belongs in `SYSTEM`, not only in `INSTRUCTIONS`.
- **Let Panel insert the drawings.** FRIDAY retypes long path numbers and sometimes adds a zero. Harmless today, but a placeholder Panel fills in (an icon or loading piece by name) would make "exactly as given" certain and the sketch shorter for FRIDAY to write.
- **The plain pieces or the packages, for real builds?** For a sketch, the plain pieces are right: one file, no build, no React. For a real build in React, the original `loading-dev` package gives the options (cap, easing, sweep, rows, origin, direction), the unique ids, styles put in once, and its updates; prefer it there. For icons, `@phosphor-icons/react` (or the web components) gives the same drawings with props; for a site without a framework, the SVGs `get_ready_made` gives are already right. Either way a build should copy the licence notices.
- **Which weight with which text weight**, from the line thickness above: at 16px, regular (1px) sits with regular or medium text (400–500), light (0.75px) with light text (300) or large quiet type, bold (1.5px) with semibold or bold text (600–700) and small sizes where 1px looks weak; thin (0.5px) only at 24px and above, where it reaches 0.75px; below that it falls under a device pixel on a 1× screen. Fill to mark the active item, as the instructions say; duotone where the page is illustrative rather than a tool.
- `find_icons` ranks by the package's own words. It's good for common words, weaker where the package's words differ from ours ("close", "menu"). A short list of our own synonyms would help if FRIDAY keeps missing.
- FRIDAY's step line shows the tool as "get ready made"; `Assistant.tsx` has no friendlier label for it. I left that file alone; it isn't in the plan.
- The real Panel serves none of this until it's restarted, and the `ready/` folder ships with the code: 4.3 MB, almost all icons.

## 10. Note for the designer

There's a new page in Panel's sidebar, **Ready-made**, under Fonts. It has three parts. Loading: 36 loading animations playing; click one to see it large and copy it. Colors: 37 colour palettes, in light and in dark; click a swatch to copy it. Icons: 1,512 icons in six weights, with a search; click one to copy it. FRIDAY now uses them in sketches: in the last two tries it took a loading animation for the waiting state, all its icons from Panel at one weight (no drawn icons, no emoji), and started from a palette when the project had none. It sometimes makes up its own colours after looking at a palette. Your real Panel doesn't have any of this until it's restarted, and nothing was committed.
