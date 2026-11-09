# What Panel does now (decided and built 2026-11-09, tested on a copy)

**Short version:** FRIDAY doesn't need its own harness. It rents Claude Code's, the same way T3 Code and Onlook do, and Panel adds what a designer needs around it.

1. **FRIDAY = Claude Code through the Agent SDK** (`@anthropic-ai/claude-agent-sdk` `query()`, pinned, on your own `claude` login).
   - It has only Panel's tools, and Panel checks every call.
   - It can be stopped mid-answer.
   - It falls back to `claude -p` if the SDK fails.
2. **The sketch loop:** FRIDAY makes a page, Panel renders it in Chrome (any device or state), and FRIDAY looks and fixes it before you see it.
   - You click through it in the studio, point at a part, and FRIDAY changes just that part.
3. **Builds = a real Claude Code session in your code.** It runs:
   - in a git worktree on its own branch;
   - with Claude Code's own system prompt plus a hand-off (brief, rules, decisions, sketch, what was ruled out);
   - with your repo's CLAUDE.md and settings;
   - with Panel checking every command it runs;
   - with `see_build`, so it can look at what it built.
4. **The two are connected.**
   - The build's progress (its plan and steps) streams to a card on the canvas.
   - When the build is done, Panel runs the result and shows it.
   - You, or FRIDAY with `message_build`, can ask the same Claude Code session for changes, or open that session in a terminal with `claude --resume`.

**Not done yet, in order of value:**
- **Approvals on the canvas.** Claude Code would ask you before risky steps, instead of Panel refusing them.
- **Plan first for builds.** Claude Code would show its plan and wait for your okay before writing code.
- **One live session per chat.** FRIDAY would answer faster.
- **Other agents through ACP.** Codex or Kimi could run builds too.

---

# Agent harness research for Panel

Research date: 2026-11-09. Sources are linked inline. **(unverified)** marks claims I could not confirm from an official doc or the product's source code. "Secondary" means a blog, review or forum post, not the vendor.

---

## TL;DR (plain language)

1. Panel already uses the right engine. Claude Code is one of the strongest agent harnesses, and Anthropic now publishes it as a library (the **Claude Agent SDK**) for apps like Panel.
2. Switch FRIDAY from "start `claude -p` again for every message" to **one long-running Claude Code session per chat, driven through the Agent SDK**. It answers faster, can be stopped mid-answer, and Panel can approve or block each action.
3. Your Claude plan still works. The SDK starts the normal `claude` program on your Mac, which uses the login you already have. Anthropic's rules allow that. They forbid apps that collect or reuse your login themselves (details and caveats in §2.6).
4. For sketches, let FRIDAY use Claude Code's own file tools (Read, Edit, Write) inside **one folder per sketch**, instead of Panel's custom find/replace tools. Those tools are what Claude is trained on, so edits will be more reliable.
5. Panel should still own versions, screenshots and the canvas. After each change, Panel saves a version, renders it and shows it. FRIDAY keeps a "look" tool so it can see what it made.
6. For "point at this and change it", do what Onlook, v0 and Lovable do. Panel tags every element. On click it sends the model the element's code, its place in the file, and a cropped screenshot. Simple tweaks like text or colour are made directly by Panel, with no AI call.
7. For variants, copy the sketch folder once per variant and run a separate, forked session on each copy. The variants then don't interfere with each other.
8. To build the chosen direction for real, Panel starts a **second Claude Code session in the designer's actual project**, on a separate copy of the code (a git worktree) so the main code is safe. It gets a "handoff bundle": the sketch, screenshots, rules and references.
9. Panel streams that session's progress into a card on the canvas. When it finishes, Panel starts the project's dev server, screenshots the real result, and puts it next to the sketch.
10. You don't need ACP or a multi-agent layer yet. T3 Code, the best open-source GUI here, talks to Claude Code through the same SDK and to Codex through Codex's own protocol. Add ACP only if you later want Kimi, Gemini and others behind one interface.

---

## 1. How the leading harnesses work

### 1.1 Claude Code and the Claude Agent SDK (Anthropic)

