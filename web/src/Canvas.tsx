// A project's canvas: decisions (Typography, Color…) as topics, the saves considered for
// each, and the designer's notes on why. Loaded only when a project is open, so the
// library stays as light as it was.
//
// Every change is sent to the companion as a small op and drawn at once. Changes made
// elsewhere (another window, Claude over MCP) arrive on a live stream and animate in.

import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Background, BackgroundVariant, ConnectionMode, Handle, NodeToolbar, Position, ReactFlow, ReactFlowProvider,
  applyEdgeChanges, applyNodeChanges, getBezierPath, useInternalNode, useReactFlow, useStore,
  type Connection, type Edge, type EdgeChange, type EdgeProps, type InternalNode, type Node, type NodeChange, type NodeProps, type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import "./canvas.css";
import {
  api, chatApi, displayTitle, localId, prefersReducedMotion, projectApi,
  type BoardEdge, type BoardEvent, type BoardNode, type BoardOp, type Material, type Ref, type RefCard, type RefState, type TopicFacet,
} from "./api.ts";
import { Icon } from "./Icon.tsx";
import { Popover } from "./TagRow.tsx";

// ---------- What the canvas draws ----------

type Enter = { enter?: number; leaving?: boolean; focus?: boolean };
type TopicData = Enter & { title: string; facet?: TopicFacet; status?: "exploring" | "locked"; summary?: string };
type RefData = Enter & { refId: string; state?: RefState; taking?: string };
type NoteData = Enter & { text: string };
type TopicNode = Node<TopicData, "topic">;
type RefNode = Node<RefData, "ref">;
type NoteNode = Node<NoteData, "note">;
type AnyNode = TopicNode | RefNode | NoteNode;

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
  if (b.kind === "ref") return { id: b.id, type: "ref", position, data: { refId: b.ref_id!, state: d.state as RefState, taking: d.taking as string | undefined, enter } };
  return { id: b.id, type: "note", position, data: { text: String(d.text ?? ""), enter } };
}
const toEdge = (e: BoardEdge): Edge => ({ id: e.id, source: e.source, target: e.target, type: "float", label: e.label || undefined });

/** The part of a node's data the companion keeps. */
function stored(n: AnyNode): Record<string, unknown> {
  if (n.type === "topic") return { title: n.data.title, facet: n.data.facet, status: n.data.status, summary: n.data.summary };
  if (n.type === "ref") return { state: n.data.state, taking: n.data.taking };
  return { text: n.data.text };
}

// ---------- Shared with the nodes ----------

interface Actions {
  cards: Map<string, RefCard>;
  patch: (id: string, data: Record<string, unknown>) => void;
  remove: (ids: string[]) => void;
  note: (forId: string) => void;
  open: (refId: string) => void;
  clearFocus: (id: string) => void;
  /** Saves under a locked topic that weren't chosen: how many, and whether they're showing. */
  considered: Map<string, { n: number; open: boolean }>;
  toggleConsidered: (topicId: string) => void;
}
const Ctx = createContext<Actions | null>(null);
const useActions = () => useContext(Ctx)!;

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

