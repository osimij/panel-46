// The assistant: a conversation about the library, answered by Claude through Claude Code
// (your plan, not API money), with Panel's own MCP tools. Each turn streams to the app as
// small events; the app can leave and come back mid-answer and pick up where it was.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { db, getSetting, newId, now, setSetting } from "./db.ts";
import { LIBRARY_DIR, PORT } from "./config.ts";
import { load, type Doc } from "./library.ts";
import { findProject } from "./projects.ts";
import { claudeBinary, claudeToken, settings as readSettings, type Effort } from "./read.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  -- user: what they typed · assistant: '' (the answer lives in parts)
  text TEXT NOT NULL DEFAULT '',
  -- user: what they were looking at, as JSON { open?: id }
  context TEXT,
  -- assistant: the answer as JSON parts (text, tool calls, thinking), in order
  parts TEXT,
  -- assistant: streaming · done · stopped · error
  status TEXT NOT NULL DEFAULT 'done',
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat_id, created_at);
`);
// An answer that was streaming when Panel stopped won't finish now.
db.run("UPDATE chat_messages SET status = 'stopped' WHERE status = 'streaming'");

const CHAT_DIR = join(LIBRARY_DIR, "chat");
mkdirSync(CHAT_DIR, { recursive: true });

export const chatSettings = {
  model: () => getSetting("chat_model") ?? readSettings.model(),
  effort: () => (getSetting("chat_effort") ?? "high") as Effort,
};

// ---------- What a message is ----------

export type Part =
  | { type: "text"; text: string }
  | { type: "thinking"; ms?: number; done?: boolean }
  | {
      type: "tool";
      id: string;
      name: string;
      input?: Record<string, unknown>;
      /** Saves the tool came back with, in its order. */
      refs?: string[];
      total?: number;
      error?: string;
      done?: boolean;
    };

export type ChatEvent =
  | { t: "start"; message: MessageOut }
  | { t: "thinking"; on: boolean; ms?: number }
  | { t: "tool"; id: string; name: string }
  | { t: "tool_input"; id: string; input: Record<string, unknown>; partial?: boolean }
  | { t: "tool_result"; id: string; refs: string[]; cards: Card[]; total?: number; error?: string }
  | { t: "text"; delta: string }
  | { t: "title"; title: string }
  | { t: "done"; status: "done" | "stopped" | "error"; error?: string };

export interface MessageOut {
  id: string;
  role: "user" | "assistant";
  text: string;
  context: { open?: string } | null;
  parts: Part[];
  status: string;
  error: string | null;
  created_at: string;
}

interface Row {
  id: string; chat_id: string; role: "user" | "assistant"; text: string; context: string | null;
  parts: string | null; status: string; error: string | null; created_at: string;
}

const out = (r: Row): MessageOut => ({
  id: r.id, role: r.role, text: r.text,
  context: r.context ? JSON.parse(r.context) : null,
  parts: r.parts ? JSON.parse(r.parts) : [],
  status: r.status, error: r.error, created_at: r.created_at,
});

// ---------- Cards: what the app needs to draw a save it hasn't loaded ----------

export interface Card {
  id: string;
  title: string;
  type: string;
  thumb: string | null;
  /** Height over width of the thumbnail. */
  ratio: number;
  palette: string[];
  by?: string;
}

function cardOf(d: Doc): Card {
  const m = d.media[0];
  const path = d.r.person ? d.r.avatar_path ?? m?.thumb_path : m?.thumb_path ?? d.r.preview_path ?? d.r.avatar_path;
  const ratio = d.r.site ? 0.625 : m?.width && m.height ? m.height / m.width : 0.75;
  const p = d.profile;
  return {
    id: d.r.id,
    title: (d.r.title || p?.summary?.split(/(?<=\.)\s/)[0] || d.r.source_url || "Untitled").replace(/\s+/g, " ").trim(),
    type: d.type,
    thumb: path ? `/media/${path}` : null,
    ratio: Math.min(Math.max(ratio, 0.5), 1.6),
    palette: d.palette.filter((s) => s.share >= 0.04).slice(0, 5).map((s) => s.hex),
    by: d.r.creator_name || (d.r.creator_handle ? `@${d.r.creator_handle}` : undefined),
  };
}

export function cards(ids: string[]): Card[] {
  const { docs } = load();
  return ids.flatMap((id) => {
    const d = docs.get(id);
    return d ? [cardOf(d)] : [];
  });
}

// ---------- Chats ----------

export function listChats() {
  return db
    .query<{ id: string; title: string; updated_at: string; n: number }, []>(
      `SELECT c.id, c.title, c.updated_at, (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) n
       FROM chats c ORDER BY c.updated_at DESC LIMIT 200`,
    )
    .all()
    .filter((c) => c.n > 0)
    .map((c) => ({ id: c.id, title: c.title || "New conversation", updated_at: c.updated_at, running: runs.has(c.id) }));
}

export function createChat() {
  const id = newId();
  db.run("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, '', ?, ?)", [id, now(), now()]);
  return { id };
}

export function getChat(id: string) {
  const chat = db.query<{ id: string; title: string }, [string]>("SELECT id, title FROM chats WHERE id = ?").get(id);
  if (!chat) return null;
  const rows = db.query<Row, [string]>("SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at, rowid").all(id).map(out);
  const run = runs.get(id);
  // While it's answering, the answer's parts come from memory: they're ahead of the database.
  if (run) for (const m of rows) if (m.id === run.messageId) Object.assign(m, { parts: run.parts, status: "streaming" });
  const ids = new Set<string>();
  for (const m of rows) {
    for (const p of m.parts) if (p.type === "tool") p.refs?.forEach((r) => ids.add(r));
    for (const p of m.parts) if (p.type === "text") for (const x of p.text.matchAll(/\[\[([0-9a-f]{16})\]\]/g)) ids.add(x[1]!);
    if (m.context?.open) ids.add(m.context.open);
  }
  return { id: chat.id, title: chat.title, messages: rows, cards: cards([...ids]), running: !!run, seq: run?.events.length ?? 0 };
}

export function deleteChat(id: string) {
  stop(id);
  db.run("DELETE FROM chats WHERE id = ?", [id]);
}

// ---------- Running a turn ----------

interface Run {
  messageId: string;
  parts: Part[];
  events: ChatEvent[];
  listeners: Set<(e: ChatEvent, seq: number) => void>;
  proc: ReturnType<typeof Bun.spawn> | null;
  stopped: boolean;
}
const runs = new Map<string, Run>();

const SYSTEM = `You are the assistant inside Panel, a designer's private library of saved design references: websites, app screens, posters, brands, motion pieces, photos. You talk with the designer while they browse. Use the panel tools to find, look at and combine their saves. Never invent a save.

