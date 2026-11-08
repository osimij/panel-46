// What Claude can do on a project's canvas, in the designer's words rather than in
// coordinates: put saves under a topic, add a topic, connect two, write a note, mark saves,
// lock a decision. Each is one logged change (so one undo) with a few words saying what
// it did. Placement is worked out here: under a topic in rows of three, a new topic to the
// right of the one it follows, a note beside what it's about.

import { newId } from "./db.ts";
import { load } from "./library.ts";
import { apply, findProject, getProject, TOPIC_FACETS, type BoardNode, type Op, type RefState, type TopicFacet } from "./projects.ts";
import { PORT } from "./config.ts";

const FACET_NAMES: Record<string, string> = { typography: "Typography", color: "Color", layout: "Layout", imagery: "Imagery", motion: "Motion", components: "Components", other: "Other" };
const SIZE = { topic: { w: 248, h: 140 }, ref: { w: 220, h: 370 }, note: { w: 228, h: 100 } };
/** Columns of saves under a topic, and the room each takes (a tall save with its why fits). */
const COL = 236, ROW = 400, PER_ROW = 3;
/** How far right the next topic goes: past three columns of saves. */
const TOPIC_STEP = 760;

const name = (n: BoardNode) => String(n.data.title || "").trim() || FACET_NAMES[String(n.data.facet)] || "Untitled topic";
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function board(project: string) {
  const p = findProject(project);
  if (!p) throw new Error(`No project called “${project}”. list_projects shows them.`);
  const full = getProject(p.id)!;
  const linked = (id: string) =>
    new Set(full.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])));
  return { p, full, linked };
}

type Board = ReturnType<typeof board>;

/** A topic by its id, its name, or its kind ("type" and "fonts" find Typography). */
function findTopic(b: Board, topic: string) {
  const topics = b.full.nodes.filter((n) => n.kind === "topic");
  const want = words(topic);
  const facet = facetFor(topic);
  return (
    topics.find((t) => t.id === topic) ??
    topics.find((t) => words(name(t)) === want) ??
    (facet ? topics.find((t) => t.data.facet === facet) : undefined) ??
    topics.find((t) => words(name(t)).includes(want) || want.includes(words(name(t))))
  );
}

function facetFor(s: string): TopicFacet | undefined {
  const w = words(s);
  if (TOPIC_FACETS.includes(w as TopicFacet)) return w as TopicFacet;
  if (/\b(type|typo|font|fonts|typeface|lettering)\b/.test(w)) return "typography";
  if (/\b(colou?rs?|palette|tones?)\b/.test(w)) return "color";
  if (/\b(layout|grid|composition|structure)\b/.test(w)) return "layout";
  if (/\b(image|imagery|photo|photography|illustration)\b/.test(w)) return "imagery";
  if (/\b(motion|animation|transitions?|interaction)\b/.test(w)) return "motion";
  if (/\b(components?|ui|buttons?|forms?)\b/.test(w)) return "components";
  return undefined;
}

const overlaps = (b: Board, x: number, y: number, w: number, h: number, gap = 12) =>
  b.full.nodes.some((n) => {
    const s = SIZE[n.kind];
    return !(x + w + gap <= n.x || x >= n.x + s.w + gap || y + h + gap <= n.y || y >= n.y + s.h + gap);
  });

/** Where a new topic goes: right of the one it follows (or of the last topic), on free ground. */
function topicSpot(b: Board, after?: BoardNode) {
  const topics = b.full.nodes.filter((n) => n.kind === "topic");
  const from = after ?? [...topics].sort((a, c) => c.x - a.x)[0];
  let x: number, y: number;
  if (from) [x, y] = [from.x + TOPIC_STEP, from.y];
  else if (b.full.nodes.length) [x, y] = [Math.max(...b.full.nodes.map((n) => n.x + SIZE[n.kind].w)) + 160, Math.min(...b.full.nodes.map((n) => n.y))];
  else [x, y] = [0, 0];
  for (let i = 0; i < 12 && overlaps(b, x, y, SIZE.topic.w, SIZE.topic.h); i++) x += TOPIC_STEP;
  return { x, y };
}

/**
 * Spots for new saves under a topic: rows of three from below whatever is under it
 * already, skipping any spot something else on the canvas is in.
 */
