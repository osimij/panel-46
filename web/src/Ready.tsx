// Ready-made: the parts that come with Panel, for FRIDAY's sketches and for the designer to look
// at and copy. Loading animations (from loading.dev), colour palettes in OKLCH (from oklch.fyi)
// and icons (Phosphor, six weights). They are files beside Panel's code (ready/, read by
// server/ready.ts); nothing here changes anything.
//
// The pieces are Panel's own files, but they're shown the way a sketch is: each loading
// animation plays in a frame of its own with no scripts and no way to reach Panel, and each
// icon is drawn from its outlines alone (the d of each path), never put into the page as code.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ICON_WEIGHTS, readyApi, type IconWeight, type ReadyLoading, type ReadyMade } from "./api.ts";
import { Icon } from "./Icon.tsx";
import "./ready.css";

type Tab = "loading" | "colors" | "icons";
const TAB_KEY = "panel.ready.tab";
const TABS: { id: Tab; label: string }[] = [
  { id: "loading", label: "Loading" },
  { id: "colors", label: "Colors" },
  { id: "icons", label: "Icons" },
];

/** Remembered between visits; a private window just starts on Loading. */
function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private window: it just isn't remembered. */
  }
}

/**
 * Copies text. Where the browser won't let a page write to the clipboard (some embedded
 * browsers refuse it outright), the older way still works inside the click: select hidden text, copy.
 */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.append(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

/** A small switch of a few words, with the dark pill gliding under the one that's on. */
function Segment<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const on = box.current?.querySelector<HTMLButtonElement>("button.on");
    if (on) setPill({ x: on.offsetLeft, w: on.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="segment" ref={box} role="radiogroup" aria-label={label}>
      {pill && <span className="segment-indicator" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} aria-hidden />}
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={o.id === value} className={o.id === value ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A loading piece as a page of its own, for a sandboxed frame: centred, in the text colour of the theme. */
const framed = (piece: string, size: string) =>
  `<!doctype html><meta charset="utf-8"><style>:root{color-scheme:light dark}html,body{margin:0;height:100%;background:transparent}body{display:grid;place-items:center;color:oklch(0.15 0 0);--ld-size:${size}}@media (prefers-color-scheme:dark){body{color:oklch(0.95 0 0)}}</style>${piece}`;

function LoadingFrame({ part, size, className }: { part: ReadyLoading; size: string; className: string }) {
  const doc = useMemo(() => framed(part.html, size), [part.html, size]);
  // sandbox="" : no scripts, no forms, an origin of its own. CSS animations still play.
  return <iframe className={className} sandbox="" srcDoc={doc} title={part.title} tabIndex={-1} aria-hidden loading="lazy" />;
}

function Loading({ parts, copy }: { parts: ReadyLoading[]; copy: (text: string, what: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const part = parts.find((p) => p.name === open) ?? null;
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      {part && (
        <section className="ready-stage" key={part.name} aria-label={part.title}>
          <LoadingFrame part={part} size="72px" className="ready-stage-frame" />
          <div className="ready-stage-text">
            <h2>{part.title}</h2>
            <p>{part.line}</p>
            <p className="ready-faint">{part.duration_ms} ms a cycle · takes the text color · size with --ld-size</p>
            <div className="ready-stage-actions">
              <button className="ready-btn" onClick={() => copy(part.html, `the code for ${part.title}`)}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button className="text-btn muted" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        </section>
      )}
      <div className="ready-loading">
        {parts.map((p) => (
          <button key={p.name} className={`ready-tile ${p.name === open ? "on" : ""}`} onClick={() => setOpen(p.name === open ? null : p.name)} title={p.line}>
            <LoadingFrame part={p} size="28px" className="ready-tile-frame" />
            <span className="ready-name">{p.title}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Colors({ data, copy }: { data: ReadyMade["palettes"]; copy: (text: string, what: string) => void }) {
  const [mode, setMode] = useState<"light" | "dark">(() => remembered("panel.ready.mode", ["light", "dark"] as const, "light"));
  const scales = data.palettes.filter((p) => p.kind === "scale");
  const sets = data.palettes.filter((p) => p.kind === "set");
  const row = (p: (typeof data.palettes)[number]) => (
    <div key={p.name} className="ready-palette">
      <a className="ready-palette-name" href={p.source_url} target="_blank" rel="noreferrer" title="Where it came from">{p.title}</a>
      <div className="ready-swatches">
        {p[mode].map((c, i) => (
          <button
            key={i}
            className="ready-swatch"
            style={{ background: c }}
            title={p.kind === "scale" ? `${i + 1} · ${data.steps[i]?.for} · ${c}` : `${i + 1} · ${c}`}
            aria-label={`Copy ${c}`}
            onClick={() => copy(c, c)}
          />
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className="ready-bar">
        <Segment label="Light or dark" value={mode} options={[{ id: "light", label: "Light" }, { id: "dark", label: "Dark" }]} onChange={(m) => { setMode(m); remember("panel.ready.mode", m); }} />
        <span className="ready-faint">Click a swatch to copy it.</span>
      </div>
      <div className={`ready-colors ${mode}`}>
        <div className="ready-palette ready-steps" aria-hidden>
          <span className="ready-palette-name" />
          <div className="ready-swatches">
            {data.steps.map((s) => <span key={s.step} title={s.for}>{s.step}</span>)}
          </div>
        </div>
        {scales.map(row)}
        <h3 className="ready-sub">Sets of 5 to 10 colors</h3>
        {sets.map(row)}
      </div>
    </>
  );
}

// Each weight's drawings, fetched once and kept for the visit.
const drawings = new Map<IconWeight, Record<string, string>>();
const svgOf = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="1em" height="1em" fill="currentColor" aria-hidden="true">${inner}</svg>`;

/**
 * An icon's shapes, read from its drawing: every Phosphor icon is only <path d="…"> (duotone adds
 * opacity). Anything else in it and nothing is drawn, so nothing but outlines reaches the page.
 * Faster to scroll through than 1,512 pictures, too.
 */
const PATH = /<path d="([^"<>]*)"(?: opacity="([0-9.]+)")?\/>/g;
function shapesOf(inner: string) {
  const shapes = [...inner.matchAll(PATH)].map((m) => ({ d: m[1]!, opacity: m[2] }));
  return shapes.map((x) => `<path d="${x.d}"${x.opacity ? ` opacity="${x.opacity}"` : ""}/>`).join("") === inner ? shapes : [];
}
function Glyph({ inner }: { inner: string | undefined }) {
  const shapes = useMemo(() => (inner === undefined ? [] : shapesOf(inner)), [inner]);
  return (
    <svg className="ready-glyph" viewBox="0 0 256 256" fill="currentColor" aria-hidden>
      {shapes.map((x, i) => <path key={i} d={x.d} opacity={x.opacity} />)}
    </svg>
  );
}

function Icons({ data, copy, onError }: { data: ReadyMade["icons"]; copy: (text: string, what: string) => void; onError: (t: string) => void }) {
  const [weight, setWeight] = useState<IconWeight>(() => remembered("panel.ready.weight", ICON_WEIGHTS, "regular"));
  const [drawn, setDrawn] = useState<Record<string, string> | null>(() => drawings.get(weight) ?? null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    const have = drawings.get(weight);
    if (have) return setDrawn(have);
    readyApi
      .icons(weight)
      .then((d) => {
        drawings.set(weight, d);
        if (live) setDrawn(d);
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      live = false;
    };
  }, [weight, onError]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!words.length) return data.icons;
    return data.icons.filter((i) => {
      const hay = [i.name, i.alias ?? "", ...i.tags, ...i.categories].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [data.icons, query]);

  return (
    <>
      <div className="ready-bar">
        <input
          className="ready-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an icon: trash, settings, arrow…"
          aria-label="Find an icon"
          spellCheck={false}
        />
        <Segment label="Weight" value={weight} options={ICON_WEIGHTS.map((w) => ({ id: w, label: w[0]!.toUpperCase() + w.slice(1) }))} onChange={(w) => { setWeight(w); remember("panel.ready.weight", w); }} />
        <span className="ready-faint ready-count">{shown.length === data.icons.length ? `${data.count.toLocaleString("en")} icons` : `${shown.length} found`}</span>
      </div>
      {shown.length === 0 ? (
        <p className="ready-faint ready-none">No icon for that. Try another word.</p>
      ) : (
        <div className="ready-icons">
          {shown.map((i) => {
            const inner = drawn?.[i.name];
            return (
              <button key={i.name} className="ready-icon" onClick={() => inner !== undefined && copy(svgOf(inner), `the ${i.name} icon`)} title={i.tags.length ? `${i.name} · ${i.tags.slice(0, 6).join(", ")}` : i.name}>
                <Glyph inner={inner} />
                <span className="ready-name">{i.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function Ready({ onError, onSay }: { onError: (t: string) => void; onSay: (t: string) => void }) {
  const [data, setData] = useState<ReadyMade | null>(null);
  const [tab, setTab] = useState<Tab>(() => remembered(TAB_KEY, TABS.map((t) => t.id), "loading"));
  useEffect(() => {
    readyApi.list().then(setData).catch((e: Error) => onError(e.message));
  }, [onError]);

  const copy = useCallback(
    (text: string, what: string) => {
      void copyText(text).then((ok) => (ok ? onSay(`Copied ${what}`) : onError("Couldn't copy. Click into Panel first, then try again.")));
    },
    [onSay, onError],
  );

  return (
    <div className="ready">
      <header className="header">
        <div className="title-row">
          <h1>Ready-made</h1>
          <span className="subtitle">Parts FRIDAY uses in sketches. Click one to copy it.</span>
          <span className="ready-spacer" />
          <Segment label="Part" value={tab} options={TABS} onChange={(t) => { setTab(t); remember(TAB_KEY, t); }} />
        </div>
      </header>

      {data && (
        <div className="ready-body" key={tab}>
          {tab === "loading" && <Loading parts={data.loading} copy={copy} />}
          {tab === "colors" && <Colors data={data.palettes} copy={copy} />}
          {tab === "icons" && <Icons data={data.icons} copy={copy} onError={onError} />}
        </div>
      )}

      <footer className="ready-credits">
        Loading animations by Jakub Krehel and Paul Faivret, <a href="https://loading.dev" target="_blank" rel="noreferrer">loading.dev</a>
        {" · "}Icons by <a href="https://phosphoricons.com" target="_blank" rel="noreferrer">Phosphor</a>
        {" · "}Both under the MIT licence
        {" · "}Colors from <a href="https://oklch.fyi/color-palettes" target="_blank" rel="noreferrer">oklch.fyi</a>
      </footer>
    </div>
  );
}
