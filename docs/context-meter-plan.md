# How full the conversation is, and what fills it

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, then
[CLAUDE.md](../CLAUDE.md) and [unugly.md](../unugly.md), then the code it names, before
touching anything. Line numbers are as of commit `2ed4453`. When you finish, write the report
described at the end and stop.

## What the designer asked for

"On the input field that I have, I want to see the context window. Claude shows how many
percent is used already, and then when I click, it shows me everything that is taking up
space. I want to know that too." They mean the way the Claude Code desktop app does it: a small
percent by the message box, and a list behind it.

## What is there today

- After every answer Panel already asks Claude Code how full the conversation is
  (`q.getContextUsage({ detail: "summary" })`, [chat.ts:1329](../server/chat.ts:1329)) and keeps
  two numbers on the chat: `context_tokens` and `context_limit` (the point where Claude Code
  starts summarizing). They reach the page as `{ t: "context", used, limit }` and as `context`
  on the chat ([chat.ts:268](../server/chat.ts:268), [api.ts:616](../web/src/api.ts:616)).
- The page shows it only inside the model chip, and only past 50%
  ([ModelPicker.tsx:57](../web/src/ModelPicker.tsx:57)). The bar and "Summarize now" are inside
  the model menu ([ModelPicker.tsx:91](../web/src/ModelPicker.tsx:91)).
- Nothing says what fills it. The same call can: its answer
  (`SDKControlGetContextUsageResponse`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
  line 4104) has `categories` (each with a stable `id`, `tokens` and `kind`) and
  `messageBreakdown` (the designer's messages, FRIDAY's answers, what tools returned, attached
  files, and `toolCallsByType`: tokens per tool).

## The design

**By the message box**: a small ring that fills as the conversation does, with the percent
beside it (`◔ 45%`), always there once the conversation has an answer. It is its own button, to
the left of the model chip. Grayscale; from 85% it takes the `high` look the chip's percent has
today. The model chip loses its percent.

**Pressed**, a small panel opens above it (`.popover`, like the model menu):

```
This conversation                          212K of 467K · 45%
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░   (one bar, a shade per row)

The conversation                                      168K
   What FRIDAY read and looked at                     131K
      Sketches it read                                 74K
      Saves it looked at                               41K
      Projects it read                                 16K
   FRIDAY's answers                                    29K
   Your messages                                        6K
   Files you attached                                   2K
FRIDAY's instructions, your rules and skills           27K
Panel's tools                                          14K
Claude's own tools                                      3K
Room left                                             255K

When it fills up, the earlier part is summarized and FRIDAY
gets the project card again.                [ Summarize now ]
```

- Rows are biggest first; "Room left" is always last; rows with nothing in them are left out.
- Names by the category's `id`, never by its English `name`:
  `messages` → The conversation · `system_prompt` → FRIDAY's instructions, your rules and
  skills · `mcp_tools` → Panel's tools · `mcp_instructions` → How Panel's tools are used ·
  `system_tools` → Claude's own tools · `skills` → Claude Code's skills · `memory_files` →
  Notes · `custom_agents` → Helpers · `free_space` → Room left · `autocompact_buffer` and
  `compact_buffer` → Kept free for summarizing. Rows of `kind: "deferred"` are left out. A row
  with an `id` Panel doesn't know is shown under the name Claude Code gave it.
- Under "The conversation", from `messageBreakdown`: what FRIDAY read and looked at (tool
  results plus tool calls), FRIDAY's answers, the designer's messages, attached files. Under
  the first, the six biggest tools, named in the same plain words the chat already uses for a
  tool's step (find where `Assistant.tsx` turns a tool's name into words like "Sketching" and
  reuse or mirror it; a tool it has no words for shows its own name).
- Numbers as `212K`. The percent is `used / limit`, as today, so 100% is the moment Claude Code
  summarizes.
- "Summarize now" does what it does today (`/compact`); it moves here from the model menu.
- In "Plan, then build" add one faint line: "This is the planner's conversation. The builder
  keeps its own."
- A conversation whose answers were all made before this change knows only the two numbers:
  show the bar and the total, and "Send a message to see what fills it."

## Rules for you

