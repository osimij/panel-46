// Builds: a chosen sketch handed to Claude Code, which makes it for real in the designer's
// own code. Panel writes a hand-off (the brief, the rules, the locked decisions and their
// saves, the sketch, what was ruled out and why), then runs Claude Code in the project's
// folder — on a branch of its own in a separate checkout (git worktree) when it's a git
// repo, so the designer's working copy is never touched. Claude Code works with its own
// harness (its tools, CLAUDE.md, the designer's settings); Panel only watches the stream and
// shows the steps on a card next to the sketch. When it's done, Panel runs the result and
// takes pictures, so the build sits on the canvas beside the sketch it came from.
//
// A build is a Claude Code session: follow-ups resume it, and the designer can open the
// same session in their terminal (claude --resume) and carry on by hand.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { db, getSetting, newId, now, setSetting } from "./db.ts";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { LIBRARY_DIR, PORT } from "./config.ts";
import { load } from "./library.ts";
import { apply, findProject, getProject, summary, type BoardNode } from "./projects.ts";
import { designRules } from "./rules.ts";
import { claudeBinary, claudeToken } from "./read.ts";
import { readSketch, renderOf, renderUrl, statesOf, versionsOf, type Device, type Render } from "./sketches.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sketch_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  -- the folder the designer picked, and where Claude Code works (a worktree of it, or it)
  folder TEXT NOT NULL,
  workdir TEXT NOT NULL,
  branch TEXT,
  session_id TEXT,
  -- working · done · failed · stopped
  status TEXT NOT NULL,
  -- JSON: what it did, in order ({ kind, text })
  steps TEXT NOT NULL DEFAULT '[]',
  -- JSON: its plan, as Claude Code's todo list
  plan TEXT,
  -- what it said last
  reply TEXT,
  -- JSON: { command, url } to see it running
  preview TEXT,
  port INTEGER,
  shot_at TEXT,
  error TEXT,
  turns INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
// A build that was working when Panel stopped won't finish now.
db.run("UPDATE builds SET status = 'stopped', error = 'Panel was restarted while this was working. Ask for changes to carry on.' WHERE status = 'working'");

const BUILDS_DIR = join(LIBRARY_DIR, "builds");
mkdirSync(BUILDS_DIR, { recursive: true });

interface Row {
  id: string; project_id: string; sketch_id: string; version: number; title: string; folder: string; workdir: string;
  branch: string | null; session_id: string | null; status: string; steps: string; plan: string | null; reply: string | null;
  preview: string | null; port: number | null; shot_at: string | null; error: string | null; turns: number; created_at: string; updated_at: string;
}
export interface Step { kind: "read" | "edit" | "run" | "look" | "plan" | "say" | "other"; text: string }
export interface PlanItem { content: string; status: "pending" | "in_progress" | "completed" }

const row = (id: string) => db.query<Row, [string]>("SELECT * FROM builds WHERE id = ?").get(id);
const shotFile = (id: string, i = 0) => join(BUILDS_DIR, id, `shot${i ? `-${i + 1}` : ""}.jpg`);

/** A build as the app shows it. */
export function getBuild(id: string) {
  const r = row(id);
  if (!r) return null;
  const preview = r.preview ? (JSON.parse(r.preview) as { command: string; url: string }) : null;
  return {
    id: r.id,
    project: r.project_id,
    sketch: r.sketch_id,
    version: r.version,
    title: r.title,
    folder: r.folder,
    workdir: r.workdir,
    branch: r.branch,
    status: r.status,
    steps: JSON.parse(r.steps) as Step[],
    plan: r.plan ? (JSON.parse(r.plan) as PlanItem[]) : null,
    reply: r.reply,
    preview,
    serving: servers.has(r.id),
    shot: r.shot_at && existsSync(shotFile(r.id)) ? `/api/builds/${r.id}/shot.jpg?at=${encodeURIComponent(r.shot_at)}` : null,
    error: r.error,
    turns: r.turns,
    resume: r.session_id ? `cd ${shellQuote(r.workdir)} && claude --resume ${r.session_id}` : null,
    updated_at: r.updated_at,
  };
}

/** A build in a few fields, for Claude reading the project. */
export function buildSummary(id: string) {
  const b = id ? getBuild(id) : null;
  if (!b) return null;
  return {
    build: b.id,
    title: b.title,
    status: b.status,
    folder: b.workdir,
    branch: b.branch ?? undefined,
    of_sketch: b.sketch,
    last_reply: b.reply ? b.reply.slice(0, 600) : undefined,
    preview: b.preview?.url,
    error: b.error ?? undefined,
  };
}

// ---------- The hand-off: everything Claude Code needs, written down ----------

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sketch";

