// Ask: the assistant beside the library. It searches and looks at your saves, answers as
// it thinks, and shows the saves it means as pictures you can open. It stays open while
// you browse, knows what you have open, and keeps every conversation.

import { createPortal } from "react-dom";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref as ReactRef } from "react";
import { api, chatApi, displayTitle, type CanvasSelection, type ChatEvent, type ChatMessage, type ChatPart, type ChatSummary, type Ref, type RefCard } from "./api.ts";
import { Glow, Mark, type GlowState } from "./Glow.tsx";
import { Icon } from "./Icon.tsx";
import { Gallery, highlight, RefChip, RichText, useSmoothText } from "./StreamText.tsx";
import { Popover } from "./TagRow.tsx";

export interface AssistantHandle {
  /** Ask, about what's given instead of what's open or selected (the studio's sketch, or a part of it). */
  ask: (text: string, about?: CanvasSelection) => void;
  focus: () => void;
}

const LS_CHAT = "panel.ask.chat";
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private window: it just won't be remembered */
    }
  },
};

const REF_IN_TEXT = /\[\[([0-9a-f]{16})\]\]/g;

/** A message plus the key it was drawn with, so it isn't redrawn when its real id arrives. */
type Msg = ChatMessage & { key?: string };
const keyOf = (m: Msg) => m.key ?? m.id;

/** Apply one streamed event to the answer it belongs to. */
function applyEvent(m: Msg, e: ChatEvent): Msg {
  const parts = [...m.parts];
  const last = parts.at(-1);
  switch (e.t) {
    case "start":
      return { ...e.message, key: m.key, parts: m.parts.length ? m.parts : e.message.parts };
    case "thinking":
      if (e.on) {
        if (!(last?.type === "thinking" && !last.done)) parts.push({ type: "thinking" });
      } else {
        const i = parts.findLastIndex((p) => p.type === "thinking");
        if (i >= 0) {
          const p = parts[i] as Extract<ChatPart, { type: "thinking" }>;
          parts[i] = { ...p, done: true, ms: (p.ms ?? 0) + (e.ms ?? 0) };
        }
      }
      return { ...m, parts };
    case "tool":
      parts.push({ type: "tool", id: e.id, name: e.name });
      return { ...m, parts };
    case "tool_input":
    case "tool_result": {
      const i = parts.findIndex((p) => p.type === "tool" && p.id === e.id);
      if (i < 0) return m;
      const p = parts[i] as Extract<ChatPart, { type: "tool" }>;
      parts[i] =
        e.t === "tool_input"
          ? { ...p, input: { ...p.input, ...e.input } }
          : { ...p, refs: e.refs, total: e.total, error: e.error, done: true };
      return { ...m, parts };
    }
    case "text":
      if (last?.type === "text") parts[parts.length - 1] = { ...last, text: last.text + e.delta };
      else parts.push({ type: "text", text: e.delta });
      return { ...m, parts };
    case "done":
      return {
        ...m,
        status: e.status,
        error: e.error ?? null,
        parts: parts.map((p) => (p.type !== "text" && !p.done ? { ...p, done: true } : p)),
      };
    default:
      return m;
  }
}