How the app shows your answer:
- Write a save as [[id]] (its 16-character id) wherever you mention it. The app turns that into the save's name with a thumbnail, so don't repeat its title next to it, and never write links or URLs.
- To show several saves as a row of pictures, put their [[id]]s together on a line of their own.
- Plain markdown: short paragraphs, **bold**, lists. A heading only when the answer is long. No emoji, no tables.

How to work:
- Search before you say anything about the library. If results are thin, try other words or a facet, since search matches words, not meaning.
- Look at the pictures (get_reference) before you recommend a save for how it looks, when that matters.
- Talk like a design partner: concrete about color (hex), type, layout and motion, and say what to take from each save. Keep it short; the pictures do the rest.
- When the designer wants to keep a set, use save_to_collection.
- A message can start with <panel-context>, saying what the designer has open. "This" or "it" means that save.

On a project's canvas (the context says which project):
- Read the project with get_project before anything else in the conversation, and again when the designer may have changed it. Its brief and materials (files and links the designer added: a spec, a brand book, the old site) say what the project is and who it's for; read the ones that matter for the question with get_project_material, and let them shape what you look for.
- When they ask for references, always put them on the canvas with place_on_board, under the topic they're for (it makes the topic if needed; use after_topic to connect it to the one before, e.g. Color after a locked Typography). Place 4 to 8, the strongest first, each with a short why. Build on what's locked: a color search should suit the chosen type.
- Then answer in a few lines: what you placed and the thinking behind the set, naming a save as [[id]] only where you say something particular about it. Don't repeat them all as a row of pictures; they're on the canvas.
- Never choose, rule out or lock on your own. Use mark_saves and lock_topic only when the designer says so ("lock it with the second one"). When they give a reason, keep it with add_note.`;

function emit(chatId: string, run: Run, e: ChatEvent) {
  run.events.push(e);
  const seq = run.events.length;
  for (const l of run.listeners) l(e, seq);
}

function persist(run: Run, status = "streaming", error: string | null = null) {
  db.run("UPDATE chat_messages SET parts = ?, status = ?, error = ? WHERE id = ?", [JSON.stringify(run.parts), status, error, run.messageId]);
}

/** Ids a tool's answer mentions, in order: the saves it came back with. */
function idsIn(text: string) {
  return [...new Set([...text.matchAll(/"id":"([0-9a-f]{16})"/g)].map((m) => m[1]!))];
}

/** The words a tool is working with, read out of its input while it's still being written. */
function partialInput(json: string): Record<string, unknown> {
  const found: Record<string, unknown> = {};
  for (const key of ["query", "brief", "name", "id"]) {
    const m = json.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (m) found[key] = m[1]!.replace(/\\"/g, '"');
  }
  return found;
}

export async function send(chatId: string, text: string, context: { open?: string; project?: string } = {}) {
  const chat = db.query<{ id: string; title: string; session_id: string | null }, [string]>("SELECT id, title, session_id FROM chats WHERE id = ?").get(chatId);
  if (!chat) throw new Error("That conversation is gone.");
  if (runs.has(chatId)) throw new Error("Still answering the last message.");
  const clean = text.trim();
  if (!clean) throw new Error("Write something first.");

  const ts = now();
  const userId = newId();
  db.run("INSERT INTO chat_messages (id, chat_id, role, text, context, status, created_at) VALUES (?, ?, 'user', ?, ?, 'done', ?)", [
    userId, chatId, clean, context.open ? JSON.stringify({ open: context.open }) : null, ts,
  ]);
  const messageId = newId();
  db.run("INSERT INTO chat_messages (id, chat_id, role, parts, status, created_at) VALUES (?, ?, 'assistant', '[]', 'streaming', ?)", [messageId, chatId, now()]);
  db.run("UPDATE chats SET updated_at = ?, title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?", [
    now(), clean.replace(/\s+/g, " ").slice(0, 80), chatId,
  ]);

  const run: Run = { messageId, parts: [], events: [], listeners: new Set(), proc: null, stopped: false };
  runs.set(chatId, run);
  const message = out(db.query<Row, [string]>("SELECT * FROM chat_messages WHERE id = ?").get(messageId)!);
  emit(chatId, run, { t: "start", message });

  let prompt = clean;
  const said: string[] = [];
  if (context.project) {
    const p = findProject(context.project);
    if (p) said.push(`The designer is on the canvas of the project “${p.name}” (id ${p.id}). References you find for it go on the canvas (place_on_board).`);
  }
  if (context.open) {
    const d = load().docs.get(context.open);
    if (d) said.push(`The designer has [[${d.r.id}]] open (${cardOf(d).title}).`);
  }
  if (said.length) prompt = `<panel-context>${said.join(" ")}</panel-context>\n\n${clean}`;
  void drive(chatId, run, chat.session_id, prompt).catch((e) => finish(chatId, run, "error", (e as Error).message));
  // A short name for a new conversation, made alongside the answer.
  if (!chat.title) void nameChat(chatId, clean, run);
  return { user: out(db.query<Row, [string]>("SELECT * FROM chat_messages WHERE id = ?").get(userId)!), assistant: message };
}

/** Two to five words for the conversation, from a small fast model, in the background. */
async function nameChat(chatId: string, first: string, run: Run) {
  try {
    const bin = await claudeBinary();
    if (!bin) return;
    const token = await claudeToken();
    const proc = Bun.spawn(
      [
        bin, "-p", `Name this conversation:\n\n${first.slice(0, 600)}`,
        "--model", "claude-haiku-5-5", "--effort", "low", "--output-format", "json",
        "--system-prompt",
        "You name a designer's conversations with their design-reference library. Answer with only a title of 2 to 5 words in sentence case: the subject, not the request (\"Dark technical type\", \"One-accent palettes\", \"Calm banking app\"). No quotes, no period.",
        "--tools", "", "--setting-sources", "", "--no-session-persistence", "--strict-mcp-config",
      ],
      {
        cwd: CHAT_DIR,
        env: { HOME: process.env.HOME ?? "", USER: process.env.USER ?? "", PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`, ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) },
        stdout: "pipe", stderr: "pipe",
      },
    );
    const timer = setTimeout(() => proc.kill(), 45_000);
    const text = await new Response(proc.stdout).text();
    clearTimeout(timer);
    const res = JSON.parse(text) as { result?: string; is_error?: boolean };
    const title = (res.result ?? "").split("\n")[0]!.replace(/^["'“”]+|["'“”.]+$/g, "").trim().slice(0, 60);
    if (res.is_error || !title || title.split(/\s+/).length > 8) return;
    db.run("UPDATE chats SET title = ? WHERE id = ?", [title, chatId]);
    if (runs.get(chatId) === run) emit(chatId, run, { t: "title", title });
  } catch {
    /* the first words of the message stay the title */
  }
}

