// The studio: one sketch, live and full size, to click through and change. The page runs in
// its own sandbox; a small kit Panel adds to it (sketches.ts) lets the designer point at a
// part of it, and says which states it has (a flow's screens, or empty / loading / error).
//
//   header   the sketch, its versions, the screen it's seen on, the verdict, Build
//   stage    the page in a browser frame, with its states as a map to jump around
//   rail     its directions: the sketch it branched from and the ones branched from it
//   bar      "Ask FRIDAY for a change": to the page, or to the part pointed at
//
// What FRIDAY changes arrives as a new version on the canvas, and loads here in place.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { studioApi, type Device, type RefState, type RuleFinding, type SketchInfo, type SketchPoint } from "./api.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Knobs, type PageVar, type Palette } from "./Knobs.tsx";
import { Compare } from "./Compare.tsx";
import "./studio.css";

export interface StudioSketch {
  id: string;
  title: string;
  tries?: string;
  state?: RefState;
  version: number;
  reason?: string;
  device?: Device;
}

const DEVICES: Record<Device, { w: number; h: number; label: string; icon: IconName }> = {
  desktop: { w: 1440, h: 900, label: "Desktop", icon: "monitor" },
  tablet: { w: 834, h: 1112, label: "Tablet", icon: "tablet" },
  phone: { w: 390, h: 844, label: "Phone", icon: "phone" },
};

// "?studio=4": the studio's own address for a page, so a copy a browser kept from before the
// kit was added (pages used to be cached forever) is never used. Bump it when the kit changes.
const pageOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.html?studio=4`;
const pictureOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.jpg`;

interface Picked {
  label: string;
  selector: string;
  text: string;
  html: string;
  style: Record<string, string>;
  rect: { x: number; y: number; w: number; h: number };
  state: string;
  /** Made of words (and inline tags): the designer can edit them in place. */
  editable: boolean;
}

