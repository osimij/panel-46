// The studio's knobs: a sketch's own CSS variables (its colors, fonts, sizes, radius, spacing)
// as controls a designer can read at a glance. Moving one changes the live page at once, with
// no AI involved, and a palette measured from any save on the canvas can be tried on in a
// click. Nothing is kept until Save, which writes the values into the page's :root (with any words
// edited in the page, as one new version).
//
// A variable's name alone says little (--w-num, --c4, --stop), so the page tells the studio
// more about each one (see the kit in sketches.ts): the note written beside it, the lines it
// was grouped with, and where it's used. From that every knob gets a plain name, a range that
// fits what it does (a weight runs 100 to 900, a line height 0.8 to 2.4), and its place: type
// settings gather by style (Display: its font, size, weight and width together), colors made
// as a set (one per product) sit as one strip of swatches.
//
// Numbers are bars, not sliders on a line: drag anywhere on one (Shift for fine steps), click
// it to type a value, arrow keys step it. The dot by a changed knob puts it back. Hovering a
// knob outlines what it changes on the page.
//
// With a part of the page selected (pointing), the column is about that part first: "This
// part" changes its own look only (its size, weight, color…, written on the part itself), then
// the knobs that reach it (which change it everywhere they're used), then all the knobs, folded.
// A part's own sizes are written so they keep scaling with the page (decks size everything in
// container units): font size in em of the part around it, letter spacing and corners in em
// of its own size, line height as a plain number. The bars still read in px.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fontApi } from "./api.ts";
import { Icon } from "./Icon.tsx";
import type { PartLook } from "./Studio.tsx";

export interface PageVar {
  name: string;
  value: string;
  /** The note written beside it in the page: --c1: #e2372b; /* Cortex *\/ */
  note?: string;
  /** Which lines of the page's :root it sits with, and the comment heading them, if any. */
  group?: number;
  heading?: string;
  /** Where the page uses it: CSS properties ("font-size", "font-variation-settings:wght"), or "script". */
  uses?: string[];
}
/** A save's measured colors, biggest share first. */
export interface Palette {
  id: string;
  title: string;
  colors: string[];
}
type Kind = "color" | "length" | "number" | "font";
type Role = "color" | "font" | "weight" | "width" | "axis" | "size" | "leading" | "tracking" | "radius" | "space" | "stroke" | "dimension" | "opacity" | "time" | "number";
type Rgb = [number, number, number];
interface Knob extends PageVar {
  kind: Kind;
  role: Role;
  /** What it's for, once the words saying what kind of setting it is are taken out: --w-display → "display". */
  stem: string;
  label: string;
}

// ---------- Colors ----------

let ink: CanvasRenderingContext2D | null = null;
/** Any CSS color as red, green, blue (0–255) and opacity (0–1), by letting the browser paint it. */
function paint(css: string): [number, number, number, number] | null {
  if (!css || css.includes("var(") || !CSS.supports("color", css)) return null;
  ink ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!ink) return null;
  ink.clearRect(0, 0, 1, 1);
  ink.fillStyle = css;
  ink.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ink.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : [r!, g!, b!, a! / 255];
}
function rgbOf(css: string): Rgb | null {
  const c = paint(css);
  return c ? [c[0], c[1], c[2]] : null;
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

/** Hue (0–360), saturation and brightness (0–1): the picker's square and its hue strip. */
type Hsv = [number, number, number];
function toHsv([r, g, b]: Rgb): Hsv {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), d = max - Math.min(R, G, B);
  let h = d === 0 ? 0 : max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}
function fromHsv([h, s, v]: Hsv): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

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

// ---------- What each knob is ----------