/**
 * Write the hand-off for a sketch: HANDOFF.md, the sketch's page and pictures, and the
 * pictures of the saves it's built on. Returns the folder and the text.
 */
export function writeHandoff(projectId: string, sketchId: string, note = "") {
  const full = getProject(projectId);
  if (!full) throw new Error("That project is gone.");
  const node = full.nodes.find((n) => n.id === sketchId && n.kind === "sketch");
  if (!node) throw new Error("That sketch isn't on the canvas.");
  const version = Number(node.data.version) || 1;
  const s = summary(projectId);
  if (!s) throw new Error("That project is gone.");
  const dir = join(LIBRARY_DIR, "projects", projectId, "handoffs", `${sketchId}-v${version}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "sketch"), { recursive: true });
  mkdirSync(join(dir, "references"), { recursive: true });

  // The sketch: its page, its pictures, and each state's page address.
  const html = readSketch(projectId, sketchId, version);
  writeFileSync(join(dir, "sketch", "index.html"), html);
  const r = renderOf(projectId, sketchId, version);
  r.screens.forEach((f, i) => copyFileSync(f, join(dir, "sketch", `screen-${i + 1}.jpg`)));
  const states = statesOf(html);

  // The saves behind the decisions: their pictures, so Claude Code can look at them.
  const { docs } = load();
  const picture = (refId: string) => {
    const d = docs.get(refId);
    const m = d?.media.find((x) => x.type === "image") ?? d?.media[0];
    const src = m?.thumb_path ?? d?.r.preview_path;
    if (!src) return null;
    const from = join(LIBRARY_DIR, "media", src);
    if (!existsSync(from)) return null;
    const to = join(dir, "references", `${refId}${src.match(/\.\w+$/)?.[0] ?? ".jpg"}`);
    copyFileSync(from, to);
    return `references/${basename(to)}`;
  };

  // Other sketches: the ones ruled out say what not to do.
  const sketches = full.nodes.filter((n) => n.kind === "sketch" && n.id !== sketchId);
  const out = sketches.filter((n) => n.data.state === "ruled_out");
  const notesOn = (id: string) => {
    const near = new Set(full.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])));
    return full.nodes.filter((n) => n.kind === "note" && near.has(n.id)).map((n) => String(n.data.text ?? "").trim()).filter(Boolean);
  };
  const outPics = out.map((n) => {
    const v = Number(n.data.version) || 1;
    const shot = renderOf(projectId, n.id, v).screens[0];
    if (!shot) return null;
    const to = join(dir, "sketch", `ruled-out-${slug(String(n.data.title || n.id))}.jpg`);
    copyFileSync(shot, to);
    return `sketch/${basename(to)}`;
  });

  const lines: string[] = [];
  lines.push(`# Build: ${String(node.data.title || "Untitled sketch")}`, "");
  lines.push(`From the designer's Panel project “${s.project}”. The designer explored this direction as a quick sketch and chose it; now it needs to be built properly, here, in this codebase.`, "");
  if (note.trim()) lines.push("## What the designer asks", "", note.trim(), "");
  if (s.brief) lines.push("## The brief", "", s.brief, "");
  lines.push("## What to build", "");
  lines.push(`- The sketch: \`sketch/index.html\` (version ${version} of ${versionsOf(projectId, sketchId).length}). Pictures of it as rendered: ${r.screens.map((_, i) => `\`sketch/screen-${i + 1}.jpg\``).join(", ") || "none"}.`);
  if (node.data.tries) lines.push(`- What it tries: ${String(node.data.tries)}`);
  if (node.data.device && node.data.device !== "desktop") lines.push(`- Made for: ${String(node.data.device)} first.`);
  if (node.data.reason) lines.push(`- Why the designer chose it: ${String(node.data.reason)}`);
  for (const t of notesOn(sketchId)) lines.push(`- The designer's note on it: ${t}`);
  if (states.length > 1) lines.push(`- Its states: ${states.map((x) => x.name).join(", ")} (open the sketch with #${states[1]!.slug} and so on to see each). Build each one.`);
  lines.push("", "The sketch is a direction, not code to paste. Rebuild it in this project's stack, components and conventions, as production code: real structure, accessibility, responsive, no hard-coded hacks. Where the sketch settles the look (type, color, spacing, motion, copy), match it closely; where it's rough, do it properly in its spirit.", "");

  const locked = s.decisions.filter((d) => d.status === "locked" || d.chosen?.length);
  if (locked.length) {
    lines.push("## Decisions already made", "");
    for (const d of locked) {
      lines.push(`### ${d.topic}${d.status === "locked" ? " (locked)" : ""}`);
      if (d.decision) lines.push(d.decision);
      for (const n of d.notes ?? []) lines.push(`- Designer's note: ${n}`);
      for (const c of d.chosen ?? []) {
        const pic = c.id ? picture(c.id) : null;
        lines.push(`- Chosen: ${c.title}${c.taking ? ` — take: ${c.taking}` : ""}${c.why ? ` — why: ${c.why.join(" / ")}` : ""}${pic ? ` (picture: \`${pic}\`)` : ""}`);
        if (c.offers) lines.push(`  - ${c.offers}`);
      }
      for (const c of (d as { ruled_out?: { title: string; why?: string[] }[] }).ruled_out ?? []) lines.push(`- Ruled out: ${c.title}${c.why ? ` — ${c.why.join(" / ")}` : ""}`);
      lines.push("");
    }
  }
  if (out.length) {
    lines.push("## Directions the designer ruled out (don't drift back to these)", "");
    out.forEach((n, i) => lines.push(`- ${String(n.data.title || "Untitled")}${n.data.tries ? `: ${String(n.data.tries)}` : ""}${n.data.reason ? ` — why not: ${String(n.data.reason)}` : ""}${outPics[i] ? ` (\`${outPics[i]}\`)` : ""}`));
    lines.push("");
  }
  if (s.materials?.length) {
    lines.push("## Project materials", "");
    for (const m of s.materials) lines.push(`- ${m.name}${m.note ? ` — ${m.note}` : ""}${m.url ? ` (${m.url})` : ""}${m.file ? ` (file: ${m.file})` : ""}`);
    lines.push("");
  }
  const rules = designRules();
  if (rules) lines.push("## The designer's rules (unugly.md)", "", "These hold for everything you build here and outrank the sketch and every reference. Check the result against them before you finish.", "", rules.trim(), "");
  lines.push("## More from Panel", "", "Panel's MCP tools are connected (mcp__panel__…): get_project reads the whole project, get_reference shows a save with its pictures, get_sketch shows a sketch (with pictures on other devices or states).", "");
  const text = lines.join("\n");
  writeFileSync(join(dir, "HANDOFF.md"), text);
  return { dir, text, version };
}

// ---------- Running Claude Code ----------

interface Run { proc: ReturnType<typeof Bun.spawn> | null; sdk?: { q: Query; abort: AbortController }; stopped: boolean }
const runs = new Map<string, Run>();

/** Commands Claude Code may run without asking, in the build's folder. Everything else is refused. */
const ALLOWED = [
  "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "NotebookEdit", "TodoWrite", "Task", "WebFetch", "WebSearch", "mcp__panel",
  ...["npm", "npx", "pnpm", "yarn", "bun", "bunx", "node", "deno", "tsc", "vite", "next", "astro", "ls", "cat", "head", "tail", "wc", "mkdir", "cp", "mv", "touch", "find", "grep", "rg", "pwd", "echo", "which", "sort", "diff",
    "git status", "git diff", "git log", "git add", "git commit", "git show", "git branch", "git rev-parse", "git ls-files", "python3 -m json.tool", "curl -s http://localhost", "curl -sI http://localhost", "curl http://localhost"]
    .map((c) => `Bash(${c}:*)`),
];

function freePort(): number {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = s.port ?? 0;
  s.stop(true);
  return port;
}

const BUILD_SYSTEM = (id: string, port: number, handoff: string) => `You are working for a designer, handed a direction they chose in Panel (their design-reference app). The hand-off is in ${handoff}: read HANDOFF.md first, and look at the pictures it points to (the sketch's screens and the references) before you write code. Panel shows your progress to the designer as you work, step by step, so keep your todo list current.

Work in this folder only. Commit to the current branch when the build works (it's a branch of its own, made for this build; never push, never switch branches). You can't ask the designer questions mid-way: make sensible calls, and say what you assumed at the end.

If it's a web app, it must run on port ${port} (pass it to the dev server's own flag or env, e.g. vite --port ${port} --strictPort, next dev -p ${port}, PORT=${port}). Install dependencies if needed. You can't start servers yourself; Panel does it for you:
- To see what you built, call mcp__panel__see_build with build "${id}", the command that starts it (run from this folder) and the url of the page. Panel starts it, takes pictures in a real browser, and gives them back with any errors the page threw. Do this before you finish, look hard (compare with the sketch's pictures and the designer's rules), fix what's off, and look again.

At the very end of your final reply, on a line of its own, write exactly:
PANEL_PREVIEW {"command": "<the shell command that starts it, run from this folder>", "url": "http://localhost:${port}/<the page that shows what you built>"}
If it can't run as a page, leave that line out and say why.

Finish with a short summary for the designer, in plain words (they're a designer, not an engineer): what you built, where, what you assumed, and what's left.`;

function setRow(id: string, patch: Partial<Row>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.run(`UPDATE builds SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => (patch as Record<string, unknown>)[k] as string | number | null), now(), id]);
}

/** A tool call, said the way the card shows it. */
function stepOf(name: string, input: Record<string, unknown>, workdir: string): Step | null {
  const rel = (p: unknown) => (typeof p === "string" ? (p.startsWith(workdir) ? p.slice(workdir.length + 1) || "." : basename(p)) : "");
  const n = name.replace(/^mcp__panel__/, "panel:");
  switch (name) {
    case "Read": return { kind: "read", text: `Read ${rel(input.file_path)}` };
    case "Edit": case "MultiEdit": return { kind: "edit", text: `Edited ${rel(input.file_path)}` };
    case "Write": return { kind: "edit", text: `Wrote ${rel(input.file_path)}` };
    case "NotebookEdit": return { kind: "edit", text: `Edited ${rel(input.notebook_path)}` };
    case "Glob": return { kind: "read", text: `Looked for ${String(input.pattern ?? "files")}` };
    case "Grep": return { kind: "read", text: `Searched for “${String(input.pattern ?? "").slice(0, 60)}”` };
    case "Bash": return { kind: "run", text: String(input.description || `Ran ${String(input.command ?? "").split("\n")[0]!.slice(0, 80)}`) };
    case "Task": return { kind: "other", text: `Asked a helper: ${String(input.description ?? "")}` };
    case "WebFetch": return { kind: "look", text: `Read ${String(input.url ?? "a page")}` };
    case "WebSearch": return { kind: "look", text: `Searched the web for “${String(input.query ?? "")}”` };
    case "TodoWrite": case "TaskCreate": case "TaskUpdate": case "TaskList": case "TaskGet": case "TaskOutput": case "ToolSearch": case "ExitPlanMode": case "EnterPlanMode": return null;
  }
  if (n.startsWith("panel:")) return { kind: "look", text: `Looked in Panel (${n.slice(6).replace(/_/g, " ")})` };
  return { kind: "other", text: name };
}

async function drive(id: string, prompt: string, port: number) {
  const r = row(id)!;
  const bin = await claudeBinary();
  if (!bin) throw new Error("The claude command line isn't installed.");
  const token = await claudeToken();
  const handoff = join(LIBRARY_DIR, "projects", r.project_id, "handoffs", `${r.sketch_id}-v${r.version}`);
  const mcp = JSON.stringify({ mcpServers: { panel: { type: "http", url: `http://127.0.0.1:${PORT}/mcp` } } });
  const args = [
    bin, "-p", prompt,
    "--model", getSetting("build_model") ?? getSetting("chat_model") ?? "claude-opus-5-5",
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits",
    "--allowedTools", ...ALLOWED,
    "--add-dir", handoff,
    "--mcp-config", mcp,
    "--append-system-prompt", BUILD_SYSTEM(id, port, handoff),
    ...(r.session_id ? ["--resume", r.session_id] : []),
  ];
  const env = { HOME: process.env.HOME ?? "", USER: process.env.USER ?? "", PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`, LANG: process.env.LANG ?? "en_US.UTF-8", ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) };
  const run: Run = { proc: null, stopped: false };
  runs.set(id, run);
  const steps: Step[] = JSON.parse(r.steps);
  // Its plan, from Claude Code's task tools (TaskCreate, then TaskUpdate by number) or the older todo list.
  const tasks: (PlanItem & { id?: string })[] = r.plan && r.turns <= 1 ? [] : r.plan ? JSON.parse(r.plan) : [];
  const creating = new Map<string, PlanItem & { id?: string }>();
  const savePlan = () => setRow(id, { plan: JSON.stringify(tasks.filter((t) => (t.status as string) !== "deleted").slice(0, 40).map(({ content, status }) => ({ content, status }))) });
  const raw = Bun.file(join(BUILDS_DIR, id, "stream.jsonl")).writer();
  let reply = "";
  let resultError: string | null = null;
  let gotResult = false;
  let lastSave = 0;
  const save = (force = false) => {
    if (!force && Date.now() - lastSave < 700) return;
    lastSave = Date.now();
    setRow(id, { steps: JSON.stringify(steps.slice(-200)), reply: reply || r.reply });
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const handle = (d: any) => {
    if (d.type === "system" && d.subtype === "init" && d.session_id) return setRow(id, { session_id: d.session_id });
    if (d.type === "assistant") {
      let text = "";
      for (const c of d.message?.content ?? []) {
        if (c.type === "text" && c.text?.trim()) text += c.text;
        if (c.type !== "tool_use") continue;
        if (c.name === "TodoWrite" && Array.isArray(c.input?.todos)) {
          tasks.length = 0;
          for (const t of c.input.todos.slice(0, 40)) tasks.push({ content: String(t.content ?? t.activeForm ?? ""), status: t.status });
          savePlan();
          continue;
        }
        if (c.name === "TaskCreate") {
          const t = { content: String(c.input?.subject ?? c.input?.description ?? c.input?.activeForm ?? "").slice(0, 160), status: "pending" as const };
          tasks.push(t);
          creating.set(c.id, t);
          savePlan();
          continue;
        }
        if (c.name === "TaskUpdate") {
          const want = String(c.input?.taskId ?? c.input?.id ?? "");
          const t = tasks.find((x) => x.id === want) ?? (/^\d+$/.test(want) ? tasks[Number(want) - 1] : undefined);
          if (t) {
            if (c.input?.status) t.status = c.input.status;
            if (c.input?.subject) t.content = String(c.input.subject).slice(0, 160);
            savePlan();
          }
          continue;
        }
        const st = stepOf(c.name, c.input ?? {}, r.workdir);
        if (st) steps.push(st);
      }
      if (text.trim()) {
        reply = text.trim();
        steps.push({ kind: "say", text: reply.split("\n").find((l) => l.trim())!.slice(0, 200) });
      }
      save();
      return;
    }
    if (d.type === "user") {
      // A task's number, from what TaskCreate answered ("Task #3 created…").
      for (const c of d.message?.content ?? []) {
        if (c.type !== "tool_result" || !creating.has(c.tool_use_id)) continue;
        const text = Array.isArray(c.content) ? c.content.map((x: any) => x.text ?? "").join(" ") : String(c.content ?? "");
        const n = text.match(/#?(\d+)/);
        if (n) creating.get(c.tool_use_id)!.id = n[1];
        creating.delete(c.tool_use_id);
      }
      return;
    }
    if (d.type === "result") {
      gotResult = true;
      if (d.is_error) resultError = String(d.result || d.subtype || "Claude Code couldn't finish.").slice(0, 400);
      else if (typeof d.result === "string" && d.result.trim()) reply = d.result.trim();
      const u = d.usage;
      if (u) db.run(
        "INSERT INTO ai_usage (at, ref_id, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost) VALUES (?, NULL, ?, 'build', ?, ?, ?, ?, 0)",
        [now(), getSetting("build_model") ?? getSetting("chat_model") ?? "claude-opus-5-5", u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0],
      );
    }
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let code: number | null = 0;
  let stderr = "";
  // Through the Agent SDK by default: Claude Code's own harness and system prompt, the repo's
  // CLAUDE.md and settings, Panel's tools; Bash outside the allowed list is refused by Panel
  // as it's asked for. The command line stays as the fallback (build_engine = "cli").
  let cli = getSetting("build_engine") === "cli";
  if (!cli) {
    const abort = new AbortController();
    const allowed = new Set(ALLOWED.filter((t) => !t.startsWith("Bash(")));
    const bashOk = ALLOWED.filter((t) => t.startsWith("Bash(")).map((t) => t.slice(5, -3));
    const q = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: bin,
        cwd: r.workdir,
        env,
        model: getSetting("build_model") ?? getSetting("chat_model") ?? "claude-opus-5-5",
        systemPrompt: { type: "preset", preset: "claude_code", append: BUILD_SYSTEM(id, port, handoff) },
        settingSources: ["user", "project", "local"],
        permissionMode: "acceptEdits",
        allowedTools: ALLOWED,
        additionalDirectories: [handoff],
        mcpServers: { panel: { type: "http", url: `http://127.0.0.1:${PORT}/mcp` } },
        abortController: abort,
        canUseTool: async (name, input) => {
          if (allowed.has(name) || name.startsWith("mcp__panel__")) return { behavior: "allow", updatedInput: input };
          if (name === "Bash") {
            const cmd = String((input as { command?: string }).command ?? "").trim();
            if (!/[;|`$<>]|&&|\|\|/.test(cmd) && bashOk.some((c) => cmd === c || cmd.startsWith(c + " "))) return { behavior: "allow", updatedInput: input };
            return { behavior: "deny", message: "Panel only lets builds run package managers, node tools, file listing and git (no push, no chained commands). Do it another way, or say what the designer should run." };
          }
          return { behavior: "deny", message: `Panel doesn't let builds use ${name}.` };
        },
        ...(r.session_id ? { resume: r.session_id } : {}),
      },
    });
    run.sdk = { q, abort };
    try {
      for await (const m of q) {
        raw.write(JSON.stringify(m) + "\n");
        handle(m);
        if (run.stopped) break;
      }
    } catch (e) {
      stderr = (e as Error).message;
      code = 1;
    } finally {
      run.sdk = undefined;
    }
    if (stderr && !gotResult && !steps.length && !run.stopped) {
      console.error("Build: the Agent SDK couldn't start, using the command line:", stderr);
      cli = true;
    }
  }
  if (cli) {
    const proc = Bun.spawn(args, { cwd: r.workdir, env, stdout: "pipe", stderr: "pipe" });
    run.proc = proc;
    if (run.stopped) proc.kill();
    const decoder = new TextDecoder();
    let buf = "";
    const errText = new Response(proc.stderr).text();
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        raw.write(line + "\n");
        try {
          handle(JSON.parse(line));
        } catch (e) {
          console.error("Build: couldn't use a line from Claude Code:", (e as Error).message);
        }
      }
    }
    code = await proc.exited;
    stderr = (await errText).trim();
  }
  await raw.end();
  runs.delete(id);
  save(true);
  if (run.stopped) return setRow(id, { status: "stopped", error: null });

  // What it said to run, if anything.
  const m = reply.match(/PANEL_PREVIEW\s*(\{[^\n]*\})/);
  let preview: { command: string; url: string } | null = null;
  if (m) {
    try {
      const j = JSON.parse(m[1]!);
      if (typeof j.command === "string" && typeof j.url === "string" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(j.url)) preview = { command: j.command, url: j.url };
    } catch {
      /* no preview, then */
    }
  }
  const clean = reply.replace(/\n?PANEL_PREVIEW\s*\{[^\n]*\}\s*/g, "\n").trim();
  if (resultError || !gotResult) {
    setRow(id, { status: "failed", reply: clean || null, error: friendly(resultError ?? (stderr.split("\n").pop() || `Claude Code stopped (code ${code}).`)) });
    return;
  }
  setRow(id, { status: "done", reply: clean, error: null, ...(preview ? { preview: JSON.stringify(preview) } : {}) });
  if (preview ?? (r.preview ? JSON.parse(r.preview) : null)) await startPreview(id, true).catch((e) => setRow(id, { error: `Built, but it didn't start: ${(e as Error).message}` }));
}

function friendly(m: string) {
  if (/rate.?limit|usage limit|429|529|overloaded/i.test(m)) return "Claude's usage limit was reached for now. Ask for changes later to carry on.";
  if (/401|auth|token|log ?in/i.test(m)) return "Claude Code isn't signed in. Run claude setup-token and save the token in the Keychain as “Panel Claude Code token”.";
  return m;
}

function shellQuote(s: string) {
  return /^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

async function git(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(err.trim().split("\n").pop() || `git ${args[0]} failed`);
  return out.trim();
}

/** Where a folder the designer typed really is, kept to their own home. */
function folderOf(input: string) {
  const raw = input.trim().replace(/^~(?=$|\/)/, homedir());
  if (!raw) throw new Error("Choose the folder of the project to build in.");
  const dir = resolve(raw);
  const home = homedir();
  if (dir === home || !dir.startsWith(home + "/")) throw new Error("Pick a project folder inside your home folder (not your whole home folder).");
  if (dir.startsWith(LIBRARY_DIR)) throw new Error("That's Panel's own library; pick a project folder.");
  return dir;
}

/**
 * Hand a sketch to Claude Code. With a git repo, it works in a new checkout on a branch of
 * its own (panel/<sketch>), so nothing the designer has open changes. A folder that doesn't
 * exist yet is made, as a new git repo, for building from scratch.
 */
export async function startBuild(o: { project: string; sketch: string; folder: string; note?: string; actor?: "designer" | "assistant" }) {
  const p = findProject(o.project);
  if (!p) throw new Error("That project is gone.");
  const full = getProject(p.id)!;
  const node = full.nodes.find((n) => n.kind === "sketch" && (n.id === o.sketch || String(n.data.title ?? "").toLowerCase() === o.sketch.toLowerCase()));
  if (!node) throw new Error("That sketch isn't on the canvas.");
  const folder = folderOf(o.folder);
  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
    await git(folder, "init", "-q");
    await git(folder, "commit", "-q", "--allow-empty", "-m", "Start");
  } else if (!statSync(folder).isDirectory()) throw new Error("That's a file, not a folder.");

  const id = newId();
  const title = String(node.data.title || "Untitled sketch");
  const { version } = writeHandoff(p.id, node.id, o.note ?? "");

  // A branch of its own, in a checkout of its own, when it's a git repo with a commit.
  let workdir = folder;
  let branch: string | null = null;
  const top = await git(folder, "rev-parse", "--show-toplevel").catch(() => null);
  const head = top ? await git(top, "rev-parse", "--verify", "HEAD").catch(() => null) : null;
  if (top && head) {
    branch = `panel/${slug(title)}-${id.slice(0, 4)}`;
    workdir = join(BUILDS_DIR, id, basename(top));
    mkdirSync(join(BUILDS_DIR, id), { recursive: true });
    await git(top, "worktree", "add", "-q", "-b", branch, workdir, "HEAD");
    // The part of the repo the designer picked, if it's a subfolder (a monorepo's app).
    if (folder !== top) workdir = join(workdir, folder.slice(top.length + 1));
  }
  mkdirSync(join(BUILDS_DIR, id), { recursive: true });
  db.run(
    "INSERT INTO builds (id, project_id, sketch_id, version, title, folder, workdir, branch, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, ?)",
    [id, p.id, node.id, version, title, folder, workdir, branch, now(), now()],
  );
  remember(folder);

  // The card, beside the sketch it builds.
  const spot = buildSpot(full.nodes, node);
  apply(p.id, [
    { op: "add_node", node: { id: newId(), kind: "build", data: { build: id, title }, ...spot } },
  ], o.actor ?? "designer", { label: `Handed ${title} to Claude Code` });
  // The line from the sketch to it.
  const added = getProject(p.id)!.nodes.find((n) => n.kind === "build" && n.data.build === id);
  if (added) apply(p.id, [{ op: "add_edge", edge: { source: node.id, target: added.id } }], o.actor ?? "designer", { label: `Handed ${title} to Claude Code` });

  const port = freePort();
  setRow(id, { port });
  const prompt = `Build the direction in the hand-off: read HANDOFF.md in ${join(LIBRARY_DIR, "projects", p.id, "handoffs", `${node.id}-v${version}`)} and look at its pictures, then look at this codebase and build it here.${o.note?.trim() ? `\n\nThe designer adds: ${o.note.trim()}` : ""}`;
  void begin(id, prompt, port);
  return getBuild(id)!;
}

function buildSpot(nodes: BoardNode[], sketch: BoardNode) {
  const W = 380, H = 330;
  for (let i = 0; i < 20; i++) {
    const x = sketch.x, y = sketch.y + 300 + 70 + i * (H + 40);
    const hit = nodes.some((n) => n.x < x + W && n.x + 380 > x && n.y < y + H && n.y + 300 > y);
    if (!hit) return { x, y };
  }
  return { x: sketch.x + 420, y: sketch.y };
}

async function begin(id: string, prompt: string, port: number) {
  setRow(id, { status: "working", error: null, turns: (row(id)?.turns ?? 0) + 1 });
  try {
    await drive(id, prompt, port);
  } catch (e) {
    runs.delete(id);
    setRow(id, { status: "failed", error: (e as Error).message });
  }
}

/** Ask for changes: the same Claude Code session carries on. */
export function messageBuild(id: string, text: string) {
  const r = row(id);
  if (!r) throw new Error("That build is gone.");
  if (runs.has(id)) throw new Error("It's still working on the last request.");
  if (!text.trim()) throw new Error("Say what to change.");
  if (!existsSync(r.workdir)) throw new Error("Its folder is gone.");
  const steps: Step[] = JSON.parse(r.steps);
  steps.push({ kind: "plan", text: `Asked: ${text.trim().slice(0, 200)}` });
  setRow(id, { steps: JSON.stringify(steps), status: "working" });
  const port = r.port ?? freePort();
  void begin(id, `${text.trim()}\n\n(When you're done, end with the PANEL_PREVIEW line again, and a short summary of what changed.)`, port);
  return getBuild(id)!;
}

export function stopBuild(id: string) {
  const run = runs.get(id);
  if (!run) return false;
  run.stopped = true;
  if (run.sdk) {
    void run.sdk.q.interrupt().catch(() => {});
    const abort = run.sdk.abort;
    setTimeout(() => abort.abort(), 3000);
  }
  const proc = run.proc;
  proc?.kill();
  if (proc) setTimeout(() => proc.exitCode === null && proc.kill("SIGKILL"), 3000);
  return true;
}

// ---------- Seeing it run ----------

const servers = new Map<string, { proc: ReturnType<typeof Bun.spawn>; command: string; idle: ReturnType<typeof setTimeout> }>();
process.on("exit", () => {
  for (const s of servers.values()) s.proc.kill();
  for (const r of runs.values()) {
    r.proc?.kill();
    r.sdk?.abort.abort();
  }
});

async function answering(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.status < 500) return true;
    } catch {
      /* not yet */
    }
    await Bun.sleep(700);
  }
  return false;
}

