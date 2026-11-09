# Panel

A private, local-first library for the design references you save, with X posts as the main source. See [my-design-library-idea.md](my-design-library-idea.md) for the full brief.

## Run it

```bash
bun install
bun run start        # builds the UI, then serves everything at http://127.0.0.1:4646
```

For development, run `bun run dev`. It starts the companion with reload on change, plus Vite at http://localhost:5173.

To try a change without touching your real library, run `scripts/copy.sh`: it makes a copy of the library in `.copy/` (cloned, so it takes almost no disk) and tells you how to run it on port 4747, beside the real Panel. `bun test tests` checks the main things against a throwaway library. [CLAUDE.md](CLAUDE.md) has the rules for working on Panel's own code.

To keep Panel running in the background, so it starts at login and comes back if it stops, run `scripts/autostart.sh install`. After changing the code, `scripts/autostart.sh restart` rebuilds and restarts it. Logs go to `~/Library/Logs/Panel/server.log`, and `scripts/autostart.sh uninstall` turns it off.

| Env var | Default | |
|---|---|---|
| `PANEL_LIBRARY_DIR` | `~/DesignLibrary` | Where the database and media live |
| `PANEL_PORT` | `4646` | Companion port (loopback only) |

Requires `ffmpeg`/`ffprobe` (verification and thumbnails). `yt-dlp` is an optional fallback for posts and sites the direct path can't read.

## How it works

```
~/DesignLibrary/
  library.sqlite          references, notes, tags, collections, full-text index
  media/<refId>/0.jpg     the saved originals
  media/<refId>/0.thumb.jpg
  media/<refId>/0.loop.mp4   a small silent copy of a video, for the grid to play
  projects/               sketches and materials, per project
  backups/<date>/         a daily snapshot of the database and projects
  models/                 the two small models for search by meaning and by look
```

- **companion** (`server/`, Bun): owns the library, listens only on 127.0.0.1, and serves media straight from disk with Range support. Replaying a video never contacts X.
- **UI** (`web/`, React + Vite): gallery, search, detail view. It is served by the companion, so the app is one URL.

### Saving

- **X post link**: reads the post through X's public embed endpoint and downloads the original-resolution images (`name=orig`) and the highest-bitrate MP4. If that fails, it tries `yt-dlp`.
- **Any other link**: a direct image or video URL is saved as a file. A page from a video site `yt-dlp` knows (Vimeo, TikTok…) gets its video. Any other page is a **site**: Chrome, running headless with a throwaway profile, takes full-page screenshots at desktop (1440px, 2×) and phone (390px, 3×) size, at retina sharpness, and Panel keeps the site's name and icon. Sites have their own section in the sidebar. Without Chrome installed, a page is kept as a link with its preview image.
- **Files**: drag in, paste, or use the `+` button.

A saved site is also **measured in the page**: the fonts it really uses (and whether each has Cyrillic and Tajik letters), its text sizes, its colors as the CSS has them, and its corner radii. The detail view shows them under "Measured in the page", search finds a site by its font's name, and the design read is told the real fonts instead of guessing. Sites saved earlier are measured one at a time in the background.

Paste a link anywhere on the page (⌘V) to save it. Pasting the same post again opens the copy you already have.

The grid shows 200 saves and brings in more as you scroll; only the cards near the screen are kept on the page, so a library of thousands stays light. Videos in the grid play a small copy (640px, 30 seconds); the detail view plays the original.

### Honest status

A reference only counts as **Archived** when every file was fully downloaded (size checked), hashed (sha256), and decoded by `ffprobe`. A thumbnail or an embed doesn't count.

| Status | Meaning |
|---|---|
| Archived | All media is on this Mac and verified |
| Link only | No media was found. The link (and maybe a preview image) is kept |
| Copy failed | One or more files didn't save, or a saved file has since gone missing from disk. **Try again** re-downloads only what's missing |

Removing a reference moves its files to the macOS Trash.

### Backups

Once a day Panel keeps a snapshot of the database and the projects folder in `backups/<date>/` (the last 7 days, then one a week for two months). In Library settings you can name a second folder, on another disk: it gets the newest snapshot and every saved file, so the library survives this Mac's disk. To go back to a snapshot, stop Panel and copy its `library.sqlite` (and `projects/`) over the library's.

