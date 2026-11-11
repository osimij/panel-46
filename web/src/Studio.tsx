// The studio: one sketch, live and full size, to click through and change. The page runs in
// its own sandbox; a small kit Panel adds to it (sketches.ts) lets the designer point at a
// part of it, and says which states it has (a flow's screens, or empty / loading / error).
//
//   header   what this is (the sketch, its version), how it is seen (screen, Point, Compare,
//            the column beside it), what to do with it (Choose, Rule out, Build)
//   stage    the page in a browser frame, with its states as a map to jump around
//   column   one at a time beside the page: Knobs, Directions, or FRIDAY's own panel
//   bar      "Ask FRIDAY for a change", only while FRIDAY's panel is folded away
//
// One page and one column beside it: Knobs, Directions and FRIDAY take turns in the same
// place at the same width, so switching between them never moves or rescales the page.
// FRIDAY's panel belongs to the app, so the studio folds it away and brings it back.
//
// What FRIDAY changes arrives as a new version on the canvas, and loads here in place.
// What the designer changes by hand (words typed over in the page, knobs moved) waits, shown
// live, until they press Save: then all of it becomes one new version, however many changes.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { studioApi, type Device, type FigmaRead, type RefState, type RuleFinding, type SketchInfo, type SketchPoint, type WordEdit } from "./api.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Knobs, type PageVar, type Palette } from "./Knobs.tsx";
import { Compare } from "./Compare.tsx";
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
}

const DEVICES: Record<Device, { w: number; h: number; label: string; icon: IconName }> = {
  desktop: { w: 1440, h: 900, label: "Desktop", icon: "monitor" },
  tablet: { w: 834, h: 1112, label: "Tablet", icon: "tablet" },
  phone: { w: 390, h: 844, label: "Phone", icon: "phone" },
};

// "?studio=4": the studio's own address for a page, so a copy a browser kept from before the
// kit was added (pages used to be cached forever) is never used. Bump it when the kit changes.
const pageOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.html?studio=5`;
const pictureOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.jpg`;

/**
 * Knob changes not saved yet, per sketch and version. They outlive the studio closing, so
 * stepping to another version, FRIDAY delivering a new one, or Esc never drops them; only
 * Save and Reset empty them. (A reload of Panel does.)
 */
const pending = new Map<string, Record<string, string>>();
/** Words edited in the page and not saved yet, per sketch and version, kept the same way. */
const pendingWords = new Map<string, WordEdit[]>();
const pendingKey = (project: string, id: string, v: number) => `${project}/${id}/v${v}`;

