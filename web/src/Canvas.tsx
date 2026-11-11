// A project's canvas: decisions (Typography, Color…) as topics, the saves considered for
// each, and the designer's notes on why. Loaded only when a project is open, so the
// library stays as light as it was.
//
// Every change is sent to the companion as a small op and drawn at once. Changes made
// elsewhere (another window, Claude over MCP) arrive on a live stream and animate in.

import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Background, BackgroundVariant, ConnectionMode, Handle, MiniMap, NodeToolbar, Position, ReactFlow, ReactFlowProvider,
  applyEdgeChanges, applyNodeChanges, getBezierPath, useInternalNode, useReactFlow, useStore,
  type Connection, type Edge, type EdgeChange, type EdgeProps, type InternalNode, type Node, type NodeChange, type NodeProps, type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import "./canvas.css";
import {
  api, chatApi, displayTitle, localId, prefersReducedMotion, projectApi,
  studioApi,
  type Build, type BoardEdge, type BoardEvent, type BoardNode, type BoardOp, type CanvasSelection, type Device, type Material, type Ref, type RefCard, type RefState, type SketchPoint, type TopicFacet,
} from "./api.ts";
import { Studio } from "./Studio.tsx";
import { Icon } from "./Icon.tsx";
import { Popover } from "./TagRow.tsx";
import { Review, type ReviewItem } from "./Review.tsx";

// ---------- What the canvas draws ----------

type Enter = { enter?: number; leaving?: boolean; focus?: boolean };
type TopicData = Enter & { title: string; facet?: TopicFacet; status?: "exploring" | "locked"; summary?: string };
type RefData = Enter & { refId: string; state?: RefState; taking?: string; reason?: string };
type NoteData = Enter & { text: string };
/** A quick page Claude made to try a direction; its files live at the companion, by version. */
type SketchData = Enter & { title: string; tries?: string; state?: RefState; version: number; reason?: string; device?: Device };
/** Claude Code building a chosen sketch for real; its progress comes from the companion. */
type BuildData = Enter & { build: string; title: string };
type TopicNode = Node<TopicData, "topic">;
type RefNode = Node<RefData, "ref">;
type NoteNode = Node<NoteData, "note">;
type SketchNode = Node<SketchData, "sketch">;
type BuildNode = Node<BuildData, "build">;
type AnyNode = TopicNode | RefNode | NoteNode | SketchNode | BuildNode;

export const FACETS: { value: TopicFacet; label: string }[] = [
  { value: "typography", label: "Typography" },
  { value: "color", label: "Color" },
  { value: "layout", label: "Layout" },
  { value: "imagery", label: "Imagery" },
  { value: "motion", label: "Motion" },
  { value: "components", label: "Components" },
  { value: "other", label: "Other" },
];
const facetLabel = (f?: string) => FACETS.find((x) => x.value === f)?.label ?? "Topic";

/** A stored node as the canvas draws it. */
function toFlow(b: BoardNode, enter?: number): AnyNode {
  const position = { x: b.x, y: b.y };
  const d = b.data;
  if (b.kind === "topic") {
    return { id: b.id, type: "topic", position, data: { title: String(d.title ?? ""), facet: d.facet as TopicFacet, status: d.status as TopicData["status"], summary: d.summary as string | undefined, enter } };
  }
  if (b.kind === "ref") return { id: b.id, type: "ref", position, data: { refId: b.ref_id!, state: d.state as RefState, taking: d.taking as string | undefined, reason: d.reason as string | undefined, enter } };
  if (b.kind === "sketch") {
    return { id: b.id, type: "sketch", position, data: { title: String(d.title ?? ""), tries: d.tries as string | undefined, state: d.state as RefState, version: Number(d.version) || 1, reason: d.reason as string | undefined, device: d.device as Device | undefined, enter } };
  }
  if (b.kind === "build") return { id: b.id, type: "build", position, data: { build: String(d.build ?? ""), title: String(d.title ?? ""), enter } };
  return { id: b.id, type: "note", position, data: { text: String(d.text ?? ""), enter } };
}
const toEdge = (e: BoardEdge): Edge => ({ id: e.id, source: e.source, target: e.target, type: "float", label: e.label || undefined });

/**
 * A topic's family: what belongs to it on the canvas, so it can travel with it (dragging,
 * Tidy, gliding in from far away). Everything reachable from the topic along lines, without
 * passing through another topic and without following a "uses" line (a sketch's "took from
 * this save", which can point anywhere). A card joined directly to a second topic belongs to
 * both, so it stays put. That covers the topic's saves, the notes on it and on them, its
 * sketches, the sketches branched from those, and their build cards.
 */
function familyOf(topicIds: string[], nodes: { id: string; type?: string }[], edges: { source: string; target: string; label?: unknown }[]) {
  const kind = new Map(nodes.map((n) => [n.id, n.type]));
  const near = new Map<string, string[]>();
  for (const e of edges) {
    if (e.label === "uses") continue;
    (near.get(e.source) ?? near.set(e.source, []).get(e.source)!).push(e.target);
    (near.get(e.target) ?? near.set(e.target, []).get(e.target)!).push(e.source);
  }
  const topicsOf = (id: string) => (near.get(id) ?? []).filter((x) => kind.get(x) === "topic");
  const out = new Set<string>();
  for (const t of topicIds) {
    const seen = new Set([t]);
    const queue = [t];
    while (queue.length) {
      const at = queue.shift()!;
      for (const x of near.get(at) ?? []) {
        if (seen.has(x) || !kind.has(x)) continue;
        seen.add(x);
        if (kind.get(x) === "topic") continue;
        if (topicsOf(x).some((y) => y !== t)) continue;
        out.add(x);
        queue.push(x);
      }
    }
  }
  for (const t of topicIds) out.delete(t);
  return out;
}

/** The part of a node's data the companion keeps. */
function stored(n: AnyNode): Record<string, unknown> {
  if (n.type === "topic") return { title: n.data.title, facet: n.data.facet, status: n.data.status, summary: n.data.summary };
  if (n.type === "ref") return { state: n.data.state, taking: n.data.taking, reason: n.data.reason };
  if (n.type === "sketch") return { title: n.data.title, tries: n.data.tries, state: n.data.state, version: n.data.version, reason: n.data.reason, device: n.data.device };
  if (n.type === "build") return { build: n.data.build, title: n.data.title };
  return { text: n.data.text };
}

// ---------- Shared with the nodes ----------

interface Actions {
  /** The project's id: sketches' files are found by it. */
  project: string;
  cards: Map<string, RefCard>;
  patch: (id: string, data: Record<string, unknown>) => void;
  /** Give saves or sketches a verdict (keep, choose, rule out), then ask why and move on to the next one waiting. */
  judge: (ids: string[], state: RefState, opts?: { quiet?: boolean }) => void;
  remove: (ids: string[]) => void;
  note: (forId: string) => void;
  open: (refId: string) => void;
  /** Look at a sketch, live, in the large view. */
  openSketch: (nodeId: string) => void;
  clearFocus: (id: string) => void;
  /** Ask about what's selected. */
  ask: () => void;
  /** Something went wrong, in words for the designer. */
  error: (text: string) => void;
  /** Ask FRIDAY to sketch a direction from these nodes (a save, several, a decision). */
  sketchFrom: (ids: string[]) => void;
  /**
   * Saves folded under a topic: under a locked one, all that weren't chosen; under one still
   * being explored, the ones ruled out. How many, whether they're showing, and which kind.
   */
  considered: Map<string, { n: number; open: boolean; locked: boolean }>;
  toggleConsidered: (topicId: string) => void;
  /** How many saves are under each topic, and how many chosen. */
  counts: Map<string, { saves: number; chosen: number }>;
  /** Lay a topic's saves out in three columns beneath it. */
  tidy: (topicId: string) => void;
  /** Glide in to a topic and its family (double-click in the far view). */
  zoomTo: (topicId: string) => void;
}
const Ctx = createContext<Actions | null>(null);
const useActions = () => useContext(Ctx)!;

/** Below this zoom the canvas is read from far away: names stay readable, saves become plain pictures. */
const FAR = 0.4;
const isFar = (s: { transform: [number, number, number] }) => s.transform[2] < FAR;

/** How long things take to leave, so they can be seen going. */
const LEAVE_MS = 170;
/** How far the canvas moves for a two-finger swipe: 1 is one to one with your fingers (React Flow's own is 0.5). */
const PAN_SPEED = 1.15;
const stagger = (i?: number) => (i === undefined ? undefined : ({ "--i": Math.min(i, 18) } as React.CSSProperties));

function Handles() {
  // Loose connections: any handle joins any other, and lines are drawn edge to edge
  // between the nodes (see FloatEdge), so where the handle sits only matters for grabbing.
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" className="bn-handle" />
      <Handle type="source" position={Position.Right} id="r" className="bn-handle" />
      <Handle type="source" position={Position.Bottom} id="b" className="bn-handle" />
      <Handle type="source" position={Position.Left} id="l" className="bn-handle" />
    </>
  );
}

/** Only one thing selected? A node shows its own tools then; several share one toolbar (SelectionTools). */
const selectAlone = (s: { nodes: { selected?: boolean }[] }) => {
  let n = 0;
  for (const x of s.nodes) if (x.selected && ++n > 1) return false;
  return true;
};

/**
 * A button in the tools above a card. Verdicts (Choose, Keep, Rule out) and Lock keep their
 * words: they're the decisions. Everything else is its icon alone, with its name on hover and
 * for screen readers, so the bar stays small and covers less of what's above the card.
 */
function Tool(props: { icon: Parameters<typeof Icon>[0]["name"]; label: string; on?: boolean; danger?: boolean; words?: boolean; onClick: () => void; keyHint?: string }) {
  return (
    <button
      className={`bn-tool ${props.words ? "" : "icon"} ${props.on ? "on" : ""} ${props.danger ? "danger" : ""}`}
      onClick={props.onClick}
      title={props.keyHint ? `${props.label} (${props.keyHint})` : props.label}
      aria-label={props.label}
      aria-pressed={props.on}
    >
      <Icon name={props.icon} size={14} />
      {props.words && <span>{props.label}</span>}
    </button>
  );
}
/** The hairline between the decisions and the other tools. */
const ToolSep = () => <span className="bn-tools-sep" aria-hidden />;

/**
 * Focus a field in a node that was just made. React Flow keeps a new node hidden until
 * it has measured it, and a hidden field can't take focus, so wait a moment.
 */
