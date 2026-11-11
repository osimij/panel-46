# Plan: in "Plan, then build", the builder keeps its own short conversation (step 2b)

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, `CLAUDE.md`, and `server/chat.ts` from top to bottom before touching anything. Do this **after** [shorten-sooner-plan.md](shorten-sooner-plan.md) has been carried out (both touch `server/chat.ts`; never at the same time). When you finish, write the report described at the end and stop.

## Why

FRIDAY's model picker has two modes: **One model**, and **Plan, then build** (`chat_mode = "duo"`): a planner (Fable by default) reads, searches and decides, then hands a plan to a builder (Opus by default) that makes the sketch.

Today the builder *continues the planner's conversation* (`duo()` resumes the same `session_id` with another model). Claude's cache is kept per model, so the builder has to take in the whole conversation at full price, and write it to its own cache, every time. In the designer's history that was 16 requests and 1.26 million tokens, 15% of everything FRIDAY ever wrote to the cache, about 80,000–125,000 tokens per hand-over. The same happens when a pointed edit, a rebuild from Figma or alternates run on the builder's model over the planner's conversation.

The builder doesn't need that conversation. The plan is already written to be "everything the builder needs".

## The idea

In Plan, then build, **each model keeps its own conversation**:

- The **planner's conversation** is the chat's main one, as today (`chats.session_id`): the designer's messages, the planner's reading and searching, its plans. It no longer carries the builder's work (sketch pages, pictures of sketches), only a short note of what was made.
- The **builder's conversation** is a second one beside it (`chats.builder_session_id`, new): each hand-over arrives as one message (the brief), followed by the builder's own work. Everything the builder's model does for this chat happens there, so its cache stays warm from one job to the next.

**One model** mode must behave exactly as it does now. Read your finished diff once more for that alone.

## Rules for this job

- Follow `CLAUDE.md`: never touch `~/DesignLibrary` or port 4646; never `bun run build` or `bun run start`; do not restart the real app; do not commit.
- Other sessions are editing this folder. Never `git stash`, `git checkout`, `git reset` or reformat a file. Change only what this plan needs.
- The database may only gain things. This plan adds two columns to `chats`, in place, the way `card_project` and `context_tokens` were added (empty for older conversations). Nothing is renamed, dropped or rewritten. Know that any Claude Code session that starts Panel's MCP with this code will add those two empty columns to the real library too; that is allowed and harmless to the real app, and the report must say it happened or will.
- No new dependency. Comments in plain words that say why.
- Another session's server may be on 4747: use `panel-copy-search` (port 4757) from `.claude/launch.json`, and restart it after changing `server/`.
- This step spends the designer's Claude plan in exactly one place: the **five FRIDAY messages** of the "Live check". Nothing else may call Claude.

## What to build (all in `server/chat.ts` unless said)

### 1. Two new columns on `chats`

