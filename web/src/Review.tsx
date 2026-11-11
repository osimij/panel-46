// Review: FRIDAY's suggestions on a canvas, one at a time and large, with one key each.
// On the canvas a suggestion is a small card among many; here its picture fills the room,
// with FRIDAY's why and the topic it's under beside it, so judging it is quick and the
// reason is right there. Every verdict goes through the canvas's own judge and reason, so
// undo, the live stream and folding behave exactly as they do on the canvas.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, prefersReducedMotion, type RefState } from "./api.ts";
import { Icon } from "./Icon.tsx";

/** One suggestion as Review shows it. The canvas works this out from its cards, live. */
export interface ReviewItem {
  id: string;
  kind: "ref" | "sketch";
  /** The save, for a ref: its large picture is fetched by it. */
  refId?: string;
  state: RefState;
  title: string;
  /** FRIDAY's why: what to take from a save, or what a sketch tries. */
  why?: string;
  /** The topic it's under, by name. */
  topic?: string;
  /** The small picture on its card, shown while the large one loads (a sketch has only this). */
  picture?: string;
  video?: boolean;
  palette: string[];
  /** Taken off the canvas since Review opened: skipped. */
  gone: boolean;
}

type Verdict = "kept" | "chosen" | "ruled_out";

interface Props {
  items: ReviewItem[];
  reasons: { chosen: string[]; ruled_out: string[] };
  judge: (id: string, state: Verdict) => void;
  giveReason: (text: string) => void;
  /** Take back the canvas's last change (⌘Z). */
  undo: () => void;
  open: (item: ReviewItem) => void;
  /** Something else has the keys for now (the studio, a save open in Detail). */
  paused: boolean;
  onClose: () => void;
}

/** The large picture of a save, fetched once and kept for the session. */
const large = new Map<string, Promise<string | null>>();
function largePicture(refId: string) {
  let p = large.get(refId);
  if (!p) {
    p = api.ref(refId).then(
      (r) => {
        const m = r.media.find((x) => x.status === "archived") ?? r.media[0];
        if (!m) return r.preview_url;
        // A video (and a GIF, which is kept as a video) shows its picture; the play mark says what it is.
        return m.type !== "image" ? m.thumb_url ?? r.preview_url : m.url ?? m.thumb_url;
      },
      () => null,
    );
    large.set(refId, p);
  }
  return p;
}

const VERDICT_WORD: Record<"chosen" | "ruled_out", string> = { chosen: "Chosen", ruled_out: "Ruled out" };