function useLateFocus(ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>, on: boolean | undefined) {
  useEffect(() => {
    if (!on) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = ref.current;
      if (!el || ++tries > 20) return clearInterval(t);
      el.focus({ preventScroll: true });
      if (document.activeElement !== el) return;
      if (el instanceof HTMLInputElement) el.select();
      clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A text field that grows with what's written in it. */
function Grow(props: { value: string; placeholder: string; className: string; autoFocus?: boolean; onCommit: (v: string) => void; onBlurEmpty?: () => void }) {
  const [v, setV] = useState(props.value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sent = useRef(props.value);
  useLateFocus(ref, props.autoFocus);
  const send = (text: string) => {
    clearTimeout(timer.current);
    if (text === sent.current) return;
    sent.current = text;
    props.onCommit(text);
  };
  useEffect(() => {
    sent.current = props.value;
    if (!focused.current) setV(props.value);
  }, [props.value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [v]);
  // Saved while writing too, a moment after the last key, so nothing is lost on a reload.
  useEffect(() => {
    if (!focused.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(v), 700);
    return () => clearTimeout(timer.current);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <textarea
      ref={ref}
      className={`nodrag nowheel ${props.className}`}
      value={v}
      rows={1}
      placeholder={props.placeholder}
      spellCheck={false}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
        e.stopPropagation();
      }}
      onBlur={() => {
        focused.current = false;
        if (!v.trim() && props.onBlurEmpty) {
          clearTimeout(timer.current);
          return props.onBlurEmpty();
        }
        send(v);
      }}
    />
  );
}

const TopicView = memo(function TopicView({ id, data, selected }: NodeProps<TopicNode>) {
  const act = useActions();
  const alone = useStore(selectAlone);
  const far = useStore(isFar);
  const locked = data.status === "locked";
  const count = act.counts.get(id);
  const [renaming, setRenaming] = useState(!!data.focus);
  const nameRef = useRef<HTMLInputElement>(null);
  useLateFocus(nameRef, renaming);
  return (
    <div
      className={`bn topic ${locked ? "locked" : ""} ${data.enter !== undefined ? "enter" : ""} ${data.leaving ? "leaving" : ""}`}
      style={stagger(data.enter)}
      // From far away a double-click glides in to the topic and its family; up close it renames (on the name).
      onDoubleClick={far ? () => act.zoomTo(id) : undefined}
    >
      <Handles />
      {/* Its name at a steady size on screen however far out the view is, so a canvas can be read from far away. */}
      <div className="topic-far" aria-hidden>
        <span className="topic-far-name">{data.title || facetLabel(data.facet)}</span>
        <span className="topic-far-meta">
          {[count?.saves ? `${count.saves} ${count.saves === 1 ? "save" : "saves"}` : "", count?.chosen ? `${count.chosen} chosen` : "", locked ? "Locked" : ""].filter(Boolean).join(" · ") || "No saves yet"}
        </span>
      </div>
      <div className="topic-top">
        <span className="topic-facet">{facetLabel(data.facet)}</span>
        <span className="topic-status">{locked ? <><Icon name="check" size={11} /> Locked</> : "Exploring"}</span>
      </div>
      {renaming ? (
        <input
          className="nodrag topic-title-input"
          ref={nameRef}
          defaultValue={data.title}
          placeholder={facetLabel(data.facet)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
          onBlur={(e) => {
            setRenaming(false);
            act.clearFocus(id);
            const v = e.target.value.trim();
            if (v !== data.title) act.patch(id, { title: v });
          }}
        />
      ) : (
        <div className="topic-title" onDoubleClick={() => !far && setRenaming(true)}>{data.title || facetLabel(data.facet)}</div>
      )}
      {(() => {
        const c = act.considered.get(id);
        if (!c?.n) return null;
        const what = c.locked ? "considered" : "ruled out";
        return (
          <button className="nodrag topic-considered" onClick={() => act.toggleConsidered(id)} aria-expanded={c.open}>
            {c.open ? `Fold ${c.n} ${what}` : c.locked ? `+${c.n} considered` : `${c.n} ruled out`}
          </button>
        );
      })()}
      {(locked || data.summary) && (
        <Grow
          className="topic-summary"
          value={data.summary ?? ""}
          placeholder="The decision, in a sentence. Claude reads this."
          onCommit={(v) => act.patch(id, { summary: v })}
        />
      )}
      {/* Not from far away: there a double-click glides in, and the tools would sit over the name. */}
      <NodeToolbar isVisible={selected && alone && !data.leaving && !far} position={Position.Top} offset={10}>
        <div className="bn-tools">
          <Tool icon={locked ? "refresh" : "check"} label={locked ? "Reopen" : "Lock"} words on={locked} onClick={() => act.patch(id, { status: locked ? "exploring" : "locked" })} />
          <ToolSep />
          <Tool icon="build" label="Sketch" onClick={() => act.sketchFrom([id])} />
          <Tool icon="ask" label="Ask FRIDAY" onClick={act.ask} />
          <Tool icon="pencil" label="Note" onClick={() => act.note(id)} />
          <Tool icon="compose" label="Rename" onClick={() => setRenaming(true)} />
          {(act.counts.get(id)?.saves ?? 0) >= 2 && <Tool icon="grid" label="Tidy" onClick={() => act.tidy(id)} />}
          <Tool icon="trash" label="Remove" danger onClick={() => act.remove([id])} />
        </div>
      </NodeToolbar>
    </div>
  );
});

const RefView = memo(function RefView({ id, data, selected }: NodeProps<RefNode>) {
  const act = useActions();
  const alone = useStore(selectAlone);
  const card = act.cards.get(data.refId);
  const state = data.state ?? "kept";
  const ratio = card?.ratio ?? 0.75;
  return (
    <div className={`bn ref s-${state} ${data.enter !== undefined ? "enter" : ""} ${data.leaving ? "leaving" : ""}`} style={stagger(data.enter)}>
      <Handles />
      <div className="ref-thumb" style={{ aspectRatio: `${1} / ${Math.min(ratio, 1.35)}` }} onDoubleClick={() => act.open(data.refId)}>
        {card?.thumb ? <img src={card.thumb} alt="" draggable={false} loading="lazy" decoding="async" /> : <div className="ref-empty" />}
        {state === "chosen" && <span className="ref-badge"><Icon name="check" size={11} /> Chosen</span>}
        {state === "ruled_out" && <span className="ref-badge out">Ruled out</span>}
        {state === "proposed" && <span className="ref-badge soft">Suggested</span>}
      </div>
      {data.taking && <p className="ref-why">{data.taking}</p>}
      {data.reason && state !== "proposed" && state !== "kept" && <p className="ref-why reason">{state === "chosen" ? "Chosen for" : "Why not"}: {data.reason}</p>}
      <div className="ref-meta">
        <span className="ref-title">{card?.title ?? "Not in the library"}</span>
        {card && card.palette.length > 0 && (
          <span className="ref-palette" aria-hidden>
            {card.palette.slice(0, 5).map((h) => <i key={h} style={{ background: h }} />)}
          </span>
        )}
      </div>
      <NodeToolbar isVisible={selected && alone && !data.leaving} position={Position.Top} offset={10}>
        <div className="bn-tools">
          <Tool icon="check" label="Choose" words keyHint="C" on={state === "chosen"} onClick={() => act.judge([id], state === "chosen" ? "kept" : "chosen")} />
          {state === "proposed" && <Tool icon="plus" label="Keep" words keyHint="K" onClick={() => act.judge([id], "kept")} />}
          <Tool icon="x" label="Rule out" words keyHint="X" on={state === "ruled_out"} onClick={() => act.judge([id], state === "ruled_out" ? "kept" : "ruled_out")} />
          <ToolSep />
          <Tool icon="build" label="Sketch" onClick={() => act.sketchFrom([id])} />
          <Tool icon="ask" label="Ask FRIDAY" onClick={act.ask} />
          <Tool icon="pencil" label="Note" onClick={() => act.note(id)} />
          <Tool icon="arrow-up-right" label="Open" onClick={() => act.open(data.refId)} />
          <Tool icon="trash" label="Remove" danger onClick={() => act.remove([id])} />
        </div>
      </NodeToolbar>
    </div>
  );
});

const NoteView = memo(function NoteView({ id, data }: NodeProps<NoteNode>) {
  const act = useActions();
  return (
    <div className={`bn note ${data.enter !== undefined ? "enter" : ""} ${data.leaving ? "leaving" : ""}`} style={stagger(data.enter)}>
      <Handles />
      <Grow
        className="note-text"
        value={data.text}
        autoFocus={data.focus}
        placeholder="Why this? What to take from it?"
        onCommit={(v) => {
          act.clearFocus(id);
          act.patch(id, { text: v });
        }}
        // A note left empty wasn't wanted.
        onBlurEmpty={() => act.remove([id])}
      />
    </div>
  );
});

/** Where a sketch's files are: its page and its first screen, for one version. */
const sketchSrc = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.html`;
const sketchPicture = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.jpg`;

const SketchView = memo(function SketchView({ id, data, selected }: NodeProps<SketchNode>) {
  const act = useActions();
  const alone = useStore(selectAlone);
  const state = data.state ?? "kept";
  const pic = sketchPicture(act.project, id, data.version);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [pic]);
  return (
    <div className={`bn sketch s-${state} ${data.enter !== undefined ? "enter" : ""} ${data.leaving ? "leaving" : ""}`} style={stagger(data.enter)}>
      <Handles />
      <div className="sketch-shot" onDoubleClick={() => act.openSketch(id)}>
        {broken ? (
          <div className="sketch-empty">No picture of this one</div>
        ) : (
          <img key={pic} src={pic} alt="" draggable={false} decoding="async" onError={() => setBroken(true)} />
        )}
        {state === "chosen" && <span className="ref-badge"><Icon name="check" size={11} /> Chosen</span>}
        {state === "ruled_out" && <span className="ref-badge out">Ruled out</span>}
        {state === "proposed" && <span className="ref-badge soft">Suggested</span>}
        {data.version > 1 && <span className="sketch-version">v{data.version}</span>}
      </div>
      <div className="sketch-meta">
        <span className="sketch-title">{data.title || "Untitled sketch"}</span>
        {data.tries && <p className="sketch-tries">{data.tries}</p>}
      </div>
      <NodeToolbar isVisible={selected && alone && !data.leaving} position={Position.Top} offset={10}>
        <div className="bn-tools">
          <Tool icon="check" label="Choose" words keyHint="C" on={state === "chosen"} onClick={() => act.judge([id], state === "chosen" ? "kept" : "chosen")} />
          {state === "proposed" && <Tool icon="plus" label="Keep" words keyHint="K" onClick={() => act.judge([id], "kept")} />}
          <Tool icon="x" label="Rule out" words keyHint="X" on={state === "ruled_out"} onClick={() => act.judge([id], state === "ruled_out" ? "kept" : "ruled_out")} />
          <ToolSep />
          <Tool icon="eye" label="Open" onClick={() => act.openSketch(id)} />
          <Tool icon="ask" label="Ask FRIDAY" onClick={act.ask} />
          <Tool icon="pencil" label="Note" onClick={() => act.note(id)} />
          <Tool icon="trash" label="Remove" danger onClick={() => act.remove([id])} />
        </div>
      </NodeToolbar>
    </div>
  );
});

/**
 * Claude Code building a chosen sketch, in the designer's code. The card follows it as it
 * works (its plan, the step it's on), then shows the result running; you can ask for
 * changes from here, or carry on in the terminal.
 */
const BuildView = memo(function BuildView({ id, data, selected }: NodeProps<BuildNode>) {
  const act = useActions();
  const alone = useStore(selectAlone);
  const [b, setB] = useState<Build | null>(null);
  const [gone, setGone] = useState(false);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => studioApi.getBuild(data.build).then(setB, (e: Error) => /gone/.test(e.message) && setGone(true)), [data.build]);
  useEffect(() => {
    void load();
  }, [load]);
  // While it works, keep up with it.
  useEffect(() => {
    if (b?.status !== "working" && !busy) return;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [b?.status, busy, load]);
  const run = async (f: () => Promise<Build | unknown>) => {
    setBusy(true);
    try {
      const r = await f();
      if (r && typeof r === "object" && "id" in r) setB(r as Build);
      else await load();
    } catch (e) {
      act.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const status = b?.status ?? "working";
  const label = { working: "Building", done: "Built", failed: "Stopped with a problem", stopped: "Stopped" }[status];
  const plan = b?.plan?.length ? b.plan : null;
  const steps = b?.steps.filter((s) => s.kind !== "say").slice(-5) ?? [];
  const say = [...(b?.steps ?? [])].reverse().find((s) => s.kind === "say")?.text;
  const short = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
  return (
    <div className={`bn build ${data.enter !== undefined ? "enter" : ""} ${data.leaving ? "leaving" : ""}`} style={stagger(data.enter)}>
      <Handles />
      <div className="bd-head">
        <span className="bd-mark"><Icon name="build" size={12} /></span>
        <span className="bd-title">{data.title || "Build"}</span>
        <span className={`bd-status ${status}`}>{busy && status !== "working" ? "Starting…" : label}</span>
      </div>
      {gone ? (
        <p className="bd-error">This build's record is gone.</p>
      ) : b?.shot && status !== "working" ? (
        <a className="bd-shot nodrag" href={b.preview?.url ?? b.shot} target="_blank" rel="noopener noreferrer" title={b.serving ? "Open it running" : "The last picture of it running"}>
          <img src={b.shot} alt="" draggable={false} />
        </a>
      ) : plan ? (
        <ul className="bd-plan">
          {plan.slice(0, 7).map((p, i) => (
            <li key={i} className={p.status}><span className="bd-tick">{p.status === "completed" ? "✓" : p.status === "in_progress" ? "●" : "○"}</span><span>{p.content}</span></li>
          ))}
          {plan.length > 7 && <li><span className="bd-tick" /><span className="faint">and {plan.length - 7} more</span></li>}
        </ul>
      ) : (
        <ul className="bd-steps">
          {(steps.length ? steps : [{ kind: "read", text: "Reading the hand-off and your code…" }]).map((s, i) => (
            <li key={i}><span className="bd-tick">{s.kind === "edit" ? "✎" : s.kind === "run" ? "›" : "·"}</span><span>{s.text}</span></li>
          ))}
        </ul>
      )}
      {status === "working" && plan && steps.length > 0 && <p className="bd-say faint">{steps.at(-1)!.text}</p>}
      {status !== "working" && (b?.reply || say) && <p className="bd-say">{(b?.reply ?? say ?? "").replace(/[#*`]/g, "").trim()}</p>}
      {b?.error && <p className="bd-error">{b.error}</p>}
      <div className="bd-foot">
        <Icon name="folder" size={11} />
        <span title={b?.workdir}>{b ? short(b.workdir) : ""}</span>
        {b?.branch && <span className="faint">· {b.branch}</span>}
      </div>
      {selected && b && status !== "working" && (
        <div className="bd-ask nodrag" onPointerDown={(e) => e.stopPropagation()}>
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && ask.trim()) {
                const t = ask;
                setAsk("");
                void run(() => studioApi.message(b.id, t));
              }
            }}
            placeholder="Ask Claude Code for a change…"
          />
          <button className="st-send" disabled={!ask.trim() || busy} onClick={() => { const t = ask; setAsk(""); void run(() => studioApi.message(b.id, t)); }} aria-label="Send"><Icon name="arrow-up" size={13} /></button>
        </div>
      )}
      <NodeToolbar isVisible={selected && alone && !data.leaving && !!b} position={Position.Top} offset={10}>
        <div className="bn-tools">
          {b?.status === "working" ? (
            <Tool icon="stop" label="Stop" onClick={() => void run(() => studioApi.stop(b.id))} />
          ) : b?.preview ? (
            b.serving ? (
              <>
                <Tool icon="external" label="Open" onClick={() => open(b.preview!.url, "_blank", "noopener")} />
                <Tool icon="refresh" label="New picture" onClick={() => void run(() => studioApi.preview(b.id))} />
                <Tool icon="stop" label="Stop running" onClick={() => void run(() => studioApi.stopPreview(b.id))} />
              </>
            ) : (
              <Tool icon="play" label="Run it" onClick={() => void run(() => studioApi.preview(b.id))} />
            )
          ) : null}
          {b?.resume && (
            <Tool
              icon={copied ? "check" : "terminal"}
              label={copied ? "Copied" : "Continue in terminal"}
              onClick={() => {
                void navigator.clipboard.writeText(b.resume!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            />
          )}
          <Tool icon="trash" label="Remove" danger onClick={() => act.remove([id])} />
        </div>
      </NodeToolbar>
    </div>
  );
});

// ---------- Lines, drawn from edge to edge of the two nodes ----------

function rectOf(n: InternalNode) {
  const w = n.measured.width ?? 0, h = n.measured.height ?? 0;
  const p = n.internals.positionAbsolute;
  return { cx: p.x + w / 2, cy: p.y + h / 2, w, h };
}

/** Where the line from a's center toward b's center leaves a's box, and from which side. */
function exit(a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (!dx && !dy) return { x: a.cx, y: a.cy, side: Position.Right };
  const sx = a.w / 2 / Math.max(Math.abs(dx), 1e-6), sy = a.h / 2 / Math.max(Math.abs(dy), 1e-6);
  const s = Math.min(sx, sy);
  const side = sx < sy ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { x: a.cx + dx * s, y: a.cy + dy * s, side };
}

function FloatEdge({ id, source, target, selected, label }: EdgeProps) {
  const s = useInternalNode(source), t = useInternalNode(target);
  if (!s || !t || !s.measured.width || !t.measured.width) return null;
  const a = rectOf(s), b = rectOf(t);
  const p = exit(a, b), q = exit(b, a);
  const [path] = getBezierPath({ sourceX: p.x, sourceY: p.y, sourcePosition: p.side, targetX: q.x, targetY: q.y, targetPosition: q.side, curvature: 0.3 });
  const kinds = [s.type, t.type];
  const kind = kinds.includes("note") ? "note" : kinds.every((k) => k === "topic") ? "flow" : label === "uses" ? "uses" : kinds.includes("build") ? "build" : "link";
  // A line to a save or a sketch takes on its verdict.
  const judged = [s, t].find((n) => n.type === "ref" || n.type === "sketch");
  const chosen = (judged?.data as RefData | undefined)?.state === "chosen";
  const out = (judged?.data as RefData | undefined)?.state === "ruled_out";
  const leaving = (s.data as Enter).leaving || (t.data as Enter).leaving || /\bfolding\b/.test(`${s.className ?? ""} ${t.className ?? ""}`);
  return (
    <g className={`fe fe-${kind} ${chosen ? "chosen" : ""} ${out ? "out" : ""} ${selected ? "sel" : ""} ${leaving ? "leaving" : ""}`} data-id={id}>
      <path className="fe-line" d={path} pathLength={kind === "note" ? undefined : 1} />
      <path className="react-flow__edge-interaction" d={path} fill="none" strokeOpacity={0} strokeWidth={18} />
    </g>
  );
}

const nodeTypes = { topic: TopicView, ref: RefView, note: NoteView, sketch: SketchView, build: BuildView };
const edgeTypes = { float: FloatEdge };

// ---------- The canvas ----------

export interface CanvasProps {
  id: string;
  /** Where the canvas's tools go: the floating dock at the bottom of the window. */
  dock: HTMLElement | null;
  onOpenRef: (id: string) => void;
  onError: (text: string) => void;
  onRenamed: () => void;
  onDeleted: () => void;
  /** What's selected changed: Ask talks about it. Null when nothing is. */
  onSelection: (s: CanvasSelection | null) => void;
  /** Open Ask to ask about what's selected. */
  onAsk: () => void;
  /** Ask FRIDAY something about what's given (from the studio: a sketch, or a part of it); `quiet` leaves its panel as it is. */
  onAskWith: (text: string, about: CanvasSelection, quiet?: boolean) => void;
  /** FRIDAY is answering. */
  askRunning: boolean;
  /** What FRIDAY is doing right now, in a few words, while it answers. */
  askDoing: React.ReactNode;
  /** FRIDAY answered while its panel was closed, and it hasn't been looked at. */
  askUnread: boolean;
  /** FRIDAY's panel is open; the studio shares its column with it. */
  askOpen: boolean;
  setAskOpen: (open: boolean) => void;
}

export default function ProjectCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

/** This window, so it can tell its own changes from everyone else's on the live stream. */
const CLIENT = localId();

function Board({ id, dock, askRunning, askDoing, askUnread, askOpen, ...handlers }: CanvasProps) {
  // The app's callbacks, held steady: a new function from a parent redraw must never
  // look like a new project (that reloaded the whole canvas, entrance and all, on every redraw).
  const latest = useRef(handlers);
  latest.current = handlers;
  const onOpenRef = useCallback((refId: string) => latest.current.onOpenRef(refId), []);
  const onError = useCallback((t: string) => latest.current.onError(t), []);
  const onRenamed = useCallback(() => latest.current.onRenamed(), []);
  const onDeleted = useCallback(() => latest.current.onDeleted(), []);
  const onAsk = useCallback(() => latest.current.onAsk(), []);
  const flow = useReactFlow<AnyNode, Edge>();
  const [nodes, setNodes] = useState<AnyNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [cards, setCards] = useState<Map<string, RefCard>>(() => new Map());
  const [meta, setMeta] = useState<{ name: string; brief: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tray, setTray] = useState(false);
  /** What the assistant just did, with a way to take it back. */
  const [notice, setNotice] = useState<{ label: string; key: number; more: number; info?: boolean } | null>(null);
  const seq = useRef(0);
  // Changes go to the companion one after another, so an undo never overtakes the change it undoes.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const revealRef = useRef<(ids: string[], spots: { x: number; y: number }[]) => void>(() => {});
  /** The sketch open in the large view. */
  const [viewing, setViewing] = useState<string | null>(null);
  /** Review: the suggestions it steps through, in the order fixed when it opened. */
  const [reviewing, setReviewing] = useState<string[] | null>(null);
  const reviewingRef = useRef<string[] | null>(null);
  reviewingRef.current = reviewing;
  /** Locked topics whose considered saves are unfolded. */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const wrap = useRef<HTMLDivElement>(null);
  /** Read from far away: the canvas redraws only when the zoom crosses the line, not on every frame. */
  const far = useStore(isFar);
  /** No card in view at all ("Nothing here"), and whether any part of the canvas is out of view (the small map). */
  const [lost, setLost] = useState(false);
  const [partOut, setPartOut] = useState(false);

  const addCards = useCallback((list: RefCard[]) => {
    if (!list.length) return;
    setCards((m) => {
      const next = new Map(m);
      for (const c of list) next.set(c.id, c);
      return next;
    });
  }, []);

  /** Send changes to the companion. They're already drawn; if they don't take, the canvas reloads. */
  const commit = useCallback(
    (ops: BoardOp[]) => {
      if (!ops.length) return;
      queue.current = queue.current
        .then(() => projectApi.ops(id, ops, CLIENT))
        .then((res) => {
          seq.current = Math.max(seq.current, res.seq);
          addCards(res.cards);
        })
        .catch((e) => {
          onError((e as Error).message);
          void load(false);
        });
    },
    [id, addCards, onError], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const load = useCallback(
    async (animate: boolean) => {
      const p = await projectApi.get(id);
      seq.current = p.seq;
      setMeta({ name: p.name, brief: p.brief });
      addCards(p.cards);
      // Opening a project: everything arrives in a quick wave, nearest the top left first.
      const order = [...p.nodes].sort((a, b) => a.y + a.x * 0.5 - (b.y + b.x * 0.5));
      const rank = new Map(order.map((n, i) => [n.id, i]));
      setNodes(p.nodes.map((n) => toFlow(n, animate ? rank.get(n.id) : undefined)));
      setEdges(p.edges.map(toEdge));
      setLoaded(true);
    },
    [id, addCards],
  );

  useEffect(() => {
    setLoaded(false);
    load(true).catch((e) => onError((e as Error).message));
  }, [load, onError]);

  // The entrance plays once. Drop the flag, so a node scrolled back into view doesn't replay it.
  const settle = useCallback((ids?: Set<string>) => {
    setTimeout(() => setNodes((ns) => ns.map((n) => (n.data.enter !== undefined && (!ids || ids.has(n.id)) ? ({ ...n, data: { ...n.data, enter: undefined } } as AnyNode) : n))), 1400);
  }, []);
  useEffect(() => {
    if (loaded) settle();
  }, [loaded, settle]);

  // ---- Changes from elsewhere ----

  const removeLocal = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setNodes((ns) => ns.map((n) => (gone.has(n.id) ? ({ ...n, selected: false, data: { ...n.data, leaving: true } } as AnyNode) : n)));
    setTimeout(() => {
      setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
      setEdges((es) => es.filter((e) => !gone.has(e.source) && !gone.has(e.target)));
    }, prefersReducedMotion() ? 0 : LEAVE_MS);
  }, []);

  const applyRemote = useCallback(
    (ops: BoardOp[], event?: BoardEvent) => {
      let i = 0;
      const fresh = new Set<string>();
      const missing: string[] = [];
      const moves = new Map<string, { x: number; y: number }>();
      for (const o of ops) {
        if (o.op === "add_node") {
          const b = { ...o.node, id: o.node.id!, ref_id: o.node.ref_id ?? null, data: o.node.data ?? {} } as BoardNode;
          if (b.ref_id) missing.push(b.ref_id);
          fresh.add(b.id);
          const n = toFlow(b, i++);
          setNodes((ns) => (ns.some((x) => x.id === b.id) ? ns : [...ns, n]));
        } else if (o.op === "update_node") {
          // A move (another window, or ⌘Z putting a family back) glides there.
          if (o.x !== undefined || o.y !== undefined) {
            const n = nodesRef.current.find((m) => m.id === o.id);
            if (n) moves.set(o.id, { x: o.x ?? moves.get(o.id)?.x ?? n.position.x, y: o.y ?? moves.get(o.id)?.y ?? n.position.y });
          }
          setNodes((ns) =>
            ns.map((n) =>
              n.id !== o.id ? n : ({
                ...n,
                // A field sent as null was cleared.
                data: { ...n.data, ...(o.data ? toFlow({ id: n.id, kind: n.type, ref_id: null, data: { ...stored(n), ...Object.fromEntries(Object.entries(o.data).map(([k, v]) => [k, v ?? undefined])) }, x: 0, y: 0 }).data : {}), refId: (n.data as RefData).refId },
              } as AnyNode),
            ),
          );
        } else if (o.op === "remove_node") removeLocal([o.id]);
        else if (o.op === "add_edge") setEdges((es) => (es.some((e) => e.id === o.edge.id) ? es : [...es, toEdge({ ...o.edge, id: o.edge.id!, label: o.edge.label ?? "" })]));
        else if (o.op === "remove_edge") setEdges((es) => es.filter((e) => e.id !== o.id));
        else if (o.op === "update_project") {
          setMeta((m) => (m ? { name: o.name ?? m.name, brief: o.brief ?? m.brief } : m));
          if (o.name) onRenamed();
        }
      }
      if (moves.size) glideRef.current(moves);
      const need = missing.filter((x) => !cards.has(x));
      if (need.length) chatApi.cards(need).then(addCards).catch(() => {});
      if (fresh.size) settle(fresh);
      // The assistant's changes: say what it did, and glide over to what it added.
      if (event?.actor === "assistant") {
        // A reply is often a few changes in a row; the notice counts them, and Undo takes them all back.
        setNotice((n) => ({ label: event.label || "The assistant changed the canvas", key: n?.key ?? event.seq, more: n ? n.more + 1 : 0 }));
        const spots = ops.flatMap((o) => (o.op === "add_node" ? [{ x: o.node.x, y: o.node.y }] : []));
        // Frame them together with what they hang from: a note with its topic, saves with theirs.
        const near = ops.flatMap((o) => (o.op === "add_edge" ? [o.edge.source, o.edge.target] : []));
        if (spots.length) setTimeout(() => revealRef.current([...new Set([...fresh, ...near])], spots), 120);
      }
    },
    [cards, addCards, removeLocal, settle, onRenamed],
  );
  const applyRef = useRef(applyRemote);
  applyRef.current = applyRemote;

  useEffect(() => {
    if (!loaded) return;
    const ctl = new AbortController();
    let stopped = false;
    // The stream ends if the companion restarts; pick it up again from where it was.
    const run = async () => {
      while (!stopped) {
        try {
          await projectApi.follow(id, seq.current, (e) => {
            if ("gone" in e) {
              stopped = true;
              onDeleted();
              return;
            }
            seq.current = Math.max(seq.current, e.seq);
            if (e.client !== CLIENT) applyRef.current(e.ops, e);
          }, ctl.signal);
        } catch {
          /* dropped; try again shortly */
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 1500));
      }
    };
    void run();
    return () => {
      stopped = true;
      ctl.abort();
    };
  }, [id, loaded, onDeleted]);

  // ---- Changes made here ----

  const patch = useCallback(
    (nid: string, data: Record<string, unknown>) => {
      setNodes((ns) => ns.map((n) => (n.id === nid ? ({ ...n, data: { ...n.data, ...data } } as AnyNode) : n)));
      commit([{ op: "update_node", id: nid, data }]);
    },
    [commit],
  );

  /** The same change to several things at once: one step, so one ⌘Z takes it all back. */
  const patchMany = useCallback(
    (ids: string[], data: Record<string, unknown>) => {
      if (!ids.length) return;
      const set = new Set(ids);
      setNodes((ns) => ns.map((n) => (set.has(n.id) ? ({ ...n, data: { ...n.data, ...data } } as AnyNode) : n)));
      commit(ids.map((x) => ({ op: "update_node" as const, id: x, data })));
    },
    [commit],
  );

  // ---- Verdicts: quick to give, and each one can carry a reason ----
  // Keep (K), choose (C) and rule out (X) work on whatever is selected. After one, a strip
  // offers the reasons used most ("Too generic") and a field for your own; none is needed.
  // Judging a suggestion moves on to the next one still waiting, so a row of them goes fast.
  // `removed`: the cards were taken off the canvas (the strip says "Removed 3 suggestions"), so a
  // reason goes to the record of them, not onto cards that are gone.
  const [judged, setJudged] = useState<{ ids: string[]; verdict: "chosen" | "ruled_out"; key: number; reason?: string; removed?: string } | null>(null);
  const [reasons, setReasons] = useState<{ chosen: string[]; ruled_out: string[] }>({ chosen: [], ruled_out: [] });
  const loadReasons = useCallback(() => void projectApi.reasons().then(setReasons).catch(() => {}), []);
  useEffect(loadReasons, [loadReasons]);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const judge = useCallback(
    (ids: string[], state: RefState, opts: { quiet?: boolean } = {}) => {
      if (!ids.length) return;
      const all = nodesRef.current;
      const me = ids.length === 1 ? all.find((n) => n.id === ids[0]) : undefined;
      const wasWaiting = (me?.type === "ref" || me?.type === "sketch") && me.data.state === "proposed";
      patchMany(ids, { state, reason: "" });
      setJudged(state === "chosen" || state === "ruled_out" ? { ids, verdict: state, key: Date.now() } : null);
      // Review moves on by itself; the canvas behind it stays where it is.
      if (!me || !wasWaiting || opts.quiet) return;
      // On to the nearest suggestion still waiting: under the same topic first, then anywhere.
      const waiting = all.filter((n) => (n.type === "ref" || n.type === "sketch") && n.id !== me.id && !n.data.leaving && n.data.state === "proposed");
      if (!waiting.length) return;
      const topicsOf = (nid: string) => edgesRef.current.flatMap((e) => (e.source === nid ? [e.target] : e.target === nid ? [e.source] : [])).filter((x) => all.find((n) => n.id === x)?.type === "topic");
      const mine = new Set(topicsOf(me.id));
      const siblings = waiting.filter((n) => topicsOf(n.id).some((t) => mine.has(t)));
      const far = (n: AnyNode) => Math.hypot(n.position.x - me.position.x, n.position.y - me.position.y);
      const next = [...(siblings.length ? siblings : waiting)].sort((a, b) => far(a) - far(b))[0]!;
      setNodes((ns) => ns.map((n) => (!!n.selected !== (n.id === next.id) ? ({ ...n, selected: n.id === next.id } as AnyNode) : n)));
      revealRef.current([next.id], [next.position]);
    },
    [patchMany],
  );
  const giveReason = useCallback(
    (text: string) => {
      const reason = text.trim().slice(0, 400);
      const j = judgedRef.current;
      if (!j || !reason || j.reason) return;
      if (j.removed) {
        // The cards are gone: the reason goes to the record of them, after the removal itself has landed.
        const ids = j.ids;
        queue.current = queue.current.then(() => projectApi.whyRemoved(id, ids, reason)).catch((e) => onError((e as Error).message));
      } else {
        // Only onto cards that still have this verdict: ⌘Z, or another window, may have changed one since.
        const still = j.ids.filter((x) => {
          const n = nodesRef.current.find((m) => m.id === x);
          return !!n && !n.data.leaving && (n.type === "ref" || n.type === "sketch") && n.data.state === j.verdict;
        });
        if (!still.length) return setJudged(null);
        patchMany(still, { reason });
      }
      setJudged({ ...j, reason });
      setTimeout(loadReasons, 600);
    },
    [id, patchMany, loadReasons, onError],
  );
  // The strip steps aside by itself: quickly once a reason is given, in a while if not.
  // Not while Review is open: it asks why right beside the picture, and waits for an answer.
  useEffect(() => {
    if (!judged || reviewing) return;
    const t = setTimeout(() => setJudged((j) => (j?.key === judged.key ? null : j)), judged.reason ? 1600 : 12_000);
    return () => clearTimeout(t);
  }, [judged, reviewing]);
  const judgedRef = useRef(judged);
  judgedRef.current = judged;
  // With a sketch open in the studio, the keys belong to it.
  const viewingRef = useRef<string | null>(null);
  viewingRef.current = viewing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || viewingRef.current || reviewingRef.current) return;
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      // R: review FRIDAY's suggestions one at a time.
      if (k === "r" && !e.shiftKey && !document.querySelector(".detail")) {
        if (openReviewRef.current()) e.preventDefault();
        return;
      }
      // 1–5 pick one of the offered reasons for the verdict just given.
      const j = judgedRef.current;
      if (j && !j.reason && /^[1-5]$/.test(k)) {
        const pick = reasonsRef.current[j.verdict][Number(k) - 1];
        if (pick) {
          e.preventDefault();
          giveReason(pick);
        }
        return;
      }
      const state: RefState | null = k === "k" ? "kept" : k === "c" ? "chosen" : k === "x" ? "ruled_out" : null;
      if (!state) return;
      const picked = nodesRef.current.filter((n) => n.selected && !n.data.leaving && (n.type === "ref" || n.type === "sketch"));
      if (!picked.length) return;
      e.preventDefault();
      // The same key again takes the verdict back, like the buttons do.
      const all = picked.every((n) => (n.data as RefData).state === state);
      judge(picked.map((n) => n.id), all && state !== "kept" ? "kept" : state);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [judge, giveReason]);
  const reasonsRef = useRef(reasons);
  reasonsRef.current = reasons;

  /**
   * Take cards off the canvas. Taking off a suggestion (or a save ruled out without a reason)
   * is remembered as a quiet "no" at the companion, and the strip asks why, the way it does
   * after ruling something out. No reason is needed.
   */
  const remove = useCallback(
    (ids: string[]) => {
      const all = nodesRef.current;
      const asked = all.filter((n): n is RefNode | SketchNode =>
        ids.includes(n.id) && !n.data.leaving && (n.type === "ref" || n.type === "sketch") &&
        (n.data.state === "proposed" || (n.data.state === "ruled_out" && !n.data.reason)),
      );
      removeLocal(ids);
      commit(ids.map((x) => ({ op: "remove_node" as const, id: x })));
      if (!asked.length) return;
      const n = asked.length;
      const noun = asked.every((x) => x.data.state === "proposed") ? ["a suggestion", "suggestions"]
        : asked.every((x) => x.type === "ref") ? ["a save", "saves"]
        : asked.every((x) => x.type === "sketch") ? ["a sketch", "sketches"] : ["a card", "cards"];
      setJudged({ ids: asked.map((x) => x.id), verdict: "ruled_out", key: Date.now(), removed: `Removed ${n === 1 ? noun[0] : `${n} ${noun[1]}`}` });
    },
    [removeLocal, commit],
  );

  /** Add nodes (and lines to them) here and at the companion. */
  const add = useCallback(
    (list: AnyNode[], links: { source: string; target: string }[] = []) => {
      setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), ...list]);
      const newEdges = links.map((l) => ({ id: localId(), ...l }));
      setEdges((es) => [...es, ...newEdges.map((e) => toEdge({ ...e, label: "" }))]);
      commit([
        ...list.map((n) => ({
          op: "add_node" as const,
          node: { id: n.id, kind: n.type, ref_id: n.type === "ref" ? n.data.refId : null, data: stored(n), x: n.position.x, y: n.position.y },
        })),
        ...newEdges.map((edge) => ({ op: "add_edge" as const, edge })),
      ]);
      settle(new Set(list.map((n) => n.id)));
    },
    [commit, settle],
  );

  const sizeOf = (n: AnyNode) => ({ w: n.measured?.width ?? (n.type === "ref" ? 220 : n.type === "sketch" ? 360 : n.type === "build" ? 380 : 240), h: n.measured?.height ?? (n.type === "sketch" ? 300 : n.type === "build" ? 330 : 120) });

  const note = useCallback(
    (forId: string) => {
      const from = nodesRef.current.find((n) => n.id === forId);
      if (!from) return;
      const { w, h } = sizeOf(from);
      const nid = localId();
      // Beside it if there's room, else below, left or above; never on top of something.
      const NW = 228, NH = 90, GAP = 36;
      const p = from.position;
      const spots = [
        { x: p.x + w + GAP, y: p.y + 12 }, { x: p.x, y: p.y + h + GAP }, { x: p.x - NW - GAP, y: p.y + 12 }, { x: p.x, y: p.y - NH - GAP },
        { x: p.x + w + GAP, y: p.y + h + GAP },
      ];
      const free = (s: { x: number; y: number }) =>
        nodesRef.current.every((n) => {
          const o = sizeOf(n);
          return s.x + NW + 8 < n.position.x || s.x > n.position.x + o.w + 8 || s.y + NH + 8 < n.position.y || s.y > n.position.y + o.h + 8;
        });
      const at = spots.find(free) ?? spots[0]!;
      add(
        [{ id: nid, type: "note", position: at, data: { text: "", focus: true, enter: 0 }, selected: true }],
        [{ source: nid, target: forId }],
      );
    },
    [add],
  );

  const clearFocus = useCallback((nid: string) => {
    setNodes((ns) => ns.map((n) => (n.id === nid && n.data.focus ? ({ ...n, data: { ...n.data, focus: false } } as AnyNode) : n)));
  }, []);

  // ---- Topics fold away what's been set aside ----
  // Under any topic, saves ruled out fold away behind a small "3 ruled out" on it, so ruling
  // out is as tidy as removing. Under a locked topic, everything not chosen folds ("+5
  // considered"). Folding is for saves only; sketches stay in view.

  const fold = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const near = new Map<string, string[]>();
    for (const e of edges) {
      (near.get(e.source) ?? near.set(e.source, []).get(e.source)!).push(e.target);
      (near.get(e.target) ?? near.set(e.target, []).get(e.target)!).push(e.source);
    }
    /** Whether this topic folds this save away. */
    const folds = (t: TopicNode, k: RefNode) => (t.data.status === "locked" ? k.data.state !== "chosen" : k.data.state === "ruled_out");
    const hide = new Set<string>();
    const considered = new Map<string, { n: number; open: boolean; locked: boolean }>();
    for (const t of nodes) {
      if (t.type !== "topic") continue;
      const kids = (near.get(t.id) ?? []).map((x) => byId.get(x)).filter((n): n is RefNode => n?.type === "ref" && !n.data.leaving && folds(t, n));
      if (!kids.length) continue;
      considered.set(t.id, { n: kids.length, open: opened.has(t.id), locked: t.data.status === "locked" });
      if (!opened.has(t.id)) kids.forEach((k) => hide.add(k.id));
    }
    // A save under several topics folds only when every one of them folds it.
    for (const x of [...hide]) {
      const k = byId.get(x) as RefNode;
      const topics = (near.get(x) ?? []).map((y) => byId.get(y)).filter((n): n is TopicNode => n?.type === "topic");
      if (topics.some((t) => !folds(t, k) || opened.has(t.id))) hide.delete(x);
    }
    // Notes only about folded saves fold with them.
    for (const n of nodes) {
      const l = near.get(n.id) ?? [];
      if (n.type === "note" && l.length && l.every((x) => hide.has(x))) hide.add(n.id);
    }
    return { hide, considered };
  }, [nodes, edges, opened]);

  // Folding plays out: they shrink toward the topic, then go; unfolding, they rise back in.
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [folding, setFolding] = useState<Set<string>>(() => new Set());
  const [unfolding, setUnfolding] = useState<Map<string, number>>(() => new Map());
  const firstFold = useRef(true);
  useEffect(() => {
    if (!loaded) return;
    const want = fold.hide;
    if (firstFold.current) {
      firstFold.current = false;
      setFolded(new Set(want));
      return;
    }
    const going = [...want].filter((x) => !folded.has(x) && !folding.has(x));
    const coming = [...folded].filter((x) => !want.has(x));
    if (coming.length) {
      setFolded((f) => new Set([...f].filter((x) => want.has(x))));
      setUnfolding(new Map(coming.map((x, i) => [x, i])));
      setTimeout(() => setUnfolding(new Map()), 1200);
    }
    if (going.length) {
      setFolding((f) => new Set([...f, ...going]));
      setTimeout(() => {
        setFolded((f) => new Set([...f, ...going]));
        setFolding((f) => new Set([...f].filter((x) => !going.includes(x))));
      }, prefersReducedMotion() ? 0 : 280);
    }
  }, [fold.hide, loaded, folded, folding]);

  const shownNodes = useMemo(() => {
    if (!folded.size && !folding.size && !unfolding.size) return nodes;
    return nodes.map((n) => {
      const gone = folded.has(n.id), going = folding.has(n.id), back = unfolding.get(n.id);
      if (!gone && !going && back === undefined) return n;
      return {
        ...n,
        hidden: gone,
        selected: gone ? false : n.selected,
        className: going ? "folding" : back !== undefined ? "unfold" : undefined,
        style: back !== undefined ? ({ "--i": back } as React.CSSProperties) : undefined,
      } as AnyNode;
    });
  }, [nodes, folded, folding, unfolding]);
  // Every card has a name, for screen readers and for tools that read the page ("Save: Calendly, suggested").
  const named = useRef(new Map<string, { from: AnyNode; title: string; out: AnyNode }>());
  const labelledNodes = useMemo(() => {
    const stateWord = (st?: RefState) => (st === "ruled_out" ? "ruled out" : st === "proposed" ? "suggested" : st ?? "kept");
    // A long title is shortened, so the verdict at the end is never cut off.
    const short = (t: string) => (t.length > 70 ? `${t.slice(0, 69).trimEnd()}…` : t);
    const seen = new Set<string>();
    const out = shownNodes.map((n) => {
      seen.add(n.id);
      const title = n.type === "ref" ? cards.get(n.data.refId)?.title ?? "" : "";
      const had = named.current.get(n.id);
      if (had && had.from === n && had.title === title) return had.out;
      let label: string;
      if (n.type === "topic") label = `Topic: ${short(n.data.title || facetLabel(n.data.facet))}, ${n.data.status === "locked" ? "locked" : "exploring"}`;
      else if (n.type === "ref") label = `Save: ${short(title) || "not in the library"}, ${stateWord(n.data.state)}`;
      else if (n.type === "sketch") label = `Sketch: ${short(n.data.title || "Untitled sketch")}, ${stateWord(n.data.state)}`;
      else if (n.type === "build") label = `Build: ${short(n.data.title || "Untitled")}`;
      else label = `Note: ${n.data.text.trim().split(/\s+/).slice(0, 8).join(" ") || "empty"}`;
      const o = { ...n, ariaLabel: label } as AnyNode;
      named.current.set(n.id, { from: n, title, out: o });
      return o;
    });
    for (const k of named.current.keys()) if (!seen.has(k)) named.current.delete(k);
    return out;
  }, [shownNodes, cards]);

  const shownEdges = useMemo(
    () => (folded.size ? edges.map((e) => (folded.has(e.source) || folded.has(e.target) ? { ...e, hidden: true } : e)) : edges),
    [edges, folded],
  );

  // Selection never stays on a card that has folded away (its keys would still act on it).
  useEffect(() => {
    if (!nodesRef.current.some((n) => n.selected && fold.hide.has(n.id))) return;
    setNodes((ns) => ns.map((n) => (n.selected && fold.hide.has(n.id) ? ({ ...n, selected: false } as AnyNode) : n)));
  }, [fold.hide]);
  // A topic with nothing left to fold forgets it was opened, so the next one ruled out folds away again.
  useEffect(() => {
    setOpened((o) => {
      const keep = [...o].filter((t) => fold.considered.has(t));
      return keep.length === o.size ? o : new Set(keep);
    });
  }, [fold.considered]);

  const toggleConsidered = useCallback((topicId: string) => {
    setOpened((o) => {
      const next = new Set(o);
      if (!next.delete(topicId)) next.add(topicId);
      return next;
    });
  }, []);

  // From a save, several, or a decision: FRIDAY makes a sketch that takes from them.
  const sketchFrom = useCallback((ids: string[]) => {
    const picked = nodesRef.current.filter((n) => ids.includes(n.id));
    if (!picked.length) return;
    const about = describePicked(id, picked, cards);
    const many = picked.length > 1;
    const text = many
      ? "Sketch a direction from these, for this project: take from each what it does best, hang it from them, and say what you took from which."
      : picked[0]!.type === "topic"
        ? "Sketch a direction from this decision and its chosen saves, for this project."
        : picked[0]!.type === "sketch"
          ? "Try 3 alternates of this sketch, each a different direction."
          : "Sketch a direction from this save, for this project: take what it does best, not a copy of it.";
    latest.current.onAskWith(text, about);
  }, [id, cards]);

  // The saves under each topic, for its Tidy and its label from far away.
  const counts = useMemo(() => {
    const kind = new Map(nodes.map((n) => [n.id, n]));
    const out = new Map<string, { saves: number; chosen: number }>();
    for (const e of edges) {
      for (const [t, r] of [[e.source, e.target], [e.target, e.source]] as const) {
        const tn = kind.get(t), rn = kind.get(r);
        if (tn?.type !== "topic" || rn?.type !== "ref" || rn.data.leaving) continue;
        const c = out.get(t) ?? out.set(t, { saves: 0, chosen: 0 }).get(t)!;
        c.saves++;
        if (rn.data.state === "chosen") c.chosen++;
      }
    }
    return out;
  }, [nodes, edges]);

  const tidyRef = useRef<(topicId: string) => void>(() => {});
  const zoomToRef = useRef<(ids: string[]) => void>(() => {});
  const zoomTo = useCallback((topicId: string) => zoomToRef.current([topicId]), []);
  const tidyStable = useCallback((t: string) => tidyRef.current(t), []);
  const actions = useMemo<Actions>(
    () => ({ project: id, cards, patch, judge, remove, note, open: onOpenRef, openSketch: setViewing, clearFocus, ask: onAsk, error: onError, sketchFrom, considered: fold.considered, toggleConsidered, counts, tidy: tidyStable, zoomTo }),
    [id, cards, patch, judge, remove, note, onOpenRef, clearFocus, onAsk, onError, sketchFrom, fold.considered, toggleConsidered, counts, tidyStable, zoomTo],
  );

  // The measured palettes of the saves on this canvas (not the ruled-out ones), for a sketch to try on.
  const palettes = useMemo(() => {
    const seen = new Set<string>();
    return nodes.flatMap((n) => {
      if (n.type !== "ref" || n.data.state === "ruled_out" || seen.has(n.data.refId)) return [];
      const c = cards.get(n.data.refId);
      if (!c || c.palette.length < 3) return [];
      seen.add(n.data.refId);
      return [{ id: c.id, title: c.title, colors: c.palette }];
    }).slice(0, 24);
  }, [nodes, cards]);

  // ---- Review: the suggestions, one at a time ----

  /** Suggested saves and sketches still waiting, in reading order: topic by topic, left to right; inside one, top to bottom. */
  const waitingInOrder = () => {
    const all = nodesRef.current;
    const byId = new Map(all.map((n) => [n.id, n]));
    const topicOf = new Map<string, AnyNode>();
    for (const e of edgesRef.current) {
      for (const [a, b] of [[e.source, e.target], [e.target, e.source]] as const) {
        const t = byId.get(b);
        if (t?.type !== "topic") continue;
        const was = topicOf.get(a);
        if (!was || t.position.x < was.position.x) topicOf.set(a, t);
      }
    }
    const waiting = all.filter((n) => (n.type === "ref" || n.type === "sketch") && !n.data.leaving && n.data.state === "proposed");
    const key = (n: AnyNode) => {
      const t = topicOf.get(n.id);
      return t ? [0, t.position.x, t.position.y, n.position.y, n.position.x] : [1, 0, 0, n.position.y, n.position.x];
    };
    return waiting
      .map((n) => ({ n, k: key(n) }))
      .sort((a, b) => a.k.reduce((d, v, i) => d || v - b.k[i]!, 0))
      .map((x) => x.n.id);
  };
  const waitingCount = nodes.reduce((c, n) => c + ((n.type === "ref" || n.type === "sketch") && !n.data.leaving && n.data.state === "proposed" ? 1 : 0), 0);
  const openReview = () => {
    if (viewingRef.current || reviewingRef.current) return false;
    const list = waitingInOrder();
    if (!list.length) return false;
    setNotice(null);
    setJudged(null);
    setReviewing(list);
    return true;
  };
  const openReviewRef = useRef(openReview);
  openReviewRef.current = openReview;

  const reviewItems = useMemo<ReviewItem[]>(() => {
    if (!reviewing) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const topicName = (nid: string) => {
      const ts = edges.flatMap((e) => (e.source === nid ? [e.target] : e.target === nid ? [e.source] : [])).map((x) => byId.get(x)).filter((n): n is TopicNode => n?.type === "topic");
      const t = ts.sort((a, b) => a.position.x - b.position.x)[0];
      return t ? t.data.title || facetLabel(t.data.facet) : undefined;
    };
    return reviewing.map((rid): ReviewItem => {
      const n = byId.get(rid);
      if (!n || n.data.leaving || (n.type !== "ref" && n.type !== "sketch")) return { id: rid, kind: "ref", state: "proposed", title: "", palette: [], gone: true };
      if (n.type === "sketch") {
        return { id: rid, kind: "sketch", state: n.data.state ?? "kept", title: n.data.title || "Untitled sketch", why: n.data.tries, topic: topicName(rid), picture: sketchPicture(id, rid, n.data.version), palette: [], gone: false };
      }
      const c = cards.get(n.data.refId);
      return {
        id: rid, kind: "ref", refId: n.data.refId, state: n.data.state ?? "kept", title: c?.title ?? "Not in the library", why: n.data.taking,
        topic: topicName(rid), picture: c?.thumb ?? undefined, video: c?.type === "video", palette: c?.palette ?? [], gone: false,
      };
    });
  }, [reviewing, nodes, edges, cards, id]);

  // ---- What's selected, for Ask ----
  const picked = shownNodes.filter((n) => n.selected && !n.hidden && !n.data.leaving);
  const pickedKey = picked.map((n) => n.id).join(",");
  useEffect(() => {
    latest.current.onSelection(picked.length ? describePicked(id, picked, cards) : null);
  }, [pickedKey, cards.size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => latest.current.onSelection(null), []);

  // ---- Undo: ⌘Z for your own changes, and taking back what the assistant did ----

  const undo = useCallback(
    (who: "me" | "assistant") => {
      // The "why?" was about the change being taken back.
      if (who === "me") setJudged(null);
      queue.current = queue.current
        .then(() => projectApi.undo(id, CLIENT, who))
        .then((res) => {
          if (res.seq) seq.current = Math.max(seq.current, res.seq);
          addCards(res.cards);
          if (res.ops.length) applyRef.current(res.ops);
          if (who === "assistant") setNotice(null);
        })
        .catch((e) => onError((e as Error).message));
    },
    [id, addCards, onError],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if (reviewingRef.current) return;
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      undo("me");
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [undo]);

  // The note about the assistant's change goes away on its own after a while.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 15000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- Where new things go ----

  const center = () => {
    const r = wrap.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? innerWidth) / 2, y: (r?.top ?? 0) + (r?.height ?? innerHeight) / 2 });
  };
  const selectedTopic = () => nodesRef.current.find((n) => n.selected && n.type === "topic") as TopicNode | undefined;

  /**
   * Saves under a topic sit in rows of three beneath it, below what's there already,
   * skipping any spot something else on the canvas is in. (The companion places the
   * assistant's saves the same way.)
   */
  const slotsUnder = (topic: AnyNode, count: number) => {
    const linked = new Set(edges.flatMap((e) => (e.source === topic.id ? [e.target] : e.target === topic.id ? [e.source] : [])));
    const kids = nodesRef.current.filter((n) => n.type === "ref" && linked.has(n.id));
    const top = kids.length ? Math.max(...kids.map((n) => n.position.y)) + 400 : topic.position.y + sizeOf(topic).h + 64;
    const taken = (x: number, y: number) =>
      nodesRef.current.some((n) => {
        const o = sizeOf(n);
        return !(x + 232 <= n.position.x || x >= n.position.x + o.w + 12 || y + 382 <= n.position.y || y >= n.position.y + o.h + 12);
      });
    const out: { x: number; y: number }[] = [];
    for (let r = 0; out.length < count && r < 80; r++) {
      for (let c = 0; c < 3 && out.length < count; c++) {
        const spot = { x: topic.position.x - 4 + c * 236, y: top + r * 400 };
        if (!taken(spot.x, spot.y)) out.push(spot);
      }
    }
    return out;
  };

  /** Glide the view to these nodes, unless they're already all on screen. */
  const reveal = (ids: string[], spots: { x: number; y: number }[]) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const tl = flow.screenToFlowPosition({ x: r.left + 40, y: r.top + 90 });
    const br = flow.screenToFlowPosition({ x: r.right - 40, y: r.bottom - 100 });
    if (spots.every((p) => p.x >= tl.x && p.y >= tl.y && p.x + 230 <= br.x && p.y + 260 <= br.y)) return;
    setTimeout(() => void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: prefersReducedMotion() ? 0 : 700, padding: 0.3, maxZoom: 1 }), 80);
  };
  revealRef.current = reveal;

  const addTopic = (facet: TopicFacet) => {
    const from = selectedTopic();
    const at = from ? { x: from.position.x + 760, y: from.position.y } : (() => {
      const c = center();
      return { x: c.x - 120, y: c.y - 60 };
    })();
    const nid = localId();
    add([{ id: nid, type: "topic", position: at, data: { title: "", facet, status: "exploring", focus: true, enter: 0 }, selected: true }], from ? [{ source: from.id, target: nid }] : []);
    if (from) setTimeout(() => flow.fitView({ nodes: [{ id: from.id }, { id: nid }], duration: 600, padding: 0.4, maxZoom: 1 }), 60);
  };

  const addNote = (at?: { x: number; y: number }) => {
    const p = at ?? center();
    add([{ id: localId(), type: "note", position: { x: p.x - 110, y: p.y - 30 }, data: { text: "", focus: true, enter: 0 }, selected: true }]);
  };

  /** Put saves on the canvas: under the selected topic when there is one, else where asked or in the middle. */
  const addSaves = (list: RefCard[], at?: { x: number; y: number }) => {
    addCards(list);
    const topic = at ? undefined : selectedTopic();
    const spots = topic
      ? slotsUnder(topic, list.length)
      : list.map((_, i) => {
          const c = at ?? center();
          return { x: c.x - 110 + (i % 4) * 236, y: c.y - 120 + Math.floor(i / 4) * 400 };
        });
    const made: RefNode[] = list.map((c, i) => ({ id: localId(), type: "ref", position: spots[i]!, data: { refId: c.id, state: "kept", enter: i } }));
    add(made, topic ? made.map((n) => ({ source: topic.id, target: n.id })) : []);
    if (topic) {
      // Keep the topic selected, so more saves can go under it.
      setNodes((ns) => ns.map((n) => (n.id === topic.id ? { ...n, selected: true } : n)));
    }
    // If any landed out of sight, glide over to show them.
    reveal(made.map((n) => n.id).concat(topic ? [topic.id] : []), spots);
  };

  // ---- Moving cards: they glide to where they're going ----

  const gliding = useRef<{ frame: number; to: Map<string, { x: number; y: number }> } | null>(null);
  /** Move cards to new places, gliding there (about 0.4 s; at once with reduced motion). The places are already sent. */
  const glide = useCallback((to: Map<string, { x: number; y: number }>) => {
    if (!to.size) return;
    // A glide still going finishes where it was headed first.
    const was = gliding.current;
    if (was) cancelAnimationFrame(was.frame);
    const finish = new Map([...(was?.to ?? []), ...to]);
    if (prefersReducedMotion()) {
      gliding.current = null;
      setNodes((ns) => ns.map((n) => (finish.has(n.id) ? ({ ...n, position: finish.get(n.id)! } as AnyNode) : n)));
      return;
    }
    if (was) setNodes((ns) => ns.map((n) => (was.to.has(n.id) && !to.has(n.id) ? ({ ...n, position: was.to.get(n.id)! } as AnyNode) : n)));
    const from = new Map(nodesRef.current.filter((n) => to.has(n.id)).map((n) => [n.id, n.position]));
    const start = performance.now();
    const MS = 420;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / MS);
      const k = ease(t);
      setNodes((ns) => ns.map((n) => {
        const a = from.get(n.id), b = to.get(n.id);
        return a && b ? ({ ...n, position: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k } } as AnyNode) : n;
      }));
      if (t < 1) gliding.current = { frame: requestAnimationFrame(step), to };
      else gliding.current = null;
    };
    gliding.current = { frame: requestAnimationFrame(step), to };
  }, []);
  const glideRef = useRef(glide);
  glideRef.current = glide;

  // ---- A topic carries its family when dragged; Option drags it alone ----

  const dragging = useRef<{ lead: string; from: { x: number; y: number }; family: Map<string, { x: number; y: number }> } | null>(null);
  // Whether Option is held, from the keys themselves too: the drag's own event doesn't always say.
  const optionHeld = useRef(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => (optionHeld.current = e.altKey);
    const off = () => (optionHeld.current = false);
    addEventListener("keydown", on);
    addEventListener("keyup", on);
    addEventListener("blur", off);
    return () => {
      removeEventListener("keydown", on);
      removeEventListener("keyup", on);
      removeEventListener("blur", off);
    };
  }, []);
  const onNodeDragStart = useCallback((e: MouseEvent | TouchEvent, node: AnyNode, moving: AnyNode[]) => {
    dragging.current = null;
    const topics = moving.filter((n) => n.type === "topic").map((n) => n.id);
    if (!topics.length || e.altKey || optionHeld.current) return;
    const mine = new Set(moving.map((n) => n.id));
    const fam = familyOf(topics, nodesRef.current, edgesRef.current);
    // A card that is itself being dragged already moves; it isn't moved twice.
    const family = new Map(nodesRef.current.filter((n) => fam.has(n.id) && !mine.has(n.id)).map((n) => [n.id, { ...n.position }]));
    if (family.size) dragging.current = { lead: node.id, from: { ...node.position }, family };
  }, []);
  const onNodeDrag = useCallback((_: unknown, node: AnyNode) => {
    const d = dragging.current;
    if (!d || node.id !== d.lead) return;
    const dx = node.position.x - d.from.x, dy = node.position.y - d.from.y;
    setNodes((ns) => ns.map((n) => {
      const p = d.family.get(n.id);
      return p ? ({ ...n, position: { x: p.x + dx, y: p.y + dy } } as AnyNode) : n;
    }));
  }, []);

  // ---- Tidy: a topic's saves in three columns beneath it ----

  const tidy = useCallback((topicId: string) => {
    const all = nodesRef.current;
    const topic = all.find((n) => n.id === topicId);
    if (!topic) return;
    const fam = familyOf([topicId], all, edgesRef.current);
    const linked = (nid: string) => edgesRef.current.flatMap((e) => (e.source === nid ? [e.target] : e.target === nid ? [e.source] : []));
    const direct = new Set(linked(topicId));
    const saves = all.filter((n): n is RefNode => n.type === "ref" && direct.has(n.id) && fam.has(n.id) && !n.data.leaving);
    if (saves.length < 2) return;
    // Chosen first, then kept, suggested, ruled out; inside each, as they read now.
    const rank: Record<string, number> = { chosen: 0, kept: 1, proposed: 2, ruled_out: 3 };
    saves.sort((a, b) => rank[a.data.state ?? "kept"]! - rank[b.data.state ?? "kept"]! || a.position.y - b.position.y || a.position.x - b.position.x);
    // A note only about one save goes right beneath it.
    const notesOf = new Map<string, AnyNode[]>();
    for (const n of all) {
      if (n.type !== "note" || !fam.has(n.id)) continue;
      const l = linked(n.id);
      if (l.length === 1 && saves.some((x) => x.id === l[0])) (notesOf.get(l[0]!) ?? notesOf.set(l[0]!, []).get(l[0]!)!).push(n);
    }
    // Folded cards may never have been measured: a typical save's height stands in.
    const h = (n: AnyNode) => n.measured?.height ?? (n.type === "ref" ? 330 : 90);
    const to = new Map<string, { x: number; y: number }>();
    let y = topic.position.y + (topic.measured?.height ?? 140) + 64;
    // Something staying where it is right under the topic (a note on the topic, a sketch) keeps
    // its place: the saves start below it rather than on top of it.
    const moving = new Set([...saves.map((n) => n.id), ...[...notesOf.values()].flat().map((n) => n.id)]);
    const left = topic.position.x - 4, right = left + 2 * 236 + 220;
    for (let pass = 0; pass < 6; pass++) {
      const under = all.filter((n) => {
        if (n.id === topicId || moving.has(n.id) || n.data.leaving) return false;
        const w = n.measured?.width ?? sizeOf(n).w, hh = n.measured?.height ?? sizeOf(n).h;
        return n.position.x < right && n.position.x + w > left && n.position.y < y + 160 && n.position.y + hh > topic.position.y + 10;
      });
      const bottom = Math.max(...under.map((n) => n.position.y + (n.measured?.height ?? sizeOf(n).h) + 44), -Infinity);
      if (bottom <= y) break;
      y = bottom;
    }
    for (let i = 0; i < saves.length; i += 3) {
      let tallest = 0;
      saves.slice(i, i + 3).forEach((sv, c) => {
        const x = topic.position.x - 4 + c * 236;
        to.set(sv.id, { x, y });
        let bottom = y + h(sv);
        for (const nt of notesOf.get(sv.id) ?? []) {
          to.set(nt.id, { x: x + 4, y: bottom + 16 });
          bottom += 16 + h(nt);
        }
        tallest = Math.max(tallest, bottom - y);
      });
      y += tallest + 44;
    }
    const moves = [...to].filter(([nid, p]) => {
      const n = all.find((m) => m.id === nid)!;
      return Math.abs(n.position.x - p.x) > 0.5 || Math.abs(n.position.y - p.y) > 0.5;
    });
    if (!moves.length) return;
    commit(moves.map(([nid, p]) => ({ op: "update_node" as const, id: nid, x: p.x, y: p.y })));
    glide(new Map(moves));
    // If part of the family is out of sight, glide the view over to it.
    const r = wrap.current?.getBoundingClientRect();
    if (r) {
      const tl = flow.screenToFlowPosition({ x: r.left + 40, y: r.top + 70 });
      const br = flow.screenToFlowPosition({ x: r.right - 40, y: r.bottom - 100 });
      const out = [topic.position, ...to.values()].some((p) => p.x < tl.x || p.y < tl.y || p.x + 220 > br.x || p.y + 200 > br.y);
      if (out) {
        const ids = [topicId, ...to.keys()];
        setTimeout(() => void flow.fitView({ nodes: ids.map((x) => ({ id: x })), duration: prefersReducedMotion() ? 0 : 600, padding: 0.2, maxZoom: 1 }), 460);
      }
    }
  }, [commit, glide, flow]);

  tidyRef.current = tidy;

  // ---- Seeing the whole canvas, a part of it, or 100% ----

  const ms = () => (prefersReducedMotion() ? 0 : 500);
  const showEverything = useCallback(() => void flow.fitView({ padding: 0.25, duration: ms(), maxZoom: 1 }), [flow]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Glide in to these cards; a topic among them brings its whole family. */
  const zoomToNodes = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const topics = ids.filter((x) => nodesRef.current.find((n) => n.id === x)?.type === "topic");
    const fam = topics.length ? familyOf(topics, nodesRef.current, edgesRef.current) : new Set<string>();
    const shown = new Set(nodesRef.current.filter((n) => !folded.has(n.id)).map((n) => n.id));
    const all = [...new Set([...ids, ...fam])].filter((x) => shown.has(x));
    void flow.fitView({ nodes: all.map((x) => ({ id: x })), padding: 0.2, duration: prefersReducedMotion() ? 0 : 650, maxZoom: 1 });
  }, [flow, folded]);
  zoomToRef.current = zoomToNodes;
  const actualSize = useCallback(() => void flow.zoomTo(1, { duration: prefersReducedMotion() ? 0 : 400 }), [flow]);
  // Shift+1 shows everything, Shift+2 the selection, Shift+0 is 100%: the keys Figma uses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (viewingRef.current || reviewingRef.current || document.querySelector(".detail")) return;
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      if (e.code === "Digit1") showEverything();
      else if (e.code === "Digit2") zoomToRef.current(nodesRef.current.filter((n) => n.selected && !n.data.leaving).map((n) => n.id));
      else if (e.code === "Digit0") actualSize();
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [showEverything, actualSize]);

  // ---- React Flow wiring ----

  const onNodesChange = useCallback((changes: NodeChange<AnyNode>[]) => {
    // Removals go through onBeforeDelete, so they can animate out and be sent once.
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== "remove"), ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes.filter((c) => c.type !== "remove"), es)), []);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      if (edges.some((e) => (e.source === c.source && e.target === c.target) || (e.source === c.target && e.target === c.source))) return;
      const edge = { id: localId(), source: c.source, target: c.target };
      setEdges((es) => [...es, toEdge({ ...edge, label: "" })]);
      commit([{ op: "add_edge", edge }]);
    },
    [edges, commit],
  );

  const onBeforeDelete = useCallback(
    async ({ nodes: ns, edges: es }: { nodes: AnyNode[]; edges: Edge[] }) => {
      const gone = new Set(ns.map((n) => n.id));
      // Lines to removed nodes go with them at the companion; only send the others.
      const lonely = es.filter((e) => !gone.has(e.source) && !gone.has(e.target));
      if (ns.length) remove([...gone]);
      if (lonely.length) {
        const ids = new Set(lonely.map((e) => e.id));
        setEdges((all) => all.filter((e) => !ids.has(e.id)));
        commit(lonely.map((e) => ({ op: "remove_edge" as const, id: e.id })));
      }
      return false;
    },
    [remove, commit],
  );

  // Everything that moved goes in one change, so one ⌘Z puts the whole family back.
  const onNodeDragStop = useCallback(
    (_: unknown, node: AnyNode, moved: AnyNode[]) => {
      const d = dragging.current;
      dragging.current = null;
      const ops: BoardOp[] = moved.map((n) => ({ op: "update_node" as const, id: n.id, x: n.position.x, y: n.position.y }));
      if (d && node.id === d.lead) {
        const dx = node.position.x - d.from.x, dy = node.position.y - d.from.y;
        if (dx || dy) for (const [nid, p] of d.family) ops.push({ op: "update_node", id: nid, x: p.x + dx, y: p.y + dy });
      }
      commit(ops);
    },
    [commit],
  );

  // Where you were looking, per project, for next time (this browser only).
  const viewKey = `panel.canvas.${id}`;
  const savedView = useMemo<Viewport | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(viewKey) ?? "null");
    } catch {
      return null;
    }
  }, [viewKey]);
  // As the view moves: the live zoom goes straight onto the wrapper (no redraw), so sizes can follow it;
  // and whether anything is in view at all, and whether everything is.
  const looked = useRef(0);
  const lookAround = useCallback((v: Viewport) => {
    const el = wrap.current;
    if (!el) return;
    el.style.setProperty("--z", String(v.zoom));
    const now = performance.now();
    if (now - looked.current < 90) return;
    looked.current = now;
    const r = el.getBoundingClientRect();
    const x0 = -v.x / v.zoom, y0 = -v.y / v.zoom, x1 = (r.width - v.x) / v.zoom, y1 = (r.height - v.y) / v.zoom;
    let any = false, all = true;
    for (const n of nodesRef.current) {
      if (n.data.leaving) continue;
      const w = n.measured?.width ?? 240, h = n.measured?.height ?? 200;
      const inside = n.position.x < x1 && n.position.x + w > x0 && n.position.y < y1 && n.position.y + h > y0;
      const whole = n.position.x >= x0 && n.position.x + w <= x1 && n.position.y >= y0 && n.position.y + h <= y1;
      if (inside) any = true;
      if (!whole) all = false;
    }
    setLost(nodesRef.current.length > 0 && !any);
    setPartOut(!all);
  }, []);
  const onMove = useCallback((_: unknown, v: Viewport) => lookAround(v), [lookAround]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      looked.current = 0;
      lookAround(flow.getViewport());
    }, 120);
    return () => clearTimeout(t);
  }, [loaded, nodes.length, lookAround]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMoveEnd = useCallback((_: unknown, v: Viewport) => {
    looked.current = 0;
    lookAround(v);
    try {
      localStorage.setItem(viewKey, JSON.stringify(v));
    } catch {
      /* not remembered, that's all */
    }
  }, [viewKey]);
  useEffect(() => {
    if (!loaded) return;
    if (savedView) void flow.setViewport(savedView);
    // Nothing to fit yet: plain size, so the first things added aren't huge.
    else if (!nodesRef.current.length) void flow.setViewport({ x: 0, y: 0, zoom: 1 });
    else requestAnimationFrame(() => void flow.fitView({ padding: 0.25, maxZoom: 1 }));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saves dragged in from the tray.
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-panel-ref")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-panel-ref");
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    const card = JSON.parse(raw) as RefCard;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addSaves([card], { x: p.x, y: p.y + 100 });
  };

  const empty = loaded && nodes.length === 0;

  return (
    <Ctx.Provider value={actions}>
      <div className={`canvas ${tray ? "with-tray" : ""} ${far ? "far" : ""}`} ref={wrap} onDragOver={onDragOver} onDrop={onDrop}>
        {meta && <Head id={id} name={meta.name} brief={meta.brief} commit={commit} setMeta={setMeta} onRenamed={onRenamed} onDeleted={onDeleted} onError={onError} />}
        <ReactFlow<AnyNode, Edge>
          nodes={labelledNodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onBeforeDelete={onBeforeDelete}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          onDoubleClick={(e) => {
            if (!(e.target as Element).classList.contains("react-flow__pane")) return;
            addNote(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          defaultViewport={savedView ?? undefined}
          minZoom={0.05}
          maxZoom={2.5}
          zoomOnDoubleClick={false}
          panOnScroll
          panOnScrollSpeed={PAN_SPEED}
          selectionOnDrag
          panOnDrag={[1, 2]}
          deleteKeyCode={["Backspace", "Delete"]}
          multiSelectionKeyCode="Shift"
          proOptions={{ hideAttribution: true }}
          fitViewOptions={{ padding: 0.25 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--dot)" />
          <SelectionTools nodes={shownNodes} judge={judge} remove={remove} onAsk={onAsk} onSketch={sketchFrom} />
          {/* Where you are, while part of the canvas is out of view: drag in it to move. */}
          {partOut && !lost && !empty && (
            <MiniMap
              className="canvas-map"
              pannable
              ariaLabel="Map of the canvas"
              nodeClassName={(n) => `mm-${n.type}`}
              nodeBorderRadius={4}
              maskColor="var(--map-mask)"
              maskStrokeColor="var(--map-line)"
              maskStrokeWidth={1.5}
              offsetScale={6}
            />
          )}
        </ReactFlow>

        {lost && !empty && !reviewing && (
          <div className="canvas-lost">
            <p className="canvas-lost-title">Nothing here</p>
            <button className="canvas-chip" onClick={showEverything}><Icon name="maximize" size={13} /> Show everything</button>
          </div>
        )}

        {empty && (
          <div className="canvas-empty">
            <p className="canvas-empty-title">Start with a decision</p>
            <p className="canvas-empty-text">Add a topic, like Typography, then pull saves in from your library. Double-click anywhere for a note.</p>
            <div className="canvas-empty-row">
              {FACETS.slice(0, 3).map((f) => (
                <button key={f.value} className="canvas-chip" onClick={() => addTopic(f.value)}>{f.label}</button>
              ))}
              <button className="canvas-chip" onClick={() => setTray(true)}><Icon name="image" size={13} /> Saves</button>
            </div>
          </div>
        )}

        {judged && !viewing && !reviewing && (
          <VerdictNote
            key={judged.key}
            label={judged.removed}
            verdict={judged.verdict}
            count={judged.ids.length}
            reason={judged.reason}
            offered={reasons[judged.verdict]}
            onReason={giveReason}
            onClose={() => setJudged(null)}
          />
        )}

        {notice && (
          <div className={`canvas-notice ${judged && !viewing ? "raised" : ""}`} key={notice.key} role="status">
            <span className="canvas-notice-dot" />
            <span>{notice.label}{notice.more > 0 && <span className="canvas-notice-more"> and {notice.more} more {notice.more === 1 ? "change" : "changes"}</span>}</span>
            {!notice.info && waitingCount > 0 && <button className="canvas-notice-undo" onClick={openReview} title="One at a time (R)">Review</button>}
            {!notice.info && <button className="canvas-notice-undo" onClick={() => undo("assistant")}>Undo</button>}
            <button className="canvas-notice-x" onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" size={12} /></button>
          </div>
        )}

        {reviewing && (
          <Review
            items={reviewItems}
            reasons={reasons}
            judge={(nid, state) => judge([nid], state, { quiet: true })}
            giveReason={giveReason}
            undo={() => undo("me")}
            open={(it) => (it.kind === "sketch" ? setViewing(it.id) : it.refId && onOpenRef(it.refId))}
            paused={!!viewing}
            onClose={() => {
              setReviewing(null);
              setJudged(null);
            }}
          />
        )}

        {(() => {
          const open = viewing ? nodes.find((n) => n.id === viewing && n.type === "sketch") as SketchNode | undefined : undefined;
          if (!open) return null;
          const sketchStamp = nodes.filter((n) => n.type === "sketch").map((n) => `${n.id}:${(n as SketchNode).data.state}:${(n as SketchNode).data.version}`).join(",") + edges.length;
          return (
            <Studio
              project={id}
              sketch={{ id: open.id, ...open.data }}
              stamp={sketchStamp}
              running={askRunning}
              doing={askDoing}
              unread={askUnread}
              askOpen={askOpen}
              setAskOpen={(v: boolean) => latest.current.setAskOpen(v)}
              palettes={palettes}
              mix={(text: string, ids: string[]) => {
                const these = ids.map((x) => nodes.find((n) => n.id === x)).filter((n): n is SketchNode => n?.type === "sketch");
                if (these.length < 2) return;
                const which = these.map((n, i) => `${"ABC"[i]} is “${n.data.title || "Untitled sketch"}” (${n.id})`).join(", ");
                latest.current.onAskWith(
                  `Make one new sketch that combines these directions. ${which}. What to take: ${text}. Start from the one that needs the least change (make_sketch with from: its id) and leave the rest of it as it is.`,
                  describePicked(id, these, cards),
                );
              }}
              onClose={() => setViewing(null)}
              onSwitch={setViewing}
              patch={patch}
              onError={onError}
              ask={(text: string, point?: SketchPoint, fan?: number, quiet?: boolean, figma?: CanvasSelection["figma"]) => {
                const about = { ...describePicked(id, [open], cards), ...(fan ? { fan } : {}), ...(figma ? { figma } : {}) };
                latest.current.onAskWith(text, point ? { ...about, label: `${point.label} in ${about.label}`.slice(0, 90), point } : about, quiet);
              }}
              onBuilt={(title) => {
                setViewing(null);
                setNotice({ label: `Claude Code is building ${title}: its card is under the sketch`, key: Date.now(), more: 0, info: true });
              }}
            />
          );
        })()}

        {tray && <Tray onClose={() => setTray(false)} onAdd={(c) => addSaves([c])} target={selectedTopic()?.data} />}

        {dock && createPortal(
          <Toolbar onTopic={addTopic} onNote={() => addNote()} tray={tray} onTray={() => setTray((v) => !v)} onFit={showEverything} onActualSize={actualSize} waiting={waitingCount} onReview={openReview} />,
          dock,
        )}
      </div>
    </Ctx.Provider>
  );
}

// ---------- What's selected, in a few words, for Ask ----------

const plural = (n: number, one: string, many: string) => (n === 1 ? `a ${one}` : `${n} ${many}`);

function describePicked(project: string, picked: AnyNode[], cards: Map<string, RefCard>): CanvasSelection {
  const topics = picked.filter((n) => n.type === "topic") as TopicNode[];
  const refs = picked.filter((n) => n.type === "ref") as RefNode[];
  const notes = picked.filter((n) => n.type === "note");
  const sketches = picked.filter((n) => n.type === "sketch") as SketchNode[];
  const builds = picked.filter((n) => n.type === "build") as BuildNode[];
  const topicName = (t: TopicNode) => t.data.title || facetLabel(t.data.facet);
  let label: string;
  if (picked.length === 1) {
    label = topics[0] ? topicName(topics[0]) : refs[0] ? cards.get(refs[0].data.refId)?.title ?? "A save" : sketches[0] ? sketches[0].data.title || "A sketch" : builds[0] ? `Build of ${builds[0].data.title}` : "A note";
  } else {
    const parts = [
      ...(topics.length <= 2 ? topics.map(topicName) : [plural(topics.length, "topic", "topics")]),
      ...(sketches.length ? [plural(sketches.length, "sketch", "sketches")] : []),
      ...(builds.length ? [plural(builds.length, "build", "builds")] : []),
      ...(refs.length ? [plural(refs.length, "save", "saves")] : []),
      ...(notes.length ? [plural(notes.length, "note", "notes")] : []),
    ];
    label = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
    label = label.charAt(0).toUpperCase() + label.slice(1);
  }
  const thumbs = [
    ...sketches.map((n) => sketchPicture(project, n.id, n.data.version)),
    ...refs.flatMap((n) => (cards.get(n.data.refId)?.thumb ? [cards.get(n.data.refId)!.thumb!] : [])),
  ].slice(0, 3);
  return { project, nodes: picked.map((n) => n.id), label: label.replace(/\s+/g, " ").slice(0, 90), thumbs };
}

/** After a verdict: why? The reasons used most, by number or by click, or a few words of your own. None is needed. */
function VerdictNote(props: { verdict: "chosen" | "ruled_out"; label?: string; count: number; reason?: string; offered: string[]; onReason: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  // After removing, the strip says what was removed ("Removed 3 suggestions") and offers the ruled-out reasons.
  const what = props.label ?? (props.verdict === "chosen" ? "Chosen" : "Ruled out");
  if (props.reason) {
    return (
      <div className="canvas-notice verdict" role="status">
        <span className="canvas-notice-dot" />
        <span>{what}: {props.reason}</span>
      </div>
    );
  }
  return (
    <div className="canvas-notice verdict" role="group" aria-label={`${what}. Why?`}>
      <span className="verdict-what">{what}{props.count > 1 && !props.label ? ` ${props.count}` : ""} <span className="canvas-notice-more">· why?</span></span>
      {props.offered.map((r, i) => (
        <button key={r} className="verdict-chip" onClick={() => props.onReason(r)} title={`Press ${i + 1}`}>
          <span className="verdict-n">{i + 1}</span>
          {r}
        </button>
      ))}
      <input
        className="verdict-input"
        value={text}
        placeholder="or in your words"
        aria-label="Your reason"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) props.onReason(text);
          if (e.key === "Escape") props.onClose();
        }}
      />
      <button className="canvas-notice-x" onClick={props.onClose} aria-label="No reason"><Icon name="x" size={12} /></button>
    </div>
  );
}

// ---------- Several things selected: one toolbar for them all ----------

function SelectionTools(props: { nodes: AnyNode[]; judge: (ids: string[], state: RefState) => void; remove: (ids: string[]) => void; onAsk: () => void; onSketch: (ids: string[]) => void }) {
  const picked = props.nodes.filter((n) => n.selected && !n.hidden && !n.data.leaving);
  if (picked.length < 2) return null;
  // Saves and sketches both take a verdict.
  const refs = picked.filter((n) => n.type === "ref" || n.type === "sketch") as (RefNode | SketchNode)[];
  const ids = refs.map((n) => n.id);
  const every = (st: RefState) => refs.length > 0 && refs.every((n) => (n.data.state ?? "kept") === st);
  const someProposed = refs.some((n) => n.data.state === "proposed");
  return (
    <NodeToolbar nodeId={picked.map((n) => n.id)} isVisible position={Position.Top} offset={14}>
      <div className="bn-tools many" key={picked.length}>
        <span className="bn-tools-count">{picked.length} selected</span>
        {refs.length > 0 && (
          <>
            <Tool icon="check" label="Choose" words keyHint="C" on={every("chosen")} onClick={() => props.judge(ids, every("chosen") ? "kept" : "chosen")} />
            {someProposed && <Tool icon="plus" label="Keep" words keyHint="K" onClick={() => props.judge(refs.filter((n) => n.data.state === "proposed").map((n) => n.id), "kept")} />}
            <Tool icon="x" label="Rule out" words keyHint="X" on={every("ruled_out")} onClick={() => props.judge(ids, every("ruled_out") ? "kept" : "ruled_out")} />
            <ToolSep />
          </>
        )}
        <Tool icon="build" label="Sketch from these" onClick={() => props.onSketch(picked.map((n) => n.id))} />
        <Tool icon="ask" label="Ask FRIDAY" onClick={props.onAsk} />
        <Tool icon="trash" label="Remove" danger onClick={() => props.remove(picked.map((n) => n.id))} />
      </div>
    </NodeToolbar>
  );
}

// ---------- The project's name, and its About panel ----------

/**
 * On the canvas the project is only its name, small in the corner, so the decisions get
 * the room. Clicking it opens About: the name, what the project is, and its materials
 * (files and links Claude reads to understand it), and deleting the project.
 */
function Head(props: {
  id: string; name: string; brief: string;
  commit: (ops: BoardOp[]) => void;
  setMeta: (m: { name: string; brief: string }) => void;
  onRenamed: () => void; onDeleted: () => void; onError: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const wrap = useRef<HTMLElement>(null);

  useEffect(() => {
    projectApi.materials(props.id).then(setMaterials).catch(() => setMaterials([]));
  }, [props.id]);

  const close = useCallback(() => {
    if (prefersReducedMotion()) return setOpen(false);
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 170);
  }, []);
  const toggle = () => (open ? close() : setOpen(true));

  // Esc or a click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as globalThis.Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as Element).closest?.("input, textarea")) close();
    };
    addEventListener("pointerdown", onDown, true);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("pointerdown", onDown, true);
      removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <header className="canvas-head" ref={wrap}>
      <button className={`canvas-title ${open ? "on" : ""}`} onClick={toggle} aria-expanded={open} title="About this project">
        <span className="canvas-title-mark" aria-hidden />
        <span className="canvas-title-name">{props.name}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <About
          {...props}
          closing={closing}
          materials={materials ?? []}
          setMaterials={setMaterials}
          onClose={close}
        />
      )}
    </header>
  );
}