`builder_session_id TEXT` (the builder's conversation, in Claude Code) and `builder_card_hash TEXT` (which version of the project card that conversation was given). Added in place beside the others, with a comment each.

### 2. The hand-over: `duo()`

After the planner calls `hand_to_builder`, the builder runs on the **builder's conversation**: it resumes `builder_session_id` when there is one, and starts a new one when there isn't. It never resumes the planner's.

The builder's run must:

- store its conversation's id in `builder_session_id`, and leave `session_id` alone;
- leave the context meter alone (`context_tokens`, `context_limit` and the `context` event are the main conversation's; today a builder run overwrites them);
- start a new builder conversation quietly when the stored one is gone (the same `lost()` handling `drive()` and `duo()` already have for the main one);
- no longer be given the planner's `friday` tool server: its own conversation has no call to `hand_to_builder` in it. Its tools and instructions must be the same on every builder run (hand-over, pointed edit, Figma rebuild), or its cache is thrown away each time: Panel's tools only, `systemPrompt()` as it is.

### 3. The brief the builder gets

One message, in this order:

1. who it is and how to work (today's `builderPrompt` wording, adjusted: it hasn't seen the planner's conversation; what it needs to read, it reads with the tools: `get_project`, `get_sketch`, `get_reference`);
2. the project card, in full, **only** when this builder conversation hasn't been given this version (compare with `builder_card_hash`; store the hash when the answer finishes well, the way `finish()` does for `run.card`). The card must never appear twice in one message: the designer's message below may already carry it;
3. the designer's message for this turn, with its `<panel-context>` (what is selected, pointed at, open) and any attached pictures and files, so nothing the planner saw from the designer is lost;
4. the plan.

Also say plainly in `plannerNote` that the builder doesn't see this conversation: only the plan, the designer's message and the project card. That makes the planner write plans that stand on their own.

### 4. The planner learns what was made

The planner's conversation no longer contains the builder's work, so the next message in the chat must tell it. In `send()`, when the previous answer in this chat had work done on the builder's conversation, add one short note to what goes into `<panel-context>`:

- what the builder said at the end (its few lines), and
- what it made or changed, from its tool steps: each sketch made (id, title), each sketch edited (id), saves placed (how many, under which topic), and anything that failed.
- End it with how to look: `get_project` lists it, `get_sketch` shows a sketch.

Build the note from the stored answer (`chat_messages.parts`), not from memory, so it survives a restart of Panel and is given exactly once (it is always about the answer just before). If that turns out badly tangled, the existing `sideNews` map (used by alternates) is the fallback; say so in the report.

Keep it short: a few hundred characters for an ordinary build. It must not carry the sketch's HTML or pictures.

### 5. The builder model's other jobs, in Plan, then build

Today, with Plan, then build on, three more kinds of message run on the builder's model over the **planner's** conversation. Once the builder stops living there, each would rewrite the whole conversation every time, which is worse than today. So in Plan, then build:

- **A pointed edit** (`pointed`) and **a rebuild from Figma** (`fig`): run on the builder's conversation (resume `builder_session_id`, or start it). Their message already carries its own context (`said`); add the project card by the same rule as in 3. The planner is told afterwards by the same note as in 4.
- **Alternates** (`fanOut`): the copies fork the builder's conversation when there is one, and start fresh (with the project card in their message) when there isn't. If this one turns out tangled, leave alternates exactly as they are and say so in the report; the first two are required.

In One model mode none of this applies: everything stays on `session_id`.

### 6. Things that stay as they are

- `/compact` typed by the designer summarizes the main conversation, as today. The builder's conversation is summarized by Claude Code on its own, at the same size.
- Switching mode mid-chat: One model continues the main conversation (which holds the notes of what the builder made). Going back to Plan, then build, the builder continues its own.
- What the designer sees in FRIDAY's panel: the same steps, each marked with its model; the hand-over step; the builder's words. Change nothing in `web/`.

## Tests (no Claude)

A turn can't run in tests, so put each decision in a small function that can, and test it in a new `tests/duo.test.ts`:

- **which conversation a run continues**, given the mode, the kind of message (hand-over, pointed, Figma, alternates, plain) and the stored ids: One model always the main one; in Plan, then build the planner the main one and the builder's jobs the builder's;
- **the brief**: has the plan, the designer's message and its context; has the card when the builder's conversation is new or the card changed, and not otherwise; never has the card twice;
- **the note for the planner**: from an answer's parts with a hand-over, a `make_sketch` and an `edit_sketch`, it names the sketches and carries the builder's words; from an answer with no builder work it is empty; it has no HTML;
- the two columns exist after start on a library that didn't have them (see how `tests/helpers.ts` starts one).

Then `bun run typecheck` and `bun test tests`. Both must pass. A failing test that isn't yours: check whether it fails without your change, and report it rather than fix it.

## Live check (five FRIDAY messages, no more)

On your copy server, with the copy's picker set to Plan, then build (`PATCH /api/chat/settings` with `{"mode":"duo"}` **on the copy's port only**; put it back afterwards). Use one project that exists in the copy and has a canvas; say which. Each run is a new conversation on that project's canvas (send `context: { project: "<id>" }` with each message, as the app does).

**Before any code change** (old code), a new conversation:

1. "Find three references for a bold landing page hero and say which one you would build from. Don't make anything yet."
2. "Sketch that hero. One screen, keep it simple."

**After the change** (new code, server restarted), a new conversation, the same two messages, then:

3. "Make the headline bigger and tighten the space under it."

For every message, from the copy (`sqlite3 -readonly .copy/lib/library.sqlite`): each new `ai_usage` row with `mode = 'chat'` (there are two for a hand-over: planner and builder) with model, cache read, cache write, output; and from the answer's `chat_messages.parts`, the tools each model called.

What must be true after the change:

- message 2: the builder's cache write is roughly its brief plus its own work, not the whole conversation. Before, expect it near the size of the conversation; after, far below. Give both numbers;
- message 3: the builder's cache **read** is clearly above zero (it continued its own conversation), and the planner knew what had been made without being told by the designer (it got the note): quote the note that was sent;
- `chats.session_id` and `chats.builder_session_id` are both set and different;
- in the browser on the copy, the answer to message 2 looks as it did before: planner's steps, the hand-over, the builder's steps, each with its model. Take a screenshot.

Then look at the two sketches side by side (before and after, message 2) and give your honest read: did the builder, working from the brief alone, follow the plan as faithfully? Save both pictures in `.copy/`. One run each is a sanity check of quality, not proof.

If the "before" hand-over doesn't happen (the planner answers without building), don't send extra messages to force it: report it and carry on with the "after" run.

## The report

Write `docs/builder-brief-report.md`:

1. **What changed**, file by file. Anything done differently from this plan, and why. Whether alternates were moved or left.
2. **One model mode**: how you made sure it behaves exactly as before.
3. **Live check**: a table of every message's rows (model, cache read, cache write, output), before and after; the builder's cache write on message 2, before against after; the note the planner was given; the two sketches and your read of them; the full text of the answers to message 2.
4. **Checks**: typecheck, tests, any failing test that isn't from this change.
5. **The database**: the two columns, and whether they now exist in the real library (check with `sqlite3 -readonly ~/DesignLibrary/library.sqlite "PRAGMA table_info(chats)"`; do not add them yourself).
6. **Doubts**: anything the builder seemed to miss without the conversation, anything fragile.
7. **Note for the designer**, three or four plain sentences: what is different in Plan, then build, that One model is untouched, that the real Panel keeps the old behaviour until restarted, that nothing was committed.

## Not in this step

Picture sizes, the Skills page, search answers, the size at which conversations are summarized, anything in `web/`, anything about One model mode.
