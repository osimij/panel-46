// The studio: one sketch, live and full size, to click through and change. The page runs in
// its own sandbox; a small kit Panel adds to it (sketches.ts) lets the designer point at a
// part of it, and says which states it has (a flow's screens, or empty / loading / error).
//
//   header    icons only, one row that never moves: back, the title, the version; Point and
//             Compare; the column beside the page; Choose and Rule out; Figma and Build.
//             Each icon says its name the moment the pointer (or Tab) is on it.
//   page row  the page's states as tabs, and at the right what's wrong, what's waiting to be
//             saved, and the view chip (which screen, at what scale, reload, open in a tab)
//   stage     the page in a browser frame
//   column    one at a time beside the page: Knobs, Directions, or FRIDAY's own panel
//   bar       "Ask FRIDAY for a change", only while FRIDAY's panel is folded away
//
// One page and one column beside it: Knobs, Directions and FRIDAY take turns in the same
// place at the same width, so switching between them never moves or rescales the page.
// FRIDAY's panel belongs to the app, so the studio folds it away and brings it back. While
// the studio is open the header runs over the top of FRIDAY's panel too, and the panel sits
// under it (see studio.css), so opening or closing a column moves nothing in the header.
//
// What FRIDAY changes arrives as a new version on the canvas, and loads here in place.
// What the designer changes by hand (words typed over in the page, knobs moved) waits, shown
// live, until they press Save: then all of it becomes one new version, however many changes.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STUDIO_PAGE, studioApi, type Device, type FigmaRead, type PartSeen, type PartStyleEdit, type RefState, type RuleFinding, type SketchInfo, type SketchPoint, type WordEdit } from "./api.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Knobs, RailHead, type PageVar, type Palette } from "./Knobs.tsx";
import { Compare } from "./Compare.tsx";
import { Versions } from "./Versions.tsx";
import { Mark } from "./Glow.tsx";
import "./studio.css";

export interface StudioSketch {
  id: string;
  title: string;
  tries?: string;
  state?: RefState;
  version: number;
  reason?: string;
  device?: Device;
  /** A wireframe: a rough draft of what each section is for, not a design. */
  wire?: true;
}

const DEVICES: Record<Device, { w: number; h: number; label: string; icon: IconName }> = {
  desktop: { w: 1440, h: 900, label: "Desktop", icon: "monitor" },
  tablet: { w: 834, h: 1112, label: "Tablet", icon: "tablet" },
  phone: { w: 390, h: 844, label: "Phone", icon: "phone" },
};

// The studio's own address for a page (STUDIO_PAGE in api.ts), so a copy a browser kept from
// before the kit last changed is never used.
const pageOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.html?${STUDIO_PAGE}`;
const pictureOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.jpg`;

/**
 * Hand changes: everything the designer changed on a version without FRIDAY, waiting, shown
 * live on the page, until Save makes all of it one new version. Knobs moved, words typed
 * over, a part's own look, parts deleted.
 */
interface Hand {
  vars: Record<string, string>;
  words: WordEdit[];
  styles: PartStyleEdit[];
  removes: PartSeen[];
}
const NONE: Hand = { vars: {}, words: [], styles: [], removes: [] };
const handCount = (h: Hand) => Object.keys(h.vars).length + h.words.length + h.styles.length + h.removes.length;
/**
 * Hand changes not saved yet, per sketch and version. They outlive the studio closing, so
 * stepping to another version, FRIDAY delivering a new one, or Esc never drops them; only
 * Save and Put back empty them. (A reload of Panel does.)
 */
const pending = new Map<string, Hand>();
/**
 * Each version's steps, for ⌘Z and ⇧⌘Z: what the hand changes were before each step. `last`
 * is what the latest step changed and when, so one drag of a bar is one step, not a hundred.
 */
const histories = new Map<string, { past: Hand[]; future: Hand[]; last: { what: string; at: number } | null }>();
const historyOf = (key: string) => {
  let h = histories.get(key);
  if (!h) histories.set(key, (h = { past: [], future: [], last: null }));
  return h;
};
const pendingKey = (project: string, id: string, v: number) => `${project}/${id}/v${v}`;
/** The same words the kit and the server refuse in a part's own style. */
const badValue = (v: string) => v.length > 200 || /[;{}<>]|url\(/i.test(v);
const NOT_HERE = "This part is drawn by the page's script, so it can't be changed by hand here. Ask FRIDAY to change it.";

/** What can sit beside the page, besides FRIDAY's own panel. */
type Side = "knobs" | "directions" | "versions";

/** A part's own look, as the page itself makes it (without the changes being tried on it). */
export interface PartLook {
  /** The whole font stack. */
  family: string;
  size: number | null;
  weight: number | null;
  /** The weight comes from the font's "wght" axis (font-variation-settings), not font-weight. */
  wght: boolean;
  /** Its font-variation-settings, as computed ("" for none). */
  fvs: string;
  lineHeight: number | null;
  letterSpacing: number | null;
  color: string;
  background: string;
  /** Only when all four corners are the same. */
  radius: number | null;
  opacity: number | null;
  /** The font size of the part around it, for sizes that keep scaling with the page. */
  parentSize: number | null;
  /** How the page itself writes this part's size (3cqw, clamp(…)); null when it only inherits one. */
  sizeRule?: string | null;
  /** It has words of its own. */
  words: boolean;
}

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
  /** Where it sits, counted as the file is; "" when that can't be said. */
  path: string;
  own: PartLook | null;
  /** The page's knobs that reach it. */
  vars: string[];
  /** What the file is checked against: its class, id and first words. */
  cls: string;
  id: string;
  words: string;
}
const seenOf = (p: Picked): PartSeen => ({ path: p.path, cls: p.cls, id: p.id, text: p.words, label: p.label });