// Every unit a sketch is likely to size things in, including container units (cqw), which
// slide decks use for everything.
const LENGTH = /^(-?\d*\.?\d+)(px|r?em|%|[sdl]?v[wh]|vmin|vmax|cq[whib]|cqmin|cqmax|ch|ex|lh|pt|ms|s|deg)$/;
function kindOf(v: PageVar): Kind | null {
  const value = v.value.trim();
  if (!value || /var\(|calc\(|url\(/.test(value)) return null;
  if (LENGTH.test(value)) return "length";
  if (/^-?\d*\.?\d+$/.test(value)) return "number";
  if (rgbOf(value)) return "color";
  if (/font|typeface|family/i.test(v.name) && !/size|weight|leading|tracking|spacing|height/i.test(v.name)) return "font";
  return null;
}

/** What a number does, from where the page uses it first, and from its name when the page doesn't say. */
function roleOf(v: PageVar, kind: Kind): Role {
  if (kind === "color" || kind === "font") return kind;
  const uses = v.uses ?? [];
  const used = (re: RegExp) => uses.some((u) => re.test(u));
  if (used(/^font-weight$|:wght$/)) return "weight";
  if (used(/:wdth$|^font-(stretch|width)$/)) return "width";
  if (used(/^font-variation-settings/)) return "axis";
  if (used(/^font-size$/)) return "size";
  if (used(/^line-height$/)) return "leading";
  if (used(/^(letter|word)-spacing$/)) return "tracking";
  if (used(/radius$/)) return "radius";
  if (used(/^(stroke-width|outline-width|border(-[a-z]+)?-width|border(-(top|right|bottom|left))?)$/)) return "stroke";
  if (used(/^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-padding|scroll-margin)(-|$)/)) return "space";
  if (used(/^opacity$/)) return "opacity";
  if (used(/(duration|delay)$|^(transition|animation)$/)) return "time";
  if (used(/(^|-)(width|height|size|basis)$/)) return "dimension";
  const parts = v.name.slice(2).toLowerCase().split(/[-_]+/);
  const word = (re: RegExp) => parts.some((p) => re.test(p));
  const unit = v.value.trim().match(LENGTH)?.[2] ?? "";
  if (unit === "ms" || unit === "s" || word(/^(duration|dur|speed|delay)$/)) return "time";
  if (word(/^(w|wg|wght|weight|bold)$/)) return "weight";
  if (word(/^(wd|wdth|stretch)$/)) return "width";
  if (word(/^(lh|leading)$/) || /line-?height/.test(v.name)) return "leading";
  if (word(/^(ls|tracking)$/) || /letter-?spacing/.test(v.name)) return "tracking";
  if (word(/^(fs|size)$/) && !word(/^(icon|avatar|dot|box|thumb|logo|mark)$/)) return "size";
  if (word(/^(radius|round|rounding|corner|corners)$/)) return "radius";
  if (word(/^(space|spacing|gap|pad|padding|margin|gutter|inset)$/)) return "space";
  if (word(/^(stroke|border|hairline|rule)$/)) return "stroke";
  if (word(/^(opacity|alpha)$/)) return "opacity";
  return "number";
}

const SETTING_WORDS = /^(font|fonts|family|typeface|ff|w|wg|wght|weight|wd|wdth|width|stretch|size|fs|lh|leading|line|height|tracking|ls|letter|spacing|axis|type)$/;
const stemOf = (name: string) => name.slice(2).toLowerCase().split(/[-_]+/).filter((p) => p && !SETTING_WORDS.test(p)).join(" ");

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
/** Short names designers and Claude both use, in plain words. */
const WORDS: Record<string, string> = {
  bg: "Background", background: "Background", paper: "Paper", page: "Page", fg: "Text", ink: "Text", text: "Text", body: "Body",
  muted: "Muted", subtle: "Subtle", surface: "Surface", card: "Card", accent: "Accent", brand: "Brand", primary: "Primary",
  border: "Border", desk: "Desk", num: "Numbers", nums: "Numbers", txt: "Text", hd: "Heading", h1: "Heading 1", h2: "Heading 2",
  h3: "Heading 3", radius: "Corners", pad: "Padding", gap: "Gap", tracking: "Tracking", leading: "Line height", gutter: "Gutter",
};
const ROLE_NAME: Partial<Record<Role, string>> = {
  font: "Font", weight: "Weight", width: "Width", axis: "Axis", size: "Size", leading: "Line height", tracking: "Tracking",
  radius: "Corners", space: "Spacing", stroke: "Line width", dimension: "Size", opacity: "Opacity", time: "Time",
};
const stemName = (stem: string) => cap(stem.split(" ").map((p) => WORDS[p]?.toLowerCase() ?? p).join(" "));
/** The first words of a note, if they make a name: "stroke, in page units" → "Stroke". */
function noteName(note?: string) {
  const t = (note ?? "").split(/[(,;:—–]| - /)[0]!.trim();
  return t && t.length <= 30 ? cap(t) : "";
}
function labelOf(v: PageVar, kind: Kind, role: Role, stem: string) {
  const fromNote = noteName(v.note);
  if (fromNote) return fromNote;
  const raw = v.name.slice(2).toLowerCase();
  if (WORDS[raw]) return WORDS[raw];
  if (kind === "color") {
    const n = raw.match(/^[a-z]{1,2}-?(\d+)$/);
    if (n) return `Color ${n[1]}`;
  }
  const what = ROLE_NAME[role];
  if (what && kind !== "color") return stem ? `${stemName(stem)} ${what.toLowerCase()}` : what;
  return stemName(raw.replace(/[-_]+/g, " "));
}

// ---------- Numbers ----------

interface Num {
  n: number;
  unit: string;
}
function numOf(value: string): Num | null {
  const t = value.trim();
  const m = t.match(LENGTH);
  if (m) return { n: Number(m[1]), unit: m[2]! };
  return /^-?\d*\.?\d+$/.test(t) ? { n: Number(t), unit: "" } : null;
}
/** A step that's a round number: 1, 2 or 5 times a power of ten. */
function niceStep(x: number) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const decimalsOf = (step: number) => Math.min(3, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
const fmt = (n: number, step: number) => String(Number(n.toFixed(decimalsOf(step))));
const RELATIVE = /^(%|[sdl]?v[wh]|vmin|vmax|cq[whib]|cqmin|cqmax)$/;

/** Where a knob can go, from what it does and where it started. */
function rangeFor(role: Role, o: number, unit: string): { min: number; max: number; step: number } {
  const a = Math.abs(o);
  const r = (min: number, max: number, step?: number) => {
    const lo = Math.min(min, o), hi = Math.max(max, o);
    return { min: lo, max: hi, step: step ?? niceStep((hi - lo) / 300) };
  };
  const px = unit === "px" || unit === "pt";
  const em = unit === "em" || unit === "rem" || unit === "ch" || unit === "ex" || unit === "lh";
  switch (role) {
    case "weight":
      return o > 0 && o < 10 ? r(1, 9, 1) : r(100, 900, 1);
    case "width":
      // A width axis is often 75–125, but some fonts number it their own way (ALS Hauss: 375).
      return o >= 50 && o <= 200 ? r(50, 200, 1) : r(0, Math.ceil(a * 2), 1);
    case "axis":
      return r(0, Math.max(100, Math.ceil(a * 2)), 1);
    case "size":
      return px ? r(6, Math.max(96, a * 3)) : em ? r(0.5, Math.max(6, a * 3)) : r(0, Math.max(a * 3, 1));
    case "leading":
      return unit ? r(0, Math.max(a * 2.5, 1)) : r(0.8, Math.max(2.4, a * 1.5), 0.01);
    case "tracking":
      return em ? r(-0.1, Math.max(0.3, a * 3), 0.001) : px ? r(-4, 12, 0.1) : r(-Math.max(a, 1), Math.max(a * 3, 1));
    case "radius":
      return px ? r(0, Math.max(40, a * 3)) : r(0, Math.max(a * 4, 1));
    case "space":
      return px ? r(0, Math.max(64, a * 3)) : r(0, Math.max(a * 3, 1));
    case "stroke":
      return r(0, Math.max(a * 4, px || !unit ? 8 : 1));
    case "opacity":
      return unit === "%" ? r(0, 100, 1) : r(0, 1, 0.01);
    case "time":
      return unit === "ms" ? r(0, Math.max(1000, a * 3), 10) : r(0, Math.max(1, a * 3), 0.05);
    default:
      if (RELATIVE.test(unit) && unit === "%") return r(0, Math.max(100, a * 2), 1);
      return r(o < 0 ? -a * 2.5 : 0, a ? a * 2.5 : 10);
  }
}
const WEIGHTS: [number, string][] = [[100, "Thin"], [200, "Extra light"], [300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"], [900, "Black"]];
const weightName = (n: number) => WEIGHTS.find(([w]) => Math.abs(w - n) <= 25)?.[1] ?? "";

/**
 * One number as a bar: its name on the left, its value on the right, filled as far as it goes.
 * Dragging moves it from where it is (it never jumps to the pointer), a click without moving
 * types a value (any unit), and the arrow keys step it, with Shift for ten steps.
 */
function Scrub(props: {
  knob: Knob;
  label: string;
  value: string;
  wide?: boolean;
  onChange: (css: string) => void;
  onDrag: (on: boolean) => void;
  onShow: (on: boolean) => void;
}) {
  const { knob } = props;
  const was = numOf(knob.value);
  const cur = numOf(props.value) ?? was;
  const [typing, setTyping] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  if (!cur || !was) return null;
  const base = cur.unit === was.unit ? was.n : cur.n;
  const range = rangeFor(knob.role, base, cur.unit);
  const span = range.max - range.min || 1;
  const pct = (n: number) => Math.min(1, Math.max(0, (n - range.min) / span)) * 100;
  const changed = props.value.trim() !== knob.value.trim();
  const set = (n: number) => {
    const snapped = Math.round(n / range.step) * range.step;
    props.onChange(`${fmt(snapped, range.step)}${cur.unit}`);
  };
  const extra = knob.role === "weight" ? weightName(cur.n) : "";

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (typing || e.button !== 0) return;
    const el = e.currentTarget;
    const width = el.getBoundingClientRect().width || 1;
    const start = { x: e.clientX, n: cur.n };
    const lo = Math.min(range.min, start.n), hi = Math.max(range.max, start.n);
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) {
        moved = true;
        props.onDrag(true);
      }
      set(Math.min(hi, Math.max(lo, start.n + (dx / width) * span * (ev.shiftKey ? 0.1 : 1))));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (moved) props.onDrag(false);
      else setTyping(true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const key = (e: React.KeyboardEvent) => {
    if (typing) return;
    const by = range.step * (e.shiftKey ? 10 : 1);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") set(cur.n + by);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(cur.n - by);
    else if (e.key === "Enter") setTyping(true);
    else return;
    e.preventDefault();
  };
  const commit = (text: string) => {
    setTyping(false);
    bar.current?.focus();
    const t = text.trim().replace(",", ".");
    if (!t) return;
    // A bare number keeps the knob's unit; a number with a unit changes it.
    if (/^-?\d*\.?\d+$/.test(t)) props.onChange(`${Number(t)}${cur.unit}`);
    else if (numOf(t)) props.onChange(t);
  };

  return (
    <div
      ref={bar}
      className={`kn-bar ${props.wide ? "wide" : ""} ${changed ? "changed" : ""} ${typing ? "typing" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={cur.n}
      aria-valuetext={`${fmt(cur.n, range.step)}${cur.unit}${extra ? ` ${extra}` : ""}`}
      title={`${props.label} (${knob.name})${knob.note ? `: ${knob.note}` : ""}. Drag, or click to type.`}
      onPointerDown={down}
      onKeyDown={key}
      onPointerEnter={() => props.onShow(true)}
      onPointerLeave={() => props.onShow(false)}
    >
      <span className="kn-fill" style={{ width: `${pct(cur.n)}%` }} />
      {changed && <span className="kn-was" style={{ left: `${pct(base)}%` }} />}
      {changed && (
        <button
          className="kn-dot"
          title={`Back to ${knob.value.trim()}`}
          aria-label={`Put ${props.label} back to ${knob.value.trim()}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.onChange(knob.value.trim())}
        />
      )}
      <span className="kn-bar-name">{props.label}</span>
      {typing ? (
        <input
          className="kn-bar-input"
          autoFocus
          defaultValue={`${fmt(cur.n, range.step)}${cur.unit}`}
          spellCheck={false}
          aria-label={`${props.label}, type a value`}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit(e.currentTarget.value);
            if (e.key === "Escape") {
              setTyping(false);
              bar.current?.focus();
            }
          }}
        />
      ) : (
        <span className="kn-bar-val">
          {extra && <span className="kn-faint">{extra} </span>}
          {fmt(cur.n, range.step)}
          {cur.unit && <span className="kn-faint">{cur.unit}</span>}
        </span>
      )}
    </div>
  );
}

// ---------- Color picker ----------

/** A square for saturation and brightness, a strip for hue, the hex, a pipette, and the page's other colors. */
function ColorPop(props: { at: DOMRect; anchor: HTMLElement; value: string; was: string; others: string[]; onChange: (css: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const now = paint(props.value) ?? [0, 0, 0, 1];
  const alpha = now[3];
  const [hsv, setHsv] = useState<Hsv>(() => toHsv([now[0], now[1], now[2]]));
  const [hex, setHex] = useState(hexOf([now[0], now[1], now[2]]));
  const mine = useRef(props.value);

  // Changed from somewhere else (the hex typed, a palette tried on): the picker follows. A gray
  // keeps the hue it had, so dragging back into color doesn't snap to red.
  useEffect(() => {
    if (props.value === mine.current) return;
    mine.current = props.value;
    const c = rgbOf(props.value);
    if (!c) return;
    const h = toHsv(c);
    setHsv((was) => [h[1] === 0 ? was[0] : h[0], h[1], h[2]]);
    setHex(hexOf(c));
  }, [props.value]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      // A click on the swatch that opened it is left to that swatch, which closes it.
      const t = e.target as Node;
      if (!box.current?.contains(t) && !props.anchor.contains(t)) props.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      props.onClose();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [props.onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (css: string) => {
    mine.current = css;
    props.onChange(css);
  };
  const pick = (next: Hsv) => {
    setHsv(next);
    const rgb = fromHsv(next);
    setHex(hexOf(rgb));
    send(alpha < 0.999 ? `rgb(${rgb.map(Math.round).join(" ")} / ${Number(alpha.toFixed(3))})` : hexOf(rgb));
  };
  const take = (css: string) => {
    const c = rgbOf(css);
    if (!c) return;
    const h = toHsv(c);
    setHsv((was) => [h[1] === 0 ? was[0] : h[0], h[1], h[2]]);
    setHex(hexOf(c));
    send(css);
  };
  const drag = (e: React.PointerEvent<HTMLDivElement>, onMove: (x: number, y: number) => void) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      onMove(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const dropper = typeof window !== "undefined" && "EyeDropper" in window;
  const pipette = async () => {
    try {
      const Dropper = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
      take((await new Dropper().open()).sRGBHex);
    } catch {
      /* Picking was called off. */
    }
  };

  const W = 248, H = 330;
  const left = Math.min(Math.max(8, props.at.right - W), innerWidth - W - 8);
  const below = innerHeight - props.at.bottom > H + 12;
  const changed = props.value.trim() !== props.was.trim();
  const hue = hexOf(fromHsv([hsv[0], 1, 1]));
  const keyStep = (e: React.KeyboardEvent, axis: "sv" | "h") => {
    const by = e.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, () => Hsv> =
      axis === "h"
        ? { ArrowLeft: () => [Math.max(0, hsv[0] - by * 360), hsv[1], hsv[2]], ArrowRight: () => [Math.min(360, hsv[0] + by * 360), hsv[1], hsv[2]] }
        : {
            ArrowLeft: () => [hsv[0], Math.max(0, hsv[1] - by), hsv[2]],
            ArrowRight: () => [hsv[0], Math.min(1, hsv[1] + by), hsv[2]],
            ArrowUp: () => [hsv[0], hsv[1], Math.min(1, hsv[2] + by)],
            ArrowDown: () => [hsv[0], hsv[1], Math.max(0, hsv[2] - by)],
          };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    pick(m());
  };

  return createPortal(
    <div
      ref={box}
      className="popover kn-pop"
      role="dialog"
      aria-label="Pick a color"
      style={{ left, width: W, ...(below ? { top: props.at.bottom + 6 } : { bottom: innerHeight - props.at.top + 6, transformOrigin: "bottom right" }) }}
    >
      <div
        className="kn-sv"
        style={{ backgroundColor: hue }}
        tabIndex={0}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuenow={Math.round(hsv[1] * 100)}
        onPointerDown={(e) => drag(e, (x, y) => pick([hsv[0], x, 1 - y]))}
        onKeyDown={(e) => keyStep(e, "sv")}
      >
        <i style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex }} />
      </div>
      <div
        className="kn-hue"
        tabIndex={0}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv[0])}
        onPointerDown={(e) => drag(e, (x) => pick([x * 360, hsv[1], hsv[2]]))}
        onKeyDown={(e) => keyStep(e, "h")}
      >
        <i style={{ left: `${(hsv[0] / 360) * 100}%`, background: hue }} />
      </div>
      <div className="kn-pop-row">
        {changed && <button className="kn-chip kn-before" style={{ background: props.was }} title={`Back to ${props.was}`} aria-label={`Back to ${props.was}`} onClick={() => take(props.was)} />}
        <input
          className="kn-hex-input"
          value={hex}
          spellCheck={false}
          aria-label="Color as hex"
          onChange={(e) => {
            setHex(e.target.value);
            const t = e.target.value.trim();
            const css = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t) ? `#${t}` : t;
            if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(css) || (!css.startsWith("#") && rgbOf(css))) {
              const c = rgbOf(css)!;
              const h = toHsv(c);
              setHsv((was) => [h[1] === 0 ? was[0] : h[0], h[1], h[2]]);
              send(css);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onClose();
          }}
        />
        {alpha < 0.999 && <span className="kn-faint kn-alpha">{Math.round(alpha * 100)}%</span>}
        {dropper && (
          <button className="kn-icon" title="Pick a color from anywhere on screen" aria-label="Pick a color from the screen" onClick={() => void pipette()}>
            <Icon name="pipette" size={15} />
          </button>
        )}
      </div>
      {props.others.length > 0 && (
        <>
          <div className="kn-pop-label">In this sketch</div>
          <div className="kn-pop-swatches">
            {props.others.map((c) => (
              <button key={c} className="kn-chip" style={{ background: c }} title={c} aria-label={`Use ${c}`} onClick={() => take(c)} />
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

// ---------- Fonts ----------

// A font knob holds a CSS font stack ("ALS Unios VF", system-ui, sans-serif). The designer
// only ever sees and picks the first family; the fallbacks behind it are kept as they were.
const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "cursive", "fantasy"]);
const familiesIn = (stack: string) => stack.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
const quote = (f: string) => (GENERIC.has(f) ? f : `"${f}"`);
/** Fonts every computer has, for when the designer wants none of their own. */
const BUILT_IN = [
  { name: "System sans", stack: "system-ui, sans-serif" },
  { name: "Serif", stack: "ui-serif, Georgia, serif" },
  { name: "Mono", stack: "ui-monospace, monospace" },
];
const builtInFor = (stack: string) => BUILT_IN.find((b) => familiesIn(b.stack)[0] === familiesIn(stack)[0]);

// The designer's uploaded fonts, loaded into Panel's own page once so each name in the
// picker can be drawn in its own face. Sketches get them separately, from the server.
let yourFonts: Promise<string[]> | null = null;
function loadYourFonts() {
  yourFonts ??= fontApi
    .list()
    .then((list) => {
      const style = document.getElementById("kn-fonts") ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: "kn-fonts" }));
      style.textContent = list
        .flatMap((f) => f.faces)
        .map((f) => `@font-face{font-family:"${f.family}";src:url("${f.url}");font-weight:${f.weight};font-style:${f.italic ? "italic" : "normal"};font-display:swap}`)
        .join("");
      return list.map((f) => f.family);
    })
    .catch(() => {
      yourFonts = null;
      return [];
    });
  return yourFonts;
}

/** One font knob: the font's name in its own face, and a list to pick another from. */
function FontPick(props: {
  label: string;
  value: string;
  was: string;
  inSketch: string[];
  /** Which of the sketch's fonts the page really has (it checks for itself, see sketches.ts). */
  found: Record<string, boolean>;
  onPick: (stack: string) => void;
  onShow: (on: boolean) => void;
}) {
  const [mine, setMine] = useState<string[]>([]);
  const [at, setAt] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void loadYourFonts().then((l) => live && setMine(l));
    return () => {
      live = false;
    };
  }, []);

  // Closes on a click elsewhere, Escape (without also closing the studio), or the rail scrolling away under it.
  useEffect(() => {
    if (!at) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) setAt(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAt(null);
      button.current?.focus();
    };
    const scrolled = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setAt(null);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scrolled, true);
    addEventListener("resize", scrolled);
    list.current?.querySelector<HTMLElement>(".on")?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", scrolled, true);
      removeEventListener("resize", scrolled);
    };
  }, [at]);

  const current = familiesIn(props.value)[0] ?? "";
  const shown = builtInFor(props.value)?.name ?? current;
  // Whatever followed the first family when the sketch was made: kept behind any font picked.
  const tail = familiesIn(props.was).slice(1).map(quote);
  const pick = (stack: string) => {
    props.onPick(stack);
    setAt(null);
  };
  const fromSketch = props.inSketch.filter((f) => !mine.includes(f) && !GENERIC.has(f));
  const missing = (f: string) => props.found[f] === false && !mine.includes(f);
  const MISSING = "Not one of your fonts and not on this computer, so the page shows a stand-in. Add it in Fonts, or pick another.";

  const item = (name: string, stack: string, on: boolean, family?: string) => (
    <button key={name} className={`menu-item kn-font-item ${on ? "on" : ""}`} role="menuitemradio" aria-checked={on} onClick={() => pick(stack)}>
      <span className="menu-check">{on && <Icon name="check" size={13} />}</span>
      <span className="kn-font-name" style={{ fontFamily: stack }}>{name}</span>
      {family && missing(family) && <span className="kn-missing" title={MISSING}>Missing</span>}
    </button>
  );
  const below = at && innerHeight - at.bottom > 260;
  const changed = props.value.trim() !== props.was.trim();

  return (
    <>
      <button
        ref={button}
        className={`kn-font ${at ? "open" : ""} ${changed ? "changed" : ""}`}
        title={props.value}
        aria-label={`${props.label}: ${shown || "none"}`}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={() => setAt(at ? null : button.current!.getBoundingClientRect())}
        onPointerEnter={() => props.onShow(true)}
        onPointerLeave={() => props.onShow(false)}
      >
        <span className="kn-font-name" style={{ fontFamily: props.value }}>{shown || "Pick a font"}</span>
        {current && missing(current) && <span className="kn-missing" title={MISSING}>Missing</span>}
        <Icon name="chevron-down" size={12} />
      </button>
      {at && createPortal(
        <div
          ref={list}
          className="popover kn-fonts"
          role="menu"
          style={{ left: at.left, width: Math.max(at.width, 220), ...(below ? { top: at.bottom + 4 } : { bottom: innerHeight - at.top + 4, transformOrigin: "bottom left" }) }}
        >
          {changed && (
            <button className="menu-item kn-font-item" onClick={() => pick(props.was)}>
              <span className="menu-check"><Icon name="refresh" size={12} /></span>
              <span className="kn-font-name" style={{ fontFamily: props.was }}>Back to {familiesIn(props.was)[0]}</span>
            </button>
          )}
          {mine.length > 0 && <div className="menu-label">Your fonts</div>}
          {mine.map((f) => item(f, [quote(f), ...tail].join(", "), f === current))}
          {fromSketch.length > 0 && <div className="menu-label">In this sketch</div>}
          {fromSketch.map((f) => item(f, [quote(f), ...tail].join(", "), f === current, f))}
          <div className="menu-label">On every computer</div>
          {BUILT_IN.map((b) => item(b.name, b.stack, builtInFor(props.value) === b))}
          {mine.length === 0 && <p className="kn-fonts-note">Fonts you add to Panel show up here.</p>}
        </div>,
        document.body,
      )}
    </>
  );
}

