# The studio, made to work like a design tool: report

Carried out from [studio-figma-plan.md](studio-figma-plan.md) on 11 Nov 2026, on the copy at
port 4737 (`.copy/lib-studio`, `.copy/dist-studio`, `panel-copy-studio` in `.claude/launch.json`).
Nothing is committed and the real app was not touched or restarted.

## 1. In two sentences

The designer can now point at a part of a sketch and change that part alone by hand (its size,
weight, color, fill, corners, opacity, words) or delete it, with ⌘Z / ⇧⌘Z through every hand
change and one Save (⌘S) for all of it; or ask FRIDAY about it from whichever single box is
showing. Every version is listed with when, who and what, can be shown with the page staying where
it was scrolled, and can be brought back; and the header is one quiet row of named icons that
never moves, also when FRIDAY's panel opens.

## 2. Per package

**How I checked.** The Claude in Chrome extension was not reachable all session ("not connected"
on every try). The built-in browser could measure Panel's own layout but, as the plan warned,
can't run the sketch page. So everything that needs the live page was checked in **a real
Google Chrome (headless) that I drove through its debugging port**: real mouse clicks, drags and
key presses, and reading the sketch page from inside its own frame (scroll position, computed
styles). Not the extension, but the same browser. Pictures are in `.copy/` as `studio-*.jpg`.

### Package 1: the frame

| Done when | | How |
|---|---|---|
| At studio widths 640, 760, 900, 1066, 1300, 1474, 2000 with a 60-character title: nothing overlaps, nothing but the title is cut | **yes** | Measured every visible header button's box at each width (built-in browser, title replaced by a 60-character one): 0 overlaps at all seven. The title is 267px at 640 and 280px at 760 (cut with an ellipsis), whole from 900 up. Under 720 Compare, Figma and Build are hidden, as planned. |
| Each icon shows its name on hover and on Tab focus | **yes** | Chrome: hovered each of the 13 header icons with the real mouse, read the `::after` name: opacity 1 for each, with the right words. Tabbed through: each shows its name on `:focus-visible`. |
| Press FRIDAY, Knobs, Directions, FRIDAY, close: every header button's left edge the same within 1px, `.st-stage` one width while any column shows | **yes** | `getBoundingClientRect` at each step: all 14 left edges identical (0px). Stage 814px at every column step (1222px closed), at 1474 wide. Also at 1280, 1500, 1728 and with FRIDAY at its widest (720px): identical. |
| Print deck (nine states), Knobs open, window 1280: tabs scroll, right side whole | **yes** | Chrome at 1280: states 424px shown of 724px (scrolls sideways), the right side's `scrollWidth == clientWidth`. |
| Phone and back from the view menu; page and frame glide together | **yes** | Chrome: menu reads Desktop · 1440×900 ✓, Tablet · 834×1112, Phone · 390×844, Reload the page, Open in a new tab, "1440×1289, shown at 43%". Phone and back both switch, the stage has `glide` during each. |

Pictures: `studio-header-friday.jpg`, `studio-header-folded.jpg`, `studio-friday.jpg`,
`studio-view-menu.jpg`, `studio-directions.jpg`.

### Package 2: versions

| Done when | | How |
|---|---|---|
| The column lists every version with times and who | **yes** | Chrome: 47 rows (the deck had 47 versions by today, not 35), under "Today" and "10 Nov"; all 47 have a time and who. The designer's four older ones (v25, 26, 27, 29) say what they changed, from the canvas's history ("Changed the words in 4 places and 2 values"); FRIDAY's say what they tried where the history has it. |
| Scroll to the fifth page, ‹ ‹ › ›: the fifth page still showing each time | **yes** | Read `scrollY` inside the sketch's frame: 2572 on v46, v45, v46, v47. |
| Bring back v12, `cmp` the new file with v12 | **yes** | `cmp v48.html v12.html`: same, byte for byte. Notice over the page (second try, v47 → v49): "v47 brought back as v49". |
| Tests | **yes** | `tests/sketch.test.ts` › "an older version is brought back as a new one, byte for byte, and every version says when, who and what" (two versions, restore v1 → v3 equal to v1 on disk; three versions with `at`, `by`, `what`; version 9 refused with "That sketch has no version 9 to bring back."). |

Picture: `studio-versions.jpg`.

### Package 3: change a part by hand