const sizeText = (n: number | null) =>
  !n ? "" : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
const kindText = (m: Material) => {
  if (m.kind === "link") {
    try {
      return new URL(m.url!).host.replace(/^www\./, "");
    } catch {
      return "Link";
    }
  }
  if (m.picture) return "Picture";
  const ext = m.name.match(/\.([a-z0-9]{1,6})$/i)?.[1];
  return ext ? ext.toUpperCase() : "File";
};
/** What Claude can do with it, in a word or two. */
const readText = (m: Material) =>
  m.picture ? "Claude can look at it" : m.chars ? (m.kind === "link" ? "page read" : "Claude can read it") : m.kind === "link" ? "page couldn't be read" : "no text found";

type Pending = { key: string; name: string; kind: "file" | "link" };

/**
 * Under a long document: the page FRIDAY gets at the start of each conversation instead of
 * the whole thing, to read; or that it's being written; or a way to ask for it.
 */
function MatSummary({ m, onRedo }: { m: Material; onRedo: () => void }) {
  const [open, setOpen] = useState(false);
  if (m.picture || m.chars <= 2500 || m.summary_state === "short") return null;
  if (m.summary_state === "working") return <span className="mat-sum working"><span className="spinner" /> Writing a summary for FRIDAY…</span>;
  if (m.summary_state === "done") {
    return (
      <div className="mat-sum">
        <button className="mat-sum-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          FRIDAY's summary <Icon name="chevron-down" size={10} />
        </button>
        <button className="mat-sum-btn quiet" onClick={onRedo} title="Write the summary again from the document">Write again</button>
        {open && <div className="mat-sum-text">{m.summary}</div>}
      </div>
    );
  }
  return (
    <div className="mat-sum">
      <span className={m.summary_state === "error" ? "mat-sum-err" : ""} title={m.summary_error ?? undefined}>
        {m.summary_state === "error" ? "The summary didn't work." : "No summary yet: FRIDAY only sees how it starts."}
      </span>
      <button className="mat-sum-btn" onClick={onRedo}>{m.summary_state === "error" ? "Try again" : "Summarize"}</button>
    </div>
  );
}

