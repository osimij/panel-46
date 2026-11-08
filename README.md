# Panel

A private, local-first library for the design references you save, with X posts as the main source. See [my-design-library-idea.md](my-design-library-idea.md) for the full brief.

## Run it

```bash
bun install
bun run start        # builds the UI, then serves everything at http://127.0.0.1:4646
```

For development, run `bun run dev`. It starts the companion with reload on change, plus Vite at http://localhost:5173.

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
```

- **companion** (`server/`, Bun): owns the library, listens only on 127.0.0.1, and serves media straight from disk with Range support. Replaying a video never contacts X.
- **UI** (`web/`, React + Vite): gallery, search, detail view. It is served by the companion, so the app is one URL.

### Saving

- **X post link**: reads the post through X's public embed endpoint and downloads the original-resolution images (`name=orig`) and the highest-bitrate MP4. If that fails, it tries `yt-dlp`.
- **Any other link**: a direct image or video URL is saved as a file. A page from a video site `yt-dlp` knows (Vimeo, TikTok…) gets its video. Any other page is a **site**: Chrome, running headless with a throwaway profile, takes full-page screenshots at desktop (1440px, 2×) and phone (390px, 3×) size, at retina sharpness, and Panel keeps the site's name and icon. Sites have their own section in the sidebar. Without Chrome installed, a page is kept as a link with its preview image.
- **Files**: drag in, paste, or use the `+` button.

Paste a link anywhere on the page (⌘V) to save it. Pasting the same post again opens the copy you already have.

### Honest status

A reference only counts as **Archived** when every file was fully downloaded (size checked), hashed (sha256), and decoded by `ffprobe`. A thumbnail or an embed doesn't count.

| Status | Meaning |
|---|---|
| Archived | All media is on this Mac and verified |
| Link only | No media was found. The link (and maybe a preview image) is kept |
| Copy failed | One or more files didn't save, or a saved file has since gone missing from disk. **Try again** re-downloads only what's missing |

Removing a reference moves its files to the macOS Trash.

### Design reads (AI)

Each reference can be read once by Claude into a **design profile**: what it is, mood, color (hex values measured from the pixels, not guessed), typography, layout, imagery, motion, and the 1–3 ideas worth taking. The profile shows in the detail panel and feeds search, so "olive", "editorial" or "kinetic type" find references whose titles never said so.

- **Through your Claude plan** by default: each read runs Claude Code headless (`claude -p`, Opus 5.5 at xhigh effort here), so it uses the subscription, not API money. It needs a long-lived token from `claude setup-token`, kept in the Keychain as "Panel Claude Code token". The API (below) is the other option, in Library settings.
- **What the model sees** is prepared first, at about 1.2 megapixels per picture: up to 4 images; for a video or GIF, frame grids across the whole video (9 frames per 20 seconds, up to 54), close-ups of the busiest moments at 0.1s apart, and a count of hard cuts; for a site, the first screen, the whole page folded into columns, the second screen and the phone version. The prepared pictures are kept in `media/<refId>/read/`.
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
| `search_library` | Words, optionally inside facets (color, typography, layout, imagery, motion, mood, components), plus filters |
| `find_by_color` | Measured palettes near given hex colors (CIEDE2000), optionally by role (background, accent…) |
| `similar_to` | Saves like one save, by the facets you choose |
| `gather_for_brief` | The best saves per facet for a brief, so color, type and motion can come from different saves |
| `get_reference` | Everything about a save, its files on this Mac, and the pictures the read was made from |
| `save_to_collection` | Puts chosen saves in a Panel collection (only adds) |

Two ways to connect. Over stdio, which works even when Panel isn't running:

```bash
claude mcp add --scope user panel -- ~/.bun/bin/bun /Users/osimij/Desktop/Panel46/server/mcp.ts
```

For Claude Desktop or Cursor, the same command goes in their MCP config (`"command": "/Users/osimij/.bun/bin/bun", "args": ["/Users/osimij/Desktop/Panel46/server/mcp.ts"]`). Or over HTTP while Panel runs: `http://127.0.0.1:4646/mcp` (only this Mac's own addresses are accepted).

### Ask: the assistant

Press **⌘J** (or the small gray orb in the dock) to open Ask beside the library. It answers questions about your saves and pulls references for a brief: "a journaling app for slow mornings, warm and paper-like: color, type and motion". Saves it mentions show up as names with thumbnails, a row of pictures, or color chips you can click to copy. Click one to open it; point at one to see it larger and to light up its card in the grid.

- **Through your Claude plan**, like the reads: each message runs Claude Code (`claude -p`, Opus 5.5) with Panel's own MCP tools and nothing else, so it can search, match colors, look at the pictures and save to a collection, but can't touch files. The conversation continues with Claude Code's session, so follow-ups ("put those in a collection") just work.
- **It knows what you have open.** With a save open, "this" means that save (the composer says so; × leaves it out).
- **Type a question in search** and press ⇥ (or ↵ when it ends with "?") to ask it instead.
- **What it's doing** shows as a quiet timeline: searches with their results, saves it looked at, thinking time. It folds into one line once the answer starts. **Stop** ends it at once.
- **Every conversation is kept** (SQLite, `chats` and `chat_messages`), named in a few words by Haiku, and listed under the clock button. Reload mid-answer and it picks up where it was.
- **How hard it thinks** (Quick, Thorough, Deep) is in the same menu. Thorough is the default.
- **Show N in the library** puts every save from an answer in the grid together.
- Drag the panel's left edge to resize it; double-click to reset. In a narrow window it covers the library.
- Panel stays grayscale: color appears only while Ask works, as a soft glow rising behind the composer (a WebGL shader) and a thin iridescent rim. Both are off with reduced motion.

## Not built yet

A Brief view that pulls references by facet and suggests combinations, Apple Foundation Models with a strict offline mode, the Dock app wrapper, backup to the external SSD, export, and cloud sync.
