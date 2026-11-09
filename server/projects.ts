// Projects: a canvas per piece of work (say, a B2G e-signature site), where the designer
// lays out decisions (Typography, Color…), the saves considered for each, and why.
//
// The canvas is a picture of those decisions. What's stored is the decisions: topics,
// the saves under them (chosen, kept, ruled out) and the notes on them. Positions only
// matter for drawing. An AI reads the decisions (summary()), never the coordinates.
//
// Every change is a small op, logged with a sequence number. The open canvas follows the
// log, so a change made anywhere (another window, Claude Code over MCP, which runs in its
// own process) shows up live.

import { db, newId, now } from "./db.ts";
import { load, panelUrl, type Doc } from "./library.ts";
import { PORT } from "./config.ts";
import { materialsForSummary, removeProjectFiles } from "./materials.ts";
import { fullUrl, sketchPath, versionsOf } from "./sketches.ts";
import { buildSummary } from "./builds.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS board_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- topic: a decision to make · ref: a save from the library · note: the designer's words
  -- · sketch: a quick page Claude made to try a direction (files in sketches.ts)
  kind TEXT NOT NULL,
  ref_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  -- designer · assistant
  origin TEXT NOT NULL DEFAULT 'designer',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS board_nodes_project ON board_nodes(project_id);