/** Start what it built (or reuse it while it runs), and take its pictures. */
export async function startPreview(id: string, reshoot = true) {
  const r = row(id);
  if (!r?.preview) throw new Error("Claude Code didn't say how to run it.");
  const { command, url } = JSON.parse(r.preview) as { command: string; url: string };
  if (servers.has(id) && (servers.get(id)!.proc.exitCode !== null || servers.get(id)!.command !== command)) stopPreview(id);
  if (!servers.has(id)) {
    const log = Bun.file(join(BUILDS_DIR, id, "server.log"));
    const proc = Bun.spawn(["/bin/sh", "-c", command], {
      cwd: r.workdir,
      env: { ...process.env, PORT: String(r.port ?? ""), BROWSER: "none", FORCE_COLOR: "0" },
      stdout: log, stderr: log,
    });
    servers.set(id, { proc, command, idle: setTimeout(() => stopPreview(id), 45 * 60_000) });
  }
  if (!(await answering(url, 90_000))) {
    stopPreview(id);
    throw new Error(`nothing answered at ${url} within 90 seconds (its log is in ${join(BUILDS_DIR, id, "server.log")}).`);
  }
  if (reshoot) {
    const device = (getProject(r.project_id)?.nodes.find((n) => n.id === r.sketch_id)?.data.device as Device | undefined) ?? "desktop";
    const shot = await renderUrl(url, device, (i) => shotFile(id, i), 2);
    if (shot.failed) throw new Error(shot.failed);
    setRow(id, { shot_at: now() });
    lastRender.set(id, shot);
  }
  return getBuild(id)!;
}
const lastRender = new Map<string, Render>();