// ---------- How the knobs are laid out ----------

const TYPE_ROLES: Role[] = ["font", "size", "weight", "width", "axis", "leading", "tracking"];
const SHAPE_ROLES: Role[] = ["radius", "space", "stroke", "dimension", "opacity", "time"];
const order = (k: Knob) => TYPE_ROLES.indexOf(k.role);

interface Strip {
  heading: string;
  knobs: Knob[];
}
interface Style {
  stem: string;
  knobs: Knob[];
}

/** The knobs sorted into what a designer looks for: colors, type styles, shape and space, the rest. */
function arrange(knobs: Knob[]) {
  // Colors made as a numbered set (--c1…--c7, --chart-1…): one strip of swatches.
  const colors = knobs.filter((k) => k.kind === "color");
  const sets = new Map<string, Knob[]>();
  for (const k of colors) {
    const prefix = k.name.match(/^--(.*?)-?\d+$/)?.[1];
    if (prefix !== undefined) sets.set(prefix, [...(sets.get(prefix) ?? []), k]);
  }
  const strips: Strip[] = [];
  for (const [prefix, list] of sets) {
    if (list.length < 3) continue;
    const heading = list.every((k) => k.heading && k.heading === list[0]!.heading) ? cap(list[0]!.heading!) : prefix.length > 2 ? cap(prefix.replace(/[-_]+/g, " ")) : "Set";
    strips.push({ heading, knobs: list });
  }
  const inStrip = new Set(strips.flatMap((s) => s.knobs));
  const colorRows = colors.filter((k) => !inStrip.has(k));

  // Type, by style: everything about "display" (its font, size, weight, width) together.
  const type = knobs.filter((k) => TYPE_ROLES.includes(k.role));
  const byStem = new Map<string, Knob[]>();
  for (const k of type) if (k.stem) byStem.set(k.stem, [...(byStem.get(k.stem) ?? []), k]);
  const styles: Style[] = [];
  for (const [stem, list] of byStem) if (list.some((k) => k.role === "font") || list.length >= 2) styles.push({ stem, knobs: [...list].sort((a, b) => order(a) - order(b)) });
  const inStyle = new Set(styles.flatMap((s) => s.knobs));
  const loose = type.filter((k) => !inStyle.has(k));
  // Sizes left on their own read as a scale, biggest first.
  const sizes = loose.filter((k) => k.role === "size" && k.stem);
  const sameUnit = new Set(sizes.map((k) => numOf(k.value)?.unit)).size === 1;
  if (sameUnit) sizes.sort((a, b) => (numOf(b.value)?.n ?? 0) - (numOf(a.value)?.n ?? 0));
  const typeRest = loose.filter((k) => !sizes.includes(k));

  const shape = knobs.filter((k) => SHAPE_ROLES.includes(k.role));
  const rest = knobs.filter((k) => k.role === "number");
  const restHeading = rest.length && rest.every((k) => k.heading && k.heading === rest[0]!.heading) ? cap(rest[0]!.heading!) : "More";
  return { colorRows, strips, styles, sizes, typeRest, shape, rest, restHeading };
}

