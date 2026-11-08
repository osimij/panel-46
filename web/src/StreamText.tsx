// The assistant's answer as it arrives. A small markdown reader written for streaming:
// every word is its own element keyed by where it sits in the text, so as the text grows
// only the new words mount, and only they play the blur-in. Saves written as [[id]] become
// the save's name with its thumbnail, a line of them becomes a row of pictures, and hex
// colors get a swatch you can click to copy.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion, type RefCard } from "./api.ts";

export type OpenRef = (id: string) => void;

/** While you point at a save in an answer, its card in the grid lights up (if it's showing). */
export function highlight(id: string | null, on: boolean) {
  // Only one at a time, and none left behind when the pointer leaves some other way.
  for (const el of document.querySelectorAll(".ask-lit")) el.classList.remove("ask-lit");
  if (on && id) for (const el of document.querySelectorAll<HTMLElement>(`.masonry [data-ref="${id}"]`)) el.classList.add("ask-lit");
}

interface Ctx {
  cards: Map<string, RefCard>;
  onOpen: OpenRef;
}

const REF = /\[\[([0-9a-f]{16})\]\]/g;

// ---------- Pacing: text arrives in bursts; it's shown at an even, readable pace ----------

/**
 * The part of `target` to show right now. With `animate` (an answer that was arriving
 * when it appeared), it catches up with what has arrived at a pace that follows the
 * backlog (a burst reveals faster), always ending on a word boundary, and keeps going
 * after the stream ends until everything is shown. Without it, all of it at once.
 */
export function useSmoothText(target: string, animate: boolean, streaming: boolean) {
  const reduced = prefersReducedMotion();
  const [shown, setShown] = useState(animate && !reduced ? 0 : Infinity);
  const pos = useRef(0);
  const tgt = useRef(target);
  tgt.current = target;

  useEffect(() => {
    if (!animate || reduced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last) / 16.7;
      last = now;
      const text = tgt.current;
      const backlog = text.length - pos.current;
      if (backlog > 0) {
        // About 45 characters a second at rest, faster the more is waiting.
        let next = pos.current + Math.max(0.75, backlog * 0.07) * dt;
        // Finish the word in progress, so a word never shows half-typed.
        const i = Math.floor(next);
        const space = text.slice(i).search(/\s/);
        if (space >= 0 && space < 14) next = i + space;
        else if (space < 0 && text.length - i < 14) next = text.length;
        pos.current = Math.min(text.length, next);
        setShown(Math.floor(pos.current));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, reduced]);

  const text = target.slice(0, shown);
  return { text, live: streaming || text.length < target.length };
}

// ---------- Parsing ----------

type Block =
  | { kind: "p"; start: number; text: string }
  | { kind: "h"; start: number; text: string }
  | { kind: "list"; start: number; ordered: boolean; items: { start: number; text: string }[] }
  | { kind: "gallery"; start: number; ids: string[] };

const onlyRefs = (line: string) => {
  const ids = [...line.matchAll(REF)].map((m) => m[1]!);
  return ids.length && !line.replace(REF, "").replace(/[\s,·•|-]/g, "") ? ids : null;
};

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let offset = 0;
  let para: { start: number; lines: string[] } | null = null;
  let list: Extract<Block, { kind: "list" }> | null = null;
  const flush = () => {
    if (para) blocks.push({ kind: "p", start: para.start, text: para.lines.join("\n") });
    para = null;
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const line of text.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      endList();
      continue;
    }
    const ids = onlyRefs(trimmed);
    if (ids) {
      flush();
      endList();
      blocks.push({ kind: "gallery", start, ids });
      continue;
    }
    const h = trimmed.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      flush();
      endList();
      blocks.push({ kind: "h", start: start + line.indexOf(h[1]!), text: h[1]! });
      continue;
    }
    const li = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]!);
      if (!list || list.ordered !== ordered) {
        endList();
        list = { kind: "list", start, ordered, items: [] };
      }
      list.items.push({ start: start + line.length - li[3]!.length, text: li[3]! });
      continue;
    }
    // A plain line right after a list item continues that item.
    if (list && /^\s{2,}/.test(line)) {
      const item = list.items.at(-1)!;
      item.text += ` ${trimmed}`;
      continue;
    }
    endList();
    if (!para) para = { start: start + line.indexOf(trimmed), lines: [] };
    para.lines.push(trimmed);
  }
  flush();
  endList();
  return blocks;
}

// ---------- Inline ----------

