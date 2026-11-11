# The canvas, reworked: report

Written 11 Nov 2026 by the session that carried out `docs/canvas-rework-plan.md`. Everything
below was done on the copy (`.copy/lib-canvas`, UI in `.copy/dist-canvas`, port 4777). Nothing
was committed, the real library and port 4646 were not touched, and Claude was called zero
times.

**Two things about how it was checked, before anything else.**

- The app's browser pane was *hidden* the whole time. In a hidden pane the page's animations
  run throttled and screenshots lag a step behind, so I checked almost everything by
  measuring the page (positions, sizes, counts) and the database, not by eye. Where I made
  motion instant to measure (by replacing `matchMedia` in the page so `prefersReducedMotion()`
  said yes), I say so. **No motion was judged by eye.**
- Partway through, someone in **Google Chrome** opened my copy on 4777 too (6 connections from
  Chrome) and dragged the Direction topic three times (events 340, 341, 346, client
  `600602eb…`). Those are not mine; I left them as they are.

## 1. Where it stands

- **Package 1, saying no counts:** done.
- **Package 2, a topic holds its saves:** done. (Lines already passed behind cards; see 2d.)
- **Package 3, a canvas you can read from far away:** done. Small map in, at all three widths
  it sat clear of the dock and FRIDAY's panel where I measured it (1728 not measured, see 4).
- **Package 4, lighter tools and names:** done. The several-selected toolbar's width was not
  measured.
- **When all four are in:** typecheck and tests pass; README updated; older app checked by
  reading. The walk was done at 1440 dark with FRIDAY open, with differences listed in 4; the
  other widths and light mode were checked by measuring layout, not by walking.

## 2. What changed

- `server/projects.ts`: the new table `board_turned_down` (created at start, add-only).
  `apply()` writes a record when the designer removes a suggested or ruled-out save or sketch
  (not on an undo), with the topic it sat under (read before anything in the change is
  deleted); `add_node` deletes the record of a card brought back by ⌘Z, and the designer adding
  a save again (not an undo) clears its records in that project. New `setTurnedDownReason()`,
  `removedUnder()`. `verdicts()`, `verdictReasons()` and `summary()` read the records.
- `server/board.ts`: `placeOnBoard()` skips saves removed from the same topic and answers
  `removed_before`, with a sentence added to `note`.
- `server/index.ts`: `POST /api/projects/:id/turned-down` (`{ nodes, reason }` → `{ ok, n }`),
  inside the existing `fromPanel` guard. Only the route regex, the import and the new branch.
- `server/chat.ts`: one clause added to the "reasons are their taste" line (line 317).
- `server/mcp-tools.ts`: place_on_board's description: "Saves already under that topic, or that
  the designer took off it, are skipped." (+35 characters.)
