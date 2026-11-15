# Report: FRIDAY mixes saves by eye, with a mix card and a check

Carried out on 16 Nov 2026 from [docs/mix-plan.md](mix-plan.md), on my own copy of the library (`.copy/lib-mix`, port 4667). Nothing was committed, the real library and port 4646 were not touched, and the real app was not restarted. Before starting, no other session in this folder was carrying out this plan.

## 1. What was built

### Package 1: look by eye

- **New `server/sheet.ts`.** `makeSheet(ids)` makes one JPEG of up to 16 saves, 4 columns of 300×225 cells with 6 px gaps (1230 px wide), each numbered in its top left corner with digits drawn from small boxes, built on the plan's ffmpeg filter. A site shows its first desktop screen; then the thumbnail, the preview, the first prepared picture; a save with none keeps an empty numbered cell. Made in the temp folder, deleted after reading, one at a time, given up after 10 seconds. Returns `null` and never throws.
- **Searches answer with the sheet** (`server/mcp-tools.ts`): `search_library`, `find_by_color`, `similar_to` and `gather_for_brief` take `pictures` (default true). A new wrapper `withSheet` sits beside `safe`: the JSON as before, with `n` as the first field of every card the sheet covers, then the sheet's sentence, then the picture. `similar_to`'s save is 1; `gather_for_brief` numbers facet by facet and a save picked twice keeps one number. With no sheet the answer is exactly what it was. One sentence about the sheet was added to each of the four descriptions.
- **`next` lines** (`server/library.ts`): when a sheet comes with the answer, `next` says to choose on the sheet and open exact pictures (`nextWithSheet`). Without a sheet it stays as it was.
- **Exact pictures** (`reference()` in `server/library.ts`, `get_reference` in `server/mcp-tools.ts`): `pictures: [n]` opens exact pictures of one save; with two ids, or a number that isn't there, the answer is a plain error that says how many pictures the save has. The short answer (`facets`) now always lists `pictures: [{ n, what }]`; `path` stays only in the full answer. `pictures_note` is added for a site whose first picture is the folded page, and for a video. The caption of each picture now carries its number (`<id> picture 2: <label>`).
- **Words**: `SYSTEM` in `server/chat.ts` (the two lines replaced as written), and `INSTRUCTIONS` in `server/mcp-tools.ts` (the two additions).

### Package 2: the mix travels with the sketch