const INLINE = /\*\*([^*]+?)(?:\*\*|$)|\[\[([0-9a-f]{16})\]\]|`([^`]+)`?|(#[0-9a-fA-F]{6})(?![0-9a-zA-Z])|\[([^\]]+)\]\(([^)]*)\)?|(?<![*\w])\*([^*\s][^*]*?)\*(?!\*)/g;

/** Words as their own spans, keyed by position, so only new ones mount (and animate). */
function words(text: string, at: number): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\S+|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (/^\s/.test(m[0])) out.push(m[0].includes("\n") ? <br key={at + m.index} /> : m[0]);
    else out.push(<span className="w" key={at + m.index}>{m[0]}</span>);
  }
  return out;
}

function inline(text: string, at: number, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  // Its own copy: bold text is read by calling this again, which would reset a shared one.
  const re = new RegExp(INLINE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...words(text.slice(last, m.index), at + last));
    const k = at + m.index;
    if (m[1] !== undefined) out.push(<strong key={`b${k}`}>{inline(m[1], k + 2, ctx)}</strong>);
    else if (m[2]) out.push(<RefChip key={`r${k}`} id={m[2]} ctx={ctx} />);
    else if (m[3] !== undefined) out.push(<code key={`c${k}`} className="w">{m[3]}</code>);
    else if (m[4]) out.push(<Hex key={`x${k}`} hex={m[4]} />);
    else if (m[5] !== undefined) {
      const href = m[6] ?? "";
      const external = /^https?:\/\//.test(href) && !/127\.0\.0\.1|localhost/.test(href);
      out.push(
        external ? (
          <a key={`a${k}`} href={href} target="_blank" rel="noreferrer" className="rt-link">{words(m[5], k + 1)}</a>
        ) : (
          <span key={`a${k}`}>{words(m[5], k + 1)}</span>
        ),
      );
    } else if (m[7] !== undefined) out.push(<em key={`i${k}`}>{words(m[7], k + 1)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...words(text.slice(last), at + last));
  return out;
}

/** While streaming, a save token still being written ("[[3fa") isn't shown yet. */
const holdBack = (text: string) => text.replace(/\[\[?[0-9a-f]{0,15}\]?$/, "").replace(/\[\[[0-9a-f]{16}\]$/, "");

export function RichText({ text, live, ctx }: { text: string; live: boolean; ctx: Ctx }) {
  const blocks = parse(live ? holdBack(text) : text);
  return (
    <div className={`rt ${live ? "rt-live" : ""}`}>
      {blocks.map((b) => {
        switch (b.kind) {
          case "p": return <p key={`p${b.start}`}>{inline(b.text, b.start, ctx)}</p>;
          case "h": return <h3 key={`h${b.start}`}>{inline(b.text, b.start, ctx)}</h3>;
          case "gallery": return <Gallery key={`g${b.start}`} ids={b.ids} ctx={ctx} />;
          case "list": {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List key={`l${b.start}`}>
                {b.items.map((it) => <li key={it.start}>{inline(it.text, it.start, ctx)}</li>)}
              </List>
            );
          }
        }
      })}
    </div>
  );
}

// ---------- Saves, inline and in rows ----------

const short = (t: string, n = 34) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

function RefChip({ id, ctx }: { id: string; ctx: Ctx }) {
  const card = ctx.cards.get(id);
  const [peek, setPeek] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const el = useRef<HTMLButtonElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <button
        ref={el}
        className={`ref-chip ${card ? "" : "loading"}`}
        onClick={() => ctx.onOpen(id)}
        onMouseEnter={() => {
          clearTimeout(timer.current);
          highlight(id, true);
          timer.current = setTimeout(() => el.current && setPeek(el.current.getBoundingClientRect()), 280);
        }}
        onMouseLeave={() => {
          clearTimeout(timer.current);
          highlight(id, false);
          setPeek(null);
        }}
      >
        <span className="ref-chip-thumb">{card?.thumb && <img src={card.thumb} alt="" draggable={false} />}</span>
        <span className="ref-chip-title">{card ? short(card.title, 28) : "…"}</span>
      </button>
      {peek && card && <Peek card={card} at={peek} />}
    </>
  );
}

/** A bigger look at a save while hovering its name. */
function Peek({ card, at }: { card: RefCard; at: DOMRect }) {
  const w = 232;
  const h = Math.round(w * Math.min(card.ratio, 1.15));
  const below = at.top < h + 110;
  const left = Math.max(12, Math.min(at.left + at.width / 2 - w / 2, innerWidth - w - 12));
  return createPortal(
    <div className={`peek ${below ? "below" : ""}`} style={{ left, top: below ? at.bottom + 10 : at.top - 10, width: w }} aria-hidden>
      {card.thumb && <img src={card.thumb} alt="" style={{ height: h }} />}
      <div className="peek-body">
        <div className="peek-title">{card.title}</div>
        {card.palette.length > 0 && (
          <div className="peek-palette">
            {card.palette.map((c) => <i key={c} style={{ background: c }} />)}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Gallery({ ids, ctx, small }: { ids: string[]; ctx: Ctx; small?: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(measure, [ids.length]);
  return (
    <div className={`gallery-wrap ${edges.left ? "fade-l" : ""} ${edges.right ? "fade-r" : ""} ${small ? "small" : ""}`}>
      <div className="gallery" ref={row} onScroll={measure}>
        {ids.map((id, i) => {
          const c = ctx.cards.get(id);
          const h = small ? 64 : 132;
          const w = Math.round(h / Math.min(Math.max(c?.ratio ?? 0.75, 0.62), 1.45));
          return (
            <button
              key={id}
              className="gallery-card"
              style={{ animationDelay: `${Math.min(i, 8) * 55}ms`, width: w }}
              onClick={() => ctx.onOpen(id)}
              onMouseEnter={() => highlight(id, true)}
              onMouseLeave={() => highlight(id, false)}
              title={c?.title}
            >
              <span className="gallery-thumb" style={{ height: h, width: w }}>
                {c?.thumb && <img src={c.thumb} alt="" draggable={false} onLoad={(e) => e.currentTarget.classList.add("loaded")} />}
                {c?.type === "video" && <span className="gallery-badge">Video</span>}
              </span>
              {!small && <span className="gallery-title">{c ? short(c.title, 30) : ""}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Hex({ hex }: { hex: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`hex w ${copied ? "copied" : ""}`}
      onClick={() => {
        void navigator.clipboard?.writeText(hex.toUpperCase());
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      }}
      title="Copy"
    >
      <i style={{ background: hex }} />
      {copied ? "Copied" : hex.toUpperCase()}
    </button>
  );
}