- **What it is.** "The Agent SDK gives you the same tools, agent loop, and context management that power Claude Code", as a TS/Python library that **runs the Claude Code binary** ([overview](https://code.claude.com/docs/en/agent-sdk/overview)). Both SDKs bundle a native binary, and `pathToClaudeCodeExecutable` points it at a separately installed `claude` ([quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart.md)). Packages: `@anthropic-ai/claude-agent-sdk` (TS) and `claude-agent-sdk` (Python).
- **Loop.** Prompt, then an assistant message (text and/or tool calls), then tools run and their results return as a user message. This repeats until a reply has no tool calls, then a `result` message arrives carrying cost, usage and `session_id`. Read-only tools run in parallel. Edit, Write and Bash run one at a time ([agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)).
- **Tools.** `Read, Edit, Write, Glob, Grep, Bash, WebSearch, WebFetch, ToolSearch, Agent (subagents), Skill, AskUserQuestion, TaskCreate/TaskUpdate`, plus MCP tools. MCP tool schemas are deferred and loaded on demand through tool search ([agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)).
- **Context management.** Auto-compaction summarises older history and emits a `system/compact_boundary` message. You can steer it with a `PreCompact` hook, with summary instructions in CLAUDE.md, or by sending `/compact`. CLAUDE.md is re-injected on every request, so durable rules belong there and not in the first prompt.
- **Subagents.** The `Agent` tool runs a subagent in its own context and returns only its final answer. Define them with the `agents` option (`AgentDefinition` takes its own `tools`, `effort` and `permissionMode`). In stream output, subagent messages carry `parent_tool_use_id`. `forwardSubagentText` streams their text too ([headless](https://code.claude.com/docs/en/headless.md)).
- **Permissions.** Calls are evaluated in this order: hooks, deny rules, ask rules, permission mode, allow rules, then the `canUseTool` callback ([permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md)). The modes:
  - `default`: anything needing approval goes to `canUseTool`, or is denied if there is no callback.
  - `acceptEdits`: file edits and `mkdir/touch/rm/mv/cp/sed` are auto-approved **inside the working directories only**.
  - `plan`: edits go to the callback.
  - `dontAsk`: anything that would prompt is denied.
  - `auto`: a classifier decides.
  - `bypassPermissions`: needs `allowDangerouslySkipPermissions`.

  Path rules use `Edit(//abs/path/**)` for absolute paths and `Edit(/rel/**)` for paths inside the working directory. Since v2.1.302, `claude -p` and SDK runs start in `default` (Manual) mode unless you set a mode.
- **Checkpoints and undo.** `enableFileCheckpointing: true` plus `extraArgs: {"replay-user-messages": null}` gives each user message a `uuid`, and `q.rewindFiles(uuid)` restores files to that point. Only Write, Edit and NotebookEdit changes in the main thread are tracked. Bash edits and subagent edits are not, and rewind does not roll back the conversation ([file checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing.md)).
- **Sessions.** Sessions are stored at `~/.claude/projects/<encoded-cwd>/<id>.jsonl`. The options are `resume`, `continue`, `forkSession` (with `resume`), `resumeSessionAt` (a message uuid), `sessionId` and `persistSession: false`. There are also `listSessions()`, `getSessionMessages()`, `renameSession()` and `tagSession()`. A fork branches **only the conversation, not the files** ([sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md)). The experimental V2 `createSession()` API was **removed** in TS SDK 0.3.142, so use `query()`.
- **How UIs drive it.** You can use the SDK, raw `claude -p` with stream-json, or ACP (§1.6). Anthropic's own desktop app and IDE extensions are out of scope here.

### 1.2 OpenAI Codex (CLI, app-server, `codex exec`, Codex SDK)

- **App Server** is "a client-friendly, bidirectional JSON-RPC API", run as a long-lived process that hosts Codex core threads. It powers the VS Code extension, the Codex app and remote TUI ([OpenAI eng blog, Feb 4 2026](https://openai.com/index/unlocking-the-codex-harness); [app-server docs](https://learn.chatgpt.com/docs/app-server)).
  - **Transport:** JSON-RPC 2.0 over stdio (NDJSON), with an experimental websocket option.
  - **Primitives:** Thread, then Turn, then Item. Items include messages, command runs, file changes and tool calls.
  - **Methods:** `initialize`, `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/steer` (adds input to a running turn), `turn/interrupt`, `review/start`.
  - **Notifications:** `turn/started|completed`, `item/started|completed`, `item/agentMessage/delta`.
  - **Approvals:** these are server-to-client requests: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`, answered with `accept | acceptForSession | decline | cancel`, plus `item/permissions/requestApproval`.
  - **Sandbox:** `sandboxPolicy` is `readOnly | workspaceWrite | externalSandbox` (OS-enforced).
  - **Auth:** `account/login/start` with `apiKey`, `chatgpt` (browser) or `chatgptDeviceCode`. The docs say app-server auth "has never been permitted for commercial or hosted services".
- **Codex SDK** (`@openai/codex-sdk`) wraps the CLI and exchanges JSONL over stdio. It offers `new Codex().startThread()`, `thread.run()`, `thread.runStreamed()` (yields `item.completed` and `turn.completed`) and `resumeThread()`. Threads persist in `~/.codex/sessions`, and Codex requires a git repo unless you pass `skipGitRepoCheck` ([npm via socket.dev](https://socket.dev/npm/package/@openai/codex-sdk)). OpenAI points automation and CI at the SDK and rich UIs at app-server.

### 1.3 Cursor

Most of this comes from secondary sources; only the SDK facts come from Cursor's own pages.

- **Cursor 3 ("Glass")** replaced the Composer pane with an **Agents Window** ([dev.to](https://dev.to/gabrielanhaia/cursor-3-glass-replaced-composer-with-an-agents-window-1pcg)).
- **Plan Mode** researches the repo, writes a markdown plan and waits for approval ([morphllm](https://www.morphllm.com/cursor-agent-mode)).
- **Subagents** arrived in 2.4 with separate context and receive only the task text. Async subagents arrived in 3.3 (May 2026) **(unverified timeline)**.
- **Composer 2** is Cursor's own coding model (Mar 19 2026, with fast/standard variants). Forum posts mention Composer 2.5 ([forum](https://forum.cursor.com/t/frontier-agent-can-not-hand-on-tasks-to-composer-2-5/161091)).
- **Cloud/background agents** run in their own VMs. Since Feb 2026 they can test the app and return **videos, screenshots and logs**, which is the same "show me the result" loop Panel wants. Self-hosted cloud agents launched Mar 2026.
- **Checkpoints** are local pre-change snapshots kept separate from git **(secondary)**.
- **`@cursor/sdk`** has been in public beta since Apr 29 2026. It exposes "the same runtime, harness, and models" as the Cursor app and can run cloud, local or self-hosted. Hooks are file-based only for now ([cursor.com/sdk](https://cursor.com/sdk), [changelog](https://cursor.com/changelog/sdk-release)). T3 Code drives Cursor with it (`"@cursor/sdk": "1.2.0"`).

### 1.4 Kimi (Moonshot)

- **Kimi Code CLI** (formerly Kimi CLI) is a terminal agent that reads and edits code, runs shell commands, searches the web and supports MCP. It runs as an **ACP server** with `kimi acp`, for Zed's `agent_servers`. Over ACP, command runs are redirected to ACP terminal operations. It has a YOLO auto-approve mode, and its default models are the Kimi K2.x line ([GitHub](https://github.com/MoonshotAI/kimi-cli), [platform docs](https://platform.kimi.ai/docs/guide/kimi-cli-support)).
- **OK Computer** is Kimi's agent mode (launched Sept 2025). It gives the model its own virtual computer with a file system, browser and terminal, and outputs multi-page websites, slide decks and dashboards ([Kimi help](https://www.kimi.com/en-cn/help/agent/agent-overview), [MIT AI Agent Index](https://aiagentindex.mit.edu/2025/kimi-ok-computer)). It is relevant to Panel as a "make a site, then show it" product, not as something Panel can drive.

### 1.5 T3 Code (pingdotgg/t3code). Read from source.

The open-source "control layer for coding agents" by ping.gg/Theo. It ships as desktop, web and mobile, and runs with `npx t3@latest` ([repo](https://github.com/pingdotgg/t3code), [flaviocopes deep dive](https://flaviocopes.com/t3-code)). It requires each agent CLI to be installed and logged in first (`claude auth login`, `codex login`).

How it drives each agent, from `apps/server/package.json` and the adapters:
- **Claude:** `@anthropic-ai/claude-agent-sdk ^0.3.316` `query()` (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`). The options it sets:
  - `systemPrompt: { type: "preset", preset: "claude_code", append: <T3 instructions> }`
  - `includePartialMessages: true`
  - `permissionMode` (`default`, or `bypassPermissions` with `allowDangerouslySkipPermissions`)
  - `canUseTool`, `resume` / `resumeSessionAt`, `forkSession`
  - `cwd`, `additionalDirectories` (cwd plus an attachments folder)
  - `pathToClaudeCodeExecutable` (the user's binary), `mcpServers`, `settings`, `effort`, `thinking`
  - `hooks: { SubagentStart: [...] }`

  Code comment: "Iterate Query itself: the raw generator's return() queues behind a pending CLI read and deadlocks interruption."
- **Codex:** **app-server** through an `effect-codex-app-server` client. It shares one app-server across many threads and handles `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `turn/start`, `thread/start` and `thread/fork`.
- **Cursor** goes through `@cursor/sdk`, **OpenCode** through `@opencode-ai/sdk`, and others (Grok, Kiro, Pi…) through **ACP** packages (`@t3tools/provider-acp`).
- **Checkpoints are app-side:** `apps/server/src/checkpointing/CheckpointStore.ts` captures git-backed checkpoint refs per turn and diffs between them. It does not rely on the agent's own undo. Worktrees per thread (`WorktreeBranchSync.ts`).

The lesson for Panel: the most complete multi-agent GUI uses each vendor's **native** SDK or protocol for depth, keeps its own checkpoints, and uses ACP only for the long tail.

### 1.6 Zed's Agent Client Protocol (ACP)

- ACP is an open JSON-RPC-over-stdio protocol that connects "any editor to any agent" ([zed.dev/acp](https://zed.dev/acp), [repo](https://github.com/agentclientprotocol/agent-client-protocol)). Zed calls agents through `agent_servers` in its settings.
- The Claude adapter is **`@agentclientprotocol/claude-agent-acp`**, repo `agentclientprotocol/claude-agent-acp`. It was formerly `zed-industries/claude-code-acp`, and GitHub redirects the old name. Its v0.101.0 package.json shows it wraps `@anthropic-ai/claude-agent-sdk` 0.3.318 ([repo](https://github.com/agentclientprotocol/claude-agent-acp), [Zed blog](https://zed.dev/blog/claude-code-via-acp)).
- So ACP adds a layer over the same SDK, and its feature set trails the SDK's.

### 1.7 Conductor, Sculptor, opencode, Amp

- **Conductor** (Mac): each workspace is a **new git worktree** with its own chats, terminals, run scripts, diffs, checks and PR flow. It wraps Claude Code and Codex with the user's own subscription or key ([conductor.build](https://www.conductor.build), [vs Claude Code](https://conductor.build/compare/claude-code)). How it drives Claude internally (SDK vs CLI) is **unverified**.
- **Sculptor** (Imbue): each Claude Code agent runs in its **own Docker container**. "Pairing Mode" syncs the agent's branch both ways with your local checkout ([imbue.com/sculptor](https://imbue.com/sculptor), [HN](https://nfhn.netlify.app/item/45427697)).
- **opencode:** `opencode serve` exposes a headless **HTTP + SSE** server with OpenAPI (default port 4096). The client is `@opencode-ai/sdk` (`createOpencodeClient`, `createOpencodeServer`) ([docs](https://opencode.ai/docs/server/)). After Anthropic's 2026 enforcement, opencode removed Claude subscription OAuth **(secondary)** ([falcao.org](https://falcao.org/posts/anthropic-claude-access-crackdown-ecosystem-fallout/)).
- **Amp:** `amp --execute "<prompt>" --stream-json`, with `--stream-json-input` for NDJSON user messages on stdin. Its schema matches Claude Code's stream-json unless you add `--stream-json-thinking` ([Amp docs](https://ampcode.com/docs/cli/streaming-json)).

### 1.8 Cross-cutting patterns

| Concern | What the best tools do |
|---|---|
| UI ↔ agent wire | Long-lived process, bidirectional JSON over stdio (Claude stream-json control protocol, Codex app-server, ACP). Not one process per message. |
| Approvals | The agent asks the host (`canUseTool`, `requestApproval`, ACP permission requests), and the host shows UI. |
| Isolation | Git worktree per task (Conductor, T3, Onlook, Cursor) or a container/VM (Sculptor, Cursor cloud, Codex cloud). |
| Undo | App-side checkpoints (T3 git refs, Cursor snapshots) are more robust than agent-side undo, because Claude's rewind skips Bash and subagent edits. |
| Results | Cursor cloud agents return screenshots and videos. Onlook renders the dev server in a frame. This is the loop Panel wants. |

---

## 2. Driving Claude Code from Panel (late 2026)

### 2.1 Options compared

| Approach | Pros | Cons |
|---|---|---|
| **Today: `claude -p` per message + `--resume`** | Simple; already working | Startup cost every message; no mid-turn steering; approvals only via `--permission-prompt-tool`; can't interrupt cleanly (SIGTERM leaves the turn unfinished; SIGINT ends it) |
| **Raw CLI, long-lived: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`** | No dependency; Bun-native | You re-implement the SDK's control protocol (permission requests, hook callbacks, interrupt, set mode/model) by hand. That protocol is not separately documented for this use **(unverified)**. |
| **Agent SDK `query()` with streaming input** (recommended) | Typed messages; `canUseTool`; in-process hooks; `interrupt()`, `setPermissionMode()`, `setModel()`, `rewindFiles()`, `getContextUsage()`; in-process MCP; `startup()`/`prewarm()` to hide spawn latency; it's what T3 Code and the ACP adapter use | One more dependency; SDK moves fast (pin a version) |
| **ACP (`@agentclientprotocol/claude-agent-acp`)** | One protocol for Claude, Kimi, Gemini, others | Extra layer over the SDK; lags features; Panel isn't an editor |

### 2.2 Key SDK option names (TypeScript, `@anthropic-ai/claude-agent-sdk`)

From the [TS reference](https://code.claude.com/docs/en/agent-sdk/typescript):

- **Where it runs:** `cwd`, `additionalDirectories` (that is, `--add-dir`), `pathToClaudeCodeExecutable`, `executable: "bun"|"node"|"deno"`, `env` (**replaces** `process.env`, so spread it), `spawnClaudeCodeProcess`.
- **Tools and permissions:**
  - `tools` (a list, or the `claude_code` preset), `allowedTools` / `disallowedTools` (rule syntax such as `"Bash(npm run *)"`, `"Edit(//Users/me/secret/**)"`)
  - `permissionMode`, `allowDangerouslySkipPermissions`, `canUseTool`, `permissionPromptToolName`
  - `permissionPrompts: 'host'|'none'`, `toolAliases` (map a built-in name to your MCP tool), `toolConfig` (for example `askUserQuestion.previewFormat: "html"`)
- **Extensions:** `mcpServers` (stdio/http/sse, or `createSdkMcpServer()` in-process), `strictMcpConfig`, `hooks`, `agents`, `skills`, `plugins`, `settingSources` (`[]` skips user/project/local), `settings`.
- **Sessions:** `resume`, `continue`, `forkSession`, `resumeSessionAt`, `sessionId`, `persistSession`, `title`.
- **Model:** `model`, `fallbackModel`, `effort`, `thinking`, `systemPrompt` (string, or `{type:"preset", preset:"claude_code", append}`).
- **Limits and streaming:** `maxTurns`, `maxBudgetUsd`, `abortController`, `includePartialMessages`, `forwardSubagentText`, `agentProgressSummaries`.
- **Undo:** `enableFileCheckpointing`, plus `extraArgs: {"replay-user-messages": null}`.
- **Query methods:** `interrupt()`, `streamInput()`, `setPermissionMode()`, `setModel()`, `rewindFiles()`, `getContextUsage()`, `setMcpServers()`, `supportedModels()`, `accountInfo()`, `close()`.
- **Warm start:** `startup({options})` returns a `WarmQuery`, and `prewarm({options})` returns a `SpareProcess` you can `claim({prompt, options:{cwd}})` once the folder is known.

### 2.3 Sketch agent (code-shaped example)

```ts
import { query, tool, createSdkMcpServer, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// One input queue per FRIDAY chat; Panel pushes messages as the designer types.
const inbox = new AsyncQueue<SDKUserMessage>();

const panelTools = createSdkMcpServer({
  name: "panel",
  tools: [
    tool("look", "Render the sketch and return screenshots",
      { device: z.enum(["desktop","mobile"]).optional(), state: z.string().optional() },
      async (a) => ({ content: await renderAsImageBlocks(sketch, a) }),
      { annotations: { readOnlyHint: true } }),
    // ...search_library, get_reference, get_design_rules, place_on_board, etc.
  ],
});

const q = query({
  prompt: inbox,                                  // streaming input = long-lived session
  options: {
    cwd: sketchWorkDir,                           // e.g. ~/Library/.../panel/sketches/<proj>/<sketch>/work
    tools: ["Read", "Edit", "Write", "Glob", "Grep", "AskUserQuestion"], // no Bash, no Web
    permissionMode: "acceptEdits",                // edits auto-approved only inside cwd
    canUseTool: async (name, input) =>            // anything else (e.g. a path outside cwd) lands here
      ({ behavior: "deny", message: "Stay inside the sketch folder." }),
    mcpServers: { panel: panelTools },            // or keep the existing HTTP MCP at 127.0.0.1:4646
    allowedTools: ["mcp__panel__*"],
    systemPrompt: FRIDAY_PROMPT,                  // custom; or preset + append
    settingSources: [],                           // don't load the designer's ~/.claude hooks/skills into FRIDAY
    toolConfig: { askUserQuestion: { previewFormat: "html" } }, // let FRIDAY offer visual choices
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write", hooks: [async () => { await panel.snapshotAndRender(sketch); return {}; }] }],
      Stop:        [{ hooks: [async () => { await panel.commitVersion(sketch); return {}; }] }],
    },
    includePartialMessages: true,
    resume: savedSessionId,                       // per chat
    pathToClaudeCodeExecutable: userClaudePath,   // the designer's logged-in `claude`
    env: { ...process.env, ANTHROPIC_API_KEY: undefined }, // make sure the subscription login is used
  },
});
for await (const m of q) panel.forwardToChat(m);  // stream_event / assistant / user / result
```

Notes:
- `acceptEdits` auto-approves only inside working directories. Edits outside them fall through to `canUseTool`, where you deny them. You can also add an explicit `disallowedTools: ["Edit(//Users/**)"]` with an exception for the sketch folder, but test the rule ordering ([permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md)).
- Keep Panel's own versioning (`writeVersion`, `renderSketch`) as the source of truth, and snapshot from hooks. Don't depend on `rewindFiles()`, which is per-session and skips Bash and subagent edits.
- `AskUserQuestion` with `previewFormat: "html"` makes Claude attach a small HTML `preview` to each option. That gives a free "pick a direction" card on the canvas ([user input](https://code.claude.com/docs/en/agent-sdk/user-input.md)).
- Whether a PostToolUse hook can attach an *image* to the tool result is **unverified**, so keep `look` as an explicit tool.

### 2.4 Variants

```ts
// Branch the conversation; copy the files (forkSession does NOT copy files).
for (const v of ["A","B","C"]) {
  cp(sketchWorkDir, variantDir(v));
  query({ prompt: `Variant ${v}: ${direction[v]}`,
          options: { ...base, cwd: variantDir(v), resume: mainSessionId, forkSession: true } });
}
```

Run these in parallel (3 processes). Use `prewarm()` to cut startup time. Don't use subagents for variants: they share the parent's cwd and their edits aren't checkpointed.

### 2.5 Hand-off agent (code-shaped example)

```ts
// 1) Isolate:  git -C <repo> worktree add ../<repo>-panel-<slug> -b panel/<slug>
// 2) Bundle:   <worktree>/.panel-handoff/{sketch.html, screens/*.png, rules.md, brief.md, references.md}
const build = query({
  prompt: buildInbox,
  options: {
    cwd: worktree,
    additionalDirectories: [handoffBundleDir],     // if the bundle lives outside the worktree
    settingSources: ["user", "project", "local"],  // load the repo's CLAUDE.md, skills, hooks
    systemPrompt: { type: "preset", preset: "claude_code", append: HANDOFF_APPEND },
    permissionMode: "plan",                        // plan first, show it on the canvas
    canUseTool: askDesignerOnCanvas,               // Bash approvals etc. become Panel prompts
    mcpServers: { panel: { type: "http", url: "http://127.0.0.1:4646/mcp" } }, // references + report tools
    agentProgressSummaries: true,
    forwardSubagentText: true,
    maxBudgetUsd: 20,
    pathToClaudeCodeExecutable: userClaudePath,
  },
});
// After the designer approves the plan:
await build.setPermissionMode("acceptEdits");      // or "auto" if available on the plan/model
```

- **Progress on the canvas.** Show `TaskCreate`/`TaskUpdate` tool calls as a checklist, `assistant` text as narration, `tool_use` for Edit/Write as "touched files", and `system/compact_boundary` and `result` (cost, `session_id`). Save `session_id` so the card can be resumed after a restart.
- **Result capture.** Panel starts the repo's dev server itself in the worktree, reading the `dev` script from package.json and asking once for the URL/port. It waits for the port, then reuses its existing headless-Chrome `renderUrl()` to take device screenshots. The "built" card goes beside the sketch with a `git diff --stat` against the base branch. Also give the agent a Panel MCP tool (`show_result(url, route)`) so it can screenshot and compare against the sketch itself before it says it's done. This is the Cursor cloud-agent and Onlook loop.
- **Finish.** The agent commits on `panel/<slug>`. Panel offers "open PR" (the agent runs `gh pr create` after approval) or "discard worktree".

### 2.6 Using the designer's Claude subscription

- **Mechanics.** The SDK launches the Claude Code binary. Without `--bare` and without `ANTHROPIC_API_KEY`, the binary uses its own stored login (keychain). `--bare` "never reads OAuth credentials or the system keychain" ([headless](https://code.claude.com/docs/en/headless.md)). T3 Code relies on exactly this: you run `claude auth login`, then the app drives the SDK. The SDK docs don't state this outright and the quickstart only shows API keys, so treat it as **verified in practice by T3 Code's design, not by an Anthropic doc sentence**.
- **Policy, Nov 2026** ([legal & compliance](https://code.claude.com/docs/en/legal-and-compliance.md)). Anthropic forbids third-party developers to "offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users", or to "collect, store, or intermediate" Claude.ai credentials. The same page says this does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". It also says plan limits "assume ordinary, individual usage of Claude Code and the Agent SDK". The Agent SDK overview repeats: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login…".
- **Background.** In Jan–Apr 2026 Anthropic blocked subscription OAuth tokens used *outside* the Claude Code binary (OpenCode, OpenClaw and others) ([The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access), secondary roundup [falcao.org](https://falcao.org/posts/anthropic-claude-access-crackdown-ecosystem-fallout/)).
- **Reading for Panel.** Panel is a single-user local tool. It never sees tokens and runs the unmodified binary the designer logged into, which is the allowed pattern. Keep it that way:
  - Never read `~/.claude` credentials or the keychain.
  - Never add a login screen.
  - Don't pass `--bare`.
  - Don't ship Panel to other people as a product that rides their plan without checking with Anthropic.

  Anthropic says it "may enforce without notice", so this is a judgement, not a guarantee.

### 2.7 If you stay on the raw CLI

Use one long-lived process per chat instead of one per message:

```
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages \
  --resume <id> --mcp-config <json> --strict-mcp-config --allowedTools "mcp__panel" \
  --tools "Read,Edit,Write,Glob,Grep" --permission-mode acceptEdits \
  --permission-prompt-tool mcp__panel__approve --system-prompt "<...>"
```

Then write `{"type":"user","message":{"role":"user","content":"..."}}` lines to stdin. Other useful flags: `--fork-session`, `--add-dir`, `--permission-prompts none` (≥ v2.1.259), `--forward-subagent-text`, and `--max-budget-usd`. The `--tools` flag with a list is what Panel already uses (`--tools ""`). Check whether the comma-list form is accepted on your version **(unverified)**.

---

## 3. "Point at it and change it" and variants in design tools

| Tool | On select, what reaches the model | Deterministic edits? | Variants / states |
|---|---|---|---|
| **Onlook** (old web editor, source) | `HighlightContext`: `<path>file#Lstart:Lend</path>`, `<branch id>`, the **source snippet**, with the prefix "I am looking at this specific part of the file in the browser UI…" ([source](https://github.com/onlook-dev/onlook/blob/main/packages/ai/src/contexts/classes/highlight.ts)). DOM↔code map via build-time `data-oid` attributes (secondary). | Style panel edits iframe first, then code | Branches |
| **Onlook** (new Mac app) | Frames render the app's **local dev server**. The agent edits a **git worktree** on its own branch, running "Claude Code or ChatGPT, on the plan you already have". Top-bar pill: commit, push, PR, fix checks. Canvas "artifacts" for sketches not tied to code ([docs](https://docs.onlook.com), [architecture](https://docs.onlook.com/developers/architecture)) | n/a | Branch per project |
| **Lovable** Visual Edits | A stable ID per JSX element from a custom Vite plugin. Click maps to JSX. | Yes: client-side Babel/SWC AST mutation plus client-side Tailwind; "without requiring AI intervention" ([blog](https://lovable.dev/blog/visual-edits)) | n/a |
| **v0** Design Mode | "automatically attaches a **screenshot of the selected element**" with the instruction. Pending panel edits are sent to chat on Apply. Code location not documented ([docs](https://v0.app/docs/design-mode)) | Panel (type, colour, spacing…) + NL box | Reset / before-after |
| **Figma Make** Point and edit | Selected element plus toolbar (colours, padding, text). Works with Tailwind/shadcn projects. Users report the selection sometimes isn't passed to the prompt ([help](https://help.figma.com/hc/en-us/articles/31304485164695), [forum](https://forum.figma.com/report-a-problem-6/selected-element-not-passed-to-figma-make-ai-prompt-51238)) | Partly (hardcoded text, styles) | — |
| **Bolt** Select / Visual Inspector | Selected element focuses the prompt. "Pick from layers" / Alt for exact targeting ([support](https://support.bolt.new/building/chat-tools.md)). Exact payload **unverified**. | — | — |
| **Claude Design** (Anthropic Labs, Apr 17 2026) | "Comment inline on specific elements", edit text directly. Claude generates **custom adjustment knobs/sliders** for spacing, colour and layout, then applies them across the design. Builds a design system from your codebase. **Handoff bundle → Claude Code with a single instruction** ([announcement](https://www.anthropic.com/news/claude-design-anthropic-labs)) | Knobs | "wide range of directions"; named variants feature not documented |
| **Magic Patterns** | Visual Edit mode (pencil): select on the left, edit in the right panel ([review](https://banani.co/blog/magic-patterns-ai-review)). Variants/branches **unverified**. | Yes | unverified |
| **Subframe** | Not researched in depth **(unverified)** | — | — |
| **Proto** (prototypes.fun) | Landing page only: "Designer's IDE", "like Claude Code or Cursor, but with all the design features you wish they'd ship", inspired by Midjourney-style rapid ideation. Pilot or early access, no feature docs ([site](https://prototypes.fun)) | unverified | unverified (the Midjourney framing suggests grids of variations) |

**Patterns worth copying:**
1. **Stable element IDs** written into the file (Onlook `data-oid`, Lovable's Vite plugin). For Panel's single-file HTML, add `data-pid="…"` when a version is written. The click maps straight to a line range.
2. **Send code location plus a snippet plus a crop.** Onlook sends `file#L..` and the snippet. v0 sends a screenshot crop. Do both, and add computed styles for the few properties that matter: font, size, colour, spacing.
3. **Make simple edits directly.** Lovable, v0 and Figma Make apply text, colour and spacing edits without the model. They are cheap and instant, and the designer stays in control.
4. **Knobs** (Claude Design). Let the model expose a few CSS variables as sliders. Panel renders them and writes the value back.
5. **Variants as branches.** Onlook, T3 and Conductor give each variant its own branch or worktree. For sketches, a folder copy per variant is enough.

---

## 4. Recommended architecture for Panel

### (a) Fast sketch loop inside Panel

```
Panel server (Bun)
 ├─ FridaySession (one per chat)  ── Agent SDK query(prompt: AsyncQueue) ──► claude binary (user login)
 │    cwd = sketches/<proj>/<sketch>/work/   tools = Read/Edit/Write/Glob/Grep/AskUserQuestion
 │    mcp  = panel (library, references, rules, look/render, place_on_board)
 │    hooks: PostToolUse(Edit|Write) → snapshot + render → canvas live update
 │           Stop → commit version vN
 ├─ Versions: Panel-owned (existing writeVersion/renderSketch); undo = restore vN into work/
 ├─ Selection bridge: iframe script → {pid, line range, outerHTML, styles, crop.png} → user message
 └─ Variants: copy work/ → work-A/B/C, query({resume, forkSession:true, cwd}) in parallel
```

- **Why native file tools.** Claude Code's Read/Edit/Write come with its own safeguards (read-before-edit, exact-match edits, stale-file detection), and they work the way the model was trained. Panel's find/replace MCP tools duplicate that less well. Keep `make_sketch` for creating the folder and registering it on the canvas. Retire `edit_sketch` in favour of Edit.
- **Why the SDK over respawn.** Faster follow-ups through a warm process and `prewarm`. A real Stop button via `interrupt()`. In-chat approvals via `canUseTool`. Hooks run in Panel's own process.
- **Isolation.** Use `cwd` per sketch, `acceptEdits`, no Bash, a `canUseTool` that denies everything else, and `settingSources: []` so the designer's personal hooks and plugins don't leak into FRIDAY. If you later allow Bash (for example to run a formatter), add OS sandboxing via the `sandbox` option, because path rules alone don't stop scripts ([permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md)).
- **Tradeoffs.**
  - Multi-file sketches become possible, which is good but needs Panel's renderer to serve a folder.
  - One process per open chat costs memory, so close idle sessions after N minutes and `resume` later.
  - The SDK version has to track the CLI version, so pin it and use `pathToClaudeCodeExecutable` deliberately. Using the bundled binary is also an option, but it may not share the user's login state the same way **(unverified)**.

### (b) Hand-off to Claude Code in the real repo

```
Canvas "Build this" ─► HandoffJob
  1. git worktree add <repo>-panel-<slug> -b panel/<slug>        (main checkout untouched)
  2. write .panel-handoff/ bundle: chosen sketch (+ variants rejected and why), screenshots per device/state,
     unugly rules, project brief, locked decisions, reference links
  3. query({ cwd: worktree, settingSources: ["user","project","local"], preset claude_code + append,
             permissionMode: "plan", canUseTool → canvas approvals, mcp: panel (refs + show_result) })
  4. plan shown on canvas → designer approves → setPermissionMode("acceptEdits")
  5. stream progress → card (tasks, files touched, cost); persist session_id
  6. on result: Panel runs dev server in worktree → renderUrl() screenshots → "Built" card beside sketch,
     side-by-side with the sketch; designer can comment → message back into the same session (resume)
  7. finish: commit / PR (gh) or remove worktree
```

- **Why a separate, long-lived session.** The repo needs the full Claude Code preset, the repo's CLAUDE.md, skills, hooks and Bash. That is a different trust level from FRIDAY's sketch box. Keeping them separate also keeps FRIDAY's context small.
- **Why a worktree.** It's what Conductor, T3, Onlook and Cursor converge on. It's cheap, the designer's own checkout stays clean, several builds can run in parallel, and the PR comes out naturally. Claude Code may have a native `--worktree` flag **(unverified; mentioned in a secondary source)**.
- **Alternatives.**
  - (i) Just write the handoff bundle and open the designer's own Claude Code on it. This is how Claude Design does it, and it's the least work, but nothing streams back to the canvas.
  - (ii) Drive Codex or Cursor too, via app-server or `@cursor/sdk`. Only worth it if the designer wants a choice of builder. An adapter interface like T3's is the model.
  - (iii) ACP via `claude-agent-acp`. Use it only if you want one code path for many agents.
- **Risks.**
  - Dev-server detection varies by project, so ask once and remember per repo.
  - Long builds can hit plan rate limits. Watch `system/api_retry` and `result.subtype`.
  - `bypassPermissions` should never be used on the designer's real machine.

### Quick decision summary

| Decision | Recommendation |
|---|---|
| Wire to Claude | `@anthropic-ai/claude-agent-sdk` `query()` with streaming input; pin version |
| Auth | User's own `claude` login via the unmodified binary; no API key in env, no `--bare` |
| Sketch editing | Native Read/Edit/Write in a per-sketch `cwd`, `acceptEdits`, no Bash |
| Versions/undo | Panel-owned snapshots (hooks), not `rewindFiles` |
| Seeing the result | Keep a `look`/render MCP tool returning images |
| Element selection | `data-pid` tags + line range + snippet + crop + key styles; direct edits for text/colour/spacing |
| Variants | Folder copy + `resume` + `forkSession: true`, parallel |
| Hand-off | Separate session in a git worktree, plan mode first, Panel MCP attached, dev server + screenshots back to canvas |
| Multi-agent | Later; native SDKs first (T3 pattern), ACP for the long tail |