function Tool(props: { icon: Parameters<typeof Icon>[0]["name"]; label: string; on?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button className={`bn-tool ${props.on ? "on" : ""} ${props.danger ? "danger" : ""}`} onClick={props.onClick} title={props.label} aria-label={props.label} aria-pressed={props.on}>
      <Icon name={props.icon} size={14} />
      <span>{props.label}</span>
    </button>
  );
}

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
  const locked = data.status === "locked";
  const [renaming, setRenaming] = useState(!!data.focus);
  const nameRef = useRef<HTMLInputElement>(null);
  useLateFocus(nameRef, renaming);
  return (
    <div className={`bn topic ${locked ? "locked" : ""} ${data.enter !== undefined ? "enter" : ""} ${data.leaving ? "leaving" : ""}`} style={stagger(data.enter)}>
      <Handles />
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
        <div className="topic-title" onDoubleClick={() => setRenaming(true)}>{data.title || facetLabel(data.facet)}</div>
      )}
      {locked && (act.considered.get(id)?.n ?? 0) > 0 && (
        <button className="nodrag topic-considered" onClick={() => act.toggleConsidered(id)}>
          {act.considered.get(id)!.open ? `Fold ${act.considered.get(id)!.n} considered` : `+${act.considered.get(id)!.n} considered`}
        </button>
      )}
      {(locked || data.summary) && (
        <Grow
          className="topic-summary"
          value={data.summary ?? ""}
          placeholder="The decision, in a sentence. Claude reads this."
          onCommit={(v) => act.patch(id, { summary: v })}
        />
      )}
      <NodeToolbar isVisible={selected && alone && !data.leaving} position={Position.Top} offset={10}>
        <div className="bn-tools">
          <Tool icon={locked ? "refresh" : "check"} label={locked ? "Reopen" : "Lock"} on={locked} onClick={() => act.patch(id, { status: locked ? "exploring" : "locked" })} />
          <Tool icon="pencil" label="Note" onClick={() => act.note(id)} />
          <Tool icon="compose" label="Rename" onClick={() => setRenaming(true)} />
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
          <Tool icon="check" label="Choose" on={state === "chosen"} onClick={() => act.patch(id, { state: state === "chosen" ? "kept" : "chosen" })} />
          {state === "proposed" && <Tool icon="plus" label="Keep" onClick={() => act.patch(id, { state: "kept" })} />}
          <Tool icon="x" label="Rule out" on={state === "ruled_out"} onClick={() => act.patch(id, { state: state === "ruled_out" ? "kept" : "ruled_out" })} />
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

function FloatEdge({ id, source, target, selected }: EdgeProps) {
  const s = useInternalNode(source), t = useInternalNode(target);
  if (!s || !t || !s.measured.width || !t.measured.width) return null;
  const a = rectOf(s), b = rectOf(t);
  const p = exit(a, b), q = exit(b, a);
  const [path] = getBezierPath({ sourceX: p.x, sourceY: p.y, sourcePosition: p.side, targetX: q.x, targetY: q.y, targetPosition: q.side, curvature: 0.3 });
  const kinds = [s.type, t.type];
  const kind = kinds.includes("note") ? "note" : kinds.every((k) => k === "topic") ? "flow" : "link";
  const chosen = kinds.includes("ref") && ((s.type === "ref" ? s : t).data as RefData).state === "chosen";
  const out = kinds.includes("ref") && ((s.type === "ref" ? s : t).data as RefData).state === "ruled_out";
  const leaving = (s.data as Enter).leaving || (t.data as Enter).leaving || /\bfolding\b/.test(`${s.className ?? ""} ${t.className ?? ""}`);
  return (
    <g className={`fe fe-${kind} ${chosen ? "chosen" : ""} ${out ? "out" : ""} ${selected ? "sel" : ""} ${leaving ? "leaving" : ""}`} data-id={id}>
      <path className="fe-line" d={path} pathLength={kind === "note" ? undefined : 1} />
      <path className="react-flow__edge-interaction" d={path} fill="none" strokeOpacity={0} strokeWidth={18} />
    </g>
  );
}

const nodeTypes = { topic: TopicView, ref: RefView, note: NoteView };
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