/** How far the header has given things up as it narrowed, 0 (nothing) to FOLDS (all it can). */
const FOLDS = 6;

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
  const [side, setSide] = useState<"knobs" | "directions" | null>(null);
  const [verdict, setVerdict] = useState<null | "chosen" | "ruled_out">(null);
  const [building, setBuilding] = useState(false);
  const [figmaOpen, setFigmaOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [fresh, setFresh] = useState<{ v: number; mine: boolean } | null>(null);
  // Words being edited in the page right now.
  const [editing, setEditing] = useState(false);
  /** When the designer last kept something themselves (knobs, words), so its new version isn't credited to FRIDAY. */
  const keptAt = useRef(0);
  // Knobs: the page's own variables, what's been moved and not yet kept (on this version).
  const key = pendingKey(project, sketch.id, sketch.version);
  const [vars, setVars] = useState<PageVar[] | null>(null);
  /** Which fonts the page names and really has: a missing one shows as a stand-in. */
  const [pageFonts, setPageFonts] = useState<Record<string, boolean>>({});
  const [edits, setEditsState] = useState<Record<string, string>>(() => pending.get(key) ?? {});
  const [keeping, setKeeping] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  /** Changes the knobs on this version, and keeps them waiting there until kept or reset. */
  const keyRef = useRef(key);
  keyRef.current = key;
  const setEdits = useCallback((next: Record<string, string>) => {
    if (Object.keys(next).length) pending.set(keyRef.current, next);
    else pending.delete(keyRef.current);
    editsRef.current = next;
    setEditsState(next);
  }, []);
  // Words edited and not saved yet (on this version), the same way.
  const [words, setWordsState] = useState<WordEdit[]>(() => pendingWords.get(key) ?? []);
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const setWords = useCallback((next: WordEdit[], at = keyRef.current) => {
    if (next.length) pendingWords.set(at, next);
    else pendingWords.delete(at);
    if (at !== keyRef.current) return;
    wordsRef.current = next;
    setWordsState(next);
  }, []);
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
        if (wordsRef.current.length) post({ t: "text", edits: wordsRef.current });
      } else if (m.t === "vars") {
        const list: PageVar[] = Array.isArray(m.vars) ? m.vars : [];
        setVars(list);
        setPageFonts(m.fonts && typeof m.fonts === "object" ? m.fonts : {});
        // Changes carried over from the version before: only the ones this page still has.
        if (carried.current) {
          carried.current = false;
          const names = new Set(list.map((v) => v.name));
          const kept = Object.fromEntries(Object.entries(editsRef.current).filter(([k]) => names.has(k)));
          if (Object.keys(kept).length !== Object.keys(editsRef.current).length) setEdits(kept);
        }
      } else if (m.t === "state") {
        setState(String(m.state ?? ""));
        setPicked(null);
      } else if (m.t === "picked") {
        setPicked({ label: m.label, selector: m.selector, text: m.text, html: m.html, style: m.style ?? {}, rect: m.rect, state: m.state ?? "", editable: !!m.editable });
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
  // Another sketch or version: its own knobs, and whatever changes were waiting on it. A
  // version that is new (FRIDAY's, not one stepped to) takes over the changes waiting on the
  // one it came from, for the variables it still has (checked when the page lists them).
  const shownKey = useRef(key);
  const carried = useRef(false);
  useLayoutEffect(() => {
    const was = shownKey.current;
    if (was === key) return;
    shownKey.current = key;
    carried.current = false;
    const sameSketch = was.startsWith(`${project}/${sketch.id}/v`);
    const handedOn = sameSketch && isNew(sketch.version) && keepingFrom.current !== was;
    if (handedOn && pending.has(was) && !pending.has(key)) {
      pending.set(key, pending.get(was)!);
      pending.delete(was);
      carried.current = true;
    }
    // Words waiting on the version before come along too, as far as they still fit the new one.
    let carriedWords: WordEdit[] = [];
    if (handedOn && pendingWords.has(was) && !pendingWords.has(key)) {
      carriedWords = pendingWords.get(was)!;
      pendingWords.set(key, carriedWords);
      pendingWords.delete(was);
    }
    setVars(null);
    setRulesOpen(false);
    const now = pending.get(key) ?? {};
    editsRef.current = now;
    setEditsState(now);
    const nowWords = pendingWords.get(key) ?? [];
    wordsRef.current = nowWords;
    setWordsState(nowWords);
    if (carriedWords.length) void fitWords(key, sketch.version, carriedWords);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const turn = useCallback((changes: Record<string, string>) => {
    if (!Object.keys(changes).length) return;
    setEdits({ ...editsRef.current, ...changes });
    post({ t: "set", vars: changes });
  }, [post, setEdits]);
  /** Outlines on the page what a knob changes, while the pointer is on it. */
  const showVar = useCallback((name: string | null) => post({ t: "show", name }), [post]);
  const resetKnobs = useCallback(() => {
    post({ t: "set", vars: Object.fromEntries(Object.keys(editsRef.current).map((k) => [k, null])) });
    setEdits({});
  }, [post, setEdits]);
  /**
   * Save: the words and the knobs changed on this version become one new version together.
   * Only knob values the browser accepts are written into the page.
   */
  const save = async () => {
    const good = Object.fromEntries(Object.entries(edits).filter(([, v]) => v.trim() && !/[;{}<>]/.test(v)));
    const list = words;
    if ((!Object.keys(good).length && !list.length) || keeping) return;
    setKeeping(true);
    keptAt.current = Date.now();
    const from = key;
    keepingFrom.current = from;
    try {
      const res = await studioApi.saveChanges(project, sketch.id, { edits: list, vars: good }, sketch.version);
      // Saved: nothing waits on that version any more, and its new version starts clean.
      pending.delete(from);
      pendingWords.delete(from);
      if (shownKey.current === from) {
        setEdits({});
        setWords([]);
        // Nothing changed in the file after all: show the page as it really is.
        if (res.version === sketch.version) setReload((n) => n + 1);
      }
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setKeeping(false);
      // A moment longer, in case the new version is still on its way to the canvas.
      setTimeout(() => {
        if (keepingFrom.current === from) keepingFrom.current = null;
      }, 4000);
    }
  };
  /** Put back everything not saved on this version: the knobs and the words. */
  const putBack = () => {
    resetKnobs();
    if (wordsRef.current.length) {
      setWords([]);
      setReload((n) => n + 1);
    }
  };

  /**
   * Words the designer just edited in the page. They wait with the others until Save, but are
   * checked against the file now, so words Panel can't find there are turned down at once.
   * The same part edited twice is one change, from its first words to its last.
   */
  const addWords = async (edit: WordEdit) => {
    if (edit.after === edit.before) return;
    const at = keyRef.current, v = sketch.version;
    const was = wordsRef.current;
    const list = [...was];
    const same = list.findIndex((x) => x.path === edit.path && x.after === edit.before);
    if (same >= 0) {
      const first = list[same]!;
      if (edit.after === first.before) list.splice(same, 1);
      else list[same] = { ...first, after: edit.after, after_text: edit.after_text };
    } else list.push(edit);
    setWords(list, at);
    if (!list.length) return;
    try {
      await studioApi.saveChanges(project, sketch.id, { edits: list, vars: {} }, v, true);
    } catch (e) {
      props.onError((e as Error).message);
      // Let this one go: back to the words waiting before it, and the page loads again with them.
      if (pendingWords.get(at) === list) setWords(was, at);
      if (at === keyRef.current) setReload((n) => n + 1);
    }
  };
  /**
   * Words carried over to a new version from FRIDAY: the ones that no longer fit its file
   * (FRIDAY changed those words too, say) are let go, and the designer is told.
   */
  const fitWords = async (at: string, v: number, list: WordEdit[]) => {
    const fits = async (l: WordEdit[]) => studioApi.saveChanges(project, sketch.id, { edits: l, vars: {} }, v, true).then(() => true, () => false);
    if (await fits(list)) return;
    const kept: WordEdit[] = [];
    for (const e of list) if (await fits([...kept, e])) kept.push(e);
    if (pendingWords.get(at) !== list) return;
    setWords(kept, at);
    const gone = list.length - kept.length;
    props.onError(`${gone === 1 ? "One word change" : `${gone} word changes`} you hadn't saved didn't fit the new version, so ${gone === 1 ? "it was" : "they were"} let go.`);
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
  /** Who has the column: FRIDAY's panel whenever it shows, else Knobs or Directions, else no one. */
  const column: "knobs" | "directions" | "friday" | null =
    askOpen ? "friday" : view === "compare" ? null : side === "directions" && !hasDirections ? null : side;
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
  const toggleColumn = (c: "knobs" | "directions" | "friday") => {
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

  // Escape steps back one thing at a time: what's pointed at, pointing, Compare, an open
  // dialog, and then out of the studio to the canvas. In a field with words in it, it only
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
    if (pointing) setPointing(false);
    else if (view === "compare") leaveCompareRef.current();
    else if (verdict || building || figmaOpen) {
      setVerdict(null);
      setBuilding(false);
      setFigmaOpen(false);
    } else close();
  };
  const escapeRef = useRef(escape);
  escapeRef.current = escape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.<HTMLElement>("input, textarea, [contenteditable]") ?? null;
      if (e.key === "Escape") {
        if (!e.defaultPrevented) escapeRef.current(typing);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "p" || e.key === "P") && view === "one") setPointing((v) => !v);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [view]);

  // ---- Asking ----
  // Always without opening FRIDAY's panel: if it's folded away, the bar says what it's doing,
  // and the page and the column beside it stay where they are.
  const ask = (text: string, mode: "change" | "alternates" = "change") => {
    const t = text.trim();
    if (!t && mode === "change") return;
    if (picked) {
      props.ask(t || "Try alternates of this.", {
        sketch: sketch.id, version: sketch.version, label: picked.label, selector: picked.selector, text: picked.text,
        html: picked.html, style: picked.style, state: picked.state || undefined, device, mode,
      }, mode === "alternates" ? 3 : undefined, true);
      setPicked(null);
      setPointing(false);
    } else props.ask(t, undefined, undefined, true);
  };
  const alternates = () => props.ask("Try 3 alternates of this sketch, each a different direction for the whole page.", undefined, 3, true);

  // ---- The header gives things up as it narrows ----
  // In a fixed order (see .st-head[data-f1] … [data-f6] in studio.css): the line under the
  // title, the words on Choose and Rule out, the words on Point and
  // Compare, the words on the column switch, "of 8", and last, at a phone's width, Point and
  // Compare themselves (P still points). The steps come from what actually fits
  // (the header's width against its content), so they don't go stale when a label changes.
  const head = useRef<HTMLElement>(null);
  const fitHead = useCallback(() => {
    const el = head.current;
    const name = el?.querySelector<HTMLElement>(".st-name");
    const title = el?.querySelector<HTMLElement>(".st-title");
    if (!el || !name || !title) return;
    // While measuring, the title asks for the room it would like (up to 280px), so it isn't
    // squeezed before the rest has given anything up. After, it takes whatever is left.
    name.style.flex = "none";
    name.style.width = `${Math.max(120, Math.min(title.scrollWidth + 1, 280))}px`;
    const fold = (n: number) => {
      for (let i = 1; i <= FOLDS; i++) el.toggleAttribute(`data-f${i}`, i <= n);
      return el.scrollWidth <= el.clientWidth;
    };
    let n = 0;
    while (n < FOLDS - 1 && !fold(n)) n++;
    if (n === FOLDS - 1) fold(n);
    name.style.flex = "";
    name.style.width = "";
    // Before Point and Compare themselves go, the title gives up its room, down to 120px.
    if (n === FOLDS - 1 && !fold(n)) fold(FOLDS);
  }, []);
  useLayoutEffect(() => {
    const el = head.current;
    if (!el) return;
    const ro = new ResizeObserver(fitHead);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitHead]);
  useLayoutEffect(fitHead, [fitHead, sketch.title, sketch.tries, sketch.state, sketch.version, versions.length, hasDirections, family.length, column, view]);

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

  /** Knob changes are waiting on this version while Knobs is closed. */
  const waiting = Object.keys(edits).length > 0 && column !== "knobs";
  /** Everything changed by hand on this version and not saved yet: words and knobs. */
  const unsaved = words.length + Object.keys(edits).length;
  const comparing = view === "compare" && hasDirections;

  return (
    <div className={`studio ${closing ? "closing" : ""}`} role="dialog" aria-label={sketch.title}>
      <header className="st-head" ref={head}>
        {/* What this is */}
        <button className="st-icon" onClick={close} aria-label="Back to the canvas" title="Back to the canvas (Esc)"><Icon name="arrow-left" size={15} /></button>
        <div className="st-name">
          <span className="st-title" title={sketch.title}>{sketch.title || "Untitled sketch"}</span>
          {sketch.tries && <span className="st-tries" title={sketch.tries}>{sketch.tries}</span>}
        </div>
        <div className="st-versions" aria-label="Versions">
          <button className="st-icon sm" disabled={at <= 0} onClick={() => stepTo(-1)} aria-label="Earlier version" title="Earlier version"><Icon name="chevron-left" size={14} /></button>
          <span className={`st-v ${fresh ? "fresh" : ""}`}>v{sketch.version}{versions.length > 1 && <span className="st-of faint"> of {versions.at(-1)!.v}</span>}</span>
          <button className="st-icon sm" disabled={at < 0 || at >= versions.length - 1} onClick={() => stepTo(1)} aria-label="Later version" title="Later version"><Icon name="chevron-right" size={14} /></button>
        </div>
        <span className="st-gap" />

        {/* How it is seen */}
        <div className="st-seg" role="radiogroup" aria-label="Screen">
          {(Object.keys(DEVICES) as Device[]).map((k) => (
            <button key={k} role="radio" aria-checked={device === k} className={device === k ? "on" : ""} onClick={() => setDevice(k)} title={`${DEVICES[k].label} (${DEVICES[k].w}×${DEVICES[k].h})`}>
              <Icon name={DEVICES[k].icon} size={14} />
            </button>
          ))}
        </div>
        <button
          className={`st-tool ${pointing ? "on" : ""}`}
          onClick={() => {
            if (comparing) leaveCompare();
            setPointing((v) => (comparing ? true : !v));
          }}
          aria-pressed={pointing}
          title="Point at a part to change it (P)"
        >
          <Icon name="point" size={14} /> <span className="st-label st-l-view">Point</span>
        </button>
        {hasDirections && (
          <button className={`st-tool ${comparing ? "on" : ""}`} onClick={() => (comparing ? leaveCompare() : enterCompare())} aria-pressed={comparing} title="Compare: this direction beside the others, scrolled together">
            <Icon name="compare" size={14} /> <span className="st-label st-l-view">Compare</span>
          </button>
        )}
        <div className="st-seg st-cols" role="group" aria-label="Beside the page">
          <button className={column === "knobs" ? "on" : ""} aria-pressed={column === "knobs"} onClick={() => toggleColumn("knobs")} title={waiting ? "Knobs: you have changes here not saved yet" : "Knobs: change its colors, type, corners and spacing yourself, live"}>
            <Icon name="sliders" size={14} /><span className="st-l-col">Knobs</span>
            {waiting && <i className="st-dot" aria-label="changes not saved yet" />}
          </button>
          {hasDirections && (
            <button className={column === "directions" ? "on" : ""} aria-pressed={column === "directions"} onClick={() => toggleColumn("directions")} title="Directions: the sketches branched from this one">
              <Icon name="branch" size={14} /><span className="st-l-col">Directions</span><span className="st-count">{family.length}</span>
            </button>
          )}
          <button className={column === "friday" ? "on" : ""} aria-pressed={column === "friday"} onClick={() => toggleColumn("friday")} title="FRIDAY beside the page (⌘J)">
            <Mark size={14} active={props.running} /><span className="st-l-col">FRIDAY</span>
            {props.unread && !askOpen && <i className="st-dot" aria-label="a new answer" />}
          </button>
        </div>
        <span className="st-sep" />

        {/* What to do with it */}
        <div className="st-verdict">
          <button className={`st-tool ${sketch.state === "chosen" ? "chosen" : ""}`} title={sketch.state === "chosen" ? "Chosen (click to undo)" : "Choose this direction"} onClick={() => (sketch.state === "chosen" ? props.patch(sketch.id, { state: "kept", reason: "" }) : setVerdict("chosen"))}>
            <Icon name="check" size={14} /> <span className="st-label st-l-verdict">{sketch.state === "chosen" ? "Chosen" : "Choose"}</span>
          </button>
          <button className={`st-tool ${sketch.state === "ruled_out" ? "out" : ""}`} title={sketch.state === "ruled_out" ? "Ruled out (click to undo)" : "Rule this direction out"} onClick={() => (sketch.state === "ruled_out" ? props.patch(sketch.id, { state: "kept", reason: "" }) : setVerdict("ruled_out"))}>
            <Icon name="x" size={14} /> <span className="st-label st-l-verdict">{sketch.state === "ruled_out" ? "Ruled out" : "Rule out"}</span>
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
        {/* To Figma and back: a quiet icon like Build, with its two actions under it. */}
        <button className={`st-icon st-build st-figma-toggle ${figmaOpen ? "on" : ""}`} onClick={() => setFigmaOpen((v) => !v)} aria-label="Figma" aria-expanded={figmaOpen} data-tip="Figma">
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
            nextVersion={(versions.at(-1)?.v ?? sketch.version) + 1}
            running={props.running}
            onClose={() => setFigmaOpen(false)}
            onRead={(r) => {
              setFigmaOpen(false);
              props.ask(`Bring “${sketch.title || "this sketch"}” back from Figma as a new version, from the frame “${r.frame}”.`, undefined, undefined, true, { sketch: sketch.id, read: r.read, version: r.base_version });
            }}
          />
        )}
        {/* Rarely used, so it is a quiet icon; its name shows under it on hover or focus. */}
        <button className={`st-icon st-build ${building ? "on" : ""}`} onClick={() => setBuilding(true)} aria-label="Build with Claude Code" data-tip="Build with Claude Code">
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
            {unsaved > 0 && (
              <span className="st-unsaved" role="group" aria-label="Changes not saved">
                <span className="st-unsaved-text">{unsaved} {unsaved === 1 ? "change" : "changes"} not saved</span>
                <button className="st-quiet sm" disabled={keeping} onClick={putBack} title="Put back every change not saved yet">Put back</button>
                <button className="st-send sm" disabled={keeping} onClick={() => void save()} title="Save every change as one new version">{keeping ? "Saving…" : `Save as v${(versions.at(-1)?.v ?? sketch.version) + 1}`}</button>
              </span>
            )}
            <span className="st-size">{d.w}×{device === "desktop" ? Math.round(fit.h) : d.h}{fit.scale < 1 ? ` · ${Math.round(fit.scale * 100)}%` : ""}</span>
            <a className="st-icon sm" href={src} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab"><Icon name="external" size={13} /></a>
            {/* With FRIDAY's panel showing, its box is the place to ask; Alternates waits here. */}
            {askOpen && <button className="st-quiet st-alts" onClick={alternates} disabled={props.running} title="Three new directions from this sketch, made at the same time"><Icon name="branch" size={13} /> Alternates</button>}
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
            {picked && bubble && (
              <PointBubble
                key={picked.selector}
                picked={picked}
                style={bubble}
                editing={editing}
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
            {fresh && <div className="st-fresh" key={fresh.v}>{fresh.mine ? `Saved as version ${fresh.v}` : `Version ${fresh.v} from FRIDAY`}</div>}
          </div>
          {!askOpen && (
            <AskBar
              running={props.running}
              doing={props.doing}
              unread={props.unread}
              onSend={(t) => ask(t)}
              onAlternates={alternates}
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
            keeping={keeping}
            nextVersion={(versions.at(-1)?.v ?? sketch.version) + 1}
            onChange={turn}
            onReset={resetKnobs}
            onKeep={() => void save()}
            onAskForKnobs={() => props.ask("Rewrite this sketch so its colors, fonts, type sizes, corner radius and spacing are CSS variables on :root (--bg, --surface, --ink, --muted, --accent, --font-display, --font-text, --radius, --space and whatever else it needs), used everywhere in place of the fixed values. Give each one a short note in plain words beside it where its name doesn't say it (--c1: #e2372b; /* Cortex */). Change nothing about how it looks.", undefined, undefined, true)}
            onShow={showVar}
          />
        )}
        {column === "directions" && (
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
    if (!props.editing) input.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (props.editing) {
    return (
      <div className="st-bubble" style={style} onPointerDown={(e) => e.stopPropagation()}>
        <div className="st-bubble-head">
          <span className="st-bubble-dot" />
          <span className="st-bubble-label">Editing the words in the page</span>
        </div>
        <p className="st-bubble-note">Type over them. ↵ when done, Esc puts them back, ⇧↵ for a new line. Nothing is saved until you press Save.</p>
        <div className="st-bubble-actions">
          <button className="st-quiet" onClick={() => props.onEditEnd(false)}>Put back</button>
          <button className="st-send" onClick={() => props.onEditEnd(true)}>Done</button>
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

/**
 * Asking FRIDAY about the whole page, while its panel is folded away. Asking from here never
 * opens the panel: the bar itself says what FRIDAY is doing, with a way to go and see.
 */
function AskBar(props: { running: boolean; doing: React.ReactNode; unread: boolean; onSend: (t: string) => void; onAlternates: () => void; onShow: () => void }) {
  const { running } = props;
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim() || running) return;
    props.onSend(text);
    setText("");
  };
  const status = running ? (props.doing || "FRIDAY is working on it…") : props.unread ? "FRIDAY answered" : null;
  return (
    <div className={`st-ask ${running ? "running" : ""}`}>
      <span className="st-ask-mark" aria-hidden />
      <span className="st-ask-field">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={status ? "" : "Ask FRIDAY for a change to this page, or press P to point at a part"}
          aria-label="Ask FRIDAY for a change"
        />
        {status && !text && <span className="st-ask-status" aria-live="polite">{status}</span>}
      </span>
      {status ? (
        <button className="st-quiet" onClick={props.onShow} title="Show FRIDAY's panel beside the page (⌘J)">{running ? "Watch" : "See answer"}</button>
      ) : (
        <button className="st-quiet st-ask-alts" onClick={props.onAlternates} title="Three new directions from this sketch, made at the same time"><Icon name="branch" size={13} /> Alternates</button>
      )}
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