CREATE INDEX IF NOT EXISTS board_nodes_ref ON board_nodes(ref_id);
CREATE TABLE IF NOT EXISTS board_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL REFERENCES board_nodes(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES board_nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS board_edges_project ON board_edges(project_id);
CREATE TABLE IF NOT EXISTS project_events (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  -- designer · assistant · mcp
  actor TEXT NOT NULL,
  -- The window that made the change, so it doesn't apply its own change twice.
  client TEXT,
  ops TEXT NOT NULL,
  PRIMARY KEY (project_id, seq)
);
`);

// Added with undo: what puts each change back, what it was, and whether it was undone.
const eventCols = db.query<{ name: string }, []>("PRAGMA table_info(project_events)").all().map((c) => c.name);
if (!eventCols.includes("undo")) db.exec("ALTER TABLE project_events ADD COLUMN undo TEXT");
if (!eventCols.includes("label")) db.exec("ALTER TABLE project_events ADD COLUMN label TEXT");
if (!eventCols.includes("undo_of")) db.exec("ALTER TABLE project_events ADD COLUMN undo_of INTEGER");
if (!eventCols.includes("undone")) db.exec("ALTER TABLE project_events ADD COLUMN undone INTEGER NOT NULL DEFAULT 0");

// ---------- What's on a canvas ----------

export const TOPIC_FACETS = ["typography", "color", "layout", "imagery", "motion", "components", "other"] as const;
export type TopicFacet = (typeof TOPIC_FACETS)[number];
/** A save's place under a topic: chosen (the pick), kept (in the running), ruled out, or proposed (by the assistant, not yet looked at). */
export const REF_STATES = ["proposed", "kept", "chosen", "ruled_out"] as const;
export type RefState = (typeof REF_STATES)[number];

export interface TopicData { title: string; facet?: TopicFacet; status?: "exploring" | "locked"; summary?: string }
export interface RefData { state?: RefState; taking?: string }
export interface NoteData { text: string }
/** A sketch: what it is, what it tries, the designer's verdict, and the version it shows. */
export interface SketchData { title: string; tries?: string; state?: RefState; version: number; reason?: string; device?: "desktop" | "tablet" | "phone" }
/** A build: Claude Code making a chosen sketch for real, in the designer's code. Its progress lives in builds.ts. */
export interface BuildData { build: string; title: string }

export interface BoardNode {
  id: string;
  kind: "topic" | "ref" | "note" | "sketch" | "build";
  ref_id: string | null;
  data: Record<string, unknown>;
  x: number;
  y: number;
  origin: string;
  created_at: string;
}
export interface BoardEdge { id: string; source: string; target: string; label: string }

export type Op =
  | { op: "add_node"; node: { id?: string; kind: BoardNode["kind"]; ref_id?: string | null; data?: Record<string, unknown>; x: number; y: number } }
  /** data is merged into what's there; x and y move it. */
  | { op: "update_node"; id: string; data?: Record<string, unknown>; x?: number; y?: number }
  | { op: "remove_node"; id: string }
  | { op: "add_edge"; edge: { id?: string; source: string; target: string; label?: string } }
  | { op: "remove_edge"; id: string }
  | { op: "update_project"; name?: string; brief?: string };

interface NodeRow { id: string; project_id: string; kind: BoardNode["kind"]; ref_id: string | null; data: string; x: number; y: number; origin: string; created_at: string }
interface ProjectRow { id: string; name: string; brief: string; seq: number; created_at: string; updated_at: string }

const parse = (s: string) => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const nodeOut = (r: NodeRow): BoardNode => ({ id: r.id, kind: r.kind, ref_id: r.ref_id, data: parse(r.data), x: r.x, y: r.y, origin: r.origin, created_at: r.created_at });
const rowOf = (id: string) => db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(id);

/** A project by id, or by name (any case) for tools that only know its name. */
export function findProject(idOrName: string) {
  const v = idOrName.trim();
  return rowOf(v) ?? db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE name = ? COLLATE NOCASE ORDER BY updated_at DESC").get(v) ?? null;
}

// ---------- Projects ----------

export function listProjects() {
  return db
    .query<ProjectRow & { nodes: number; refs: number; topics: number; locked: number }, []>(
      `SELECT p.*,
         (SELECT COUNT(*) FROM board_nodes n WHERE n.project_id = p.id) nodes,
         (SELECT COUNT(*) FROM board_nodes n WHERE n.project_id = p.id AND n.kind = 'ref') refs,
         (SELECT COUNT(*) FROM board_nodes n WHERE n.project_id = p.id AND n.kind = 'topic') topics,
         (SELECT COUNT(*) FROM board_nodes n WHERE n.project_id = p.id AND n.kind = 'topic' AND json_extract(n.data, '$.status') = 'locked') locked
       FROM projects p ORDER BY p.updated_at DESC`,
    )
    .all()
    .map(({ seq: _seq, ...p }) => p);
}

export function createProject(name: string, brief = "") {
  const clean = name.trim();
  if (!clean) throw new Error("The project needs a name.");
  const id = newId();
  db.run("INSERT INTO projects (id, name, brief, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [id, clean, brief.trim(), now(), now()]);
  return { id, name: clean, brief: brief.trim() };
}

export function deleteProject(id: string) {
  db.run("DELETE FROM projects WHERE id = ?", [id]);
  removeProjectFiles(id);
}

/** Everything the canvas needs to draw a project. */
export function getProject(id: string) {
  const p = rowOf(id);
  if (!p) return null;
  const nodes = db.query<NodeRow, [string]>("SELECT * FROM board_nodes WHERE project_id = ? ORDER BY created_at, rowid").all(id).map(nodeOut);
  const edges = db.query<BoardEdge, [string]>("SELECT id, source, target, label FROM board_edges WHERE project_id = ? ORDER BY created_at, rowid").all(id);
  return { id: p.id, name: p.name, brief: p.brief, seq: p.seq, created_at: p.created_at, updated_at: p.updated_at, nodes, edges };
}

// ---------- Changing a canvas ----------

const KINDS = new Set(["topic", "ref", "note", "sketch", "build"]);
const finite = (n: unknown, fallback = 0) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : fallback);

/** Keep a node's data to what its kind uses, with sane values. */
function cleanData(kind: BoardNode["kind"], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  if (kind === "topic") {
    if ("title" in data) out.title = str(data.title, 120) ?? "";
    if ("facet" in data) out.facet = TOPIC_FACETS.includes(data.facet as TopicFacet) ? data.facet : undefined;
    if ("status" in data) out.status = data.status === "locked" ? "locked" : "exploring";
    if ("summary" in data) out.summary = str(data.summary, 4000);
  } else if (kind === "ref") {
    if ("state" in data) out.state = REF_STATES.includes(data.state as RefState) ? data.state : "kept";
    if ("taking" in data) out.taking = str(data.taking, 200);
    // Why the designer chose it or ruled it out, in a few words.
    if ("reason" in data) out.reason = str(data.reason, 400);
  } else if (kind === "sketch") {
    if ("title" in data) out.title = str(data.title, 120) ?? "";
    if ("tries" in data) out.tries = str(data.tries, 300);
    if ("state" in data) out.state = REF_STATES.includes(data.state as RefState) ? data.state : "kept";
    if ("version" in data) out.version = Number.isInteger(data.version) && (data.version as number) >= 1 && (data.version as number) < 100_000 ? data.version : 1;
    if ("reason" in data) out.reason = str(data.reason, 400);
    if ("device" in data) out.device = ["desktop", "tablet", "phone"].includes(data.device as string) ? data.device : "desktop";
  } else if (kind === "build") {
    if ("build" in data) out.build = typeof data.build === "string" && /^[0-9a-f]{16}$/.test(data.build) ? data.build : "";
    if ("title" in data) out.title = str(data.title, 120) ?? "";
  } else if ("text" in data) out.text = str(data.text, 8000) ?? "";
  return out;
}

/** Who made a change. "assistant" is Claude, from Ask or any MCP app. */
export type Actor = "designer" | "assistant";

export interface ApplyOptions {
  client?: string | null;
  /** A few words on what this change did, for the canvas to say ("Placed 6 saves under Typography"). */
  label?: string;
  /** This change undoes the event with this number. */
  undoOf?: number;
}

/**
 * Apply ops to a project, in one transaction, and log them with the ops that would undo
 * them. Ops that refer to something already gone are skipped quietly (two windows
 * deleting the same node is fine). Returns the ops as applied (ids filled in) and the
 * new sequence number.
 */
export function apply(projectId: string, ops: Op[], actor: Actor = "designer", opts: ApplyOptions = {}) {
  const p = rowOf(projectId);
  if (!p) throw new Error("That project is gone.");
  if (!Array.isArray(ops) || !ops.length) return { seq: p.seq, ops: [] as Op[] };
  if (ops.length > 500) throw new Error("Too many changes at once.");
  const done: Op[] = [];
  // For each op applied, what puts things back; replayed last-first to undo.
  const undo: Op[][] = [];
  const ts = now();
  const owned = (id: string) => db.query<NodeRow, [string, string]>("SELECT * FROM board_nodes WHERE id = ? AND project_id = ?").get(id, projectId);
  const edgesOf = (id: string) => db.query<BoardEdge, [string, string]>("SELECT id, source, target, label FROM board_edges WHERE source = ? OR target = ?").all(id, id);

  const seq = db.transaction(() => {
    for (const o of ops) {
      if (o.op === "add_node") {
        const n = o.node;
        if (!n || !KINDS.has(n.kind)) continue;
        if (n.kind === "ref" && !(n.ref_id && db.query("SELECT 1 FROM refs WHERE id = ?").get(n.ref_id))) continue;
        const id = n.id && /^[0-9a-z]{8,32}$/.test(n.id) && !owned(n.id) ? n.id : newId();
        const data = cleanData(n.kind, n.data ?? {});
        if ((n.kind === "ref" || n.kind === "sketch") && !data.state) data.state = actor === "designer" ? "kept" : "proposed";
        if (n.kind === "sketch" && !data.version) data.version = 1;
        if (n.kind === "topic" && !data.status) data.status = "exploring";
        const origin = actor === "designer" ? "designer" : "assistant";
        db.run(
          "INSERT INTO board_nodes (id, project_id, kind, ref_id, data, x, y, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, projectId, n.kind, n.kind === "ref" ? n.ref_id! : null, JSON.stringify(data), finite(n.x), finite(n.y), origin, ts, ts],
        );
        done.push({ op: "add_node", node: { id, kind: n.kind, ref_id: n.kind === "ref" ? n.ref_id! : null, data, x: finite(n.x), y: finite(n.y) } });
        undo.push([{ op: "remove_node", id }]);
      } else if (o.op === "update_node") {
        const row = owned(o.id);
        if (!row) continue;
        const before = parse(row.data);
        const patch = o.data ? cleanData(row.kind, o.data) : undefined;
        const data = patch ? { ...before, ...patch } : undefined;
        db.run("UPDATE board_nodes SET data = ?, x = ?, y = ?, updated_at = ? WHERE id = ?", [
          data ? JSON.stringify(data) : row.data, o.x === undefined ? row.x : finite(o.x), o.y === undefined ? row.y : finite(o.y), ts, o.id,
        ]);
        done.push({ op: "update_node", id: o.id, ...(patch ? { data: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? null])) } : {}), ...(o.x !== undefined ? { x: finite(o.x) } : {}), ...(o.y !== undefined ? { y: finite(o.y) } : {}) });
        undo.push([{
          op: "update_node", id: o.id,
          ...(patch ? { data: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])) } : {}),
          ...(o.x !== undefined ? { x: row.x } : {}), ...(o.y !== undefined ? { y: row.y } : {}),
        }]);
      } else if (o.op === "remove_node") {
        const row = owned(o.id);
        if (!row) continue;
        const lines = edgesOf(o.id);
        db.run("DELETE FROM board_nodes WHERE id = ?", [o.id]);
        done.push({ op: "remove_node", id: o.id });
        undo.push([
          { op: "add_node", node: { id: row.id, kind: row.kind, ref_id: row.ref_id, data: parse(row.data), x: row.x, y: row.y } },
          ...lines.map((e) => ({ op: "add_edge" as const, edge: e })),
        ]);
      } else if (o.op === "add_edge") {
        const e = o.edge;
        if (!e || e.source === e.target || !owned(e.source) || !owned(e.target)) continue;
        const dup = db
          .query<{ id: string }, [string, string, string, string]>(
            "SELECT id FROM board_edges WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)",
          )
          .get(e.source, e.target, e.target, e.source);
        if (dup) continue;
        const id = e.id && /^[0-9a-z]{8,32}$/.test(e.id) && !db.query("SELECT 1 FROM board_edges WHERE id = ?").get(e.id) ? e.id : newId();
        const label = typeof e.label === "string" ? e.label.slice(0, 120) : "";
        db.run("INSERT INTO board_edges (id, project_id, source, target, label, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, projectId, e.source, e.target, label, ts]);
        done.push({ op: "add_edge", edge: { id, source: e.source, target: e.target, label } });
        undo.push([{ op: "remove_edge", id }]);
      } else if (o.op === "remove_edge") {
        const before = db.query<BoardEdge, [string, string]>("SELECT id, source, target, label FROM board_edges WHERE id = ? AND project_id = ?").get(o.id, projectId);
        if (!before) continue;
        db.run("DELETE FROM board_edges WHERE id = ?", [o.id]);
        done.push({ op: "remove_edge", id: o.id });
        undo.push([{ op: "add_edge", edge: before }]);
      } else if (o.op === "update_project") {
        const name = typeof o.name === "string" ? o.name.trim().slice(0, 120) : undefined;
        const brief = typeof o.brief === "string" ? o.brief.slice(0, 8000) : undefined;
        const was = rowOf(projectId)!;
        if (name) db.run("UPDATE projects SET name = ? WHERE id = ?", [name, projectId]);
        if (brief !== undefined) db.run("UPDATE projects SET brief = ? WHERE id = ?", [brief, projectId]);
        if (name || brief !== undefined) {
          done.push({ op: "update_project", ...(name ? { name } : {}), ...(brief !== undefined ? { brief } : {}) });
          undo.push([{ op: "update_project", ...(name ? { name: was.name } : {}), ...(brief !== undefined ? { brief: was.brief } : {}) }]);
        }
      }
    }
    if (!done.length) return p.seq;
    db.run("UPDATE projects SET seq = seq + 1, updated_at = ? WHERE id = ?", [ts, projectId]);
    const next = rowOf(projectId)!.seq;
    db.run(
      "INSERT INTO project_events (project_id, seq, at, actor, client, ops, undo, label, undo_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [projectId, next, ts, actor, opts.client ?? null, JSON.stringify(done), JSON.stringify(undo.reverse().flat()), opts.label ?? null, opts.undoOf ?? null],
    );
    if (opts.undoOf) db.run("UPDATE project_events SET undone = 1 WHERE project_id = ? AND seq = ?", [projectId, opts.undoOf]);
    return next;
  })();
  if (done.length) wake(projectId);
  return { seq, ops: done };
}

interface UndoRow { seq: number; at: string; actor: string; undo: string | null; label: string | null; undone: number; undo_of: number | null }

/**
 * Undo the latest change by this window (⌘Z), or what the assistant last did. The
 * assistant's last reply can be several changes (a topic, the saves under it, a note);
 * they're taken back together: every assistant change since the designer last did
 * something, within a few minutes of each other. Undoing is itself a change, so every
 * open canvas sees it, and ⌘Z doesn't undo an undo: it keeps going back instead.
 */
export function undoLast(projectId: string, who: { client: string } | "assistant", client: string | null) {
  let rows: UndoRow[];
  if (who === "assistant") {
    const recent = db
      .query<UndoRow, [string]>("SELECT seq, at, actor, undo, label, undone, undo_of FROM project_events WHERE project_id = ? ORDER BY seq DESC LIMIT 60")
      .all(projectId);
    rows = [];
    for (const r of recent) {
      if (r.undo_of || r.undone) continue;
      if (r.actor !== "assistant") break;
      if (rows.length && Date.parse(rows.at(-1)!.at) - Date.parse(r.at) > 3 * 60_000) break;
      rows.push(r);
    }
  } else {
    const r = db
      .query<UndoRow, [string, string]>(
        "SELECT seq, at, actor, undo, label, undone, undo_of FROM project_events WHERE project_id = ? AND client = ? AND actor = 'designer' AND undone = 0 AND undo_of IS NULL ORDER BY seq DESC LIMIT 1",
      )
      .get(projectId, who.client);
    rows = r ? [r] : [];
  }
  rows = rows.filter((r) => r.undo);
  if (!rows.length) return null;
  // Newest first, each already in the order that puts it back.
  const ops = rows.flatMap((r) => JSON.parse(r.undo!) as Op[]);
  const what = rows.length === 1 ? rows[0]!.label : `${rows.at(-1)!.label ?? "a change"} and ${rows.length - 1} more`;
  const res = apply(projectId, ops, "designer", { client, undoOf: rows[0]!.seq, label: what ? `Undid: ${what}` : "Undid a change" });
  db.run(`UPDATE project_events SET undone = 1 WHERE project_id = ? AND seq IN (${rows.map(() => "?").join(",")})`, [projectId, ...rows.map((r) => r.seq)]);
  return { ...res, undid: what };
}

// ---------- Following a canvas live ----------

const waiting = new Map<string, Set<() => void>>();
function wake(projectId: string) {
  for (const f of waiting.get(projectId) ?? []) f();
}

interface EventRow { seq: number; at: string; actor: string; client: string | null; ops: string; label: string | null; undo_of: number | null }

/**
 * Changes to a project from `after` on, as server-sent events, for as long as the canvas
 * is open. Changes made in this process arrive at once; changes from another process
 * (Claude Code's MCP server) are picked up within half a second.
 */
export function follow(projectId: string, after: number, signal: AbortSignal) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let last = after;
      let closed = false;
      const send = () => {
        if (closed) return;
        const rows = db
          .query<EventRow, [string, number]>("SELECT seq, at, actor, client, ops, label, undo_of FROM project_events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT 200")
          .all(projectId, last);
        for (const r of rows) {
          last = r.seq;
          controller.enqueue(enc.encode(`id: ${r.seq}\ndata: ${JSON.stringify({ seq: r.seq, at: r.at, actor: r.actor, client: r.client, label: r.label, undo_of: r.undo_of, ops: JSON.parse(r.ops) })}\n\n`));
        }
        if (!rowOf(projectId)) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ gone: true })}\n\n`));
          close();
        }
      };
      const listeners = waiting.get(projectId) ?? waiting.set(projectId, new Set()).get(projectId)!;
      listeners.add(send);
      const poll = setInterval(send, 500);
      const ping = setInterval(() => !closed && controller.enqueue(enc.encode(": ping\n\n")), 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(ping);
        listeners.delete(send);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener("abort", close);
      send();
    },
  });
}