### Design reads (AI)

Each reference can be read once by Claude into a **design profile**: what it is, mood, color (hex values measured from the pixels, not guessed), typography, layout, imagery, motion, and the 1–3 ideas worth taking. The profile shows in the detail panel and feeds search, so "olive", "editorial" or "kinetic type" find references whose titles never said so.

- **Through your Claude plan** by default: each read runs Claude Code headless (`claude -p`, Opus 5.5 at xhigh effort here), so it uses the subscription, not API money. It needs a long-lived token from `claude setup-token`, kept in the Keychain as "Panel Claude Code token". The API (below) is the other option, in Library settings.
- **What the model sees** is prepared first, at about 1.2 megapixels per picture: up to 4 images; for a video or GIF, frame grids across the whole video (9 frames per 20 seconds, up to 54), close-ups of the busiest moments at 0.1s apart, and a count of hard cuts; for a site, the first screen, the whole page folded into columns, the second screen and the phone version. The prepared pictures are kept in `media/<refId>/read/`.
- **Tags come with the read.** The same read picks the save's tags the way you tag, following [server/tagging-guide.md](server/tagging-guide.md) (learned from the saves you tagged by hand), your current tags in that section, and your 24 most recent hand-tagged saves as examples. It uses your existing tags, adding at most one new one. A save you tagged yourself is never changed. Tags from a read are stored as `source = 'ai'` and are replaced if the save is read again. Once you edit a save's tags they're yours. Edit the guide to change how saves get tagged; the next read uses it without a restart.
- **Batches** by default: half price, usually back within the hour, 24 hours at most. **Read now** in the detail panel reads one right away at full price.
- **New saves are read by themselves** (grouped into a batch every ~20 minutes). The library you had before is read only when you ask: Library settings → *Read 10 to test*, then *Read the other N*.
- **Spending is measured**, from the token counts the API returns, and capped per month (default $20, changeable in Library settings). Nothing is sent past the cap.

The key lives in the macOS Keychain. Add it once (paste it when asked); Panel picks it up within a minute:

```bash
security add-generic-password -s "Panel Anthropic API key" -a panel -w
```

`PANEL_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY` also work.

### The library over MCP

Any AI app that speaks MCP (Claude Code, Claude Desktop, Cursor…) can search the library, look at saves and gather references for a brief. The tools:

| Tool | What it does |
| --- | --- |
| `library_overview` | Counts, tags, collections, and the words the reads use (moods, fonts, motion techniques…) |
| `search_library` | Words and meaning, optionally inside facets (color, typography, layout, imagery, motion, mood, components), plus filters. With `look`, by the pictures themselves ("a dark dashboard with glowing charts") |
| `find_by_color` | Measured palettes near given hex colors (CIEDE2000), optionally by role (background, accent…) |
| `similar_to` | Saves like one save, by the facets you choose; `look` compares the pictures themselves |
| `get_verdicts` | What you've chosen and ruled out across all projects, grouped by the reason you gave |
| `gather_for_brief` | The best saves per facet for a brief, so color, type and motion can come from different saves |
| `get_reference` | Everything about a save, its files on this Mac, and the pictures the read was made from |
| `list_projects` | Your projects, most recently worked on first |
| `get_project` | A project's canvas as decisions: your rules first (see below), then its brief and materials, then each topic, locked or exploring, with the saves chosen, kept, suggested and ruled out, and your notes on why. Optionally with pictures of the chosen saves |
| `get_design_rules` | Your standing rules for every design, from [unugly.md](unugly.md) |
| `get_project_material` | One of a project's materials in full: a file's text (PDF, Word, text), a picture to look at, or a linked page's text |
| `place_on_board` | Puts saves under a topic on a project's canvas as suggestions, each with a short why; makes the topic if needed |
| `add_topic`, `connect_topics`, `add_note` | Grow the canvas: a new decision (optionally after another), Typography → Color, a note on a topic or save |
| `mark_saves`, `lock_topic` | Choose, keep or rule out saves; lock a decision with a sentence. Only when you say so |
| `make_sketch`, `edit_sketch`, `get_sketch` | Put a quick page on a project's canvas to try a direction, change it (each change a new version), read it back. Each returns pictures of the page as Chrome rendered it, plus any errors the page threw, so Claude sees it before you do |
| `get_handoff`, `start_build`, `get_build`, `message_build`, `see_build` | Build a chosen sketch for real: the hand-off written down, Claude Code started in your project folder (its own branch), its progress, follow-up changes, and pictures of the running result for Claude Code to check |
| `save_to_collection` | Puts chosen saves in a Panel collection (only adds) |