function Board({ id, dock, ...handlers }: CanvasProps) {
  // The app's callbacks, held steady: a new function from a parent redraw must never
  // look like a new project (that reloaded the whole canvas, entrance and all, on every redraw).
  const latest = useRef(handlers);
  latest.current = handlers;
  const onOpenRef = useCallback((refId: string) => latest.current.onOpenRef(refId), []);
  const onError = useCallback((t: string) => latest.current.onError(t), []);
  const onRenamed = useCallback(() => latest.current.onRenamed(), []);
  const onDeleted = useCallback(() => latest.current.onDeleted(), []);
  const flow = useReactFlow<AnyNode, Edge>();
  const [nodes, setNodes] = useState<AnyNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [cards, setCards] = useState<Map<string, RefCard>>(() => new Map());
  const [meta, setMeta] = useState<{ name: string; brief: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tray, setTray] = useState(false);
  /** What the assistant just did, with a way to take it back. */
  const [notice, setNotice] = useState<{ label: string; key: number; more: number } | null>(null);
  const seq = useRef(0);
  // Changes go to the companion one after another, so an undo never overtakes the change it undoes.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const revealRef = useRef<(ids: string[], spots: { x: number; y: number }[]) => void>(() => {});
  /** Locked topics whose considered saves are unfolded. */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const wrap = useRef<HTMLDivElement>(null);

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
      for (const o of ops) {
        if (o.op === "add_node") {
          const b = { ...o.node, id: o.node.id!, ref_id: o.node.ref_id ?? null, data: o.node.data ?? {} } as BoardNode;
          if (b.ref_id) missing.push(b.ref_id);
          fresh.add(b.id);
          const n = toFlow(b, i++);
          setNodes((ns) => (ns.some((x) => x.id === b.id) ? ns : [...ns, n]));
        } else if (o.op === "update_node") {
          setNodes((ns) =>
            ns.map((n) =>
              n.id !== o.id ? n : ({
                ...n,
                position: { x: o.x ?? n.position.x, y: o.y ?? n.position.y },
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

  const remove = useCallback(
    (ids: string[]) => {
      removeLocal(ids);
      commit(ids.map((x) => ({ op: "remove_node" as const, id: x })));
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

  const sizeOf = (n: AnyNode) => ({ w: n.measured?.width ?? (n.type === "ref" ? 220 : 240), h: n.measured?.height ?? 120 });

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

  // ---- Locked topics fold away what wasn't chosen ----

  const fold = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const near = new Map<string, string[]>();
    for (const e of edges) {
      (near.get(e.source) ?? near.set(e.source, []).get(e.source)!).push(e.target);
      (near.get(e.target) ?? near.set(e.target, []).get(e.target)!).push(e.source);
    }
    const hide = new Set<string>();
    const considered = new Map<string, { n: number; open: boolean }>();
    for (const t of nodes) {
      if (t.type !== "topic" || t.data.status !== "locked") continue;
      const kids = (near.get(t.id) ?? []).map((x) => byId.get(x)).filter((n): n is RefNode => n?.type === "ref" && n.data.state !== "chosen");
      if (!kids.length) continue;
      considered.set(t.id, { n: kids.length, open: opened.has(t.id) });
      if (!opened.has(t.id)) kids.forEach((k) => hide.add(k.id));
    }
    // A save that's also under an open topic stays in view.
    for (const x of [...hide]) {
      const topics = (near.get(x) ?? []).map((y) => byId.get(y)).filter((n): n is TopicNode => n?.type === "topic");
      if (topics.some((t) => t.data.status !== "locked" || opened.has(t.id))) hide.delete(x);
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
  const shownEdges = useMemo(
    () => (folded.size ? edges.map((e) => (folded.has(e.source) || folded.has(e.target) ? { ...e, hidden: true } : e)) : edges),
    [edges, folded],
  );

  const toggleConsidered = useCallback((topicId: string) => {
    setOpened((o) => {
      const next = new Set(o);
      if (!next.delete(topicId)) next.add(topicId);
      return next;
    });
  }, []);

  const actions = useMemo<Actions>(
    () => ({ cards, patch, remove, note, open: onOpenRef, clearFocus, considered: fold.considered, toggleConsidered }),
    [cards, patch, remove, note, onOpenRef, clearFocus, fold.considered, toggleConsidered],
  );

  // ---- Undo: ⌘Z for your own changes, and taking back what the assistant did ----

  const undo = useCallback(
    (who: "me" | "assistant") => {
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

  const onNodeDragStop = useCallback(
    (_: unknown, __: AnyNode, moved: AnyNode[]) => commit(moved.map((n) => ({ op: "update_node" as const, id: n.id, x: n.position.x, y: n.position.y }))),
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
  const onMoveEnd = useCallback((_: unknown, v: Viewport) => {
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
      <div className={`canvas ${tray ? "with-tray" : ""}`} ref={wrap} onDragOver={onDragOver} onDrop={onDrop}>
        {meta && <Head id={id} name={meta.name} brief={meta.brief} commit={commit} setMeta={setMeta} onRenamed={onRenamed} onDeleted={onDeleted} onError={onError} />}
        <ReactFlow<AnyNode, Edge>
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onBeforeDelete={onBeforeDelete}
          onNodeDragStop={onNodeDragStop}
          onMoveEnd={onMoveEnd}
          onDoubleClick={(e) => {
            if (!(e.target as Element).classList.contains("react-flow__pane")) return;
            addNote(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          defaultViewport={savedView ?? undefined}
          minZoom={0.15}
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
          <SelectionTools nodes={shownNodes} patchMany={patchMany} remove={remove} />
        </ReactFlow>

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

        {notice && (
          <div className="canvas-notice" key={notice.key} role="status">
            <span className="canvas-notice-dot" />
            <span>{notice.label}{notice.more > 0 && <span className="canvas-notice-more"> and {notice.more} more {notice.more === 1 ? "change" : "changes"}</span>}</span>
            <button className="canvas-notice-undo" onClick={() => undo("assistant")}>Undo</button>
            <button className="canvas-notice-x" onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" size={12} /></button>
          </div>
        )}

        {tray && <Tray onClose={() => setTray(false)} onAdd={(c) => addSaves([c])} target={selectedTopic()?.data} />}

        {dock && createPortal(
          <Toolbar onTopic={addTopic} onNote={() => addNote()} tray={tray} onTray={() => setTray((v) => !v)} onFit={() => void flow.fitView({ padding: 0.25, duration: 500, maxZoom: 1 })} />,
          dock,
        )}
      </div>
    </Ctx.Provider>
  );
}

// ---------- Several things selected: one toolbar for them all ----------

function SelectionTools(props: { nodes: AnyNode[]; patchMany: (ids: string[], data: Record<string, unknown>) => void; remove: (ids: string[]) => void }) {
  const picked = props.nodes.filter((n) => n.selected && !n.hidden && !n.data.leaving);
  if (picked.length < 2) return null;
  const refs = picked.filter((n) => n.type === "ref") as RefNode[];
  const ids = refs.map((n) => n.id);
  const every = (st: RefState) => refs.length > 0 && refs.every((n) => (n.data.state ?? "kept") === st);
  const someProposed = refs.some((n) => n.data.state === "proposed");
  return (
    <NodeToolbar nodeId={picked.map((n) => n.id)} isVisible position={Position.Top} offset={14}>
      <div className="bn-tools many" key={picked.length}>
        <span className="bn-tools-count">{picked.length} selected</span>
        {refs.length > 0 && (
          <>
            <Tool icon="check" label="Choose" on={every("chosen")} onClick={() => props.patchMany(ids, { state: every("chosen") ? "kept" : "chosen" })} />
            {someProposed && <Tool icon="plus" label="Keep" onClick={() => props.patchMany(refs.filter((n) => n.data.state === "proposed").map((n) => n.id), { state: "kept" })} />}
            <Tool icon="x" label="Rule out" on={every("ruled_out")} onClick={() => props.patchMany(ids, { state: every("ruled_out") ? "kept" : "ruled_out" })} />
          </>
        )}
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

function Toolbar(props: { onTopic: (f: TopicFacet) => void; onNote: () => void; tray: boolean; onTray: () => void; onFit: () => void }) {
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
      <span className="canvas-bar-sep" />
      <button className="canvas-bar-btn icon" onClick={props.onFit} title="Show everything" aria-label="Show everything">
        <Icon name="maximize" size={14} />
      </button>
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
