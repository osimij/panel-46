// What Claude can do on a project's canvas, in the designer's words rather than in
// coordinates: put saves under a topic, add a topic, connect two, write a note, mark saves,
// lock a decision. Each is one logged change (so one undo) with a few words saying what
// it did. Placement is worked out here: under a topic in rows of three, a new topic to the
// right of the one it follows, a note beside what it's about.

import { db, newId } from "./db.ts";
import { load } from "./library.ts";
import { apply, findProject, getProject, removedUnder, TOPIC_FACETS, type BoardNode, type Op, type RefState, type TopicFacet } from "./projects.ts";
import { PORT } from "./config.ts";
import { fullUrl, readSketch, renderOf, renderView, sketchPath, statesOf, versionNote, versionsOf, writeVersion, type Device, type Render, type VersionNote } from "./sketches.ts";
import { withVars } from "./pagevars.ts";
import { withText, type TextEdit } from "./pagetext.ts";
import { withParts, type PartRemove, type PartStyle } from "./pageparts.ts";
import { rememberedFrame } from "./figma.ts";
import { shortParts } from "./parts.ts";

const FACET_NAMES: Record<string, string> = { typography: "Typography", color: "Color", layout: "Layout", imagery: "Imagery", motion: "Motion", components: "Components", other: "Other" };
const SIZE = { topic: { w: 248, h: 140 }, ref: { w: 220, h: 370 }, note: { w: 228, h: 100 }, sketch: { w: 360, h: 300 }, build: { w: 380, h: 330 } };
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
  // Saves the designer took off this topic before stay off it: they can drag one back in themselves.
  const removed = created ? new Map<string, string>() : removedUnder(b.p.id, topic!.id);
  const seen = new Set<string>();
  const fresh = o.saves.filter((s) => {
    const ok = docs.has(s.id) && !already.has(s.id) && !seen.has(s.id) && !removed.has(s.id);
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
    removed_before: o.saves.some((s) => removed.has(s.id))
      ? [...new Set(o.saves.filter((s) => removed.has(s.id)).map((s) => s.id))].map((id) => ({ id, reason: removed.get(id) || undefined }))
      : undefined,
    note: "They're on the canvas as suggestions; the designer chooses, keeps or rules them out." +
      (o.saves.some((s) => removed.has(s.id)) ? " The designer took the ones in removed_before off this topic before. They can drag one back in from Saves." : ""),
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


// ---------- Sketches ----------

const sketchName = (n: BoardNode) => String(n.data.title || "").trim() || "Untitled sketch";

/** A sketch by its id or its title. */
function findSketch(b: Board, sketch: string) {
  const all = b.full.nodes.filter((n) => n.kind === "sketch");
  const want = words(sketch);
  return all.find((n) => n.id === sketch.trim()) ?? all.find((n) => words(sketchName(n)) === want) ?? all.find((n) => words(sketchName(n)).includes(want));
}

/** What a new sketch hangs from: a sketch (by id or title), a save on the canvas (by its id), or a topic. */
function findSource(b: Board, from: string) {
  const v = from.trim();
  return (
    b.full.nodes.find((n) => n.id === v) ??
    b.full.nodes.find((n) => n.kind === "ref" && n.ref_id === v) ??
    findSketch(b, v) ??
    findTopic(b, v)
  );
}

/**
 * Where a new sketch goes. From another sketch: in a column to its right, so branches of
 * one sketch stack together. From a topic or a save: in a row above it, clear of the saves
 * beneath topics. On its own: right of everything.
 */
function sketchSpot(b: Board, from?: BoardNode) {
  const { w: W, h: H } = SIZE.sketch;
  if (from) {
    const s = SIZE[from.kind];
    for (let i = 0; i < 24; i++) {
      const spot = from.kind === "sketch" ? { x: from.x + s.w + 110, y: from.y + i * (H + 56) } : { x: from.x + i * (W + 40), y: from.y - H - 90 };
      if (!overlaps(b, spot.x, spot.y, W, H)) return spot;
    }
  }
  if (!b.full.nodes.length) return { x: 0, y: 0 };
  return { x: Math.max(...b.full.nodes.map((n) => n.x + SIZE[n.kind].w)) + 160, y: Math.min(...b.full.nodes.map((n) => n.y)) };
}

export interface SketchResult {
  project: string;
  id: string;
  title: string;
  version: number;
  render: Render;
  /** The states it says it has (meta panel:states). */
  states?: string[];
  linked_saves?: string[];
}

export async function makeSketch(o: { project: string; title: string; tries?: string; html: string; from?: string; uses?: string[]; device?: Device }): Promise<SketchResult> {
  const first = board(o.project);
  if (o.from && !findSource(first, o.from)) throw new Error(`Nothing called “${o.from}” on this canvas: give a sketch's id or title, a save's id or a topic's name.`);
  const id = newId();
  const title = o.title.trim().slice(0, 120) || "Untitled sketch";
  const device = o.device && o.device !== "desktop" ? o.device : undefined;
  const { version, render } = await writeVersion(first.p.id, id, o.html, device, { by: "friday", what: o.tries ?? "" });
  // Rendering takes a few seconds; place it on the canvas as it is now.
  const b = board(o.project);
  const from = o.from ? findSource(b, o.from) : undefined;
  const ops: Op[] = [{ op: "add_node", node: { id, kind: "sketch", data: { title, tries: o.tries?.trim().slice(0, 300), state: "proposed", version, ...(device ? { device } : {}) }, ...sketchSpot(b, from) } }];
  if (from) ops.push({ op: "add_edge", edge: { source: from.id, target: id } });
  // The saves it took from, when they're on the canvas: a line from each, so the designer sees where it came from.
  const used: string[] = [];
  for (const ref of new Set(o.uses ?? [])) {
    const n = b.full.nodes.find((x) => x.kind === "ref" && x.ref_id === ref);
    if (n && n.id !== from?.id) {
      ops.push({ op: "add_edge", edge: { source: n.id, target: id, label: "uses" } });
      used.push(ref);
    }
  }
  apply(b.p.id, ops, "assistant", { label: `Sketched ${title}` });
  return { project: b.p.id, id, title, version, render, states: statesOf(o.html).map((x) => `${x.name} (#${x.slug})`), linked_saves: used.length ? used : undefined };
}

export interface Edit { find: string; replace: string; all?: boolean }

export async function editSketch(o: { project: string; sketch: string; html?: string; edits?: Edit[]; from_version?: number; title?: string; tries?: string }): Promise<SketchResult> {
  const b = board(o.project);
  const node = findSketch(b, o.sketch);
  if (!node) throw new Error(`No sketch “${o.sketch}” on this canvas. get_project lists the sketches.`);
  const base = o.from_version ?? (Number(node.data.version) || 1);
  if (!versionsOf(b.p.id, node.id).includes(base)) throw new Error(`That sketch has no version ${base}.`);
  const meta: Record<string, unknown> = {};
  if (o.title?.trim()) meta.title = o.title.trim().slice(0, 120);
  if (o.tries !== undefined) meta.tries = o.tries.trim().slice(0, 300);
  const title = String(meta.title ?? sketchName(node));

  let html: string | undefined;
  if (o.html) html = o.html;
  else if (o.edits?.length) {
    // Edits are made on the page as get_sketch shows it: ready-made parts as their short tags.
    // Saving fills them in again, so the parts an edit doesn't touch come back byte for byte.
    html = shortParts(readSketch(b.p.id, node.id, base));
    for (const e of o.edits) {
      const n = e.find ? html.split(e.find).length - 1 : 0;
      if (!n) throw new Error(`Couldn't find this in version ${base} of the sketch, so nothing was changed: “${e.find.slice(0, 120)}”. get_sketch shows its page as it is.`);
      if (n > 1 && !e.all) throw new Error(`This is in the sketch ${n} times, so nothing was changed: “${e.find.slice(0, 120)}”. Include more around it, or set all: true.`);
      html = e.all ? html.split(e.find).join(e.replace) : html.replace(e.find, () => e.replace);
    }
  } else if (o.from_version) html = readSketch(b.p.id, node.id, base);

  if (html === undefined) {
    if (!Object.keys(meta).length) throw new Error("Nothing to change: give html, edits, or a new title or tries.");
    apply(b.p.id, [{ op: "update_node", id: node.id, data: meta }], "assistant", { label: `Renamed a sketch to ${title}` });
    const v = Number(node.data.version) || 1;
    return { project: b.p.id, id: node.id, title, version: v, render: renderOf(b.p.id, node.id, v) };
  }
  const { version, render } = await writeVersion(b.p.id, node.id, html, node.data.device as Device | undefined, { by: "friday", what: o.tries ?? "" });
  apply(b.p.id, [{ op: "update_node", id: node.id, data: { ...meta, version } }], "assistant", { label: `Changed ${title} (version ${version})` });
  return { project: b.p.id, id: node.id, title, version, render, states: statesOf(html).map((x) => `${x.name} (#${x.slug})`) };
}

/**
 * The studio's knobs: a new version of a sketch with some of its :root variables changed
 * by the designer (a color, a radius, a font). No AI involved; everything else in the page
 * stays exactly as it was.
 */
export async function setSketchVars(projectId: string, sketchId: string, vars: Record<string, string>, fromVersion?: number) {
  const b = board(projectId);
  const node = findSketch(b, sketchId);
  if (!node) throw new Error("That sketch is gone.");
  const base = fromVersion ?? (Number(node.data.version) || 1);
  if (!versionsOf(b.p.id, node.id).includes(base)) throw new Error(`That sketch has no version ${base}.`);
  const html = withVars(readSketch(b.p.id, node.id, base), vars);
  const n = Object.keys(vars).length;
  const { version, render } = await writeVersion(b.p.id, node.id, html, node.data.device as Device | undefined, { by: "you", what: `Changed ${n} ${n === 1 ? "value" : "values"}` });
  apply(b.p.id, [{ op: "update_node", id: node.id, data: { version } }], "designer", { label: `Changed ${n} ${n === 1 ? "value" : "values"} in ${sketchName(node)} (version ${version})` });
  return { version, rules: render.rules ?? [], errors: render.errors.length };
}

/** The studio's own text edit: the designer changed some words in place; a new version with them, no AI involved. */
export async function setSketchText(projectId: string, sketchId: string, edit: TextEdit, fromVersion?: number) {
  const b = board(projectId);
  const node = findSketch(b, sketchId);
  if (!node) throw new Error("That sketch is gone.");
  const base = fromVersion ?? (Number(node.data.version) || 1);
  if (!versionsOf(b.p.id, node.id).includes(base)) throw new Error(`That sketch has no version ${base}.`);
  const before = readSketch(b.p.id, node.id, base);
  const html = withText(before, edit);
  if (html === before) return { version: base, rules: [], errors: 0, new_errors: 0 };
  const words = edit.afterText.replace(/\s+/g, " ").trim();
  const said = words.length > 40 ? `${words.slice(0, 39)}…` : words;
  const { version, render } = await writeVersion(b.p.id, node.id, html, node.data.device as Device | undefined, { by: "you", what: `Changed the words to “${said}”` });
  apply(b.p.id, [{ op: "update_node", id: node.id, data: { version } }], "designer", { label: `Changed the words to “${said}” in ${sketchName(node)} (version ${version})` });
  return { version, rules: render.rules ?? [], errors: render.errors.length };
}

/**
 * The studio's Save: everything the designer changed by hand on one version (words edited in
 * place, knobs moved, a part's own look, parts deleted), written as ONE new version, no AI
 * involved. Five word changes and a color are one save, not six versions.
 *
 * With check, nothing is written: it only says whether every change still fits the page. The
 * studio asks this as each word edit is made, so one that can't be kept is turned down while
 * the designer is looking at it, not later when they press Save.
 */
export async function saveSketchChanges(
  projectId: string,
  sketchId: string,
  changes: { edits?: TextEdit[]; vars?: Record<string, string>; styles?: PartStyle[]; removes?: PartRemove[] },
  fromVersion?: number,
  check = false,
) {
  const b = board(projectId);
  const node = findSketch(b, sketchId);
  if (!node) throw new Error("That sketch is gone.");
  const base = fromVersion ?? (Number(node.data.version) || 1);
  if (!versionsOf(b.p.id, node.id).includes(base)) throw new Error(`That sketch has no version ${base}.`);
  const edits = (changes.edits ?? []).slice(0, 200);
  const vars = changes.vars ?? {};
  const styles = (changes.styles ?? []).slice(0, 200);
  const removes = (changes.removes ?? []).slice(0, 200);
  const before = readSketch(b.p.id, node.id, base);
  // Everything found by its place in the page in one pass over the file as it was (a part
  // taken out moves the places after it), then the rest (pageparts.ts), then the knobs.
  let html = withParts(before, { words: edits, styles, removes });
  if (Object.keys(vars).length) html = withVars(html, vars);
  if (check) return { ok: true };
  if (html === before) return { version: base, rules: [], errors: 0, new_errors: 0 };
  const n = Object.keys(vars).length;
  const parts: string[] = [];
  if (edits.length === 1) {
    const words = edits[0]!.afterText.replace(/\s+/g, " ").trim();
    parts.push(`the words to “${words.length > 40 ? `${words.slice(0, 39)}…` : words}”`);
  } else if (edits.length > 1) parts.push(`the words in ${edits.length} places`);
  if (n) parts.push(`${n} ${n === 1 ? "value" : "values"}`);
  const looked = new Set(styles.map((x) => x.path)).size;
  if (looked) parts.push(`the look of ${looked} ${looked === 1 ? "part" : "parts"}`);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
  const said = [parts.length ? `Changed ${list(parts)}` : "", removes.length ? `removed ${removes.length} ${removes.length === 1 ? "part" : "parts"}` : ""].filter(Boolean).join(", ");
  const what = said ? said.charAt(0).toUpperCase() + said.slice(1) : "Changed the page";
  const { version, render } = await writeVersion(b.p.id, node.id, html, node.data.device as Device | undefined, { by: "you", what });
  apply(b.p.id, [{ op: "update_node", id: node.id, data: { version } }], "designer", { label: `${what} in ${sketchName(node)} (version ${version})` });
  // Errors the page didn't report before this save: the studio says so, since the live page
  // (whose script had already run) may have looked whole right up to Save.
  const had = new Set(renderOf(b.p.id, node.id, base).errors);
  return { version, rules: render.rules ?? [], errors: render.errors.length, new_errors: render.errors.filter((e) => !had.has(e)).length };
}

/**
 * Bring an older version back: its file, exactly as it was, becomes the newest version (so it
 * is rendered and checked like any other) and the sketch shows it. Nothing is deleted or
 * rewritten, so the versions after it stay there to go back to.
 */
export async function restoreVersion(projectId: string, sketchId: string, v: number) {
  const b = board(projectId);
  const node = findSketch(b, sketchId);
  if (!node) throw new Error("That sketch is gone.");
  if (!Number.isInteger(v) || !versionsOf(b.p.id, node.id).includes(v)) throw new Error(`That sketch has no version ${v} to bring back.`);
  const html = readSketch(b.p.id, node.id, v);
  const { version } = await writeVersion(b.p.id, node.id, html, node.data.device as Device | undefined, { by: "you", what: `Brought back v${v}` }, true);
  apply(b.p.id, [{ op: "update_node", id: node.id, data: { version } }], "designer", { label: `Brought back version ${v} of ${sketchName(node)} (version ${version})` });
  return { version };
}

export async function getSketch(o: { project: string; sketch: string; version?: number; device?: Device; state?: string }) {
  const b = board(o.project);
  const node = findSketch(b, o.sketch);
  if (!node) throw new Error(`No sketch “${o.sketch}” on this canvas. get_project lists the sketches.`);
  const version = o.version ?? (Number(node.data.version) || 1);
  const html = readSketch(b.p.id, node.id, version);
  const states = statesOf(html);
  const own = (node.data.device as Device | undefined) ?? "desktop";
  const device = o.device ?? own;
  let state: { name: string; slug: string } | undefined;
  if (o.state?.trim()) {
    const want = o.state.trim().toLowerCase().replace(/^#/, "");
    const found = states.find((x) => x.name.toLowerCase() === want || x.slug === want);
    if (!found) throw new Error(states.length ? `This sketch has no state “${o.state}”. Its states: ${states.map((x) => `${x.name} (#${x.slug})`).join(", ")}.` : "This sketch doesn't list any states (meta panel:states).");
    if (found !== states[0]) state = found;
  }
  const render = device === own && !state ? renderOf(b.p.id, node.id, version) : await renderView(b.p.id, node.id, version, device, state?.slug);
  return {
    // "sketch", not "id": Ask reads "id" in a tool's answer as a save to show.
    sketch: node.id,
    title: sketchName(node),
    tries: (node.data.tries as string) || undefined,
    state: String(node.data.state ?? "kept"),
    designer_reason: (node.data.reason as string) || undefined,
    version,
    showing: Number(node.data.version) || 1,
    versions: versionsOf(b.p.id, node.id),
    made_for: own,
    seen_on: device,
    states: states.length ? states.map((x) => `${x.name} (#${x.slug})`) : undefined,
    seen_state: state ? `${state.name} (#${state.slug})` : undefined,
    page: fullUrl(sketchPath(b.p.id, node.id, version)),
    html,
    render,
  };
}

/** One sketch by its id or title: which project it's in, its name, and the version it shows. */
export function sketchMeta(project: string, sketch: string) {
  const b = board(project);
  const node = findSketch(b, sketch);
  if (!node) throw new Error(`No sketch “${sketch}” on this canvas. get_project lists the sketches.`);
  return { project: b.p.id, id: node.id, title: sketchName(node), version: Number(node.data.version) || 1, device: (node.data.device as Device | undefined) ?? "desktop" };
}

/** The sketches that branch from this one, and the ones it branches from: its family, for the studio. */
export function sketchFamily(projectId: string, sketchId: string) {
  const full = getProject(projectId);
  if (!full) return [];
  const sk = new Map(full.nodes.filter((n) => n.kind === "sketch").map((n) => [n.id, n]));
  const parentOf = new Map<string, string>();
  for (const e of full.edges) if (sk.has(e.source) && sk.has(e.target) && !parentOf.has(e.target)) parentOf.set(e.target, e.source);
  let root = sketchId;
  for (let i = 0; i < 50 && parentOf.has(root); i++) root = parentOf.get(root)!;
  const out: { id: string; parent: string | null; depth: number; title: string; tries?: string; state: string; version: number; reason?: string }[] = [];
  const walk = (id: string, depth: number) => {
    const n = sk.get(id);
    if (!n || out.some((x) => x.id === id) || out.length > 60) return;
    out.push({ id, parent: parentOf.get(id) ?? null, depth, title: sketchName(n), tries: (n.data.tries as string) || undefined, state: String(n.data.state ?? "kept"), version: Number(n.data.version) || 1, reason: (n.data.reason as string) || undefined });
    for (const [child, p] of parentOf) if (p === id) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
}

/**
 * Who made each version of a sketch and what it changed, from the canvas's history, for the
 * versions made before that was written beside them. The first change that set the sketch to
 * version N made it: the designer's (a knob, words) or anyone else's (FRIDAY, Claude Code).
 * Read once for all of a sketch's versions.
 */
function versionsFromHistory(projectId: string, sketchId: string, title: string) {
  const out = new Map<number, VersionNote>();
  const rows = db
    .query<{ actor: string; ops: string; label: string | null }, [string, string]>(
      "SELECT actor, ops, label FROM project_events WHERE project_id = ? AND undo_of IS NULL AND ops LIKE ? ORDER BY seq",
    )
    .all(projectId, `%${sketchId}%`);
  for (const r of rows) {
    let ops: Op[];
    try {
      ops = JSON.parse(r.ops);
    } catch {
      continue;
    }
    for (const o of ops) {
      const data = o.op === "update_node" && o.id === sketchId ? o.data : o.op === "add_node" && o.node.id === sketchId ? o.node.data : null;
      const v = Number(data?.version ?? (o.op === "add_node" && data ? 1 : NaN));
      if (!data || !Number.isInteger(v) || out.has(v)) continue;
      if (r.actor === "designer") {
        // "Changed the words to “NavCRM” in Print deck (version 12)" → "Changed the words to “NavCRM”"
        let what = (r.label ?? "").replace(/\s*\(version \d+\)\s*$/, "");
        const tail = ` in ${title}`;
        what = what.endsWith(tail) ? what.slice(0, -tail.length) : what.replace(/ in [^]*$/, "");
        out.set(v, { by: "you", what });
      } else out.set(v, { by: "friday", what: typeof data.tries === "string" ? data.tries : "" });
    }
  }
  return out;
}

/** What the studio needs about one sketch: its versions, with what each render saw and who made it, and its states. */
export function sketchInfo(projectId: string, sketchId: string) {
  const node = getProject(projectId)?.nodes.find((n) => n.id === sketchId);
  let history: Map<number, VersionNote> | null = null;
  const versions = versionsOf(projectId, sketchId).map((v) => {
    const r = renderOf(projectId, sketchId, v);
    const note = versionNote(projectId, sketchId, v);
    if (!note.by) {
      history ??= versionsFromHistory(projectId, sketchId, node ? sketchName(node) : "");
      const h = history.get(v);
      if (h) Object.assign(note, { by: h.by, what: note.what || h.what });
    }
    return { v, errors: r.errors.length, height: r.height, rules: r.rules ?? [], at: note.at ?? "", by: note.by, what: note.what ?? "" };
  });
  const last = versions.at(-1)?.v;
  const states = last ? statesOf(readSketch(projectId, sketchId, last)) : [];
  // The Figma frame it was last brought back from, so the studio can say where "Bring back" looks.
  return { versions, states, family: sketchFamily(projectId, sketchId), figma: rememberedFrame(projectId, sketchId) ?? undefined };
}