- **Never test on the real app** (port 4646, `~/DesignLibrary`). Never run `bun run build`,
  `bun run start` or `scripts/copy.sh`.
- **Your copy**: the library in `.copy/lib` (shared with other sessions; you only add to it),
  your own UI in `.copy/dist-meter`
  (`bunx vite build --outDir "$PWD/.copy/dist-meter" --emptyOutDir`), on port **4727**: add
  one line to `.claude/launch.json`, `panel-copy-meter`, like the others there.
- **Another session is rebuilding the studio at the same time**
  ([studio-figma-plan.md](studio-figma-plan.md)). It owns `web/src/Studio.tsx`,
  `web/src/Knobs.tsx`, `web/src/studio.css`, `server/sketches.ts`, `server/board.ts` and more.
  **Your files**: `server/chat.ts` (only the lines about context), a new
  `server/contextparts.ts`, `server/db.ts` or wherever `context_tokens` is added
  ([chat.ts:57](../server/chat.ts:57)), `web/src/api.ts` (the `ContextUse` type and the
  `context` event), `web/src/ModelPicker.tsx`, a new `web/src/ContextMeter.tsx`,
  `web/src/Assistant.tsx` (only where the composer puts `ModelPicker`, near line 1939, and
  where `use` is kept), `web/src/assistant.css`, a new `tests/contextparts.test.ts`. Read a
  shared file again right before each edit; never reformat it. Never `git stash`,
  `git checkout --` or `git reset`. If the type check fails in a file you didn't touch, wait a
  few minutes and try again; if it still fails, say so in the report and leave it.
- **The database only grows**: one new column on `chats`, `context_parts TEXT`, empty for old
  chats, added in place the way `context_tokens` is. The real app on the old code runs beside
  it and must not notice.
- **The answer must not feel slower.** The call sits after the answer's `result` has been
  handled; keep it there. First see whether `detail: "summary"` already gives `categories` and
  `messageBreakdown`; use `"full"` only if it doesn't, and say in the report how long the call
  takes (time ten of them). If `"full"` takes more than a second, make sure the page shows the
  answer as finished before it.
- Keep only what the panel shows (a short JSON: the rows, the breakdown, the six biggest
  tools), not Claude Code's whole answer. Put the trimming in `server/contextparts.ts` as a
  pure function so it can be tested without Claude.
- A side run (alternates) and the builder's run leave the meter alone, as today
  ([chat.ts:953](../server/chat.ts:953)).
- No new dependency. Grayscale, Inter, quiet; reuse `.popover`, `.mp-use-bar` and the classes
  in `assistant.css` before adding new ones. Plain words in every label and comment; comments
  say why.
- FRIDAY messages on the copy: three short ones at most.
- Commit nothing. Don't restart the real app.

## Done when

1. `tests/contextparts.test.ts`: from a sample of Claude Code's answer, the rows come out
   named by `id`, biggest first, with deferred rows gone and "Room left" last; the six biggest
   tools are the right six; an answer with no `messageBreakdown` still gives the rows.
2. On port 4727, open an old conversation: the ring and percent show by the box (also under
   50%), and the panel shows the total with "Send a message to see what fills it."
3. Send one short message there. When the answer ends, the ring moves, and the panel's rows
   (without "Room left" and "Kept free…") add up to the total within 2%.
4. Reload the page: the same rows are there (they were kept on the chat).
5. At FRIDAY panel widths 340, 408 and 560 the ring, the model chip and Send fit on their row
   and the placeholder isn't squeezed to two-word lines.
6. "Summarize now" in the panel summarizes, and the ring drops after it.
7. `bun run typecheck`, `bun test tests`.

## The report

Write `docs/context-meter-report.md`:

1. In two sentences: what the designer sees now.
2. Each "Done when" line: **yes**, **no** or **not checked**, and how you checked. Two
   pictures in `.copy/` as `meter-*.jpg`: the box with the ring, and the panel open.
3. `summary` or `full`, and how long the call takes.
4. What a real conversation's rows looked like (copy the panel's numbers).
5. What differs from this plan, and why.
6. Files changed, one line each. The last lines of the type check and the tests.
7. FRIDAY messages sent, and how many.
