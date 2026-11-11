# Report: in "Plan, then build", the builder keeps its own short conversation (step 2b)

Carried out on 11 Nov 2026 from [builder-brief-plan.md](builder-brief-plan.md), after [shorten-sooner-plan.md](shorten-sooner-plan.md) was done. Everything ran on the copy (`.copy/lib`, server on port 4757). Claude was called for exactly the five FRIDAY messages of the live check, plus the short conversation names Panel makes on its own for the two new conversations. Nothing was committed. The real app on 4646 was not touched or restarted.

## 1. What changed

**`server/chat.ts`**
- **Two new columns on `chats`**, added in place with a comment each:
  - `builder_session_id`: the builder's own conversation in Claude Code;
  - `builder_card_hash`: which version of the project card that conversation was given.
- **Parts can be marked `builder: true`.** This applies to text, tool, thinking and compact parts. A builder's `make_sketch` step also keeps the id of the sketch it made (`sketch`). The marks are how the planner is told what was made, from the stored answer, even after a restart.
- **`reader()` takes `builder: true`.** A builder run:
  - stores its conversation id in `builder_session_id` and leaves `session_id` alone;
  - leaves the context meter alone (`context_tokens`, `context_limit` and the `context` event);
  - marks its parts;
  - starts a text part of its own, so its words never run on into the planner's.
- **New `build()`**: the builder's model at work on its own conversation. It continues `builder_session_id`, or starts it.
  - It always has the same tools and instructions: Panel's tools only, and `systemPrompt()` as it is. The planner's `friday` tool server is no longer given to it.
  - When the stored conversation is gone, it starts a new one quietly, with the same `lost()` test as `drive()` and `duo()`.
  - The card version it gave is stored when the answer finishes well (`run.builderCard`, written in `finish()`, as `run.card` is).
- **`duo()`**: after `hand_to_builder`, it calls `build()` with the brief. It no longer resumes the planner's conversation. `builderPrompt` became `builderIntro`, which now says the builder hasn't seen the planner's conversation and reads what it needs with `get_project`, `get_sketch` and `get_reference`.
- **`plannerNote`** has a new line: the builder doesn't see this conversation, only the plan, the designer's message and the project card. So the plan must stand on its own, and the planner's next message will start with a note of what was made.
- **`send()`**:
  - It works out the job (plain, pointed, Figma, alternates, /compact) before building the context, and from that the conversation it runs on (`whichConversation`).
  - It notes which lines of the context only the main conversation gets: its own copy of the card, and the note of what the builder made. The builder's message is the same context without those lines.
  - On a run on the main conversation, it adds the note of what the builder made (`builderNews`, built from the stored answers).
  - In Plan, then build, a pointed edit or a Figma rebuild now runs `build()` on the builder's conversation instead of `drive()` on the main one.
  - The `.catch` handlers became one `failed` function. They do the same thing.
- **`recentAnswers()`**: the last six stored answers of a conversation, newest first, for the note.

**`server/duo.ts` (new)**
- It holds the decisions, with no side effects, so they can be tested: `whichConversation`, `builderCard`, `builderBrief`, `builderNews`, `builderIntro` and the `Job` type.
- They are kept apart because `chat.ts` opens the library as soon as it loads. A test that imported it could reach the real library (see 6).
- It has no dependency beyond the type imports.

**`tests/duo.test.ts` (new, 16 tests)** and **`tests/helpers.ts`**
- `startPanel()` takes an optional `sql` to run on the empty library before Panel opens it. One test uses it to start from an older library whose `chats` table lacks the new columns.

**Done differently from the plan, and why**
- **The decisions live in `server/duo.ts`, not in `chat.ts`.** This was for test safety; see above.
- **The note covers more than "the answer just before".** It walks back through the stored answers while they are builder-only: pointed edits or Figma rebuilds in Plan, then build, which the planner doesn't take part in. It stops at the first answer the main conversation took part in, which was already told about everything before it. With the plan's "only the answer before", a hand-over followed by a pointed edit would have lost the hand-over from the note. It is still built from the stored parts (not `sideNews`), and each piece of work is told once.
- **The builder's words in the note are cut at about 320 characters.** This keeps the note at "a few hundred characters". Here it came to about 600 characters in all.
- **Pointed edits and Figma rebuilds keep showing no model on their steps**, as today. The hand-over's builder steps keep theirs.

