# Plan: three fixes to ready-made parts (icons by name, colours only when asked, fonts in a copy)

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, `CLAUDE.md`, `unugly.md`, and the ready-made plan and report ([ready-made-plan.md](ready-made-plan.md), [ready-made-report.md](ready-made-report.md)) with the code they describe (`server/ready.ts`, the `get_ready_made` tool in `server/mcp-tools.ts`, the ready-made bullet in `SYSTEM` in `server/chat.ts`) before touching anything. Also read how a sketch is saved and read back: `writeVersion` in `server/sketches.ts`, and `makeSketch`, `editSketch` and `getSketch` in `server/board.ts`. When you finish, write the report described at the end and stop.

## Why

Ready-made parts work: FRIDAY now takes its icons and loading animations from Panel. Trying it showed three things to fix.

1. **FRIDAY retypes the drawings.** It gets an icon's SVG from the tool and types it into the page. In the two test sketches, 6 of 20 icons came back with a number changed (`13.32` became `13.320`). They draw the same today, but a retyped drawing can't be trusted, and each one costs FRIDAY a few hundred characters to write.
2. **FRIDAY uses or imitates a palette without being asked.** The designer's decision: Panel's palettes are good to have, but FRIDAY must never pick one by itself. When a project has no colours, it asks first: a palette, or colours of its own.
3. **A test copy has no fonts.** `scripts/copy.sh` doesn't copy the designer's fonts or the projects' brand files, so on a copy FRIDAY reports a missing font and a sketch can't show a logo.

## Where things stand

Everything up to this plan is committed (`b71d6f3`) and **the real Panel on 4646 now runs it**. The designer is using it. A change reaches the real Panel only at a restart, and only the designer asks for one.

## Rules for this job

- Follow `CLAUDE.md`: never touch `~/DesignLibrary` (reading it is fine) or port 4646; never `bun run build` or `bun run start`; **do not restart the real app; do not commit or push.** Never `git stash`, `git checkout` or `git reset`.
- **Use the ready-made copy**: `.copy/lib-ready`, UI in `.copy/dist-ready`, the `panel-copy-ready` server on port **4787**. Build the UI with `bunx vite build --outDir "$PWD/.copy/dist-ready" --emptyOutDir` from this folder. **Never run `scripts/copy.sh`** (you will change it, not run it): it deletes `.copy/lib` and rebuilds `.copy/dist`, which another session may be using.
- **Another session may be working on skills in this folder at the same time** ([skill-fixes-plan.md](skill-fixes-plan.md)). Stay out of `server/skills.ts`, `server/skilluse.ts`, `server/skillread.ts`, `server/skillreads.ts`, `server/skillleads.ts`, `server/skillpacks.ts`, `server/skillcheck.ts`, `web/src/SkillRead.tsx`, `web/src/Packs.tsx`, `web/src/Detail.tsx`, `web/src/Grid.tsx` and the skills tests. In files you share (`server/mcp-tools.ts`, `server/chat.ts`, `server/sketches.ts`, `server/board.ts`), change only what this plan needs, read the file again right before each edit, and never rewrite or reformat it. If the type check or a test fails in a file you didn't touch, wait a few minutes and try again; if it still fails, say so in the report and don't fix it.
- The database doesn't change. No new dependency. Plain words everywhere.
- This step spends the designer's Claude plan only on the **four FRIDAY messages** under "Live check".

## What to build

### 1. FRIDAY names a part, and Panel puts the drawing in

**In the page FRIDAY writes**, a part is one short tag:

- `<panel-icon name="trash"></panel-icon>`, with an optional `weight` (regular when not given).
- `<panel-loading name="ring"></panel-loading>`.

Both may be written self-closing. `class`, `style`, `id`, `title` and `aria-label` on the tag are carried over to the drawing. An icon with an `aria-label` is announced as a picture with that name; without one it stays hidden from screen readers, as now.

**When Panel saves a version** (`writeVersion`, so every way of saving goes through it), it fills each tag in:

- an icon becomes Panel's own SVG for it, exactly as `iconSvg()` gives it;
- a loading tag becomes that animation's markup, and its `<style>` is put in the page once, however many times the animation is used;
- each filled part is marked so Panel can recognise it later (for example `data-panel-icon="trash"` and its weight; `data-panel-loading="ring"`).

So the saved file is still one whole, self-contained page with the real drawings in it. The studio, the knobs, Figma and a real build all get that whole page, as today.

- **A wrong name saves nothing.** The tool answers in plain words with the closest names ("There is no icon called “close”. Closest: x, x-circle, x-square."), so FRIDAY fixes it and tries again.
- **Tags are filled in the page's HTML only**, never inside a `<script>`, a `<style>` or a comment: a drawing dropped into a script's text could break it. An icon a script needs goes in the HTML (in a `<template>`, or hidden) and the script copies it.
- The size limit is checked after filling.

**When Panel hands a page back to an AI** (`get_sketch`'s HTML, and anything else that gives FRIDAY or another AI app a sketch's code), every part Panel filled is shown as its short tag again. A part is turned back only when it is still exactly what Panel put in; one the designer or anyone changed stays as it is. So FRIDAY never sees a drawing's numbers and has nothing to retype.

**`edit_sketch`** works on that same short form: Panel turns the saved page to its short form, applies the edits, and fills it in again on saving. An edit that adds an icon writes the tag.

Put the filling and the turning back in a new file of its own (pure, no library, tested on its own), with small hooks where it is used. Turning back and filling again must give the same page, byte for byte.