function About(props: {
  id: string; name: string; brief: string; closing: boolean;
  materials: Material[]; setMaterials: React.Dispatch<React.SetStateAction<Material[] | null>>;
  commit: (ops: BoardOp[]) => void;
  setMeta: (m: { name: string; brief: string }) => void;
  onRenamed: () => void; onDeleted: () => void; onError: (t: string) => void; onClose: () => void;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [link, setLink] = useState("");
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const depth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const { id, setMaterials, onError } = props;

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const mine: Pending[] = files.map((f) => ({ key: localId(), name: f.name, kind: "file" }));
      setPending((p) => [...p, ...mine]);
      try {
        const res = await projectApi.addFiles(id, files);
        setMaterials((m) => [...(m ?? []), ...res.added]);
        if (res.failed.length) onError(res.failed[0]!);
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setPending((p) => p.filter((x) => !mine.includes(x)));
      }
    },
    [id, setMaterials, onError],
  );

  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    setLink("");
    const mine: Pending = { key: localId(), name: url.replace(/^https?:\/\//, ""), kind: "link" };
    setPending((p) => [...p, mine]);
    try {
      const res = await projectApi.addLink(id, url);
      setMaterials((m) => [...(m ?? []), ...res.added]);
    } catch (e) {
      onError((e as Error).message);
      setLink(url);
    } finally {
      setPending((p) => p.filter((x) => x !== mine));
    }
  };

  // Summaries are written in the background: while one is waiting or being written, look again now and then.
  const waiting = props.materials.some((m) => m.summary_state === "working" || (m.summary_state === "" && m.chars > 2500));
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => projectApi.materials(id).then(setMaterials).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [waiting, id, setMaterials]);
  const summarize = (m: Material) => {
    setMaterials((list) => list?.map((x) => (x.id === m.id ? { ...x, summary_state: "working" } : x)) ?? null);
    projectApi.summarize(id, m.id).then((done) => {
      if (done) setMaterials((list) => list?.map((x) => (x.id === m.id ? done : x)) ?? null);
    }).catch((e) => {
      onError((e as Error).message);
      projectApi.materials(id).then(setMaterials).catch(() => {});
    });
  };
  const remove = (m: Material) => {
    setMaterials((list) => list?.filter((x) => x.id !== m.id) ?? null);
    projectApi.removeMaterial(id, m.id).catch((e) => {
      onError((e as Error).message);
      setMaterials((list) => [...(list ?? []), m]);
    });
  };

  const setNote = (m: Material, note: string) => {
    setMaterials((list) => list?.map((x) => (x.id === m.id ? { ...x, note } : x)) ?? null);
    projectApi.updateMaterial(id, m.id, { note }).catch((e) => onError((e as Error).message));
  };

  // Files dropped here belong to the project, not the library: the drop stops here.
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
  const drop = {
    onDragEnter: (e: React.DragEvent) => {
      e.stopPropagation();
      if (!hasFiles(e)) return;
      depth.current++;
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDragOver: (e: React.DragEvent) => {
      e.stopPropagation();
      if (hasFiles(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.stopPropagation();
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      void addFiles([...e.dataTransfer.files]);
    },
  };

  return (
    <section className={`about ${props.closing ? "closing" : ""} ${over ? "over" : ""}`} aria-label="About this project" {...drop}>
      <div className="about-scroll">
        <div className="about-top">
          <input
            className="about-name"
            defaultValue={props.name}
            key={props.name}
            aria-label="Project name"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v) return void (e.target.value = props.name);
              if (v === props.name) return;
              props.setMeta({ name: v, brief: props.brief });
              props.commit([{ op: "update_project", name: v }]);
              setTimeout(props.onRenamed, 300);
            }}
          />
          <button className="about-x" onClick={props.onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="about-label">About the project</div>
        <Grow
          className="about-brief"
          value={props.brief}
          placeholder="What is it, who is it for, what must it do? Claude reads this before it suggests anything."
          onCommit={(v) => {
            props.setMeta({ name: props.name, brief: v });
            props.commit([{ op: "update_project", brief: v }]);
          }}
        />

        <div className="about-label">
          Materials
          {props.materials.length > 0 && <span className="about-count">{props.materials.length}</span>}
        </div>
        <p className="about-hint">Specs, brand books, screenshots, the old site. Claude reads them to understand the project.</p>

        {(props.materials.length > 0 || pending.length > 0) && (
          <ul className="about-list">
            {props.materials.map((m, i) => (
              <li key={m.id} className="mat" style={{ "--i": i } as React.CSSProperties}>
                <a className="mat-icon" href={m.file_url ?? m.url ?? undefined} target="_blank" rel="noreferrer" tabIndex={-1}>
                  {m.thumb_url ? <img src={m.thumb_url} alt="" loading="lazy" /> : <Icon name={m.kind === "link" ? "link" : "file"} size={15} />}
                </a>
                <div className="mat-body">
                  <a className="mat-name" href={m.file_url ?? m.url ?? undefined} target="_blank" rel="noreferrer" title={m.name}>
                    {m.name}
                  </a>
                  <span className={`mat-meta ${!m.chars && !m.picture ? "warn" : ""}`}>
                    {[kindText(m), m.kind === "file" && sizeText(m.size), readText(m)].filter(Boolean).join(" · ")}
                  </span>
                  <MatSummary m={m} onRedo={() => summarize(m)} />
                  <MatNote value={m.note} onCommit={(v) => setNote(m, v)} />
                </div>
                <button className="mat-x" onClick={() => remove(m)} aria-label={`Remove ${m.name}`} title="Remove">
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
            {pending.map((p) => (
              <li key={p.key} className="mat pending">
                <span className="mat-icon"><span className="spinner" /></span>
                <div className="mat-body">
                  <span className="mat-name">{p.name}</span>
                  <span className="mat-meta">{p.kind === "link" ? "Reading the page…" : "Reading…"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="about-add">
          <button className="about-add-btn" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={14} /> Add files
          </button>
          <input
            className="about-link"
            value={link}
            placeholder="Paste a link"
            spellCheck={false}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addLink();
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }}
            onPaste={(e) => e.stopPropagation()}
          />
          {link.trim() && (
            <button className="about-add-btn solid" onClick={() => void addLink()}>
              Add
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="about-drop">or drop files here</p>

        <div className="about-foot">
          {confirm ? (
            <>
              <span className="about-foot-text">Delete “{props.name}”? Its saves stay in the library.</span>
              <button className="about-foot-btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button
                className="select-btn danger solid"
                autoFocus
                onClick={() => projectApi.remove(props.id).then(props.onDeleted).catch((e) => props.onError((e as Error).message))}
              >
                Delete project
              </button>
            </>
          ) : (
            <button className="about-foot-btn danger" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={12} /> Delete project
            </button>
          )}
        </div>
      </div>
      {over && <div className="about-over">Drop to add to {props.name}</div>}
    </section>
  );
}

/** The designer's word on a material ("the client's brand book"), for Claude. */
function MatNote(props: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <input
      className={`mat-note ${v ? "has" : ""}`}
      value={v}
      placeholder="Add a note for Claude"
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
      onBlur={() => v.trim() !== props.value && props.onCommit(v.trim())}
    />
  );
}

// ---------- The tools, in the dock ----------

/** The zoom, as a percentage; clicking it goes to 100%. Redraws only when the number changes. */
function ZoomReadout(props: { onClick: () => void }) {
  const pct = useStore((s) => Math.round(s.transform[2] * 100));
  return (
    <button className="canvas-bar-zoom" onClick={props.onClick} title="Go to 100% (Shift+0)" aria-label={`Zoom ${pct}%. Go to 100%`}>
      {pct}%
    </button>
  );
}

function Toolbar(props: { onTopic: (f: TopicFacet) => void; onNote: () => void; tray: boolean; onTray: () => void; onFit: () => void; onActualSize: () => void; waiting: number; onReview: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="canvas-bar" role="toolbar" aria-label="Canvas">
      <button
        className="canvas-bar-btn"
        title="New topic"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom });
        }}
      >
        <Icon name="plus" size={15} /> <span className="canvas-bar-label">Topic</span>
      </button>
      <button className="canvas-bar-btn" onClick={props.onNote} title="New note">
        <Icon name="pencil" size={14} /> <span className="canvas-bar-label">Note</span>
      </button>
      <button className={`canvas-bar-btn ${props.tray ? "on" : ""}`} onClick={props.onTray} aria-pressed={props.tray} title="Saves from your library">
        <Icon name="image" size={14} /> <span className="canvas-bar-label">Saves</span>
      </button>
      {props.waiting > 0 && (
        <button className="canvas-bar-btn" onClick={props.onReview} title="FRIDAY's suggestions, one at a time (R)">
          <Icon name="eye" size={14} /> <span className="canvas-bar-label">Review</span> <span className="canvas-bar-n">{props.waiting}</span>
        </button>
      )}
      <span className="canvas-bar-sep" />
      <button className="canvas-bar-btn icon" onClick={props.onFit} title="Show everything (Shift+1)" aria-label="Show everything">
        <Icon name="maximize" size={14} />
      </button>
      <ZoomReadout onClick={props.onActualSize} />
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="menu-label">New topic</div>
          {FACETS.map((f) => (
            <button
              key={f.value}
              className="menu-item"
              onClick={() => {
                setMenu(null);
                props.onTopic(f.value);
              }}
            >
              <span className="menu-check" />
              {f.label}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

// ---------- Saves from the library, to drag in ----------

function Tray(props: { onClose: () => void; onAdd: (c: RefCard) => void; target?: TopicData }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Ref[] | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.refs({ q: q.trim() || undefined, library: true }).then((r) => live && setList(r.slice(0, 160))).catch(() => live && setList([]));
    }, q ? 160 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const cardOf = (r: Ref): RefCard => {
    const m = r.media[0];
    return {
      id: r.id,
      title: displayTitle(r).replace(/\s+/g, " ").slice(0, 100),
      type: r.has_video ? "video" : "image",
      thumb: m?.thumb_url ?? r.preview_url ?? r.avatar_url,
      ratio: r.site ? 0.625 : m?.width && m.height ? Math.min(Math.max(m.height / m.width, 0.5), 1.6) : 0.75,
      palette: [],
    };
  };
  return (
    <aside className="tray" aria-label="Saves from your library">
      <div className="tray-head">
        <input
          className="tray-search"
          value={q}
          autoFocus
          placeholder="Search your library"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onClose();
            e.stopPropagation();
          }}
        />
        <button className="tray-x" onClick={props.onClose} aria-label="Close" title="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      <p className="tray-hint">
        {props.target ? <>Click to add under <b>{props.target.title || facetLabel(props.target.facet)}</b>, or drag anywhere.</> : "Drag onto the canvas, or select a topic and click."}
      </p>
      <div className="tray-scroll">
      <div className="tray-grid">
        {list?.map((r) => {
          const c = cardOf(r);
          return (
            <button
              key={r.id}
              className="tray-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-panel-ref", JSON.stringify(c));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => props.onAdd(c)}
              title={c.title}
            >
              {c.thumb ? <img src={c.thumb} alt="" draggable={false} loading="lazy" decoding="async" style={{ aspectRatio: `1 / ${c.ratio}` }} /> : <span className="tray-blank">{c.title}</span>}
            </button>
          );
        })}
        {list && list.length === 0 && <p className="tray-none">Nothing matches “{q}”.</p>}
      </div>
      </div>
    </aside>
  );
}