**Alternates were moved, as the plan asked.**
- In Plan, then build, the copies fork the builder's conversation when there is one. When there isn't, they start fresh, with the card in their message (by the same rule as the brief) and without the main conversation's own lines.
- In One model they fork the main conversation, as before.
- The note to the main conversation after alternates is still `sideNews`, unchanged.
- **Not tried live.** The plan's five messages don't include alternates, a pointed edit or a Figma rebuild.

## 2. One model mode

I read the finished diff once only for this:

- **`reader()`**: every new branch depends on `builder`, which only `build()` sets. With it off:
  - the session goes to `session_id` and the meter is written, as before;
  - the parts get no extra fields, and text parts merge as before (`!!last.builder === builder` is `false === false`);
  - the new `sketch` field is only for builder runs, so One model stores exactly what it did.
- **`send()`**:
  - `said` is built in the same order with the same lines, and the planner's `words` and `prompt` are the same strings.
  - `builderNews` returns nothing for a conversation that never had builder work. Parts are only marked in Plan, then build, so a conversation that was always One model never gets a note.
  - The extra database reads (`builder_session_id`, the last answers) only read.
- **Which run starts:**
  - `/compact` goes to `drive()` as before.
  - Alternates have the same condition (`base && n >= 2 && engine !== "cli"`), with `said.join(" ")` and `chat.session_id` as before.
  - Everything else goes to `drive()` with the same model and effort.
  - `duoOn` is false, so neither `duo()` nor `build()` can start.
- **Tests:** `whichConversation` sends every kind of job to the main conversation in One model. The whole suite passes.
- **Not tried live.** One model was not run with Claude; the plan's live check is Plan, then build only.

The one intended change: a conversation that was in Plan, then build and is switched to One model gets the note of what the builder made. That is how One model learns about it, as the plan's section 6 says.

## 3. Live check

- **Where:** project **NavTech** (`dd1283fa655a45c5`) on the copy. Each run was a new conversation on its canvas, sent with `context: { project }`.
- **Settings:** the copy's picker was set to Plan, then build (planner Fable 5.2, builder Opus 5.5, both at high effort), and set back to One model afterwards.
- **Before:** the 4757 server was the one step 1 had left running, on older code. I stopped it and started it again from `panel-copy-search`, so the before run used this folder's code before any change here. It was restarted again after the change.

### Every row (ai_usage, mode chat)

| run | message | model | cache read | cache write | output |
| --- | --- | --- | ---: | ---: | ---: |
| before | 1. find three | Fable 5.2 | 113,887 | 77,069 | 4,662 |
| before | 2. sketch it: planner | Fable 5.2 | 357,785 | 47,119 | 19,728 |
| before | 2. sketch it: **builder** | Opus 5.5 | **790,810** | **148,537** | 24,817 |
| after | 1. find three | Fable 5.2 | 215,756 | 78,457 | 5,775 |
| after | 2. sketch it: planner | Fable 5.2 | 306,729 | 50,847 | 21,610 |
| after | 2. sketch it: **builder** | Opus 5.5 | **125,768** | **61,917** | 18,000 |
| after | 3. bigger headline: planner | Fable 5.2 | 436,952 | 24,362 | 13,043 |
| after | 3. bigger headline: builder | Opus 5.5 | **203,124** | 17,250 | 2,152 |

(Uncached input was 6 to 14 tokens in every row.)

**The builder's cache write on message 2**
- **Before: 148,537.** That is about the whole conversation: after that answer the meter read 149,242.
- **After: 61,917.** That is its brief (20,785 characters), plus its own work: reading the existing hero sketch's page, which the plan told it to reuse, making the new sketch and looking at its pictures, and one edit.
- **Its cache reads fell from 790,810 to 125,768.**
- Message 1 isn't comparable between the runs. The after planner did more searches, because the canvas now held the before run's sketch.

