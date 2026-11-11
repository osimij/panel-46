# Report: adding skills from GitHub or a folder, as packs (skills, part 2)

Done 11 Nov 2026, from [skill-packs-plan.md](skill-packs-plan.md). Everything was tried on the copy (`.copy/lib`, my server `panel-copy-search` on port 4757). The real library and the real app on 4646 were not touched. Nothing was committed. Claude was called zero times.

## 1. What changed

### New files

- **`server/skillpacks.ts`**: everything about packs.
  - Three new tables (section 7).
  - What is kept: Markdown and plain text (`.md`, `.markdown`, `.mdx`, `.txt`, and `LICENSE`, `NOTICE`, `COPYING`, `AUTHORS`, `README` with no extension), up to 300 KB a file and 40 files a skill (its SKILL.md first). Everything else is only named, with its size and why: script, settings file, picture, other file, over 300 KB, past the 40-file limit. `leftOutLine()` says it in words: "1 script and 1 settings file not kept".
  - `findSkills()`: a skill is any folder holding a `SKILL.md` (any letter case). Its files are everything under that folder that isn't in a deeper skill's folder.
  - GitHub: `parseGithubLink()` takes `github.com/owner/name` and `…/tree/<branch>/<folder>`, with or without `https://` or `www.`, with or without `.git`. A branch name with slashes is found by trying the shortest first. `lookAtGithub()` reads the project at one commit and answers what could be added, saving nothing. Failures are in plain words: not a GitHub link; "That project isn't public, or doesn't exist."; "No skills found in owner/name: no folder in it holds a SKILL.md."; "GitHub asks Panel to wait: it allows 60 lookups an hour without signing in. Try again after 15:42."
  - A folder: `lookAtFolder()` does the same for what the browser sends. The server checks it again: no `..`, no `node_modules` or `.git`, sizes measured from the text itself, at most 5,000 files and 40 MB of text.
  - `addFromGithub()` / `addFromFolder()` add the ticked skills at the exact version looked at. A skill the library already has from that pack is brought up to the new version: its files are replaced and what the designer set stays. One that is the same is left alone. Nothing is ever doubled, and every new skill arrives off.
  - `checkPack()`: asks GitHub for the branch's newest commit. If it is the same, it says so. If not, it answers the chooser's look with what changed, what is new and what is gone. Panel never checks or updates by itself.
  - Reading: `listPacks()` (Skills page), `skillOrigin()` (detail view), `skillFileText()`, `skillFilesOf()` (get_skill), `packLicense()`.
- **`web/src/Packs.tsx`**:
  - reading a dropped or chosen folder in the browser (text files with their text, the rest by name and size; `node_modules`, `.git` and `.DS_Store` skipped);
  - the chooser (`PackChooser`, mounted once in `App.tsx`);
  - the pack headings on the Skills page (`SkillGroups`);
  - `SkillOriginPanel` and `CheckNewer` for a skill's detail view.
- **`tests/preload.ts`**, **`bunfig.toml`**, **`tests/library.test.ts`**: the test fix (section 2).
- **`tests/skillpacks.test.ts`**: 16 tests (section 6).

### Changed files

- **`server/index.ts`**: one import and one block of routes, all under `/api/skills…`, so the existing `fromPanel(req)` guard covers them:
  - `GET /api/skills/packs`: the packs, with their skills' ids.
  - `POST /api/skills/packs/look`: `{url}` or `{folder}`. Saves nothing.
  - `POST /api/skills/packs/add`: `{owner, repo, branch, path, sha, folders}` or `{folder, folders}`.
  - `POST /api/skills/packs/:id/check`.
  - `GET /api/skills/packs/:id/license`: the licence file as text.
  - `GET /api/skills/:id/origin` and `GET /api/skills/:id/file?path=`.
- **`server/capture.ts`**: two small changes.
  - `retry()` does nothing for a pack's skill. "Get latest version" and the retry route can never fetch a pack skill's link as if it were one Markdown file.
  - The frontmatter reader handles folded YAML. See "Done differently" 5.
