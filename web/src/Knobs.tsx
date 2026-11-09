// The studio's knobs: a sketch's own CSS variables (its colors, fonts, sizes, radius, spacing)
// as swatches and sliders. Moving one changes the live page at once, with no AI involved, and
// a palette measured from any save on the canvas can be tried on in a click. Nothing is
// kept until "Keep as a new version", which writes the values into the page's :root.

import { useMemo } from "react";
import { Icon } from "./Icon.tsx";

export interface PageVar {
  name: string;
  value: string;
}
/** A save's measured colors, biggest share first. */
export interface Palette {
  id: string;
  title: string;
  colors: string[];
}
type Kind = "color" | "length" | "number" | "font";
type Rgb = [number, number, number];

// ---------- Colors ----------

let ink: CanvasRenderingContext2D | null = null;
/** Any CSS color as red, green, blue (0–255), by letting the browser paint it. */
function rgbOf(css: string): Rgb | null {
  if (!css || css.includes("var(") || !CSS.supports("color", css)) return null;
  ink ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!ink) return null;
  ink.clearRect(0, 0, 1, 1);
  ink.fillStyle = css;
  ink.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ink.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : [r!, g!, b!];
}
const hexOf = (c: Rgb) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]: Rgb) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
/** How colorful, 0 (gray) to 1. */
const chroma = ([r, g, b]: Rgb) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const IS_BG = /(^|-)(bg|background|paper|page|canvas|base)($|-)/i;
const IS_INK = /(^|-)(ink|text|fg|foreground|body)($|-)/i;
const IS_ACCENT = /(^|-)(accent|brand|primary|highlight|cta|link)($|-)/i;

/**
 * A save's palette put onto a sketch's color variables. Its biggest color becomes the
 * background, the one that reads best on it the text, its most colorful one the accent.
 * Every other color keeps its place between background and text (a soft border stays a
 * soft border), so the page keeps its hierarchy in the new colors.
 */
export function wearPalette(vars: PageVar[], colors: string[]): Record<string, string> {
  const pal = colors.map(rgbOf).filter((c): c is Rgb => !!c);
  const mine = vars.flatMap((v) => {
    const c = rgbOf(v.value);
    return c ? [{ name: v.name, c }] : [];
  });
  if (pal.length < 2 || !mine.length) return {};
  const bg = pal[0]!;
  let text = [...pal].sort((a, b) => contrast(bg, b) - contrast(bg, a))[0]!;
  // Text has to stay readable: if nothing in the palette is, near-black or near-white is used.
  if (contrast(bg, text) < 4.5) text = lum(bg) > 0.4 ? [20, 20, 20] : [245, 245, 245];
  const colorful = pal.filter((c) => c !== bg && c !== text && chroma(c) > 0.12).sort((a, b) => chroma(b) - chroma(a));
  const accent = colorful[0] ?? text;

  const oldBg = mine.find((v) => IS_BG.test(v.name))?.c ?? [...mine].sort((a, b) => lum(b.c) - lum(a.c))[0]!.c;
  const oldText = mine.find((v) => IS_INK.test(v.name))?.c ?? [...mine].sort((a, b) => contrast(oldBg, b.c) - contrast(oldBg, a.c))[0]!.c;
  // How light a color is, simply (0 black, 1 white), and where a color sat between the old
  // background (0) and the old text (1). Below 0 means "on the far side of the background",
  // like a white card on an off-white page.
  const tone = (c: Rgb) => (c[0] + c[1] + c[2]) / 765;
  const span = tone(oldText) - tone(oldBg) || 1;
  const place = (c: Rgb) => (tone(c) - tone(oldBg)) / span;
  /** The same place between (or beyond) the new background and text. */
  const at = (t: number): Rgb => {
    if (t >= 0) return mix(bg, text, Math.min(t, 1));
    const pole: Rgb = tone(text) < tone(bg) ? [255, 255, 255] : [0, 0, 0];
    const oldPole = tone(oldText) < tone(oldBg) ? 1 : 0;
    const room = Math.abs(oldPole - tone(oldBg)) || 1;
    return mix(bg, pole, Math.min((Math.abs(t) * Math.abs(span)) / room, 1));
  };
  const out: Record<string, string> = {};
  let spare = 0;
  for (const v of mine) {
    let to: Rgb;
    if (IS_ACCENT.test(v.name)) to = accent;
    else if (v.c === oldBg) to = bg;
    else if (v.c === oldText) to = text;
    // Another colorful one (a second accent): the palette's next most colorful, if it has one.
    else if (chroma(v.c) > 0.25 && !IS_BG.test(v.name) && !IS_INK.test(v.name)) to = colorful[Math.min(++spare, colorful.length - 1)] ?? accent;
    else to = at(place(v.c));
    out[v.name] = hexOf(to);
  }
  return out;
}

// ---------- What kind of knob a variable is ----------