**Message 3**
- **The builder continued its own conversation.** Its cache read was 203,124 (clearly above zero) and it wrote only 17,250.
- **The planner knew what had been made without being told.** It went straight to `get_sketch` on the new sketch `5ea1bba5876641dc`, a sketch it had never seen, and wrote the edit plan from it.
- **`chats` row:** `session_id` = `769a9161-…` and `builder_session_id` = `4b2fb51a-…`, both set and different. `builder_card_hash` is the same as `card_hash`.
- **The meter** after message 2 read 141,718, the planner's own conversation. It was not overwritten by the builder.

**The note the planner was given at the start of message 3**, quoted from its Claude Code transcript:

> Since your last message here, the builder, working in a conversation of its own, made the sketch “Hero: one word, seven windows” (5ea1bba5876641dc); edited the sketch 5ea1bba5876641dc. It told the designer: “I made **Hero: one word, seven windows** on the canvas, under Hero, following the plan. - **What it tries:** «Создаём» is set wide in Hauss Next at 84% of the width. Seven sharp-edged tiles cluster in the middle of the word and look onto a slowly moving ice-blue blur, one tile per product. Six sit behind the letters.…” get_project lists what's on the canvas; get_sketch shows a sketch.

**The builder's two briefs**, from its own transcript:
- **First brief** (message 2), 20,785 characters: the intro, the project card **once**, the designer's message with its `<panel-context>`, then the plan.
- **Second brief** (message 3), 8,207 characters: the same shape, **no card**. The card hash hadn't changed.

### Tools each model called

- **Before, 1:** Fable called `get_project`, `get_verdicts`, `library_overview`, `search_library` ×4 and `get_reference` (7 ids, 4 facets, first picture).
- **Before, 2:**
  - Fable: `get_fonts`, `get_brand_assets`, `get_project_material`, `get_reference`, `get_project`, `get_sketch`, `hand_to_builder` (a 12,906-character plan).
  - Opus: `place_on_board` (3 saves under Hero), `make_sketch`, `edit_sketch` ×3, `get_sketch`.
