// Ask: the assistant beside the library. It searches and looks at your saves, answers as
// it thinks, and shows the saves it means as pictures you can open. It stays open while
// you browse, knows what you have open, and keeps every conversation.

import { createPortal } from "react-dom";
import { Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref as ReactRef, useSyncExternalStore } from "react";
import { api, brandApi, BRAND_KIND_LABEL, chatApi, displayTitle, fontApi, type BrandAsset, type CanvasSelection, type Collection, type Filters, type ChatEvent, type ChatFileNote, type ChatMessage, type ChatPart, type ChatSummary, type ContextUse, type Ref, type RefCard } from "./api.ts";
import { Glow, Mark, type GlowState } from "./Glow.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Gallery, highlight, RefChip, RichText, useSmoothText } from "./StreamText.tsx";
import { Popover } from "./TagRow.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { ContextMeter } from "./ContextMeter.tsx";
import { MicButton } from "./Voice.tsx";

export interface AssistantHandle {
  /** Ask, about what's given instead of what's open or selected (the studio's sketch, or a part of it). */
  ask: (text: string, about?: CanvasSelection) => void;
  focus: () => void;
  /** Add these words to what's being written, and put the cursor there. */
  type: (t: string) => void;
}

/** The one conversation older Panels remembered for everywhere; read once, by the library. */
const LS_CHAT = "panel.ask.chat";
/** The conversation last open in a place: a project (its id) or the library (null). */
const chatKey = (place: string | null) => `${LS_CHAT}.${place ?? "library"}`;
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