// ---------- Verdicts across every project: the designer's taste, in their own words ----------

interface Judged { project: string; kind: "ref" | "sketch"; id: string; title: string; state: RefState; reason: string }

function judgedNodes(): Judged[] {
  const rows = db
    .query<{ id: string; kind: "ref" | "sketch"; ref_id: string | null; data: string; project: string }, []>(
      "SELECT n.id, n.kind, n.ref_id, n.data, p.name project FROM board_nodes n JOIN projects p ON p.id = n.project_id WHERE n.kind IN ('ref', 'sketch') ORDER BY n.updated_at DESC",
    )
    .all();
  const { docs } = load();
  return rows.map((r) => {
    const d = parse(r.data);
    const doc = r.ref_id ? docs.get(r.ref_id) : undefined;
    return {
      project: r.project, kind: r.kind, id: r.kind === "ref" ? r.ref_id ?? r.id : r.id,
      title: r.kind === "sketch" ? String(d.title || "Untitled sketch") : doc ? title(doc) : "(removed from the library)",
      state: (REF_STATES.includes(d.state as RefState) ? d.state : "kept") as RefState,
      reason: String(d.reason ?? "").trim(),
    };
  });
}

const STARTER_REASONS = {
  ruled_out: ["Too generic", "Wrong mood", "Too busy", "Type doesn't fit", "Color is off"],
  chosen: ["The type", "The color", "The layout", "The mood", "The motion"],
};

