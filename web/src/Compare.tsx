// Directions side by side: two or three sketches of one family in the studio, on the same
// screen size, scrolled together and switched between their states together, so they can be
// judged against each other rather than from memory. Choose or rule out from here, or say
// what to take from which and FRIDAY makes the combination as a new sketch.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { STUDIO_PAGE, type Device, type SketchInfo } from "./api.ts";
import { Icon } from "./Icon.tsx";

type Member = SketchInfo["family"][number];
const SIZES: Record<Device, { w: number; h: number }> = { desktop: { w: 1440, h: 900 }, tablet: { w: 834, h: 1112 }, phone: { w: 390, h: 844 } };
const LETTERS = ["A", "B", "C"];
const pageOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.html?${STUDIO_PAGE}`;

export function Compare(props: {
  project: string;
  family: Member[];
  /** The sketch the studio has open: always the first column to begin with. */
  current: string;
  device: Device;
  running: boolean;
  patch: (id: string, data: Record<string, unknown>) => void;
  onOpen: (id: string) => void;
  onMix: (text: string, ids: string[]) => void;
}) {
  const { family, project, device } = props;
  // Start with the open sketch and the next one that hasn't been ruled out; a third can be added.
  const [ids, setIds] = useState<string[]>(() => {
    const rest = family.filter((f) => f.id !== props.current && f.state !== "ruled_out").map((f) => f.id);
    return [props.current, ...rest].slice(0, 2);
  });
  const shown = ids.map((id) => family.find((f) => f.id === id)).filter((f): f is Member => !!f);
  const toggle = (id: string) =>
    setIds((now) => (now.includes(id) ? (now.length > 2 ? now.filter((x) => x !== id) : now) : now.length < 3 ? [...now, id] : [...now.slice(0, 2), id]));

  // ---- Keeping the pages together: the same state, the same scroll ----
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const [state, setState] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data?.panel) return;
      const from = [...frames.current.entries()].find(([, f]) => f.contentWindow === e.source)?.[0];
      if (!from) return;
      const others = (m: Record<string, unknown>) => {
        for (const [id, f] of frames.current) if (id !== from) f.contentWindow?.postMessage({ panel: 1, ...m }, "*");
      };
      const m = e.data;
      if (m.t === "hello") {
        // A page that just loaded joins the others: follow along, and go to the state they're in.
        frames.current.get(from)?.contentWindow?.postMessage({ panel: 1, t: "follow", on: true }, "*");
        if (stateRef.current) frames.current.get(from)?.contentWindow?.postMessage({ panel: 1, t: "state", slug: stateRef.current }, "*");
      } else if (m.t === "scrolled") others({ t: "scroll", y: m.y });
      else if (m.t === "state") {
        const slug = String(m.state ?? "");
        if (slug !== stateRef.current) {
          setState(slug);
          others({ t: "state", slug });
        }
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  // ---- The room each page has ----
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 400, h: 600 });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const col = el.querySelector<HTMLElement>(".cmp-frame");
      if (col) setRoom({ w: col.clientWidth, h: col.clientHeight });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [shown.length]);
  const size = SIZES[device];
  const scale = device === "desktop" ? Math.min(1, room.w / size.w) : Math.min(1, room.w / size.w, room.h / size.h);
  // A laptop page gets a screen about as tall as a real one, however narrow its column:
  // a much taller one would stretch anything sized by the screen's height (a full-height hero).
  const frameH = device === "desktop" ? Math.min(Math.round(room.h / scale), 1200) : size.h;

  const [text, setText] = useState("");
  const mix = useCallback(() => {
    if (!text.trim() || props.running) return;
    props.onMix(text.trim(), ids);
    setText("");
  }, [text, ids, props]);

  return (
    <div className="st-main cmp">
      <div className="st-bar cmp-pick" role="group" aria-label="Which directions to compare">
        <Icon name="compare" size={13} />
        {family.map((f) => {
          const at = ids.indexOf(f.id);
          return (
            <button key={f.id} className={`cmp-chip ${at >= 0 ? "on" : ""} s-${f.state}`} onClick={() => toggle(f.id)} title={f.tries ?? f.title} aria-pressed={at >= 0}>
              {at >= 0 && <span className="cmp-letter">{LETTERS[at]}</span>}
              {f.title}
            </button>
          );
        })}
      </div>
      <div className="cmp-stage" ref={stage}>
        {shown.map((f, i) => (
          <section key={f.id} className={`cmp-col s-${f.state}`}>
            <header className="cmp-head">
              <span className="cmp-letter big">{LETTERS[i]}</span>
              <div className="cmp-name">
                <span className="cmp-title">{f.title}</span>
                {f.state === "ruled_out" ? <span className="cmp-sub">Ruled out{f.reason ? `: ${f.reason}` : ""}</span> : f.tries ? <span className="cmp-sub" title={f.tries}>{f.tries}</span> : null}
              </div>
              <button className={`st-tool ${f.state === "chosen" ? "chosen" : ""}`} title={f.state === "chosen" ? "Chosen (click to undo)" : "Choose this direction"} onClick={() => props.patch(f.id, { state: f.state === "chosen" ? "kept" : "chosen", reason: "" })}>
                <Icon name="check" size={14} />
              </button>
              <button className={`st-tool ${f.state === "ruled_out" ? "out" : ""}`} title={f.state === "ruled_out" ? "Ruled out (click to undo)" : "Rule this direction out"} onClick={() => props.patch(f.id, { state: f.state === "ruled_out" ? "kept" : "ruled_out", reason: "" })}>
                <Icon name="x" size={14} />
              </button>
              <button className="st-tool" title="Open this one on its own" onClick={() => props.onOpen(f.id)}>
                <Icon name="maximize" size={14} />
              </button>
            </header>
            <div className={`cmp-frame ${device}`}>
              <div className="cmp-page" style={{ width: size.w * scale, height: frameH * scale }}>
                <iframe
                  ref={(el) => {
                    if (el) frames.current.set(f.id, el);
                    else frames.current.delete(f.id);
                  }}
                  src={pageOf(project, f.id, f.version)}
                  title={f.title}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
                  style={{ width: size.w, height: frameH, transform: `scale(${scale})` }}
                />
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className={`st-ask ${props.running ? "running" : ""}`}>
        <span className="st-ask-mark" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && mix()}
          placeholder={props.running ? "FRIDAY is working on it…" : `Take the best of each: “the hero from A, the type from B”`}
          aria-label="Say what to take from which"
        />
        <button className="st-send" onClick={mix} disabled={!text.trim() || props.running} aria-label="Send"><Icon name="arrow-up" size={14} /></button>
      </div>
    </div>
  );
}