| Done when | | How |
|---|---|---|
| Point at "для бизнеса и государственного сектора", K: This part shows its size, weight, color | **yes** | Chrome: "This part" reads `muted “для бизнеса и государственного сектора”` with Font, Size 33.7px, Weight 500, Line height, Letter spacing, Color 6F6F6F, Fill none, Corners, Opacity. |
| Drag Weight: only those words change, the black words above don't | **yes** | Real drag: gray words `"wght" 900` (written as the font's wght axis, wdth kept), the black words above stay `"wght" 500`. |
| Under "Knobs this part uses" its color knob; changing it changes the other gray words too | **yes** | "Muted" is there; set to #c8472b: the four other gray texts read went to rgb(200, 71, 43). |
| Point at "Собственная разработка", Delete: gone, "1 change not saved"; ⌘Z: back | **yes** | Delete pressed with the keyboard in the page (the kit passes it up): `display: none`, "1 change not saved"; ⌘Z: shown again, "no changes". |
| Delete again, Save: the new version lacks it, and the file has lost exactly that element | **yes** | ⌘S → v50. `diff v49.html v50.html`: one line, the `<div class="node ctr" id="cv-team" …>Собственная разработка</div>`. (The page's script draws its curves to that id, so v50 now shows "1 error". That's what deleting that part means; the error count says so.) |
| A curve drawn by the page's script: Delete refused with the plain message, the curve stays | **yes, with a note** | This deck sets `pointer-events: none` on its drawing, so a real click can't select a curve at all (it selects what's under it). I gave the kit a click on one curve directly: Delete → "This part is drawn by the page's script, so it can't be changed by hand here. Ask FRIDAY to change it.", the curve stays, nothing counted. |
| Change a weight, a color, delete a part, ‹ and ›: all still there and counted | **yes** | Weight 671, color #2aa3ee, size changed, a paragraph deleted: "2 changes not saved" (one part's look, one deleted part) on v50 before, on v49 none, back on v50 all of it again. |
| Switch to Phone: the changed size still looks in proportion | **yes** | The part's size against the words around it: 1.603 on desktop, 1.603 on phone (written as `em` of the part around it). |
| Tests | **yes** | `tests/pageparts.test.ts` (10): style merges into an existing style; a font name with quotes kept whole through a second change; the third of four identical cards removed; two siblings removed in one save are the right two; a removal and a word edit in one save both land; a wrong class refused; a class the page's script added is fine; a place that isn't there refused; words that aren't the file's refused; a value with `;` or `url(` refused. Plus `tests/sketch.test.ts` › "a part's look and a part taken out are saved with the words as one version" (route, label). |

Also checked in Chrome: ⌘Z / ⇧⌘Z step one change at a time (three separate weight steps undo
to 503, 502, 501, nothing; redo forward again), on the bar and on the page. Pictures:
`studio-part-knobs.jpg`, `studio-part-strip.jpg`.

### Package 4: asking about a part

| Done when | | How |
|---|---|---|
| FRIDAY folded: point at a heading, "make this one size smaller", Enter: goes with the part, the bar says what FRIDAY is doing, the new version loads in place | **yes** | Chrome, the cover's heading: the bar showed the chip `heading “Программные продукты…”` and "What should change here?"; after Enter the chip went, the bar said "Thinking", then "Changing the sketch"; v51 loaded in place ("Version 51 from FRIDAY"). FRIDAY changed the heading's class `display` → `title` (33.7px → 25.3px). |
| The same with FRIDAY's panel showing, from its box | **yes** | The panel's box showed "In the sketch text “ИТ-компания из Душанбе…”", placeholder "What should change here?"; sent: the message shows what it was about, the studio let go of the part, v52 loaded (`p.lead` → `p.text`). |
| Never more than one box to type to FRIDAY in | **yes** | Counted at every step of the walk below: always 1. |
| A letter typed with a part selected lands in the box | **yes** | "m" with a part selected landed in the bar (folded) and in FRIDAY's box (showing), with the cursor there. |

Picture: `studio-askbar-chip.jpg` (the bar with a part's chip; taken just before the bar's own
gray dot was hidden while a chip shows, so it still has both dots).

### Package 5: look it all over

- **Widths 1280, 1500, 1728, light and dark, FRIDAY showing, folded and at its widest: yes.**
  At each width I stepped FRIDAY, Knobs, Directions, Versions, FRIDAY, close: the header's
  buttons never moved, no overlap, at most one column, one ask box, stage one width. Pictures in
  both schemes looked right (scratch pictures, not kept in `.copy/`).
- **The walk: yes**, at 1280: V, three versions, bring back v30 → v53; D, another direction and
  back; Compare and out; P, a part, K, its weight and color, a shared knob; Delete; ⌘Z, ⇧⌘Z; words
  edited in place; ⌘S → v54 ("Changed the words to “Семь продуктов”, 1 value and the look of 1
  part", by you, and the diff is exactly those three); Phone, Desktop; a part's chip in the bar
  (not sent); Choose with a reason (dark check, "Chosen · click to undo"); Esc stops pointing,
  Esc again leaves the studio. At every step: header same, no overlap, ≤ 1 column, 1 box.
- **Two bugs the walk found, fixed:** the library's own letter keys fired under the studio (P
  jumped to all saves, T would make a tag) and the canvas's own ⌘Z ran too (it stepped the sketch
  back a version). Both now stand back while a sketch is open in the studio.
- **Reduced motion: yes.** With `prefers-reduced-motion: reduce`: the studio and columns have no
  animation, the names under icons and the page frame don't move.

## 3. What differs from the plan, and why