/**
 * The reasons offered when the designer chooses or rules something out: the ones they've
 * given most often, in their words, filled up with a few plain starters.
 */
export function verdictReasons() {
  const all = judgedNodes().filter((j) => j.reason);
  const top = (state: "chosen" | "ruled_out") => {
    const n = new Map<string, { text: string; n: number }>();
    for (const j of all) {
      if (j.state !== state || j.reason.length > 40) continue;
      const k = j.reason.toLowerCase();
      n.set(k, { text: n.get(k)?.text ?? j.reason, n: (n.get(k)?.n ?? 0) + 1 });
    }
    const own = [...n.values()].sort((a, b) => b.n - a.n).map((x) => x.text);
    return [...new Set([...own, ...STARTER_REASONS[state]].map((x) => x.trim()))].filter((x, i, list) => list.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 5);
  };
  return { chosen: top("chosen"), ruled_out: top("ruled_out") };
}

/** Every verdict the designer has given, across projects, grouped by the reason: what they keep choosing and keep ruling out. */
export function verdicts() {
  const all = judgedNodes();
  const groups = new Map<string, { verdict: string; reason: string; times: number; examples: string[] }>();
  for (const j of all) {
    if (!j.reason || (j.state !== "chosen" && j.state !== "ruled_out")) continue;
    const k = `${j.state}:${j.reason.toLowerCase()}`;
    const g = groups.get(k) ?? groups.set(k, { verdict: j.state.replace("_", " "), reason: j.reason, times: 0, examples: [] }).get(k)!;
    g.times++;
    if (g.examples.length < 5) g.examples.push(`${j.kind === "ref" ? `save ${j.id}` : `sketch ${j.id}`} “${j.title}” (${j.project})`);
  }
  const count = (s: RefState) => all.filter((j) => j.state === s).length;
  return {
    chosen: count("chosen"), kept: count("kept"), ruled_out: count("ruled_out"), still_suggested: count("proposed"),
    without_a_reason: all.filter((j) => (j.state === "chosen" || j.state === "ruled_out") && !j.reason).length,
    by_reason: [...groups.values()].sort((a, b) => b.times - a.times),
    how_to_read: "These are the designer's own verdicts and words, across every project. A reason that keeps coming back is their taste: lean on it when you suggest, place or sketch. When one has come up 3 times or more and unugly.md (get_design_rules) doesn't say it yet, tell the designer once, with the examples, and offer one line they could add to unugly.md in their own words. Never add it yourself.",
  };
}