// Sketch pages while FRIDAY is still writing them, by tool call. Kept outside React's
// state: a draft arrives a few times a second, and only the small preview under that step
// should redraw, not the conversation.
const drafts = new Map<string, string>();
const draftWatchers = new Set<() => void>();
function putDraft(id: string, html: string | null) {
  if (html) drafts.set(id, html);
  else if (!drafts.delete(id)) return;
  draftWatchers.forEach((f) => f());
}
const watchDrafts = (f: () => void) => {
  draftWatchers.add(f);
  return () => void draftWatchers.delete(f);
};

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
        if (!(last?.type === "thinking" && !last.done)) parts.push({ type: "thinking", model: e.model });
      } else {
        const i = parts.findLastIndex((p) => p.type === "thinking");
        if (i >= 0) {
          const p = parts[i] as Extract<ChatPart, { type: "thinking" }>;
          parts[i] = { ...p, done: true, ms: (p.ms ?? 0) + (e.ms ?? 0) };
        }
      }
      return { ...m, parts };
    case "tool":
      parts.push({ type: "tool", id: e.id, name: e.name, model: e.model });
      return { ...m, parts };
    case "compact":
      parts.push({ type: "compact", pre: e.pre, post: e.post, done: true });
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
  /** That project's name, for the conversations list. */
  projectName?: string;
  /** Go to a project (or the library, null), to carry on a conversation that belongs there. */
  onGoTo?: (project: string | null) => void;
  /** What's selected on that canvas, if anything: what "this" and "these" mean there. */
  picked?: CanvasSelection | null;
  /** A part of a sketch (picked.point) was sent with a message, or taken off: the studio lets go of it. */
  onLetGoPoint?: () => void;
  onOpenRef: (id: string) => void;
  /** Open the brand assets page onto one asset, or a project's kit ("none": those in no project). */
  onOpenBrand?: (focus: string) => void;
  onShowInGrid: (ids: string[], title: string) => void;
  onRunning: (running: boolean) => void;
  /** What it's doing right now, in a few words ("Sketching Header alt"), or null. */
  onDoing?: (doing: React.ReactNode) => void;
  /** It changed the library (made or filled a collection): the app should reload what it shows. */
  onLibraryChanged: () => void;
  handle: ReactRef<AssistantHandle>;
}) {
  const { open, looking } = props;
  // Each place, a project or the library, has its own conversations and remembers the last
  // one open there. Going to another project brings up that project's conversation (or a new
  // one), never the one from the project you left; an answer still going there keeps going.
  const place = props.project ?? null;
  const placeNow = useRef(place);
  placeNow.current = place;
  const [chatId, setChatId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [cards, setCards] = useState<Map<string, RefCard>>(() => new Map());
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<{ x: number; y: number } | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  /** How full this conversation is, and what fills it (the meter by the message box). */
  const [use, setUse] = useState<ContextUse | null>(null);
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
  // The canvas selection, until you take it off (for that selection). A part of a sketch
  // selected in the studio is a selection of its own, part by part.
  const pickKey = props.picked ? props.picked.nodes.join(",") + (props.picked.point ? `#${props.picked.point.selector}` : "") : "";
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
            if (e.t === "draft") return putDraft(e.id, e.html);
            if (e.t === "title") return setTitle(e.title);
            if (e.t === "context") return setUse({ used: e.used, limit: e.limit, parts: e.parts });
            if (e.t === "start") runId.current = e.message.id;
            if (e.t === "tool") toolNames.current.set(e.id, e.name);
            if (e.t === "tool_result") {
              putDraft(e.id, null);
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
      const at = placeNow.current;
      try {
        const c = await chatApi.get(id);
        if (placeNow.current !== at) return;
        // A conversation from another place isn't continued here (see onGoTo).
        if ((c.project ?? null) !== at) throw new Error("elsewhere");
        setChatId(c.id);
        store.set(chatKey(at), c.id);
        setTitle(c.title);
        setUse(c.context);
        setMessages(c.messages);
        addCards(c.cards);
        const streaming = c.messages.findLast((m) => m.role === "assistant" && m.status === "streaming");
        runId.current = streaming?.id ?? null;
        if (c.running && streaming) {
          live.current.add(streaming.id);
          follow(c.id, c.seq);
        } else setRunning(false);
      } catch {
        if (placeNow.current !== at) return;
        store.set(chatKey(at), null);
        setChatId(null);
        setMessages([]);
        setTitle("");
        setUse(null);
        setRunning(false);
      }
    },
    [addCards, follow],
  );

  // Arriving at a place (and on first open): its last conversation, or a fresh start.
  // The library also picks up the one conversation older Panels remembered for everywhere.
  useEffect(() => {
    clear();
    const id = store.get(chatKey(place)) ?? (place === null ? store.get(LS_CHAT) : null);
    if (id) void load(id);
    return () => follower.current?.abort();
  }, [place]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    async (raw: string, about?: CanvasSelection, files: ChatFileNote[] = []) => {
      const text = raw.trim();
      if ((!text && !files.length) || running) return;
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
        ...(picked?.fan ? { fan: picked.fan } : {}),
        ...(picked?.figma ? { figma: picked.figma } : {}),
        ...(files.length ? { files: files.map((f) => f.id) } : {}),
      };
      if (context && !cards.has(context.id)) addCards([cardFromRef(context)]);
      // A part of a sketch goes with this message only: the studio lets go of it.
      if (picked?.point && !about) props.onLetGoPoint?.();
      const about0 = context ? { open: context.id } : picked ? { nodes: picked.nodes, label: picked.label, thumbs: picked.thumbs } : null;
      const temp: ChatMessage = { id: `u${Date.now()}`, role: "user", text, context: files.length ? { ...about0, files } : about0, parts: [], status: "done", error: null, created_at: new Date().toISOString() };
      const pending: Msg = { id: "pending", key: `a${Date.now()}`, role: "assistant", text: "", context: null, parts: [], status: "streaming", error: null, created_at: temp.created_at };
      live.current.add(pending.key!);
      setMessages((ms) => [...ms, temp, pending]);
      setRunning(true);
      if (!title) setTitle((text || files.map((f) => f.name).join(", ")).replace(/\s+/g, " ").slice(0, 80));
      try {
        if (!id) {
          id = (await chatApi.create(place)).id;
          setChatId(id);
          store.set(chatKey(place), id);
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
    [chatId, contextNow, pickedNow, running, title, follow, addCards, cards, props.project, place],
  );

  const stop = () => {
    if (chatId) void chatApi.stop(chatId).catch(() => {});
  };

  /** An empty panel. An answer still going in the conversation that was here carries on without it. */
  const clear = () => {
    follower.current?.abort();
    setChatId(null);
    setMessages([]);
    setTitle("");
    setUse(null);
    setRunning(false);
    runId.current = null;
  };
  const newChat = () => {
    clear();
    store.set(chatKey(place), null);
    setDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useImperativeHandle(props.handle, () => ({
    ask: (text: string, about?: CanvasSelection) => void send(text, about),
    focus: () => inputRef.current?.focus(),
    // The studio: a letter typed with a part selected starts a message about it here.
    type: (t: string) => {
      setDraft((d) => d + t);
      inputRef.current?.focus();
    },
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

  // What it's doing right now, for the studio's bar while this panel is folded away: the
  // latest step still going, or the answer being written.
  const doing = useMemo(() => {
    if (!running || last?.role !== "assistant") return null;
    const p = last.parts.findLast((x) => x.type !== "text" && !x.done);
    if (p) return stepText(p, ctx).doing || null;
    return writing ? "Writing the answer" : null;
  }, [running, last, writing, ctx]);
  useEffect(() => props.onDoing?.(doing), [doing]); // eslint-disable-line react-hooks/exhaustive-deps

  const openHistory = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHistory({ x: r.left - 220, y: r.bottom + 6 });
    chatApi.list().then(setChats).catch(() => {});
  };

  // The conversations list: where you are first (even when it has none yet), then every
  // other project, and the library, each under its name, the most recently used first.
  const groups = useMemo(() => {
    const here: { place: string | null; name: string; chats: ChatSummary[] } = {
      place, name: place ? props.projectName || "This project" : "Library", chats: [],
    };
    const by = new Map<string | null, typeof here>([[place, here]]);
    for (const c of chats) {
      const at = c.project ?? null;
      let g = by.get(at);
      if (!g) by.set(at, (g = { place: at, name: at ? c.project_name || "A project" : "Library", chats: [] }));
      g.chats.push(c);
    }
    return [...by.values()];
  }, [chats, place, props.projectName]);

  // A conversation belongs where it was started. One from elsewhere takes you there, so
  // FRIDAY and the canvas you see are about the same project.
  const openChat = (c: ChatSummary) => {
    setHistory(null);
    const at = c.project ?? null;
    if (at === place) {
      if (c.id !== chatId) void load(c.id);
      return;
    }
    store.set(chatKey(at), c.id);
    props.onGoTo?.(at);
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
                <UserMessage key={keyOf(m)} m={m} cards={cards} onOpen={props.onOpenRef} onOpenBrand={props.onOpenBrand} />
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
          use={use}
          inputRef={inputRef}
          value={draft}
          setValue={setDraft}
          running={running}
          onSend={(text, files) => {
            void send(withQuote(text), undefined, files);
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
          onDropPicked={() => {
            setDroppedPick(pickKey);
            if (picked?.point) props.onLetGoPoint?.();
          }}
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
        <Popover x={history.x} y={history.y} onClose={() => setHistory(null)} className="ask-history-pop">
          <div className="ask-history">
            {groups.map((g) => (
              <section key={g.place ?? "library"} className="ask-history-group">
                <div className="menu-label">{g.name}</div>
                {g.chats.length === 0 && <div className="ask-history-empty">Nothing here yet</div>}
                {g.chats.map((c) => (
                  <div key={c.id} className={`ask-history-row ${c.id === chatId ? "on" : ""}`}>
                    <button className="menu-item" onClick={() => openChat(c)}>
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
              </section>
            ))}
          </div>
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

/**
 * Ask's width, kept in a rule of its own that sets --chat on just the elements that use
 * it. Set on :root it would restyle every element in the library each frame of a drag.
 */
let widthRule: CSSStyleDeclaration | null = null;
function setChatWidth(px: number | null) {
  if (!widthRule) {
    const style = document.createElement("style");
    style.textContent = ":root .app > .main, :root .app > .ask, :root .app > .detail, :root .app > .dock, :root .studio .st-rail {}";
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

function UserMessage({ m, cards, onOpen, onOpenBrand }: { m: ChatMessage; cards: Map<string, RefCard>; onOpen: (id: string) => void; onOpenBrand?: (focus: string) => void }) {
  const about = m.context?.open ? cards.get(m.context.open) : null;
  const pick = m.context?.label ? m.context : null;
  // A reply starts with what it replies to, as "> " lines.
  const q = m.text.match(/^((?:>[^\n]*(?:\n|$))+)\s*/);
  const quoted = q ? q[1]!.split("\n").map((l) => l.replace(/^> ?/, "")).join("\n").trim() : null;
  const body = q ? m.text.slice(q[0].length) : m.text;
  // Saves mentioned with @ travel as [[id]] and show as their chips; brand assets as [[brand:id]], a kit as [[brandkit:id]].
  const pieces = body.split(/(\[\[(?:brand:|brandkit:)?(?:[0-9a-f]{16}|none)\]\])/);
  const files = m.context?.files ?? [];
  return (
    <div className="msg-user">
      {files.length > 0 && (
        <div className="msg-files">
          {files.map((f) =>
            f.picture ? (
              <a key={f.id} className="msg-file-pic" href={`/api/chat-files/${f.id}`} target="_blank" rel="noreferrer" title={f.name}>
                <img src={`/api/chat-files/${f.id}/view`} alt={f.name} />
              </a>
            ) : (
              <a key={f.id} className="msg-about" href={`/api/chat-files/${f.id}`} target="_blank" rel="noreferrer" title={f.name}>
                <Icon name="file" size={12} />
                <span>{f.name}</span>
              </a>
            ),
          )}
        </div>
      )}
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
      {/* Only files sent, no words: no empty bubble under them. */}
      {(body.trim() || !files.length) && (
        <div className="msg-bubble">
          {pieces.map((t, i) => {
            const brand = t.match(/^\[\[(brand|brandkit):([0-9a-f]{16}|none)\]\]$/);
            if (brand) return <BrandChip key={i} kit={brand[1] === "brandkit"} id={brand[2]!} onOpen={onOpenBrand} />;
            const id = t.match(/^\[\[([0-9a-f]{16})\]\]$/)?.[1];
            return id ? <RefChip key={i} id={id} ctx={{ cards, onOpen }} /> : t;
          })}
        </div>
      )}
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
    // With two models on one answer, say which one is thinking.
    if (p.model) return { doing: `${p.model} is thinking`, done: s >= 1 ? `${p.model} thought for ${duration(s)}` : `${p.model} thought it over` };
    return { doing: "Thinking", done: s >= 1 ? `Thought for ${duration(s)}` : "Thought it over" };
  }
  if (p.type === "compact") {
    const k = (n: number) => `${Math.round(n / 1000)}K`;
    const said = `Summarized the conversation so far to make room${p.post ? ` (${k(p.pre)} → ${k(p.post)} tokens)` : ""}; the project card came back in full`;
    return { doing: said, done: said };
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
    // Panel's ready-made parts: icons found by name, a palette, a loading animation, or the list.
    case "get_ready_made":
      if (typeof i.find_icons === "string" && i.find_icons) return { doing: "Finding icons", done: "Found icons" };
      if (typeof i.palette === "string" && i.palette) return { doing: <>Reading the palette {q(i.palette)}</>, done: <>Read the palette {q(i.palette)}</> };
      if (typeof i.loading === "string" && i.loading) return { doing: <>Looking at the loading animation {q(i.loading)}</>, done: <>Looked at the loading animation {q(i.loading)}</> };
      if (Array.isArray(i.icons) && i.icons.length) return { doing: "Getting icons", done: "Got icons" };
      return { doing: "Looking at the ready-made parts", done: "Looked at the ready-made parts" };
    case "hand_to_builder":
      return { doing: "Writing the plan", done: <>Handed the plan to {typeof i.to === "string" ? i.to : "the builder"}</> };
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
  const CANVAS = ["list_projects", "get_project", "get_project_material", "get_sketch", "hand_to_builder", ...EDITS];
  // When one model plans and another builds, each run of steps says whose it is.
  const model = parts.flatMap((p) => (p.type !== "text" && p.model ? [p.model] : []))[0];
  const planned = tools.some((p) => p.type === "tool" && p.name === "hand_to_builder");
  const compacted = parts.some((p) => p.type === "compact");
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
      planned ? "wrote the plan" : "",
      compacted ? "summarized the conversation" : "",
    ].filter(Boolean).join(", ") || "Thought it over";

  return (
    <div className={`steps ${active ? "live" : ""} ${expanded ? "expanded" : ""}`}>
      <div className={`steps-head ${active ? "" : "open"}`}>
        <div>
          <button className="steps-summary" onClick={() => setUserOpen(!expanded)} aria-expanded={expanded}>
            {refs.length > 0 && <Thumbs ids={refs.slice(0, 5)} ctx={ctx} />}
            <span>{summary.charAt(0).toUpperCase() + summary.slice(1)}{refs.length ? ` · ${refs.length} saves` : ""}</span>
            {model && <span className="steps-model">{model}</span>}
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
        {part.type === "tool" && !done && (part.name === "make_sketch" || part.name === "edit_sketch") && <LiveDraft id={part.id} />}
        {part.type === "tool" && part.name === "hand_to_builder" && typeof part.input?.plan === "string" && <div className="step-plan">{part.input.plan}</div>}
      </div>
    </div>
  );
}

/**
 * The draft as a still picture: every animation and transition jumped to its end. Each new
 * draft is a fresh page, so a sketch whose words fade or slide in would otherwise play its
 * entrance again a few times a second, and the preview would flicker.
 */
const STILL = "<style data-panel-still>*,*::before,*::after{animation-delay:-1ms!important;animation-duration:1ms!important;animation-iteration-count:1!important;animation-fill-mode:both!important;transition:none!important;scroll-behavior:auto!important}</style>";
function still(doc: string) {
  // The designer's fonts too, as a served sketch gets them, so the draft is set in the right type.
  const add = STILL + draftFonts;
  return /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (h) => h + add) : add + doc;
}
let draftFonts = "";
let draftFontsAt = 0;
function loadDraftFonts() {
  if (Date.now() - draftFontsAt < 10_000) return;
  draftFontsAt = Date.now();
  fontApi
    .list()
    .then((l) => {
      const faces = l.flatMap((f) => f.faces).map((f) => `@font-face{font-family:"${f.family}";src:url("${f.url}");font-weight:${f.weight};font-style:${f.italic ? "italic" : "normal"}}`);
      draftFonts = faces.length ? `<style data-panel-fonts>${faces.join("")}</style>` : "";
    })
    .catch(() => {});
}

/**
 * A sketch taking shape while FRIDAY writes it: the page so far, small, under its step.
 * Two frames take turns, so each new draft is swapped in once it has loaded and the
 * picture never blinks. Scripts don't run here; the finished sketch on the canvas is the real one.
 */
function LiveDraft({ id }: { id: string }) {
  const html = useSyncExternalStore(watchDrafts, () => drafts.get(id));
  const wrap = useRef<HTMLDivElement>(null);
  const turn = useRef({ front: 0, busy: false, next: null as string | null });
  useEffect(loadDraftFonts, []);
  const show = useCallback((doc: string) => {
    const t = turn.current;
    const frames = wrap.current?.querySelectorAll("iframe");
    if (!frames || frames.length < 2) return;
    if (t.busy) {
      t.next = doc;
      return;
    }
    t.busy = true;
    const back = frames[1 - t.front]!;
    const started = Date.now();
    let swapped = false;
    const swap = () => {
      if (swapped) return;
      swapped = true;
      frames[t.front]!.classList.remove("front");
      back.classList.add("front");
      t.front = 1 - t.front;
      // At most about one new picture a second: each one is a whole page laid out again.
      setTimeout(() => {
        t.busy = false;
        const next = t.next;
        t.next = null;
        if (next) show(next);
      }, Math.max(0, 900 - (Date.now() - started)));
    };
    back.onload = () => {
      back.onload = null;
      // Swapped in only once its fonts are there, so the words don't jump from one font to
      // another each time (capped, for a font that never comes).
      const fonts = back.contentDocument?.fonts;
      if (!fonts) return swap();
      void fonts.ready.then(swap);
      setTimeout(swap, 1200);
    };
    back.srcdoc = still(doc);
  }, []);
  useEffect(() => {
    if (html) show(html);
  }, [html, show]);
  // The page is laid out at laptop width and scaled down to fit the panel.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--s", String(el.clientWidth / 1440));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!html]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!html) return null;
  return (
    <div className="draft" ref={wrap} aria-hidden>
      {/* No scripts run here at all (no allow-scripts), so the page can't reach Panel; same origin only lets Panel see when its fonts have loaded. */}
      <iframe sandbox="allow-same-origin" tabIndex={-1} title="" />
      <iframe sandbox="allow-same-origin" tabIndex={-1} title="" />
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

/** A time in seconds as people say it: "45s", then "10m 46s", then "1h 5m". */
function duration(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Seconds since it started thinking, ticking. */
function Seconds() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, []);
  return s >= 2 ? <span className="step-secs"> {duration(s)}</span> : null;
}

// ---------- Composer ----------

/** The words after an @ being typed, up to the caret: "@inter", "@swiss poster". */
/** The designer's font families for the @ list, asked for again at most every few seconds. */
let fontNames: { at: number; list: Promise<string[]> } | null = null;
function fontFamilies() {
  if (!fontNames || Date.now() - fontNames.at > 5000)
    fontNames = { at: Date.now(), list: fontApi.list().then((l) => l.map((f) => f.family)).catch(() => []) };
  return fontNames.list;
}

/** The designer's brand assets, asked for again at most every few seconds. The last list is kept for chips. */
let brandNow: { at: number; list: Promise<BrandAsset[]> } | null = null;
let brandSeen: BrandAsset[] = [];
function brandAssets() {
  if (!brandNow || Date.now() - brandNow.at > 5000)
    brandNow = {
      at: Date.now(),
      list: brandApi.list().then((l) => (brandSeen = l)).catch(() => brandSeen),
    };
  return brandNow.list;
}
/** A logo made for dark grounds ("logo white", "inverse") shows on dark; any other on light, like it's checked. */
const onDark = (name: string) => (/white|inverse|negative|reversed|бел/i.test(name) ? "on-dark" : "on-light");
/** A brand kit's group key ("none" for no project) and the name it goes by. */
const kitName = (a: { project_id: string | null; project_name: string | null }) => (a.project_id ? a.project_name ?? "Project" : "Not in a project");
const kitLabel = (name: string, pid: string) => (pid === "none" ? "Brand assets not in a project" : `${name} brand kit`);

/** One brand asset, or a project's whole kit, in a message: its picture and name; a click opens it on the brand page. */
function BrandChip({ id, kit, onOpen }: { id: string; kit: boolean; onOpen?: (focus: string) => void }) {
  const [list, setList] = useState(brandSeen);
  useEffect(() => {
    let live = true;
    void brandAssets().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  const asset = kit ? null : list.find((a) => a.id === id);
  const inKit = kit ? list.filter((a) => (a.project_id ?? "none") === id) : [];
  const cover = asset?.thumb_url ?? inKit.find((a) => a.kind === "logo" && a.thumb_url)?.thumb_url ?? inKit.find((a) => a.thumb_url)?.thumb_url;
  const title = asset ? asset.name : inKit.length ? kitLabel(kitName(inKit[0]!), id) : kit ? "Brand kit" : "Brand asset";
  return (
    <button className="ref-chip brand-chip" title={asset ? `${BRAND_KIND_LABEL[asset.kind].replace(/s$/, "")} · ${asset.format.toUpperCase()}` : `${inKit.length} brand assets`} onClick={() => onOpen?.(asset?.id ?? id)}>
      <span className="ref-chip-thumb">{cover ? <img src={cover} alt="" draggable={false} className={onDark(asset?.name ?? "")} /> : <Icon name="brand" size={12} />}</span>
      <span className="ref-chip-title">{title}</span>
    </button>
  );
}

/** The designer's collections that have something in them, asked for again at most every few seconds. */
let collectionsNow: { at: number; list: Promise<Collection[]> } | null = null;
function collectionList() {
  if (!collectionsNow || Date.now() - collectionsNow.at > 5000)
    collectionsNow = { at: Date.now(), list: api.collections().then((l) => l.filter((c) => c.n > 0)).catch(() => []) };
  return collectionsNow.list;
}

/**
 * Where the @ list is. It opens on the kinds of things you can mention (fonts, saves,
 * websites…); choosing one opens its list. Collections open once more, onto their saves.
 */
type Shelf = "fonts" | "brand" | "saves" | "sites" | "videos" | "favorites" | "collections" | { collection: string; name: string };
const SHELVES: { shelf: Exclude<Shelf, object>; label: string; icon: IconName }[] = [
  { shelf: "fonts", label: "Fonts", icon: "type" },
  { shelf: "brand", label: "Brand assets", icon: "brand" },
  { shelf: "saves", label: "Saves", icon: "grid" },
  { shelf: "sites", label: "Websites", icon: "monitor" },
  { shelf: "videos", label: "Videos", icon: "play" },
  { shelf: "favorites", label: "Favorites", icon: "heart" },
  { shelf: "collections", label: "Collections", icon: "folder" },
];
const shelfKey = (s: Shelf | null) => (s === null ? "" : typeof s === "string" ? s : `c:${s.collection}`);
const shelfName = (s: Shelf) => (typeof s === "string" ? SHELVES.find((x) => x.shelf === s)!.label : s.name);

/** A shelf's saves: the newest first, or the best matches for what's typed. */
function shelfSaves(s: Exclude<Shelf, "fonts" | "brand" | "collections">, q: string) {
  const f: Filters = { q: q || undefined, limit: 40 };
  if (typeof s === "object") f.collection = s.collection;
  else {
    f.library = true;
    if (s === "sites") f.site = true;
    if (s === "videos") f.type = "video";
    if (s === "favorites") f.favorite = true;
  }
  return api.refs(f);
}

/**
 * A row in the @ list: a kind of thing to open, one of the designer's fonts, or a save.
 * `group` names the run of rows it starts, when what's typed is looked for everywhere.
 */
type Mentionable = { group?: string } & (
  | { shelf: Shelf; label: string; icon: IconName; count?: number; cover?: string | null }
  | { font: string }
  | { card: RefCard }
  | { asset: BrandAsset }
  | { kit: string; name: string; count: number; cover: string | null }
);

/**
 * Brand assets as rows of the @ list, grouped by project and then by kind ("Navtech · Logos"),
 * each project starting with its whole kit. Narrowed by what's typed (name, project, kind, format).
 */
function brandRows(list: BrandAsset[], q: string): Mentionable[] {
  const has = (a: BrandAsset) => !q || [a.name, a.project_name ?? "", BRAND_KIND_LABEL[a.kind], a.format, a.original_name].some((t) => t.toLowerCase().includes(q));
  const rows: Mentionable[] = [];
  const groups = new Map<string, BrandAsset[]>();
  for (const a of list) (groups.get(a.project_id ?? "none") ?? groups.set(a.project_id ?? "none", []).get(a.project_id ?? "none")!).push(a);
  for (const [pid, all] of groups) {
    const name = kitName(all[0]!);
    const shown = all.filter(has);
    if (!shown.length) continue;
    if (all.length > 1 && (!q || name.toLowerCase().includes(q)))
      rows.push({ kit: pid, name, count: all.length, cover: all.find((a) => a.kind === "logo" && a.thumb_url)?.thumb_url ?? null, group: name });
    for (const a of shown) rows.push({ asset: a, group: `${name} · ${BRAND_KIND_LABEL[a.kind]}` });
  }
  return rows;
}
const collectionRow = (c: Collection, group?: string): Mentionable => ({
  shelf: { collection: c.id, name: c.name },
  label: c.name,
  icon: "folder",
  count: c.n,
  cover: c.cover,
  group,
});
const rowKey = (item: Mentionable) =>
  "shelf" in item ? `shelf:${shelfKey(item.shelf)}` : "font" in item ? `font:${item.font}` : "asset" in item ? `brand:${item.asset.id}` : "kit" in item ? `kit:${item.kit}` : item.card.id;

const MENTION_AT = /(?:^|\s)@((?:[^\s@]+ ?){0,4})$/;
const labelFor = (c: RefCard) => {
  const t = c.title.replace(/\s+/g, " ").trim();
  return t.length > 36 ? `${t.slice(0, 35).trimEnd()}…` : t || "Untitled";
};

/** A file in the composer: going up (no id yet), there (id), or turned away (failed). */
type Attached = { key: string; name: string; picture: boolean; preview: string | null; id?: string; failed?: string };
/** As many as the server takes with one message. */
const MAX_ATTACHED = 10;

function Composer(props: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (v: string) => void;
  running: boolean;
  onSend: (text: string, files: ChatFileNote[]) => void;
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
  use: ContextUse | null;
}) {
  const { value, running, context } = props;
  // Saves mentioned with @, by the label written in the text ("@Swiss poster").
  const mentions = useRef(new Map<string, RefCard>());
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [found, setFound] = useState<Mentionable[]>([]);
  // Which shelf and words the rows in `found` are for, to tell "nothing here" from "still looking".
  const [foundFor, setFoundFor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Fonts mentioned with @. They stay as "@Söhne" in what's sent: Panel knows its fonts by name.
  const fontMentions = useRef(new Set<string>());
  // Brand assets (and whole kits) mentioned with @, by their label; they travel as [[brand:id]] / [[brandkit:id]].
  const brandMentions = useRef(new Map<string, { token: string; thumb: string | null }>());
  const [pick, setPick] = useState(0);
  // While the mic listens, the box says so; the words come in when the designer stops it.
  const [listening, setListening] = useState(false);
  // Esc closes the list until the next @.
  const dismissed = useRef<number | null>(null);

  // Files attached to this message: pictures FRIDAY looks at, documents it reads. Each goes up
  // as soon as it's added (so sending doesn't wait), and shows faded until it's there.
  const [files, setFiles] = useState<Attached[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Taken out while still going up: removed from the server too once it arrives.
  const takenOut = useRef(new Set<string>());
  const attach = (list: File[]) => {
    const room = MAX_ATTACHED - files.length;
    if (!list.length || room <= 0) return;
    const fresh = list.slice(0, room).map((file) => {
      const pic = /^image\/(png|jpe?g|gif|webp|avif)$/.test(file.type);
      return { file, a: { key: `f${Math.random().toString(36).slice(2)}`, name: file.name, picture: pic, preview: pic ? URL.createObjectURL(file) : null } as Attached };
    });
    setFiles((fs) => [...fs, ...fresh.map((x) => x.a)]);
    for (const { file, a } of fresh) {
      chatApi
        .attach([file])
        .then((r) => {
          const got = r.added[0];
          if (takenOut.current.has(a.key)) {
            if (got) void chatApi.unattach(got.id).catch(() => {});
            return;
          }
          setFiles((fs) => fs.map((x) => (x.key !== a.key ? x : got ? { ...x, id: got.id, name: got.name, picture: got.picture, preview: x.preview ?? got.thumb_url } : { ...x, failed: r.failed[0] ?? "Couldn't attach this." })));
        })
        .catch((e) => setFiles((fs) => fs.map((x) => (x.key === a.key ? { ...x, failed: (e as Error).message } : x))));
    }
    requestAnimationFrame(() => props.inputRef.current?.focus());
  };
  const takeOut = (key: string) => {
    const f = files.find((x) => x.key === key);
    if (!f) return;
    if (f.preview?.startsWith("blob:")) URL.revokeObjectURL(f.preview);
    if (f.id) void chatApi.unattach(f.id).catch(() => {});
    else takenOut.current.add(key);
    setFiles((fs) => fs.filter((x) => x.key !== key));
  };
  const goingUp = files.some((f) => !f.id && !f.failed);
  const ready = files.filter((f) => f.id);

  // Grows with what you write, up to a point, then scrolls.
  useLayoutEffect(() => {
    const el = props.inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value, props.inputRef]);
  // And again when its width changes: measured while FRIDAY's panel was still opening (or after
  // the panel is resized), the words wrap differently and the box would stay too tall or too short.
  useEffect(() => {
    const el = props.inputRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.style.height = "0px";
      el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [props.inputRef]);

  /** Is an @ being typed at the caret? */
  const look = (text: string, caret: number) => {
    const m = text.slice(0, caret).match(MENTION_AT);
    if (!m) {
      dismissed.current = null;
      return setPicker(null);
    }
    const start = caret - m[1]!.length - 1;
    // Just after a mention already made ("@Swiss poster |"): that's not a new one.
    if (dismissed.current === start || [...mentions.current.keys(), ...fontMentions.current, ...brandMentions.current.keys()].some((l) => m[1]!.startsWith(l))) return setPicker(null);
    setPicker((p) => (p?.start === start && p.query === m[1] ? p : { query: m[1]!, start }));
  };

  // A new @ starts again from the kinds of things.
  const startAt = picker?.start ?? null;
  useEffect(() => setShelf(null), [startAt]);

  // The rows. Nothing typed on the first page: the kinds of things. Something typed there: matching
  // fonts, collections and saves, each under its name. Inside a kind: its own rows, narrowed by what's typed.
  const query = picker?.query.trim() ?? null;
  const key = shelfKey(shelf);
  const lookingFor = `${key}|${query ?? ""}`;
  useEffect(() => {
    if (query === null) return;
    let live = true;
    const q = query.toLowerCase();
    const has = (name: string) => !q || name.toLowerCase().includes(q);
    const rowsFor = async (): Promise<Mentionable[]> => {
      if (shelf === null && !q) {
        const [fonts, cols, brand] = await Promise.all([fontFamilies(), collectionList(), brandAssets()]);
        return SHELVES.filter((s) => (s.shelf !== "fonts" || fonts.length) && (s.shelf !== "collections" || cols.length) && (s.shelf !== "brand" || brand.length)).map((s) => ({
          ...s,
          count: s.shelf === "fonts" ? fonts.length : s.shelf === "collections" ? cols.length : s.shelf === "brand" ? brand.length : undefined,
        }));
      }
      if (shelf === null) {
        const [fonts, cols, brand, saves] = await Promise.all([fontFamilies(), collectionList(), brandAssets(), api.refs({ q: query, library: true, limit: 7 }).catch(() => [])]);
        return [
          ...fonts.filter(has).slice(0, 4).map((font) => ({ font, group: "Fonts" })),
          ...brandRows(brand, q).slice(0, 4).map((r) => ({ ...r, group: "Brand assets" })),
          ...cols.filter((c) => has(c.name)).slice(0, 3).map((c) => collectionRow(c, "Collections")),
          ...saves.map((r) => ({ card: cardFromRef(r), group: "Saves" })),
        ];
      }
      if (shelf === "fonts") return (await fontFamilies()).filter(has).map((font) => ({ font }));
      if (shelf === "brand") return brandRows(await brandAssets(), q);
      if (shelf === "collections") return (await collectionList()).filter((c) => has(c.name)).map((c) => collectionRow(c));
      return (await shelfSaves(shelf, query)).map((r) => ({ card: cardFromRef(r) }));
    };
    const t = setTimeout(() => {
      rowsFor()
        .catch(() => [])
        .then((rows) => {
          if (!live) return;
          setFound(rows);
          setFoundFor(lookingFor);
          setPick(0);
        });
    }, query ? 110 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // The shelf is followed by its key, which changes exactly when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, key]);
  // Inside a kind the list stays open even when nothing's there, so the way back stays in reach.
  const open = !!picker && (shelf !== null || found.length > 0);
  // Rows from the page you just left aren't shown under the new page's name while its own load.
  const rows = foundFor?.startsWith(`${key}|`) ? found : [];

  // The row chosen with the arrows stays in view as the list scrolls.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".mention-row.on")?.scrollIntoView({ block: "nearest" });
  }, [pick]);

  /** Opens a kind of thing. What was typed was for the page before, so it goes. */
  const enter = (s: Shelf) => {
    if (!picker) return;
    if (picker.query) {
      const el = props.inputRef.current;
      const caret = el?.selectionStart ?? value.length;
      const at = picker.start + 1;
      props.setValue(`${value.slice(0, at)}${value.slice(caret)}`);
      setPicker({ query: "", start: picker.start });
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at, at);
      });
    }
    setShelf(s);
    setPick(0);
  };
  /** One page back: from a collection to the collections, from anything else to the first page. */
  const back = () => {
    setShelf((s) => (s !== null && typeof s === "object" ? "collections" : null));
    setPick(0);
  };

  const choose = (item: Mentionable) => {
    if (!picker) return;
    if ("shelf" in item) return enter(item.shelf);
    let label: string;
    if ("font" in item) {
      label = item.font;
      fontMentions.current.add(label);
    } else if ("asset" in item || "kit" in item) {
      const token = "asset" in item ? `[[brand:${item.asset.id}]]` : `[[brandkit:${item.kit}]]`;
      const base = "asset" in item ? item.asset.name : kitLabel(item.name, item.kit);
      label = base;
      // Two with the same name stay apart.
      for (let n = 2; brandMentions.current.has(label) && brandMentions.current.get(label)!.token !== token; n++) label = `${base} (${n})`;
      brandMentions.current.set(label, { token, thumb: "asset" in item ? item.asset.thumb_url : item.cover });
    } else {
      label = mentionSave(item.card);
    }
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

  /** A save picked from the list: its label in the text, the save behind it. */
  const mentionSave = (c: RefCard) => {
    let label = labelFor(c);
    // Two saves with the same name stay apart.
    for (let n = 2; mentions.current.has(label) && mentions.current.get(label)!.id !== c.id; n++) label = `${labelFor(c)} (${n})`;
    mentions.current.set(label, c);
    props.onMention(c);
    return label;
  };

  /** What's sent: each mention as [[id]], which Claude reads as that save. */
  const resolve = (text: string) => {
    let out = text;
    // Longest first, so "@Poster (2)" isn't taken for "@Poster".
    const all: [string, string][] = [...[...mentions.current].map(([label, c]) => [label, `[[${c.id}]]`] as [string, string]), ...[...brandMentions.current].map(([label, b]) => [label, b.token] as [string, string])];
    for (const [label, token] of all.sort((a, b) => b[0].length - a[0].length)) out = out.split(`@${label}`).join(token);
    return out;
  };
  const mentioned = [...mentions.current].filter(([label]) => value.includes(`@${label}`));
  const fontsMentioned = [...fontMentions.current].filter((f) => value.includes(`@${f}`));
  const brandMentioned = [...brandMentions.current].filter(([label]) => value.includes(`@${label}`));
  const can = (!!value.trim() || ready.length > 0) && !goingUp;
  const send = () => {
    if (running || !can) return;
    const text = resolve(value);
    mentions.current.clear();
    fontMentions.current.clear();
    brandMentions.current.clear();
    setPicker(null);
    props.onSend(text, ready.map((f) => ({ id: f.id!, name: f.name, picture: f.picture })));
    for (const f of files) if (f.preview?.startsWith("blob:")) URL.revokeObjectURL(f.preview);
    setFiles([]);
  };

  // Typing a command: "/" offers /compact (the one command FRIDAY takes), Tab or ↵ fills it in.
  const command = /^\/[a-z]*$/i.test(value) && "/compact".startsWith(value.toLowerCase()) && value.toLowerCase() !== "/compact";
  const thumb = context ? context.media[0]?.thumb_url ?? context.preview_url ?? context.avatar_url : null;
  return (
    <div
      className={`composer ${running ? "working" : ""} ${can ? "has-text" : ""} ${dragging ? "dropping" : ""}`}
      // Files dropped on the composer are attached (not saved to the library, not placed on the canvas).
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        attach([...e.dataTransfer.files]);
      }}
    >
      {command && !open && (
        <div className="mention-pick" role="listbox" aria-label="Commands">
          <button
            role="option"
            aria-selected
            className="mention-row on command-row"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.setValue("/compact ")}
          >
            <span className="mention-title"><b>/compact</b> <span className="faint">Summarize the conversation so far to make room. Add what to keep after it, or send as is.</span></span>
          </button>
        </div>
      )}
      {open && (
        <div className="mention-pick" role="listbox" aria-label="Mention" ref={listRef}>
          {shelf !== null ? (
            <button className="mention-head mention-back" onMouseDown={(e) => e.preventDefault()} onClick={back}>
              <Icon name="chevron-left" size={12} />
              {shelfName(shelf)}
            </button>
          ) : (
            !query && <div className="mention-head">Mention</div>
          )}
          {rows.map((item, i) => (
            <Fragment key={rowKey(item)}>
              {item.group && item.group !== rows[i - 1]?.group && <div className="mention-head">{item.group}</div>}
              <button
                role="option"
                aria-selected={i === pick}
                className={`mention-row ${i === pick ? "on" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
                onMouseEnter={() => setPick(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                {"shelf" in item ? (
                  <>
                    <span className={`mention-thumb ${item.cover ? "" : "mention-glyph"}`}>
                      {item.cover ? <img src={item.cover} alt="" /> : <Icon name={item.icon} size={15} />}
                    </span>
                    <span className="mention-title">{item.label}</span>
                    {item.count !== undefined && <span className="mention-count">{item.count}</span>}
                    <span className="mention-go" aria-hidden>
                      <Icon name="chevron-right" size={13} />
                    </span>
                  </>
                ) : "font" in item ? (
                  <>
                    <span className="mention-thumb mention-glyph mention-font" aria-hidden>Aa</span>
                    <span className="mention-title">{item.font}</span>
                  </>
                ) : "asset" in item ? (
                  <>
                    <span className={`mention-thumb mention-brand ${item.asset.thumb_url ? onDark(item.asset.name) : "mention-glyph"}`}>
                      {item.asset.thumb_url ? <img src={item.asset.thumb_url} alt="" /> : <Icon name="file" size={14} />}
                    </span>
                    <span className="mention-title">{item.asset.name}</span>
                    <span className="mention-type">{item.asset.format.toUpperCase()}</span>
                  </>
                ) : "kit" in item ? (
                  <>
                    <span className={`mention-thumb mention-brand ${item.cover ? "on-light" : "mention-glyph"}`}>
                      {item.cover ? <img src={item.cover} alt="" /> : <Icon name="brand" size={15} />}
                    </span>
                    {/* Under its project's own heading it's just "the whole kit"; among other things, it says whose. */}
                    <span className="mention-title">{item.group === item.name ? "The whole kit" : kitLabel(item.name, item.kit)}</span>
                    <span className="mention-count">{item.count}</span>
                  </>
                ) : (
                  <>
                    <span className="mention-thumb">{item.card.thumb && <img src={item.card.thumb} alt="" />}</span>
                    <span className="mention-title">{item.card.title}</span>
                    <span className="mention-type">{item.card.type}</span>
                  </>
                )}
              </button>
            </Fragment>
          ))}
          {found.length === 0 && foundFor === lookingFor && <div className="mention-empty">{query ? "Nothing matches" : "Nothing here yet"}</div>}
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
            <span className="faint">{props.picked.point ? "In the sketch" : "On the canvas"}</span> {props.picked.label}
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
      {(mentioned.length > 0 || fontsMentioned.length > 0 || brandMentioned.length > 0) && (
        <div className="composer-mentions">
          {brandMentioned.map(([label, b]) => (
            <span key={`brand:${label}`} className="composer-mention" title={b.token.startsWith("[[brandkit") ? "A brand kit" : "A brand asset"}>
              {b.thumb ? <img src={b.thumb} alt="" className={`brand-mention-img ${onDark(label)}`} /> : <Icon name="brand" size={12} />}
              <span>{label}</span>
            </span>
          ))}
          {fontsMentioned.map((f) => (
            <span key={`font:${f}`} className="composer-mention" title="Your font">
              <Icon name="type" size={12} />
              <span>{f}</span>
            </span>
          ))}
          {mentioned.map(([label, c]) => (
            <span key={label} className="composer-mention" title={c.title}>
              {c.thumb && <img src={c.thumb} alt="" />}
              <span>{label}</span>
            </span>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="composer-files">
          {files.map((f) => {
            const pic = !!f.preview && !f.failed;
            return (
              <span
                key={f.key}
                className={`composer-file ${pic ? "pic" : ""} ${!f.id && !f.failed ? "going-up" : ""} ${f.failed ? "failed" : ""}`}
                title={f.failed ?? f.name}
              >
                {pic ? (
                  <img src={f.preview!} alt={f.name} />
                ) : (
                  <>
                    <Icon name={f.failed ? "alert" : f.picture ? "image" : "file"} size={13} />
                    <span>{f.failed ? `${f.name}: ${f.failed}` : f.name}</span>
                  </>
                )}
                <button onClick={() => takeOut(f.key)} aria-label={`Remove ${f.name}`} title="Remove">
                  <Icon name="x" size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={props.inputRef}
          value={value}
          rows={1}
          // Short enough for one line in the narrowest panel.
          placeholder={listening ? "Listening… click the mic when you're done" : props.quote ? "Reply to this" : props.picked ? (props.picked.point ? "What should change here?" : props.picked.nodes.length === 1 ? "Ask about this" : "Ask about these") : context ? "Ask about this · @ to mention" : "Ask anything · @ to mention"}
          onChange={(e) => {
            props.setValue(e.target.value);
            look(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => look(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setPicker(null)}
          onPaste={(e) => {
            // A screenshot or copied files: attached. Words paste as usual.
            const pasted = [...e.clipboardData.files];
            if (!pasted.length) return;
            e.preventDefault();
            attach(pasted.map((f) => (/^image\.\w+$/.test(f.name) ? new File([f], `Pasted picture.${f.name.split(".").pop()}`, { type: f.type }) : f)));
          }}
          onKeyDown={(e) => {
            if (open) {
              const row = rows[pick] ?? rows[0];
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (rows.length) setPick((i) => (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (row) choose(row);
                return;
              }
              // → opens the kind of thing chosen; ← or ⌫ with nothing typed goes back a page.
              if (e.key === "ArrowRight" && row && "shelf" in row) {
                e.preventDefault();
                enter(row.shelf);
                return;
              }
              if ((e.key === "ArrowLeft" || e.key === "Backspace") && shelf !== null && !picker!.query) {
                e.preventDefault();
                back();
                return;
              }
              // Esc goes back a page, and closes the list from the first one.
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (shelf !== null) return back();
                dismissed.current = picker!.start;
                setPicker(null);
                return;
              }
            }
            if (command && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
              e.preventDefault();
              props.setValue("/compact ");
              return;
            }
            // ↑ in an empty composer brings back what you last asked, to change it.
            if (e.key === "ArrowUp" && !value && props.lastAsked) {
              e.preventDefault();
              const again = props.lastAsked
                .replace(/\[\[([0-9a-f]{16})\]\]/g, (all, id: string) => {
                  const c = props.cards.get(id);
                  if (!c) return all;
                  mentions.current.set(labelFor(c), c);
                  return `@${labelFor(c)}`;
                })
                .replace(/\[\[(brand|brandkit):([0-9a-f]{16}|none)\]\]/g, (all, which: string, id: string) => {
                  const a = which === "brand" ? brandSeen.find((x) => x.id === id) : brandSeen.find((x) => (x.project_id ?? "none") === id);
                  if (!a) return all;
                  const label = which === "brand" ? a.name : kitLabel(kitName(a), id);
                  brandMentions.current.set(label, { token: all, thumb: a.thumb_url });
                  return `@${label}`;
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
      </div>
      {/* Its own row under the words, so a narrow panel never squeezes what you're writing. */}
      <div className="composer-foot">
        <span className="composer-left">
          <ContextMeter use={props.use} running={running} onCompact={() => props.onSend("/compact", [])} />
          <ModelPicker />
        </span>
        <span className="composer-actions">
          <button
            className="composer-btn attach"
            onClick={() => filePicker.current?.click()}
            disabled={files.length >= MAX_ATTACHED}
            aria-label="Attach pictures or files"
            title="Attach pictures or files (or paste, or drop them here)"
          >
            <Icon name="paperclip" size={15} />
          </button>
          <input
            ref={filePicker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              attach([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <MicButton value={value} setValue={props.setValue} inputRef={props.inputRef} onListening={setListening} />
          {running ? (
            <button className="composer-btn stop" key="stop" onClick={props.onStop} aria-label="Stop" title="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button className="composer-btn send" key="send" onClick={send} disabled={!can} aria-label="Send" title="Send (↵)">
              <Icon name="arrow-up" size={15} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