/** Commands Panel will start for a build: a dev server or static server, nothing chained. */
function servable(command: string) {
  const c = command.trim();
  if (!c || c.length > 300 || /[;&|`$<>(){}\\\n]/.test(c)) return false;
  const first = c.split(/\s+/).find((w) => !/^[A-Z_]+=\S*$/.test(w)) ?? "";
  return ["npm", "pnpm", "yarn", "bun", "bunx", "npx", "node", "vite", "next", "astro", "python3", "deno", "php", "ruby"].includes(first);
}

/**
 * Let Claude Code see what it built: Panel starts it (the command, in the build's folder),
 * waits for the page, and renders it. Only while the build is working, and only a dev or
 * static server command.
 */
export async function seeBuild(o: { build: string; command: string; url: string }) {
  const r = row(o.build);
  if (!r) throw new Error("No such build.");
  if (!runs.has(r.id)) throw new Error("That build isn't working right now.");
  if (!servable(o.command)) throw new Error("Panel only starts a dev or static server (npm run dev, npx vite --port N, python3 -m http.server N…), one command, nothing chained.");
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(o.url)) throw new Error("The url must be on this Mac: http://localhost:PORT/…");
  setRow(r.id, { preview: JSON.stringify({ command: o.command.trim(), url: o.url }) });
  await startPreview(r.id, true);
  const shot = lastRender.get(r.id)!;
  let log = "";
  try {
    log = (await Bun.file(join(BUILDS_DIR, r.id, "server.log")).text()).slice(-1500);
  } catch {
    /* no log */
  }
  return { render: shot, log };
}

export function stopPreview(id: string) {
  const s = servers.get(id);
  if (!s) return false;
  clearTimeout(s.idle);
  // The dev server and everything it started (npm starts node, node starts esbuild…).
  killTree(s.proc.pid);
  servers.delete(id);
  return true;
}

function killTree(pid: number) {
  const kids = (() => {
    try {
      const r = Bun.spawnSync(["pgrep", "-P", String(pid)]);
      return r.stdout.toString().split("\n").map(Number).filter(Boolean);
    } catch {
      return [];
    }
  })();
  for (const k of kids) killTree(k);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

export function buildShot(id: string) {
  const f = shotFile(id);
  return existsSync(f) ? f : null;
}

// ---------- Folders the designer builds in ----------

function remember(folder: string) {
  const list = recentFolders().filter((f) => f !== folder);
  setSetting("build_folders", JSON.stringify([folder, ...list].slice(0, 8)));
}

export function recentFolders(): string[] {
  try {
    return (JSON.parse(getSetting("build_folders") ?? "[]") as string[]).filter((f) => existsSync(f));
  } catch {
    return [];
  }
}

/** Folders that look like code projects, for the hand-off picker: the recent ones, then the likely ones. */
export function folderSuggestions() {
  const home = homedir();
  const seen = new Set<string>(recentFolders());
  const found: string[] = [];
  for (const base of ["Desktop", "Developer", "Projects", "Code", "code", "dev", "src", "Sites", "Documents/GitHub", "GitHub"].map((b) => join(home, b))) {
    if (!existsSync(base)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(base);
    } catch {
      continue;
    }
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const d = join(base, n);
      try {
        if (!statSync(d).isDirectory()) continue;
        if (existsSync(join(d, ".git")) || existsSync(join(d, "package.json"))) if (!seen.has(d)) found.push(d);
      } catch {
        /* unreadable */
      }
      if (found.length > 40) break;
    }
  }
  return { recent: recentFolders(), found: found.slice(0, 40), home };
}