// ---------- The project as an AI reads it ----------

const FACET_NAMES: Record<string, string> = { typography: "Typography", color: "Color", layout: "Layout", imagery: "Imagery", motion: "Motion", components: "Components" };
/** A topic's name: what the designer called it, else its kind (an unnamed Color topic is "Color"). */
const topicName = (n: BoardNode) => String(n.data.title || "").trim() || FACET_NAMES[String(n.data.facet)] || "Untitled topic";

const title = (d: Doc) => (d.r.title || d.profile?.summary?.split(/(?<=\.)\s/)[0] || d.r.source_url || "Untitled").replace(/\s+/g, " ").trim().slice(0, 100);

/** What a save offers for one facet, in a line or two. */
function offer(d: Doc, facet?: string) {
  const p = d.profile;
  if (!p) return undefined;
  if (facet === "typography") return [p.typography?.summary, p.typography?.likely_fonts?.length ? `likely fonts: ${p.typography.likely_fonts.join(", ")}` : ""].filter(Boolean).join(" · ") || undefined;
  if (facet === "color") return [p.color?.summary, d.palette.filter((s) => s.share >= 0.03).slice(0, 6).map((s) => `${s.hex} ${s.name}`).join(", ")].filter(Boolean).join(" · ") || undefined;
  if (facet === "layout") return p.layout?.summary;
  if (facet === "imagery") return p.imagery?.summary;
  if (facet === "motion") return p.motion?.summary;
  if (facet === "components") return p.components?.join(", ");
  return p.summary;
}