function finish(chatId: string, run: Run, status: "done" | "stopped" | "error", error?: string) {
  if (runs.get(chatId) !== run) return;
  // A thinking or tool part left open (stopped mid-way) is closed, so it doesn't spin forever.
  for (const p of run.parts) if ((p.type === "thinking" || p.type === "tool") && !p.done) p.done = true;
  persist(run, status, error ?? null);
  db.run("UPDATE chats SET updated_at = ? WHERE id = ?", [now(), chatId]);
  emit(chatId, run, { t: "done", status, error });
  runs.delete(chatId);
}

async function drive(chatId: string, run: Run, sessionId: string | null, prompt: string) {
  const bin = await claudeBinary();
  if (!bin) throw new Error("The claude command line isn't installed, so the assistant can't answer.");
  const token = await claudeToken();
  const mcp = JSON.stringify({ mcpServers: { panel: { type: "http", url: `http://127.0.0.1:${PORT}/mcp` } } });
  const args = [
    bin, "-p", prompt,
    "--model", chatSettings.model(), "--effort", chatSettings.effort(),
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--system-prompt", SYSTEM,
    "--tools", "", "--mcp-config", mcp, "--strict-mcp-config", "--allowedTools", "mcp__panel",
    "--setting-sources", "",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const proc = Bun.spawn(args, {
    cwd: CHAT_DIR,
    env: { HOME: process.env.HOME ?? "", USER: process.env.USER ?? "", PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`, ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) },
    stdout: "pipe", stderr: "pipe",
  });
  run.proc = proc;
  if (run.stopped) proc.kill();

  // Per content block: what kind it is, and a tool's input as it's written.
  const blocks = new Map<number, { kind: string; toolId?: string; json?: string; started?: number }>();
  const lastPart = () => run.parts.at(-1);
  let resultError: string | null = null;
  let gotResult = false;
  let lastSave = 0;

  const handle = (d: any) => {
    // Stopped: whatever is still on its way out is dropped.
    if (run.stopped) return;
    if (d.type === "system" && d.subtype === "init" && d.session_id) {
      db.run("UPDATE chats SET session_id = ? WHERE id = ?", [d.session_id, chatId]);
      return;
    }
    if (d.type === "stream_event") {
      const e = d.event;
      if (e.type === "content_block_start") {
        const b = e.content_block;
        if (b.type === "thinking" || b.type === "redacted_thinking") {
          blocks.set(e.index, { kind: "thinking", started: Date.now() });
          const last = lastPart();
          if (!(last?.type === "thinking" && !last.done)) run.parts.push({ type: "thinking" });
          emit(chatId, run, { t: "thinking", on: true });
        } else if (b.type === "tool_use") {
          blocks.set(e.index, { kind: "tool", toolId: b.id, json: "" });
          run.parts.push({ type: "tool", id: b.id, name: String(b.name).replace(/^mcp__panel__/, "") });
          emit(chatId, run, { t: "tool", id: b.id, name: String(b.name).replace(/^mcp__panel__/, "") });
        } else blocks.set(e.index, { kind: b.type });
      } else if (e.type === "content_block_delta") {
        const b = blocks.get(e.index);
        if (e.delta.type === "text_delta" && e.delta.text) {
          const last = lastPart();
          if (last?.type === "text") last.text += e.delta.text;
          else run.parts.push({ type: "text", text: e.delta.text });
          emit(chatId, run, { t: "text", delta: e.delta.text });
          if (Date.now() - lastSave > 1500) {
            lastSave = Date.now();
            persist(run);
          }
        } else if (e.delta.type === "input_json_delta" && b?.kind === "tool") {
          b.json += e.delta.partial_json ?? "";
          const input = partialInput(b.json!);
          if (Object.keys(input).length) {
            const part = run.parts.find((p) => p.type === "tool" && p.id === b.toolId);
            if (part && part.type === "tool") part.input = { ...part.input, ...input };
            emit(chatId, run, { t: "tool_input", id: b.toolId!, input, partial: true });
          }
        }
      } else if (e.type === "content_block_stop") {
        const b = blocks.get(e.index);
        if (b?.kind === "thinking") {
          const part = [...run.parts].reverse().find((p) => p.type === "thinking");
          const ms = Date.now() - (b.started ?? Date.now());
          if (part && part.type === "thinking") Object.assign(part, { done: true, ms: (part.ms ?? 0) + ms });
          emit(chatId, run, { t: "thinking", on: false, ms });
        }
      }
      return;
    }
    if (d.type === "assistant") {
      for (const c of d.message?.content ?? []) {
        if (c.type !== "tool_use") continue;
        const part = run.parts.find((p) => p.type === "tool" && p.id === c.id);
        if (part && part.type === "tool") part.input = c.input;
        emit(chatId, run, { t: "tool_input", id: c.id, input: c.input });
      }
      return;
    }
    if (d.type === "user") {
      for (const c of d.message?.content ?? []) {
        if (c.type !== "tool_result") continue;
        const text = (Array.isArray(c.content) ? c.content : [{ type: "text", text: String(c.content ?? "") }])
          .filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n");
        const part = run.parts.find((p) => p.type === "tool" && p.id === c.tool_use_id);
        const refs = c.is_error ? [] : idsIn(text);
        let total: number | undefined;
        try {
          const j = JSON.parse(text);
          if (typeof j.total === "number") total = j.total;
        } catch {
          /* get_reference answers with several blocks; no total there */
        }
        const error = c.is_error ? text.slice(0, 300) : undefined;
        if (part && part.type === "tool") Object.assign(part, { refs, total, error, done: true });
        emit(chatId, run, { t: "tool_result", id: c.tool_use_id, refs, cards: cards(refs), total, error });
      }
      persist(run);
      return;
    }
    if (d.type === "result") {
      gotResult = true;
      if (d.is_error) resultError = String(d.result || d.subtype || "Claude couldn't answer.").slice(0, 400);
      const u = d.usage;
      if (u) {
        db.run(
          "INSERT INTO ai_usage (at, ref_id, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost) VALUES (?, NULL, ?, 'chat', ?, ?, ?, ?, 0)",
          [now(), chatSettings.model(), u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0],
        );
      }
    }
  };

  // stdout is one JSON object per line.
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
      try {
        handle(JSON.parse(line));
      } catch (e) {
        console.error("Chat: couldn't use a line from Claude Code:", (e as Error).message);
      }
    }
  }
  const code = await proc.exited;
  const stderr = (await errText).trim();

  if (run.stopped) return;
  // A conversation whose saved session is gone (cleared by Claude Code) starts over quietly.
  const lost = (m: string) => /session|conversation/i.test(m) && /not found|no conversation|invalid|does not exist/i.test(m);
  if (sessionId && run.parts.length === 0 && (lost(stderr) || lost(resultError ?? ""))) {
    db.run("UPDATE chats SET session_id = NULL WHERE id = ?", [chatId]);
    return drive(chatId, run, null, prompt);
  }
  if (resultError) return finish(chatId, run, "error", friendly(resultError));
  if (!gotResult) return finish(chatId, run, "error", friendly(stderr.split("\n").pop() || `Claude Code stopped (code ${code}).`));
  finish(chatId, run, "done");
}

function friendly(m: string) {
  if (/rate.?limit|usage limit|429|529|overloaded/i.test(m)) return "Claude's usage limit was reached for now. Try again in a little while.";
  if (/401|auth|token|log ?in/i.test(m)) return "Claude Code isn't signed in. Run claude setup-token and save the token in the Keychain as “Panel Claude Code token”.";
  return m;
}

export function stop(chatId: string) {
  const run = runs.get(chatId);
  if (!run) return false;
  run.stopped = true;
  const proc = run.proc;
  proc?.kill();
  // If it doesn't go quietly, it goes.
  if (proc) setTimeout(() => proc.exitCode === null && proc.kill("SIGKILL"), 3000);
  // The answer ends now, as far as anyone can see; the process winds down on its own.
  finish(chatId, run, "stopped");
  return true;
}

/**
 * The live answer as server-sent events, from event `after` on. Ends when the answer does.
 * With nothing running, it says so and ends.
 */
export function follow(chatId: string, after: number, signal: AbortSignal) {
  const enc = new TextEncoder();
  const line = (e: ChatEvent | { t: "idle" }, seq: number) => enc.encode(`id: ${seq}\ndata: ${JSON.stringify(e)}\n\n`);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const run = runs.get(chatId);
      if (!run) {
        controller.enqueue(line({ t: "idle" }, after));
        controller.close();
        return;
      }
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        run.listeners.delete(listener);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };
      const listener = (e: ChatEvent, seq: number) => {
        if (closed) return;
        controller.enqueue(line(e, seq));
        if (e.t === "done") close();
      };
      run.events.slice(after).forEach((e, i) => controller.enqueue(line(e, after + i + 1)));
      if (run.events.at(-1)?.t === "done") return close();
      run.listeners.add(listener);
      // Keeps the connection open through long thinking (the server drops idle ones).
      const ping = setInterval(() => !closed && controller.enqueue(enc.encode(": ping\n\n")), 15_000);
      signal.addEventListener("abort", close);
    },
  });
}

export function setChatSettings(patch: { model?: string; effort?: string }) {
  if (patch.model) setSetting("chat_model", patch.model);
  if (patch.effort && ["low", "medium", "high", "xhigh", "max"].includes(patch.effort)) setSetting("chat_effort", patch.effort);
}