- **`server/skills.ts`**: `readSkillFor()` takes an optional `file` and a way to list and read a skill's other files (it still never opens the library). Same frontmatter fix.
- **`server/skilluse.ts`**: `getSkill(name, file)` passes the files from `skillpacks.ts`.
- **`server/mcp-tools.ts`**: `get_skill` gains `file` (one line of schema). The description is unchanged.
- **`web/src/api.ts`**: the pack types, `packApi`, a small `packStore` shared by the page and the detail view, `isGithubProject()`, and the same frontmatter fix in `skillParts()`.
- **`web/src/App.tsx`**:
  - On Skills, a GitHub project link (Enter in the box, or ⌘V anywhere) opens the chooser, not a save. Anywhere else, and for a link to one `.md` file, links do what they did. A link without `https://` counts as a link on Skills only.
  - A folder dropped on Skills opens the chooser. Single `.md` files dropped with it are still added as today.
  - On Skills, the + button opens a small menu: ".md skill files…" or "A folder of skills…".
  - The grid on Skills is grouped by pack (`SkillGroups`). ← → in the detail view follow that order.
  - The new box hint, page subtitle and empty-page text.
- **`web/src/Detail.tsx`**:
  - `SkillOriginPanel` under "Use in FRIDAY". Clicking a file shows it in place of SKILL.md, rendered the same way, and Copy and Download act on the file shown.
  - For a pack's skill, "Get latest version" becomes "Check for a newer version". For a GitHub pack, the bottom "Re-check" also does that.
  - A skill is read again after its pack is updated.
- **`web/src/styles.css`**: `.pack-…` and `.skill-origin`/`.skill-files`, reusing `.sheet`, `.check-row`/`.checkbox`, `.pill`, `.btn-wide`, `.text-btn`. One rule fixes the header (see below).

I stayed out of `Canvas.tsx`, `canvas.css`, `Review.tsx`, `projects.ts` and `board.ts`.

### Done differently from the plan, and why

1. **Every folder drop makes a pack, even a folder with one skill.** The pack is how Panel knows the folder again, so dropping it a second time marks what changed. It also keeps the folder's licence. On the page, a one-skill pack gets a heading like any other ("make-interfaces-feel-better · from a folder · MIT License · Nov 11, 2026 · 1 skill · Drop the folder again to update").
2. **A folder is known again by its name.** The browser never gives Panel the folder's full path. Two different folders with the same name would count as one pack.
3. **"Add all" adds every skill that is new or changed.** The plan says skills already in the library are marked and not ticked. A skill that is in the library but *changed* (a re-drop, or a re-pasted link with a newer version) can be ticked and is marked "Changed". Nothing is ticked at first, so the two buttons do different things: pick some, or take all.
4. **The bottom "Re-check" in the detail view never downloaded anything.** It only re-read the save from Panel. "Get latest version" (in ⓘ) is the one that re-downloads a link. I did both:
   - "Get latest version" becomes "Check for a newer version" for a pack's skill;
   - "Re-check" asks GitHub for a newer version on a GitHub pack's skill;
   - `retry()` on the server ignores pack skills.
5. **Fixed a reading bug that the real files showed.** Jakub's folder writes its description as a folded YAML block (`description: >-` and then the text on the next lines). All three frontmatter readers (server, capture, card) left a stray "- " at the start of the line. It is fixed in all three. A test covers it.
6. **The header could run past the edge.** Part 1's "N used by FRIDAY…" line was not allowed to shrink. With my longer subtitle, the Skills header was 70px too wide, and the page scrolled sideways. That line now shrinks with an ellipsis, and the subtitle is shorter.
7. **Checking for a newer version costs one question to GitHub when nothing changed.** The first version re-read the whole project and took about 5 seconds. Now it asks only for the branch's newest commit. A newer version costs 4.

## 2. The test fix

- **What it was.** `bun test tests` runs all files in one process. `tests/findin.test.ts` loads `server/db.ts` with no library folder set, so every run opened `~/DesignLibrary` and ran `db.ts`'s start-up steps on it.
- **The fix.** `bunfig.toml` preloads `tests/preload.ts` before any test file. It always sets `PANEL_LIBRARY_DIR` to a fresh temporary folder, even when the shell already names one, and removes that folder at the end. Test companions still get their own folders, as before.
- **The guard.** `tests/library.test.ts` fails if the library in use is `~/DesignLibrary`, or is not inside the temporary folder.
- **How I confirmed it.** Panel finds the real library through the home folder (`~/DesignLibrary`), so I ran the tests with `HOME` set to an empty stand-in folder:
  - **Before the fix:** `HOME=<stand-in> bun test tests/findin.test.ts` created `<stand-in>/DesignLibrary/library.sqlite`. That is what a normal run does to the real library.
  - **After the fix:** a full `HOME=<stand-in> bun test tests` created no `DesignLibrary` there at all (only `Library/`, which is caches). Six tests failed in that run: the sketch-check tests, because headless Chrome can't start without the real home. The same run with the real home passes 126 of 126.

