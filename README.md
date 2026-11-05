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
- **Any other link**: a direct image or video URL is saved as a file. For a page, it tries `yt-dlp`, otherwise keeps the title, description and a cached preview.
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

## Not built yet

AI tagging and search (Sonnet 5.5 / Haiku 5.5 / Apple Foundation Models with a strict offline mode), the Dock app wrapper, a capture extension or bookmarks import, backup to the external SSD, export, and cloud sync.