- **FRIDAY's panel under the header, done in `studio.css` only** (no change to `assistant.css`).
  While the studio is open its width stays whole, FRIDAY's panel starts 52px down and sits just
  *under* the studio, and an empty column of FRIDAY's width (`.st-slot`) lets it show through and
  take the clicks. Done this way so everything the header opens (the names under icons, the
  Build and Figma sheets, the title's card) lies over the panel instead of hidden under it. Two
  side effects: closing FRIDAY, its panel now disappears under the page at once instead of
  sliding out over it; and a save's hover preview in FRIDAY's answer that reaches past the
  panel's left edge would be cut there. Outside the studio the panel is exactly as before.
- **Compare stays in the header with one direction, greyed out**, so the header doesn't change
  when a second direction arrives.
- **With a part selected, K opens Knobs on it and every other letter starts a message** (P, D,
  V included), as the strip and the plan's key list say; without a part, P, K, D, V are shortcuts.
- **Class check**: the file's classes must all be on the live part; extra ones the page's script
  added while running (`is-visible`…) don't count against it. Otherwise many animated pages
  would refuse every part.
- **A part with several look changes counts as one change** in the page row.
- **Older FRIDAY versions' "what"** comes from the `tries` saved in the same canvas change (the
  plan only said how to word the designer's). Many have none, so they show no line.
- **Bringing back writes the file exactly as it was** (it skips filling ready-made parts again),
  so it's byte for byte by construction.
- **Extras**: Backspace in an empty ask bar lets go of the part's chip; the bar's own dot hides
  while a chip shows (two dots side by side read as one too many); the strip follows the part
  when the page scrolls or the part's look changes.
- **Known small things, left as they are**: a part's Line height bar shows the page's own line
  height until it's changed, even after its size changes; a part whose weight is on the "wght"
  axis keeps its other axes as they were when changed (the plan's rule), so that part stops
  following a width knob afterwards.

## 4. Files changed

- `web/src/Studio.tsx`: header of icons with names, title card, view chip and menu, page row, one column shell, flat Directions with "3 alternates", Versions column, keeping the scroll place, one list of hand changes with undo/redo and ⌘S, the strip, the selected part for Knobs and the ask boxes.
- `web/src/Versions.tsx` (new): the Versions column.
- `web/src/Knobs.tsx`: shared column head (`RailHead`), no footer, "This part", "Knobs this part uses", "All knobs" folded.
- `web/src/studio.css`: header, names under icons, header over FRIDAY's panel, page row, view menu, columns, Versions, strip, chip, This part; the folding rules are gone.
- `web/src/api.ts`: `STUDIO_PAGE` (studio=6), versions' `at/by/what`, `restore`, parts in `saveChanges`.
- `web/src/Compare.tsx`: uses `STUDIO_PAGE`.
- `web/src/Assistant.tsx`: the box carries a part of a sketch ("In the sketch …", "What should change here?"), lets go of it once sent or taken off, and takes a typed letter.
- `web/src/App.tsx`: passes the studio's part to FRIDAY and back; its letter keys stand back while the studio is open.
- `web/src/Canvas.tsx`: passes the part through; its ⌘Z stands back while the studio is open.
- `server/sketches.ts`: the kit (part's place, own look, knobs that reach it, style, hide, keys); `writeVersion` writes `at/by/what`; `versionNote`.
- `server/pageparts.ts` (new): a part's look and removal in the file, one pass.
- `server/pagetext.ts`: shares `squash`, `decode`, `checkWords`; can skip its by-place step.
- `server/board.ts`: who and what on every version, `restoreVersion`, versions from the canvas's history, saves looks and removals.
- `server/index.ts`: `POST …/restore`; `/changes` takes `styles` and `removes`.
- `tests/pageparts.test.ts` (new), `tests/sketch.test.ts` (two tests added).
- `.claude/launch.json`: `panel-copy-studio` on 4737.

## 5. Checks

```
$ bun run typecheck
$ tsc --noEmit
```
```
$ bun test tests
 220 pass
 0 fail
 30197 expect() calls
Ran 220 tests across 24 files. [122.66s]
```

## 6. What I'd want the designer to look at first

On `http://localhost:4737/?project=dd1283fa655a45c5`, the print deck (now at v54 and marked
Chosen on the copy, from my walk):

1. Open FRIDAY and close it a few times with the pointer resting on the header: nothing moves.
   Then hover the icons for their names.
2. Press P, click the gray words "для бизнеса…", press K, drag Weight. Then Delete another part,
   ⌘Z, ⇧⌘Z, and see the one Save in the page row.
3. Press V: the list, and flip versions while scrolled down a few pages.
4. Whether closing FRIDAY's panel without its slide-out feels right (first point in §3).

## 7. FRIDAY messages

**Three, one more than the plan allows.** The two for package 4 ("make this one size smaller",
from the bar and from FRIDAY's box). The third was my mistake in the walk: a scripted click meant
for the paragraph under the selected gray words landed on the strip's "3 alternates of this"
button, which sits right there, and sent "Try alternates of this." (three alternates at once).
I stopped it from FRIDAY's panel; one alternate sketch ("Cover heading, second half in light
weight") had already been made on the copy's canvas. All on the copy; nothing on the real library.