## 3. The real try

| | emilkowalski/skills | jakubkrehel/skills | Folder `make-interfaces-feel-better` |
|---|---|---|---|
| How | pasted `https://github.com/emilkowalski/skills` | pasted `github.com/jakubkrehel/skills` (no https) | the real folder, through the page's own drop handler |
| Version | `715c180`, 9 Nov 2026 | `8b254eb`, 10 Nov 2026 | files from 11 Nov 2026 |
| Licence | MIT License (licence file kept, 1,070 chars) | MIT License (kept) | MIT License (read from its LICENSE) |
| Skills found / added | 18 / 18 (Add all) | 15 / 15 (Add all) | 1 / 1 |
| Files kept | 27 (18 SKILL.md + 9 others) | 61 (15 SKILL.md + 46 others) | 6 (SKILL.md + animations, icons, performance, surfaces, typography) |
| Files left out | none | 35: 15 settings files (an `agents/openai.yaml` in every skill), 19 scripts and 1 HTML file (all in `teardown`: `assets/*.js`, `assets/viewer.html`, `scripts/*.cjs`) | 1 settings file (`agents/openai.yaml`) |
| Total kept | 340 KB | 353 KB | 42 KB |

- **Dropping the folder.** The browser pane can't open the Mac's file picker or drag from Finder. So, as part 1 did for one file, I gave the page's own drop handler the real folder. A small read-only server on 127.0.0.1 lent the folder's 12 files to the page, which made real `File`s with their real dates, plus folder entries, and dropped them on Panel. From there, everything is Panel's own path.
- **What happened to the folder's files.** The folder's top level (README, AGENTS.md, CLAUDE.md, `.gitattributes`) belongs to no skill, so it was not kept, except LICENSE as the pack's licence.
- **Screenshots, in `.copy/`:**
  - `packs-chooser-emil.jpg`: the chooser, two skills ticked, "Add the ticked ones 2".
  - `packs-chooser-jakub.jpg`: each skill with "1 settings file not kept".
  - `packs-chooser-folder.jpg`: the dropped folder.
  - `packs-chooser-light-in-library.jpg`: light mode, Emil's pasted again, every skill marked "In your library" and not tickable.
  - `packs-skills-page.jpg`: the Skills page, Typography on its own at the top, then the packs under their headings.
  - `packs-detail-files.jpg`: better-typography's detail view, with `choosing-fonts.md` open.
  - `packs-up-to-date.jpg`: "Check for a newer version" answering "Up to date", in the heading and in a toast.
- **MCP on the copy (no FRIDAY).** I turned on better-typography ("When asked"), then called `get_skill`. The answers are in `.copy/packs-get-skill.txt`.
  - With its name: 12,701 characters, ending with its 6 other files and how to read one.
  - With `file: "choosing-fonts.md"`: that file (2,216 characters).
  - With `file: "agents/openai.yaml"`: an error that lists its files.
  - Then I turned it off again.