export function Studio(props: {
  project: string;
  sketch: StudioSketch;
  /** Changes on the canvas (a new sketch, a version): the family is read again. */
  stamp: string;
  /** FRIDAY is answering. */
  running: boolean;
  onClose: () => void;
  onSwitch: (id: string) => void;
  patch: (id: string, data: Record<string, unknown>) => void;
  /** Ask FRIDAY about this sketch, or a part of it; `fan` makes that many alternates side by side. */
  ask: (text: string, point?: SketchPoint, fan?: number) => void;
  /** The measured palettes of the saves on this canvas, to try on the sketch. */
  palettes: Palette[];
  /** From the side-by-side view: make a new sketch that takes these things from these sketches. */
  mix: (text: string, ids: string[]) => void;
  onBuilt: (title: string) => void;
  onError: (text: string) => void;
}) {
  const { project, sketch } = props;
  const [info, setInfo] = useState<SketchInfo | null>(null);
  const [device, setDevice] = useState<Device>(sketch.device ?? "desktop");
  const [states, setStates] = useState<{ name: string; slug: string }[]>([]);
  const [state, setState] = useState("");
  const [pointing, setPointing] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reload, setReload] = useState(0);
  const [rail, setRail] = useState(true);
  const [verdict, setVerdict] = useState<null | "chosen" | "ruled_out">(null);
  const [building, setBuilding] = useState(false);
  const [closing, setClosing] = useState(false);
  const [fresh, setFresh] = useState<{ v: number; mine: boolean } | null>(null);
  // Words being edited in the page, and being kept as a new version.
  const [editing, setEditing] = useState(false);
  const [keepingText, setKeepingText] = useState(false);
  /** When the designer last kept something themselves (knobs, words), so its new version isn't credited to FRIDAY. */
  const keptAt = useRef(0);
  // Knobs: the page's own variables, what's been moved and not yet kept.
  const [knobs, setKnobs] = useState(false);
  const [vars, setVars] = useState<PageVar[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [keeping, setKeeping] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  /** Side by side with the other directions of its family. */
  const [comparing, setComparing] = useState(false);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 1000, h: 700 });

  useEffect(() => setDevice(sketch.device ?? "desktop"), [sketch.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    studioApi.sketch(project, sketch.id).then((i) => live && setInfo(i)).catch(() => {});
    return () => {
      live = false;
    };
  }, [project, sketch.id, sketch.version, props.stamp]);

  // A new version from FRIDAY: say so for a moment.
  const seen = useRef({ id: sketch.id, v: sketch.version });
  useEffect(() => {
    if (seen.current.id === sketch.id && sketch.version > seen.current.v) {
      setFresh({ v: sketch.version, mine: Date.now() - keptAt.current < 20_000 });
      setPicked(null);
      setEditing(false);
      const t = setTimeout(() => setFresh(null), 2600);
      seen.current = { id: sketch.id, v: sketch.version };
      return () => clearTimeout(t);
    }
    seen.current = { id: sketch.id, v: sketch.version };
  }, [sketch.id, sketch.version]);

  // ---- The room the page has ----
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setRoom({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const d = DEVICES[device];
  const fit = useMemo(() => {
    const pad = device === "desktop" ? 0 : 28;
    const w = Math.max(room.w - pad * 2, 200), h = Math.max(room.h - pad * 2, 200);
    if (device === "desktop") {
      const scale = Math.min(1, w / d.w);
      return { scale, w: d.w, h: Math.round(h / scale) };
    }
    const scale = Math.min(1, w / d.w, h / d.h);
    return { scale, w: d.w, h: d.h };
  }, [room, device, d]);

  // ---- Talking to the page ----
  const post = useCallback((m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ panel: 1, ...m }, "*"), []);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.panel) return;
      const m = e.data;
      if (m.t === "hello") {
        setStates(Array.isArray(m.states) ? m.states : []);
        setState(String(m.state ?? ""));
        if (pointingRef.current) post({ t: "pick", on: true });
        // The page (re)loaded: read its knobs, and put back what was being tried.
        post({ t: "vars" });
        if (Object.keys(editsRef.current).length) post({ t: "set", vars: editsRef.current });
      } else if (m.t === "vars") {
        setVars(Array.isArray(m.vars) ? m.vars : []);
      } else if (m.t === "state") {
        setState(String(m.state ?? ""));
        setPicked(null);
      } else if (m.t === "picked") {
        setPicked({ label: m.label, selector: m.selector, text: m.text, html: m.html, style: m.style ?? {}, rect: m.rect, state: m.state ?? "", editable: !!m.editable });
      } else if (m.t === "editing") {
        setEditing(!!m.on);
      } else if (m.t === "edited") {
        setEditing(false);
        void keepText({ path: String(m.path ?? ""), before: String(m.before ?? ""), after: String(m.after ?? ""), before_text: String(m.beforeText ?? ""), after_text: String(m.afterText ?? "") });
      } else if (m.t === "cancel") {
        if (picked) {
          setPicked(null);
          post({ t: "release" });
        } else setPointing(false);
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [post, picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const pointingRef = useRef(pointing);
  pointingRef.current = pointing;
  useEffect(() => {
    post({ t: "pick", on: pointing });
    if (!pointing) setPicked(null);
  }, [pointing, post]);
  // Another screen size moves everything: what was pointed at isn't where it was.
  useEffect(() => {
    setPicked(null);
    post({ t: "release" });
  }, [device, post]);
  const src = pageOf(project, sketch.id, sketch.version);
  useEffect(() => {
    setStates([]);
    setState("");
    setPicked(null);
    setEditing(false);
  }, [src, reload]);
  // Another sketch or version: its own knobs, and nothing carried over.
  useEffect(() => {
    setVars(null);
    setEdits({});
    setRulesOpen(false);
  }, [src]);

  const turn = useCallback((changes: Record<string, string>) => {
    if (!Object.keys(changes).length) return;
    setEdits((e) => ({ ...e, ...changes }));
    post({ t: "set", vars: changes });
  }, [post]);
  const resetKnobs = useCallback(() => {
    post({ t: "set", vars: Object.fromEntries(Object.keys(editsRef.current).map((k) => [k, null])) });
    setEdits({});
  }, [post]);
  const keepKnobs = async () => {
    // Only values the browser accepts are written into the page.
    const good = Object.fromEntries(Object.entries(edits).filter(([, v]) => v.trim() && !/[;{}<>]/.test(v)));
    if (!Object.keys(good).length || keeping) return;
    setKeeping(true);
    keptAt.current = Date.now();
    try {
      await studioApi.setVars(project, sketch.id, good, sketch.version);
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setKeeping(false);
    }
  };

  /** Words the designer edited in the page, kept as a new version (no AI). */
  const keepText = async (edit: { path: string; before: string; after: string; before_text: string; after_text: string }) => {
    if (edit.after === edit.before) return;
    setKeepingText(true);
    keptAt.current = Date.now();
    try {
      const res = await studioApi.setText(project, sketch.id, edit, sketch.version);
      // Nothing changed in the file after all: put the page back as it is.
      if (res.version === sketch.version) setReload((n) => n + 1);
    } catch (e) {
      props.onError((e as Error).message);
      // The page still shows the words that weren't kept: load it again as it really is.
      setReload((n) => n + 1);
    } finally {
      setKeepingText(false);
    }
  };

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(props.onClose, 160);
  }, [props.onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]");
      if (e.key === "Escape") {
        if (picked) {
          setPicked(null);
          post({ t: "release" });
        } else if (pointing) setPointing(false);
        else if (comparing && !typing) setComparing(false);
        else if (verdict || building) {
          setVerdict(null);
          setBuilding(false);
        } else if (!typing) close();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") setPointing((v) => !v);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [close, picked, pointing, post, verdict, building, comparing]);

  // ---- Asking ----
  const ask = (text: string, mode: "change" | "alternates" = "change") => {
    const t = text.trim();
    if (!t && mode === "change") return;
    if (picked) {
      props.ask(t || "Try alternates of this.", {
        sketch: sketch.id, version: sketch.version, label: picked.label, selector: picked.selector, text: picked.text,
        html: picked.html, style: picked.style, state: picked.state || undefined, device, mode,
      }, mode === "alternates" ? 3 : undefined);
      setPicked(null);
      setPointing(false);
    } else props.ask(t);
  };

  const versions = info?.versions ?? [];
  const at = versions.findIndex((v) => v.v === sketch.version);
  const step = (dir: -1 | 1) => {
    const next = versions[at + dir];
    if (next) props.patch(sketch.id, { version: next.v });
  };
  const errors = versions[at]?.errors ?? 0;
  const rules: RuleFinding[] = versions[at]?.rules ?? [];
  const breaks = rules.filter((r) => r.level === "breaks").length;
  const family = info?.family ?? [];
  const showRail = rail && family.length > 1 && !knobs;

  // Where the bubble goes: under the part pointed at, in the stage's own coordinates.
  const bubble = (() => {
    if (!picked || !stage.current || !frame.current) return null;
    const fr = frame.current.getBoundingClientRect(), st = stage.current.getBoundingClientRect();
    const x = fr.left - st.left + (picked.rect.x + picked.rect.w / 2) * fit.scale;
    const below = fr.top - st.top + (picked.rect.y + picked.rect.h) * fit.scale + 12;
    const above = fr.top - st.top + picked.rect.y * fit.scale - 12;
    const flip = below + 150 > st.height;
    return { left: Math.min(Math.max(x - 180, 12), st.width - 372), top: flip ? Math.max(above - 132, 8) : below };
  })();

  return (
    <div className={`studio ${closing ? "closing" : ""}`} role="dialog" aria-label={sketch.title}>
      <header className="st-head">
        <button className="st-icon" onClick={close} aria-label="Back to the canvas" title="Back to the canvas (Esc)"><Icon name="arrow-left" size={15} /></button>
        <div className="st-name">
          <span className="st-title">{sketch.title || "Untitled sketch"}</span>
          {sketch.tries && <span className="st-tries" title={sketch.tries}>{sketch.tries}</span>}
        </div>
        <div className="st-versions" aria-label="Versions">
          <button className="st-icon sm" disabled={at <= 0} onClick={() => step(-1)} aria-label="Earlier version" title="Earlier version"><Icon name="chevron-left" size={14} /></button>
          <span className={`st-v ${fresh ? "fresh" : ""}`}>v{sketch.version}{versions.length > 1 && <span className="faint"> of {versions.at(-1)!.v}</span>}</span>
          <button className="st-icon sm" disabled={at < 0 || at >= versions.length - 1} onClick={() => step(1)} aria-label="Later version" title="Later version"><Icon name="chevron-right" size={14} /></button>
        </div>
        <div className="st-seg" role="radiogroup" aria-label="Screen">
          {(Object.keys(DEVICES) as Device[]).map((k) => (
            <button key={k} role="radio" aria-checked={device === k} className={device === k ? "on" : ""} onClick={() => setDevice(k)} title={`${DEVICES[k].label} (${DEVICES[k].w}×${DEVICES[k].h})`}>
              <Icon name={DEVICES[k].icon} size={14} />
            </button>
          ))}
        </div>
        <span className="st-gap" />
        <button className={`st-tool ${pointing ? "on" : ""}`} disabled={comparing} onClick={() => setPointing((v) => !v)} title="Point at a part to change it (P)">
          <Icon name="point" size={14} /> <span className="st-label">Point</span>
        </button>
        {family.length > 1 && (
          <button className={`st-tool ${comparing ? "on" : ""}`} onClick={() => { setComparing((v) => !v); setPointing(false); }} title="Compare: this direction beside the others, scrolled together">
            <Icon name="compare" size={14} /> <span className="st-label">Compare</span>
          </button>
        )}
        <button className={`st-tool ${knobs && !comparing ? "on" : ""}`} onClick={() => { setComparing(false); setKnobs((v) => (comparing ? true : !v)); }} title="Knobs: change its colors, type, corners and spacing yourself, live">
          <Icon name="sliders" size={14} /> <span className="st-label">Knobs</span>
        </button>
        {family.length > 1 && (
          <button className={`st-tool ${showRail ? "on" : ""}`} onClick={() => { setKnobs(false); setRail((v) => (knobs ? true : !v)); }} title="Directions: the sketches branched from this one">
            <Icon name="branch" size={14} /> {family.length}
          </button>
        )}
        <span className="st-sep" />
        <div className="st-verdict">
          <button className={`st-tool ${sketch.state === "chosen" ? "chosen" : ""}`} title={sketch.state === "chosen" ? "Chosen (click to undo)" : "Choose this direction"} onClick={() => (sketch.state === "chosen" ? props.patch(sketch.id, { state: "kept", reason: "" }) : setVerdict("chosen"))}>
            <Icon name="check" size={14} /> <span className="st-label">{sketch.state === "chosen" ? "Chosen" : "Choose"}</span>
          </button>
          <button className={`st-tool ${sketch.state === "ruled_out" ? "out" : ""}`} title={sketch.state === "ruled_out" ? "Ruled out (click to undo)" : "Rule this direction out"} onClick={() => (sketch.state === "ruled_out" ? props.patch(sketch.id, { state: "kept", reason: "" }) : setVerdict("ruled_out"))}>
            <Icon name="x" size={14} /> <span className="st-label">{sketch.state === "ruled_out" ? "Ruled out" : "Rule out"}</span>
          </button>
          {verdict && (
            <Reason
              verdict={verdict}
              onCancel={() => setVerdict(null)}
              onDone={(reason) => {
                props.patch(sketch.id, { state: verdict, reason });
                setVerdict(null);
              }}
            />
          )}
        </div>
        <button className="st-build" onClick={() => setBuilding(true)} title="Hand this to Claude Code to build for real, in your code">
          <Icon name="build" size={14} /> <span className="st-label-long">Build with Claude Code</span><span className="st-label-short">Build</span>
        </button>
        {building && (
          <BuildSheet
            project={project}
            sketch={sketch}
            onCancel={() => setBuilding(false)}
            onError={props.onError}
            onStarted={() => {
              if (sketch.state !== "chosen") props.patch(sketch.id, { state: "chosen" });
              setBuilding(false);
              props.onBuilt(sketch.title);
            }}
          />
        )}
      </header>

      <div className="st-body">
        {comparing && family.length > 1 ? (
          <Compare
            project={project}
            family={family}
            current={sketch.id}
            device={device}
            running={props.running}
            patch={props.patch}
            onOpen={(sid) => {
              setComparing(false);
              if (sid !== sketch.id) props.onSwitch(sid);
            }}
            onMix={props.mix}
          />
        ) : (
        <div className="st-main">
          <div className="st-bar">
            <button className="st-icon sm" onClick={() => setReload((n) => n + 1)} aria-label="Reload" title="Reload the page"><Icon name="refresh" size={13} /></button>
            {states.length > 1 ? (
              <div className="st-states" role="tablist" aria-label="States">
                <Icon name="states" size={13} />
                {states.map((s, i) => {
                  const on = (state || states[0]!.slug) === s.slug || (!state && i === 0);
                  return (
                    <button key={s.slug} role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => post({ t: "state", slug: i === 0 ? "" : s.slug })}>
                      {s.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="st-address">{sketch.title || "sketch"}{state ? <span className="faint"> #{state}</span> : null}</span>
            )}
            <span className="st-gap" />
            {errors > 0 && <span className="st-errors" title="The page reported errors when it was rendered"><Icon name="alert" size={12} /> {errors} {errors === 1 ? "error" : "errors"}</span>}
            {rules.length > 0 && (
              <span className="st-rules-wrap">
                <button className={`st-rules ${breaks ? "breaks" : ""}`} onClick={() => setRulesOpen((v) => !v)} aria-expanded={rulesOpen} title="What Panel measured in this page against your rules (unugly.md)">
                  {breaks ? `${breaks} against your rules` : `${rules.length} to look at`}
                </button>
                {rulesOpen && (
                  <div className="st-pop st-rules-pop" role="dialog" aria-label="Rule checks">
                    <p className="st-pop-title">Measured against your rules</p>
                    {rules.map((r, i) => (
                      <div key={i} className={`st-rule ${r.level}`}>
                        <span className="st-rule-name">{r.rule}{r.level === "breaks" ? "" : " · look"}</span>
                        <p>{r.what}</p>
                        {r.where?.length ? <p className="st-rule-where">{r.where.join(" · ")}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </span>
            )}
            <span className="st-size">{d.w}×{device === "desktop" ? Math.round(fit.h) : d.h}{fit.scale < 1 ? ` · ${Math.round(fit.scale * 100)}%` : ""}</span>
            <a className="st-icon sm" href={src} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab"><Icon name="external" size={13} /></a>
          </div>
          <div className={`st-stage ${device}`} ref={stage}>
            <div className={`st-device ${device}`} style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }}>
              <iframe
                key={`${src}#${reload}`}
                ref={frame}
                src={src}
                title={sketch.title}
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
                style={{ width: fit.w, height: fit.h, transform: `scale(${fit.scale})` }}
              />
            </div>
            {pointing && !picked && <div className="st-hint">Click a part to change it · double-click words to edit them · Esc to stop</div>}
            {picked && bubble && (
              <PointBubble
                key={picked.selector}
                picked={picked}
                style={bubble}
                editing={editing}
                keeping={keepingText}
                nextVersion={(versions.at(-1)?.v ?? sketch.version) + 1}
                onSend={ask}
                onEdit={() => {
                  // The page takes the keyboard, so typing goes into the words.
                  frame.current?.focus();
                  post({ t: "edit" });
                }}
                onEditEnd={(keep) => post({ t: "edit-end", keep })}
                onCancel={() => {
                  setPicked(null);
                  post({ t: "release" });
                }}
              />
            )}
            {fresh && <div className="st-fresh" key={fresh.v}>{fresh.mine ? `Kept as version ${fresh.v}` : `Version ${fresh.v} from FRIDAY`}</div>}
          </div>
          <AskBar running={props.running} onSend={(t) => ask(t)} onAlternates={() => props.ask("Try 3 alternates of this sketch, each a different direction for the whole page.", undefined, 3)} />
        </div>
        )}

        {knobs && !comparing && (
          <Knobs
            vars={vars}
            edits={edits}
            palettes={props.palettes}
            keeping={keeping}
            nextVersion={(versions.at(-1)?.v ?? sketch.version) + 1}
            onChange={turn}
            onReset={resetKnobs}
            onKeep={() => void keepKnobs()}
            onAskForKnobs={() => props.ask("Rewrite this sketch so its colors, fonts, type sizes, corner radius and spacing are CSS variables on :root (--bg, --surface, --ink, --muted, --accent, --font-display, --font-text, --radius, --space and whatever else it needs), used everywhere in place of the fixed values. Change nothing about how it looks.")}
          />
        )}
        {showRail && !comparing && (
          <aside className="st-rail" aria-label="Directions">
            <div className="st-rail-head">Directions</div>
            <div className="st-tree">
              {family.map((f) => (
                <button key={f.id} className={`st-dir s-${f.state} ${f.id === sketch.id ? "on" : ""}`} style={{ paddingLeft: 8 + Math.min(f.depth, 4) * 14 }} onClick={() => props.onSwitch(f.id)} title={f.tries ?? f.title}>
                  <img src={pictureOf(project, f.id, f.version)} alt="" draggable={false} loading="lazy" />
                  <span className="st-dir-text">
                    <span className="st-dir-title">{f.title}</span>
                    {f.state === "ruled_out" ? (
                      <span className="st-dir-sub">Ruled out{f.reason ? `: ${f.reason}` : ""}</span>
                    ) : f.state === "chosen" ? (
                      <span className="st-dir-sub chosen">Chosen</span>
                    ) : f.tries ? (
                      <span className="st-dir-sub">{f.tries}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * Under the part pointed at: say what to change, ask for alternates of it, or, for words,
 * edit them right there in the page (also by double-clicking them).
 */
function PointBubble(props: {
  picked: Picked;
  style: { left: number; top: number };
  editing: boolean;
  keeping: boolean;
  nextVersion: number;
  onSend: (t: string, mode?: "change" | "alternates") => void;
  onEdit: () => void;
  onEditEnd: (keep: boolean) => void;
  onCancel: () => void;
}) {
  const { picked, style, onSend, onCancel } = props;
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  // Not while the words are being edited: the page has the keyboard then.
  useEffect(() => {
    if (!props.editing && !props.keeping) input.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (props.editing || props.keeping) {
    return (
      <div className="st-bubble" style={style} onPointerDown={(e) => e.stopPropagation()}>
        <div className="st-bubble-head">
          <span className="st-bubble-dot" />
          <span className="st-bubble-label">{props.keeping ? "Keeping your words…" : "Editing the words in the page"}</span>
        </div>
        <p className="st-bubble-note">Type over them. ↵ keeps them as version {props.nextVersion}, Esc puts them back. ⇧↵ for a new line.</p>
        <div className="st-bubble-actions">
          <button className="st-quiet" disabled={props.keeping} onClick={() => props.onEditEnd(false)}>Put back</button>
          <button className="st-send" disabled={props.keeping} onClick={() => props.onEditEnd(true)}>Keep as v{props.nextVersion}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="st-bubble" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div className="st-bubble-head">
        <span className="st-bubble-dot" />
        <span className="st-bubble-label">{picked.label}</span>
        <button className="st-icon xs" onClick={onCancel} aria-label="Cancel"><Icon name="x" size={12} /></button>
      </div>
      <textarea
        ref={input}
        rows={2}
        value={text}
        placeholder="What should change here?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend(text);
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="st-bubble-actions">
        {picked.editable && (
          <button className="st-quiet" onClick={props.onEdit} title="Change the words yourself, right in the page (or double-click them)">
            <Icon name="pencil" size={13} /> Edit text
          </button>
        )}
        <button className="st-quiet" onClick={() => onSend(text, "alternates")} title="Three new sketches at once, each doing this part differently">
          <Icon name="branch" size={13} /> {picked.editable ? "Alternates" : "Try 3 alternates"}
        </button>
        <button className="st-send" disabled={!text.trim()} onClick={() => onSend(text)}>Change <span className="faint">↵</span></button>
      </div>
    </div>
  );
}

/** Asking FRIDAY about the whole page. */
function AskBar({ running, onSend, onAlternates }: { running: boolean; onSend: (t: string) => void; onAlternates: () => void }) {
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim() || running) return;
    onSend(text);
    setText("");
  };
  return (
    <div className={`st-ask ${running ? "running" : ""}`}>
      <span className="st-ask-mark" aria-hidden />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        placeholder={running ? "FRIDAY is working on it…" : "Ask FRIDAY for a change to this page, or press P to point at a part"}
        aria-label="Ask FRIDAY for a change"
      />
      <button className="st-quiet" onClick={onAlternates} disabled={running} title="Three new directions from this sketch, made at the same time"><Icon name="branch" size={13} /> Alternates</button>
      <button className="st-send" onClick={send} disabled={!text.trim() || running} aria-label="Send"><Icon name="arrow-up" size={14} /></button>
    </div>
  );
}

/** Choosing or ruling out, with a reason (kept with the sketch: FRIDAY and the build read it). */
function Reason({ verdict, onDone, onCancel }: { verdict: "chosen" | "ruled_out"; onDone: (reason: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="st-pop" role="dialog" onPointerDown={(e) => e.stopPropagation()}>
      <p className="st-pop-title">{verdict === "chosen" ? "Choose this direction" : "Rule this direction out"}</p>
      <textarea
        autoFocus
        rows={2}
        value={text}
        placeholder={verdict === "chosen" ? "Why this one? (optional)" : "Why not? (optional, FRIDAY won't drift back)"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onDone(text.trim());
          }
        }}
      />
      <div className="st-pop-actions">
        <button className="st-quiet" onClick={onCancel}>Cancel</button>
        <button className="st-send" onClick={() => onDone(text.trim())}>{verdict === "chosen" ? "Choose" : "Rule out"}</button>
      </div>
    </div>
  );
}

/** Handing it to Claude Code: which folder, and anything to add. */
function BuildSheet({ project, sketch, onCancel, onStarted, onError }: { project: string; sketch: StudioSketch; onCancel: () => void; onStarted: () => void; onError: (t: string) => void }) {
  const [folders, setFolders] = useState<{ recent: string[]; found: string[]; home: string } | null>(null);
  const [folder, setFolder] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    studioApi.folders().then((f) => {
      setFolders(f);
      setFolder((v) => v || f.recent[0] || "");
    }).catch(() => {});
  }, []);
  const short = (f: string) => (folders && f.startsWith(folders.home) ? `~${f.slice(folders.home.length)}` : f);
  const start = async () => {
    if (!folder.trim() || busy) return;
    setBusy(true);
    try {
      await studioApi.build({ project, sketch: sketch.id, folder: folder.trim(), note: note.trim() || undefined });
      onStarted();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };
  const list = [...new Set([...(folders?.recent ?? []), ...(folders?.found ?? [])])].slice(0, 12);
  return (
    <div className="st-pop st-build-pop" role="dialog" aria-label="Build with Claude Code" onPointerDown={(e) => e.stopPropagation()}>
      <p className="st-pop-title">Build “{sketch.title}” with Claude Code</p>
      <p className="st-pop-text">Claude Code gets the sketch, your rules, the locked decisions and their saves, and what you ruled out. It works on a branch of its own in a separate copy of your project, so your files stay as they are. Its progress shows on the canvas.</p>
      <label className="st-field">
        <span>Project folder</span>
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="~/Desktop/my-site (a new folder starts a new project)" list="st-folders" autoFocus spellCheck={false} />
      </label>
      {list.length > 0 && (
        <div className="st-folders">
          {list.map((f) => (
            <button key={f} className={folder === f ? "on" : ""} onClick={() => setFolder(f)} title={f}><Icon name="folder" size={12} /> {short(f)}</button>
          ))}
        </div>
      )}
      <label className="st-field">
        <span>For Claude Code (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Make it the new landing page; use the existing Button component" />
      </label>
      <div className="st-pop-actions">
        <button className="st-quiet" onClick={onCancel}>Cancel</button>
        <button className="st-send" disabled={!folder.trim() || busy} onClick={() => void start()}>{busy ? "Starting…" : "Start building"}</button>
      </div>
    </div>
  );
}