const LENGTH = /^(-?\d*\.?\d+)(px|rem|em|%|vw|vh|ch)$/;
function kindOf(v: PageVar): Kind | null {
  const value = v.value.trim();
  if (!value || /var\(|calc\(|url\(/.test(value)) return null;
  if (LENGTH.test(value)) return "length";
  if (/^-?\d*\.?\d+$/.test(value)) return "number";
  if (rgbOf(value)) return "color";
  if (/font|typeface|family/i.test(v.name) && !/size|weight|leading|tracking|spacing|height/i.test(v.name)) return "font";
  return null;
}
const ABOUT_TYPE = /font|type|text|size|leading|line|tracking|letter|weight|measure/i;
const NAMES: Record<string, string> = { bg: "Background", fg: "Text", ink: "Text" };
const label = (name: string) => {
  const raw = name.replace(/^--/, "");
  return NAMES[raw] ?? raw.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
};

function range(name: string, n: number, unit: string) {
  if (/weight/i.test(name) && n >= 100) return { min: 100, max: 900, step: 100 };
  if (unit === "px") return { min: n < 0 ? Math.floor(n * 2.5) : 0, max: Math.max(48, Math.ceil(Math.abs(n) * 2.5)), step: Math.abs(n) < 6 ? 0.5 : 1 };
  if (unit === "%" || unit === "vw" || unit === "vh") return { min: 0, max: n > 100 ? 200 : 100, step: 1 };
  if (unit === "ch") return { min: 0, max: Math.max(80, Math.ceil(n * 2)), step: 1 };
  // rem, em, or a bare number (a line height, a ratio).
  return { min: n < 0 ? -0.2 : 0, max: Math.max(unit ? 4 : 2, Math.ceil(Math.abs(n) * 2.5 * 10) / 10), step: Math.abs(n) < 0.2 ? 0.005 : 0.05 };
}

// ---------- The panel ----------

export function Knobs(props: {
  vars: PageVar[] | null;
  /** What the designer has changed so far, not yet kept. */
  edits: Record<string, string>;
  palettes: Palette[];
  keeping: boolean;
  nextVersion: number;
  onChange: (changes: Record<string, string>) => void;
  onReset: () => void;
  onKeep: () => void;
  onAskForKnobs: () => void;
}) {
  const knobs = useMemo(() => (props.vars ?? []).flatMap((v) => {
    const kind = kindOf(v);
    return kind ? [{ ...v, kind }] : [];
  }), [props.vars]);
  const now = (name: string, was: string) => props.edits[name] ?? was;
  const changed = Object.keys(props.edits).length;
  const colors = knobs.filter((k) => k.kind === "color");
  const type = knobs.filter((k) => k.kind === "font" || (k.kind !== "color" && ABOUT_TYPE.test(k.name)));
  const shape = knobs.filter((k) => k.kind !== "color" && !type.includes(k));

  if (props.vars && !knobs.length) {
    return (
      <aside className="st-rail kn" aria-label="Knobs">
        <div className="st-rail-head">Knobs</div>
        <div className="kn-empty">
          <p>This sketch has no knobs yet: its colors, fonts and sizes are written straight into the page.</p>
          <button className="st-quiet" onClick={props.onAskForKnobs}>Ask FRIDAY to add them</button>
        </div>
      </aside>
    );
  }

  const control = (k: (typeof knobs)[number]) => {
    const value = now(k.name, k.value);
    if (k.kind === "color") {
      const rgb = rgbOf(value);
      return (
        <div className="kn-row" key={k.name}>
          <span className="kn-name" title={k.name}>{label(k.name)}</span>
          <label className="kn-swatch" style={{ background: value }}>
            <input type="color" value={rgb ? hexOf(rgb) : "#000000"} onChange={(e) => props.onChange({ [k.name]: e.target.value })} aria-label={label(k.name)} />
          </label>
          <input
            className="kn-text"
            value={value}
            spellCheck={false}
            aria-label={`${label(k.name)} as text`}
            onChange={(e) => props.onChange({ [k.name]: e.target.value })}
          />
        </div>
      );
    }
    if (k.kind === "font") {
      return (
        <div className="kn-row" key={k.name}>
          <span className="kn-name" title={k.name}>{label(k.name)}</span>
          <input className="kn-text wide" value={value} spellCheck={false} aria-label={label(k.name)} onChange={(e) => props.onChange({ [k.name]: e.target.value })} />
        </div>
      );
    }
    const m = value.trim().match(LENGTH);
    const n = m ? Number(m[1]) : Number(value);
    const unit = m ? m[2]! : "";
    const was = k.value.trim().match(LENGTH);
    const r = range(k.name, was ? Number(was[1]) : Number(k.value), unit);
    return (
      <label className="kn-row" key={k.name}>
        <span className="kn-name" title={k.name}>{label(k.name)}</span>
        <input
          type="range"
          min={r.min}
          max={Math.max(r.max, n)}
          step={r.step}
          value={Number.isFinite(n) ? n : 0}
          onChange={(e) => props.onChange({ [k.name]: `${Number(e.target.value)}${unit}` })}
        />
        <span className="kn-val">{Number.isFinite(n) ? Math.round(n * 1000) / 1000 : value}{unit}</span>
      </label>
    );
  };

  return (
    <aside className="st-rail kn" aria-label="Knobs">
      <div className="st-rail-head">Knobs</div>
      <div className="kn-scroll">
        {colors.length > 0 && props.palettes.length > 0 && (
          <section className="kn-group">
            <h4>Try a palette from a save</h4>
            <div className="kn-palettes">
              {props.palettes.map((p) => (
                <button key={p.id} className="kn-palette" title={p.title} onClick={() => props.onChange(wearPalette(props.vars ?? [], p.colors))}>
                  {p.colors.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}
                </button>
              ))}
            </div>
          </section>
        )}
        {colors.length > 0 && <section className="kn-group"><h4>Colors</h4>{colors.map(control)}</section>}
        {type.length > 0 && <section className="kn-group"><h4>Type</h4>{type.map(control)}</section>}
        {shape.length > 0 && <section className="kn-group"><h4>Shape and space</h4>{shape.map(control)}</section>}
        {!props.vars && <p className="kn-empty">Reading the page…</p>}
      </div>
      <div className="kn-foot">
        <button className="st-quiet" disabled={!changed || props.keeping} onClick={props.onReset}><Icon name="refresh" size={13} /> Reset</button>
        <button className="st-send" disabled={!changed || props.keeping} onClick={props.onKeep}>{props.keeping ? "Keeping…" : `Keep as v${props.nextVersion}`}</button>
      </div>
    </aside>
  );
}