function slotsUnder(b: Board, topic: BoardNode, count: number) {
  const kids = b.full.nodes.filter((n) => n.kind === "ref" && b.linked(topic.id).has(n.id));
  const top = kids.length ? Math.max(...kids.map((n) => n.y)) + ROW : topic.y + SIZE.topic.h + 64;
  const out: { x: number; y: number }[] = [];
  for (let r = 0; out.length < count && r < 80; r++) {
    for (let c = 0; c < PER_ROW && out.length < count; c++) {
      const spot = { x: topic.x - 4 + c * COL, y: top + r * ROW };
      if (!overlaps(b, spot.x, spot.y, SIZE.ref.w, SIZE.ref.h)) out.push(spot);
    }
  }
  return out;
}

function newTopicOps(b: Board, title: string, facet: TopicFacet | undefined, after?: BoardNode) {
  const id = newId();
  const at = topicSpot(b, after);
  const ops: Op[] = [{ op: "add_node", node: { id, kind: "topic", data: { title, facet: facet ?? "other", status: "exploring" }, ...at } }];
  if (after) ops.push({ op: "add_edge", edge: { source: after.id, target: id } });
  // Later spots in the same change see it, so they don't land on it.
  b.full.nodes.push({ id, kind: "topic", ref_id: null, data: { title, facet }, x: at.x, y: at.y, origin: "assistant", created_at: "" });
  return { id, ops, node: b.full.nodes.at(-1)! };
}

const titleOf = (refId: string) => {
  const d = load().docs.get(refId);
  return d ? (d.r.title || d.profile?.summary?.split(/(?<=\.)\s/)[0] || "Untitled").replace(/\s+/g, " ").slice(0, 90) : undefined;
};

// ---------- The tools' logic ----------

export function placeOnBoard(o: { project: string; topic: string; saves: { id: string; why?: string }[]; after_topic?: string }) {
  const b = board(o.project);
  const ops: Op[] = [];
  let topic = findTopic(b, o.topic);
  let created = false;
  if (!topic) {
    const after = o.after_topic ? findTopic(b, o.after_topic) : undefined;
    const facet = facetFor(o.topic);
    // "Typography" names itself by its kind; anything else keeps the words given ("Type scale").
    const words_ = o.topic.trim();
    const title = facet && FACET_NAMES[facet]!.toLowerCase() === words_.toLowerCase() ? "" : words_.charAt(0).toUpperCase() + words_.slice(1);
    const t = newTopicOps(b, title, facet, after);
    ops.push(...t.ops);
    topic = t.node;
    created = true;
  }
  const { docs } = load();
  const already = new Set(b.full.nodes.filter((n) => n.kind === "ref" && b.linked(topic!.id).has(n.id)).map((n) => n.ref_id));
  const seen = new Set<string>();
  const fresh = o.saves.filter((s) => {
    const ok = docs.has(s.id) && !already.has(s.id) && !seen.has(s.id);
    seen.add(s.id);
    return ok;
  });
  const spots = slotsUnder(b, topic, fresh.length);
  fresh.forEach((s, i) => {
    const id = newId();
    ops.push({ op: "add_node", node: { id, kind: "ref", ref_id: s.id, data: { state: "proposed", taking: s.why?.trim().slice(0, 200) }, ...spots[i]! } });
    ops.push({ op: "add_edge", edge: { source: topic!.id, target: id } });
  });
  const tName = name(topic);
  const label = fresh.length ? `Placed ${fresh.length} ${fresh.length === 1 ? "save" : "saves"} under ${tName}` : `Added ${tName}`;
  if (ops.length) apply(b.p.id, ops, "assistant", { label });
  return {
    topic: tName,
    created_topic: created || undefined,
    placed: fresh.map((s) => ({ id: s.id, title: titleOf(s.id) })),
    already_there: o.saves.filter((s) => already.has(s.id)).map((s) => s.id),
    not_in_library: o.saves.filter((s) => !docs.has(s.id)).map((s) => s.id),
    note: "They're on the canvas as suggestions; the designer chooses, keeps or rules them out.",
  };
}

export function addTopic(o: { project: string; title: string; facet?: TopicFacet; after?: string }) {
  const b = board(o.project);
  const existing = findTopic(b, o.title);
  if (existing && words(name(existing)) === words(o.title)) return { topic: name(existing), already_there: true };
  const after = o.after ? findTopic(b, o.after) : undefined;
  if (o.after && !after) throw new Error(`No topic “${o.after}” on this canvas.`);
  const facet = o.facet ?? facetFor(o.title);
  const t = newTopicOps(b, o.title.trim(), facet, after);
  apply(b.p.id, t.ops, "assistant", { label: `Added ${o.title.trim()}${after ? ` after ${name(after)}` : ""}` });
  return { topic: o.title.trim(), facet, after: after ? name(after) : undefined };
}

