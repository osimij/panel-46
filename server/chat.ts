// The assistant: a conversation about the library, answered by Claude through Claude Code
// (your plan, not API money), with Panel's own MCP tools. Each turn streams to the app as
// small events; the app can leave and come back mid-answer and pick up where it was.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { db, getSetting, newId, now, setSetting } from "./db.ts";
import { createSdkMcpServer, query, tool, type McpServerConfig, type Query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { LIBRARY_DIR, PORT } from "./config.ts";
import { load, type Doc } from "./library.ts";
import { describeSelection, findProject } from "./projects.ts";
import { materialsForSummary } from "./materials.ts";
import { designRules } from "./rules.ts";
import { partialHtml } from "./partial.ts";
import { claudeBinary, claudeToken, type Effort } from "./read.ts";

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
// Added in place, empty for older conversations.
const chatCols = db.query<{ name: string }, []>("PRAGMA table_info(chats)").all().map((c) => c.name);
// Which project's card this conversation was given, and which version of it (see projectCard).
if (!chatCols.includes("card_project")) db.exec("ALTER TABLE chats ADD COLUMN card_project TEXT");
if (!chatCols.includes("card_hash")) db.exec("ALTER TABLE chats ADD COLUMN card_hash TEXT");
// How full the conversation is after its last answer, and where Claude Code summarizes it.
if (!chatCols.includes("context_tokens")) db.exec("ALTER TABLE chats ADD COLUMN context_tokens INTEGER");
if (!chatCols.includes("context_limit")) db.exec("ALTER TABLE chats ADD COLUMN context_limit INTEGER");
// An answer that was streaming when Panel stopped won't finish now.
db.run("UPDATE chat_messages SET status = 'stopped' WHERE status = 'streaming'");

const CHAT_DIR = join(LIBRARY_DIR, "chat");
mkdirSync(CHAT_DIR, { recursive: true });

// ---------- Which model answers, and how hard it thinks ----------

/** The models the designer can pick for FRIDAY, best taste first. */
export const CHAT_MODELS = [
  { id: "claude-fable-5-2", name: "Fable 5.2", note: "The best eye and judgment. Slower, and uses more of your plan." },
  { id: "claude-opus-5-5", name: "Opus 5.5", note: "Strong all round and quicker. Good at making things." },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", note: "Fast, for everyday asks." },
  { id: "claude-haiku-5-5", name: "Haiku 5.5", note: "Fastest, for small things." },
] as const;
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const isModel = (v: string | null | undefined): v is string => !!v && CHAT_MODELS.some((m) => m.id === v);
const isEffort = (v: string | null | undefined): v is Effort => !!v && (EFFORTS as string[]).includes(v);
export const modelName = (id: string) => CHAT_MODELS.find((m) => m.id === id)?.name ?? id;

/**
 * How FRIDAY works. "solo": one model does everything. "duo": one model (Fable by default)
 * reads, looks and decides, and writes a plan; a second (Opus) carries the plan out.
 */
export const chatSettings = {
  mode: () => (getSetting("chat_mode") === "duo" ? "duo" : "solo") as "solo" | "duo",
  model: () => { const v = getSetting("chat_model"); return isModel(v) ? v : "claude-opus-5-5"; },
  effort: () => { const v = getSetting("chat_effort"); return isEffort(v) ? v : "high"; },
  planModel: () => { const v = getSetting("chat_plan_model"); return isModel(v) ? v : "claude-fable-5-2"; },
  planEffort: () => { const v = getSetting("chat_plan_effort"); return isEffort(v) ? v : "high"; },
  buildModel: () => { const v = getSetting("chat_build_model"); return isModel(v) ? v : "claude-opus-5-5"; },
  buildEffort: () => { const v = getSetting("chat_build_effort"); return isEffort(v) ? v : "high"; },
  all: () => ({
    mode: chatSettings.mode(),
    model: chatSettings.model(), effort: chatSettings.effort(),
    plan_model: chatSettings.planModel(), plan_effort: chatSettings.planEffort(),
    build_model: chatSettings.buildModel(), build_effort: chatSettings.buildEffort(),
    models: CHAT_MODELS,
  }),
};

export function setChatSettings(patch: Record<string, unknown>) {
  const str = (k: string) => (typeof patch[k] === "string" ? (patch[k] as string) : null);
  if (str("mode") === "solo" || str("mode") === "duo") setSetting("chat_mode", str("mode")!);
  for (const [k, key] of [["model", "chat_model"], ["plan_model", "chat_plan_model"], ["build_model", "chat_build_model"]] as const) if (isModel(str(k))) setSetting(key, str(k)!);
  for (const [k, key] of [["effort", "chat_effort"], ["plan_effort", "chat_plan_effort"], ["build_effort", "chat_build_effort"]] as const) if (isEffort(str(k))) setSetting(key, str(k)!);
}

// ---------- What a message is ----------

export type Part =
  | { type: "text"; text: string }
  /** The conversation was summarized here to make room (Claude Code's compaction). */
  | { type: "compact"; pre: number; post?: number; done: true; model?: string }
  /** `model`: which model did it, when two work on one answer (plan, then build). */
  | { type: "thinking"; ms?: number; done?: boolean; model?: string }
  | {
      type: "tool";
      model?: string;
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
  | { t: "thinking"; on: boolean; ms?: number; model?: string }
  | { t: "tool"; id: string; name: string; model?: string }
  | { t: "tool_input"; id: string; input: Record<string, unknown>; partial?: boolean }
  | { t: "tool_result"; id: string; refs: string[]; cards: Card[]; total?: number; error?: string }
  // A sketch's page as written so far, while Claude is still writing it: the app shows it taking shape.
  | { t: "draft"; id: string; html: string }
  | { t: "text"; delta: string }
  | { t: "compact"; pre: number; post?: number }
  /** How full the conversation is now, in tokens, and where it gets summarized. */
  | { t: "context"; used: number; limit: number }
  | { t: "title"; title: string }
  | { t: "done"; status: "done" | "stopped" | "error"; error?: string };

export interface MessageOut {
  id: string;
  role: "user" | "assistant";
  text: string;
  context: { open?: string; nodes?: string[]; label?: string; thumbs?: string[]; pointed?: string } | null;
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
  const chat = db.query<{ id: string; title: string; context_tokens: number | null; context_limit: number | null }, [string]>("SELECT id, title, context_tokens, context_limit FROM chats WHERE id = ?").get(id);
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
  return {
    id: chat.id, title: chat.title, messages: rows, cards: cards([...ids]), running: !!run, seq: run?.events.length ?? 0,
    context: chat.context_tokens && chat.context_limit ? { used: chat.context_tokens, limit: chat.context_limit } : null,
  };
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
  /** With the Agent SDK: the turn (or the turns, when alternates are made side by side), to interrupt. */
  sdks: Set<{ q: Query; abort: AbortController }>;
  stopped: boolean;
  /** The project card given with this message, marked as given once the answer is done. */
  card?: { project: string; hash: string };
  /** The card to give again if Claude Code summarizes the conversation during this answer. */
  keep?: string;
}
const runs = new Map<string, Run>();

const SYSTEM = `You are FRIDAY, the assistant inside Panel (the designer named you after Tony Stark's AI), a designer's private library of saved design references: websites, app screens, posters, brands, motion pieces, photos. You talk with the designer while they browse. Use the panel tools to find, look at and combine their saves. Never invent a save.

How the app shows your answer:
- Write a save as [[id]] (its 16-character id) wherever you mention it. The app turns that into the save's name with a thumbnail, so don't repeat its title next to it, and never write links or URLs.
- To show several saves as a row of pictures, put their [[id]]s together on a line of their own.
- Plain markdown: short paragraphs, **bold**, lists. A heading only when the answer is long. No emoji, no tables.

How to work:
- Search before you say anything about the library. Search finds by words and by meaning, and by look when you describe one (look: "a dark dashboard with glowing charts"); found_by in its answer says which were used. If it says only "words", or results are thin, try other words or a facet.
- Look at the pictures (get_reference) before you recommend a save for how it looks, when that matters.
- Talk like a design partner: concrete about color (hex), type, layout and motion, and say what to take from each save. Keep it short; the pictures do the rest.
- When the designer wants to keep a set, use save_to_collection.
- A message can start with <panel-context>, saying what the designer has open. "This" or "it" means that save.
- When the designer wants a brief or prompt to hand to Claude Code (or anyone) to build from, include their rules in full under their own heading, and tell the builder to check the result against them before showing it.

On a project's canvas (the context says which project):
- The first message of the conversation brings the project card: what the project is, in the designer's words, and what each of its materials (a spec, a brand book, the old site) says, summarized. It holds for the whole conversation, and comes again if it changes. Let it shape what you look for and make. For a detail the card doesn't give (a screen, a term, a requirement), look it up in the material with get_project_material and find, in the document's own language, rather than reading it from the start.
- Read the canvas with get_project before anything else in the conversation, and again when the designer may have changed it: the decisions, the saves chosen and ruled out, the sketches.
- When they ask for references, always put them on the canvas with place_on_board, under the topic they're for (it makes the topic if needed; use after_topic to connect it to the one before, e.g. Color after a locked Typography). Place 4 to 8, the strongest first, each with a short why. Build on what's locked: a color search should suit the chosen type.
- Then answer in a few lines: what you placed and the thinking behind the set, naming a save as [[id]] only where you say something particular about it. Don't repeat them all as a row of pictures; they're on the canvas.
- Never choose, rule out or lock on your own. Use mark_saves and lock_topic only when the designer says so ("lock it with the second one"). When they give a reason, keep it with add_note.
- The designer's reasons for choosing and ruling out are their taste. They're in get_project (designer_reason) and, across every project, in get_verdicts: read it before you suggest or sketch for a project, and don't bring back what they turned down for the same reason. When one reason has come up 3 times or more and their rules don't say it yet, tell them once and offer a line for unugly.md in their own words. They add it; you don't.

Sketches (on a project's canvas):
- When the designer wants to see how something could look ("sketch the hero", "try it with the stamp", "show me three directions"), make it with make_sketch: one self-contained page that shows the idea, not a whole site. Make it from what's settled: the locked decisions, their chosen saves (look at them first), the brief and materials. Use real content in the project's language, never lorem ipsum.
- Hang it from what it came from (from: the topic, save or sketch). For several directions, make one sketch each, from the same thing, each with a short title and a tries line that says how it differs.
- Look at the pictures that come back before you answer. Check them against the designer's rules and the brief: corners, buttons, type (Cyrillic set in real text), anything physical looking real, no slop. Fix what's off with edit_sketch, then look again. Only then reply.
- The answer also carries rule_checks: what Panel measured in the page against the rules (plain corners, a letter-spaced name in the navbar, a font missing Cyrillic or Tajik letters, the signs of generic design). Fix every one marked "breaks". For each marked "check", take it out, or keep it and say in your reply why it earns its place. They can't judge taste, so your own look still counts.
- Reply in a few lines: what it tries and what you'd look at. Don't paste its HTML or describe it at length; it's on the canvas. Say plainly what it doesn't do yet.
- Changes to a sketch go through edit_sketch with small edits (exact find and replace). To keep a version and try something else, make a new sketch from it instead.
- When the designer has a sketch selected, "this" means it: read it with get_sketch if you haven't seen it in this conversation.
- Give every sketch knobs: declare its colors, fonts, type sizes, corner radius and spacing as CSS variables on :root and use them everywhere in place of fixed values (--bg, --surface, --ink, --muted, --accent, --font-display, --font-text, --radius, --space, and whatever else the page needs). The designer changes them live in the studio (Knobs) and tries palettes from their saves on them, without asking you. They also edit words in place, right in the page. When they kept a change that way, the next version you read has their values and their words: build on them, don't put yours back. Keep words in the HTML itself (not built by a script) where you can, so they can edit them.
- Pass uses: the ids of the saves it takes from (type from one, color from another), so lines on the canvas show where it came from.
- Make it something they can click through, not a picture: buttons, tabs, menus and forms that work. A flow of screens or its states (empty, loading, error, success) go in one sketch: list them in <meta name="panel:states" content="home: Главная, detail: Детали, error: Ошибка"> (a Latin id, then the name shown) and show each when the address ends in #id (#detail, #error; the first shows with no #), switching on hashchange; buttons between screens set location.hash. The studio shows these as a map they can jump around. Check the other states with get_sketch state.
- A mobile app screen is made for a phone: device "phone" (390×844). To check a desktop sketch on a phone, get_sketch with device.
- "Alternates" or "other versions" of a sketch: new sketches from it (from: its id), not edits to it.

The studio (a sketch opened full size): the designer clicks through the live sketch, switches phone/desktop and states, and points at a part to change it. The context then gives that part's CSS path, text and HTML: change only that part.

Building it for real:
- When the designer has chosen a sketch and wants it built, it goes to Claude Code, which builds it in their code. The studio has a "Build with Claude Code" button for that. If they ask you to and name the folder, use start_build; if they don't name one, ask which folder, or point them at the button.
- A build card on the canvas is Claude Code working. get_build says how it's going and what it said. To change the built version, message_build passes the request on, in the designer's words plus what you know (what they pointed at, the sketch). Report back in a line or two; the card shows the rest.`;

/** The instructions for a turn: Panel's, then the designer's rules, read fresh so edits apply to the next message. */
export function systemPrompt() {
  const rules = designRules();
  if (!rules) return SYSTEM;
  return `${SYSTEM}

The designer's rules (unugly.md) hold for everything you suggest, place, judge or write. They outrank any reference: take from a save only what passes them (a letter-spaced wordmark in a save they like is still out), and say so when a save you show breaks one.

<designer-rules>
${rules}
</designer-rules>`;
}

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
  for (const key of ["query", "brief", "name", "id", "title", "sketch", "plan"]) {
    const m = json.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (!m) continue;
    // Read as JSON so \n and \" come out right; a string cut mid-escape falls back to the raw text.
    try {
      found[key] = JSON.parse(`"${m[1]!.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "")}"`);
    } catch {
      found[key] = m[1]!.replace(/\\"/g, '"');
    }
  }
  return found;
}

/** A message with each [[id]] written as the save's name, for titles; a reply's quote left out when there's a question after it. */
function readable(text: string) {
  const { docs } = load();
  const asked = text.replace(/^(?:>[^\n]*(?:\n|$))+\s*/, "");
  return (asked.trim() ? asked : text).replace(/\[\[([0-9a-f]{16})\]\]/g, (all, id: string) => {
    const d = docs.get(id);
    return d ? cardOf(d).title : all;
  });
}

/** A part of a sketch the designer pointed at in the studio. */
export interface Point {
  sketch: string;
  version?: number;
  label: string;
  selector: string;
  text?: string;
  html?: string;
  style?: Record<string, string>;
  state?: string;
  device?: string;
  /** change: change that part · alternates: try a few versions of it, each as a new sketch. */
  mode?: "change" | "alternates";
}
export interface SendContext {
  open?: string; project?: string; nodes?: string[]; label?: string; thumbs?: string[]; point?: Point;
  /** Make this many alternates of the sketch in question, each by its own run, at the same time. */
  fan?: number;
}

export async function send(chatId: string, text: string, context: SendContext = {}) {
  const chat = db.query<{ id: string; title: string; session_id: string | null }, [string]>("SELECT id, title, session_id FROM chats WHERE id = ?").get(chatId);
  if (!chat) throw new Error("That conversation is gone.");
  if (runs.has(chatId)) throw new Error("Still answering the last message.");
  const clean = text.trim();
  if (!clean) throw new Error("Write something first.");

  const ts = now();
  const userId = newId();
  // What it was about, kept with the message so it shows there: the open save, or what was selected on the canvas.
  const nodes = Array.isArray(context.nodes) ? context.nodes.filter((x) => typeof x === "string").slice(0, 60) : [];
  const picked = nodes.length && typeof context.label === "string"
    ? {
        nodes,
        label: context.label.slice(0, 120),
        thumbs: (Array.isArray(context.thumbs) ? context.thumbs : []).filter((t) => typeof t === "string" && /^\/(media|api|sketches)\//.test(t)).slice(0, 3),
      }
    : null;
  const stored = context.open ? { open: context.open } : picked ? { ...picked, ...(context.point?.label ? { pointed: String(context.point.label).slice(0, 120) } : {}) } : null;
  db.run("INSERT INTO chat_messages (id, chat_id, role, text, context, status, created_at) VALUES (?, ?, 'user', ?, ?, 'done', ?)", [
    userId, chatId, clean, stored ? JSON.stringify(stored) : null, ts,
  ]);
  const messageId = newId();
  db.run("INSERT INTO chat_messages (id, chat_id, role, parts, status, created_at) VALUES (?, ?, 'assistant', '[]', 'streaming', ?)", [messageId, chatId, now()]);
  db.run("UPDATE chats SET updated_at = ?, title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?", [
    now(), readable(clean).replace(/\s+/g, " ").slice(0, 80), chatId,
  ]);

  const run: Run = { messageId, parts: [], events: [], listeners: new Set(), proc: null, sdks: new Set(), stopped: false };
  runs.set(chatId, run);
  const message = out(db.query<Row, [string]>("SELECT * FROM chat_messages WHERE id = ?").get(messageId)!);
  emit(chatId, run, { t: "start", message });

  let prompt = clean;
  const said: string[] = [];
  if (context.project) {
    const p = findProject(context.project);
    if (p) {
      said.push(`The designer is on the canvas of the project “${p.name}” (id ${p.id}). References you find for it go on the canvas (place_on_board).`);
      // The project card: given once per conversation, and again only if the project or the card changed.
      const card = projectCard(p);
      const hash = String(Bun.hash(card));
      const had = db.query<{ card_project: string | null; card_hash: string | null }, [string]>("SELECT card_project, card_hash FROM chats WHERE id = ?").get(chatId);
      if (!chat.session_id || had?.card_project !== p.id || had?.card_hash !== hash) {
        said.push(`${had?.card_project === p.id && chat.session_id ? "The project card has changed since you were given it; this one replaces it." : "Here is the project card."}\n<project-card>\n${card}\n</project-card>\n`);
        run.card = { project: p.id, hash };
      }
      run.keep = card;
      const sel = picked ? describeSelection(p.id, picked.nodes) : [];
      if (sel.length) said.push(`They have selected on the canvas: ${sel.join("; ")}. “This” and “these” mean what's selected; look at the saves with get_reference before you answer about them.`);
      const pt = context.point;
      if (pt && typeof pt.sketch === "string" && typeof pt.selector === "string") {
        const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
        const style = pt.style && typeof pt.style === "object" ? Object.entries(pt.style).slice(0, 8).map(([k, v]) => `${k} ${clip(v, 80)}`).join("; ") : "";
        said.push(
          `In the studio, they pointed at one part of the sketch ${pt.sketch}${pt.version ? ` (version ${pt.version})` : ""}${pt.device && pt.device !== "desktop" ? `, seen on ${clip(pt.device, 10)}` : ""}${pt.state ? `, in its state #${clip(pt.state, 40)}` : ""}: the ${clip(pt.label, 120)}. Its CSS path: ${clip(pt.selector, 400)}.${pt.text ? ` Its text: “${clip(pt.text, 300)}”.` : ""}${style ? ` As rendered: ${style}.` : ""}${pt.html ? ` Its HTML as the browser has it (scripts may have changed it from the file):\n${clip(pt.html, 1600)}\n` : ""}` +
            (pt.mode === "alternates"
              ? ` They want alternates of that part: make 3 new sketches from this one (from: ${pt.sketch}), each the same page with only that part done a different way, each with a tries line saying how. Don't change the sketch itself.`
              : ` “This” and “here” mean that part. Change it with edit_sketch (find it in the page with get_sketch first if you haven't read this version), and leave the rest of the page as it is.`),
        );
      }
    }
  }
  // Off the canvas, the card of the project this conversation was about still comes back after a compaction.
  if (!run.keep) {
    const was = db.query<{ card_project: string | null }, [string]>("SELECT card_project FROM chats WHERE id = ?").get(chatId)?.card_project;
    const p = was ? findProject(was) : null;
    if (p) run.keep = projectCard(p);
  }
  if (context.open) {
    const d = load().docs.get(context.open);
    if (d) said.push(`The designer has [[${d.r.id}]] open (${cardOf(d).title}).`);
  }
  // Saves the designer mentioned with @ arrive as [[id]] in what they wrote.
  const named = [...new Set([...clean.matchAll(/\[\[([0-9a-f]{16})\]\]/g)].map((x) => x[1]!))];
  if (named.length) {
    const { docs } = load();
    const list = named.flatMap((id) => (docs.get(id) ? [`[[${id}]] (${cardOf(docs.get(id)!).title})`] : []));
    if (list.length) said.push(`The designer mentions ${list.join(", ")}: each [[id]] in their message is that save; look at it with get_reference when it matters.`);
  }
  // What happened beside this conversation since its last message (alternates made in parallel).
  const news = sideNews.get(chatId);
  if (news) {
    said.push(news);
    sideNews.delete(chatId);
  }
  if (said.length) prompt = `<panel-context>${said.join(" ")}</panel-context>\n\n${clean}`;
  // A small, pointed job ("make this button darker") doesn't need minutes of thought, or a
  // plan: it runs at low effort whatever the setting (on the builder, when two models share
  // the work), so the studio answers in seconds.
  const pointed = !!context.point && context.point.mode !== "alternates";
  const duoOn = chatSettings.mode() === "duo" && getSetting("chat_engine") !== "cli";
  const model = duoOn ? chatSettings.buildModel() : chatSettings.model();
  const effort: Effort = pointed ? "low" : chatSettings.effort();
  // Alternates: one run each, side by side, instead of one run making them one after another.
  const base = fanBase(context, nodes);
  const n = Math.min(4, Math.max(0, Math.floor(Number(context.fan) || 0)));
  if (base && n >= 2 && getSetting("chat_engine") !== "cli") {
    void fanOut(chatId, run, chat.session_id, { context: said.join(" "), asked: clean, base, n, part: context.point?.mode === "alternates" ? context.point.label : undefined })
      .catch((e) => finish(chatId, run, "error", (e as Error).message));
  } else if (duoOn && !pointed) void duo(chatId, run, chat.session_id, prompt).catch((e) => finish(chatId, run, "error", (e as Error).message));
  else void drive(chatId, run, chat.session_id, prompt, model, effort).catch((e) => finish(chatId, run, "error", (e as Error).message));
  // A short name for a new conversation, made alongside the answer.
  if (!chat.title) void nameChat(chatId, readable(clean), run);
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
  // The card counts as given once an answer to it came back.
  if (run.card && status === "done") db.run("UPDATE chats SET card_project = ?, card_hash = ? WHERE id = ?", [run.card.project, run.card.hash, chatId]);
  db.run("UPDATE chats SET updated_at = ? WHERE id = ?", [now(), chatId]);
  emit(chatId, run, { t: "done", status, error });
  runs.delete(chatId);
}

/**
 * What the project is, for FRIDAY to hold for the whole conversation: the designer's own
 * description, and each material whole (short ones) or as its summary (long ones, written
 * once when the material arrived; see digest.ts).
 */
export function projectCard(p: { id: string; name: string; brief?: string }) {
  const lines = [`“${p.name}” (project id ${p.id}).`, p.brief?.trim() ? `In the designer's words: ${p.brief.trim()}` : "The designer hasn't described it yet."];
  const mats = materialsForSummary(p.id);
  if (mats.length) lines.push("", "Its materials:");
  for (const m of mats) {
    const head = `\n### ${m.name} (${m.kind}, id ${m.id})${m.note ? `: ${m.note}` : ""}`;
    if (m.text) lines.push(head, m.text);
    else if (m.summary) lines.push(head, `${m.length}. What it says:`, m.summary);
    else if (m.kind === "picture") lines.push(head, "A picture: look at it with get_project_material.");
    else if (m.unreadable) lines.push(head, m.unreadable);
    else lines.push(head, `${m.length}. Not summarized yet; it starts: ${m.starts}`);
  }
  return lines.join("\n");
}

/** Things done beside a conversation that its next message should know about, by chat. */
const sideNews = new Map<string, string>();

/** The sketch that alternates would branch from: the one pointed into, or the one sketch selected. */
function fanBase(context: SendContext, nodes: string[]): { id: string; title: string } | null {
  if (!context.project) return null;
  const p = findProject(context.project);
  if (!p) return null;
  const wanted = context.point?.sketch ?? (nodes.length === 1 ? nodes[0] : undefined);
  if (!wanted) return null;
  const row = db.query<{ id: string; data: string }, [string, string]>("SELECT id, data FROM board_nodes WHERE id = ? AND project_id = ? AND kind = 'sketch'").get(wanted, p.id);
  if (!row) return null;
  let title = "Untitled sketch";
  try {
    title = String((JSON.parse(row.data) as { title?: string }).title || title);
  } catch {
    /* unnamed */
  }
  return { id: row.id, title };
}

/** A different way in for each alternate, so three runs working alone don't arrive at the same page. */
const ANGLES = {
  page: [
    ["the composition", "Rethink the composition: what comes first, the proportions, where the eye goes. Keep the type and the palette."],
    ["the voice", "Rethink the voice: the typeface pairing, the scale, the density, the mood of the color. Keep the structure."],
    ["the boldest idea", "Make the boldest departure that still fits the brief, the locked decisions and the rules: an idea the careful versions wouldn't try."],
    ["the quietest version", "Make the quietest version: take away until only what's needed is left, and make what's left exact."],
  ],
  part: [
    ["its layout", "Give that part a different layout: its order, alignment and proportions."],
    ["its treatment", "Give that part a different treatment: its type, color, material or motion."],
    ["the boldest idea", "Do that part the boldest way that still fits the brief, the locked decisions and the rules."],
    ["the quietest version", "Do that part the quietest way: as little as it can be and still do its job."],
  ],
} as const;

/**
 * Alternates made side by side: `n` runs at once, each a copy of the conversation so far,
 * each making one new sketch from the same base with its own angle. Their tool steps (and
 * the sketches taking shape) show together in the one answer; their words come at the end.
 * What used to take one run three sketches' worth of time takes about one.
 */
async function fanOut(chatId: string, run: Run, sessionId: string | null, o: { context: string; asked: string; base: { id: string; title: string }; n: number; part?: string }) {
  const bin = await claudeBinary();
  if (!bin) throw new Error("The claude command line isn't installed, so the assistant can't answer.");
  const token = await claudeToken();
  const mcpUrl = `http://127.0.0.1:${PORT}/mcp?rules=0`;
  const angles = (o.part ? ANGLES.part : ANGLES.page).slice(0, o.n);
  // Making is the builder's job when two models share the work.
  const duo = chatSettings.mode() === "duo";
  const model = duo ? chatSettings.buildModel() : chatSettings.model();
  const effort = duo ? chatSettings.buildEffort() : chatSettings.effort();
  const jobs = angles.map(([name, how], i) => {
    const others = angles.filter((_, j) => j !== i).map(([x]) => x).join(", ");
    const prompt = `<panel-context>${o.context} You are one of ${o.n} copies of yourself working at the same time, each making one alternate of the sketch “${o.base.title}” (${o.base.id}).</panel-context>

${o.asked}

Your part: make exactly ONE new sketch with make_sketch (from: "${o.base.id}"), ${o.part ? `the same page with only the ${o.part} done differently` : "a different direction for the whole page"}. Your angle is ${name}. ${how} The other copies are taking: ${others}. Commit to yours; don't hedge towards theirs. Read the sketch with get_sketch first if you haven't seen this version. Give yours a short title and a tries line that says how it differs. Look at the pictures that come back, fix what breaks the rules with edit_sketch, then answer in one line: its title, and what it tries. Don't make any other sketch and don't change the original.`;
    const r = reader(chatId, run, { side: true, model });
    return viaSdk(run, { bin, token, prompt, sessionId, mcpUrl, handle: r.handle, model, effort, fork: true }).then((res) => ({ ...res, ...r.state, name }));
  });
  const done = await Promise.all(jobs);
  if (run.stopped) return;
  const good = done.filter((d) => d.gotResult && !d.resultError && d.text.trim());
  if (!good.length) {
    const why = done.map((d) => d.resultError || d.stderr).find(Boolean) ?? "Claude Code stopped.";
    return finish(chatId, run, "error", friendly(String(why).split("\n").pop()!));
  }
  // The copies' one-liners, as one short answer.
  const failed = done.length - good.length;
  const text = [...good.map((d) => `- ${d.text.trim().replace(/\s*\n+\s*/g, " ")}`), failed ? `\n${failed} of the ${done.length} didn't finish.` : ""].filter(Boolean).join("\n");
  run.parts.push({ type: "text", text });
  emit(chatId, run, { t: "text", delta: text });
  // The conversation itself didn't see this happen; its next message is told.
  const made = run.parts.flatMap((p) => (p.type === "tool" && p.name === "make_sketch" && !p.error && typeof p.input?.title === "string" ? [`“${p.input.title}”`] : []));
  sideNews.set(chatId, `Since your last message here, ${good.length} alternates of the sketch “${o.base.title}” (${o.base.id}) were made at the same time by copies of you${made.length ? `: ${made.join(", ")}` : ""}. You haven't seen them: get_project lists them, get_sketch shows one.`);
  finish(chatId, run, "done");
}

// ---------- Two models on one answer: one plans, one builds ----------

/** What the planner may use: Panel's tools that only read. Making and changing things is the builder's. */
const READ_TOOLS = new Set(
  ["get_design_rules", "get_verdicts", "library_overview", "search_library", "find_by_color", "similar_to", "gather_for_brief", "get_reference", "list_projects", "get_project", "get_project_material", "get_sketch", "get_handoff", "get_build", "see_build"]
    .map((n) => `mcp__panel__${n}`),
);

/** The planner's way to hand over: a tool of its own, living in Panel for the length of one turn. */
function handOver(got: (plan: string) => void) {
  return createSdkMcpServer({
    name: "friday",
    version: "1.0.0",
    tools: [
      tool(
        "hand_to_builder",
        "Hand your plan to the builder, the model that makes things (sketches, edits, placing saves on the canvas, collections). Call it once, as your very last step, after your note to the designer.",
        { plan: z.string().min(40).describe("The whole plan, as numbered steps with concrete values: everything the builder needs, since it won't search or judge taste on its own.") },
        async ({ plan }) => {
          got(plan);
          return { content: [{ type: "text", text: "The builder has the plan and is starting on it now. Your turn is over: write nothing more." }] };
        },
      ),
    ],
  });
}

const plannerNote = (planner: string, builder: string) => `

How you work right now: you are the planner, ${planner}, paired with a builder, ${builder}. You do the understanding and the taste: read the project and the rules, search, look at the saves, and decide. The builder does the making. You can only read; the tools that change things (make_sketch, edit_sketch, place_on_board, topics, notes, collections, builds) are the builder's.
- When the message only needs an answer (a question, an opinion, a search, a comparison), answer it yourself as usual and don't hand anything over.
- When it needs something made or changed, think it through first: read what you need, search and look at the saves, decide. Then tell the designer in two or three lines what you're having made and why, and call hand_to_builder as your last step.
- The plan is everything the builder needs, since it won't search or judge taste on its own. Say what to make and where it hangs (from:, the project and topic), and each save to use with what to take from it ([[id]] and the exact thing: the hex, the font, the layout move). Give the structure part by part with the real content in the project's language, the type (families, sizes, weights, line heights), the color (hex and where each goes), spacing and corners, the states, and the knobs. Name the rules that matter most here, what to check in the pictures before finishing, and what not to do. Concrete values, not adjectives. Number the steps.`;

const builderPrompt = (plan: string, planner: string, builder: string) => `<panel-context>You are the builder, ${builder}. ${planner}, the planner, has just read the project, looked at the references and written the plan below; the designer has seen its note. Carry the plan out with the tools: make or change what it says, from the saves it names, then look at the pictures that come back and fix what breaks the plan or the designer's rules. Follow the plan's choices; where it's silent, or something in it doesn't work, use your judgment and say so. Don't look for other references. Then reply to the designer in a few lines: what you made, and anything you did differently from the plan.</panel-context>

<plan>
${plan}
</plan>`;

/**
 * One answer by two models. The planner (Fable, by default, at high effort) reads, looks and
 * decides; a question it simply answers. When something is to be made, it writes a plan and
 * hands it over, and the builder (Opus, by default) continues the same conversation and
 * carries the plan out. Both show in the one answer, each step marked with its model.
 */
async function duo(chatId: string, run: Run, sessionId: string | null, prompt: string) {
  const bin = await claudeBinary();
  if (!bin) throw new Error("The claude command line isn't installed, so the assistant can't answer.");
  const token = await claudeToken();
  const mcpUrl = `http://127.0.0.1:${PORT}/mcp?rules=0`;
  const planner = chatSettings.planModel(), builder = chatSettings.buildModel();
  const plannerName = modelName(planner), builderName = modelName(builder);

  let plan: string | null = null;
  const p = reader(chatId, run, { model: planner, tag: plannerName });
  const first = await viaSdk(run, {
    bin, token, prompt, sessionId, mcpUrl, handle: p.handle, model: planner, effort: chatSettings.planEffort(),
    servers: { friday: handOver((x) => (plan = x)) },
    allow: (n) => (READ_TOOLS.has(n) || n === "mcp__friday__hand_to_builder" ? true : `You plan and ${builderName} builds: put this in the plan for hand_to_builder instead.`),
    system: systemPrompt() + plannerNote(plannerName, builderName),
  });
  if (run.stopped) return;
  if (sessionId && run.parts.length === 0 && (lost(first.stderr) || lost(p.state.resultError ?? ""))) {
    db.run("UPDATE chats SET session_id = NULL WHERE id = ?", [chatId]);
    return duo(chatId, run, null, prompt);
  }
  if (p.state.resultError) return finish(chatId, run, "error", friendly(p.state.resultError));
  if (!p.state.gotResult) return finish(chatId, run, "error", friendly(first.stderr.split("\n").pop() || "Claude Code stopped."));
  if (!plan) return finish(chatId, run, "done");

  // The hand-over step says who builds it.
  const step = [...run.parts].reverse().find((x) => x.type === "tool" && x.name === "hand_to_builder");
  if (step && step.type === "tool") {
    step.input = { ...step.input, plan, to: builderName };
    emit(chatId, run, { t: "tool_input", id: step.id, input: step.input });
  }
  persist(run);

  // The builder continues the same conversation, so the planner's reading and plan are in it, and next time the planner sees what was built.
  const session = db.query<{ session_id: string | null }, [string]>("SELECT session_id FROM chats WHERE id = ?").get(chatId)?.session_id ?? null;
  const b = reader(chatId, run, { model: builder, tag: builderName });
  const second = await viaSdk(run, {
    bin, token, prompt: builderPrompt(plan, plannerName, builderName), sessionId: session, mcpUrl, handle: b.handle, model: builder, effort: chatSettings.buildEffort(),
    // The planner's tool is there (the conversation has a call to it) but isn't the builder's to use.
    servers: { friday: handOver(() => {}) },
    allow: panelOnly,
  });
  if (run.stopped) return;
  if (b.state.resultError) return finish(chatId, run, "error", friendly(b.state.resultError));
  if (!b.state.gotResult) return finish(chatId, run, "error", friendly(second.stderr.split("\n").pop() || "Claude Code stopped."));
  finish(chatId, run, "done");
}

/**
 * Reads what Claude Code sends back for one run and turns it into the answer's parts and
 * the events the app follows. `side` is for a run working beside others on the same answer
 * (one alternate each): its tool steps show like any other, but its words are kept back
 * until the end and it doesn't change which conversation the chat continues.
 */
function reader(chatId: string, run: Run, o: { side?: boolean; model: string; tag?: string }) {
  const side = !!o.side;
  // Which model it is, on its steps, when two models work on one answer.
  const tag = o.tag ? { model: o.tag } : {};
  // Per content block: what kind it is, and a tool's input as it's written.
  const blocks = new Map<number, { kind: string; toolId?: string; json?: string; started?: number; sketch?: boolean; drafted?: number; draft?: Extract<ChatEvent, { t: "draft" }> }>();
  const lastPart = () => run.parts.at(-1);
  const state = { resultError: null as string | null, gotResult: false, text: "" };
  let lastSave = 0;

  const handle = (d: any) => {
    // Stopped: whatever is still on its way out is dropped.
    if (run.stopped) return;
    if (d.type === "system" && d.subtype === "compact_boundary" && !side) {
      const pre = Number(d.compact_metadata?.pre_tokens) || 0, post = Number(d.compact_metadata?.post_tokens) || undefined;
      run.parts.push({ type: "compact", pre, post, done: true, ...tag });
      emit(chatId, run, { t: "compact", pre, post });
      persist(run);
      return;
    }
    if (d.type === "panel_context" && !side) {
      db.run("UPDATE chats SET context_tokens = ?, context_limit = ? WHERE id = ?", [d.used, d.limit, chatId]);
      emit(chatId, run, { t: "context", used: d.used, limit: d.limit });
      return;
    }
    if (d.type === "system" && d.subtype === "init" && d.session_id) {
      // A side run works in a copy of the conversation; the chat keeps its own.
      if (!side) db.run("UPDATE chats SET session_id = ? WHERE id = ?", [d.session_id, chatId]);
      return;
    }
    if (d.type === "stream_event") {
      const e = d.event;
      if (e.type === "content_block_start") {
        const b = e.content_block;
        if (b.type === "thinking" || b.type === "redacted_thinking") {
          blocks.set(e.index, { kind: "thinking", started: Date.now() });
          if (side) return;
          const last = lastPart();
          if (!(last?.type === "thinking" && !last.done)) run.parts.push({ type: "thinking", ...tag });
          emit(chatId, run, { t: "thinking", on: true, ...tag });
        } else if (b.type === "tool_use") {
          blocks.set(e.index, { kind: "tool", toolId: b.id, json: "", sketch: /(make|edit)_sketch$/.test(String(b.name)) });
          const name = String(b.name).replace(/^mcp__(panel|friday)__/, "");
          run.parts.push({ type: "tool", id: b.id, name, ...tag });
          emit(chatId, run, { t: "tool", id: b.id, name, ...tag });
        } else blocks.set(e.index, { kind: b.type });
      } else if (e.type === "content_block_delta") {
        const b = blocks.get(e.index);
        if (e.delta.type === "text_delta" && e.delta.text) {
          // Several side runs talking at once would garble: each one's words are kept for the end.
          if (side) {
            state.text += e.delta.text;
            return;
          }
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
          // A sketch being written: show the page as far as it has come, a few times a second.
          if (b.sketch && Date.now() - (b.drafted ?? 0) > 400) {
            b.drafted = Date.now();
            const html = partialHtml(b.json!);
            if (html) {
              // Only the newest draft is worth keeping for a window that joins late.
              if (b.draft) b.draft.html = "";
              b.draft = { t: "draft", id: b.toolId!, html };
              emit(chatId, run, b.draft);
            }
          }
          const input = partialInput(b.json!);
          if (Object.keys(input).length) {
            const part = run.parts.find((p) => p.type === "tool" && p.id === b.toolId);
            if (part && part.type === "tool") part.input = { ...part.input, ...input };
            emit(chatId, run, { t: "tool_input", id: b.toolId!, input, partial: true });
          }
        }
      } else if (e.type === "content_block_stop") {
        const b = blocks.get(e.index);
        if (b?.kind === "thinking" && !side) {
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
      state.gotResult = true;
      if (d.is_error) state.resultError = String(d.result || d.subtype || "Claude couldn't answer.").slice(0, 400);
      const u = d.usage;
      if (u) {
        db.run(
          "INSERT INTO ai_usage (at, ref_id, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost) VALUES (?, NULL, ?, 'chat', ?, ?, ?, ?, 0)",
          [now(), o.model, u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0],
        );
      }
    }
  };
  return { handle, state };
}

async function drive(chatId: string, run: Run, sessionId: string | null, prompt: string, model: string, effort: Effort) {
  const bin = await claudeBinary();
  if (!bin) throw new Error("The claude command line isn't installed, so the assistant can't answer.");
  const token = await claudeToken();
  // The rules are already in Ask's instructions, so its tools leave them out (rules=0).
  const mcpUrl = `http://127.0.0.1:${PORT}/mcp?rules=0`;
  const mcp = JSON.stringify({ mcpServers: { panel: { type: "http", url: mcpUrl } } });
  const args = [
    bin, "-p", prompt,
    "--model", model, "--effort", effort,
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--system-prompt", systemPrompt(),
    "--tools", "", "--mcp-config", mcp, "--strict-mcp-config", "--allowedTools", "mcp__panel",
    "--setting-sources", "",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];

  const { handle, state } = reader(chatId, run, { model });

  let code: number | null = 0;
  let stderr = "";
  // Through the Agent SDK by default: the same Claude Code, driven as a library (typed
  // messages, a real interrupt, each tool call passed by Panel before it runs). The command
  // line stays as the fallback (chat_engine = "cli", or when the SDK can't start).
  let cli = getSetting("chat_engine") === "cli";
  if (!cli) {
    ({ code, stderr } = await viaSdk(run, { bin, token, prompt, sessionId, mcpUrl, handle, model, effort }));
    if (stderr && !state.gotResult && !run.parts.length && !run.stopped) {
      console.error("Chat: the Agent SDK couldn't answer, using the command line:", stderr);
      cli = true;
    }
  }
  if (cli) {
    const proc = Bun.spawn(args, {
      cwd: CHAT_DIR,
      env: { HOME: process.env.HOME ?? "", USER: process.env.USER ?? "", PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`, ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) },
      stdout: "pipe", stderr: "pipe",
    });
    run.proc = proc;
    if (run.stopped) proc.kill();
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
    code = await proc.exited;
    stderr = (await errText).trim();
  }

  if (run.stopped) return;
  // A conversation whose saved session is gone (cleared by Claude Code) starts over quietly.
  if (sessionId && run.parts.length === 0 && (lost(stderr) || lost(state.resultError ?? ""))) {
    db.run("UPDATE chats SET session_id = NULL WHERE id = ?", [chatId]);
    return drive(chatId, run, null, prompt, model, effort);
  }
  if (state.resultError) return finish(chatId, run, "error", friendly(state.resultError));
  if (!state.gotResult) return finish(chatId, run, "error", friendly(stderr.split("\n").pop() || `Claude Code stopped (code ${code}).`));
  finish(chatId, run, "done");
}

/** Claude Code saying the conversation it was asked to continue isn't there any more. */
const lost = (m: string) => /session|conversation/i.test(m) && /not found|no conversation|invalid|does not exist/i.test(m);

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
  for (const sdk of run.sdks) {
    void sdk.q.interrupt().catch(() => {});
    setTimeout(() => sdk.abort.abort(), 3000);
  }
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

/**
 * One turn through the Agent SDK (@anthropic-ai/claude-agent-sdk), on the designer's own
 * claude binary and login. Only Panel's tools: no built-in ones, no settings from ~/.claude,
 * and every tool call checked here before it runs. Messages come out in the same shapes as
 * stream-json, so they go to the same handler.
 */
interface SdkTurn {
  bin: string;
  token: string | null;
  prompt: string;
  sessionId: string | null;
  mcpUrl: string;
  handle: (d: unknown) => void;
  model: string;
  effort: Effort;
  /** Start from the conversation so far and go its own way, leaving the chat's session as it is. */
  fork?: boolean;
  /** Tools of this turn's own, beside Panel's (the planner's hand-over). */
  servers?: Record<string, McpServerConfig>;
  /** Whether a tool may run: true, or why not. Panel's tools only, by default. */
  allow?: (name: string) => true | string;
  /** Instructions for this turn, when they aren't Panel's usual ones. */
  system?: string;
}

/**
 * Where FRIDAY's conversations get summarized, in tokens. Claude Code's own default for a
 * 1M-token model is near the end of the window (about 967K), so a long design chat, full
 * of pictures, would grow slow and costly and lose focus long before. Compacting at about
 * 290K keeps the conversation sharp; the project card comes back right after (see viaSdk).
 */
const COMPACT_WINDOW = 320_000;

const panelOnly = (name: string): true | string => (name.startsWith("mcp__panel__") ? true : "FRIDAY only uses Panel's tools.");

async function viaSdk(run: Run, t: SdkTurn) {
  const abort = new AbortController();
  const allow = t.allow ?? panelOnly;
  const q = query({
    prompt: t.prompt,
    options: {
      pathToClaudeCodeExecutable: t.bin,
      cwd: CHAT_DIR,
      env: { HOME: process.env.HOME ?? "", USER: process.env.USER ?? "", PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`, ...(t.token ? { CLAUDE_CODE_OAUTH_TOKEN: t.token } : {}) },
      model: t.model,
      effort: t.effort,
      systemPrompt: t.system ?? systemPrompt(),
      tools: [],
      mcpServers: { panel: { type: "http", url: t.mcpUrl }, ...t.servers },
      strictMcpConfig: true,
      // No blanket allow: every tool call comes to canUseTool below, which decides.
      settingSources: [],
      includePartialMessages: true,
      abortController: abort,
      canUseTool: async (name, input) => {
        const ok = allow(name);
        return ok === true ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: ok };
      },
      settings: { autoCompactWindow: COMPACT_WINDOW },
      // Right after Claude Code summarizes the conversation, the project card is given again in
      // full, so what the project is never fades into a summary of a summary.
      ...(run.keep
        ? {
            hooks: {
              SessionStart: [{
                hooks: [async (i) => (i.hook_event_name === "SessionStart" && i.source === "compact"
                  ? { hookSpecificOutput: { hookEventName: "SessionStart" as const, additionalContext: `The conversation was just summarized to make room. The project card, in full again:\n<project-card>\n${run.keep}\n</project-card>` } }
                  : {})],
              }],
            },
          }
        : {}),
      ...(t.sessionId ? { resume: t.sessionId, ...(t.fork ? { forkSession: true } : {}) } : {}),
    },
  });
  const sdk = { q, abort };
  run.sdks.add(sdk);
  let stderr = "";
  try {
    for await (const m of q) {
      t.handle(m);
      if (run.stopped) break;
      // After each answer: how full the conversation is now (a forked side run has its own, not the chat's).
      if (m.type === "result" && !t.fork) {
        const u = await q.getContextUsage({ detail: "summary" }).catch(() => null);
        if (u?.totalTokens && u.autoCompactThreshold) t.handle({ type: "panel_context", used: u.totalTokens, limit: u.autoCompactThreshold });
      }
    }
  } catch (e) {
    stderr = (e as Error).message;
  } finally {
    run.sdks.delete(sdk);
  }
  return { code: stderr ? 1 : 0, stderr };
}
