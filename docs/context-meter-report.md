# Context meter: report

Carried out from [context-meter-plan.md](context-meter-plan.md) on 11 Nov 2026, tested on the
copy at port 4727 (`panel-copy-meter`, library `.copy/lib`, UI `.copy/dist-meter`). Nothing
committed; the real app was not touched or restarted.

## 1. What the designer sees now

By the message box, left of the model chip, there is a small ring with the percent (`◔ 11%`) as
soon as the conversation has an answer. It turns darker from 85%. Pressing it opens a panel above
the box. The panel shows the total and a bar, then what fills the conversation, biggest first:
FRIDAY's instructions, Panel's tools, and the conversation itself, split into what FRIDAY read
(with the six tools that take the most room), its answers and your messages. "Room left" is last,
and "Summarize now" is at the bottom. The model chip has no percent any more.

## 2. Done when

1. **Yes.** `tests/contextparts.test.ts`, 6 tests, all pass. The sample is a real Claude Code
   answer from a copy conversation, with one hidden ("deferred") row and one unknown row added.
   The tests check: rows named by `id`, biggest first, deferred and empty rows gone, "Room left"
   last, an unknown row keeps Claude Code's name; the six biggest tools; an answer with no
   `messageBreakdown` still gives the rows.
2. **Yes.** I opened "Sign-up page for notes" on the copy (project "skillfix 3"). Its answers were
   all made before this change. The ring showed `24%` (under 50%), and the panel showed
   "50K of 207K · 24%", the bar, and "Send a message to see what fills it."
3. **Yes.** I sent one short message. When the answer ended, the ring went from 24% to 11%. That
   is because the old limit kept on the chat, 207K, became 467K. The top rows add up to the total
   exactly: 21,809 + 17,059 + 10,005 + 1,373 + 580 = 50,826, which is the total.