export function connectTopics(o: { project: string; from: string; to: string }) {
  const b = board(o.project);
  const from = findTopic(b, o.from), to = findTopic(b, o.to);
  if (!from || !to) throw new Error(`No topic “${!from ? o.from : o.to}” on this canvas.`);
  apply(b.p.id, [{ op: "add_edge", edge: { source: from.id, target: to.id } }], "assistant", { label: `Connected ${name(from)} to ${name(to)}` });
  return { connected: `${name(from)} → ${name(to)}` };
}

export function addNote(o: { project: string; text: string; on?: string }) {
  const b = board(o.project);
  let target: BoardNode | undefined;
  if (o.on) {
    target = b.full.nodes.find((n) => n.kind === "ref" && n.ref_id === o.on) ?? findTopic(b, o.on);
    if (!target) throw new Error(`Nothing called “${o.on}” on this canvas: give a topic's name or a save's id.`);
  }
  const id = newId();
  let at: { x: number; y: number };
  if (target) {
    const s = SIZE[target.kind];
    const spots = [{ x: target.x + s.w + 36, y: target.y + 12 }, { x: target.x, y: target.y + s.h + 36 }, { x: target.x - SIZE.note.w - 36, y: target.y + 12 }];
    at = spots.find((p) => !overlaps(b, p.x, p.y, SIZE.note.w, SIZE.note.h)) ?? spots[0]!;
  } else at = topicSpot(b);
  const ops: Op[] = [{ op: "add_node", node: { id, kind: "note", data: { text: o.text.trim().slice(0, 4000) }, ...at } }];
  if (target) ops.push({ op: "add_edge", edge: { source: id, target: target.id } });
  apply(b.p.id, ops, "assistant", { label: target ? `Added a note on ${target.kind === "topic" ? name(target) : "a save"}` : "Added a note" });
  return { added: true };
}

const STATE_WORD: Record<RefState, string> = { chosen: "Chose", kept: "Kept", ruled_out: "Ruled out", proposed: "Suggested" };

export function markSaves(o: { project: string; ids: string[]; state: RefState; topic?: string }) {
  const b = board(o.project);
  const topic = o.topic ? findTopic(b, o.topic) : undefined;
  if (o.topic && !topic) throw new Error(`No topic “${o.topic}” on this canvas.`);
  const scope = topic ? b.linked(topic.id) : null;
  const nodes = b.full.nodes.filter((n) => n.kind === "ref" && o.ids.includes(n.ref_id!) && (!scope || scope.has(n.id)));
  if (!nodes.length) throw new Error("None of those saves are on this canvas" + (topic ? ` under ${name(topic)}` : "") + ".");
  apply(b.p.id, nodes.map((n) => ({ op: "update_node" as const, id: n.id, data: { state: o.state } })), "assistant", {
    label: `${STATE_WORD[o.state]} ${nodes.length} ${nodes.length === 1 ? "save" : "saves"}${topic ? ` under ${name(topic)}` : ""}`,
  });
  return { marked: nodes.length, state: o.state, missing: o.ids.filter((id) => !nodes.some((n) => n.ref_id === id)) };
}

export function lockTopic(o: { project: string; topic: string; decision?: string; choose?: string[]; unlock?: boolean }) {
  const b = board(o.project);
  const topic = findTopic(b, o.topic);
  if (!topic) throw new Error(`No topic “${o.topic}” on this canvas.`);
  const ops: Op[] = [{ op: "update_node", id: topic.id, data: { status: o.unlock ? "exploring" : "locked", ...(o.decision !== undefined ? { summary: o.decision } : {}) } }];
  const kids = b.full.nodes.filter((n) => n.kind === "ref" && b.linked(topic.id).has(n.id));
  for (const n of kids) if (o.choose?.includes(n.ref_id!)) ops.push({ op: "update_node", id: n.id, data: { state: "chosen" } });
  apply(b.p.id, ops, "assistant", { label: `${o.unlock ? "Reopened" : "Locked"} ${name(topic)}` });
  const chosen = kids.filter((n) => n.data.state === "chosen" || o.choose?.includes(n.ref_id!)).map((n) => n.ref_id);
  return { topic: name(topic), status: o.unlock ? "exploring" : "locked", chosen };
}

/** For tools that want the project's link. */
export const projectLink = (project: string) => {
  const p = findProject(project);
  return p ? `http://127.0.0.1:${PORT}/?project=${p.id}` : undefined;
};