**What FRIDAY is told** (the ready-made bullet in `SYSTEM` in `server/chat.ts`, the bullet in `INSTRUCTIONS` and the `html` description of `make_sketch` in `server/mcp-tools.ts`, the `get_ready_made` descriptions):

- Find the icons a page needs in one call (`find_icons`), then write each as a `<panel-icon>` tag. Never paste or type a drawing. A loading state is a `<panel-loading>` tag with a name from the list.
- `get_ready_made` keeps `icons` and `loading` for an AI app that builds for real and needs the drawing itself; its descriptions say so, and say that in a sketch the tag is the way.
- The rest stays: one weight a page, fill only to mark what is active, brand icons first, never an emoji as an icon.

Two small things from the report, while you are here:

- `find_icons` misses a few everyday words because the package files them under other words ("close" finds x fifth; "menu" misses list). Add a short list of Panel's own extra words for the most common icons (close, menu, settings, search, delete, edit, add, back, more, home, user, download, upload, share, copy, link, info, warning, success, error), and say in the report what each now finds.
- FRIDAY's step line shows the tool as "get ready made". Give it a plain label the way other tools have one in `web/src/Assistant.tsx`.

### 2. Palettes only when the designer says so

Change what FRIDAY and other AI apps are told (`SYSTEM` in `server/chat.ts`, `INSTRUCTIONS` and the `palette` description in `server/mcp-tools.ts`):

- **Never use, or imitate, one of Panel's palettes unasked.**
- **Colours are settled** when the project has a locked colour decision, or brand assets that carry its colours, or the designer has said in this conversation what colours to use ("pick calm colours" means FRIDAY's own; "use Slate" means that palette). Then FRIDAY doesn't ask and doesn't open the palettes unless one was named.
- **When colours aren't settled, FRIDAY asks before it sketches**, in one short question, and stops: its own colours, or one of Panel's palettes. It may name two or three palettes that would suit, by name only. If FRIDAY already has a way to offer answers as buttons, use it; otherwise a plain question.
- **The answer holds for the rest of the conversation.** FRIDAY doesn't ask again.
- **When the designer picks a palette**, FRIDAY uses its values exactly as they are: a 12-step scale by what each step is for, a small set as its colours. It adds a colour of its own only for something the palette doesn't have, and says which.
- With two models answering ("Plan, then build"), the planner is the one that asks.

### 3. A copy gets the fonts and the brand files

In `scripts/copy.sh`, copy `fonts` and `brand` the same way `media`, `projects` and `models` are copied (cloned where the disk can). Update the comments that say what a copy holds, in the script and wherever `CLAUDE.md` or `README.md` describe it. Don't run the script.

For the copy you work on, add the two folders by hand the same way (from the real library, which you only read), so the live check has the designer's fonts.

## Tests (no Claude, no internet)

A new test file for the filling, and additions to `tests/ready.test.ts`:

- an icon tag is filled with exactly `iconSvg()`'s drawing; `weight`; both ways of writing the tag; attributes carried over; `aria-label`;
- a loading tag is filled; used three times, its style is in the page once;
- a wrong icon name or loading name: nothing is saved, and the answer names the closest;
- tags inside a script, a style and a comment are left alone;
- turning back and filling again gives the same bytes; a changed drawing isn't turned back;
- `get_sketch` gives the short form; the file on disk has the drawings; a real build's hand-off gets the whole page;
- `edit_sketch`: an edit adds an icon by tag; the icons already there are byte for byte unchanged after it;
- the size limit counts the filled page;
- `find_icons` with each of the extra words.

Then `bun run typecheck`, `bun test tests`, and `PANEL_PORT=4798 PANEL_LIBRARY_DIR=.copy/lib-ready bun scripts/measure-search.ts` (every search line and `ORDER` line as before; say what `TOOLS` is before and after).

## Live check, on the ready-made copy (port 4787)

Four FRIDAY messages, One model, on the copy's "Notes" project (it has no colours):

1. New conversation: "Sketch a file upload screen: a drop area, a list of three files, one of them still uploading. One screen." FRIDAY should ask about colours and make nothing yet.
2. Answer in the same conversation: "Use one of Panel's palettes, you choose." Now it sketches.
3. Same conversation: "Add a search field with an icon above the list."
4. New conversation: "Sketch a small settings page for a notes app: a few switches, a text field, a save button. No brand yet, pick calm colours. One screen." FRIDAY should not ask, and should not open the palettes.

For each, from the saved conversation and the saved pages:

- did FRIDAY ask or not, as expected;
- what it sent to `make_sketch` and `edit_sketch`: how many `<panel-icon>` and `<panel-loading>` tags, and whether it typed any drawing itself;
- every icon and loading piece in the saved page compared with Panel's own, byte for byte;
- in message 3, whether the icons already on the page are unchanged;
- in message 2, every colour in the page against the palette's values;
- whether the designer's fonts now load on the copy.

Save everything in `.copy/` with names starting `readyfix-`.

## The report

Write `docs/ready-fixes-report.md`:

1. **What changed**, file by file; anything done differently from this plan and why.
2. **Icons and loading by name**: how it works, where the hooks are, what the four messages showed (tags written, drawings typed, bytes compared).
3. **Colours**: the exact words FRIDAY is now given, and what it did in each of the four messages.
4. **The copy script**: what changed, and what you added to the copy by hand.
5. **Checks**: typecheck, tests, the measuring script, `TOOLS` before and after, and how many characters a sketch with 13 icons now costs FRIDAY to write against before.
6. **Shared files**: each one you touched and what you added; any failure you saw that wasn't yours.
7. **Doubts**, and what the next step should know.
8. **Note for the designer**, a few plain sentences.