4. **Yes.** After reloading the page, the panel showed the same 16 rows. I read them from the page.
5. **Yes.** I set the FRIDAY panel to 340, 408 and 560 wide and measured the row. At every width
   the ring, the chip, attach, mic and Send are on one line (the same top), and nothing spills
   over. At 340 the gap between the chip and attach is 17px. The message box is 292 / 360 / 512px
   wide, so "Ask anything · @ to mention" stays on one line (the box's height stays 52px).
6. **Yes.** I pressed "Summarize now" in the panel (`/compact`). The answer was "summarized
   50,873 → 2,101", the total went from 50,826 to 25,393, and the ring dropped from 11% to 5%.
7. **Yes.** `bun test tests`: 209 pass, 0 fail. `bun run typecheck`: no errors. For a few
   minutes it failed in `web/src/Studio.tsx`, the studio session's file, while that session was
   editing it. I waited as the plan says, and it passed on the retry. See section 6.

Pictures:
- `.copy/meter-box.jpg`: the box with the ring, at 340 wide.
- `.copy/meter-panel.jpg`: the panel open, after the message in 3.

## 3. `summary` or `full`, and how long it takes

**`summary`.** It already gives `categories` and `messageBreakdown`, the same breakdown as
`"full"`. I timed both ten times by connecting to a copy conversation without sending anything:

- `summary`: 986, 3, 2, 4, 3, 5, 5, 10, 2, 2 ms
- `full`: 528, 3, 2, 3, 4, 11, 2, 1, 2, 1 ms

The first call is slow only because Claude Code has just started. After a real answer the call
took **8 ms** (logged on the copy during check 3). The call stays where it was, after the
answer's `result`, so the answer does not feel slower.

## 4. A real conversation's rows

From check 3 ("Sign-up page for notes", after the message), as the panel shows them:

```
This conversation                                  51K of 467K · 11%
The conversation                                                 22K
   What FRIDAY read and looked at                                18K
      Sketches it looked at                                       9K
      Sketches it made                                            5K
      Sketches it changed                                         3K
      get skill                                                  525
      Ready-made parts                                           277
      Projects it read                                            95
   FRIDAY's answers                                               4K
   Your messages and files                                       225
Panel's tools                                                    17K
FRIDAY's instructions, your rules and skills                     10K
How Panel's tools are used                                        1K
Notes                                                            580
Kept free for summarizing                                        33K
Room left                                                       416K
```

After "Summarize now": Panel's tools 17K, FRIDAY's instructions… 5K, the conversation 2K, How
Panel's tools are used 1K, Notes 580, Kept free for summarizing 33K, Room left 442K.

## 5. What differs from the plan, and why

- **The conversation's own split is not Claude Code's numbers as they are.** Claude Code
  estimates the split on this Mac, and it counts a picture by the size of its file. In one copy
  conversation, the conversation really held 111K, but the estimate was 640K (588K of it tool
  results full of sketch pictures). Words are estimated well. So "FRIDAY's answers" and "Your
  messages" keep their estimates, "What FRIDAY read and looked at" gets the rest of the real
  total, and the tools share that rest in proportion to their estimates. The rows then add up to
  "The conversation". If the words alone are ever bigger than the whole, all three are shared out
  by the estimates. This is in `server/contextparts.ts` and its comment.
- **"Files you attached" became "Your messages and files".** Claude Code's "attachments" are its
  own notes to itself (a copy of its instructions, the date, and so on). Most of them aren't in
  the conversation at all: one was estimated at 27K while the whole conversation held 21K. Files
  the designer attaches go in with their message, so they are counted in the designer's messages
  and can't be split out. So that row is left out, and "Your messages" is named
  "Your messages and files".
- **"Kept free for summarizing" sits just above "Room left"**, not among the rows by size. The
  33K it holds is past the 100% mark, so it reads better next to the room left than between what
  fills the conversation.
- **Tools with no words in the chat** keep their own name ("get skill"), as the plan says. These
  are `get_skill`, `get_verdicts`, `get_fonts` and `get_brand_assets`. They read oddly next to
  the rest. Giving them words in `Assistant.tsx` would fix both places at once.
- **Right after a summary**, Claude Code doesn't split the conversation by tool, so "What FRIDAY
  read and looked at" (676) is the summary and the project card that comes back. It has no tool
  rows under it.
- **Parts that no longer match the total are hidden.** Until the real app is restarted, it runs
  the old code and updates only the total. Parts kept by the new code would then be out of date.
  So if the kept parts don't add up to the total (within 2%), the panel shows the total with
  "Send a message to see what fills it" instead of old rows.
- **The planner's line and the panel's place.** The panel learns the mode as soon as the box
  appears, so its height is right when it opens. Without that, the planner's line arrived after
  the panel was placed, and the panel grew down over the ring. I checked "Plan, then build" by
  making only the page believe it was on, not by changing the copy's settings, which other
  sessions share: the line shows, and the panel ends 35px above the ring.

## 6. Files changed

- `server/contextparts.ts` (new): trims Claude Code's answer to the meter's rows, the
  conversation's split and the six biggest tools. A pure function.
- `server/chat.ts` (context lines only): the new column `context_parts TEXT` on `chats`; the
  parts are kept after each answer and sent with the `context` event and on the chat; parts that
  no longer add up to the total are hidden.
- `web/src/api.ts`: the `ContextParts` type, `parts` on `ContextUse` and on the `context` event.
- `web/src/ContextMeter.tsx` (new): the ring, the panel, and "Summarize now".
- `web/src/ModelPicker.tsx`: lost its percent, the bar and "Summarize now"; it takes no props
  now.
- `web/src/Assistant.tsx`: the composer puts the meter left of the model chip; `use` keeps the
  parts.
- `web/src/assistant.css`: the meter's styles (`.context-meter`, `.cm-*`). Removed `.model-full`
  and `.mp-use`, which nothing uses any more.
- `tests/contextparts.test.ts` (new): 6 tests.
- `.claude/launch.json`: one line, `panel-copy-meter` on 4727.

The database only grows: one new column, empty for old chats. The old code doesn't read it.

Last lines of the checks:

```
$ bun test tests
 209 pass
 0 fail
 30175 expect() calls
Ran 209 tests across 23 files. [116.78s]
```

```
$ bun run typecheck
$ tsc --noEmit
(no errors)
```

For a few minutes it failed only in `web/src/Studio.tsx` (`pendingWords`, `partKeyRef`,
`resetKnobs` not found) while the studio session was editing that file. It passed on the retry.

## 7. FRIDAY messages

Two on the copy, both in "Sign-up page for notes":
1. "In one short sentence: which font does the sketch's headline use?"
2. "Summarize now" (`/compact`).

I also connected to three copy conversations without sending anything, to read and time Claude
Code's answer (section 3). That spends nothing, but Claude Code added a few bookkeeping lines to
those conversations' files in `~/.claude/projects/…-copy-lib-chat/`.