- `web/src/api.ts`: `projectApi.whyRemoved(id, nodes, reason)`.
- `web/src/Canvas.tsx`: the "why?" strip after removing; the two strip bugs; folding ruled-out
  saves under any topic; Review wired in (dock button with the count, the notice's **Review**,
  key **R**, canvas keys off while it's open); `familyOf()`; family drag with Option to move
  alone, sent as one change; `glide()` (cards glide to new places: Tidy, and moves arriving from
  another window or from ⌘Z); Tidy; zoom limit 0.05; Shift+1/2/0; zoom readout; the far view
  (`useStore` yes/no, `--z` set straight on the wrapper from `onMove`, topic labels, double-click
  to glide in); "Nothing here"; the small map; icon-only tools with a hairline; a name on every
  card (`ariaLabel`).
- `web/src/canvas.css`: styles for all of the above, each new motion inside a
  `prefers-reduced-motion` block; the "why?" strip now wraps when the canvas is narrow; a selected
  or hovered line comes in front of cards.
- **New** `web/src/Review.tsx`: Review.
- **New** `tests/canvas.test.ts`: the nine tests.
- `README.md`: only the "Projects: a canvas per piece of work" part (7 lines added).
- `.claude/launch.json`: one line, `panel-copy-canvas` on 4777.

## 3. Done differently from the plan, and why

1. **Before changing anything, step 3** (looking at HUJJAT on the copy) was done after the
   first server changes, not before. Steps 1 and 2 were done first.
2. **Building the copy's UI**: `bunx vite build --outDir .copy/dist-canvas` builds into
   `web/.copy/dist-canvas` (Vite's root is `web/`). I deleted that stray folder and build with
   `--outDir "$PWD/.copy/dist-canvas"`.
3. **`get_verdicts`**: `suggestions_removed` is `{ count, latest: [up to 12 lines] }`, present
   only when there are some, instead of a number and a separate list. Records that were ruled
   out (or have a reason) also count in `without_a_reason` when they have none.
4. **`get_project`**: in `removed_by_designer`, a sketch is `{ sketch: <id>, title }` instead of
   `id` (FRIDAY's panel reads `id` as a save to show, see the comment in `getSketch`). A record
   whose topic is no longer on the canvas goes in the top-level list with `was_under: <name>`.
   One entry per save per topic (the latest).
5. **Adding a save clears its records** only when the designer adds it themselves; ⌘Z bringing a
   card back clears only that card's record. Otherwise undoing one removal would also forget the
   same save's removal from another topic.
6. **`place_on_board`**: the "took these off this topic before" sentence is appended to the
   existing `note` field rather than a field of its own.
7. **The tool description** for place_on_board was changed (+35 characters): "Saves already
   under that topic are skipped" was no longer the whole truth.
8. **The "why?" strip wraps onto a second line** when the canvas is narrow. With FRIDAY's panel
   open at 1440 the strip was 740 px and its text field ran under FRIDAY's panel (my click
   landed in FRIDAY's composer; nothing was sent, I checked `chat_messages`).
9. **Review**: a verdict key (K, C, X) pressed while the reasons are showing moves on without a
   reason; it does not judge the next card unseen. Choose and Rule out in Review always set that
   verdict (no toggling back to Kept as on the canvas). The list includes suggestions folded under
   a locked topic. ⌘Z after a verdict *with* a reason takes back two changes (the reason and the
   verdict), so one ⌘Z takes back the whole verdict.
10. **Review, website saves**: a site's first picture is its whole page; fitted whole it was a
    thin strip. A picture more than 2.2× taller than wide fills the width (up to 980 px) and
    scrolls instead: still whole, never cropped. GIFs (kept as video) show their thumbnail.
11. **Review's side column** narrows (248–320 px) so the picture keeps room at 1280 with FRIDAY open.
12. **Toolbars**: Lock/Reopen keeps its word (it's the topic's decision), with the hairline after
    it. The build card's tools became icons too; "Continue in terminal" shows a check icon (name
    "Copied") for a moment instead of the word.
13. **Far view**: sketches also become plain pictures (words and badges fade), like saves.
14. **Far view topic labels** are plain words with a soft halo of the page colour, not a chip:
    at "Show everything" with FRIDAY open (9%) the three-column width is only 63 px and the chip's
    padding left 45 px, so "Typography" was cut to "Typo…". Now the size eases from 13.5 px down to
    11 px when room is tight, and a name may wrap onto a second line ("Interface / demo"). The
    label sits over the topic card and grows upward and to the right.
15. **Far view: a topic's toolbar is hidden.** It popped up over the label, so the second click of
    a double-click hit **Note** and added an empty note (I removed it). From far away a click
    selects and a double-click glides in; the tools come back up close.
16. **Tidy starts below anything that stays put right under the topic** (a note on the topic, a
    sketch). On Direction the first row landed on the topic's own note; the plan says those notes
    aren't moved, so the block now starts below them.
17. **Option to drag a topic alone** is also read from the keys themselves (keydown/keyup), not
    only the drag's own event, in case the event doesn't carry it.
18. **Moves arriving from elsewhere glide** (another window, or ⌘Z putting a family back) instead
    of jumping. Added so "⌘Z until it's back" doesn't jump.
19. **2d. Lines already passed behind cards.** I sampled 87 points where lines cross cards they
    aren't joined to, with nothing selected and with Color selected: a line was on top 0 times
    (React Flow paints every line's own `<svg>` at z-index 0 before the cards; a selected card is
    raised to 1000). What was seen on HUJJAT is most likely cards lying *on top of each other*
    (Color's "No blues" note half covers a sketch) and long lines running through the gaps. I added
    the plan's exception: a selected or hovered line comes in front (`z-index: 1001` on its svg).
20. **The small map** is hidden while "Nothing here" shows, and on an empty canvas.

## 4. Each "Done when" line, with its result

### Package 1 (HUJJAT, 1440 × 900, dark)

- *Select a suggested save, press Backspace: the strip says "Removed a suggestion · why?"; press
  1; sqlite shows the row with the reason. ⌘Z: the card is back and the row is gone.*
  **Pass.** Strip text "Removed a suggestion · why?". After 1: `proposed|Color is off|Color`
  (node `d36c65ad030d4346`). After ⌘Z: the card is in the page again, `count(*)` = 0.
- *Press X on a save under Color: it folds into the topic, which now says "1 ruled out"; clicking
  that shows it again, greyed. ⌘Z brings it back as it was and the strip is gone.*
  **Pass, with one difference:** Color already had one ruled-out save on this copy, so after X it
  read **"2 ruled out"** (before X it read "1 ruled out", folded). Clicking showed both greyed with
  "Fold 2 ruled out". ⌘Z: the card was "Suggested" again, the count back to 1, no strip.
- *Review opens with the right count, every key works, a reason given there is on the card
  afterwards, ⌘Z steps back, the last card ends on the summary.*
  **Pass, except ← was only checked as the Back button's state, never pressed.** Opened with
  "1 of 31" (dock said Review 31). Tried: K, C, X, 1–5, own words + Enter, → (30 times to the
  end), O (opened the save in Detail; Esc closed Detail only, Review stayed), Esc. Reasons on the
  cards afterwards: `b23d68ec24654c01 chosen "The color"`, sketch `60d4a96560dd48e3 ruled_out
  "Too generic"`. ⌘Z after X + reason: two undo events (318, 319), back to "2 of 29", card
  suggested again; later in the walk the same from "4 of 26" to "3 of 26". The end: "That's all of
  them · 29 still suggested · Done". The strip's 12-second timeout is paused while Review is open.
- *All nine tests pass; TOOLS grew by 150 characters at most.* **Pass.** 9/9; +35 characters.

### Package 2

- *Drag the Direction topic 300 px to the right: its 14 saves and their notes move with it, the
  same distance. project_events grew by exactly 1. One ⌘Z puts everything back.*
  **Pass.** One change moved 17 cards (1 topic, 14 saves, 2 notes), every one by exactly
  (+500, 0) units; `select count(*) from project_events` went 429 → 430. (The drag tool moved the
  pointer 300 px of the emulated page, which came to 500 units at zoom 0.3 in the scaled pane.)
  ⌘Z: `d48f…` back at (2499.4, −854.8), its saves back at their old places.
- *The same with Option held: only the topic moves.*
  **Fail with the test tool, pass with real Option events.** The tool's drag didn't hold Option
  (the change moved all 17). Dispatching mouse events that carry Option: one change, one op, the
  topic alone (seq 324). I then added the keyboard fallback (3.17); a real Option drag by hand
  was **not tried**.
- *Tidy on Direction: its saves sit in three columns under it, none overlapping another, in the
  stated order; one ⌘Z undoes it.* **Pass.** 14 saves in three columns (651 / 721 / 792 px on
  screen), 0 overlaps among them and 0 with anything else (after fix 3.16; the first try overlapped
  the topic's own note), one event; ⌘Z put them back. All 14 were suggested, so the order is their
  reading order. On Color in the walk: chosen, chosen, kept / kept, ruled out, ruled out.
- *No line is drawn over a card it merely crosses.* **Pass (already so before):** 0 of 87.

### Package 3 (HUJJAT, 1440 × 900)

- *"Show everything" with FRIDAY's panel open: every card inside the visible canvas.*
  **Pass.** Zoom 9%; canvas 252–1032 px, rightmost card edge 954 px; 0 of 58 cards outside.
  (Panel closed: 14%, 0 outside.) The first Shift+1 right after a load read 21% with 15 outside a
  second later; I believe that was the throttled animation still running, every later try fitted.
- *At that zoom all six topic names can be read, none overlapping, each at 11 px or more.*
  **Pass after change 3.14.** All six whole (none cut), 11.0 px on screen, 0 overlaps. Before the
  change: 13.4 px but "Typography" cut at 63 px.
- *Zooming in and out across the line shows no jump in any card's position, and no errors.*
  **Pass.** All 58 cards had the same size and transform at 9% and at 100%; console: no errors.
- *Pan far away: "Nothing here" appears; its button brings the canvas back.* **Pass.** At view
  (−60000, −60000): "Nothing here · Show everything"; after the button: 9%, 0 cards outside.
- *Shift+1, Shift+2 and Shift+0 do what they say; the readout matches the zoom.* **Pass.**
  Shift+2 with Direction selected: all 17 of its family inside the view at 18%; with a sketch
  selected: framed at 100%. Shift+0: readout "100%", viewport `scale(1)`. Double-click on Color in
  the far view: glided in to its family (9% → 20%).

### Package 4

- *A selected save's toolbar is 440 px wide or less, and every icon says what it is on hover.*
  **Pass.** 387 px (was 645). Choose, Keep, Rule out in words; Sketch, Ask FRIDAY, Note, Open,
  Remove as icons, each with `title` and `aria-label`. Topic toolbar 263 px. **Several-selected
  toolbar not measured** (selecting two by keyboard didn't work in the test browser); by its parts
  it should be about 430 px.
- *Reading the page's tree lists the cards by name.* **Pass.** e.g. "Topic: Typography, locked",
  "Save: Legora, chosen", "Save: The multi-format Devin/Cognition ad campaign (a street billboard,
  Tim…, suggested", "Note: No gradients. Flat colors only." Long titles are shortened so the
  verdict at the end is never cut off.

### When all four are in

- *typecheck and tests pass.* **Pass.**
- *The walk, 1280/1440/1728, light and dark, FRIDAY open and closed.* **Partly.** Walked at
  1440 dark, FRIDAY open: Show everything → double-click Color → X + reason 4 (folded, "2 ruled
  out") → removed a suggestion and typed "Dashboards are off brief" (record saved with it) →
  Review: K, C + 3, X + own words, ⌘Z (both taken back), Esc → Tidy Color → drag Color (13 cards,
  one change, same distance) → ⌘Z six times (events 352–357, each undoing the right one). No console
  errors. Differences: I reloaded once in the middle (the pane closed itself), and from Tidy on I
  selected cards by keyboard focus + Enter and dragged with mouse events, because screen
  coordinates were unreliable after the pane changed shape. At **1280** and **1728** (FRIDAY open)
  I measured: everything fits (7% / 12%, 0 outside), the dock stays inside the canvas and off
  FRIDAY's panel, Review's frame (1280: 276–848) and the small map (1280: 690–858 × 600–708) stay
  clear of the dock and the panel, topic labels don't overlap. **Light mode**: looked at the far
  view at 1440 only. FRIDAY closed: only at 1440.
- *With reduced motion on, nothing slides or fades.* **Not tried in the browser** (the tools can't
  switch the CSS media query). Checked in code: every new animation and transition is in a
  `prefers-reduced-motion` block; glide, fits, Tidy and Review's closing go instant through
  `prefersReducedMotion()` (that path I did use, by forcing it in the page, for measuring).
- *Open CRM and NavTech too.* **Pass as far as measured:** both load, cards named, Review counts
  14 and 21, NavTech's Color shows "1 ruled out" (one was already ruled out there and now folds),
  no console errors. The screenshots caught them mid-entrance, so I didn't judge the look.
- *The older app still draws the canvas.* See 6.
- *README.* Done, Projects part only.

## 5. Numbers

- **TOOLS**: before 30,797 characters (27 tools, ~9,624 tokens); after **30,832** (+35).
- **Typecheck**: clean before and after.
- **Tests**: before `79 pass, 0 fail` (13 files); after **`88 pass, 0 fail`** (14 files).
- The nine new tests (`tests/canvas.test.ts`, "saying no counts"):
  1. removing a suggested save leaves a record, with its topic
  2. ⌘Z brings the card back and the record goes
  3. removing a kept save leaves no record
  4. removing a save ruled out with a reason keeps the reason
  5. a reason given afterwards is kept, and offered among the reasons
  6. place_on_board skips a save removed from the same topic, not from another
  7. get_verdicts counts quiet removals apart, and a reasoned one by its reason
  8. get_project lists what was removed under its topic
  9. the designer adding the save again clears its records

## 6. The database

```sql
CREATE TABLE IF NOT EXISTS board_turned_down (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT,
  node_id TEXT NOT NULL,
  topic_id TEXT,
  topic TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  was TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS board_turned_down_project ON board_turned_down(project_id);
CREATE INDEX IF NOT EXISTS board_turned_down_ref ON board_turned_down(ref_id);
```

What I checked about the older app (by reading `git show 7a23bb9:server/projects.ts` and
`git show 7a23bb9:web/src/Canvas.tsx`; it can't be run here):

- It never names `board_turned_down`, so the table is invisible to it. Deleting a project in the
  old app still removes its records through `ON DELETE CASCADE` (foreign keys are on in `db.ts`).
- Nothing new is stored in a card's `data`, in a line, or in a logged change. Every change this
  work makes is one of the existing ops: `update_node` with `x`/`y` (family drag, Tidy, glide is
  client-only), `update_node` with `state`/`reason` (Review, as before), `remove_node`/`add_node`
  (as before). The old `cleanData` keeps `state`, `taking`, `reason` for a save as it did; old
  `applyRemote` handles `update_node` with x/y at line 704; old `toFlow` reads the same fields.
- `ariaLabel`, `--z`, the far view, folding and gliding exist only in the page, never stored.
- Claude Code's `panel` MCP server on this code will create the table in the real library the
  next time it starts (add-only); the real app on old code keeps working beside it. Until then,
  `removedUnder()` and the verdict reads would fail if the table were missing; it's created at
  module load in `projects.ts`, which every entry point imports, so it can't be missing.

## 7. How to see it

- Start the copy: the `panel-copy-canvas` entry in `.claude/launch.json`, or
  `PANEL_PORT=4777 PANEL_LIBRARY_DIR=.copy/lib-canvas PANEL_DIST=.copy/dist-canvas bun server/index.ts`.
  It was still running from this session when I stopped (it may stop when the session ends).
- Open `http://localhost:4777/?project=ff46e4430ced4d69` (HUJJAT). CRM is `a9d44747056a4da3`,
  NavTech `dd1283fa655a45c5`.
- After changing `web/`, rebuild the copy's UI with
  `bunx vite build --outDir "$PWD/.copy/dist-canvas" --emptyOutDir` (absolute path, see 3.2).
- **State of `.copy/lib-canvas`:** every change of mine has been taken back (through the app's own
  undo). HUJJAT's cards and lines are identical in data to `.copy/lib`; the only differences are the
  positions of Direction and its 16 cards, moved by the other window in Chrome (340, 341, 346).
  `board_turned_down` is empty. The log has ~57 new HUJJAT events (seq 307–363), including an empty
  note added and removed by mistake (332/333). CRM and NavTech were opened, not changed. The
  browser's remembered view for HUJJAT was changed by my tests.

## 8. Doubts, and what I'd look at first

1. **Motion, by eye.** Glides, the fold, the far-view fade and Review's cross-fade were never seen
   running at full speed (hidden pane). Look at Tidy and at ⌘Z after a family drag: do the cards
   and their lines glide together without stutter?
2. **Option-drag with a real keyboard**, and **← in Review**: not tried.
3. **Far-view labels**: plain words over the canvas, wrapping to two lines when tight
   ("Interface / demo"), growing upward from the topic over whatever sits above it (often a
   sketch). Readable, but check it feels quiet enough, and in light mode at 1280.
4. **The strip in two rows** with FRIDAY open is a capsule turned into a rounded block; check it
   looks right.
5. **Review on websites** scrolls the whole page in the picture area. Right call for "whole,
   never cropped", but it's a different feel from the other saves.
6. **Family edge cases**: a note joined to saves of two different topics travels with whichever
   topic is dragged; a card under two topics never travels. Tidy gives never-measured folded saves
   a height of 330.
7. **Performance**: every card now goes through a small naming step (cached per card) and the view
   checks "anything in view?" up to ~11 times a second while moving. Fine on HUJJAT's 58 cards; not
   measured on anything bigger.
8. **The small map's drag** (pannable) was not tried; I only saw where it sits.
9. The first Shift+1 right after a load may not have taken (see 4, Package 3).

## 9. For the designer

Taking a suggestion off the canvas now counts as a quiet "no": FRIDAY won't bring that save back
under that topic, and you can say why in one key, the same way as ruling something out. Ruled-out
saves tuck away under their topic, **Review** (or **R**) lets you go through FRIDAY's suggestions
one at a time and large, and dragging a topic now brings its saves along (hold Option to move it
alone), with **Tidy** to line them up. Zoomed out, the topic names stay readable, **Shift+1 / 2 / 0**
work like in Figma, and the tools above a card are smaller.

The real Panel on 4646 keeps the old canvas until it is restarted, and nothing was committed.
Until that restart nothing is remembered about removed suggestions.