- **New table `sketch_mix`** in `server/db.ts`, only added.
- **New `server/mix.ts`**: the `Take` and `Mix` shapes, `cleanMix` (with the plan's messages, and the text limits), `saveMix`, `mixOf`, `mixPictures` (hero first, at most 6) and `smallPicture` (at most 768 px on the long side).
- **`make_sketch` and `edit_sketch`** (`server/board.ts`, `server/mcp-tools.ts`) take `mix`. It is checked before rendering, so a wrong mix costs no render and leaves nothing on the canvas. A sketch made `from` a sketch with a mix starts with a copy of it. Every save in the mix gets its "uses" line, on make and on an edit with a new mix. A wireframe ignores the mix. The answer's JSON carries `mix`, and after the screens come "What it took from, small…" and each picture with its caption. `next` gets `MIX_LOOK`.
- **`get_sketch`** returns `mix` and takes `compare` for the pictures.

### Package 3: FRIDAY writes the mix card

- `server/chat.ts`: the `[[id#3]]` line; "Pass mix:" in place of "Pass uses:"; the new section "Taking from saves (the mix card):" after Alternates and before The studio; "(open the pictures you take from first)"; `plannerNote` asks for the mix card in full.
- `server/duo.ts`: `builderIntro` opens the plan's exact pictures and passes the mix. "Don't look for other references." stays.
- `recipes/website.md`: Gem, Hero (first bullet), Whole page (section by section, and the fourth question). `recipes/poster.md`: Idea, Layout.

### Package 4: one exact picture in FRIDAY's words

- **Route** `GET /api/refs/:id/picture/:n` in `server/index.ts`: picture n of the save, or 404. Read-only, like `/media`. `picturePath()` in `web/src/api.ts`.
- **Every reader of `[[id]]` also takes `[[id#n]]`**: `web/src/StreamText.tsx` (`REF`, `INLINE`, `holdBack`, rows), `web/src/Assistant.tsx` (`REF_IN_TEXT`, the copy back to "@name", the split and the match in your own messages), `server/chat.ts` (the three places, through one `SAVE_TOKEN`).
- **How it shows**: the same chip or row tile, with picture n in place of the cover and a quiet label after the name ("Screen 3 of 12"). A row keeps today's tile sizes. Clicking opens the save. If picture n won't load, the save's usual thumbnail shows. Two small styles in `web/src/assistant.css` (`.ref-chip-pic`, `.gallery-pic`).

### Package 5: the fresh look

- **New `server/mixcheck.ts`**: `checkMix` renders up to 8 screens of the version into a temp folder, copies each take's picture beside them, and runs `claude -p` the way design reads do (only Read, a JSON form, clean environment, no session, no MCP, `settings.model()`, effort medium, stopped after 120 s). The plan's system prompt and form, word for word. It never throws.
- **What FRIDAY gets**: `mix_checks`, short lines worst first (`breaks`, `check`, `fine`), or `"not checked: <why>"`. The form is kept in `sketch_mix.checks`; a version with no row of its own gets one.
- **When**: on `make_sketch` with a mix; on `edit_sketch` with a new `mix`, a whole `html`, or the new `check: true`. A small edit carries the last checks forward with `mix_checks_from_version`. It runs beside the skill checks (`Promise.all`). Off with `mix_check = "0"`; `tests/helpers.ts` seeds that. `PANEL_MIX_CHECK_FAKE` reads a form from a file in place of Claude. Not counted in `ai_usage`.
- `MIX_LOOK` got the plan's sentence about `mix_checks`.

### Files changed

Changed: `server/mcp-tools.ts`, `server/library.ts`, `server/board.ts`, `server/chat.ts`, `server/db.ts`, `server/duo.ts`, `server/index.ts`, `recipes/website.md`, `recipes/poster.md`, `web/src/StreamText.tsx`, `web/src/Assistant.tsx`, `web/src/api.ts`, `web/src/assistant.css`, `tests/helpers.ts`, `tests/search.test.ts`, `tests/skills.test.ts`, `scripts/measure-search.ts`, `.claude/launch.json`.
New: `server/sheet.ts`, `server/mix.ts`, `server/mixcheck.ts`, `tests/sheet.test.ts`, `tests/mix.test.ts`.
(`server/mcp-tools.ts` also holds the earlier, uncommitted instructions fix the plan said was mine to keep; `tests/instructions.test.ts` is unchanged.)

## 2. What differs from the plan, and why

1. **The `next` lines change only when a sheet is sent.** The plan says `search()`'s and `gather()`'s `next` should say "look at the sheet". But the plan also says that with no sheet the answer must stay as it was, and `library.ts` doesn't know whether a sheet was made. So `library.ts` keeps its old lines, and the MCP wrapper swaps them for sheet lines (`nextWithSheet`) only when a sheet goes with the answer. I also made the sheet lines short, so `gather_for_brief` stays under the 300-character limit (my first wording made it grow by 332).
2. **`scripts/measure-search.ts` reads the JSON from the first block.** It parsed all the text joined together, and the sheet's sentence after the JSON broke that. Nothing else in the script changed. The ORDER lines are identical before and after.
3. **Each picture's caption in `get_reference` now carries its number** (`<id> picture 2: <label>`), so FRIDAY can ask for the same one again.
4. **`pictures_note` only when the save has more than one picture.** For a video with only one frame grid, "open the close-up" would point at nothing.
5. **Package 2, edits built on an older version** (`from_version`): the new version gets the mix of the version it was built on. If that older version had no mix, an empty row (`{"takes":[]}`) records "no mix from here", and `mixOf` reads an empty row as none. Without this, rebuilding from version 1 would wrongly inherit version 3's mix.
6. **`edit_sketch` with a new mix and no change to the page is a plain error** ("A new mix goes with a change to the page…"), so there is never a mix without a version.
7. **"uses" lines on edits too:** an edit with a new mix also draws "uses" lines for its new saves. The plan only names make.
8. **When a save has exactly one picture, `picture` is filled in as 1.**
9. **The fresh look also runs when a sketch inherits a mix** (`make_sketch` from a sketch with a mix). The plan says "on make_sketch with a mix"; an inherited mix is still a mix, and the page is new.
10. **The fresh look runs on an edit only when a new version was made** (a rename alone makes none, so it carries the old checks).
11. **With `PANEL_MIX_CHECK_FAKE`, the page isn't rendered again**, because the stand-in form doesn't look at it. That keeps the tests quick.
12. **The `mix_checks` lines' wording**: a take reads `<id> (<job>): <verdict>: <note>`, so "missing" is in the line FRIDAY is told to fix; the copy line reads "the page is a copy of / close to the hero / its own: <note>".
13. **One log line per fresh look** with how long it took (`Fresh look at sketch … v2: done in 27.9s`), next to the "Reading:" lines design reads write. I needed it for the timings below, and it also shows in the real app's log what a sketch waits for.
14. **`SYSTEM`, the colours line.** Read top to bottom, the new card section ("the designer gave the mix … sketch in the same answer. Don't ask.") contradicted the colours line ("When colours aren't settled, ask before you sketch"). I added one clause to the colours line: colours are settled "when a mix card the designer gave or chose takes the colour from a save". Nothing else in `SYSTEM` was touched.
15. **`recipes/poster.md`, Layout.** Layout is a wireframe, and a wireframe keeps no mix. So the bullet also says "A wireframe keeps no mix, so pass the card to make_sketch when the poster itself is made". In the poster recipe, colour and type come after Layout, so it says only "The idea is decided already: it is not a helper" where the website's Hero says "the gem, the color and the type".
16. **Package 4, the picture's label** ("Screen 3 of 12") comes from the save's existing detail route (`api.ref`, which already lists its pictures with labels), fetched once per save and only when one of its exact pictures is shown. So there is one new route (the picture), not two. The hover peek also shows picture n and its label.
17. **`readable()` in `server/chat.ts` is now exported**, only so a chat title made from `[[id#2]]` could be checked from outside.

## 3. Checks

- **Typecheck**: passes.
- **Tests**: the baseline was 260 pass, 0 fail (29 files). After Package 1: 268 pass, 1 fail. The failing test expected the short `get_reference` answer to have no `pictures`, and the plan changes that on purpose, so I updated what it expects. After Package 2: 276 pass. After Package 5: 282 pass. Final run, after the live check and the timing log line: typecheck passes, 282 pass, 0 fail (31 files).
- **New tests**: `tests/sheet.test.ts` (9), `tests/mix.test.ts` (11: 7 for the mix, 4 for the fresh look with the stand-in form), and 2 in `tests/skills.test.ts` for "Taking from saves". No test calls Claude: `mix_check` is `0` in every test library.
- **Instructions** (`tests/instructions.test.ts` passes): 3,851 characters for other apps and 3,443 for FRIDAY (limit 4,000). Longest tool description: `get_ready_made` 1,780, then `make_sketch` 1,381, `get_reference` 943 (limit 2,000).
- **`measure-search.ts`** (`.copy/mix-measure-before.txt`, `.copy/mix-measure-after.txt`). Every search grew by less than 300 characters, and the ORDER lines are identical:

| Answer | Before | After | Grew by |
| --- | ---: | ---: | ---: |
| search energetic | 7,929 | 8,215 | 286 |
| search energetic, full cards | 22,271 | 22,554 | 283 |
| search by look | 7,479 | 7,765 | 286 |
| search, no words (newest) | 4,435 | 4,721 | 286 |
| find by color #e2372b | 7,748 | 8,031 | 283 |
| gather for a brief | 17,491 | 17,785 | 294 |
| similar to the top save | 4,388 | 4,664 | 276 |
| open one save, first picture | 8,928 | 9,059 | 131 |
| open one save, type only (`facets`) | 932 | 2,792 | **1,860** |
| tool definitions, read once | 40,084 | 41,557 | 1,473 |

  Each search also carries one picture now. The one big jump is the short `get_reference` answer: the plan asks it to always list the save's pictures, and this save is a site with many of them. That is the cost of being able to ask for exact pictures without the whole read.
- **`git diff --stat`**: only the files listed in section 1, plus tests, `.claude/launch.json` (my copy's server) and `scripts/measure-search.ts`.

## 4. The live check (copy on 4667, project CRM, FRIDAY on Fable 5.2, high, one model, `mix_check = 1`)

Six messages and three sketches. Every answer's parts are in `.copy/mix-live-N.json`. The session files are in `~/.claude/projects/-Users-osimij-Desktop-Panel46--copy-lib-mix-chat/`.

1. **Search by eye** ("find me references for a calm fintech hero…"; session `24d4a28f-179b-4e8c-ad96-a085d42bbfea`). Expected: one picture in the search's answer, and an exact picture opened. **As expected.** All three searches came back with JSON, the sheet's sentence and one picture. FRIDAY opened two saves with `pictures: [2]` (`f07e0cee42fc4452`, `b9ec3fbb59fe4765`) and wrote them as `[[id#2]]` in its reply. It placed seven saves on the canvas, as the canvas rules say.
2. **The designer gives the mix** (same chat). Expected: one card in the shape with `[[id#n]]`, no question, `make_sketch` with `mix`, two small pictures back, `mix_checks`, and a line on what the check found. **Mostly as expected, with one miss.** FRIDAY opened Altitude's folded page, then its exact screen (`pictures: [2]`), and all four frame grids of the glow save. It asked nothing and called `make_sketch` with a full mix (hero Altitude picture 2, helper the glow, picture 3). The answer held the sketch's screen, then the two small pictures with their captions, then `mix_checks`. The fresh look marked version 1 **"breaks: the page is a copy of the hero"** and the glow **"partly"**. FRIDAY took out the dashboard parts that copied Altitude and called `edit_sketch` with `check: true` (it was then "close" and "partly"), and its reply says what the check found. **The miss: its reply has no written mix card.** The card went only into `make_sketch`'s `mix`, so the designer never sees it. Kept: `.copy/mix-live-2-v1.jpg`, `-v2.jpg`, `-v2-glow.jpg`, `-v2.html`.
3. **FRIDAY chooses** ("make a landing hero for a logistics software company from my library"; new chat, session `ce41d93a-0bca-4685-974f-f790aa1d1da9`). Expected: three cards with three different heroes, a question with buttons, no sketch. **Exactly as expected.** Three cards in the card shape ("Mix A: The grey map", "Mix B: Lanes through one hub", "Mix C: The lime yard"), each with `[[id#n]]` pictures, take and leave for each save, what they share, the unusual thing, and what has no save behind it. It said plainly where a colour was not measured. Before writing them, it opened each hero's exact screen (`pictures: [2]`), and one more save's. All four of its searches, `gather_for_brief` included, came back with a sheet. Then `ask_designer` with the three heroes as the question's saves, and it stopped. About 100 seconds.
4. **Press a choice** ("C: the lime yard"). Expected: one sketch from that card, with its check. **As expected.** `make_sketch` with the card's mix. Check: both takes "there"; "check: the page is close to the hero". FRIDAY then made a fix (the yard drawing), re-checked with `check: true`, made a phone fix, and wrote in its reply what the check found and what has no save behind it. Kept: `.copy/mix-live-4-v1.jpg`, `-v3.jpg`, `-v3.html`.
5. **A small change** ("make the button white"). Expected: `edit_sketch` with no mix, no new card, no fresh look. **As expected.** One `edit_sketch` with two small edits, no mix, no card. The answer carried the checks forward with `mix_checks_from_version: 2`, and the server log shows no fresh look for that version. 4.5 seconds.
6. **The spare**: I used it to send message 2 again in a new chat (session `84fb80c0-812a-4af2-8506-bf4838bc2e98`), to see whether the missing card was a one-off. **It wasn't: again no written card.** Again a full mix in `make_sketch`, again "breaks: copy of the hero" on version 1. This time FRIDAY passed a **changed mix** with its fix (`edit_sketch` with `mix` and `check: true`), so the fresh look ran again ("close", the glow "partly"). Its reply says "the card above changed in three places", but there is no card above in what the designer sees. Kept: `.copy/mix-live-6-v1.jpg`, `-v3.jpg`, `-v3.html`.

As the plan says, I added no instructions for the missing card. A guess at the cause, for whoever decides: the card section says to write the card "and sketch in the same answer". FRIDAY writes all its words at the end of the turn, after the tools, so it seems to treat the `mix` it passes as the card. When the choice was its own (message 3), it wrote the cards properly, because that answer ends with a question and not a sketch.

**Timings.** The fresh look alone (from its log line): 23.8 s and 27.9 s (lime yard, versions 1 and 2), 22.3 s and 21.7 s (spare, versions 1 and 2). For message 2 the log line wasn't in yet; I added it before message 3. Whole tool calls, as the session files time them:

| Sketch | Call | Took | Fresh look alone |
| --- | --- | ---: | ---: |
| GorillaCRM hero (msg 2) | make_sketch, v1 | 24.7 s | not logged |
| | edit_sketch, check, v2 | 29.5 s | not logged |
| Yardline, lime yard (msg 4) | make_sketch, v1 | 28.9 s | 23.8 s |
| | edit_sketch, check, v2 | 32.3 s | 27.9 s |
| | edit_sketch, small, v3 | 4.4 s | carried |
| | edit_sketch, small, v4 (msg 5) | 4.5 s | carried |
| GorillaCRM hero, again (spare) | make_sketch, v1 | 25.9 s | 22.3 s |
| | edit_sketch, mix + check, v2 | 24.8 s | 21.7 s |
| | edit_sketch, small, v3 | 3.1 s | carried |

So a sketch with a mix waits about 20 to 28 seconds more than one without; a small edit waits nothing extra. The fresh look ran on `settings.model()`, which is Opus 5.5 on this copy.

## 5. What I saw with my own eyes

- **The sheet** (`.copy/mix-sheet.jpg`, a search for "dashboard"): 12 saves in rows of four. Every number is readable, nothing is stretched, and the two sites (11, 12) show their first screen, not the squeezed page. Number 10 is a video whose thumbnail is nearly all black; that is the save's own thumbnail.
- **The chips** (`.copy/mix-chips.jpg`, from a message I wrote into the copy's chat by hand): `[[id#2]]` inline shows the save's name, that exact picture as its thumbnail, and a quiet label after it ("Screen 1 of 10", "Part 2 of 4", "Screen 2 of 16"). Three on a line of their own make a row of those exact pictures, at today's tile size, with the label under the name. Plain `[[id]]` is unchanged. A picture that won't load falls back to the save's usual thumbnail. The test chat was deleted afterwards. I couldn't get a second picture from FRIDAY's real three-card answer: the conversation list in the browser pane wouldn't switch chats for my clicks.
- **The sketches beside their pictures:**
  - *GorillaCRM hero (message 2, `mix-live-2-*`)* beside Altitude's screen 1 and the spreadsheet glow's frame grid 3. **Structure: there**, and too much of it. Even after the fix, the nav, the 50/50 split, the sky panel, the window bleeding right, the three-line headline, the capsule button and the hairline are Altitude's. The fresh look's "close" is fair. **The glow: there**, in the Mid-glow state: the magenta, violet and cyan band rises through the table while the rows sharpen, as in the frames. On the canvas picture (taken after the animation ends) you see only the filled table.
  - *Yardline, the lime yard (message 4, `mix-live-4-*`)* beside Steel's screen 1 and Cthonic's poster. **Structure: there.** A pale band with a perspective line drawing, the headline bottom left, a hard cut to a dark band with a muted second line and two buttons on the right, then a panel of windows: Steel almost beat for beat. **Colour: there.** Cthonic's lime, its near-black green, a mid green and one red-orange container, which matches the red mark in the Holds window. The yard drawing (cranes, stacks, one flagged box) is its own idea and the strongest part. Of the three, this one looks least like a template, but its structure is still Steel's.
  - *GorillaCRM hero, again (spare, `mix-live-6-*`)*. **Structure: there**, again very close to Altitude. **Glow: there**, and clearer than in message 2: in the screen the band is mid-rise, with the rows sharp below it. The prompt card hanging off the sheet is the one thing of its own.
  - Only three sketches were made (the plan allowed four), because message 3 rightly ended in a question.

## 6. Not done, or not sure

- **FRIDAY doesn't write the card when the designer gives the mix** (messages 2 and 6). Reported, not fixed, as the plan says.
- **The fresh look keeps saying "close to the hero"**, and FRIDAY keeps leaving it because "its structure is what you asked for". That is right when the designer named the hero, but it means a mix keeps the hero's whole first screen. Whether "close" is fine when the designer chose the hero is a call for the designer, ideally in the A/B test.
- **The fresh look sees still pictures.** For motion (the glow) it judges whichever moment the render caught, so "partly" can mean "not at this moment". FRIDAY said so in its reply once.
- **About 25 seconds more per sketch with a mix**, and the fresh look uses the read model (Opus 5.5 on the copy). It isn't counted anywhere.
- The short `get_reference` answer (`facets`) can now be much longer for a site with many screens (932 to 2,792 characters in the measurement).
- `nextWithSheet` only changes `next` when it starts with today's exact words. If someone rewrites those lines in `library.ts`, the sheet versions silently stop showing (the answer still works).
- Not tested in the real app, and nothing committed.

## 7. For the designer (to paste back)

1. FRIDAY now sees your library: every search comes with one picture of the saves found, numbered.
2. It can open one exact screen of a site, or one moment of a video, instead of the squeezed whole page.
3. Before a sketch, it writes down what comes from which save: one save for the structure, one or two for the colour or a detail.
4. In a chat, a save written with a number shows that exact screen, with a small label like "Screen 3 of 12".
5. A sketch now comes back with the pictures it took from beside it. A second Claude, who never saw the chat, says what is missing or copied.
6. That check is strict. It caught a sketch that was "Altitude with other words", and FRIDAY fixed it.
7. When FRIDAY chooses, it shows three different cards and asks which. That worked well.
8. When you name the saves yourself, it sketches right away but doesn't show you its card. That still needs fixing.
9. A sketch with saves behind it takes about 25 seconds longer. Small changes take no longer.
10. Nothing is live yet: it is all on a copy, not committed.

## 8. Checked afterwards (by the planner, 16 Nov 2026)

- Read the diff and the three new files: they match the plan. Typecheck passes and 282 tests pass on my own run.
- Looked at `.copy/mix-sheet.jpg`, `.copy/mix-chips.jpg` and the sketches of messages 4 and 6 myself.
- **The missing card is fixed** with one change in `SYSTEM` (`server/chat.ts`), in the line "When the designer gave the mix…": it now says the designer can't see the mix passed to `make_sketch`, so the card is written in the reply as well, first. Sent message 2 again on the copy (chat `6b9c8393d5f34ad4`, sketch `f4f0b1a711384cd1`): the reply opens with "Mix A: Sky split, sheet glow", its two exact pictures ("Screen 1 of 10", "Part 3 of 4") and the take and leave lines. Seen in FRIDAY's panel on 4667.
- Still open: the card's take lines come out long (four or five lines each), and a sketch stays very close to its hero. Both are for the designer to judge in use.