export function Review(props: Props) {
  const { items } = props;
  const firstLive = Math.max(0, items.findIndex((x) => !x.gone));
  const [index, setIndex] = useState(firstLive);
  /** After Choose or Rule out: the reasons, right there, until one is picked or Review moves on. */
  const [asking, setAsking] = useState<"chosen" | "ruled_out" | null>(null);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [closing, setClosing] = useState(false);
  /** What can be taken back: the card a verdict was given on, and how many changes it was (a reason is a second). */
  const history = useRef<{ index: number; steps: number }[]>([]);
  const item = items[index];
  const [pic, setPic] = useState<{ id: string; url: string | null } | null>(null);
  /** The picture that turned out to be a whole tall page. */
  const [tall, setTall] = useState<string | null>(null);

  // The large picture of this one, and the next one fetched ahead so moving on is instant.
  useEffect(() => {
    if (!item?.refId) return;
    let live = true;
    void largePicture(item.refId).then((url) => live && setPic({ id: item.id, url }));
    const next = items.slice(index + 1).find((x) => !x.gone && x.refId);
    if (next?.refId) void largePicture(next.refId).then((url) => url && (new Image().src = url));
    return () => {
      live = false;
    };
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (prefersReducedMotion()) return props.onClose();
    setClosing(true);
    setTimeout(props.onClose, 170);
  };

  /** On to the next one still on the canvas; past the last, the summary. */
  const advance = (from = index) => {
    setAsking(null);
    setText("");
    const next = items.findIndex((x, i) => i > from && !x.gone);
    if (next < 0) setDone(true);
    else setIndex(next);
  };
  const back = () => {
    const prev = items.map((x, i) => (i < index && !x.gone ? i : -1)).filter((i) => i >= 0).at(-1);
    if (prev === undefined) return;
    setAsking(null);
    setText("");
    setDone(false);
    setIndex(prev);
  };

  const verdict = (v: Verdict) => {
    if (!item || item.gone) return;
    props.judge(item.id, v);
    history.current.push({ index, steps: 1 });
    if (v === "kept") advance();
    else {
      setText("");
      setAsking(v);
    }
  };
  const reason = (r: string) => {
    if (!asking || !r.trim()) return;
    props.giveReason(r);
    const last = history.current.at(-1);
    if (last && last.index === index) last.steps = 2;
    advance();
  };
  const takeBack = () => {
    const last = history.current.pop();
    if (!last) return;
    for (let i = 0; i < last.steps; i++) props.undo();
    setAsking(null);
    setText("");
    setDone(false);
    setIndex(last.index);
  };

  // The summary stays a moment, then Review closes by itself.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(close, 2600);
    return () => clearTimeout(t);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // The keys: one per choice, shown on each button.
  const keys = useRef({ verdict, reason, advance, back, takeBack, close, open: () => item && props.open(item) });
  keys.current = { verdict, reason, advance, back, takeBack, close, open: () => item && props.open(item) };
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const doneRef = useRef(done);
  doneRef.current = done;
  const reasonsRef = useRef(props.reasons);
  reasonsRef.current = props.reasons;
  const pausedRef = useRef(props.paused);
  pausedRef.current = props.paused;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A save open in Detail, or a sketch in the studio, has the keys.
      if (pausedRef.current || document.querySelector(".detail")) return;
      const k = keys.current;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
        if ((e.target as Element).closest?.("input, textarea") && (e.target as HTMLInputElement).value) return;
        e.preventDefault();
        e.stopPropagation();
        return k.takeBack();
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const a = askingRef.current;
      if (doneRef.current) {
        if (key === "Escape" || key === "Enter" || key === " ") {
          e.preventDefault();
          k.close();
        }
        return;
      }
      let handled = true;
      if (a && /^[1-5]$/.test(key)) {
        const pick = reasonsRef.current[a][Number(key) - 1];
        if (pick) k.reason(pick);
      } else if (key === "k") a ? k.advance() : k.verdict("kept");
      else if (key === "c") a ? k.advance() : k.verdict("chosen");
      else if (key === "x") a ? k.advance() : k.verdict("ruled_out");
      else if (key === "ArrowRight" || key === " ") k.advance();
      else if (key === "ArrowLeft") k.back();
      else if (key === "o") k.open();
      else if (key === "Escape") k.close();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture, so the canvas and the app never see these keys while Review is open.
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  const counts = useMemo(() => {
    const live = items.filter((x) => !x.gone);
    const n = (s: RefState) => live.filter((x) => x.state === s).length;
    return [
      n("kept") && `${n("kept")} kept`,
      n("chosen") && `${n("chosen")} chosen`,
      n("ruled_out") && `${n("ruled_out")} ruled out`,
      n("proposed") && `${n("proposed")} still suggested`,
    ].filter(Boolean).join(" · ");
  }, [items]);

  const live = items.filter((x) => !x.gone);
  const at = live.indexOf(item!) + 1;
  const src = item?.refId ? (pic?.id === item.id && pic.url ? pic.url : item.picture) : item?.picture;

  return (
    <div className={`rv-sheet ${closing ? "closing" : ""}`} role="dialog" aria-label="Review suggestions">
      <div className="rv-frame">
        {done || !item ? (
          <div className="rv-end" role="status">
            <p className="rv-end-title">That's all of them</p>
            <p className="rv-end-text">{counts || "Nothing was judged"}</p>
            <button className="rv-btn solid" onClick={close}>Done</button>
          </div>
        ) : (
          <>
            <div className={`rv-stage ${tall === src ? "tall" : ""}`} key={item.id}>
              {src ? (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  // A whole web page is far taller than wide: fitted whole it would be a thin strip,
                  // so it takes the width instead and scrolls, still whole, never cropped.
                  onLoad={(e) => e.currentTarget.naturalHeight > e.currentTarget.naturalWidth * 2.2 && setTall(src)}
                />
              ) : <div className="rv-blank">No picture of this one</div>}
              {item.video && <span className="rv-play" aria-label="A video"><Icon name="play" size={14} /></span>}
            </div>
            <aside className="rv-side">
              <div className="rv-top">
                <span className="rv-count">{at} of {live.length}</span>
                <button className="rv-x" onClick={close} aria-label="Done" title="Done (Esc)"><Icon name="x" size={13} /></button>
              </div>
              <div className="rv-info" key={item.id}>
                <p className="rv-under">{item.topic ? `Under ${item.topic}` : "Not under a topic"}{item.kind === "sketch" ? " · a sketch" : ""}</p>
                {item.why && <p className="rv-why">{item.why}</p>}
                <p className="rv-title">{item.title}</p>
                {item.palette.length > 0 && (
                  <span className="rv-palette" aria-hidden>{item.palette.slice(0, 6).map((h) => <i key={h} style={{ background: h }} />)}</span>
                )}
                {item.state !== "proposed" && !asking && <p className="rv-state">{item.state === "kept" ? "Kept" : VERDICT_WORD[item.state]}</p>}
              </div>

              {asking ? (
                <div className="rv-ask" key={`ask-${item.id}`}>
                  <p className="rv-ask-what">{VERDICT_WORD[asking]} <span className="faint">· why?</span></p>
                  <div className="rv-reasons">
                    {props.reasons[asking].map((r, i) => (
                      <button key={r} className="rv-reason" onClick={() => reason(r)}>
                        <kbd>{i + 1}</kbd>{r}
                      </button>
                    ))}
                  </div>
                  <input
                    className="rv-input"
                    value={text}
                    placeholder="or in your words"
                    aria-label="Your reason"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && text.trim()) reason(text);
                      if (e.key === "Escape") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <button className="rv-btn quiet" onClick={() => advance()}>Next without a reason <kbd>→</kbd></button>
                </div>
              ) : (
                <div className="rv-choices">
                  <button className={`rv-btn ${item.state === "kept" ? "on" : ""}`} onClick={() => verdict("kept")}>Keep <kbd>K</kbd></button>
                  <button className={`rv-btn ${item.state === "chosen" ? "on" : ""}`} onClick={() => verdict("chosen")}>Choose <kbd>C</kbd></button>
                  <button className={`rv-btn ${item.state === "ruled_out" ? "on" : ""}`} onClick={() => verdict("ruled_out")}>Rule out <kbd>X</kbd></button>
                  <div className="rv-row">
                    <button className="rv-btn quiet" onClick={back} disabled={at <= 1}><kbd>←</kbd> Back</button>
                    <button className="rv-btn quiet" onClick={() => advance()}>Skip <kbd>→</kbd></button>
                  </div>
                  <button className="rv-btn quiet" onClick={() => props.open(item)}>
                    {item.kind === "sketch" ? "Open in the studio" : "Open the save"} <kbd>O</kbd>
                  </button>
                </div>
              )}
              <p className="rv-hint">⌘Z takes back the last one · Esc when done</p>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