/**
 * The whole canvas as decisions: each topic with its status, the saves under it (chosen,
 * kept, ruled out) and what the designer wrote about them; then what isn't filed yet.
 * Topics come in the order they were connected (Typography → Color → …).
 */
export function summary(idOrName: string) {
  const p = findProject(idOrName);
  if (!p) throw new Error(`No project called “${idOrName}”. list_projects shows them.`);
  const full = getProject(p.id)!;
  const { docs } = load();
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const links = new Map<string, Set<string>>();
  for (const e of full.edges) {
    (links.get(e.source) ?? links.set(e.source, new Set()).get(e.source)!).add(e.target);
    (links.get(e.target) ?? links.set(e.target, new Set()).get(e.target)!).add(e.source);
  }
  const near = (id: string, kind: BoardNode["kind"]) => [...(links.get(id) ?? [])].map((x) => byId.get(x)!).filter((n) => n?.kind === kind);
  const noteText = (id: string) => near(id, "note").map((n) => String(n.data.text ?? "").trim()).filter(Boolean);
  const topics = full.nodes.filter((n) => n.kind === "topic");

  // Order topics along the flow: follow topic→topic edges from the ones nothing points to.
  const flowTo = new Map<string, string[]>();
  const pointedAt = new Set<string>();
  for (const e of full.edges) {
    if (byId.get(e.source)?.kind === "topic" && byId.get(e.target)?.kind === "topic") {
      (flowTo.get(e.source) ?? flowTo.set(e.source, []).get(e.source)!).push(e.target);
      pointedAt.add(e.target);
    }
  }
  const ordered: BoardNode[] = [];
  const seen = new Set<string>();
  const visit = (n: BoardNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    ordered.push(n);
    for (const t of (flowTo.get(n.id) ?? []).map((x) => byId.get(x)!).sort((a, b) => a.x - b.x)) visit(t);
  };
  const byPlace = [...topics].sort((a, b) => a.x - b.x || a.y - b.y);
  byPlace.filter((t) => !pointedAt.has(t.id)).forEach(visit);
  byPlace.forEach(visit);

  const refView = (n: BoardNode, facet?: string) => {
    const d = docs.get(n.ref_id!);
    return {
      id: n.ref_id,
      title: d ? title(d) : "(hidden or removed from the library)",
      taking: (n.data.taking as string) || undefined,
      designer_reason: (n.data.reason as string) || undefined,
      why: noteText(n.id).length ? noteText(n.id) : undefined,
      offers: d ? offer(d, facet) : undefined,
      by_assistant: n.origin === "assistant" || undefined,
      open: n.ref_id ? panelUrl(n.ref_id) : undefined,
    };
  };

  const filed = new Set<string>();
  const decisions = ordered.map((t) => {
    const facet = t.data.facet as string | undefined;
    const refs = near(t.id, "ref");
    refs.forEach((r) => filed.add(r.id));
    near(t.id, "note").forEach((n) => filed.add(n.id));
    const group = (s: RefState) => refs.filter((r) => (r.data.state ?? "kept") === s).map((r) => refView(r, facet));
    const chosen = group("chosen"), kept = group("kept"), proposed = group("proposed"), ruled_out = group("ruled_out");
    return {
      topic: topicName(t),
      facet,
      status: t.data.status === "locked" ? "locked" : "exploring",
      decision: (t.data.summary as string) || undefined,
      notes: noteText(t.id).length ? noteText(t.id) : undefined,
      chosen: chosen.length ? chosen : undefined,
      kept: kept.length ? kept : undefined,
      proposed: proposed.length ? proposed : undefined,
      ruled_out: ruled_out.length ? ruled_out : undefined,
      leads_to: (flowTo.get(t.id) ?? []).map((x) => topicName(byId.get(x)!)),
    };
  });

  // Sketches, each with what it's linked to (the topic, saves or sketch it came from) and the notes on it.
  const sketches = full.nodes.filter((n) => n.kind === "sketch").map((n) => {
    near(n.id, "note").forEach((x) => filed.add(x.id));
    const linked = [...(links.get(n.id) ?? [])].map((x) => byId.get(x)!).filter((x) => x && x.kind !== "note").map((x) =>
      x.kind === "topic" ? `topic ${topicName(x)}` : x.kind === "ref" ? `save ${x.ref_id}` : x.kind === "build" ? `build ${String(x.data.build ?? "")} (Claude Code building it)` : `sketch ${x.id} (${String(x.data.title || "untitled")})`);
    const version = Number(n.data.version) || 1;
    return {
      sketch: n.id,
      title: String(n.data.title || "Untitled sketch"),
      tries: (n.data.tries as string) || undefined,
      state: String(n.data.state ?? "kept"),
      why_ruled_out: n.data.state === "ruled_out" && n.data.reason ? String(n.data.reason) : undefined,
      why_chosen: n.data.state === "chosen" && n.data.reason ? String(n.data.reason) : undefined,
      device: n.data.device && n.data.device !== "desktop" ? String(n.data.device) : undefined,
      version,
      versions: versionsOf(p.id, n.id).length || undefined,
      linked: linked.length ? linked : undefined,
      notes: noteText(n.id).length ? noteText(n.id) : undefined,
      by_assistant: n.origin === "assistant" || undefined,
      page: fullUrl(sketchPath(p.id, n.id, version)),
    };
  });

  // Notes attached to a filed save are already said with it.
  for (const n of full.nodes) if (n.kind === "ref" && filed.has(n.id)) near(n.id, "note").forEach((x) => filed.add(x.id));
  const looseRefs = full.nodes.filter((n) => n.kind === "ref" && !filed.has(n.id));
  const looseNotes = full.nodes.filter((n) => n.kind === "note" && !filed.has(n.id) && !near(n.id, "ref").some((r) => looseRefs.includes(r)));

  return {
    project: p.name,
    id: p.id,
    brief: p.brief || undefined,
    materials: (() => {
      const m = materialsForSummary(p.id);
      return m.length ? m : undefined;
    })(),
    updated_at: p.updated_at,
    decisions,
    sketches: sketches.length ? sketches : undefined,
    builds: (() => {
      const b = full.nodes.filter((n) => n.kind === "build").map((n) => buildSummary(String(n.data.build ?? ""))).filter(Boolean);
      return b.length ? b : undefined;
    })(),
    not_filed_yet: looseRefs.length || looseNotes.length
      ? {
          saves: looseRefs.length ? looseRefs.map((r) => refView(r)) : undefined,
          notes: looseNotes.length ? looseNotes.map((n) => String(n.data.text ?? "").trim()).filter(Boolean) : undefined,
        }
      : undefined,
    how_to_read: "The brief and materials say what the project is: read the materials that matter with get_project_material before designing. Locked topics are settled: build from their chosen saves and notes. Ruled-out saves say what to avoid. The designer's notes outrank the saves' reads. Sketches are quick pages tried for this project (suggested, kept, chosen, ruled out like saves, with the designer's reason when they gave one); look at one with get_sketch before talking about it. Builds are Claude Code making a chosen sketch for real in the designer's code.",
    open: `http://127.0.0.1:${PORT}/?project=${p.id}`,
  };
}

