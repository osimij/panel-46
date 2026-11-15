# Plan: FRIDAY mixes saves by eye, with a mix card and a check

Written 16 Nov 2026 for another Claude session (Opus) to carry out. Read all of it, `CLAUDE.md`, and the report [docs/reports/Combining design references with AI.md](reports/Combining%20design%20references%20with%20AI.md) before touching anything. The study behind the numbers is [panel_today.md](research_notes/Combining%20design%20references%20with%20AI/panel_today.md): read sections 0, 2 and 7 of it.

When you finish, write the report described at the end and stop. The report is checked before anything goes live.

## Words used here

- **Save**: one saved reference in the library. It has pictures that were prepared when it was read (`media/<id>/read/N.jpg`, listed in `reads.signals.visuals`, each with a label like "Desktop, screen 3 of 12").
- **Sheet**: one picture holding up to 16 saves as small numbered pictures. New in this plan.
- **Mix card**: a short written card that says what a sketch takes from which save. New in this plan.
- **Hero**: the one save on a mix card that gives the structure. **Helper**: a save that gives one other thing (the color, one detail).
- **Take**: one line of a mix card: a save, its job, what to take, what to leave, and which of its pictures shows it.
- **Fresh look**: a separate Claude, with no memory of the conversation, that compares a sketch with the pictures it took from.

## What the designer asked for

FRIDAY copies one save very well. It is bad at mixing several saves into something good and fresh. The designer's words about the results: "boring", "template", "generic", "they all look the same".

What the study found in 30 real chats:

| What happens today | Number |
| --- | --- |
| Searches that show FRIDAY a picture | 0 |
| Times it opened a save with only one picture | 72 of 99 |
| Sites where that one picture is the whole long page squeezed small | 24 of 35 |
| Sketches after which it looked at a save again to compare | 1 of 117 |
| Saves it said it "used" but never saw a picture of in that chat | 20 of 98 |

So FRIDAY mixes short texts about the saves, not the saves. The fix agreed with the designer: turn "mix many" (which the model is bad at) into "copy one exact thing" (which it is good at). This plan builds the first three changes:

1. **Look by eye.** Every search comes back with a sheet of pictures. FRIDAY can open one exact picture of a save at full size.
2. **The mix card.** Before a sketch takes from saves, FRIDAY writes down what comes from where. The card travels with the sketch.
3. **Check against the saves.** A sketch comes back with the pictures it took from beside it, and a fresh look says what is missing.

## The design

```
search  ->  cards + ONE sheet of numbered pictures
open    ->  get_reference with pictures: [4]   (one exact screen, full size)
decide  ->  the mix card, in FRIDAY's reply (three cards when the choice is FRIDAY's)
make    ->  make_sketch with mix: { takes: [...] }
back    ->  the sketch's screens + small pictures of what it took from + mix_checks
```

### Choices already made

Don't reopen these.

- **One sheet, not many small pictures.** The Claude API limits how many pictures one conversation may hold. Twelve pictures a search would reach that limit in a long chat. One sheet is one picture.
- **The sheet is made with ffmpeg, and its numbers are drawn from small boxes.** The ffmpeg on this Mac has no `drawtext` (checked: `ffmpeg -filters` lists `drawbox`, `pad`, `xstack`, `overlay`, no `drawtext`). Headless Chrome could write real text but is too slow for every search. The trial below takes about 80 ms for 12 saves and the numbers read clearly.
- **The mix is stored in a new table**, not in the sketch card's data. `CLAUDE.md` says a database change must only add, because the real app (old code) and Claude Code's `panel` MCP server (new code) run side by side on the real library. A new table is the safe way.
- **`uses` stays.** `mix` is added beside it. Every save in a mix also gets its "uses" line on the canvas, exactly as today.
- **No new button and no new setting in the UI.** The fresh look has one settings row (`mix_check`), only so tests can turn it off.
- **The fresh look is a separate `claude -p` run**, the same way design reads run (`readWithClaudeCode` in `server/read.ts`). It is not a fork of the chat: a fork remembers what FRIDAY meant to do, and that is the bias we want to remove.
- **No new dependency.**

## Rules for you