- **After, 1:** Fable called `get_project`, `get_verdicts`, `library_overview`, `search_library` ×3, `gather_for_brief`, `get_reference` (6 ids), `get_sketch` (the before run's hero) and `get_reference` (4 ids).
- **After, 2:**
  - Fable: `get_sketch`, `get_brand_assets`, `get_project_material`, `get_reference` (1 id, all pictures), `hand_to_builder` (a 13,375-character plan).
  - Opus: `get_sketch` (the old hero, to reuse its code, as the plan said), `get_reference` (layout), `make_sketch`, `edit_sketch`.
- **After, 3:**
  - Fable: `get_sketch`, `hand_to_builder`.
  - Opus: `get_sketch` (no pictures), `edit_sketch`.

### The browser

In FRIDAY's panel on the copy, the answer to message 2 looks as it did before:
1. the planner's steps under "Fable 5.2", ending in "Handed the plan to Opus 5.5" with the plan;
2. the planner's line;
3. the builder's steps under "Opus 5.5" ("Looked at 1, made 1 sketch");
4. the builder's words.

The before conversation shows the same structure. Screenshots:
- `.copy/duo-after-panel.png`: both step groups with their models, and the builder's words.
- `.copy/duo-after-panel-planner-steps.png`: the planner's steps opened, ending in the hand-over.

### The two sketches (message 2)

- `.copy/duo-before-sketch.jpg`: "Hero: edge to edge, two widths".
- `.copy/duo-after-sketch.jpg`: "Hero: one word, seven windows".
- `.copy/duo-after-sketch-msg3.jpg`: the after sketch once message 3 changed it.

**They aren't the same design, and that isn't the builder's doing.** The after planner chose a different reference: the canvas already had the before hero, so it proposed something new. So I judged each builder against its own plan.

**My read: the builder, working from the brief alone, followed its plan at least as faithfully as before.**

The after plan gave exact positions, and the sketch matches them:
- all seven tiles are at the given x, y, w and h, in the given stacking order;
- «С» and «м» have no tile in front of them;
- the front tile covers only the feet of «а» and «ё»;
- the ground is flat #abaeb0, and the blue button is the only blue outside the tiles;
- «для бизнеса» sits under the left edge, on the pale Studio tile;
- there is no assistant launcher, as the plan said.

It changed three things and said so: it moved the front tile 12px down, calmed the tile texture, and added a glow behind the captions.

The before builder also followed its plan well. It too reported its one departure: a little letter-spacing on the first line, against the plan's "no letter-spacing".

**Nothing it needed seemed missing.** The plan told it to read the existing sketch, and it did, with `get_sketch`. On message 3 it read the current version before editing.

One run each is a sanity check of quality, not proof.

### The answers to message 2, in full

**Before.**
- The planner's text part was a single invisible character.
- The builder wrote mid-way: "The headline now runs edge to edge on both lines. Last step: checking the assistant panel."
- Then its final words:

> The hero sketch is on the canvas, hanging from a new **Hero** topic after Color. The three references are placed there too. "Создаём" and "для бизнеса" fill the screen from edge to edge, in one weight of Hauss Next, in ink. Behind them, a blurred ice-blue shape drifts slowly over a grey background that shifts between #e0e0e0 and #abaeb0. "Свяжитесь с нами" is the only blue on the page.
>
> **Where I went past the plan:** the font's width axis couldn't make the two lines meet on its own. At its widest, "Создаём" still came up about 5% short of "для бизнеса" at its narrowest. To close that last gap I added about 0.05em of letter-spacing to the first line only. The plan said no letter-spacing anywhere, so this is my call. Set the knob `--fill-track` to 0 and the line sits flush left, short of the right edge.
>
> **What to look at:**
> - Whether the very wide "Создаём" (round letters wider than they are tall) still reads as the same family as the narrow "для бизнеса". If it doesn't, lower `--wd-short-max`, and the first line will stop short of the right edge.
> - The Cyrillic at about 250px: Ё, д, л, б and з are all drawn by Hauss Next itself, not a fallback font. I raised the line spacing to 0.94 because at 0.9 the feet of the first line's д came within a few pixels of the б below it.
> - Other knobs worth trying: `--w-display`, `--leading`, and `--accent` set to the deck's cobalt #134b99.
>
> **Also changed:**
> - **Button shape:** the buttons use `superellipse(1.4)` instead of `squircle`. With squircle, a full radius rendered as a rounded rectangle. At 1.4 they read as capsules with smoothed corners.
> - **Background:** the first version came out as sharp, marbled swirls. I lowered the noise detail until it reads as out of focus.
>
> **Not done yet:** "Задать вопрос" opens the assistant. It asks for a name and won't send until it gets one, then greets the visitor by name, and that's as far as it goes. The language switcher only changes which code is bold. The nav links, "Связаться", "Свяжитесь с нами" and "Узнать больше" lead nowhere. Phone layout isn't designed; small screens just don't break.

**After.** The planner wrote:

> The builder has the plan and is working on it now; the sketch will appear under Hero on the canvas when it's done.

Then the builder:

> I made **Hero: one word, seven windows** on the canvas, under Hero, following the plan.
>
> - **What it tries:** «Создаём» is set wide in Hauss Next at 84% of the width. Seven sharp-edged tiles cluster in the middle of the word and look onto a slowly moving ice-blue blur, one tile per product. Six sit behind the letters. Speech Kit sits in front and covers only the bottom edges of «аё». «С» and «м» stay clear. «для бизнеса» sits under the left edge, on the pale Studio tile.
> - **Details:** The ground is flat #abaeb0, and the only blue outside the tiles is the «Свяжитесь с нами» button. Hovering or focusing a tile brings it to the front and shows the product name and category. The tiles drift slightly with the pointer.
> - **Knobs:** There's a knob for the field colours, the size of the word and the tile corners. To try it on graphite, set --bg to #151519 and --ink to #a9abb5.
>
> **Where I went off the plan:**
> - **Tile texture:** The first render looked like marbled liquid, not a blur. I zoomed the field out a lot and calmed the distortion, so each tile now reads as a soft out-of-focus photo with grain.
> - **Front tile:** I moved Speech Kit down 12px. At the planned height it hid about a quarter of «а» and «ё». Now it trims only their feet.
> - **Captions:** When a caption shows, a pale glow rises from the tile's bottom-left corner. Without it, the caption would be hard to read on the dark Flow tile.
>
> **What it doesn't do yet:** The tiles stand in for real product screens. The «Задать вопрос» assistant is left out, and I haven't designed the phone layout. It only scales down without breaking.

The raw outputs are in `.copy/duo-before-1.txt`, `-2.txt` and `.copy/duo-after-1.txt` to `-3.txt`. The stored answers are in `.copy/duo-before-parts.jsonl` and `.copy/duo-after-parts.jsonl`.

## 4. Checks

- `bun run typecheck`: passes.
- `bun test tests`: **79 pass, 0 fail** across 13 files, including the 16 new tests in `tests/duo.test.ts`. They cover:
  - which conversation each job continues, in both modes;
  - the brief's order, the card when the conversation is new or the card changed, and never the card twice (across messages, or when the message already carries it);
  - attachments placed between the message and the plan;
  - the note: names the sketches, carries the builder's words, has no HTML, is empty without builder work, and is told once;
  - the two columns added to an older library, empty, with its rows kept.
- No other session's test failed.

## 5. The database

- **Copy and test libraries:** `builder_session_id TEXT` and `builder_card_hash TEXT` were added in place to `chats` in the copy (`.copy/lib`) when the 4757 server started on the new code. They are also added in every test library. Nothing was renamed, dropped or rewritten.
- **Real library: not there yet.** I checked read-only: `PRAGMA table_info(chats)` in `~/DesignLibrary` lists `id, title, session_id, created_at, updated_at, card_project, card_hash, context_tokens, context_limit, project_id`. I did not add them.
- **Where the plan was wrong:**
  - The plan expected a Claude Code session starting Panel's MCP to add them. **It won't.** `server/mcp.ts` loads `mcp-tools.ts`, which doesn't load `chat.ts`, and `duo.ts` only borrows a type from it.
  - The columns will appear in the real library when **the real app restarts on this code**. The real app's old code is unaffected by them.
- **The other copy server:** the 4747 server (another session's, old code) uses the same `.copy/lib`. The `chat_mode` setting there was "duo" from about 06:36 to 07:10. Any FRIDAY message sent on 4747 in that window ran in Plan, then build. It is back to "solo", as it was.

## 6. Doubts

- **Effort differs by job.** A pointed edit runs the builder at low effort, a Figma rebuild at medium and a hand-over at high, as before. I don't know whether changing effort between jobs costs the builder's cache. If it does, the cache would only partly carry over between a hand-over and a pointed edit. Message 3 was a hand-over at the same effort, so the live check didn't show it.
- **Pointed edits, Figma rebuilds and alternates in Plan, then build weren't run live.** They are covered only by reading the code and the tests of `whichConversation` and `builderBrief`.
- **`/compact` and the note.** If the designer types `/compact` right after a build, the compact answer stops the note from walking back past it. The work the builder did before it would then not be told. The summary wouldn't have it either. It is rare, but the planner could miss one build.
- **Alternates' note is still `sideNews`.** It is kept in memory only, as before, so a restart loses it. Their steps aren't marked as the builder's, so `builderNews` doesn't repeat them.
- **The builder's conversation grows on its own.** Claude Code summarizes it at the same size as the main one. A builder summary appears in the answer as a "summarized" line like the main one does, though the meter belongs to the main conversation.
- **The brief keeps one line meant for the planner.** The designer's message still carries "References you find for it go on the canvas (place_on_board)". It is harmless (the builder does place), but it could be trimmed.
- **On the 2a step:** both conversations' meters reported a summarizing point of 207,000 tokens, so "about 210K" in step 2a's report holds.

## 7. For the designer

In "Plan, then build", the builder now works in a conversation of its own. Each time, it gets the plan, your message and the project card, instead of re-reading the planner's whole conversation. On the copy, the builder's tokens for one hand-over fell from about 940K to about 190K, and it followed the plan just as closely. The planner is told in a few lines what was made.

One model works exactly as before. Your real Panel keeps the old behaviour until it is restarted, and that restart is when the two new, empty columns get added to your library. Nothing was committed.