**Search by meaning and by look.** Two small models run on this Mac (multilingual-e5-small for what the reads say, CLIP for the pictures; about 300 MB, fetched once into `models/`). Nothing about the library leaves the machine. With them, "quiet and bookish" finds a save described as "calm, literary", in English or Russian, and a save can be found by how it looks. Library settings turns it off; search then goes by words alone.

Two ways to connect. Over stdio, which works even when Panel isn't running:

```bash
claude mcp add --scope user panel -- ~/.bun/bin/bun /Users/osimij/Desktop/Panel46/server/mcp.ts
```

For Claude Desktop or Cursor, the same command goes in their MCP config (`"command": "/Users/osimij/.bun/bin/bun", "args": ["/Users/osimij/Desktop/Panel46/server/mcp.ts"]`). Or over HTTP while Panel runs: `http://127.0.0.1:4646/mcp` (only this Mac's own addresses are accepted).

### FRIDAY: the assistant

Press **⌘B** to tuck the sidebar away to a thin strip on the left; point at the strip to bring it out over the page, click it (or ⌘B again) to keep it open.

Press **⌘J** (or the small gray orb in the dock) to open FRIDAY beside the library. It answers questions about your saves and pulls references for a brief: "a journaling app for slow mornings, warm and paper-like: color, type and motion". Saves it mentions show up as names with thumbnails, a row of pictures, or color chips you can click to copy. Click one to open it; point at one to see it larger and to light up its card in the grid.

Type **@** in FRIDAY to mention a save: a list of your saves appears (the newest, or what matches the words after the @); pick one with the arrow keys and Enter, or click. Claude gets that exact save, and it shows as a chip in your message. To answer one part of a reply, select it and click **Reply**: it goes above your message as a quote, and Claude reads your message as an answer to it.

- **Through your Claude plan**, like the reads: each message runs Claude Code (`claude -p`, Opus 5.5) with Panel's own MCP tools and nothing else, so it can search, match colors, look at the pictures and save to a collection, but can't touch files. The conversation continues with Claude Code's session, so follow-ups ("put those in a collection") just work.
- **It follows your rules.** [unugly.md](unugly.md) holds what every design must do and the signs of generic design to avoid. FRIDAY has it in its instructions on every message, takes from a save only what passes it, says when a save breaks a rule, and puts the rules in full into any prompt it writes for Claude Code to build from. Any other AI app over MCP gets them at the top of `get_project` and from `get_design_rules`. Edit the file and the next message uses it, without a restart.
- **It knows what you have open.** With a save open, "this" means that save (the composer says so; × leaves it out).
- **Type a question in search** and press ⇥ (or ↵ when it ends with "?") to ask it instead.
- **What it's doing** shows as a quiet timeline: searches with their results, saves it looked at, thinking time. It folds into one line once the answer starts. **Stop** ends it at once.
- **Every conversation is kept** (SQLite, `chats` and `chat_messages`), named in a few words by Haiku, and listed under the clock button. Reload mid-answer and it picks up where it was.
- **Which model, and how hard it thinks.** The chip beside Send picks it, the way Claude Code does: **One model** (Fable 5.2, Opus 5.5, Sonnet 5.5 or Haiku 5.5) at an effort from Low to Max, or **Plan, then build**: Fable 5.2 (at high effort) reads the project, looks at your saves and decides, then writes a plan, and Opus 5.5 (at high effort) carries it out in the same conversation. Both are adjustable. The plan shows in the answer as a step you can open, and each run of steps says which model did it. A plain question is answered by the planner alone. A change to one part you pointed at in the studio always goes straight to the builder (or the one model) at low effort: it's a small job, and it comes back in seconds.
- **A sketch shows while it's being written.** Under "Sketching…" the page takes shape as FRIDAY writes it, before it lands on the canvas.
- **Show N in the library** puts every save from an answer in the grid together.
- Drag the panel's left edge to resize it; double-click to reset. In a narrow window it covers the library.
- Panel stays grayscale: color appears only while FRIDAY works, as a soft glow rising behind the composer (a WebGL shader) and a thin iridescent rim. Both are off with reduced motion.

### Projects: a canvas per piece of work

Under **Projects** in the sidebar, each project is a canvas for working out a design: a brief, then **topics** for the decisions (Typography, Color, Layout…), the **saves** you're considering for each, and **notes** on why.

- **Topics** are *exploring* until you **Lock** one. A locked topic turns solid and takes a sentence for the decision ("humanist serif for headings, grotesk for forms").
- **Saves** come from **Saves** in the dock: drag one onto the canvas, or select a topic and click saves to file them under it. Select a save to **Choose** it, **Rule it out**, add a **Note** or open it.
- **Verdicts by key.** With saves or sketches selected: **K** keeps, **C** chooses, **X** rules out. After a choice or a rule-out a strip asks why: press **1–5** for one of the reasons you use most, type your own, or ignore it. Judging a suggestion moves on to the next one waiting, so a row of them goes fast. FRIDAY reads the reasons (`get_verdicts`), leans on them, and when one keeps coming back offers a line for unugly.md.
- **Connect** anything by dragging from the dot on a node's edge, e.g. Typography → Color, to say one leads to the next. Double-click empty space for a note. Backspace removes what's selected.
- **The assistant works on the canvas.** With a project open, ask FRIDAY for references ("suggest palettes that suit what's locked") and it places them under the right topic, one after another, as **Suggested** cards with a line on why. The view glides to them. **Keep**, **Choose** or **Rule out** each one. It never chooses or locks on its own; "lock it with the second one" does.
- **Sketches: try a direction before anyone builds it.** Ask FRIDAY to "sketch the hero" or "try the type in Tajik" and it makes a **sketch**: one small web page, built from the locked decisions, placed next to what it came from as a **Suggested** card showing its first screen. Before it answers, Claude looks at pictures of the page (rendered by the Chrome on this Mac, up to three screens down) and fixes what breaks your rules. Double-click a sketch (or **Open**) to use it live and full size; **New tab** opens it on its own. Changes make new versions (v2, v3…), kept on disk in `projects/<id>/sketches/`; ⌘Z or **Undo** goes back one. Keep, choose or rule out sketches like saves. A sketch runs in a sandbox: its scripts work, but it can't reach your library.
- **Sketch from a save.** Select a save, a decision or several saves and press **Sketch** / **Sketch from these**: FRIDAY makes a sketch that takes from each, with dashed lines from the saves it used.
- **The studio.** Open a sketch to click through it as a real page: phone, tablet or desktop; step through versions; jump between its screens and states (a flow like Login → Code → Error, or empty / loading / error), which FRIDAY declares with `<meta name="panel:states" content="login: Вход, code: Код">`. Press **Point** (or P), click any part, and say what should change: FRIDAY changes just that part, or **Try 3 alternates** branches three new sketches. The **Directions** rail shows the family of branches; **Choose** / **Rule out** take a reason that FRIDAY and the build read.
- **Your rules are checked by measuring.** Each time a sketch (or a build) is rendered, Panel measures the page against unugly.md: corners without smoothing, a letter-spaced name in the navbar, a font with no Cyrillic or Tajik letters (asked of Chrome, letter by letter), and the signs of generic design (italics, eyebrows, tags, solid dividers, bordered boxes…). FRIDAY gets the findings with the pictures and fixes what breaks a rule before answering; the studio shows them next to the page ("2 against your rules"). A check runs only while unugly.md still mentions its rule.
- **Edit words yourself.** While pointing, double-click a heading, a button or a paragraph (or click it, then **Edit text**) and type over it, right in the page. ↵ keeps it as a new version, Esc puts it back. No AI is involved; FRIDAY builds on your words from then on. Words a sketch's script writes are changed in the script when they're plain; otherwise Panel says so and you can ask FRIDAY.
- **Knobs.** In the studio, **Knobs** lists the sketch's own variables (colors, fonts, sizes, radius, spacing) as swatches and sliders. Moving one changes the live page at once, with no AI. **Try a palette from a save** puts a save's measured colors on the page, keeping what was background, text and accent. **Keep as v3** writes your values into a new version; FRIDAY builds on them. FRIDAY gives every new sketch knobs; for an old one, "Ask FRIDAY to add them".
- **Alternates, made at the same time.** "Try 3 alternates" starts three copies of FRIDAY at once, each with its own angle (the composition, the voice, the boldest idea), so three directions take about as long as one. They show taking shape together in FRIDAY's panel.
- **Compare.** In the studio, **Compare** puts two or three directions side by side on the same screen size, scrolled together and switched between their states together. Choose or rule out from there, or say what to take from which ("the hero from A, the type from B") and FRIDAY makes the combination.
- **Build with Claude Code.** From the studio, hand a chosen sketch to Claude Code with your project folder. Panel writes a hand-off (brief, rules, locked decisions with their saves' pictures, the sketch and its screens, what you ruled out and why) and runs Claude Code in a separate checkout on a branch of its own (`panel/<sketch>`), so your files stay as they are; a new folder starts a new project. A card under the sketch shows its plan as it works; Claude Code can call `see_build` to have Panel start the page and show it pictures, so it checks its own work. When it's done, Panel runs it and the card shows it: **Open**, ask Claude Code for changes (same session), or **Continue in terminal** (`claude --resume`). Builds live in `builds/`. The research behind this is in `docs/harness-research.md`. FRIDAY talks to Claude Code through the Agent SDK (`@anthropic-ai/claude-agent-sdk`, on your own `claude` and login), with only Panel's tools and each tool call checked by Panel; it falls back to the `claude -p` command line if the SDK can't start (set `chat_engine` to `cli` to always use it). Builds run the same way, with Claude Code's own system prompt and your repo's CLAUDE.md and settings; Panel checks each command a build wants to run (package managers, node tools, listing files and git without push are allowed; chained commands are refused), and `build_engine` set to `cli` uses the command line instead. Ask FRIDAY to "tell Claude Code to…" and it passes the request to the build's session (`message_build`).
- **Locking folds away what wasn't chosen** into "+5 considered" on the topic; click it to see them again.
- **Undo**: ⌘Z undoes your own changes, one at a time. After the assistant changes the canvas, a note above the dock says what it did, with **Undo**, which takes back its whole reply (a topic, the saves under it, a note) at once. Claude Code's changes show up and undo the same way.
- **About the project.** On the canvas the project is just its name in the corner. Click it for About: the name, what the project is, and its **materials**: drop in files (specs, brand books, screenshots) or paste links. Claude reads them (PDF and Word text, pictures, the linked page) to understand the project. Deleting the project is there too.
- **Ask about what's selected.** Click a card, topic or note (or select several) and FRIDAY talks about it: "On the canvas: 3 saves" shows above the message box, and "this" or "these" means them. The **Ask FRIDAY** button in the card's toolbar opens FRIDAY right there.
- **Claude reads it as decisions**, not as boxes: `get_project` returns each topic in the order you connected them, what was chosen and ruled out, and your notes. When FRIDAY is open on a canvas it knows which project you mean.
- **Live**: every change is a small logged step (`project_events`), so a change made anywhere, including from Claude Code over MCP (its own process), shows up on an open canvas within half a second.
- The canvas code (React Flow) loads only when a project is opened, so the library stays as light as before.

## Not built yet

A Brief view that pulls references by facet and suggests combinations, Apple Foundation Models with a strict offline mode, the Dock app wrapper, export, cloud sync, and search by meaning in the library's own search box (today it's for FRIDAY and other AI apps).
