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

// ---------- What's on a canvas ----------

export const TOPIC_FACETS = ["typography", "color", "layout", "imagery", "motion", "components", "other"] as const;
export type TopicFacet = (typeof TOPIC_FACETS)[number];
/** A save's place under a topic: chosen (the pick), kept (in the running), ruled out, or proposed (by the assistant, not yet looked at). */
export const REF_STATES = ["proposed", "kept", "chosen", "ruled_out"] as const;
export type RefState = (typeof REF_STATES)[number];

export interface TopicData { title: string; facet?: TopicFacet; status?: "exploring" | "locked"; summary?: string }
export interface RefData { state?: RefState; taking?: string }
export interface NoteData { text: string }

export interface BoardNode {
  id: string;
  kind: "topic" | "ref" | "note";
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

const KINDS = new Set(["topic", "ref", "note"]);
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
  } else if ("text" in data) out.text = str(data.text, 8000) ?? "";
  return out;
}

/**
 * Apply ops to a project, in one transaction, and log them. Ops that refer to something
 * already gone are skipped quietly (two windows deleting the same node is fine).
 * Returns the ops as applied (with ids filled in) and the new sequence number.
 */
export function apply(projectId: string, ops: Op[], actor: "designer" | "assistant" | "mcp" = "designer", client: string | null = null) {
  const p = rowOf(projectId);
  if (!p) throw new Error("That project is gone.");
  if (!Array.isArray(ops) || !ops.length) return { seq: p.seq, ops: [] as Op[] };
  if (ops.length > 500) throw new Error("Too many changes at once.");
  const done: Op[] = [];
  const ts = now();
  const owned = (id: string) => db.query<NodeRow, [string, string]>("SELECT * FROM board_nodes WHERE id = ? AND project_id = ?").get(id, projectId);

  const seq = db.transaction(() => {
    for (const o of ops) {
      if (o.op === "add_node") {
        const n = o.node;
        if (!n || !KINDS.has(n.kind)) continue;
        if (n.kind === "ref" && !(n.ref_id && db.query("SELECT 1 FROM refs WHERE id = ?").get(n.ref_id))) continue;
        const id = n.id && /^[0-9a-z]{8,32}$/.test(n.id) && !owned(n.id) ? n.id : newId();
        const data = cleanData(n.kind, n.data ?? {});
        if (n.kind === "ref" && !data.state) data.state = actor === "designer" ? "kept" : "proposed";
        if (n.kind === "topic" && !data.status) data.status = "exploring";
        const origin = actor === "designer" ? "designer" : "assistant";
        db.run(
          "INSERT INTO board_nodes (id, project_id, kind, ref_id, data, x, y, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, projectId, n.kind, n.kind === "ref" ? n.ref_id! : null, JSON.stringify(data), finite(n.x), finite(n.y), origin, ts, ts],
        );
        done.push({ op: "add_node", node: { id, kind: n.kind, ref_id: n.kind === "ref" ? n.ref_id! : null, data, x: finite(n.x), y: finite(n.y) } });
      } else if (o.op === "update_node") {
        const row = owned(o.id);
        if (!row) continue;
        const patch = o.data ? cleanData(row.kind, o.data) : undefined;
        const data = patch ? { ...parse(row.data), ...patch } : undefined;
        db.run("UPDATE board_nodes SET data = ?, x = ?, y = ?, updated_at = ? WHERE id = ?", [
          data ? JSON.stringify(data) : row.data, o.x === undefined ? row.x : finite(o.x), o.y === undefined ? row.y : finite(o.y), ts, o.id,
        ]);
        done.push({ op: "update_node", id: o.id, ...(patch ? { data: patch } : {}), ...(o.x !== undefined ? { x: finite(o.x) } : {}), ...(o.y !== undefined ? { y: finite(o.y) } : {}) });
      } else if (o.op === "remove_node") {
        if (!owned(o.id)) continue;
        db.run("DELETE FROM board_nodes WHERE id = ?", [o.id]);
        done.push({ op: "remove_node", id: o.id });
      } else if (o.op === "add_edge") {
        const e = o.edge;
        if (!e || e.source === e.target || !owned(e.source) || !owned(e.target)) continue;
        const dup = db
          .query<{ id: string }, [string, string, string, string]>(
            "SELECT id FROM board_edges WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)",
          )
          .get(e.source, e.target, e.target, e.source);
        if (dup) continue;
        const id = e.id && /^[0-9a-z]{8,32}$/.test(e.id) ? e.id : newId();
        const label = typeof e.label === "string" ? e.label.slice(0, 120) : "";
        db.run("INSERT INTO board_edges (id, project_id, source, target, label, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, projectId, e.source, e.target, label, ts]);
        done.push({ op: "add_edge", edge: { id, source: e.source, target: e.target, label } });
      } else if (o.op === "remove_edge") {
        const res = db.run("DELETE FROM board_edges WHERE id = ? AND project_id = ?", [o.id, projectId]);
        if (res.changes) done.push({ op: "remove_edge", id: o.id });
      } else if (o.op === "update_project") {
        const name = typeof o.name === "string" ? o.name.trim().slice(0, 120) : undefined;
        const brief = typeof o.brief === "string" ? o.brief.slice(0, 8000) : undefined;
        if (name) db.run("UPDATE projects SET name = ? WHERE id = ?", [name, projectId]);
        if (brief !== undefined) db.run("UPDATE projects SET brief = ? WHERE id = ?", [brief, projectId]);
        if (name || brief !== undefined) done.push({ op: "update_project", ...(name ? { name } : {}), ...(brief !== undefined ? { brief } : {}) });
      }
    }
    if (!done.length) return p.seq;
    db.run("UPDATE projects SET seq = seq + 1, updated_at = ? WHERE id = ?", [ts, projectId]);
    const next = rowOf(projectId)!.seq;
    db.run("INSERT INTO project_events (project_id, seq, at, actor, client, ops) VALUES (?, ?, ?, ?, ?, ?)", [projectId, next, ts, actor, client, JSON.stringify(done)]);
    return next;
  })();
  if (done.length) wake(projectId);
  return { seq, ops: done };
}

// ---------- Following a canvas live ----------

const waiting = new Map<string, Set<() => void>>();
function wake(projectId: string) {
  for (const f of waiting.get(projectId) ?? []) f();
}

interface EventRow { seq: number; at: string; actor: string; client: string | null; ops: string }

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
          .query<EventRow, [string, number]>("SELECT seq, at, actor, client, ops FROM project_events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT 200")
          .all(projectId, last);
        for (const r of rows) {
          last = r.seq;
          controller.enqueue(enc.encode(`id: ${r.seq}\ndata: ${JSON.stringify({ seq: r.seq, at: r.at, actor: r.actor, client: r.client, ops: JSON.parse(r.ops) })}\n\n`));
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

  // Notes attached to a filed save are already said with it.
  for (const n of full.nodes) if (n.kind === "ref" && filed.has(n.id)) near(n.id, "note").forEach((x) => filed.add(x.id));
  const looseRefs = full.nodes.filter((n) => n.kind === "ref" && !filed.has(n.id));
  const looseNotes = full.nodes.filter((n) => n.kind === "note" && !filed.has(n.id) && !near(n.id, "ref").some((r) => looseRefs.includes(r)));

  return {
    project: p.name,
    id: p.id,
    brief: p.brief || undefined,
    updated_at: p.updated_at,
    decisions,
    not_filed_yet: looseRefs.length || looseNotes.length
      ? {
          saves: looseRefs.length ? looseRefs.map((r) => refView(r)) : undefined,
          notes: looseNotes.length ? looseNotes.map((n) => String(n.data.text ?? "").trim()).filter(Boolean) : undefined,
        }
      : undefined,
    how_to_read: "Locked topics are settled: build from their chosen saves and notes. Ruled-out saves say what to avoid. The designer's notes outrank the saves' reads.",
    open: `http://127.0.0.1:${PORT}/?project=${p.id}`,
  };
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
