# Connect Panel (design library MCP) to this AI app

You are an AI agent. Your job: connect the **Panel** MCP server to the app you are running in, then check that it works. Do it yourself; only ask the user for a step you can't do (like restarting their app).

## What Panel is

Panel is the user's private design-reference library on this Mac (websites, app screens, posters, motion pieces). Each save has an AI design read: colors measured from the pixels, typography, layout, imagery, motion, mood. The MCP server lets you search it, look at the saves, and gather references for a design brief.

Tools: `library_overview`, `search_library`, `find_by_color`, `similar_to`, `gather_for_brief`, `get_reference`, `save_to_collection` (only adds; never deletes).

## Two ways to connect (pick what your app supports)

**A. stdio (preferred, works even if Panel isn't running)**
- command: `/Users/osimij/.bun/bin/bun`
- args: `["/Users/osimij/Desktop/Panel46/server/mcp.ts"]`
- server name: `panel`

**B. HTTP (Streamable HTTP, while Panel runs; it starts at login)**
- url: `http://127.0.0.1:4646/mcp`
- no auth. Use `127.0.0.1` or `localhost`; other hostnames are rejected.

Use absolute paths. GUI apps don't read the shell's PATH.

## Per app

### Claude Code (CLI, the desktop app's Code tab, IDE extensions)
They all share one config. Run:
```bash
claude mcp add --scope user panel -- /Users/osimij/.bun/bin/bun /Users/osimij/Desktop/Panel46/server/mcp.ts
```
Check with `claude mcp list` (it should show `panel` as connected). New sessions pick it up.

### Claude Desktop app (Chat tab)
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`. Create it if it's missing, and keep any servers already there:
```json
{
  "mcpServers": {
    "panel": {
      "command": "/Users/osimij/.bun/bin/bun",
      "args": ["/Users/osimij/Desktop/Panel46/server/mcp.ts"]
    }
  }
}
```
Then ask the user to quit Claude fully (⌘Q) and reopen it.

### Codex (CLI and IDE)
```bash
codex mcp add panel -- /Users/osimij/.bun/bin/bun /Users/osimij/Desktop/Panel46/server/mcp.ts
```
If that command doesn't exist, add this to `~/.codex/config.toml`:
```toml
[mcp_servers.panel]
command = "/Users/osimij/.bun/bin/bun"
args = ["/Users/osimij/Desktop/Panel46/server/mcp.ts"]
```

### Cursor
Add to `~/.cursor/mcp.json` (merge with what's there):
```json
{ "mcpServers": { "panel": { "url": "http://127.0.0.1:4646/mcp" } } }
```

### Anything else (Windsurf, Zed, VS Code, Gemini CLI…)
Find where your app keeps its MCP servers and add option A, or B if the app only takes URLs. Follow the app's own config format.

### Won't work
claude.ai in the browser, ChatGPT web and other cloud-only apps can't reach this Mac's `127.0.0.1`. Tell the user so.

## Check it works
1. Call `library_overview`. It should say about 125 saves, all read.
2. Call `search_library` with `{"query": "calm editorial", "limit": 3}`. You should get results with `open` links.

If it fails:
- `curl -s http://127.0.0.1:4646/api/health` should return `{"ok":true,...}`. If it doesn't, run `/Users/osimij/Desktop/Panel46/scripts/autostart.sh restart`.
- Check that `/Users/osimij/.bun/bin/bun` exists. If it doesn't, use the output of `which bun`.
- stdio test: `/Users/osimij/.bun/bin/bun /Users/osimij/Desktop/Panel46/server/mcp.ts` should print `Panel MCP: ready` to stderr and wait. Stop it with Ctrl-C.

## Using it well (once connected)
- Start with `library_overview` to learn the library's words.
- For a brief, use `gather_for_brief` and give each facet its own words in `facet_briefs`, e.g. `{"typography": "mono, tight tracking", "motion": "stagger, spring"}`.
- Matching is by words, not meaning, so try synonyms.
- Look before you recommend: `get_reference` with `images: "all"`.
- Always give the user each save's `open` link.