export function Studio(props: {
  project: string;
  sketch: StudioSketch;
  /** Changes on the canvas (a new sketch, a version): the family is read again. */
  stamp: string;
  /** FRIDAY is answering. */
  running: boolean;
  /** What FRIDAY is doing right now, in a few words ("Sketching Header alt"), while it answers. */
  doing: React.ReactNode;
  /** FRIDAY finished an answer while its panel was folded away, and it hasn't been looked at. */
  unread: boolean;
  /** FRIDAY's panel is showing beside the studio. */
  askOpen: boolean;
  setAskOpen: (open: boolean) => void;
  onClose: () => void;
  onSwitch: (id: string) => void;
  patch: (id: string, data: Record<string, unknown>) => void;
  /**
   * Ask FRIDAY about this sketch, or a part of it; `fan` makes that many alternates side by
   * side. `quiet` asks without opening FRIDAY's panel: the studio's bar shows what it's doing.
   */
  ask: (text: string, point?: SketchPoint, fan?: number, quiet?: boolean, figma?: { sketch: string; read: string; version?: number }) => void;
  /** The measured palettes of the saves on this canvas, to try on the sketch. */
  palettes: Palette[];
  /** From the side-by-side view: make a new sketch that takes these things from these sketches. */
  mix: (text: string, ids: string[]) => void;
  onBuilt: (title: string) => void;
  onError: (text: string) => void;
  /** The part selected, as FRIDAY would get it (null: none), so FRIDAY's own box can carry it. */
  onPick?: (point: SketchPoint | null) => void;
  /** Goes up by one when FRIDAY's box has sent the part selected, or it was taken off there. */
  letGo?: number;
  /** A letter typed with a part selected while FRIDAY's panel shows: it goes in FRIDAY's box. */
  typeToAsk?: (t: string) => void;
}) {
  const { project, sketch } = props;
  /** What Panel knows of the sketch (`of`: which one): its versions, states and family. */
  const [info, setInfo] = useState<(SketchInfo & { of: string }) | null>(null);
  const [device, setDevice] = useState<Device>(sketch.device ?? "desktop");
  const [states, setStates] = useState<{ name: string; slug: string }[]>([]);
  const [state, setState] = useState("");
  const [pointing, setPointing] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reload, setReload] = useState(0);
  // One page, or directions side by side; and which column, if any, is beside the one page.
  const [view, setView] = useState<"one" | "compare">("one");
  const [side, setSide] = useState<Side | null>(null);
  const [verdict, setVerdict] = useState<null | "chosen" | "ruled_out">(null);
  const [building, setBuilding] = useState(false);
  const [figmaOpen, setFigmaOpen] = useState(false);
  /** The small card under the title: the whole title and what this version tried. */
  const [aboutOpen, setAboutOpen] = useState(false);
  /** The view menu under the view chip, pinned where the chip is. */
  const [viewAt, setViewAt] = useState<DOMRect | null>(null);
  const [closing, setClosing] = useState(false);
  /** A short notice over the page when a new version arrives, saying where it came from. */
  const [fresh, setFresh] = useState<{ v: number; text: string; bad?: boolean } | null>(null);
  /** A part being kept as a brand asset (Keep in the part's strip). */
  const [keepBusy, setKeepBusy] = useState(false);
  // Words being edited in the page right now.
  const [editing, setEditing] = useState(false);
  /** When the designer last kept something themselves (knobs, words), so its new version isn't credited to FRIDAY. */
  const keptAt = useRef(0);
  /** The version just brought back from the Versions column, so its notice says so. */
  const broughtBack = useRef<number | null>(null);
  // Knobs: the page's own variables, what's been moved and not yet kept (on this version).
  const key = pendingKey(project, sketch.id, sketch.version);
  const [vars, setVars] = useState<PageVar[] | null>(null);
  /** Which fonts the page names and really has: a missing one shows as a stand-in. */
  const [pageFonts, setPageFonts] = useState<Record<string, boolean>>({});
  const [keeping, setKeeping] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  // The hand changes on the version showing, kept waiting there (in `pending`) until saved.
  const keyRef = useRef(key);
  keyRef.current = key;
  const [hand, setHandState] = useState<Hand>(() => pending.get(key) ?? NONE);
  const handRef = useRef(hand);
  handRef.current = hand;
  /** The hand changes waiting on a version (this one unless `at` says another). */
  const setHand = useCallback((next: Hand, at = keyRef.current) => {
    if (handCount(next)) pending.set(at, next);
    else pending.delete(at);
    if (at !== keyRef.current) return;
    handRef.current = next;
    setHandState(next);
  }, []);
  const edits = hand.vars;
  const words = hand.words;
  /** The version knob changes are being kept from: its new version starts with nothing pending. */
  const keepingFrom = useRef<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    stage.current = el;
    setStageEl(el);
  }, []);
  const [room, setRoom] = useState({ w: 1000, h: 700 });
  // A new screen size glides the frame and the page in it together; anything else (the window,
  // a column opening) changes them at once, so neither lags behind the other.
  const [glide, setGlide] = useState(false);

  useEffect(() => setDevice(sketch.device ?? "desktop"), [sketch.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    studioApi.sketch(project, sketch.id).then((i) => live && setInfo({ ...i, of: sketch.id })).catch(() => {});
    return () => {
      live = false;
    };
  }, [project, sketch.id, sketch.version, props.stamp]);

  /** A version this studio didn't know of yet: just made, not stepped to. */
  const isNew = (v: number) => !!info && info.of === sketch.id && !info.versions.some((x) => x.v === v);

  // A new version from FRIDAY: say so for a moment.
  const seen = useRef({ id: sketch.id, v: sketch.version });
  useEffect(() => {
    if (seen.current.id === sketch.id && sketch.version > seen.current.v && isNew(sketch.version)) {
      const mine = Date.now() - keptAt.current < 20_000;
      const back = mine ? broughtBack.current : null;
      broughtBack.current = null;
      setFresh({ v: sketch.version, text: back ? `v${back} brought back as v${sketch.version}` : mine ? `Saved as version ${sketch.version}` : `Version ${sketch.version} from FRIDAY` });
      setPicked(null);
      setEditing(false);
      const t = setTimeout(() => setFresh(null), 2600);
      seen.current = { id: sketch.id, v: sketch.version };
      return () => clearTimeout(t);
    }
    seen.current = { id: sketch.id, v: sketch.version };
  }, [sketch.id, sketch.version]);

  // ---- The room the page has ----
  // Measured on whichever stage is on the page now: Compare takes it away, and the one that
  // comes back is a new element. A stage being taken away reports 0×0; that isn't room.
  useLayoutEffect(() => {
    const el = stageEl;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setRoom({ w: el.clientWidth, h: el.clientHeight });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [stageEl]);
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
  // Where the page was scrolled, so the next version of the same sketch (stepped to, or just
  // made) opens at the same place and two versions can be compared by flipping. Another
  // sketch starts at the top. The page reports its scroll as it moves (the kit's "follow").
  const place = useRef<{ id: string; y: number }>({ id: sketch.id, y: 0 });
  const sketchNow = useRef(sketch.id);
  sketchNow.current = sketch.id;
  const movedSinceHello = useRef(false);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.panel) return;
      const m = e.data;
      if (m.t === "hello") {
        setStates(Array.isArray(m.states) ? m.states : []);
        setState(String(m.state ?? ""));
        if (pointingRef.current) post({ t: "pick", on: true });
        post({ t: "follow", on: true });
        movedSinceHello.current = false;
        if (place.current.id === sketchNow.current && place.current.y > 0) {
          // Again a moment later, once pictures and fonts have given the page its height,
          // unless the designer has scrolled it themselves since.
          const y = place.current.y;
          post({ t: "scroll", y });
          for (const ms of [300, 900]) setTimeout(() => !movedSinceHello.current && place.current.id === sketchNow.current && post({ t: "scroll", y }), ms);
        } else place.current = { id: sketchNow.current, y: 0 };
        // The page (re)loaded: read its knobs, and put back what was being tried (after the words).
        post({ t: "vars" });
        showHand(NONE, handRef.current);
      } else if (m.t === "vars") {
        const list: PageVar[] = Array.isArray(m.vars) ? m.vars : [];
        setVars(list);
        setPageFonts(m.fonts && typeof m.fonts === "object" ? m.fonts : {});
        // Changes carried over from the version before: only the ones this page still has.
        if (carried.current) {
          carried.current = false;
          const names = new Set(list.map((v) => v.name));
          const now = handRef.current;
          const kept = Object.fromEntries(Object.entries(now.vars).filter(([k]) => names.has(k)));
          if (Object.keys(kept).length !== Object.keys(now.vars).length) setHand({ ...now, vars: kept });
        }
      } else if (m.t === "scrolled") {
        place.current = { id: sketchNow.current, y: Number(m.y) || 0 };
        movedSinceHello.current = true;
      } else if (m.t === "state") {
        setState(String(m.state ?? ""));
        setPicked(null);
      } else if (m.t === "picked") {
        setPicked({
          label: m.label, selector: m.selector, text: m.text, html: m.html, style: m.style ?? {}, rect: m.rect, state: m.state ?? "", editable: !!m.editable,
          path: typeof m.path === "string" ? m.path : "", own: m.own && typeof m.own === "object" ? m.own : null, vars: Array.isArray(m.vars) ? m.vars : [],
          cls: String(m.cls ?? ""), id: String(m.id ?? ""), words: String(m.words ?? ""),
        });
      } else if (m.t === "moved") {
        // The part selected moved (the page scrolled, its look changed): the strip follows it.
        setPicked((p) => (p && m.rect ? { ...p, rect: m.rect } : p));
      } else if (m.t === "key") {
        partKeyRef.current(String(m.key ?? ""), !!m.mod, !!m.shift);
      } else if (m.t === "editing") {
        setEditing(!!m.on);
        // The bubble's box may have taken the keyboard on the first click: typing goes into the words.
        if (m.on) frame.current?.focus();
      } else if (m.t === "edited") {
        // Done with these words: let go of them, so the bubble doesn't sit over the next ones.
        setEditing(false);
        setPicked(null);
        post({ t: "release" });
        void addWords({ path: String(m.path ?? ""), before: String(m.before ?? ""), after: String(m.after ?? ""), before_text: String(m.beforeText ?? ""), after_text: String(m.afterText ?? "") });
      } else if (m.t === "cancel") {
        escapeRef.current(null);
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
  // Another sketch or version: its own hand changes, whatever was waiting on it. A version
  // that is new (FRIDAY's, not one stepped to) takes over the changes waiting on the one it came
  // from: knobs for the variables it still has (checked when the page lists them), words and
  // parts as far as they still fit its file (checked with the server).
  const shownKey = useRef(key);
  const carried = useRef(false);
  useLayoutEffect(() => {
    const was = shownKey.current;
    if (was === key) return;
    shownKey.current = key;
    carried.current = false;
    const sameSketch = was.startsWith(`${project}/${sketch.id}/v`);
    const handedOn = sameSketch && isNew(sketch.version) && keepingFrom.current !== was;
    let came: Hand | null = null;
    if (handedOn && pending.has(was) && !pending.has(key)) {
      came = pending.get(was)!;
      pending.set(key, came);
      pending.delete(was);
      histories.delete(was);
      carried.current = Object.keys(came.vars).length > 0;
    }
    setVars(null);
    setRulesOpen(false);
    const now = pending.get(key) ?? NONE;
    handRef.current = now;
    setHandState(now);
    if (came && came.words.length + came.styles.length + came.removes.length) void fitHand(key, sketch.version, came);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Shows on the page what changes from one set of hand changes to another: knobs set or
   * taken back, words put back and typed, parts' looks, parts hidden or shown again. Undo and
   * redo use it too, so the page always shows exactly what the list says, without loading again.
   */
  const showHand = useCallback((from: Hand, to: Hand) => {
    const vs: Record<string, string | null> = {};
    for (const k of Object.keys(from.vars)) if (!(k in to.vars)) vs[k] = null;
    for (const [k, v] of Object.entries(to.vars)) if (from.vars[k] !== v) vs[k] = v;
    if (Object.keys(vs).length) post({ t: "set", vars: vs });
    const same = (a: WordEdit, b: WordEdit) => a.path === b.path && a.before === b.before && a.after === b.after;
    const back = from.words.filter((w) => !to.words.some((x) => same(x, w))).reverse().map((w) => ({ path: w.path, before: w.after, after: w.before }));
    const ahead = to.words.filter((w) => !from.words.some((x) => same(x, w))).map((w) => ({ path: w.path, before: w.before, after: w.after }));
    if (back.length + ahead.length) post({ t: "text", edits: [...back, ...ahead] });
    for (const path of new Set([...from.styles, ...to.styles].map((x) => x.path))) {
      const a = from.styles.find((x) => x.path === path)?.props ?? {}, b = to.styles.find((x) => x.path === path)?.props ?? {};
      const props: Record<string, string | null> = {};
      for (const k of Object.keys(a)) if (!(k in b)) props[k] = null;
      for (const [k, v] of Object.entries(b)) if (a[k] !== v) props[k] = v;
      if (Object.keys(props).length) post({ t: "style", path, props });
    }
    for (const r of to.removes) if (!from.removes.some((x) => x.path === r.path)) post({ t: "remove", path: r.path, on: true });
    for (const r of from.removes) if (!to.removes.some((x) => x.path === r.path)) post({ t: "remove", path: r.path, on: false });
  }, [post]);

  /**
   * One step of hand changes on this version: shown on the page at once, and one ⌘Z away.
   * `same` names what changed; quick changes to the same thing (a drag of a bar, the color
   * picker moving) are one step. `onPage`: the page made the change itself (words typed there).
   */
  const step = useCallback((next: Hand, o: { same?: string; onPage?: boolean } = {}) => {
    const at = keyRef.current, h = historyOf(at), now = handRef.current;
    const merge = !!o.same && h.last?.what === o.same && Date.now() - h.last.at < 1200;
    if (!merge) {
      h.past.push(now);
      if (h.past.length > 200) h.past.shift();
    }
    h.future = [];
    h.last = o.same ? { what: o.same, at: Date.now() } : null;
    setHand(next, at);
    if (!o.onPage) showHand(now, next);
  }, [setHand, showHand]);
  const undo = useCallback((redo = false) => {
    const at = keyRef.current, h = historyOf(at), now = handRef.current;
    const to = redo ? h.future.pop() : h.past.pop();
    if (!to) return;
    (redo ? h.past : h.future).push(now);
    h.last = null;
    setHand(to, at);
    showHand(now, to);
  }, [setHand, showHand]);
  /** A change the server turned down: let go of it, everywhere in this version's steps too. */
  const letGo = (at: string, keep: (h: Hand) => Hand) => {
    const h = histories.get(at);
    if (h) {
      h.past = h.past.map(keep);
      h.future = h.future.map(keep);
    }
    const before = at === keyRef.current ? handRef.current : pending.get(at) ?? NONE;
    const after = keep(before);
    setHand(after, at);
    if (at === keyRef.current) showHand(before, after);
  };

  const turn = useCallback((changes: Record<string, string>) => {
    const names = Object.keys(changes);
    if (!names.length) return;
    const next = { ...handRef.current.vars, ...changes };
    // A knob put back where the page has it is no change at all.
    for (const k of names) if (vars?.find((v) => v.name === k)?.value.trim() === changes[k]!.trim()) delete next[k];
    step({ ...handRef.current, vars: next }, { same: `vars:${names.sort().join(",")}` });
  }, [step, vars]);
  /** Outlines on the page what a knob changes, while the pointer is on it. */
  const showVar = useCallback((name: string | null) => post({ t: "show", name }), [post]);

  /** Checks the hand changes on a version against its file; the message when they don't fit. */
  const fits = (h: Hand, v: number) =>
    studioApi.saveChanges(project, sketch.id, { edits: h.words, vars: {}, styles: h.styles, removes: h.removes }, v, true).then(() => null, (e: Error) => e.message);

  /** A part's own look, changed by hand: only that part changes. `props` null takes one back. */
  const stylePart = (part: PartSeen, props: Record<string, string | null>) => {
    if (!part.path) return props_error(NOT_HERE);
    if (Object.values(props).some((v) => v != null && badValue(v))) return props_error("That value can't be used here.");
    const now = handRef.current;
    const was = now.styles.find((x) => x.path === part.path);
    const merged: Record<string, string> = { ...(was?.props ?? {}) };
    for (const [k, v] of Object.entries(props)) {
      if (v == null) delete merged[k];
      else merged[k] = v;
    }
    const styles = now.styles.filter((x) => x.path !== part.path);
    if (Object.keys(merged).length) styles.push({ ...part, props: merged });
    const next = { ...now, styles };
    step(next, { same: `style:${part.path}:${Object.keys(props).sort().join(",")}` });
    // A part changed for the first time is checked against the file at once.
    if (!was) {
      const at = keyRef.current;
      void fits(next, sketch.version).then((problem) => {
        if (!problem) return;
        props_error(problem);
        letGo(at, (h) => ({ ...h, styles: h.styles.filter((x) => x.path !== part.path) }));
      });
    }
  };
  const props_error = (t: string) => props.onError(t);
  /** Delete a part: it's hidden at once and lets go of being selected; Save takes it out of the file. */
  const deletePart = (part: PartSeen) => {
    setPicked(null);
    post({ t: "release" });
    if (!part.path) return props_error(NOT_HERE);
    const now = handRef.current;
    if (now.removes.some((x) => x.path === part.path)) return;
    const next = { ...now, removes: [...now.removes, part] };
    step(next);
    const at = keyRef.current;
    void fits(next, sketch.version).then((problem) => {
      if (!problem) return;
      props_error(problem);
      letGo(at, (h) => ({ ...h, removes: h.removes.filter((x) => x.path !== part.path) }));
    });
  };

  /**
   * Save: everything changed by hand on this version becomes one new version together.
   * Only knob values the browser accepts are written into the page.
   */
  const save = async (): Promise<{ version?: number; failed?: true }> => {
    const h = handRef.current;
    const good = Object.fromEntries(Object.entries(h.vars).filter(([, v]) => v.trim() && !/[;{}<>]/.test(v)));
    if ((!Object.keys(good).length && !h.words.length && !h.styles.length && !h.removes.length) || keeping) return {};
    setKeeping(true);
    keptAt.current = Date.now();
    const from = key;
    keepingFrom.current = from;
    try {
      const res = await studioApi.saveChanges(project, sketch.id, { edits: h.words, vars: good, styles: h.styles, removes: h.removes }, sketch.version);
      // Saved: nothing waits on that version any more, and its new version starts clean.
      pending.delete(from);
      histories.delete(from);
      if (shownKey.current === from) {
        setHand(NONE, from);
        // Nothing changed in the file after all: show the page as it really is.
        if (res.version === sketch.version) setReload((n) => n + 1);
      }
      // The live page looked whole (its script had already run), but the saved one has to
      // run it again. If that now fails, say so and say how to get back.
      if (res.new_errors && res.version && res.version !== sketch.version) {
        props.onError(
          h.removes.length
            ? `Saved as version ${res.version}, but the page's own script now stops: it needed a part you deleted. Press ‹ to go back to v${sketch.version}.`
            : `Saved as version ${res.version}, but the page now reports an error it didn't before. Press ‹ to go back to v${sketch.version}.`,
        );
      }
      return { version: res.version };
    } catch (e) {
      props.onError((e as Error).message);
      return { failed: true };
    } finally {
      setKeeping(false);
      // A moment longer, in case the new version is still on its way to the canvas.
      setTimeout(() => {
        if (keepingFrom.current === from) keepingFrom.current = null;
      }, 4000);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /**
   * Keep: the part selected becomes one of the project's brand assets, as a real file. Changes
   * waiting by hand are saved first (as Save does), so what is kept is what the designer sees:
   * it is kept from that new version, on the screen and in the state showing.
   */
  const keepPart = async (p: Picked) => {
    if (keepBusy) return;
    setKeepBusy(true);
    const say = (text: string, bad = false) => {
      setFresh({ v: sketch.version, text, bad: bad || undefined });
      setTimeout(() => setFresh((f) => (f?.text === text ? null : f)), 2600);
    };
    try {
      let v = sketch.version;
      if (handCount(handRef.current)) {
        const saved = await save();
        if (saved.failed) return;
        if (saved.version) v = saved.version;
      }
      await studioApi.keep(project, sketch.id, { selector: p.selector, version: v, device, ...(p.state || state ? { state: p.state || state } : {}) });
      say("Kept in Brand assets");
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      setKeepBusy(false);
    }
  };
  /** Put back everything not saved on this version, as one step (⌘Z brings it all back). */
  const putBack = () => step(NONE);

  /**
   * Words the designer just edited in the page. They wait with the others until Save, but are
   * checked against the file now, so words Panel can't find there are turned down at once.
   * The same part edited twice is one change, from its first words to its last.
   */
  const addWords = async (edit: WordEdit) => {
    if (edit.after === edit.before) return;
    const at = keyRef.current, v = sketch.version;
    const now = handRef.current;
    const list = [...now.words];
    const same = list.findIndex((x) => x.path === edit.path && x.after === edit.before);
    if (same >= 0) {
      const first = list[same]!;
      if (edit.after === first.before) list.splice(same, 1);
      else list[same] = { ...first, after: edit.after, after_text: edit.after_text };
    } else list.push(edit);
    const next = { ...now, words: list };
    step(next, { onPage: true });
    if (!list.length) return;
    const problem = await fits(next, v);
    if (!problem) return;
    props.onError(problem);
    // Let this one go: the words go back to what they were on the page, and out of the list.
    const gone = (w: WordEdit) => w.path === edit.path;
    letGo(at, (h) => ({ ...h, words: h.words.filter((w) => !gone(w) || now.words.includes(w)) }));
    if (at === keyRef.current) post({ t: "text", edits: [{ path: edit.path, before: edit.after, after: edit.before }] });
  };
  /**
   * Hand changes carried over to a new version from FRIDAY: the ones that no longer fit its
   * file (FRIDAY changed those words too, or that part) are let go, and the designer is told.
   */
  const fitHand = async (at: string, v: number, came: Hand) => {
    if (!(await fits(came, v))) return;
    const kept: Hand = { vars: came.vars, words: [], styles: [], removes: [] };
    for (const w of came.words) if (!(await fits({ ...kept, words: [...kept.words, w] }, v))) kept.words.push(w);
    for (const x of came.styles) if (!(await fits({ ...kept, styles: [...kept.styles, x] }, v))) kept.styles.push(x);
    for (const x of came.removes) if (!(await fits({ ...kept, removes: [...kept.removes, x] }, v))) kept.removes.push(x);
    if (pending.get(at) !== came) return;
    setHand(kept, at);
    const gone = handCount(came) - handCount(kept);
    props.onError(`${gone === 1 ? "One change" : `${gone} changes`} you hadn't saved didn't fit the new version, so ${gone === 1 ? "it was" : "they were"} let go.`);
    if (at === keyRef.current) setReload((n) => n + 1);
  };

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(props.onClose, 160);
  }, [props.onClose]);

  const versions = info?.versions ?? [];
  const at = versions.findIndex((v) => v.v === sketch.version);
  const stepTo = (dir: -1 | 1) => {
    const next = versions[at + dir];
    if (next) props.patch(sketch.id, { version: next.v });
  };
  const errors = versions[at]?.errors ?? 0;
  const rules: RuleFinding[] = versions[at]?.rules ?? [];
  const breaks = rules.filter((r) => r.level === "breaks").length;
  const family = info?.family ?? [];
  const hasDirections = family.length > 1;

  // ---- The one column beside the page, and Compare ----
  const { askOpen, setAskOpen } = props;
  /** Who has the column: FRIDAY's panel whenever it shows, else Knobs, Directions or Versions, else no one. */
  const column: Side | "friday" | null = askOpen ? "friday" : view === "compare" ? null : side;
  /** Knobs or Directions folded FRIDAY away: closing them brings it back. */
  const folded = useRef(false);
  /** FRIDAY was showing before Compare folded it away: leaving Compare brings it back. */
  const fridayBeforeCompare = useRef(false);
  // FRIDAY opened some other way (⌘J, its own button): it takes the column.
  useEffect(() => {
    if (!askOpen) return;
    setSide(null);
    folded.current = false;
    fridayBeforeCompare.current = false;
  }, [askOpen]);
  // Leaving the studio with FRIDAY folded away by it: FRIDAY comes back as it was.
  const restore = useRef(setAskOpen);
  restore.current = setAskOpen;
  useEffect(() => () => {
    if (folded.current || fridayBeforeCompare.current) restore.current(true);
  }, []);

  /** The column switch: press one to show it there, press the lit one again to close the column. */
  const toggleColumn = (c: Side | "friday") => {
    if (c === "friday") {
      folded.current = false;
      fridayBeforeCompare.current = false;
      if (askOpen) setAskOpen(false);
      else {
        setSide(null);
        setAskOpen(true);
      }
      return;
    }
    if (view === "compare") {
      // Knobs and Directions belong to one page: back to it.
      if (fridayBeforeCompare.current) folded.current = true;
      fridayBeforeCompare.current = false;
      setView("one");
    } else if (column === c) {
      setSide(null);
      if (folded.current) {
        folded.current = false;
        setAskOpen(true);
      }
      return;
    }
    if (askOpen) {
      folded.current = true;
      setAskOpen(false);
    }
    setSide(c);
  };
  const enterCompare = () => {
    // The pages get all the width; whatever was beside the page comes back after.
    fridayBeforeCompare.current = askOpen;
    if (askOpen) setAskOpen(false);
    setPointing(false);
    setView("compare");
  };
  const leaveCompare = () => {
    setView("one");
    if (fridayBeforeCompare.current && !askOpen) setAskOpen(true);
    fridayBeforeCompare.current = false;
  };
  const leaveCompareRef = useRef(leaveCompare);
  leaveCompareRef.current = leaveCompare;
  const toggleColumnRef = useRef(toggleColumn);
  toggleColumnRef.current = toggleColumn;

  // Escape steps back one thing at a time: what's pointed at, pointing, Compare, an open
  // card or dialog, and then out of the studio to the canvas. In a field with words in it, it only
  // lets go of the field (so nothing typed is lost); in an empty one it carries on as usual.
  // The page passes its Escape up too (see the kit in sketches.ts), so it works after a click
  // on the sketch.
  const escape = (field: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null) => {
    if (picked) {
      setPicked(null);
      post({ t: "release" });
      return;
    }
    if (field) {
      const words = "value" in field ? field.value.trim() : (field.textContent ?? "").trim();
      field.blur();
      if (words) return;
    }
    if (aboutOpen) setAboutOpen(false);
    else if (pointing) setPointing(false);
    else if (view === "compare") leaveCompareRef.current();
    else if (verdict || building || figmaOpen) {
      setVerdict(null);
      setBuilding(false);
      setFigmaOpen(false);
    } else close();
  };
  const escapeRef = useRef(escape);
  escapeRef.current = escape;
  /** The studio's single-letter keys: P points, K, D and V open and close their columns. */
  const letterKey = (key: string) => {
    const k = key.toLowerCase();
    if (k === "p" && view === "one") setPointing((v) => !v);
    else if (k === "k") toggleColumnRef.current("knobs");
    else if (k === "d") toggleColumnRef.current("directions");
    else if (k === "v") toggleColumnRef.current("versions");
    else return false;
    return true;
  };
  const letterKeyRef = useRef(letterKey);
  letterKeyRef.current = letterKey;
  /** Edit the selected part's words right there in the page. */
  const editWords = () => {
    // The page takes the keyboard, so typing goes into the words.
    frame.current?.focus();
    post({ t: "edit" });
  };
  /** Knobs for the selected part: the Knobs column, opened on it (or closed again). */
  const knobsForPart = () => toggleColumnRef.current("knobs");
  /**
   * The studio's keys, from the studio itself or passed up by the page (after a click on it,
   * the keyboard is the page's): ⌘Z and ⇧⌘Z step back and forward through hand changes, ⌘S
   * saves; with a part selected, Delete deletes it, Enter edits its words, K opens Knobs on it
   * and any other letter starts a message about it; otherwise P, K, D and V.
   */
  const studioKey = (k: string, mod: boolean, shift: boolean) => {
    if (mod) {
      if (k.toLowerCase() === "z") undo(shift);
      else if (k.toLowerCase() === "s") void saveRef.current();
      else return false;
      return true;
    }
    if (editing) return false;
    const p = picked;
    if (p) {
      if (k === "Delete" || k === "Backspace") deletePart(seenOf(p));
      else if (k === "Enter") {
        if (!p.editable) return false;
        editWords();
      } else if (k.toLowerCase() === "k") knobsForPart();
      else if (/^[\p{L}\p{N}]$/u.test(k)) typeToAskRef.current(k);
      else return false;
      return true;
    }
    return letterKeyRef.current(k);
  };
  const partKeyRef = useRef(studioKey);
  partKeyRef.current = studioKey;
  /** A letter typed with a part selected: the start of a message about it (see the ask boxes). */
  const typeToAskRef = useRef<(k: string) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.<HTMLElement>("input, textarea, [contenteditable]") ?? null;
      if (e.key === "Escape") {
        if (!e.defaultPrevented) escapeRef.current(typing);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      // ⌘S saves from anywhere in the studio; ⌘Z is the field's own while typing in one.
      if (mod && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
        return;
      }
      if (typing || e.altKey || e.repeat || e.isComposing || (e.target as HTMLElement)?.closest?.("[role=slider], .popover")) return;
      if (mod && e.key.toLowerCase() !== "z") return;
      if (partKeyRef.current(e.key, mod, e.shiftKey)) e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // ---- Asking ----
  // Always without opening FRIDAY's panel: if it's folded away, the bar says what it's doing,
  // and the page and the column beside it stay where they are. A part selected goes with the
  // message: the bar (or FRIDAY's own box, when its panel shows) carries it as a chip.
  const pointOf = (p: Picked, mode: "change" | "alternates" = "change"): SketchPoint => ({
    sketch: sketch.id, version: sketch.version, label: p.label, selector: p.selector, text: p.text,
    html: p.html, style: p.style, state: p.state || undefined, device, mode,
  });
  const ask = (text: string, mode: "change" | "alternates" = "change") => {
    const t = text.trim();
    if (!t && mode === "change") return;
    if (picked) {
      props.ask(t || "Try alternates of this.", pointOf(picked, mode), mode === "alternates" ? 3 : undefined, true);
      setPicked(null);
      setPointing(false);
    } else props.ask(t, undefined, undefined, true);
  };
  /** Lets go of the part selected: nothing is selected on the page any more. */
  const letGoOfPart = () => {
    setPicked(null);
    post({ t: "release" });
  };
  // FRIDAY's own box carries the part selected; when it sends it (or it's taken off there), let go.
  // (Told only when the part itself changes: the app passes a new function every time.)
  const onPick = useRef(props.onPick);
  onPick.current = props.onPick;
  const pickedPoint = picked && !editing ? JSON.stringify(pointOf(picked)) : "";
  useEffect(() => {
    onPick.current?.(pickedPoint ? (JSON.parse(pickedPoint) as SketchPoint) : null);
  }, [pickedPoint]);
  useEffect(() => () => onPick.current?.(null), []);
  const firstLetGo = useRef(props.letGo);
  useEffect(() => {
    if (props.letGo === firstLetGo.current) return;
    firstLetGo.current = props.letGo;
    letGoOfPart();
  }, [props.letGo]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The ask bar's own way to take a letter (see AskBar). */
  const barType = useRef<((t: string) => void) | null>(null);
  typeToAskRef.current = (k: string) => {
    if (askOpen) props.typeToAsk?.(k);
    else barType.current?.(k);
  };
  const alternates = () => props.ask("Try 3 alternates of this sketch, each a different direction for the whole page.", undefined, 3, true);

  // The title's card closes on a click anywhere else, like a menu.
  useEffect(() => {
    if (!aboutOpen) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".st-about, .st-title")) setAboutOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [aboutOpen]);
  useEffect(() => setAboutOpen(false), [sketch.id, sketch.version]);

  // A new screen size: the frame and the page in it glide together, for that moment only.
  const firstDevice = useRef(true);
  useEffect(() => {
    if (firstDevice.current) {
      firstDevice.current = false;
      return;
    }
    setGlide(true);
    const t = setTimeout(() => setGlide(false), 400);
    return () => clearTimeout(t);
  }, [device]);

  // Where the strip goes: under the part selected (above it when there's no room), centred on
  // it, in the stage's own coordinates.
  const STRIP = { w: editing ? 300 : (picked?.editable ? 4 : 3) * 30 + 10, h: 38 };
  const strip = (() => {
    if (!picked || !stage.current || !frame.current) return null;
    const fr = frame.current.getBoundingClientRect(), st = stage.current.getBoundingClientRect();
    const x = fr.left - st.left + (picked.rect.x + picked.rect.w / 2) * fit.scale;
    const below = fr.top - st.top + (picked.rect.y + picked.rect.h) * fit.scale + 10;
    const above = fr.top - st.top + picked.rect.y * fit.scale - 10 - STRIP.h;
    const top = below + STRIP.h + 8 > st.height ? Math.max(above, 8) : below;
    return { left: Math.min(Math.max(x - STRIP.w / 2, 8), st.width - STRIP.w - 8), top: Math.min(Math.max(top, 8), st.height - STRIP.h - 8) };
  })();

  /** The versions of this sketch with hand changes waiting on them. */
  const waitingOn = new Set(
    [...pending.keys()].flatMap((k) => {
      const m = k.match(/\/v(\d+)$/);
      return m && k.startsWith(`${project}/${sketch.id}/v`) ? [Number(m[1])] : [];
    }),
  );
  /** Bring an older version back as the newest; the notice over the page says so when it arrives. */
  const bringBack = async (v: number) => {
    keptAt.current = Date.now();
    broughtBack.current = v;
    try {
      await studioApi.restore(project, sketch.id, v);
    } catch (e) {
      broughtBack.current = null;
      props.onError((e as Error).message);
    }
  };

  /** Changes made in Knobs (the page's knobs, parts' looks) are waiting on this version while Knobs is closed. */
  const waiting = Object.keys(edits).length + hand.styles.length > 0 && column !== "knobs";
  /** Everything changed by hand on this version and not saved yet: knobs, words, looks, deleted parts. */
  const unsaved = handCount(hand);
  const comparing = view === "compare" && hasDirections;
  const nextVersion = (versions.at(-1)?.v ?? sketch.version) + 1;
  const pct = Math.round(fit.scale * 100);
  /** What this version tried, in a line: written with the version, or the sketch's own line for its newest. */
  const tried = sketch.tries && (at < 0 || at === versions.length - 1) ? sketch.tries : "";
  const chosen = sketch.state === "chosen", ruledOut = sketch.state === "ruled_out";

  return (
    <div
      className={`studio ${closing ? "closing" : ""}`}
      role="dialog"
      aria-label={sketch.title}
      // An icon clicked with the mouse lets go of the keyboard: otherwise the next key pressed
      // (K, D, V…) makes the browser treat it as reached by keyboard, and its name pops up
      // under it and stays there, over the column that just opened. Tab still shows names.
      onClick={(e) => {
        if (e.detail > 0) (e.target as HTMLElement).closest?.<HTMLElement>("[data-tip]")?.blur();
      }}
    >
      <header className="st-head">
        {/* What this is */}
        <button className="st-icon tip-start" onClick={close} aria-label="Back to the canvas" data-tip="Back to the canvas (Esc)"><Icon name="arrow-left" size={15} /></button>
        <div className="st-name">
          <button className="st-title" onClick={() => setAboutOpen((v) => !v)} aria-expanded={aboutOpen} aria-haspopup="dialog">
            {/* A wireframe says so, quietly (not twice when its title already does). */}
            {sketch.wire && !/^wireframe\b/i.test(sketch.title) && <span className="st-wire">Wireframe · </span>}
            {sketch.title || "Untitled sketch"}
          </button>
          {aboutOpen && (
            <div className="st-pop st-about" role="dialog" aria-label="About this sketch">
              <p className="st-pop-title">{sketch.title || "Untitled sketch"}</p>
              {tried ? (
                <>
                  <p className="st-about-label">What this version tried</p>
                  <p className="st-pop-text">{tried}</p>
                </>
              ) : (
                <p className="st-pop-text">Version {sketch.version}.</p>
              )}
            </div>
          )}
        </div>
        <div className="st-versions" aria-label="Versions">
          <button className="st-icon sm" disabled={at <= 0} onClick={() => stepTo(-1)} aria-label="Earlier version" data-tip="Earlier version"><Icon name="chevron-left" size={14} /></button>
          <button className={`st-v ${fresh ? "fresh" : ""} ${column === "versions" ? "on" : ""}`} onClick={() => toggleColumn("versions")} aria-pressed={column === "versions"} aria-label={`Version ${sketch.version}: all versions (V)`} data-tip="All versions (V)">
            v{sketch.version}
          </button>
          <button className="st-icon sm" disabled={at < 0 || at >= versions.length - 1} onClick={() => stepTo(1)} aria-label="Later version" data-tip="Later version"><Icon name="chevron-right" size={14} /></button>
        </div>
        <span className="st-gap" />

        {/* How it is seen */}
        <button
          className={`st-icon ${pointing ? "on" : ""}`}
          onClick={() => {
            if (comparing) leaveCompare();
            setPointing((v) => (comparing ? true : !v));
          }}
          aria-pressed={pointing}
          aria-label="Point at a part (P)"
          data-tip="Point at a part (P)"
        >
          <Icon name="point" size={15} />
        </button>
        <button
          className={`st-icon st-compare ${comparing ? "on" : ""}`}
          disabled={!hasDirections}
          onClick={() => (comparing ? leaveCompare() : enterCompare())}
          aria-pressed={comparing}
          aria-label="Compare directions side by side"
          data-tip={hasDirections ? "Compare directions side by side" : "Compare directions side by side (needs a second direction)"}
        >
          <Icon name="compare" size={15} />
        </button>
        <span className="st-sep" />

        <button className={`st-icon ${column === "knobs" ? "on" : ""}`} aria-pressed={column === "knobs"} onClick={() => toggleColumn("knobs")} aria-label="Knobs (K)" data-tip={waiting ? "Knobs (K) · changes not saved" : "Knobs (K)"}>
          <Icon name="sliders" size={15} />
          {waiting && <i className="st-dot" aria-label="changes not saved yet" />}
        </button>
        <button className={`st-icon wide ${column === "directions" ? "on" : ""}`} aria-pressed={column === "directions"} onClick={() => toggleColumn("directions")} aria-label={`Directions (D): ${family.length || 1}`} data-tip="Directions (D)">
          <Icon name="branch" size={15} />
          <span className="st-count">{family.length || 1}</span>
        </button>
        <button className={`st-icon ${column === "friday" ? "on" : ""}`} aria-pressed={column === "friday"} onClick={() => toggleColumn("friday")} aria-label="FRIDAY (⌘J)" data-tip="FRIDAY (⌘J)">
          <Mark size={15} active={props.running} />
          {props.unread && !askOpen && <i className="st-dot" aria-label="a new answer" />}
        </button>
        <span className="st-sep" />

        {/* What to do with it */}
        <div className="st-verdict">
          <button
            className={`st-icon ${chosen ? "dark" : ""}`}
            aria-pressed={chosen}
            aria-label={chosen ? "Chosen · click to undo" : "Choose"}
            data-tip={chosen ? "Chosen · click to undo" : "Choose"}
            onClick={() => (chosen ? props.patch(sketch.id, { state: "kept", reason: "" }) : setVerdict("chosen"))}
          >
            <Icon name="check" size={15} />
          </button>
          <button
            // Its name hangs from its right edge: in a narrow studio it's the last icon in the row.
            className={`st-icon st-ruleout ${ruledOut ? "dark" : ""}`}
            aria-pressed={ruledOut}
            aria-label={ruledOut ? "Ruled out · click to undo" : "Rule out"}
            data-tip={ruledOut ? "Ruled out · click to undo" : "Rule out"}
            onClick={() => (ruledOut ? props.patch(sketch.id, { state: "kept", reason: "" }) : setVerdict("ruled_out"))}
          >
            <Icon name="x" size={15} />
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
        <span className="st-sep st-sep-hand" />
        {/* To Figma and back, and handing it to Claude Code: rare, so quiet icons, their actions under them. */}
        <button className={`st-icon st-figma-toggle tip-end ${figmaOpen ? "on" : ""}`} onClick={() => setFigmaOpen((v) => !v)} aria-label="Figma" aria-expanded={figmaOpen} data-tip="Figma">
          <Icon name="figma" size={15} />
        </button>
        {figmaOpen && (
          <FigmaSheet
            project={project}
            sketch={sketch}
            device={device}
            state={states.length > 1 ? state || states[0]!.slug : ""}
            stateName={states.length > 1 ? (states.find((x) => x.slug === state) ?? states[0])!.name : ""}
            last={info?.of === sketch.id ? info.figma : undefined}
            nextVersion={nextVersion}
            running={props.running}
            onClose={() => setFigmaOpen(false)}
            onRead={(r) => {
              setFigmaOpen(false);
              props.ask(`Bring “${sketch.title || "this sketch"}” back from Figma as a new version, from the frame “${r.frame}”.`, undefined, undefined, true, { sketch: sketch.id, read: r.read, version: r.base_version });
            }}
          />
        )}
        <button className={`st-icon st-build tip-end ${building ? "on" : ""}`} onClick={() => setBuilding(true)} aria-label="Build with Claude Code" aria-expanded={building} data-tip="Build with Claude Code">
          <Icon name="build" size={15} />
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
        {comparing ? (
          <Compare
            project={project}
            family={family}
            current={sketch.id}
            device={device}
            running={props.running}
            patch={props.patch}
            onOpen={(sid) => {
              leaveCompare();
              if (sid !== sketch.id) props.onSwitch(sid);
            }}
            onMix={props.mix}
          />
        ) : (
        <div className="st-main">
          <div className="st-bar">
            {states.length > 1 && (
              <div className="st-states" role="tablist" aria-label="States">
                {states.map((s, i) => {
                  const on = (state || states[0]!.slug) === s.slug || (!state && i === 0);
                  return (
                    <button key={s.slug} role="tab" aria-selected={on} className={on ? "on" : ""} onClick={() => post({ t: "state", slug: i === 0 ? "" : s.slug })}>
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
            <span className="st-gap" />
            <div className="st-bar-end">
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
              {unsaved > 0 && (
                <span className="st-unsaved" role="group" aria-label="Changes not saved">
                  <span className="st-unsaved-text">{unsaved} {unsaved === 1 ? "change" : "changes"} not saved</span>
                  <button className="st-quiet sm" disabled={keeping} onClick={putBack} title="Put back every change not saved yet">Put back</button>
                  <button className="st-send sm" disabled={keeping} onClick={() => void save()} title="Save every change as one new version (⌘S)">{keeping ? "Saving…" : `Save as v${nextVersion}`}</button>
                </span>
              )}
              <button
                className={`st-view ${viewAt ? "open" : ""}`}
                onClick={(e) => setViewAt(viewAt ? null : e.currentTarget.getBoundingClientRect())}
                aria-haspopup="menu"
                aria-expanded={!!viewAt}
                aria-label={`${d.label}, shown at ${pct}%`}
              >
                <Icon name={d.icon} size={13} />
                <span>{pct}%</span>
                <Icon name="chevron-down" size={11} />
              </button>
              {viewAt && (
                <ViewMenu
                  at={viewAt}
                  device={device}
                  src={src}
                  size={`${d.w}×${device === "desktop" ? Math.round(fit.h) : d.h}, shown at ${pct}%`}
                  onDevice={(k) => {
                    setDevice(k);
                    setViewAt(null);
                  }}
                  onReload={() => {
                    setReload((n) => n + 1);
                    setViewAt(null);
                  }}
                  onClose={() => setViewAt(null)}
                />
              )}
            </div>
          </div>
          <div className={`st-stage ${device} ${glide ? "glide" : ""}`} ref={stageRef}>
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
            {picked && strip && (
              <PointStrip
                key={picked.selector}
                picked={picked}
                style={strip}
                editing={editing}
                knobsOn={column === "knobs"}
                running={props.running}
                onEdit={editWords}
                onEditEnd={(keep) => post({ t: "edit-end", keep })}
                onAlternates={() => ask("", "alternates")}
                onKnobs={knobsForPart}
                onDelete={() => deletePart(seenOf(picked))}
                keeping={keepBusy}
                onKeep={() => void keepPart(picked)}
              />
            )}
            {fresh && <div className={`st-fresh ${fresh.bad ? "bad" : ""}`} key={`${fresh.v}:${fresh.text}`} role="status">{fresh.text}</div>}
          </div>
          {!askOpen && (
            <AskBar
              running={props.running}
              doing={props.doing}
              unread={props.unread}
              part={picked && !editing ? picked.label : null}
              typeRef={barType}
              onLetGo={letGoOfPart}
              onSend={(t) => ask(t)}
              onShow={() => toggleColumn("friday")}
            />
          )}
        </div>
        )}

        {column === "knobs" && (
          <Knobs
            vars={vars}
            fonts={pageFonts}
            edits={edits}
            palettes={props.palettes}
            onChange={turn}
            part={picked?.own ? { path: picked.path, label: picked.label, look: picked.own, vars: picked.vars, props: hand.styles.find((x) => x.path === picked.path)?.props ?? {} } : null}
            onPart={(p) => picked && stylePart(seenOf(picked), p)}
            onClose={() => toggleColumn("knobs")}
            onAskForKnobs={() => props.ask("Rewrite this sketch so its colors, fonts, type sizes, corner radius and spacing are CSS variables on :root (--bg, --surface, --ink, --muted, --accent, --font-display, --font-text, --radius, --space and whatever else it needs), used everywhere in place of the fixed values. Give each one a short note in plain words beside it where its name doesn't say it (--c1: #e2372b; /* Cortex */). Change nothing about how it looks.", undefined, undefined, true)}
            onShow={showVar}
          />
        )}
        {column === "directions" && (
          <aside className="st-rail" aria-label="Directions">
            <RailHead name="Directions" onClose={() => toggleColumn("directions")}>
              <button className="st-quiet sm st-rail-act" onClick={alternates} disabled={props.running} title={props.running ? "After FRIDAY's answer" : "Three new directions from this sketch, made at the same time"}>
                3 alternates
              </button>
            </RailHead>
            <div className="st-tree">
              {(family.length ? family : [{ id: sketch.id, title: sketch.title, tries: sketch.tries, state: sketch.state ?? "kept", version: sketch.version, reason: sketch.reason }]).map((f) => (
                <button key={f.id} className={`st-dir s-${f.state} ${f.id === sketch.id ? "on" : ""}`} onClick={() => f.id !== sketch.id && props.onSwitch(f.id)} title={f.tries ?? f.title}>
                  <img src={pictureOf(project, f.id, f.version)} alt="" draggable={false} loading="lazy" />
                  <span className="st-dir-text">
                    <span className="st-dir-title">{f.title || "Untitled sketch"}</span>
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
        {column === "versions" && (
          <Versions
            project={project}
            sketch={sketch.id}
            versions={info?.of === sketch.id ? versions : []}
            current={sketch.version}
            waiting={waitingOn}
            onShow={(v) => props.patch(sketch.id, { version: v })}
            onRestore={bringBack}
            onClose={() => toggleColumn("versions")}
          />
        )}
        {/* FRIDAY's own panel shows here: the studio keeps its place, the panel sits over it. */}
        {column === "friday" && <div className="st-rail st-slot" aria-hidden />}
      </div>
    </div>
  );
}

/**
 * The view chip's menu: which screen the page is shown on, reloading it, opening it in a tab
 * of its own, and at the bottom what size it really is and at what scale it's shown.
 */
function ViewMenu(props: { at: DOMRect; device: Device; src: string; size: string; onDevice: (d: Device) => void; onReload: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!box.current?.contains(t) && !t?.closest?.(".st-view")) onClose();
    };
    // Escape closes the menu only, not the studio behind it.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
      removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={box} className="popover st-view-menu" role="menu" aria-label="View" style={{ top: props.at.bottom + 6, right: Math.max(8, innerWidth - props.at.right) }}>
      {(Object.keys(DEVICES) as Device[]).map((k) => (
        <button key={k} className={`menu-item ${props.device === k ? "on" : ""}`} role="menuitemradio" aria-checked={props.device === k} onClick={() => props.onDevice(k)}>
          <span className="menu-check">{props.device === k && <Icon name="check" size={13} />}</span>
          <Icon name={DEVICES[k].icon} size={14} />
          <span className="st-view-name">{DEVICES[k].label}</span>
          <span className="st-view-size">{DEVICES[k].w}×{DEVICES[k].h}</span>
        </button>
      ))}
      <div className="menu-sep" />
      <button className="menu-item" role="menuitem" onClick={props.onReload}>
        <span className="menu-check" />
        <Icon name="refresh" size={14} />
        <span className="st-view-name">Reload the page</span>
      </button>
      <a className="menu-item" role="menuitem" href={props.src} target="_blank" rel="noopener noreferrer" onClick={props.onClose}>
        <span className="menu-check" />
        <Icon name="external" size={14} />
        <span className="st-view-name">Open in a new tab</span>
      </a>
      <p className="st-view-foot">{props.size}</p>
    </div>,
    document.body,
  );
}

/**
 * Under the part selected: one row of icons, each saying its name on hover. Edit its words
 * (only for a part made of words), three alternates of it, Knobs for it, Delete it. No card
 * and no box to type in: asking FRIDAY about the part happens in the ask box, which carries it.
 * While its words are being edited, the row says how to finish.
 */
function PointStrip(props: {
  picked: Picked;
  style: { left: number; top: number };
  editing: boolean;
  knobsOn: boolean;
  running: boolean;
  onEdit: () => void;
  onEditEnd: (keep: boolean) => void;
  onAlternates: () => void;
  onKnobs: () => void;
  onDelete: () => void;
  /** Keeping it as a brand asset right now. */
  keeping: boolean;
  onKeep: () => void;
}) {
  const { picked } = props;
  // Clicks on the strip stay on the strip (the page would take them as pointing).
  const hold = (e: React.PointerEvent) => e.stopPropagation();
  if (props.editing) {
    return (
      <div className="st-strip editing" style={props.style} onPointerDown={hold} role="toolbar" aria-label="Editing the words">
        <span className="st-strip-say">Editing · ↵ done · Esc put back</span>
        <button className="st-quiet sm" onClick={() => props.onEditEnd(false)}>Put back</button>
        <button className="st-send sm" onClick={() => props.onEditEnd(true)}>Done</button>
      </div>
    );
  }
  return (
    <div className="st-strip" style={props.style} onPointerDown={hold} role="toolbar" aria-label={picked.label}>
      {picked.editable && (
        <button className="st-icon" onClick={props.onEdit} aria-label="Edit the words (↵)" data-tip="Edit the words (↵)">
          <Icon name="pencil" size={15} />
        </button>
      )}
      <button className="st-icon" onClick={props.onAlternates} disabled={props.running} aria-label="3 alternates of this" data-tip={props.running ? "3 alternates of this · after FRIDAY's answer" : "3 alternates of this"}>
        <Icon name="branch" size={15} />
      </button>
      <button className={`st-icon ${props.knobsOn ? "on" : ""}`} onClick={props.onKnobs} aria-pressed={props.knobsOn} aria-label="Knobs for this (K)" data-tip="Knobs for this (K)">
        <Icon name="sliders" size={15} />
      </button>
      <button className={`st-icon ${props.keeping ? "busy" : ""}`} onClick={props.onKeep} disabled={props.keeping} aria-busy={props.keeping} aria-label="Keep as a brand asset" data-tip={props.keeping ? "Keeping it…" : "Keep as a brand asset"}>
        <Icon name="keep" size={15} />
      </button>
      <button className="st-icon" onClick={props.onDelete} aria-label="Delete (⌫)" data-tip="Delete (⌫)">
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

/**
 * Asking FRIDAY for a change, while its panel is folded away. Asking from here never opens the
 * panel: the bar itself says what FRIDAY is doing, with a way to go and see. With a part of
 * the page selected, the bar carries it as a chip and the message is about that part; × lets
 * go of it. A letter typed with a part selected lands here (`typeRef`).
 */
function AskBar(props: {
  running: boolean;
  doing: React.ReactNode;
  unread: boolean;
  /** The part selected, by its name on the page, or null. */
  part: string | null;
  typeRef: React.RefObject<((t: string) => void) | null>;
  onLetGo: () => void;
  onSend: (t: string) => void;
  onShow: () => void;
}) {
  const { running } = props;
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  props.typeRef.current = (t: string) => {
    setText((x) => x + t);
    input.current?.focus();
  };
  const send = () => {
    if (!text.trim() || running) return;
    props.onSend(text);
    setText("");
  };
  const status = running ? (props.doing || "FRIDAY is working on it…") : props.unread ? "FRIDAY answered" : null;
  return (
    <div className={`st-ask ${running ? "running" : ""}`}>
      {/* FRIDAY's dot, breathing while it works; a part's chip has its own dot instead. */}
      {(!props.part || running) && <span className="st-ask-mark" aria-hidden />}
      {props.part && (
        <span className="st-ask-chip" title={props.part}>
          <i aria-hidden />
          <span>{props.part}</span>
          <button onClick={props.onLetGo} aria-label="Let go of this part" title="Let go of this part"><Icon name="x" size={11} /></button>
        </span>
      )}
      <span className="st-ask-field">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
            // Backspace in an empty bar lets go of the part, like taking off a chip.
            else if (e.key === "Backspace" && !text && props.part) props.onLetGo();
          }}
          placeholder={status && !props.part ? "" : props.part ? "What should change here?" : "Ask FRIDAY for a change…"}
          aria-label={props.part ? `Ask FRIDAY for a change to ${props.part}` : "Ask FRIDAY for a change"}
        />
        {status && !text && !props.part && <span className="st-ask-status" aria-live="polite">{status}</span>}
      </span>
      {status && <button className="st-quiet" onClick={props.onShow} title="Show FRIDAY's panel beside the page (⌘J)">{running ? "Watch" : "See answer"}</button>}
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

/**
 * To Figma and back. Copy puts the page as it's shown here (this screen, this state) on the
 * clipboard the way Figma pastes it: frames, text and images to work on. Bring back reads the
 * frame selected in the Figma app, and FRIDAY makes it the sketch's next version, keeping its
 * knobs, states and scripts.
 */
function FigmaSheet(props: {
  project: string;
  sketch: StudioSketch;
  device: Device;
  state: string;
  stateName: string;
  last?: { node: string; name: string };
  nextVersion: number;
  running: boolean;
  onClose: () => void;
  onRead: (r: FigmaRead) => void;
}) {
  const { project, sketch } = props;
  const [copy, setCopy] = useState<"idle" | "busy" | "ready" | "done">("idle");
  /** The frame found in Figma, shown before FRIDAY spends anything on it. */
  const [found, setFound] = useState<FigmaRead | null>(null);
  /** What Figma pastes, kept when the clipboard said no while it was being made, for one more click. */
  const ready = useRef<string | null>(null);
  // Another version, screen or state: what was copied or made ready was of the one before.
  useEffect(() => {
    ready.current = null;
    setCopy("idle");
    setFound(null);
  }, [sketch.id, sketch.version, props.device, props.state]);
  const [reading, setReading] = useState(false);
  /** What went wrong, said in full here: it can name a folder to allow in Figma, too long for a notice. */
  const [problem, setProblem] = useState<string | null>(null);
  // A click anywhere else closes it, like a menu.
  const { onClose } = props;
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".st-figma-pop, .st-figma-toggle")) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);
  const what = [`v${sketch.version}`, props.stateName, props.device !== "desktop" ? DEVICES[props.device].label.toLowerCase() : ""].filter(Boolean).join(", ");

  const copyIt = async () => {
    if (copy === "busy") return;
    setProblem(null);
    // The second click, after the clipboard said no: copy what's ready, right inside the click.
    if (copy === "ready" && ready.current) {
      const html = ready.current;
      const put = (e: ClipboardEvent) => {
        e.clipboardData?.setData("text/html", html);
        e.preventDefault();
      };
      document.addEventListener("copy", put);
      const ok = document.execCommand("copy");
      document.removeEventListener("copy", put);
      if (ok) {
        ready.current = null;
        setCopy("done");
      } else setProblem("The browser wouldn't let Panel use the clipboard. Try Copy for Figma in Chrome.");
      return;
    }
    setCopy("busy");
    // Asked for at once, inside the click, so the browser lets it onto the clipboard when it comes.
    const data = studioApi.figmaCopy(project, sketch.id, { version: sketch.version, device: props.device, state: props.state || undefined });
    data.catch(() => {});
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": data })]);
      setCopy("done");
    } catch {
      const made = await data.then((b) => b.text(), (e: Error) => e);
      if (made instanceof Error) {
        setProblem(made.message);
        setCopy("idle");
      } else {
        // Made, but the browser wanted a fresh click to reach the clipboard (copying took a few seconds).
        ready.current = made;
        setCopy("ready");
      }
    }
  };

  const bringBack = async () => {
    if (reading || props.running) return;
    setReading(true);
    setProblem(null);
    try {
      setFound(await studioApi.figmaRead(project, sketch.id, sketch.version));
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="st-pop st-figma-pop" role="dialog" aria-label="Figma">
      <button className="st-figma-row" onClick={() => void copyIt()} disabled={copy === "busy"}>
        <Icon name={copy === "done" ? "check" : "copy"} size={15} />
        <span>
          <b>{copy === "busy" ? "Copying…" : copy === "ready" ? "Ready: click to copy" : copy === "done" ? "Copied" : "Copy for Figma"}</b>
          <i>{copy === "done" ? "Paste it in Figma with ⌘V." : copy === "ready" ? "It took a moment, so the browser wants one more click." : `${what}, as layers to paste in Figma.`}</i>
        </span>
      </button>
      {found ? (
        <div className="st-figma-found">
          {found.picture && <img src={`/sketches/${project}/${sketch.id}/${found.picture}`} alt="" />}
          <p>
            <b>“{found.frame}”</b>
            <i>
              {found.found === "selected" ? "Selected in Figma" : found.found === "asked for" ? "From Figma" : "As last time"}
              {found.width && found.height ? `, ${Math.round(found.width)}×${Math.round(found.height)}` : ""}. FRIDAY rebuilds v{found.base_version} to look like it, keeping its knobs and states, as v{props.nextVersion}.
            </i>
          </p>
          <div className="st-pop-actions">
            <button className="st-quiet" onClick={() => setFound(null)}>Not this one</button>
            <button className="st-send" disabled={props.running} onClick={() => props.onRead(found)}>Make v{props.nextVersion}</button>
          </div>
        </div>
      ) : (
      <button className="st-figma-row" onClick={() => void bringBack()} disabled={reading || props.running}>
        <Icon name="arrow-left" size={15} />
        <span>
          <b>{reading ? "Reading the frame…" : "Bring back from Figma"}</b>
          <i>
            {props.running
              ? "After FRIDAY's answer."
              : props.last
                ? `The frame selected in Figma, or “${props.last.name}” as last time. FRIDAY makes it v${props.nextVersion}.`
                : `Select its frame in Figma first. FRIDAY makes it v${props.nextVersion}.`}
          </i>
        </span>
      </button>
      )}
      {problem && <p className="st-figma-problem" role="alert">{problem}</p>}
    </div>
  );
}