export function Assistant(props: {
  open: boolean;
  onClose: () => void;
  /** The save open in the detail view, if any: what "this" means. */
  looking: Ref | null;
  /** The project open on the canvas, if any: Ask reads it when asked about "the project". */
  project?: string | null;
  /** What's selected on that canvas, if anything: what "this" and "these" mean there. */
  picked?: CanvasSelection | null;
  onOpenRef: (id: string) => void;
  onShowInGrid: (ids: string[], title: string) => void;
  onRunning: (running: boolean) => void;
  /** It changed the library (made or filled a collection): the app should reload what it shows. */
  onLibraryChanged: () => void;
  handle: ReactRef<AssistantHandle>;
}) {
  const { open, looking } = props;
  const [chatId, setChatId] = useState<string | null>(() => store.get(LS_CHAT));
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [cards, setCards] = useState<Map<string, RefCard>>(() => new Map());
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<{ x: number; y: number } | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [effort, setEffort] = useState<string | null>(null);
  // Answers that arrived while you were here play in; older ones just appear.
  const live = useRef(new Set<string>());
  const follower = useRef<AbortController | null>(null);
  const runId = useRef<string | null>(null);
  const toolNames = useRef(new Map<string, string>());
  const changed = useRef(props.onLibraryChanged);
  changed.current = props.onLibraryChanged;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  // "This" is whatever's open, until you take it off for that save.
  const [dropped, setDropped] = useState<string | null>(null);
  const context = looking && looking.id !== dropped ? looking : null;
  const contextNow = context;
  // The canvas selection, until you take it off (for that selection).
  const pickKey = props.picked?.nodes.join(",") ?? "";
  const [droppedPick, setDroppedPick] = useState<string | null>(null);
  const picked = !context && props.picked && pickKey !== droppedPick ? props.picked : null;
  const pickedNow = picked;

  useEffect(() => props.onRunning(running), [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCards = useCallback((list: RefCard[]) => {
    if (!list.length) return;
    setCards((prev) => {
      const next = new Map(prev);
      for (const c of list) next.set(c.id, c);
      return next;
    });
  }, []);

  // Saves named in the text that we haven't drawn yet: fetch them in one go.
  const missing = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messages) {
      // Saves the designer mentioned with @.
      if (m.role === "user") for (const x of m.text.matchAll(REF_IN_TEXT)) if (!cards.has(x[1]!)) ids.add(x[1]!);
      for (const p of m.parts) {
        if (p.type === "text") for (const x of p.text.matchAll(REF_IN_TEXT)) if (!cards.has(x[1]!)) ids.add(x[1]!);
        if (p.type === "tool") for (const id of (p.input?.ids as string[] | undefined) ?? []) if (!cards.has(id)) ids.add(id);
        if (p.type === "tool" && typeof p.input?.id === "string" && !cards.has(p.input.id)) ids.add(p.input.id);
      }
    }
    return [...ids].filter((id) => /^[0-9a-f]{16}$/.test(id));
  }, [messages, cards]);
  useEffect(() => {
    if (!missing.length) return;
    const t = setTimeout(() => chatApi.cards(missing).then(addCards).catch(() => {}), 120);
    return () => clearTimeout(t);
  }, [missing.join(","), addCards]); // eslint-disable-line react-hooks/exhaustive-deps

  const follow = useCallback(
    (id: string, after: number) => {
      follower.current?.abort();
      const ctl = new AbortController();
      follower.current = ctl;
      setRunning(true);
      chatApi
        .follow(
          id,
          after,
          (e) => {
            if (e.t === "idle") return;
            if (e.t === "title") return setTitle(e.title);
            if (e.t === "start") runId.current = e.message.id;
            if (e.t === "tool") toolNames.current.set(e.id, e.name);
            if (e.t === "tool_result") {
              addCards(e.cards);
              if (toolNames.current.get(e.id) === "save_to_collection") changed.current();
            }
            setMessages((ms) => ms.map((m) => (m.id === runId.current || (e.t === "start" && m.id === "pending") ? applyEvent(m, e) : m)));
            if (e.t === "done") setRunning(false);
          },
          ctl.signal,
        )
        .catch(() => {})
        .finally(() => {
          if (follower.current === ctl) {
            setRunning(false);
            follower.current = null;
          }
        });
    },
    [addCards],
  );

  const load = useCallback(
    async (id: string) => {
      follower.current?.abort();
      try {
        const c = await chatApi.get(id);
        setChatId(c.id);
        setTitle(c.title);
        setMessages(c.messages);
        addCards(c.cards);
        const streaming = c.messages.findLast((m) => m.role === "assistant" && m.status === "streaming");
        runId.current = streaming?.id ?? null;
        if (c.running && streaming) {
          live.current.add(streaming.id);
          follow(c.id, c.seq);
        } else setRunning(false);
      } catch {
        setChatId(null);
        setMessages([]);
        setTitle("");
      }
    },
    [addCards, follow],
  );

  useEffect(() => {
    if (chatId) void load(chatId);
    return () => follower.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => store.set(LS_CHAT, chatId), [chatId]);

  const send = useCallback(
    async (raw: string, about?: CanvasSelection) => {
      const text = raw.trim();
      if (!text || running) return;
      const picked = about ?? pickedNow;
      const context = about ? null : contextNow;
      setDraft("");
      stick.current = true;
      let id = chatId;
      const ctx = {
        ...(context ? { open: context.id } : {}),
        ...(props.project ? { project: props.project } : {}),
        ...(picked ? { nodes: picked.nodes, label: picked.label, thumbs: picked.thumbs } : {}),
        ...(picked?.point ? { point: picked.point } : {}),
      };
      if (context && !cards.has(context.id)) addCards([cardFromRef(context)]);
      const temp: ChatMessage = { id: `u${Date.now()}`, role: "user", text, context: context ? { open: context.id } : picked ? { nodes: picked.nodes, label: picked.label, thumbs: picked.thumbs } : null, parts: [], status: "done", error: null, created_at: new Date().toISOString() };
      const pending: Msg = { id: "pending", key: `a${Date.now()}`, role: "assistant", text: "", context: null, parts: [], status: "streaming", error: null, created_at: temp.created_at };
      live.current.add(pending.key!);
      setMessages((ms) => [...ms, temp, pending]);
      setRunning(true);
      if (!title) setTitle(text.replace(/\s+/g, " ").slice(0, 80));
      try {
        if (!id) {
          id = (await chatApi.create()).id;
          setChatId(id);
        }
        const res = await chatApi.send(id, text, ctx);
        runId.current = res.assistant.id;
        setMessages((ms) => ms.map((m) => (m.id === temp.id ? { ...res.user, key: temp.id } : m.id === "pending" ? { ...res.assistant, key: m.key, parts: m.parts } : m)));
        follow(id, 0);
      } catch (e) {
        setRunning(false);
        setMessages((ms) => ms.map((m) => (m.id === "pending" ? { ...m, status: "error", error: (e as Error).message } : m)));
      }
    },
    [chatId, contextNow, pickedNow, running, title, follow, addCards, cards, props.project],
  );

  const stop = () => {
    if (chatId) void chatApi.stop(chatId).catch(() => {});
  };

  const newChat = () => {
    follower.current?.abort();
    setChatId(null);
    setMessages([]);
    setTitle("");
    setRunning(false);
    runId.current = null;
    setDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useImperativeHandle(props.handle, () => ({
    ask: (text: string, about?: CanvasSelection) => void send(text, about),
    focus: () => inputRef.current?.focus(),
  }), [send]);

  // Opening the panel puts the cursor in the composer.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 120);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ---- Replying to a part of the conversation: select it, then Reply ----
  const [quote, setQuote] = useState<string | null>(null);
  const [reply, setReply] = useState<{ x: number; y: number; text: string } | null>(null);
  /** Where the Reply button goes: just above what's selected in the conversation, or nowhere. */
  const placeReply = useCallback(() => {
    const sel = getSelection();
    const box = scroller.current;
    if (!sel || sel.isCollapsed || !sel.rangeCount || !box) return setReply(null);
    const range = sel.getRangeAt(0);
    const inside = (n: Node | null) => !!n && !!content.current?.contains(n) && !!(n instanceof Element ? n : n.parentElement)?.closest(".msg-ai, .msg-user");
    let raw = sel.toString();
    // A save's chip shows a shortened name; the quote takes its whole name.
    content.current?.querySelectorAll<HTMLElement>(".ref-chip[data-title]").forEach((c) => {
      const shown = c.querySelector(".ref-chip-title")?.textContent;
      if (shown && range.intersectsNode(c)) raw = raw.replace(shown, c.dataset.title!);
    });
    const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!inside(range.startContainer) || !inside(range.endContainer) || text.length < 2) return setReply(null);
    const r = range.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.bottom < b.top || r.top > b.bottom) return setReply(null);
    setReply({ x: Math.min(Math.max(r.left + r.width / 2, b.left + 44), b.right - 44), y: Math.max(r.top, b.top + 4), text });
  }, []);
  useEffect(() => {
    // Shown once the selection is made (mouse up, or Shift+arrows), gone when it's let go.
    const onChange = () => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed) setReply(null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  const replyTo = (text: string) => {
    setQuote(text.slice(0, 1200));
    setReply(null);
    getSelection()?.removeAllRanges();
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  /** Your message with what you replied to above it, as a quote Claude reads. */
  const withQuote = (text: string) => {
    if (!quote) return text;
    const q = quote.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n");
    return `${q}\n\n${text}`;
  };

  // ---- Scrolling: follow the answer while you're at the bottom; stay put if you scrolled up ----
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      setBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 40);
    });
    ro.observe(content.current!);
    return () => ro.disconnect();
  }, []);
  // Only you can unstick it: a scroll the answer's own growth caused never counts.
  const touched = useRef(0);
  const onScroll = () => {
    placeReply();
    const el = scroller.current!;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap < 48) stick.current = true;
    else if (Date.now() - touched.current < 400) stick.current = false;
    setBelow(gap > 40);
  };
  const markTouched = () => {
    touched.current = Date.now();
  };
  const toBottom = () => {
    stick.current = true;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  };

  const last = messages.at(-1);
  const writing = running && last?.role === "assistant" && last.parts.some((p) => p.type === "text");
  const glow: GlowState = running ? (writing ? "write" : "work") : "idle";

  const ctx = useMemo(() => ({ cards, onOpen: props.onOpenRef }), [cards, props.onOpenRef]);

  const openHistory = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHistory({ x: r.left - 180, y: r.bottom + 6 });
    chatApi.list().then(setChats).catch(() => {});
    chatApi.settings().then((s) => setEffort(s.effort)).catch(() => {});
  };
  const pickEffort = (value: string) => {
    setEffort(value);
    void chatApi.setSettings({ effort: value }).catch(() => {});
  };

  return (
    <aside
      className={`ask ${open ? "open" : ""} ${running ? "running" : ""}`}
      aria-label="FRIDAY"
      aria-hidden={!open}
      inert={!open}
      onMouseLeave={() => highlight(null, false)}
      onKeyDown={(e) => {
        // Esc anywhere in Ask (outside the composer, which only lets go of the cursor) closes it.
        if (e.key === "Escape" && !(e.target as Element).closest("textarea, .popover")) {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <Resizer />
      <header className="ask-head">
        <Mark size={16} active={running} />
        <span className="ask-title" key={title || "new"}>{title || "FRIDAY"}</span>
        <div className="ask-head-tools">
          <button className="ask-tool" onClick={openHistory} title="Conversations" aria-label="Conversations">
            <Icon name="history" size={15} />
          </button>
          <button className="ask-tool" onClick={newChat} title="New conversation" aria-label="New conversation" disabled={!messages.length}>
            <Icon name="compose" size={15} />
          </button>
          <button className="ask-tool" onClick={props.onClose} title="Close (⌘J)" aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>
      </header>

      <div
        className="ask-scroll"
        ref={scroller}
        onScroll={onScroll}
        onWheel={markTouched}
        onTouchMove={markTouched}
        onPointerDown={markTouched}
        onKeyDown={(e) => ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key) && markTouched()}
      >
        <div
          className="ask-content"
          ref={content}
          onMouseUp={() => setTimeout(placeReply, 0)}
          onKeyUp={(e) => e.shiftKey && placeReply()}
        >
          {messages.length === 0 ? (
            <Welcome looking={context} picked={picked} project={!!props.project} onPick={(t) => void send(t)} />
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <UserMessage key={keyOf(m)} m={m} cards={cards} onOpen={props.onOpenRef} />
              ) : (
                <AssistantMessage
                  key={keyOf(m)}
                  m={m}
                  animate={live.current.has(keyOf(m))}
                  last={i === messages.length - 1}
                  ctx={ctx}
                  onShowInGrid={(ids) => props.onShowInGrid(ids, title || "From FRIDAY")}
                  onRetry={() => {
                    const q = messages.slice(0, i).findLast((x) => x.role === "user");
                    if (q) void send(q.text);
                  }}
                />
              ),
            )
          )}
        </div>
      </div>

      <button className={`ask-jump ${below && messages.length ? "show" : ""}`} onClick={toBottom} aria-label="Scroll to the latest" tabIndex={below ? 0 : -1}>
        <Icon name="arrow-down" size={14} />
      </button>

      <div className="ask-foot">
        <Glow state={glow} />
        <Composer
          inputRef={inputRef}
          value={draft}
          setValue={setDraft}
          running={running}
          onSend={(text) => {
            void send(withQuote(text));
            setQuote(null);
          }}
          quote={quote}
          onDropQuote={() => setQuote(null)}
          onMention={(c) => addCards([c])}
          cards={cards}
          onStop={stop}
          context={context}
          onDropContext={() => looking && setDropped(looking.id)}
          picked={picked}
          onDropPicked={() => setDroppedPick(pickKey)}
          lastAsked={messages.findLast((m) => m.role === "user")?.text}
        />
      </div>

      {reply &&
        open &&
        createPortal(
          <button
            className="reply-btn"
            style={{ left: reply.x, top: reply.y }}
            // Keeps the selection while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => replyTo(reply.text)}
          >
            <Icon name="reply" size={13} /> Reply
          </button>,
          document.body,
        )}

      {history && (
        <Popover x={history.x} y={history.y} onClose={() => setHistory(null)}>
          <div className="menu-label">Conversations</div>
          <div className="ask-history">
            {chats.length === 0 && <div className="ask-history-empty">Nothing yet</div>}
            {chats.map((c) => (
              <div key={c.id} className={`ask-history-row ${c.id === chatId ? "on" : ""}`}>
                <button
                  className="menu-item"
                  onClick={() => {
                    setHistory(null);
                    if (c.id !== chatId) void load(c.id);
                  }}
                >
                  <span className="ask-history-title">{c.title}</span>
                  <span className="menu-count">{c.running ? "answering" : ago(c.updated_at)}</span>
                </button>
                <button
                  className="ask-history-x"
                  aria-label={`Delete “${c.title}”`}
                  title="Delete"
                  onClick={async () => {
                    await chatApi.remove(c.id).catch(() => {});
                    setChats((list) => list.filter((x) => x.id !== c.id));
                    if (c.id === chatId) newChat();
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="menu-label ask-depth-label">How hard it thinks</div>
          <div className="ask-depth" role="radiogroup" aria-label="How hard it thinks">
            {DEPTHS.map((d) => (
              <button
                key={d.value}
                role="radio"
                aria-checked={effort === d.value}
                className={effort === d.value ? "on" : ""}
                onClick={() => pickEffort(d.value)}
                title={d.hint}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="ask-depth-hint">{DEPTHS.find((d) => d.value === effort)?.hint ?? ""}</div>
        </Popover>
      )}
    </aside>
  );
}

/** What to call a save: its title, else the first sentence of its read, else what Panel shows. */
function refTitle(r: Ref) {
  const summary = r.read?.profile?.summary;
  return r.title || (typeof summary === "string" ? summary.split(/(?<=\.)\s/)[0]!.replace(/\.$/, "") : "") || displayTitle(r);
}

const DEPTHS = [
  { value: "medium", label: "Quick", hint: "Answers sooner, looks at less." },
  { value: "high", label: "Thorough", hint: "Searches a few ways and looks before it answers." },
  { value: "xhigh", label: "Deep", hint: "Takes its time: more searches, more looking." },
];

/**
 * Ask's width, kept in a rule of its own that sets --chat on just the elements that use
 * it. Set on :root it would restyle every element in the library each frame of a drag.
 */
let widthRule: CSSStyleDeclaration | null = null;
function setChatWidth(px: number | null) {
  if (!widthRule) {
    const style = document.createElement("style");
    style.textContent = ":root .app > .main, :root .app > .ask, :root .app > .detail, :root .app > .dock {}";
    document.head.append(style);
    widthRule = (style.sheet!.cssRules[0] as CSSStyleRule).style;
  }
  if (px == null) widthRule.removeProperty("--chat");
  else widthRule.setProperty("--chat", `${px}px`);
}

/** Drag the panel's left edge to make it wider or narrower; remembered. Double-click resets it. */
function Resizer() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const saved = Number(store.get("panel.ask.width"));
    if (saved >= 340 && saved <= 720) setChatWidth(saved);
  }, []);
  const begin = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const root = document.documentElement;
    root.classList.add("ask-resizing");
    // Keep the edge where it was grabbed, rather than snapping it under the pointer.
    const startX = e.clientX;
    const startW = el.parentElement!.getBoundingClientRect().width;
    let width = startW;
    let x = startX;
    let frame = 0;
    // Pointer events can come several times a frame on a fast drag; apply only the latest,
    // once per frame, so the page lays out once per frame and the edge stays on the pointer.
    const apply = () => {
      frame = 0;
      const w = Math.round(Math.min(720, Math.max(340, startW + startX - x)));
      if (w === width) return;
      width = w;
      setChatWidth(w);
    };
    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const end = () => {
      if (frame) cancelAnimationFrame(frame);
      apply();
      setDragging(false);
      root.classList.remove("ask-resizing");
      store.set("panel.ask.width", String(width));
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  return (
    <div
      className={`ask-resize ${dragging ? "on" : ""}`}
      onPointerDown={begin}
      onDoubleClick={() => {
        setChatWidth(null);
        store.set("panel.ask.width", null);
      }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize FRIDAY"
      title="Drag to resize · double-click to reset"
    />
  );
}

function cardFromRef(r: Ref): RefCard {
  const m = r.media[0];
  return {
    id: r.id,
    title: refTitle(r),
    type: r.site ? "site" : r.has_video ? "video" : "image",
    thumb: m?.thumb_url ?? r.preview_url ?? r.avatar_url,
    ratio: r.site ? 0.625 : m?.width && m.height ? m.height / m.width : 0.75,
    palette: [],
  };
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- Empty state ----------

function Welcome({ looking, picked, project, onPick }: { looking: Ref | null; picked: CanvasSelection | null; project?: boolean; onPick: (t: string) => void }) {
  const ideas = picked
    ? picked.nodes.length === 1
      ? ["What's worth taking from this?", "Find more like this", "What would pair with this?", "Does this suit the project?"]
      : ["What do these have in common?", "Which of these fits the project best?", "Find more like these", "Compare these"]
    : project && !looking
    ? ["Pull typography references for this project", "Suggest palettes that suit what's locked", "What's still undecided here?", "Sum up the decisions so far"]
    : looking
    ? ["What's worth taking from this?", "Find saves with a palette like this one", "What type would pair with this?", "Find motion that would suit this"]
    : [
        "Gather references for a calm, warm banking app",
        "What kind of motion do I save most?",
        "Palettes built on one vivid accent",
        "Type that feels editorial but technical",
      ];
  return (
    <div className="ask-welcome">
      <Mark size={40} />
      <h2>Ask FRIDAY</h2>
      <p>Find references by feeling, color, type or motion, and put them together into something new.</p>
      <div className="ask-ideas" key={looking?.id ?? (picked ? `pick-${picked.nodes.length === 1}` : project ? "project" : "all")}>
        {ideas.map((t, i) => (
          <button key={t} className="ask-idea" style={{ animationDelay: `${120 + i * 50}ms` }} onClick={() => onPick(t)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Messages ----------

function UserMessage({ m, cards, onOpen }: { m: ChatMessage; cards: Map<string, RefCard>; onOpen: (id: string) => void }) {
  const about = m.context?.open ? cards.get(m.context.open) : null;
  const pick = m.context?.label ? m.context : null;
  // A reply starts with what it replies to, as "> " lines.
  const q = m.text.match(/^((?:>[^\n]*(?:\n|$))+)\s*/);
  const quoted = q ? q[1]!.split("\n").map((l) => l.replace(/^> ?/, "")).join("\n").trim() : null;
  const body = q ? m.text.slice(q[0].length) : m.text;
  // Saves mentioned with @ travel as [[id]] and show as their chips.
  const pieces = body.split(/(\[\[[0-9a-f]{16}\]\])/);
  return (
    <div className="msg-user">
      {about && (
        <button className="msg-about" onClick={() => onOpen(about.id)}>
          {about.thumb && <img src={about.thumb} alt="" />}
          <span>{about.title}</span>
        </button>
      )}
      {pick && (
        <span className="msg-about">
          {pick.thumbs?.length ? (
            <span className="composer-thumbs">{pick.thumbs.map((t) => <img key={t} src={t} alt="" />)}</span>
          ) : (
            <Icon name="grid" size={12} />
          )}
          <span>{pick.label}</span>
        </span>
      )}
      {quoted && (
        <div className="msg-quote">
          <Icon name="reply" size={11} />
          <span>{quoted}</span>
        </div>
      )}
      <div className="msg-bubble">
        {pieces.map((t, i) => {
          const id = t.match(/^\[\[([0-9a-f]{16})\]\]$/)?.[1];
          return id ? <RefChip key={i} id={id} ctx={{ cards, onOpen }} /> : t;
        })}
      </div>
    </div>
  );
}

type Ctx = { cards: Map<string, RefCard>; onOpen: (id: string) => void };

function AssistantMessage(props: {
  m: ChatMessage;
  animate: boolean;
  last: boolean;
  ctx: Ctx;
  onShowInGrid: (ids: string[]) => void;
  onRetry: () => void;
}) {
  const { m, ctx } = props;
  const streaming = m.status === "streaming";
  // Parts in order, with tool calls and thinking grouped into runs of steps.
  const groups: ({ kind: "steps"; parts: ChatPart[]; key: number } | { kind: "text"; text: string; key: number })[] = [];
  m.parts.forEach((p, i) => {
    if (p.type === "text") groups.push({ kind: "text", text: p.text, key: i });
    else {
      const g = groups.at(-1);
      if (g?.kind === "steps") g.parts.push(p);
      else groups.push({ kind: "steps", parts: [p], key: i });
    }
  });
  const mentioned = useMemo(() => {
    const ids: string[] = [];
    for (const p of m.parts) if (p.type === "text") for (const x of p.text.matchAll(REF_IN_TEXT)) if (!ids.includes(x[1]!)) ids.push(x[1]!);
    return ids;
  }, [m.parts]);
  const [copied, setCopied] = useState(false);
  // The last words may still be coming into view after the stream ends; actions wait for them.
  const [revealing, setRevealing] = useState(false);
  const plain = () =>
    m.parts
      .filter((p): p is Extract<ChatPart, { type: "text" }> => p.type === "text")
      .map((p) => p.text.replace(REF_IN_TEXT, (_, id: string) => ctx.cards.get(id)?.title ?? id))
      .join("\n\n");

  return (
    <div className="msg-ai">
      {/* Before anything arrives: it has started, quietly. */}
      {streaming && groups.length === 0 && (
        <div className="steps live">
          <div className="steps-body open">
            <div>
              <Step part={{ type: "thinking" }} ctx={ctx} label="Starting" />
            </div>
          </div>
        </div>
      )}
      {groups.map((g, i) =>
        g.kind === "steps" ? (
          <Steps key={`s${g.key}`} parts={g.parts} active={streaming && i === groups.length - 1} ctx={ctx} />
        ) : (
          <TextPart
            key={`t${g.key}`}
            text={g.text}
            animate={props.animate}
            streaming={streaming && i === groups.length - 1}
            ctx={ctx}
            onLive={i === groups.length - 1 ? setRevealing : undefined}
          />
        ),
      )}
      {m.status === "error" && (
        <div className="msg-error">
          <span>{m.error || "Something went wrong."}</span>
          {props.last && <button onClick={props.onRetry}>Try again</button>}
        </div>
      )}
      {m.status === "stopped" && <div className="msg-stopped">Stopped</div>}
      {!streaming && !revealing && m.status !== "error" && (mentioned.length > 0 || groups.some((g) => g.kind === "text")) && (
        <div className="msg-actions">
          {mentioned.length > 1 && (
            <button onClick={() => props.onShowInGrid(mentioned)}>
              <Icon name="grid" size={13} /> Show {mentioned.length} in the library
            </button>
          )}
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(plain());
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

function TextPart({ text, animate, streaming, ctx, onLive }: { text: string; animate: boolean; streaming: boolean; ctx: Ctx; onLive?: (live: boolean) => void }) {
  const { text: shown, live } = useSmoothText(text, animate, streaming);
  useEffect(() => onLive?.(live), [live, onLive]);
  return <RichText text={shown} live={live} ctx={ctx} />;
}

// ---------- Steps: what it did on the way to the answer ----------

const q = (s: unknown) => (typeof s === "string" && s ? <q className="step-q">{s}</q> : null);

function stepText(p: ChatPart, ctx: Ctx): { doing: React.ReactNode; done: React.ReactNode } {
  if (p.type === "thinking") {
    const s = Math.round((p.ms ?? 0) / 1000);
    return { doing: "Thinking", done: s >= 1 ? `Thought for ${s}s` : "Thought it over" };
  }
  if (p.type !== "tool") return { doing: "", done: "" };
  const i = p.input ?? {};
  const found = p.error ? <span className="step-fail"> · didn't work</span> : typeof p.total === "number" ? <span className="step-n"> · {p.total === 0 ? "nothing" : p.total}</span> : null;
  const FACET: Record<string, string> = { color: "colors", typography: "type", layout: "layouts", imagery: "imagery", motion: "motion", mood: "moods", components: "components" };
  const facets = Array.isArray(i.facets) && i.facets.length ? ` ${(i.facets as string[]).map((f) => FACET[f] ?? f).join(" & ")}` : "";
  switch (p.name) {
    case "search_library":
      return {
        doing: <>Searching{facets}{i.query ? <> for {q(i.query)}</> : null}</>,
        done: <>Searched{facets}{i.query ? <> for {q(i.query)}</> : null}{found}</>,
      };
    case "find_by_color": {
      const dots = (
        <span className="step-dots">
          {((i.colors as string[] | undefined) ?? []).map((c) => <i key={c} style={{ background: /^#?[0-9a-f]{3,6}$/i.test(c) ? (c.startsWith("#") ? c : `#${c}`) : undefined }} title={c} />)}
        </span>
      );
      return { doing: <>Matching colors {dots}</>, done: <>Matched colors {dots}{found}</> };
    }
    case "similar_to": {
      const c = typeof i.id === "string" ? ctx.cards.get(i.id) : null;
      const what = c ? q(c.title.length > 40 ? `${c.title.slice(0, 39)}…` : c.title) : "a save";
      return { doing: <>Finding saves like {what}</>, done: <>Found saves like {what}{found}</> };
    }
    case "gather_for_brief":
      return { doing: <>Gathering references for {q(i.brief) ?? "the brief"}</>, done: <>Gathered references for {q(i.brief) ?? "the brief"}</> };
    case "get_reference": {
      const n = Array.isArray(i.ids) ? i.ids.length : 0;
      return { doing: <>Looking at {n > 1 ? `${n} saves` : "a save"}</>, done: <>Looked at {n > 1 ? `${n} saves` : "a save"}</> };
    }
    case "library_overview":
      return { doing: "Reading the whole library", done: "Read the whole library" };
    case "save_to_collection":
      return { doing: <>Saving to {q(i.name)}</>, done: <>Saved to {q(i.name)}</> };
    case "list_projects":
      return { doing: "Looking at your projects", done: "Looked at your projects" };
    case "get_project": {
      // Called with the project's id from the canvas: say "the project", not a code.
      const what = typeof i.project === "string" && !/^[0-9a-f]{16}$/.test(i.project) ? q(i.project) : "the project";
      return { doing: <>Reading {what}</>, done: <>Read {what}</> };
    }
    case "get_project_material":
      return { doing: "Reading the project's materials", done: "Read the project's materials" };
    case "place_on_board": {
      const n = Array.isArray(i.saves) ? i.saves.length : 0;
      const where = q(i.topic) ?? "a topic";
      return { doing: <>Placing {n ? `${n} ` : ""}on the canvas under {where}</>, done: <>Placed {p.refs?.length ?? n} under {where}</> };
    }
    case "add_topic":
      return { doing: <>Adding {q(i.title) ?? "a topic"}</>, done: <>Added {q(i.title) ?? "a topic"}</> };
    case "connect_topics":
      return { doing: <>Connecting {q(i.from)} to {q(i.to)}</>, done: <>Connected {q(i.from)} to {q(i.to)}</> };
    case "add_note":
      return { doing: "Writing a note", done: "Wrote a note" };
    case "mark_saves": {
      const w = i.state === "chosen" ? "Chose" : i.state === "ruled_out" ? "Ruled out" : "Kept";
      const n = Array.isArray(i.ids) ? i.ids.length : 0;
      return { doing: "Marking saves", done: `${w} ${n} ${n === 1 ? "save" : "saves"}` };
    }
    case "lock_topic":
      return { doing: <>{i.unlock ? "Reopening" : "Locking"} {q(i.topic)}</>, done: <>{i.unlock ? "Reopened" : "Locked"} {q(i.topic)}</> };
    // A sketch is written, then rendered and looked at: the step stays on until the pictures are back.
    case "make_sketch":
      return { doing: <>Sketching {q(i.title) ?? "a direction"}</>, done: <>Sketched {q(i.title) ?? "a direction"}</> };
    case "edit_sketch": {
      const what = typeof i.sketch === "string" && !/^[0-9a-f]{16}$/.test(i.sketch) ? q(i.sketch) : "the sketch";
      return { doing: <>Changing {what}</>, done: <>Changed {what}</> };
    }
    case "get_sketch":
      return { doing: "Looking at the sketch", done: "Looked at the sketch" };
    default:
      return { doing: p.name.replace(/_/g, " "), done: p.name.replace(/_/g, " ") };
  }
}

function Steps({ parts, active, ctx }: { parts: ChatPart[]; active: boolean; ctx: Ctx }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const expanded = userOpen ?? active;
  const refs = useMemo(() => {
    const ids: string[] = [];
    for (const p of parts) if (p.type === "tool") for (const id of p.refs ?? []) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [parts]);
  const tools = parts.filter((p) => p.type === "tool");
  const EDITS = ["place_on_board", "add_topic", "connect_topics", "add_note", "mark_saves", "lock_topic", "make_sketch", "edit_sketch"];
  const CANVAS = ["list_projects", "get_project", "get_project_material", "get_sketch", ...EDITS];
  const searches = tools.filter((p) => p.type === "tool" && p.name !== "get_reference" && p.name !== "library_overview" && p.name !== "save_to_collection" && !CANVAS.includes(p.name)).length;
  const placed = tools.reduce((n, p) => n + (p.type === "tool" && p.name === "place_on_board" ? (p.refs?.length ?? 0) : 0), 0);
  const sketched = tools.filter((p) => p.type === "tool" && p.name === "make_sketch" && !p.error).length;
  const edited = tools.some((p) => p.type === "tool" && EDITS.includes(p.name));
  const looked = tools.reduce((n, p) => n + (p.type === "tool" && p.name === "get_reference" ? ((p.input?.ids as string[] | undefined)?.length ?? 1) : 0), 0);
  const saved = tools.find((p) => p.type === "tool" && p.name === "save_to_collection");
  const read = tools.some((p) => p.type === "tool" && p.name === "library_overview");
  const summary =
    [
      searches ? `${searches} ${searches === 1 ? "search" : "searches"}` : "",
      looked ? `looked at ${looked}` : "",
      read && !searches && !looked ? "read the whole library" : "",
      saved && saved.type === "tool" ? `saved to “${String(saved.input?.name ?? "a collection")}”` : "",
      sketched ? `made ${sketched} ${sketched === 1 ? "sketch" : "sketches"}` : "",
      placed ? `placed ${placed} on the canvas` : edited && !sketched ? "updated the canvas" : "",
    ].filter(Boolean).join(", ") || "Thought it over";

  return (
    <div className={`steps ${active ? "live" : ""} ${expanded ? "expanded" : ""}`}>
      <div className={`steps-head ${active ? "" : "open"}`}>
        <div>
          <button className="steps-summary" onClick={() => setUserOpen(!expanded)} aria-expanded={expanded}>
            {refs.length > 0 && <Thumbs ids={refs.slice(0, 5)} ctx={ctx} />}
            <span>{summary.charAt(0).toUpperCase() + summary.slice(1)}{refs.length ? ` · ${refs.length} saves` : ""}</span>
            <span className="steps-chevron"><Icon name="chevron-down" size={12} /></span>
          </button>
        </div>
      </div>
      <div className={`steps-body ${expanded ? "open" : ""}`}>
        <div>
          {parts.map((p, i) => (
            <Step key={p.type === "tool" ? p.id : `t${i}`} part={p} ctx={ctx} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Step({ part, ctx, label }: { part: ChatPart; ctx: Ctx; label?: string }) {
  const done = part.type !== "text" && !!part.done;
  const text = stepText(part, ctx);
  const ids = part.type === "tool" ? (part.name === "get_reference" ? ((part.input?.ids as string[] | undefined) ?? []) : (part.refs ?? [])) : [];
  return (
    <div className={`step ${done ? "done" : "doing"}`}>
      <span className="step-node" />
      <div className="step-main">
        <span className={`step-label ${done ? "" : "shine"}`}>
          {label ?? (done ? text.done : text.doing)}
          {!done && part.type === "thinking" && <Seconds />}
        </span>
        {ids.length > 0 && (part.type === "tool" && (part.done || part.name === "get_reference")) && (
          <Gallery ids={ids.slice(0, 12)} ctx={ctx} small />
        )}
      </div>
    </div>
  );
}

function Thumbs({ ids, ctx }: { ids: string[]; ctx: Ctx }) {
  return (
    <span className="thumbs">
      {ids.map((id, i) => {
        const c = ctx.cards.get(id);
        return <i key={id} style={{ zIndex: 10 - i, animationDelay: `${i * 40}ms` }}>{c?.thumb && <img src={c.thumb} alt="" />}</i>;
      })}
    </span>
  );
}

/** Seconds since it started thinking, ticking. */
function Seconds() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, []);
  return s >= 2 ? <span className="step-secs"> {s}s</span> : null;
}

// ---------- Composer ----------

/** The words after an @ being typed, up to the caret: "@inter", "@swiss poster". */
const MENTION_AT = /(?:^|\s)@((?:[^\s@]+ ?){0,4})$/;
const labelFor = (c: RefCard) => {
  const t = c.title.replace(/\s+/g, " ").trim();
  return t.length > 36 ? `${t.slice(0, 35).trimEnd()}…` : t || "Untitled";
};

function Composer(props: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (v: string) => void;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  context: Ref | null;
  onDropContext: () => void;
  lastAsked?: string;
  cards: Map<string, RefCard>;
  onMention: (c: RefCard) => void;
  quote: string | null;
  onDropQuote: () => void;
  picked: CanvasSelection | null;
  onDropPicked: () => void;
}) {
  const { value, running, context } = props;
  // Saves mentioned with @, by the label written in the text ("@Swiss poster").
  const mentions = useRef(new Map<string, RefCard>());
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const [found, setFound] = useState<RefCard[]>([]);
  const [pick, setPick] = useState(0);
  // Esc closes the list until the next @.
  const dismissed = useRef<number | null>(null);

  // Grows with what you write, up to a point, then scrolls.
  useLayoutEffect(() => {
    const el = props.inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value, props.inputRef]);

  /** Is an @ being typed at the caret? */
  const look = (text: string, caret: number) => {
    const m = text.slice(0, caret).match(MENTION_AT);
    if (!m) {
      dismissed.current = null;
      return setPicker(null);
    }
    const start = caret - m[1]!.length - 1;
    // Just after a mention already made ("@Swiss poster |"): that's not a new one.
    if (dismissed.current === start || [...mentions.current.keys()].some((l) => m[1]!.startsWith(l))) return setPicker(null);
    setPicker((p) => (p?.start === start && p.query === m[1] ? p : { query: m[1]!, start }));
  };

  // Saves for the list: the newest with nothing typed yet, else the best matches.
  const query = picker?.query.trim() ?? null;
  useEffect(() => {
    if (query === null) return;
    let live = true;
    const t = setTimeout(() => {
      api
        .refs({ q: query || undefined, library: true })
        .then((list) => {
          if (!live) return;
          setFound(list.slice(0, 7).map(cardFromRef));
          setPick(0);
        })
        .catch(() => live && setFound([]));
    }, query ? 110 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  const open = !!picker && found.length > 0;

  const choose = (c: RefCard) => {
    if (!picker) return;
    let label = labelFor(c);
    // Two saves with the same name stay apart.
    for (let n = 2; mentions.current.has(label) && mentions.current.get(label)!.id !== c.id; n++) label = `${labelFor(c)} (${n})`;
    mentions.current.set(label, c);
    props.onMention(c);
    const el = props.inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, picker.start)}@${label} ${value.slice(caret)}`;
    props.setValue(next);
    setPicker(null);
    const at = picker.start + label.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  };

  /** What's sent: each mention as [[id]], which Claude reads as that save. */
  const resolve = (text: string) => {
    let out = text;
    // Longest first, so "@Poster (2)" isn't taken for "@Poster".
    for (const [label, c] of [...mentions.current].sort((a, b) => b[0].length - a[0].length)) out = out.split(`@${label}`).join(`[[${c.id}]]`);
    return out;
  };
  const mentioned = [...mentions.current].filter(([label]) => value.includes(`@${label}`));
  const send = () => {
    if (running || !value.trim()) return;
    const text = resolve(value);
    mentions.current.clear();
    setPicker(null);
    props.onSend(text);
  };

  const can = !!value.trim();
  const thumb = context ? context.media[0]?.thumb_url ?? context.preview_url ?? context.avatar_url : null;
  return (
    <div className={`composer ${running ? "working" : ""} ${can ? "has-text" : ""}`}>
      {open && (
        <div className="mention-pick" role="listbox" aria-label="Mention a save">
          <div className="mention-head">{picker!.query.trim() ? "Saves matching" : "Mention a save"}</div>
          {found.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === pick}
              className={`mention-row ${i === pick ? "on" : ""}`}
              style={{ "--i": i } as React.CSSProperties}
              onMouseEnter={() => setPick(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
            >
              <span className="mention-thumb">{c.thumb && <img src={c.thumb} alt="" />}</span>
              <span className="mention-title">{c.title}</span>
              <span className="mention-type">{c.type}</span>
            </button>
          ))}
        </div>
      )}
      {context && (
        <div className="composer-context" key={context.id}>
          {thumb && <img src={thumb} alt="" />}
          <span className="composer-context-text">
            <span className="faint">Looking at</span> {refTitle(context)}
          </span>
          <button onClick={props.onDropContext} aria-label="Don't include this" title="Don't include this">
            <Icon name="x" size={11} />
          </button>
        </div>
      )}
      {props.picked && (
        <div className="composer-context picked" key={props.picked.nodes.join(",")}>
          {props.picked.thumbs.length > 0 && (
            <span className="composer-thumbs">
              {props.picked.thumbs.map((t) => <img key={t} src={t} alt="" />)}
            </span>
          )}
          <span className="composer-context-text">
            <span className="faint">On the canvas</span> {props.picked.label}
          </span>
          <button onClick={props.onDropPicked} aria-label="Don't include this" title="Don't include this">
            <Icon name="x" size={11} />
          </button>
        </div>
      )}
      {props.quote && (
        <div className="composer-quote" key={props.quote}>
          <Icon name="reply" size={12} />
          <span className="composer-quote-text">{props.quote}</span>
          <button onClick={props.onDropQuote} aria-label="Don't reply to this" title="Don't reply to this">
            <Icon name="x" size={11} />
          </button>
        </div>
      )}
      {mentioned.length > 0 && (
        <div className="composer-mentions">
          {mentioned.map(([label, c]) => (
            <span key={label} className="composer-mention" title={c.title}>
              {c.thumb && <img src={c.thumb} alt="" />}
              <span>{label}</span>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={props.inputRef}
          value={value}
          rows={1}
          placeholder={props.quote ? "Reply to this" : props.picked ? (props.picked.nodes.length === 1 ? "Ask about this" : "Ask about these") : context ? "Ask about this, or anything in your library. @ to mention a save" : "Ask anything about your library. @ to mention a save"}
          onChange={(e) => {
            props.setValue(e.target.value);
            look(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => look(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setPicker(null)}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((i) => (i + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
                e.preventDefault();
                choose(found[pick] ?? found[0]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                dismissed.current = picker!.start;
                setPicker(null);
                return;
              }
            }
            // ↑ in an empty composer brings back what you last asked, to change it.
            if (e.key === "ArrowUp" && !value && props.lastAsked) {
              e.preventDefault();
              const again = props.lastAsked.replace(/\[\[([0-9a-f]{16})\]\]/g, (all, id: string) => {
                const c = props.cards.get(id);
                if (!c) return all;
                mentions.current.set(labelFor(c), c);
                return `@${labelFor(c)}`;
              });
              props.setValue(again);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape") {
              // Only leaves the composer; doesn't also close what's open behind it.
              e.stopPropagation();
              if (props.quote && !value) return props.onDropQuote();
              e.currentTarget.blur();
            }
          }}
          spellCheck={false}
          aria-label="Message"
        />
        {running ? (
          <button className="composer-btn stop" key="stop" onClick={props.onStop} aria-label="Stop" title="Stop">
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button className="composer-btn send" key="send" onClick={send} disabled={!can} aria-label="Send" title="Send (↵)">
            <Icon name="arrow-up" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