/**
 * What the designer selected on a canvas, in words for the assistant: each topic with
 * its status and decision, each save as [[id]] with its state and why, each note's text.
 */
export function describeSelection(projectId: string, nodeIds: string[]) {
  const full = getProject(projectId);
  if (!full) return [];
  const { docs } = load();
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const near = (id: string) =>
    full.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])).map((x) => byId.get(x)!).filter(Boolean);
  return nodeIds.slice(0, 40).flatMap((id) => {
    const n = byId.get(id);
    if (!n) return [];
    if (n.kind === "topic") {
      const refs = near(n.id).filter((x) => x.kind === "ref");
      const chosen = refs.filter((r) => r.data.state === "chosen").map((r) => `[[${r.ref_id}]]`);
      return [`the topic “${topicName(n)}” (${n.data.status === "locked" ? "locked" : "exploring"}${n.data.summary ? `; decision: ${String(n.data.summary)}` : ""}; ${refs.length} saves under it${chosen.length ? `, chosen: ${chosen.join(" ")}` : ""})`];
    }
    if (n.kind === "ref") {
      const d = docs.get(n.ref_id!);
      const under = near(n.id).filter((x) => x.kind === "topic").map(topicName);
      const notes = near(n.id).filter((x) => x.kind === "note").map((x) => String(x.data.text ?? "").trim()).filter(Boolean);
      const bits = [
        String(n.data.state ?? "kept").replace("_", " "),
        under.length ? `under ${under.join(", ")}` : "not under a topic",
        n.data.taking ? `why: ${String(n.data.taking)}` : "",
        n.data.reason ? `designer's reason: ${String(n.data.reason)}` : "",
        notes.length ? `designer's note: ${notes.join(" / ")}` : "",
      ].filter(Boolean);
      return [`the save [[${n.ref_id}]] ${d ? `“${title(d)}” ` : ""}(${bits.join("; ")})`];
    }
    if (n.kind === "sketch") {
      const notes = near(n.id).filter((x) => x.kind === "note").map((x) => String(x.data.text ?? "").trim()).filter(Boolean);
      const bits = [
        `id ${n.id}`,
        `version ${Number(n.data.version) || 1}`,
        String(n.data.state ?? "kept").replace("_", " "),
        n.data.tries ? `tries: ${String(n.data.tries)}` : "",
        n.data.reason ? `designer's reason: ${String(n.data.reason)}` : "",
        notes.length ? `designer's note: ${notes.join(" / ")}` : "",
      ].filter(Boolean);
      return [`the sketch “${String(n.data.title || "Untitled sketch")}” (${bits.join("; ")}; look at it with get_sketch, change it with edit_sketch)`];
    }
    if (n.kind === "build") {
      const b = buildSummary(String(n.data.build ?? ""));
      return b ? [`the build “${b.title}” (build ${b.build}; ${b.status}; in ${b.folder}${b.branch ? ` on branch ${b.branch}` : ""}; follow up with message_build)`] : [];
    }
    const text = String(n.data.text ?? "").trim();
    return text ? [`a note: “${text}”`] : [];
  });
}

/** The saves a project chose, for looking at their pictures. */
export function chosenRefs(idOrName: string) {
  const p = findProject(idOrName);
  if (!p) return [];
  return db
    .query<{ ref_id: string }, [string]>("SELECT ref_id FROM board_nodes WHERE project_id = ? AND kind = 'ref' AND json_extract(data, '$.state') = 'chosen'")
    .all(p.id)
    .map((r) => r.ref_id);
}

/** Projects a save is part of, and how: for showing alongside the save. */
export function projectsOf(refId: string) {
  return db
    .query<{ id: string; name: string; state: string | null }, [string]>(
      `SELECT p.id, p.name, json_extract(n.data, '$.state') state FROM board_nodes n JOIN projects p ON p.id = n.project_id
       WHERE n.ref_id = ? AND n.kind = 'ref' ORDER BY p.updated_at DESC`,
    )
    .all(refId);
}