// ---------- The panel ----------

/**
 * The head every column beside the page shares (Knobs, Directions, Versions): its name at the
 * left, anything it offers in the middle, and a × that closes the column at the right.
 */
export function RailHead(props: { name: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="st-rail-head">
      <span className="st-rail-name">{props.name}</span>
      {props.children}
      <button className="st-icon xs st-rail-close" onClick={props.onClose} aria-label={`Close ${props.name}`} title={`Close ${props.name}`}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

export function Knobs(props: {
  vars: PageVar[] | null;
  /** Which fonts the page named and really has, by family. */
  fonts?: Record<string, boolean>;
  /** What the designer has changed so far, not yet kept. */
  edits: Record<string, string>;
  palettes: Palette[];
  onChange: (changes: Record<string, string>) => void;
  /** The column's ×. */
  onClose: () => void;
  onAskForKnobs: () => void;
  /** Outline on the page what this variable changes (null: nothing). */
  onShow?: (name: string | null) => void;
  /**
   * The part of the page selected, if any: its name, its own look as the page makes it, the
   * knobs that reach it, and its own look changed so far (CSS properties on the part).
   */
  part?: { path: string; label: string; look: PartLook; vars: string[]; props: Record<string, string> } | null;
  /** Change the selected part's own look; null puts a property back. */
  onPart?: (props: Record<string, string | null>) => void;
}) {
  const knobs = useMemo(
    () =>
      (props.vars ?? []).flatMap((v): Knob[] => {
        const kind = kindOf(v);
        if (!kind) return [];
        const role = roleOf(v, kind);
        const stem = stemOf(v.name);
        return [{ ...v, kind, role, stem, label: labelOf(v, kind, role, stem) }];
      }),
    [props.vars],
  );
  const parts = useMemo(() => arrange(knobs), [knobs]);
  const now = (k: Knob) => props.edits[k.name] ?? k.value;
  /** Every font the sketch was made with, so one can be swapped for another it already uses. */
  const inSketch = [...new Set(knobs.filter((k) => k.kind === "font").map((k) => familiesIn(k.value)[0]!).filter(Boolean))];
  const [open, setOpen] = useState<{ name: string; at: DOMRect; anchor: HTMLElement } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Outlines on the page follow the pointer over the knobs, but not while dragging one: then
  // the designer is watching the change itself.
  const dragging = useRef(false);
  const onShow = props.onShow;
  const show = (name: string | null) => {
    setHovered(name);
    if (!dragging.current) onShow?.(name);
  };
  const drag = (on: boolean) => {
    dragging.current = on;
    document.documentElement.classList.toggle("kn-scrubbing", on);
    onShow?.(null);
  };
  useEffect(() => () => onShow?.(null), [onShow]);
  // A popover pinned to a row that scrolled away closes.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !open) return;
    const close = () => setOpen(null);
    el.addEventListener("scroll", close, { once: true });
    return () => el.removeEventListener("scroll", close);
  }, [open]);

  const { part } = props;
  // "All knobs" folds away while a part is selected; another part folds it again.
  const [allOpen, setAllOpen] = useState(false);
  useEffect(() => setAllOpen(false), [part?.path]);

  if (props.vars && !knobs.length && !part) {
    return (
      <aside className="st-rail kn" aria-label="Knobs">
        <RailHead name="Knobs" onClose={props.onClose} />
        <div className="kn-empty">
          <p>This sketch has no knobs yet: its colors, fonts and sizes are written straight into the page.</p>
          <button className="st-quiet" onClick={props.onAskForKnobs}>Ask FRIDAY to add them</button>
        </div>
      </aside>
    );
  }

  const set = (k: Knob) => (css: string) => props.onChange({ [k.name]: css });
  const scrub = (k: Knob, label = k.label) => (
    <Scrub
      key={k.name}
      knob={k}
      label={label}
      value={now(k)}
      wide={label.length > 15}
      onChange={set(k)}
      onDrag={drag}
      onShow={(on) => show(on ? k.name : null)}
    />
  );
  const font = (k: Knob, label: string) => (
    <FontPick key={k.name} label={label} value={now(k)} was={k.value} inSketch={inSketch} found={props.fonts ?? {}} onPick={set(k)} onShow={(on) => show(on ? k.name : null)} />
  );
  const toggle = (k: Knob) => (e: React.MouseEvent<HTMLElement>) => setOpen(open?.name === k.name ? null : { name: k.name, at: e.currentTarget.getBoundingClientRect(), anchor: e.currentTarget });
  const colorRow = (k: Knob) => {
    const value = now(k);
    const c = paint(value);
    const isChanged = value.trim() !== k.value.trim();
    return (
      <button
        key={k.name}
        className={`kn-color ${open?.name === k.name ? "open" : ""} ${isChanged ? "changed" : ""}`}
        title={`${k.label} (${k.name})${k.note && noteName(k.note) !== k.note ? `: ${k.note}` : ""}`}
        aria-label={`${k.label}: ${value}`}
        aria-haspopup="dialog"
        onClick={toggle(k)}
        onPointerEnter={() => show(k.name)}
        onPointerLeave={() => show(null)}
      >
        <span className="kn-chip" style={{ background: value }} />
        <span className="kn-color-name">{k.label}</span>
        <span className="kn-hex">
          {c ? hexOf([c[0], c[1], c[2]]).slice(1) : value}
          {c && c[3] < 0.999 && <span className="kn-faint"> {Math.round(c[3] * 100)}%</span>}
        </span>
      </button>
    );
  };
  const openKnob = open && knobs.find((k) => k.name === open.name);

  // ---- The selected part's own look ----
  const look = part?.look;
  const own = part?.props ?? {};
  const round = (n: number, d = 2) => Number(n.toFixed(d));
  const pxOf = (n: number | null | undefined) => `${round(n ?? 0)}px`;
  /** The part's font size now, in px: changed (in em of the part around it) or as the page makes it. */
  const sizeNow = (() => {
    const em = numOf(own["font-size"] ?? "");
    if (em && em.unit === "em" && look?.parentSize) return em.n * look.parentSize;
    if (em && em.unit === "px") return em.n;
    return look?.size ?? 16;
  })();
  const partKnob = (name: string, value: string, role: Role, label: string, kind: Kind = "length"): Knob => ({ name, value, role, label, kind, stem: "" });
  /** A bar for one of the part's numbers: shown in px (or plain), written the way that keeps scaling. */
  const partScrub = (k: Knob, current: string, toCss: (n: Num) => Record<string, string | null>) => (
    <Scrub
      key={k.name}
      knob={k}
      label={k.label}
      value={current}
      onChange={(css) => {
        const n = numOf(css);
        if (!n) return;
        // Back where the page has it: the part's own value is taken away, not written.
        if (css.trim() === k.value.trim()) props.onPart?.(Object.fromEntries(Object.keys(toCss(n)).map((p) => [p, null])));
        else props.onPart?.(toCss(n));
      }}
      onDrag={drag}
      onShow={() => {}}
    />
  );
  const wghtIn = (fvs: string) => Number(fvs.match(/["']wght["']\s+(-?[\d.]+)/)?.[1] ?? NaN);
  const withWght = (fvs: string, n: number) => (/["']wght["']/.test(fvs) ? fvs.replace(/(["']wght["']\s+)(-?[\d.]+)/, `$1${n}`) : fvs && fvs !== "normal" ? `${fvs}, "wght" ${n}` : `"wght" ${n}`);
  const partColor = (prop: "color" | "background-color", label: string, was: string) => {
    const value = own[prop] ?? was;
    const c = paint(value);
    const name = `part:${prop}`;
    const isChanged = prop in own;
    return (
      <button
        key={name}
        className={`kn-color ${open?.name === name ? "open" : ""} ${isChanged ? "changed" : ""}`}
        aria-label={`${label}: ${c ? hexOf([c[0], c[1], c[2]]) : "none"}`}
        aria-haspopup="dialog"
        onClick={(e) => setOpen(open?.name === name ? null : { name, at: e.currentTarget.getBoundingClientRect(), anchor: e.currentTarget })}
      >
        <span className={`kn-chip ${c ? "" : "kn-none"}`} style={{ background: c ? value : undefined }} />
        <span className="kn-color-name">{label}</span>
        <span className="kn-hex">
          {c ? hexOf([c[0], c[1], c[2]]).slice(1) : "None"}
          {c && c[3] < 0.999 && <span className="kn-faint"> {Math.round(c[3] * 100)}%</span>}
        </span>
      </button>
    );
  };
  const partSection = part && look && (
    <section className="kn-group kn-part" aria-label="This part">
      <h4>This part</h4>
      <div className="kn-part-name" title={part.label}>{part.label}</div>
      <p className="kn-hint kn-part-hint">Only this part changes.</p>
      {look.words && (
        <>
          <FontPick
            label="Font"
            value={own["font-family"] ?? look.family}
            was={look.family}
            inSketch={inSketch}
            found={props.fonts ?? {}}
            onPick={(stack) => props.onPart?.({ "font-family": stack.trim() === look.family.trim() ? null : stack })}
            onShow={() => {}}
          />
          <div className="kn-grid">
            {look.size != null && partScrub(partKnob("font-size", pxOf(look.size), "size", "Size"), pxOf(sizeNow), (n) => ({ "font-size": n.unit === "px" && look.parentSize ? `${round(n.n / look.parentSize, 4)}em` : `${n.n}${n.unit}` }))}
            {look.weight != null &&
              partScrub(
                partKnob("font-weight", String(look.weight), "weight", "Weight", "number"),
                String(look.wght ? (wghtIn(own["font-variation-settings"] ?? "") || look.weight) : Number(own["font-weight"] ?? look.weight)),
                (n): Record<string, string | null> => (look.wght ? { "font-variation-settings": withWght(look.fvs, round(n.n, 0)) } : { "font-weight": String(round(n.n, 0)) }),
              )}
            {partScrub(
              partKnob("line-height", pxOf(look.lineHeight ?? (look.size ?? 16) * 1.2), "leading", "Line height"),
              own["line-height"] ? pxOf(Number(own["line-height"]) * sizeNow) : pxOf(look.lineHeight ?? (look.size ?? 16) * 1.2),
              (n) => ({ "line-height": n.unit === "px" ? String(round(n.n / sizeNow, 3)) : `${n.n}${n.unit}` }),
            )}
            {partScrub(
              partKnob("letter-spacing", pxOf(look.letterSpacing ?? 0), "tracking", "Letter spacing"),
              own["letter-spacing"] ? pxOf((numOf(own["letter-spacing"])?.n ?? 0) * sizeNow) : pxOf(look.letterSpacing ?? 0),
              (n) => ({ "letter-spacing": n.unit === "px" ? `${round(n.n / sizeNow, 4)}em` : `${n.n}${n.unit}` }),
            )}
          </div>
        </>
      )}
      <div className="kn-grid">
        {look.words && partColor("color", "Color", look.color)}
        {partColor("background-color", "Fill", look.background)}
      </div>
      <div className="kn-grid">
        {look.radius != null &&
          partScrub(
            partKnob("border-radius", pxOf(look.radius), "radius", "Corners"),
            own["border-radius"] ? pxOf((numOf(own["border-radius"])?.n ?? 0) * sizeNow) : pxOf(look.radius),
            (n) => ({ "border-radius": n.unit === "px" ? `${round(n.n / sizeNow, 4)}em` : `${n.n}${n.unit}` }),
          )}
        {look.opacity != null && partScrub(partKnob("opacity", String(look.opacity), "opacity", "Opacity", "number"), own.opacity ?? String(look.opacity), (n) => ({ opacity: String(round(n.n, 2)) }))}
      </div>
    </section>
  );
  const partUses = part ? knobs.filter((k) => part.vars.includes(k.name)) : [];
  const usesSection = part && partUses.length > 0 && (
    <section className="kn-group" aria-label="Knobs this part uses">
      <h4>Knobs this part uses</h4>
      <p className="kn-hint kn-part-hint">These change everywhere they're used.</p>
      {partUses.filter((k) => k.kind === "font").map((k) => font(k, k.label))}
      <div className="kn-grid">
        {partUses.filter((k) => k.kind === "color").map(colorRow)}
        {partUses.filter((k) => k.kind !== "color" && k.kind !== "font").map((k) => scrub(k))}
      </div>
    </section>
  );
  const partOpen = open?.name.startsWith("part:") ? (open.name.slice(5) as "color" | "background-color") : null;
  const pageColors = [...new Set(knobs.filter((k) => k.kind === "color").map((k) => now(k)).filter((v) => rgbOf(v)))].slice(0, 24);
  const hoveredInStrip = (s: Strip) => s.knobs.find((k) => k.name === (hovered ?? open?.name));

  return (
    <aside className="st-rail kn" aria-label="Knobs">
      <RailHead name="Knobs" onClose={props.onClose} />
      <div className="kn-scroll" ref={scroller}>
        {partSection}
        {usesSection}
        {part && knobs.length > 0 && (
          <button className={`kn-fold ${allOpen ? "open" : ""}`} onClick={() => setAllOpen((v) => !v)} aria-expanded={allOpen}>
            <Icon name="chevron-right" size={13} /> All knobs <span className="kn-faint">{knobs.length}</span>
          </button>
        )}
        {(!part || allOpen) && (<>
        {(parts.colorRows.length > 0 || parts.strips.length > 0) && (
          <section className="kn-group">
            <h4>Color</h4>
            {props.palettes.length > 0 && <div className="kn-sub"><span>Try a save's colors</span></div>}
            {props.palettes.length > 0 && (
              <div className="kn-palettes">
                {props.palettes.map((p) => (
                  <button key={p.id} className="kn-palette" title={`Try the colors of “${p.title}”`} onClick={() => props.onChange(wearPalette(props.vars ?? [], p.colors))}>
                    {p.colors.slice(0, 5).map((c, i) => <i key={i} style={{ background: c }} />)}
                  </button>
                ))}
              </div>
            )}
            {parts.colorRows.length > 0 && <div className="kn-grid">{parts.colorRows.map(colorRow)}</div>}
            {parts.strips.map((s) => {
              const on = hoveredInStrip(s);
              return (
                <div className="kn-block" key={s.heading + s.knobs[0]!.name}>
                  <div className="kn-sub">
                    <span>{s.heading}</span>
                    {on && <span className="kn-sub-note">{on.label} <span className="kn-faint">{hexOf(rgbOf(now(on)) ?? [0, 0, 0]).slice(1)}</span></span>}
                  </div>
                  <div className="kn-strip">
                    {s.knobs.map((k) => (
                      <button
                        key={k.name}
                        className={`kn-chip big ${open?.name === k.name ? "open" : ""} ${now(k).trim() !== k.value.trim() ? "changed" : ""}`}
                        style={{ background: now(k) }}
                        title={`${k.label} (${k.name})`}
                        aria-label={`${k.label}: ${now(k)}`}
                        aria-haspopup="dialog"
                        onClick={toggle(k)}
                        onPointerEnter={() => show(k.name)}
                        onPointerLeave={() => show(null)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {(parts.styles.length > 0 || parts.sizes.length > 0 || parts.typeRest.length > 0) && (
          <section className="kn-group">
            <h4>Type</h4>
            {parts.styles.map((s) => {
              const name = stemName(s.stem);
              const fontKnob = s.knobs.find((k) => k.role === "font");
              return (
                <div className="kn-block" key={s.stem}>
                  <div className="kn-sub"><span>{name}</span></div>
                  {fontKnob && font(fontKnob, `${name} font`)}
                  <div className="kn-grid">{s.knobs.filter((k) => k !== fontKnob).map((k) => scrub(k, ROLE_NAME[k.role] ?? k.label))}</div>
                </div>
              );
            })}
            {parts.sizes.length > 0 && (
              <div className="kn-block">
                <div className="kn-sub"><span>Sizes</span></div>
                <div className="kn-grid">{parts.sizes.map((k) => scrub(k, noteName(k.note) || stemName(k.stem)))}</div>
              </div>
            )}
            {parts.typeRest.length > 0 && (
              <div className={parts.styles.length || parts.sizes.length ? "kn-block" : ""}>
                {(parts.styles.length > 0 || parts.sizes.length > 0) && <div className="kn-sub"><span>Everywhere</span></div>}
                {parts.typeRest.filter((k) => k.role === "font").map((k) => font(k, k.label))}
                <div className="kn-grid">{parts.typeRest.filter((k) => k.role !== "font").map((k) => scrub(k))}</div>
              </div>
            )}
          </section>
        )}

        {parts.shape.length > 0 && (
          <section className="kn-group">
            <h4>Shape and space</h4>
            <div className="kn-grid">{parts.shape.map((k) => scrub(k))}</div>
          </section>
        )}

        {parts.rest.length > 0 && (
          <section className="kn-group">
            <h4>{parts.restHeading}</h4>
            <div className="kn-grid">{parts.rest.map((k) => scrub(k))}</div>
          </section>
        )}
        </>)}
        {!props.vars && <p className="kn-empty">Reading the page…</p>}
        {props.vars && !part && <p className="kn-hint">Drag a bar, or click it to type. Hover a knob to see what it changes.</p>}
      </div>
      {partOpen && look && open && (
        <ColorPop
          at={open.at}
          anchor={open.anchor}
          value={own[partOpen] ?? (paint(partOpen === "color" ? look.color : look.background) ? (partOpen === "color" ? look.color : look.background) : "#ffffff")}
          was={partOpen === "color" ? look.color : look.background}
          others={pageColors}
          onChange={(css) => props.onPart?.({ [partOpen]: css === (partOpen === "color" ? look.color : look.background) ? null : css })}
          onClose={() => setOpen(null)}
        />
      )}
      {openKnob && open && (
        <ColorPop
          at={open.at}
          anchor={open.anchor}
          value={now(openKnob)}
          was={openKnob.value}
          others={pageColors.filter((c) => c !== now(openKnob))}
          onChange={set(openKnob)}
          onClose={() => setOpen(null)}
        />
      )}
    </aside>
  );
}