- Follow `CLAUDE.md`. Never touch `~/DesignLibrary` or port 4646. Never run `bun run build` or `bun run start`. Don't restart the real app. Don't commit.
- Before you start, list the sessions running in this folder. If another one is already carrying out this plan, stop and say so.
- Other sessions may be editing this folder. Never `git stash`, `git checkout`, `git reset` or reformat a file. Change only what this plan needs. To compare with the last commit use `git show HEAD:path` or `git diff`.
- **Already changed, not committed, and yours to keep:** `server/mcp-tools.ts` (shorter `INSTRUCTIONS`, longer descriptions for `make_sketch`, `get_ready_made`, `get_reference`, `search_library`) and `tests/instructions.test.ts`. That work fixed Panel's instructions being cut off at 4,096 characters. The test fails if the instructions pass 4,000 characters or any tool description passes 2,000. Everything you add to them must keep that test passing. How to use a tool goes in that tool's description, not in `INSTRUCTIONS`.
- A server from another session is running on 4747. Leave it. Use your own copy:
  - library: `cp -cR .copy/lib .copy/lib-mix`, then replace its database with a safe copy: `rm .copy/lib-mix/library.sqlite* && sqlite3 -readonly .copy/lib/library.sqlite ".backup '.copy/lib-mix/library.sqlite'"`
  - UI: `bunx vite build --outDir "$PWD/.copy/dist-mix" --emptyOutDir` (the path must be absolute, or it lands in `web/.copy`)
  - add to `.claude/launch.json`: `{ "name": "panel-copy-mix", "runtimeExecutable": "env", "runtimeArgs": ["PANEL_PORT=4667", "PANEL_LIBRARY_DIR=.copy/lib-mix", "PANEL_DIST=.copy/dist-mix", "bun", "server/index.ts"], "port": 4667 }`
  - the server does not reload by itself: restart yours after changing `server/`.
  - on the copy, set FRIDAY to the designer's real model before the live check: `chat_model = claude-fable-5-2`, `chat_effort = high`, `chat_mode = solo` in the copy's `settings` table.
- Comments, tool descriptions, errors and messages in plain words, in full sentences, saying why (house style in `CLAUDE.md`). The designer is not an engineer.
- This plan spends the designer's Claude plan only in "Package 6: look it all over". Nothing else may call Claude. Tests must never call Claude.
- After each package: `bun run typecheck` and `bun test tests` pass. Each package leaves Panel working on its own.

## Before changing anything: the baseline

1. `bun run typecheck` and `bun test tests`. Write down the result. If something fails before you start, say so in the report and don't fix what isn't yours.
2. `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib-mix bun scripts/measure-search.ts > .copy/mix-measure-before.txt 2>/dev/null`. Keep it.

---

## Package 1: look by eye

### 1. The sheet: new file `server/sheet.ts`

One function that turns a list of save ids into one JPEG.

**Which picture stands for a save:**