- **Left as I found it.** Typography (part 1's skill, on and Always in the copy before I started) is still on. All 34 skills I added are off.

What looked wrong, and what I did:
- **Fixed:**
  - the stray "- " before folded descriptions (above);
  - the header running past the edge (above);
  - a pack's cards in reverse order (write-swift first): they now follow the folders' order, in the grid and with ← →;
  - "They're off" said of one skill;
  - a slow "up to date" check.
- **Not fixed (not mine):** in a rendered Markdown table in a narrow column, a word breaks mid-word ("Catego ry" in `choosing-fonts.md`). That is the existing `.markdown` table style.
- **Worth knowing:** clicking the dimmed area around the chooser closes it, as the Settings sheet does. My first click in the test did that by mistake.

## 4. The internet

Panel calls only these addresses, only with GET, with two headers (`accept: application/vnd.github+json` and `user-agent: Panel`), no sign-in, no cookies and no body. Nothing about the designer is sent.

| When | Address | Counted in GitHub's 60 an hour? |
|---|---|---|
| A GitHub project link is pasted on Skills (Enter, or ⌘V) | `api.github.com/repos/{owner}/{name}`, `…/commits/{branch}`, `…/git/trees/{commit}?recursive=1` | yes, 3 (a branch with slashes in a `/tree/` link can take one more try per slash) |
| The same look | `raw.githubusercontent.com/{owner}/{name}/{commit}/{path}` for each SKILL.md and the licence file | no |
| Add / Add the ticked ones | `raw.githubusercontent.com/…/{commit}/{path}` for each file kept | no. Also 0 API calls, because the look is remembered by its commit. Only if Panel was restarted between looking and adding: 3 more. |
| Check for a newer version (or Re-check on a GitHub pack's skill) | `api.github.com/repos/{owner}/{name}/commits/{branch}` | yes, 1 when up to date; 4 when there is a newer version, plus raw files for its SKILL.md files |

Nothing is called on its own: not at start, not on a timer, not for a folder pack. In tests both addresses are replaced (`PANEL_GITHUB_API`, `PANEL_GITHUB_RAW`) by a stand-in server, so tests never touch the internet. The only projects contacted in this work were the two approved ones.

## 5. With nothing on

- **The test.** In `tests/skillpacks.test.ts`, FRIDAY's instructions for all three readers (one model, planner, builder) are written by `chat.ts` on an empty library. They are written again after four GitHub skills were added, all off. They are identical, and carry no `designer-skills`.
- **On the copy, old code against new.** I made a scratch copy of `server/` with my changes taken back out (no `skillpacks.ts`; `skilluse.ts`, `skills.ts` and `get_skill` as before). I ran it and the new code on one snapshot of the copy, with the 34 pack skills present and off, and Typography on as before:
  - `systemPrompt` for all three readers: **identical** (44,166 bytes each). The `<designer-skills>` block has Typography only.
  - `get_sketch` on two existing sketches (GorillaCRM hero, Evening ledger), pictures left out: **identical**, byte for byte.
- **Why nothing else can change.** A pack's skill has no Check section, and nothing in `sketches.ts` or `skillcheck.ts` was touched.

## 6. Checks

- `bun run typecheck`: clean.
- `bun test tests`: **126 pass, 0 fail** (17 files). Part 1 ended at 109. The canvas session added tests too.
  - `tests/library.test.ts`: 1 test (the guard).
  - `tests/skillpacks.test.ts`: 16 tests:
    - finding: several depths, a SKILL.md in another letter case, a folder link, a link without `https://`;
    - failures: not GitHub, no skills, not public, a missing branch, the hourly limit with its time;
    - kept and left out, the 300 KB and 40-file limits;
    - adding some and all, adding again (nothing doubled, no extra API calls), every skill off;
    - the licence;
    - the instructions identical with packs added and nothing on;
    - re-check on a pack skill stays saved and unchanged;
    - `get_skill` with a name, with `./recipes.md` and with a wrong file;
    - up to date in one API call;
    - a newer version with changed, new and gone skills, settings kept, gone ones kept and marked;
    - a folded YAML description;
    - a folder with one skill, and a folder of folders dropped twice (the changed one marked, `node_modules` and `../` ignored);
    - all routes refused from another origin.
- **The measuring script.** Comparing it with the earlier "before" file wasn't fair any more: the copy itself had gained 34 skills, and skills are found by library searches. So I ran the old code and the new code on one snapshot. Every search line and every `ORDER` line is identical; only `TOOLS` changed: **before 28 tools · 31,223 chars, after 28 tools · 31,322 chars** (+99, under 31,700). Files: `.copy/packs-measure-before.txt`, `.copy/packs-measure-after.txt`.

## 7. The database

New tables, only added (nothing renamed, dropped or rewritten):
- **`skill_packs`**: one row per pack:
  - where it came from (`source`, and `pack_key`: `github:owner/name` or `folder:<name>`);
  - `name`, `url`, `owner`, `repo`, `path`, `branch`, `author`;
  - the version (`commit_sha`, `commit_date`);
  - `license_name` and `license_text`;
  - `added_at`, `checked_at`.
- **`skill_pack_skills`**: a skill's pack and its folder in it, the version of its files, a short hash of what its folder held (to tell what changed), and `gone`. Deleted with the save.
- **`skill_files`**: a skill's other files by path. Kept ones have their text. Left-out ones have only size and `why`. Deleted with the save.

A skill's SKILL.md stays in `refs.text` (kind `skill`). Its `source_id` is `pack:<pack>/<folder>`, which is how the rest of Panel tells a pack's skill.

**In the real library (checked read-only): none of the three exist yet.** It has `skill_use` from part 1. Every `panel` MCP process running now started before `skillpacks.ts` existed (the newest at 08:27). The tables will appear the next time a Claude Code session starts Panel's MCP on this code (`mcp.ts` → `mcp-tools.ts` → `skilluse.ts` → `skillpacks.ts`), or when the real app is restarted. The old code never reads them. In the copy they exist, with the three packs.

## 8. Doubts, and what the next step should know

- **These skills are long, and their size is the main problem.**
  - Emil's SKILL.md files run from 4,760 to 42,214 characters (median 13,181; all 18 together about 66,000 tokens). Five are each over the 16,000-character budget on their own: write-swift 42k, emil-design-eng 27k, apple-design 23k, animate-expo 18k, mobile-native 17k. Turned on as Always, they would drop to "read with get_skill" at once.
  - Jakub's run from 6,085 to 12,508 (median 8,779; about 34,000 tokens together), and with their other files about 88,000 tokens.
  - None has Decide, Build or Check headings, so part 1 gives each one whole. The "shorten them" step is what makes any of these usable as Always.
- **They refer to each other, a lot.**
  - Jakub's are a web: better-interface sends to better-accessibility, better-colors, better-layout, better-typography, better-ui and better-writing. Several mention `variant`, `break` and `interface-review` as next steps.
  - Emil's lean on `animate`, `gestures` and `review-animations`.
  - All 15 of Jakub's SKILL.md files name their own other `.md` files ("see choosing-fonts.md"), and 8 of Emil's 18 do. `get_skill` with `file` covers that. A skill that tells the model to "use the X skill" will only work if X is on too.
- **They talk to a coding agent, not to a designer's sketch tool.** They speak of "the project's styling system", Tailwind, Swift, React Native, `Approve` and findings, and some run a review loop. Many are for building real apps (write-swift, animate-expo, ask-sonner, pick-ui-library). The next step should say, per skill, whether it applies to a Panel sketch at all, and where it disagrees with `unugly.md`.
- **What they bring besides text.**
  - Every one of Jakub's skills has an `agents/openai.yaml`: settings for another tool, left out.
  - `teardown` brings a whole viewer: 19 scripts and an HTML file, all left out. It may not make sense without them.
  - Emil's have no scripts at all.
- **Skills show up in library searches.** Skills are saves, and `search_library` finds them by their words. With 34 long skill files in the copy, "bold" found 94 saves instead of 79, and "newest" is now mostly skills. It isn't new (single skill files did this before), but packs make it much bigger. It may be worth leaving skills out of `search_library` unless asked for (`types: ["skill"]`). I didn't change it, since the plan says nothing else about how skills reach FRIDAY changes here.
- **Names could clash.** None of these 34 share a name, but two packs could (`variant`, `review`). `get_skill` by name takes the first match. The next step might show the pack beside the name where two match.
- **The 60-an-hour limit is real but far.** One look costs 3, an up-to-date check 1. A designer pasting a dozen projects in an hour could hit it. The message then says when to try again.

## 9. Note for the designer

- **To add skills from GitHub:** open Skills and paste the project's link (like `github.com/emilkowalski/skills`) in the box at the bottom, then press Enter. A list of the skills in it opens. Tick the ones you want and press **Add the ticked ones**, or press **Add all**.
- **To add a folder of skills from your Mac:** drop it on the Skills page, or press + and choose **A folder of skills…**. The same list opens.
- **They arrive off.** Open one and turn on **Use in FRIDAY** when you want FRIDAY to use it. Under that switch you can see where it came from, its other files, and what Panel left out (scripts and settings are never kept).
- **To get a newer version:** press **Check for a newer version** beside a pack's name. If there is one, the same list shows what changed and you pick what to update. What you set for each skill stays. A folder has nothing to check: drop it again.
- **The real Panel** keeps working the old way until it is restarted. Nothing was committed.