1. a site: the first prepared picture whose label starts with `Desktop, screen 1 ` (a site's thumbnail is the whole long page, which says nothing at this size);
2. otherwise the first media's `thumb_path`;
3. otherwise `refs.preview_path`;
4. otherwise the first prepared picture;
5. none of these on disk: an empty light cell, still numbered, so numbers always match the cards.

**Layout:** 4 columns, each cell 300×225, 6 px between cells, white ground, cell ground `#EEEEEE`. A picture taller than 4:5 is cut to its top 4:5 first, then fitted inside the cell without stretching. At most 16 cells. Number each cell in its top left corner: a black box with white digits.

**This filter works on this Mac** (trial, 12 saves, 77 ms, 100 KB). Build on it:

```ts
const COLS = 4, W = 300, H = 225, GAP = 6;
const SEG: Record<string, string> = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
/** One digit as a calculator draws it: up to seven small bars. ffmpeg here can't write text. */
function digit(d: string, x: number, y: number) {
  const t = 3, w = 12, h = 20, half = (h - t) / 2;
  const bar: Record<string, [number, number, number, number]> = {
    a: [x, y, w, t], g: [x, y + half, w, t], d: [x, y + h - t, w, t],
    f: [x, y, t, half + t], b: [x + w - t, y, t, half + t], e: [x, y + half, t, half + t], c: [x + w - t, y + half, t, half + t],
  };
  return [...SEG[d]!].map((s) => { const [bx, by, bw, bh] = bar[s]!; return `drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=white:t=fill`; });
}
const cells = files.map((_, i) => ({ x: GAP + (i % COLS) * (W + GAP), y: GAP + Math.floor(i / COLS) * (H + GAP) }));
const SW = GAP + COLS * (W + GAP), SH = GAP + Math.ceil(files.length / COLS) * (H + GAP);
// Input 0 is the white ground: -f lavfi -i color=c=white:s=${SW}x${SH}. Inputs 1..n are the pictures.
const scaled = files.map((_, i) => `[${i + 1}:v]crop=iw:'min(ih\\,iw*1.25)':0:0,scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:-1:-1:color=0xEEEEEE[c${i}]`);
const overlays = files.map((_, i) => `${i ? `[o${i - 1}]` : "[0:v]"}[c${i}]overlay=${cells[i]!.x}:${cells[i]!.y}[o${i}]`);
const marks = cells.flatMap((c, i) => {
  const n = String(i + 1);
  return [`drawbox=x=${c.x}:y=${c.y}:w=${12 + n.length * 16}:h=32:color=black:t=fill`, ...[...n].flatMap((d, k) => digit(d, c.x + 7 + k * 16, c.y + 6))];
});
const filter = [...scaled, ...overlays].join(";") + `;[o${files.length - 1}]${marks.join(",")}[out]`;
// ffmpeg -y -v error -f lavfi -i color=... -i a.jpg -i b.jpg ... -filter_complex <filter> -map [out] -frames:v 1 -q:v 4 out.jpg
```

For a save with no picture, use another `-f lavfi -i color=c=0xEEEEEE:s=300x225` input in its place.

**Rules:**

- `makeSheet(ids)` returns `{ jpeg: Buffer } | null`. It never throws. On any failure, or after 10 seconds, or when none of the saves has a picture on disk, it returns `null` and the search answers as it does today.
- Write the JPEG to the system's temp folder and delete it after reading. Nothing is written into the library.
- Sheets are made one at a time (a small queue), so ten searches at once don't start ten ffmpegs.

### 2. Searches answer with the sheet

In `server/mcp-tools.ts`, for `search_library`, `find_by_color`, `similar_to` and `gather_for_brief`:

- New input `pictures: boolean`, default `true`: "The saves as one sheet of small numbered pictures, to choose by eye. false: words only."
- When a sheet was made, each card it covers gets `n`, its number on the sheet, as the first field of the card. Cards past the 16th have no `n`. With no sheet, no card has `n` (so today's answers and tests stay as they are).
  - `search_library`, `find_by_color`: the cards in order.
  - `similar_to`: the save being compared is 1, the results follow.
  - `gather_for_brief`: number the picks in the order they are listed, facet by facet. A save picked for two facets keeps one number.
- The answer is: the JSON text as today, then one text block, then the picture:
  `The same saves as small pictures, each numbered as its card's n. Choose by eye here, then open the ones worth it with get_reference: for a site or a video, ask for the exact pictures you need (pictures: [n]).`
- These tools use `safe(...)` today, which can only return text. Add a second wrapper next to it for answers that carry a sheet. A failure still comes back as a plain error message.
- `search()`'s `next` line and `gather()`'s closing line (`library.ts:741`) say the same thing in a few words: look at the sheet, then open exact pictures.
- FRIDAY's panel shows a thumbnail for every `"id":"…"` in a tool's answer (`idsIn` in `server/chat.ts`). That must keep working: `n` is a new field, `id` stays.

Descriptions: add one sentence about the sheet to each of the four tools.

### 3. Open one exact picture

`get_reference` in `server/mcp-tools.ts` and `reference()` in `server/library.ts`:

- New input `pictures: number[]` (1 to 8 numbers, each from 1): "Exact pictures of one save, by their number in its pictures list: a site's screen 4 at full size, a video's third frame grid. Give one id."
- With `pictures`, `ids` must hold exactly one id, and `images` is ignored. A number that isn't there: answer in plain words, with how many pictures the save has.
- The answer for a save always lists its pictures as `pictures: [{ n, what }]`, also when only `facets` were asked for (today the short answer has no list). Keep `path` only in the full answer.
- When the first picture is the folded page (its label starts with `The whole page, cut into`), add to that save's JSON: `pictures_note: "Picture 1 is the whole page folded small: a map of it. Before you take anything from this site, open the screens that show it at full size (pictures: [n])."`
- When the save is a video, the same idea: `pictures_note: "Picture 1 is a grid of small frames. Open the grid or close-up that shows the moment you mean (pictures: [n])."`
- Description of `get_reference`: say that `pictures` opens exact ones, and that for a site or a video the first picture is only an overview.

### 4. Tell FRIDAY and the others

- `server/chat.ts`, `SYSTEM`, "How to work": replace the two lines that start "Search answers are short cards" and "Look at the pictures (get_reference)" with:
  - `- A search answers with short cards and one sheet of small numbered pictures (each card's n is its number on the sheet). Choose by eye on the sheet, not by the cards' words alone: words can match and the picture still be wrong.`
  - `- Open a save with get_reference before you say what to take from it, with facets when only one part matters. For a site, the first picture is the whole page folded small, and for a video a grid of small frames: a map. Open the exact pictures you mean at full size (pictures: [n]) before you take anything from them.`
- `server/mcp-tools.ts`, `INSTRUCTIONS`: in the `search_library` line add "Each search comes with a sheet of small numbered pictures: choose by eye." In the `get_reference` line add "For a site or a video, open the exact pictures you need (pictures: [n])." Stay under the test's limit.

### Done when

- `bun test tests` passes, with a new `tests/sheet.test.ts`:
  - seed 6 saves and give 5 of them a real small JPEG on disk (make each with `ffmpeg -f lavfi -i color=c=red:s=800x600 -frames:v 1`, different colors and one very tall one, 800×4000); a search answers with JSON, the sheet text and one `image/jpeg` block; cards have `n` 1 to 6; the JPEG is 1230 px wide;
  - `pictures: false`: no picture, no `n`;
  - saves with no picture on disk at all: no sheet, no `n`, the answer equals today's;
  - `get_reference` with `pictures: [2]` on a save with three prepared pictures returns exactly the second, with its label; two ids with `pictures`: a plain error; number 9 of 3: a plain error that says the save has 3;
  - the short answer (`facets`) lists `pictures`.
- Open one real sheet from the copy (a search for "dashboard" on 4667, save the JPEG to `.copy/mix-sheet.jpg`) and look at it yourself: every number readable, no stretched picture, a site shows its first screen.
- `scripts/measure-search.ts` again into `.copy/mix-measure-after.txt`: the text of each answer grew by less than 300 characters.

---

## Package 2: the mix travels with the sketch

### 1. The table

In `server/db.ts`, where the other tables are made:

```sql
CREATE TABLE IF NOT EXISTS sketch_mix (
  sketch TEXT NOT NULL,
  version INTEGER NOT NULL,
  project TEXT NOT NULL,
  mix TEXT NOT NULL,          -- JSON, see below
  checks TEXT,                -- JSON, what the fresh look found (Package 5); may be empty
  created_at TEXT NOT NULL,
  PRIMARY KEY (sketch, version)
);
```

Only add. Don't touch any other table.

### 2. New file `server/mix.ts`

The shape:

```ts
export interface Take {
  save: string;                 // the save's id
  role: "hero" | "helper";
  job: string;                  // "structure", "color", "the glow", or a section's name on a whole page
  take: string;                 // the exact thing: the move, the hex, the font, the proportion
  leave?: string;               // what not to take from it
  picture?: number;             // which of the save's pictures shows it (its n)
}
export interface Mix {
  takes: Take[];                // 1 to 8, exactly one hero
  shares?: string;              // what the saves have in common, one line
  unusual?: string;             // the one thing that makes it not look like the hero
  no_save_behind?: string[];    // the parts that come from no save
}
```

Functions:

- `cleanMix(input)`: checks and tidies. It throws a plain message FRIDAY can act on, and nothing is saved, when:
  - there is not exactly one hero: `A mix has exactly one hero: the save that gives the structure. This one has N.`
  - a save doesn't exist: `No save with id X.`
  - a save has more than one prepared picture and `picture` is missing: `Say which picture of X shows what you take (picture: n). It has N pictures; get_reference lists them.`
  - `picture` is out of range: say how many the save has.
  - Texts are trimmed: `job` 40 characters, `take` 240, `leave` 160, `shares` and `unusual` 200, each `no_save_behind` 80, at most 12.
- `saveMix(project, sketch, version, mix)` and `mixOf(sketch, version)`: the mix of the newest version at or below `version` that has one (a sketch keeps its mix through later edits).
- `mixPictures(mix)`: for each take, hero first, at most 6: the file of its picture (`picture`, or the save's only picture) and a caption: `Took from <id>, picture <n> (<label>): <job>: <take>`.
- `smallPicture(file)`: that picture as a JPEG at most 768 px on its long side, made on the fly with ffmpeg into the temp folder and deleted after reading. If ffmpeg fails, the picture as it is.

### 3. `make_sketch` and `edit_sketch`

In `server/mcp-tools.ts` and `server/board.ts`:

- New input `mix` on both (the shape above, as a zod object). Description: "What this sketch takes from which save: one hero that gives the structure, one or two helpers with one job each, and for each the exact thing to take, what to leave, and which of its pictures shows it. Leave it out for a sketch that takes from no save, and for a small change."
- `uses` stays as it is. Every save in `mix.takes` is treated as if it were also in `uses` (it gets its "uses" line when it is on the canvas).
- `makeSketch`: clean the mix **before** rendering, so a bad mix costs no render. Save it for version 1. With no `mix` but `from` another sketch that has one: the new sketch starts with a copy of that mix.
- `editSketch`: with `mix`, save it for the new version. Without, nothing is written (`mixOf` finds the earlier one).
- A wireframe takes no mix: ignore it there.
- The answer (`made` and `sketchContent`):
  - the JSON gets `mix`: the mix that holds for this version, as stored;
  - after the sketch's own screens, when there is a mix: one text block `What it took from, small. Compare each with the screens above.`, then for each of `mixPictures`: its caption and its small picture;
  - `next` gets one more sentence when there is a mix (constant `MIX_LOOK`): `Then compare with the pictures it took from: is each taken part really there, as in its picture? Is the page a copy of the hero? Which sections have no save behind them? Fix what is missing before you reply, and say in a line what still has no save behind it.`
- `get_sketch`: the JSON gets `mix` too. New input `compare: boolean`, default false: "Also the pictures it took from, small, after its screens."

### Done when

- New `tests/mix.test.ts`:
  - a sketch made with a mix of two saves (give each a real JPEG, and one of them three prepared pictures in `reads.signals`): the answer's JSON has `mix`, and after the screens come two captions and two `image/jpeg` blocks, hero first, each at most 768 px on its long side;
  - no hero, two heroes, an unknown save, a missing `picture` on a save with three, `picture: 9`: each a plain error, and no sketch is on the canvas afterwards;
  - `edit_sketch` without `mix`: the answer still carries the first mix and its pictures; with a new `mix`: the new one, and version 1 still has the old one (`get_sketch` with `version: 1`);
  - a sketch made `from` a sketch with a mix carries it;
  - both saves on the canvas get a "uses" line though `uses` was not passed;
  - a wireframe with a mix: made, no mix stored;
  - `get_sketch` with `compare: true` returns the pictures, without it only the JSON's `mix`.
- The test companion must not run the fresh look: Package 5 adds the switch; until then there is none to run.

---

## Package 3: FRIDAY writes the mix card

Words only. This is the heart of the plan: read the report's sections "Why the models fail at this" and "What works, by the evidence" before writing a word, and keep every line below unless it is wrong for the code as you find it.

### 1. `server/chat.ts`, `SYSTEM`

Under "How the app shows your answer", after the line about rows of pictures, add:

```
- [[id#3]] is that save's picture number 3 (a site's exact screen, a video's frame grid), shown as that picture. Use it wherever you mean one exact picture of a save.
```

In "Sketches (on a project's canvas)", **replace** the line that starts "Pass uses:" with:

```
- Pass mix: the mix card of what the sketch takes from which save (see "Taking from saves"). uses is only for a save the sketch leans on with no single part to name.
```

After the last line of the Sketches section (the one about "Alternates") and before "The studio", add this section. It must not sit between "Making a whole thing, step by step" and "Sketches (on a project's canvas):", because `STEPS_SECTION` cuts that stretch out when there are no recipes.

```
Taking from saves (the mix card):
- You copy one clear picture well. You mix several badly when you work from what was written about them: the result is their words on your own habits, and the designer calls that a template. So before a sketch takes from saves, turn the mix into one exact thing to copy: the mix card.
- Look first, with your eyes. Choose on a search's sheet, then open what matters with get_reference, and for a site or a video the exact pictures you would take from (pictures: [n]), at full size. Never take from a save you haven't seen a picture of in this conversation, and never from a read's words alone. When a value you need isn't measured, say so; don't guess it quietly.
- A mix card has one hero: the save that gives the structure (what sits where, the proportions, the rhythm down the page). It has one or two helpers, each with one job (the color, the type, one detail, the motion). For each save it says what to take, exactly (the picture, the hex, the font, the move), and what to leave. It says in a line what the saves share, which is why they can sit together, and it names the one unusual thing: what makes this not look like the hero.
- Three saves is the usual limit. More only when the designer named them, or on a whole page, where each section names the one screen it follows.
- The hero must give the structure. Whatever has no save behind it comes out as your habit. So the card also lists what has no save behind it. For each such part, either find a screen for it (search with look for that kind of section) or say why the plain way is right here.
- When the designer gave the mix ("the hero of this one with the glow of that one"), write one card that says it back exactly, with the pictures you opened and the values, and sketch in the same answer. Don't ask.
- When the choice of saves is yours (a first direction, "make something from my library"), write three cards, each with a different hero, different in kind, a few lines each. Then ask which (ask_designer, with the three heroes as its saves) and stop. If they said to just make it, choose the strongest card yourself, show it, and sketch.
- Write a card in this shape, with nothing else in it:
  **Mix A: a name of two to four words**
  [[hero#n]] [[helper#n]] [[helper#n]]
  - Structure from [[hero]]: take …; leave ….
  - Color from [[helper]]: take …; leave ….
  - They share: ….
  - The unusual thing: ….
  - No save behind: ….
- Pass the card to make_sketch as mix. A small change to a sketch needs no new card: the sketch keeps its mix. When a change takes something new from a save ("use the colors of this one"), pass the changed mix to edit_sketch.
- The sketch comes back with the pictures it took from beside its screens, and with mix_checks: what a fresh pair of eyes found when it compared the two. Compare them yourself too, before anything else. Fix every take marked "missing", and a page marked as a copy, with edit_sketch, then look again. Only then reply, and say in a line what the check found and what still has no save behind it.
```

Leave the rest of `SYSTEM` alone. In the line of "Sketches" that says "Make it from what's settled: the locked decisions, their chosen saves (look at them first)", change "(look at them first)" to "(open the pictures you take from first)".

### 2. Plan, then build

- `plannerNote` in `server/chat.ts`: replace "and each save to use with what to take from it ([[id]] and the exact thing: the hex, the font, the layout move)" with "and the mix card, written out in full as the mix to pass to make_sketch: each save's id, its role, its job, the exact thing to take, what to leave, and the number of the picture that shows it".
- `builderIntro` in `server/duo.ts`: after "from the saves it names" add ": open the exact pictures the plan's mix names (get_reference with pictures) before you make anything, and pass the mix to make_sketch". Keep "Don't look for other references."
- `tests/duo.test.ts` may compare these texts: update what it expects.

### 3. The recipes

`recipes/website.md`:

- **Gem**, the line "Offer three ideas, different in kind…": after "and two or three saves that show the craft" add ", each as the exact picture that shows it ([[id#n]]) with what to take from it and what to leave".
- **Hero**, add as the first bullet: "Write the mix card first, one card: the hero of the card is the save whose first screen gives this one its structure. Take it from the saves chosen so far. If none of them gives a structure, search with look for one, show two or three with the question (its saves) and ask which. The gem, the color and the type are decided already: they are not helpers."
- **Whole page**, add after the first bullet: "Before the sketch, go down the wireframe section by section and name, for each, the one screen of a save it follows (search with look for that kind of section, open the screen), or say that it has none. That list is the mix you pass to make_sketch, each section as a take with its name as the job. A section with no save behind it gets a line on what its job is and why the plain way fits. If most sections have none, stop and find screens first."
- **Whole page**, the last check: add a fourth question: "4. Which sections have no save behind them, and what did the fresh look say about them?"

`recipes/poster.md`: in **Idea**, the same addition as Gem. In **Layout**, the same first bullet as Hero, in a poster's words ("the save whose composition gives this poster its structure").

Recipes are read fresh on every message; `tests/steps.test.ts` may hold their text: update what it expects.

### Done when

- `bun test tests` passes. Add to an existing test of `systemPrompt` (see `tests/skills.test.ts`): the instructions contain "Taking from saves (the mix card):" for the one-model reader and the planner, it comes after "Sketches (on a project's canvas):", and with no recipes in the folder it is still there.
- Print `systemPrompt("solo")` once on the copy and read it top to bottom as FRIDAY would. Nothing may contradict anything else (the old `uses` line is gone; "Place 4 to 8" and the rest are untouched). Save it to `.copy/mix-prompt-solo.txt`.

---

## Package 4: one exact picture in FRIDAY's words

So the designer sees the screen a card means, not the save's cover.

- A token `[[id#n]]` (n is 1 or 2 digits) is that save's picture n. `[[id]]` works exactly as today.
- Server: a GET route `/api/refs/:id/picture/:n` that sends the prepared picture n of that save (the file from `reads.signals.visuals[n-1]`), or 404. Read-only, like `/media`. Add it to `web/src/api.ts`.
- Every place that reads `[[id]]` must also accept `[[id#n]]` and never show the raw token. They are:
  - `web/src/StreamText.tsx`: `REF`, `INLINE`, `holdBack`;
  - `web/src/Assistant.tsx`: `REF_IN_TEXT`, the two `.replace` calls near line 861, the `split` near 894 and the match near 942;
  - `server/chat.ts`: near lines 267, 474 and 611.
  Search for `0-9a-f]{16}` to find any that were added since.
- How it shows: the same chip or row tile as `[[id]]`, but its picture is picture n, and under or beside the save's name a small quiet label says what the picture is, cut short ("Screen 3 of 12"). In a row of pictures (several tokens on a line of their own), tiles keep today's size. Clicking opens the save, as today. If picture n doesn't load, fall back to the save's usual thumbnail.
- Reuse the classes in `styles.css`. Read `unugly.md` before adding any style. Grayscale, quiet.

### Done when

- Rebuild the copy's UI and look at it on 4667 in the browser: a message with `[[id]]`, `[[id#2]]` inline, and three `[[id#n]]` on a line of their own (write one into the copy's `chat_messages` by hand, or use a real answer from Package 6). Save `.copy/mix-chips.jpg`.
- A chat's title made from a message with `[[id#2]]` reads as the save's name, not the token.
- `bun run typecheck` passes.

---

## Package 5: the fresh look

A separate Claude compares the sketch with what it took from. Its findings come back with the sketch, like `rule_checks` do.

### 1. New file `server/mixcheck.ts`

`checkMix(project, sketch, version, mix, device)` returns `MixChecks | { not_checked: string }`. It never throws.

- **What it sees.** In a new temp folder: every screen of the sketch, up to 8 (render the version once more with `renderUrl(url, device, file, 8)` into that folder, so the whole page is seen, not only the three screens FRIDAY gets), named `sketch-1.jpg`…; and each take's picture at full size, named `take-1.jpg`…. Delete the folder afterwards.
- **How it runs.** Copy the way `readWithClaudeCode` runs in `server/read.ts`: `claude -p`, `--tools Read --allowedTools Read`, `--output-format json --json-schema …`, `--no-session-persistence --strict-mcp-config --setting-sources ""`, the clean environment, `cwd` the temp folder. Model: `settings.model()` (the one design reads use). Effort: `medium`. Stop it after 120 seconds.
- **What it is told** (system prompt):

```
You are a strict second pair of eyes for a designer. Another model made a page and says what it took from which reference. You have not seen their conversation. Open every listed picture with the Read tool, then answer only with the form.

Judge only what you can see. Be hard to please: the usual failure is a page that carries a reference's color and one detail while its structure is a common template.

1. For each take: is the thing really there in the page, as it is in the reference's picture? "there": a designer would see it at once. "partly": the idea is there but weaker, smaller, or changed in a way that loses it. "missing": it is not there, or only its words are. Say in one line what you see.
2. Is the page a copy of the hero? "copy": it would be mistaken for the same site with other words. "close": the structure and the look are both the hero's, with little of its own. "own": it takes what the card says and is clearly its own page.
3. Name each section of the page, top to bottom. For each, say whether it follows something in the references, or looks like a common template block (text left and picture right; three cards in a row; heading and grid; a centred headline over a gradient).
```

- **The prompt**: the list of files with what each is (the sketch's screens in order with the page's height; each take's picture with its caption from `mixPictures`), then the mix as JSON.
- **The form** (JSON schema, all required):

```json
{
  "takes": [{ "save": "id", "job": "…", "verdict": "there | partly | missing", "note": "one line" }],
  "copy": { "verdict": "own | close | copy", "note": "one line" },
  "sections": [{ "name": "Hero", "follows": "the save's id, or 'none'", "template": true, "note": "one line" }]
}
```

- **What FRIDAY gets** in the sketch's JSON, as `mix_checks`: an array of short lines made from the form, worst first, each `{ mark: "breaks" | "check" | "fine", what: "…" }`:
  - a take that is `missing`: breaks; `partly`: check; `there`: fine;
  - `copy`: breaks; `close`: check; `own`: fine;
  - a section with `template: true` and `follows: "none"`: check, as `"<name>: no save behind it, and it reads as a template block: <note>"`;
  - when it could not run: `mix_checks: "not checked: <why, in plain words>"`.
- Store the form in `sketch_mix.checks` for that sketch and version. If that version has no row of its own (an edit that kept the mix), write a row with the same mix and these checks.

### 2. When it runs

- On `make_sketch` with a mix (not a wireframe).
- On `edit_sketch` when a `mix` is passed, when `html` rewrites the whole page, or with the new input `check: true` ("Ask the fresh look again, after fixing what it found. Once per answer is enough."). Not on small edits: they carry the last checks forward, marked `"mix_checks_from_version": N`.
- It runs at the same time as the skill checks, so a sketch waits for the slower of the two, not both.
- Only when the setting `mix_check` is not `"0"` (`getSetting`). `tests/helpers.ts` seeds `('mix_check', '0')` beside `ai_auto`, so no test ever calls Claude. With it off, `mix_checks` is absent.
- For tests of what FRIDAY gets: when the environment has `PANEL_MIX_CHECK_FAKE` (a path to a JSON file holding a form), `checkMix` reads the form from there in place of calling Claude, even with the setting off. This is the same idea as `PANEL_FIGMA_APP` in `tests/figma.test.ts`.
- Not counted in `ai_usage` (that table counts design reads).

### 3. Words

- `MIX_LOOK` (Package 2) gets: ` mix_checks are what a fresh pair of eyes found when it compared the page with those pictures: fix every one marked breaks before you reply; for each marked check, fix it or be ready to say why it stays.`
- The `SYSTEM` text in Package 3 already names `mix_checks`.

### Done when

- `tests/mix.test.ts` grows: with `PANEL_MIX_CHECK_FAKE` holding one `missing` take, a `close` copy and one template section, the sketch's answer has `mix_checks` with one "breaks" and two "check" lines in that order; a small `edit_sketch` afterwards carries them with `mix_checks_from_version`; `check: true` runs it again; with no fake and the setting off there is no `mix_checks`.
- A file that isn't valid JSON as the fake: `mix_checks` is `"not checked: …"`, and the sketch is still made.

---

## Package 6: look it all over

### Without FRIDAY

- `bun run typecheck`, `bun test tests`.
- `tests/instructions.test.ts` still passes (instructions under 4,000 characters, every tool description under 2,000).
- `git diff --stat`: only files this plan names, plus tests.

### Live check on the copy (4667): at most 6 FRIDAY messages and 4 sketches

Set `mix_check` to `1` on the copy. Use the project "NavTech Web 2.0" or "CRM" on the copy. Keep every answer's parts (`chat_messages.parts`) and every sketch's screens in `.copy/` as `mix-live-N.*`.

1. **Search by eye.** "find me references for a calm fintech hero, light, with real product UI". Check in the session file (`~/.claude/projects/` + the copy's chat folder) that the search's answer held one picture, and that FRIDAY then opened at least one save with `pictures: [n]`.
2. **The designer gives the mix.** Select nothing; write: "make a hero: structure from [[cd6b1292ca874913]], the glow from [[1b418727c10b46cb]]. Product is GorillaCRM." Expect: one mix card in the shape, with `[[id#n]]` pictures; no question; `make_sketch` with `mix`; the answer to it holds the sketch's screens and two small pictures; `mix_checks` is there; FRIDAY's reply says in a line what the check found.
3. **FRIDAY chooses.** In a new chat: "make a landing hero for a logistics software company from my library". Expect: three cards with three different heroes, a question with buttons, and no sketch yet.
4. Press a choice. Expect one sketch made from that card, with its check.
5. **A small change.** "make the button white". Expect `edit_sketch` with no `mix`, no new card in the reply, and no fresh look (the checks are carried from the version before).
6. One spare message, for whatever needs a second try.

For each, say in the report what happened against what was expected. If FRIDAY skips the card, or never opens exact pictures, don't add more instructions on your own: report it with the session file's name.

Look at the four sketches yourself next to the pictures they took from, and say honestly in the report whether each taken part is there.

## Left for later (don't build)

- The A/B test on three old briefs (CRM hero, NavTech landing, journaling app): the old way against the new way, judged blind by the designer. It comes right after this plan is checked.
- Pointing at a part of a save (today only a part of a sketch can be pointed at).
- A small tile before the page (colors, type, one component, the detail).
- Remembering the mix across projects and showing it on the canvas.
- Alternates that each take from a different save. `ANGLES` stays as it is.
- Making `gather_for_brief` check that its picks suit each other.
- The mix in the hand-off to Claude Code (`writeHandoff`).

## The report

Write `docs/mix-report.md`:

1. **What was built**, package by package, with the files changed.
2. **What differs from this plan**, and why. Every place you chose differently.
3. **Checks**: typecheck, tests (how many pass), the sizes from `measure-search.ts` before and after, the length of the instructions.
4. **The live check**: the six messages, what was expected and what happened, with the files kept in `.copy/`. How long each sketch took with the fresh look, and how long the fresh look alone took.
5. **What you saw with your own eyes**: the sheet, the chips, the four sketches beside their pictures.
6. **Not done or not sure**, plainly.
7. **A summary of ten lines or fewer** in very simple English for the designer, using the app's own words, to paste back.

Then stop. Don't commit, and don't restart the real app.
