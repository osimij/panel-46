// Skills that come as a pack, from a GitHub project or a folder on this Mac (server/skillpacks.ts).
//
// - The chooser: after a GitHub link is pasted on the Skills page (or a folder dropped), a
//   quiet sheet shows the pack (name, author, licence, date) and the skills found, each with a
//   tick box, its one line and small print for its size and what is left out. Skills the
//   library already has are marked and can't be ticked. "Add all" or "Add the ticked ones"
//   ("Add and read…" when skills are read by themselves). Checking a pack for a newer version
//   opens the same sheet to pick what to update.
// - The Skills page, by subject (the default once something is read): a section per subject,
//   each skill under its main one, the heading naming the skill that leads it when two or more
//   that are on speak to it, which the designer can change. Or by pack: a pack's skills together
//   under a quiet heading, with its version and "Check for a newer version". Small sections sit
//   side by side as tiles; each card has FRIDAY's switch, so a skill is turned on without
//   opening it. Switching between the two, the cards glide to their new places.
// - A skill's detail view says where it came from and lists its other files.
//
// A skill is text: the browser reads only a folder's text files (Markdown and plain text),
// and sends the rest by name and size, so Panel can say what it left out. Everything arrives
// off; nothing reaches FRIDAY until the designer turns a skill on.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
  packApi, packStore, prefersReducedMotion, skillApi, skillReadApi, skillStore, type DroppedFolder, type FoundSkill, type PackLook, type Ref, type SkillLead,
  type SkillOrigin, type SkillPack, type SkillsPage, type SkillUse,
} from "./api.ts";
import { CardFlow, columnsFor, targetWidth, type Selection } from "./Grid.tsx";
import { Icon } from "./Icon.tsx";
import { Popover } from "./TagRow.tsx";

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- Reading a dropped folder ----------

/** The files Panel reads as text: Markdown and plain text, by name. Everything else goes by name and size only. */
const isTextName = (p: string) => /\.(md|markdown|mdx|txt)$/i.test(p) || /^(licen[cs]e|notice|copying|authors|readme)$/i.test(p.split("/").pop() ?? "");
const SKIP = new Set(["node_modules", ".git", ".DS_Store"]);
const MAX_FILE = 300 * 1024;
const MAX_WALK = 5000;

/** One file of the folder: its text when Panel keeps text, else only its size. */
async function fileFor(path: string, file: File): Promise<DroppedFolder["files"][number]> {
  const out = { path, bytes: file.size, modified: file.lastModified };
  if (!isTextName(path) || file.size > MAX_FILE) return out;
  return { ...out, text: await file.text() };
}

/** A folder dropped on the page (from the drop event's item), read through the browser's folder access. */
export async function readDroppedFolder(dir: FileSystemDirectoryEntry): Promise<DroppedFolder> {
  const files: DroppedFolder["files"] = [];
  const walk = async (d: FileSystemDirectoryEntry, at: string): Promise<void> => {
    const reader = d.createReader();
    // readEntries answers in batches until it answers with none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) break;
      for (const e of batch) {
        if (SKIP.has(e.name) || files.length >= MAX_WALK) continue;
        const path = at ? `${at}/${e.name}` : e.name;
        if (e.isDirectory) await walk(e as FileSystemDirectoryEntry, path);
        else {
          const file = await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail));
          files.push(await fileFor(path, file));
        }
      }
    }
  };
  await walk(dir, "");
  return { name: dir.name, files };
}

/** A folder chosen with the + button (an input with webkitdirectory): paths start with the folder's name. */
export async function readPickedFolder(list: File[]): Promise<DroppedFolder | null> {
  if (!list.length) return null;
  const name = list[0]!.webkitRelativePath.split("/")[0] || "Folder";
  const files: DroppedFolder["files"] = [];
  for (const f of list.slice(0, MAX_WALK)) {
    const parts = f.webkitRelativePath.split("/").slice(1);
    if (!parts.length || parts.some((p) => SKIP.has(p))) continue;
    files.push(await fileFor(parts.join("/"), f));
  }
  return { name, files };
}

// ---------- The chooser ----------

interface Choosing {
  look: PackLook;
  /** add: from a link or a folder. update: a newer version of a pack in the library. */
  mode: "add" | "update";
  /** The dropped folder, sent again when adding. */
  folder?: DroppedFolder;
}

let choosing: Choosing | null = null;
const listeners = new Set<() => void>();
const setChoosing = (c: Choosing | null) => {
  choosing = c;
  listeners.forEach((f) => f());
};
const chooserStore = {
  get: () => choosing,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

/** Look at a GitHub link and open the chooser. Throws, in plain words, when nothing can be shown. */
export async function chooseFromLink(url: string) {
  setChoosing({ look: await packApi.look(url), mode: "add" });
}

/** Look at a dropped folder and open the chooser. */
export async function chooseFromFolder(folder: DroppedFolder) {
  setChoosing({ look: await packApi.lookFolder(folder), mode: "add", folder });
}

/** Ask GitHub for a pack's newer version: opens the chooser to update, or says it is up to date. */
export async function checkForNewer(packId: string): Promise<string | null> {
  const r = await packApi.check(packId);
  void packStore.refresh().catch(() => {});
  if (r.same) return `Up to date: this is the newest version${r.date ? `, from ${day(r.date)}` : ""}.`;
  setChoosing({ look: r, mode: "update" });
  return null;
}

/** What a skill is in the chooser: can it be ticked, and what to say beside it. */
function statusOf(s: FoundSkill, mode: Choosing["mode"]) {
  if (s.problem) return { pick: false, mark: "Can't be added" };
  if (s.have?.same) return { pick: false, mark: "In your library" };
  if (s.have) return { pick: true, mark: "Changed" };
  return { pick: true, mark: mode === "update" ? "New" : "" };
}

/**
 * The sheet itself, mounted once by the app. `onDone` says what happened ("Added 5 skills…");
 * `onError` shows a failure.
 */
export function PackChooser({ onDone, onError }: { onDone: (text: string) => void; onError: (text: string) => void }) {
  const c = useSyncExternalStore(chooserStore.subscribe, chooserStore.get);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => setTicked(new Set()), [c]);
  useEffect(() => {
    if (!c) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setChoosing(null);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [c, busy]);
  // Skills are read by themselves ("read automatically"): the buttons say so.
  const auto = useSyncExternalStore(skillStore.subscribe, () => !!skillStore.get()?.auto);
  if (!c) return null;
  const { look, mode } = c;
  const update = mode === "update";
  // In an update, only what changed or is new is worth a row; the rest are counted.
  const rows = update ? look.skills.filter((s) => !s.have?.same) : look.skills;
  const pickable = rows.filter((s) => statusOf(s, mode).pick);
  const toggle = (f: string) => setTicked((t) => {
    const n = new Set(t);
    if (n.has(f)) n.delete(f);
    else n.add(f);
    return n;
  });
  const add = async (folders: string[]) => {
    if (!folders.length) return;
    setBusy(true);
    try {
      const r = await packApi.add(look, folders, c.folder);
      setChoosing(null);
      void packStore.refresh().catch(() => {});
      const did = [r.added && `Added ${plural(r.added, "skill")}`, r.updated && `updated ${plural(r.updated, "skill")}`].filter(Boolean).join(", ");
      const text = did ? `${did[0]!.toUpperCase()}${did.slice(1)} from ${look.name}.` : `Nothing new from ${look.name}.`;
      const reading = r.reading?.length ? ` Panel is reading ${r.reading.length === 1 ? "it" : r.reading.length === r.ids.length ? "them" : plural(r.reading.length, "of them", "of them")}.` : "";
      void skillStore.refresh().catch(() => {});
      onDone(`${text}${reading}${r.added ? ` ${r.added === 1 ? "It's" : "They're"} off until you turn ${r.added === 1 ? "it" : "them"} on.` : ""}`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const same = look.skills.length - rows.length;
  const facts = [look.author, look.license, look.version.date && `${look.source === "folder" ? "Files from" : "Version of"} ${day(look.version.date)}`].filter(Boolean);
  return (
    <div className="sheet-layer" onMouseDown={(e) => e.target === e.currentTarget && !busy && setChoosing(null)}>
      <div className="sheet pack-sheet" role="dialog" aria-label={update ? `A newer version of ${look.name}` : `Skills in ${look.name}`}>
        <div className="sheet-head">
          <h2>{update ? `A newer version of ${look.name}` : look.name}</h2>
          <button className="round-btn" onClick={() => setChoosing(null)} aria-label="Close" disabled={busy}><Icon name="x" size={14} /></button>
        </div>
        <p className="pack-facts">
          {facts.join(" · ")}
          {update && look.pack?.date && <> · yours is from {day(look.pack.date)}</>}
        </p>
        <div className="pack-list" role="group" aria-label="Skills found">
          {rows.map((s) => {
            const st = statusOf(s, mode);
            const on = ticked.has(s.folder);
            return (
              <button
                key={s.folder}
                aria-label={[s.name, st.mark, s.problem].filter(Boolean).join(", ")}
                className={`check-row pack-row ${on ? "on" : ""}`}
                aria-pressed={on}
                disabled={!st.pick || busy}
                onClick={() => toggle(s.folder)}
              >
                <span className="checkbox">
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                </span>
                <span className="pack-row-text">
                  <span className="pack-row-name">
                    {s.name}
                    {st.mark && <span className="pack-row-mark">{st.mark}</span>}
                  </span>
                  {s.line && <span className="pack-row-line">{s.line}</span>}
                  <span className="pack-row-small">
                    {s.problem ?? [s.size, s.leftOutLine].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {update && same > 0 && <p className="pack-note">{plural(same, "skill")} didn't change.</p>}
        {!update && !pickable.length && rows.length > 0 && <p className="pack-note">Every skill here is in your library already, as it is in this version.</p>}
        {look.gone.length > 0 && (
          <p className="pack-note">
            No longer in the project, so kept as they are and marked: {look.gone.map((g) => g.name).join(", ")}.
          </p>
        )}
        {look.partial && <p className="pack-note">GitHub listed only part of this very large project, so some skills may be missing.</p>}
        <p className="pack-note">
          {update
            ? `Updating replaces those skills' files${auto ? " and reads them again, unless you changed what FRIDAY carries" : ""}. Whether FRIDAY uses each stays as you set it.`
            : `Skills arrive off: open one to let FRIDAY use it.${auto ? " Panel reads each one first." : ""}`}
        </p>
        <div className="pack-actions">
          <button className="btn-wide" disabled={busy || !ticked.size} onClick={() => add([...ticked])}>
            {update ? "Update the ticked ones" : auto ? "Add and read the ticked ones" : "Add the ticked ones"}
            {ticked.size > 0 && <span className="pack-count">{ticked.size}</span>}
          </button>
          <button className="btn-wide strong" disabled={busy || !pickable.length} onClick={() => add(pickable.map((s) => s.folder))}>
            {busy ? <span className="spinner" /> : update ? "Update all" : auto ? "Add and read all" : "Add all"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- The Skills page: a pack's skills together ----------

/** The skills in the order the page shows them: single files first, then each pack's. */
export function orderByPack(refs: Ref[], packs: SkillPack[] | null): Ref[] {
  if (!packs?.length) return refs;
  // Each pack's skills in the order of their folders in it (the order the server lists them).
  const at = new Map<string, [number, number]>();
  packs.forEach((p, i) => p.skills.forEach((id, k) => at.set(id, [i, k])));
  return refs
    .map((r, i) => ({ r, i, g: at.get(r.id) ?? [-1, i] }))
    .sort((a, b) => a.g[0] - b.g[0] || a.g[1] - b.g[1])
    .map((x) => x.r);
}

// ---------- The Skills page: by subject or by pack ----------

/** The subjects a skill can lead, in the order the page shows them (server/skillread.ts LEAD_SUBJECTS). */
const SUBJECTS = ["typography", "color", "layout", "surfaces", "icons", "motion", "gestures", "mobile", "writing", "accessibility"];
const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
type SkillView = "subject" | "pack";

// Which way the page is shown, remembered in this browser only (a convenience, never needed).
const VIEW_KEY = "panel.skills.view";
let viewChosen: SkillView | null = (() => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "subject" || v === "pack" ? v : null;
  } catch {
    return null;
  }
})();
const viewListeners = new Set<() => void>();
const viewStore = {
  get: () => viewChosen,
  subscribe: (fn: () => void) => {
    viewListeners.add(fn);
    return () => void viewListeners.delete(fn);
  },
  set: (v: SkillView) => {
    viewChosen = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* only remembered for this visit */
    }
    viewListeners.forEach((f) => f());
  },
};
/** By subject once something is read, unless the designer chose. */
const viewOf = (page: SkillsPage | null): SkillView => viewChosen ?? (page?.skills.some((s) => s.read?.for) ? "subject" : "pack");
/** The page's view, for the app's order of cards (stepping through skills follows it). */
export function useSkillView() {
  const page = useSyncExternalStore(skillStore.subscribe, skillStore.get);
  useSyncExternalStore(viewStore.subscribe, viewStore.get);
  return viewOf(page);
}

/** Where a skill sits by subject: its main subject, or one of the sections below them. */
function placeOf(s: SkillUse | undefined): string {
  if (!s?.read?.for) return "unread";
  const f = s.forUse ?? s.read.for;
  if (f === "builds") return "builds";
  if (f === "neither") return "neither";
  const main = s.subjects[0] ?? s.read.subjects[0];
  return main && SUBJECTS.includes(main) ? main : "other";
}
const BELOW: [string, string][] = [["other", "Other"], ["builds", "For real builds"], ["neither", "Not for Panel yet"], ["unread", "Not read yet"]];

/** The sections by subject, in order, each with its skills (as the page has them) and its lead. */
function bySubject(refs: Ref[], page: SkillsPage | null) {
  const of = new Map((page?.skills ?? []).map((s) => [s.id, s]));
  const leads = new Map((page?.leads ?? []).map((l) => [l.subject, l]));
  return [...SUBJECTS.map((x) => [x, cap(x)] as [string, string]), ...BELOW]
    .map(([key, title]) => ({ key, title, lead: leads.get(key) ?? null, items: refs.filter((r) => placeOf(of.get(r.id)) === key) }))
    .filter((g) => g.items.length || g.lead);
}

/** The skills in the order the page shows them now: by subject, or single files first and then each pack's. */
export function orderSkills(refs: Ref[], packs: SkillPack[] | null, view: SkillView): Ref[] {
  if (view === "subject") return bySubject(refs, skillStore.get()).flatMap((g) => g.items);
  return orderByPack(refs, packs);
}

/** What the Skills page's cards need from the app: opening, the card buttons and picking. */
export interface SkillCards {
  onOpen: (r: Ref, thumb: HTMLElement) => void;
  onFavorite: (r: Ref) => void;
  onHide: (r: Ref) => void;
  onDelete: (r: Ref) => void;
  selection: Selection;
}

/** The same curve the cards glide on everywhere in Panel. */
const GLIDE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * Switch between By subject and By pack: each card glides from its place in one to its place in
 * the other (a view transition, with each card its own layer for the moment), and the headings
 * cross-fade. Without view transitions, or with reduced motion, it simply changes.
 */
function switchView(v: SkillView) {
  if (v === viewOf(skillStore.get())) return;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransition };
  if (!doc.startViewTransition || prefersReducedMotion()) return viewStore.set(v);
  const root = document.documentElement;
  root.classList.add("vt-skills");
  const t = doc.startViewTransition(() => flushSync(() => viewStore.set(v)));
  t.ready.catch(() => {});
  t.finished.catch(() => {}).finally(() => root.classList.remove("vt-skills"));
}

/**
 * When the columns change (the window, or Ask opening beside the page) or a search narrows the
 * skills, each card glides from where it was to where it goes, as cards do in the library's
 * grid. `signature` names the layout; the glide only plays when it changes.
 */
function useGlide(board: React.RefObject<HTMLDivElement | null>, signature: string) {
  const last = useRef(new Map<string, { x: number; y: number; w: number }>());
  const running = useRef(new Map<string, Animation>());
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    const cards = [...el.querySelectorAll<HTMLElement>(".skill-card")];
    const b = el.getBoundingClientRect();
    const spot = (c: HTMLElement) => {
      const r = c.getBoundingClientRect();
      return { x: r.left - b.left, y: r.top - b.top, w: r.width };
    };
    // A card still gliding starts again from where it is on screen right now.
    const midway = new Map<string, { x: number; y: number; w: number }>();
    for (const c of cards) {
      const a = running.current.get(c.dataset.ref!);
      if (a?.playState === "running") {
        midway.set(c.dataset.ref!, spot(c));
        a.cancel();
      }
    }
    running.current.clear();
    const now = new Map(cards.map((c) => [c.dataset.ref!, spot(c)]));
    const prev = last.current;
    last.current = now;
    if (!prev.size || prefersReducedMotion() || document.documentElement.classList.contains("vt-skills")) return;
    const near = (y: number) => b.top + y > -300 && b.top + y < innerHeight + 300;
    for (const c of cards) {
      const id = c.dataset.ref!;
      const from = midway.get(id) ?? prev.get(id);
      const to = now.get(id)!;
      if (!from || !to.w || (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.w - to.w) < 0.5)) continue;
      if (!near(from.y) && !near(to.y)) continue;
      const anim = c.animate(
        [
          { transformOrigin: "0 0", transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w})` },
          { transformOrigin: "0 0", transform: "none" },
        ],
        { duration: 460, easing: GLIDE },
      );
      running.current.set(id, anim);
    }
  }, [signature]);
}

/**
 * The Skills page's list: a bar with the switch (By subject, By pack), how far the reads are,
 * and what FRIDAY carries; then the sections. Small sections sit side by side as tiles, so a
 * subject with one skill doesn't take a whole row; big ones take the full width.
 */
export function SkillGroups({ refs, cards, onSay, onError }: {
  refs: Ref[];
  cards: SkillCards;
  onSay: (text: string) => void;
  onError: (text: string) => void;
}) {
  const page = useSyncExternalStore(skillStore.subscribe, skillStore.get);
  const view = useSkillView();
  // Cards that have played their entrance on this visit of the page.
  const seen = useRef(new Set<string>()).current;
  // While skills are read, look again every few seconds.
  const busy = (page?.skills ?? []).filter(isBusy).length;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void skillStore.refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [busy]);
  // Read again when a skill is added or removed.
  useEffect(() => void skillStore.refresh().catch(() => {}), [refs.length]);

  // Columns as the library's grid has them, for where the page is headed (Ask may be sliding).
  const board = useRef<HTMLDivElement>(null);
  // Cards of text need more room than pictures: on a phone, one column.
  const colsFor = (w: number) => (w < 560 ? 1 : columnsFor(w));
  const [cols, setCols] = useState(() => colsFor(innerWidth - (innerWidth > 820 ? 276 : 24)));
  const ready = !!page;
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    const measure = () => setCols(colsFor(targetWidth(el).target));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  useGlide(board, `${cols}|${view}|${refs.map((r) => r.id).join()}`);

  // Until the skills are known, which way to show them isn't either.
  if (!page) return null;
  const props = { refs, page, cols, seen, cards, onError };
  return (
    <>
      <div className="skill-bar">
        <div className="seg skill-seg" role="radiogroup" aria-label="Show skills">
          {(["subject", "pack"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={view === v} className={view === v ? "on" : ""} onClick={() => switchView(v)}>
              {v === "subject" ? "By subject" : "By pack"}
            </button>
          ))}
        </div>
        <ReadingLine page={page} onError={onError} />
        <FridayLine page={page} />
      </div>
      <div className="skill-board" ref={board} style={{ "--cols": cols } as React.CSSProperties}>
        {view === "subject" ? <SubjectGroups {...props} /> : <PackGroups {...props} onSay={onSay} />}
      </div>
    </>
  );
}

/** What FRIDAY carries from the skills: how many are on, and what they add to every message. */
function FridayLine({ page }: { page: SkillsPage }) {
  if (!page.skills.length) return null;
  return (
    <span className="skill-bar-sum">
      {page.on ? (
        <>
          <b>{page.on}</b> of {page.skills.length} in FRIDAY
          {page.tokens ? <> · about {page.tokens.toLocaleString("en")} tokens on every message</> : null}
        </>
      ) : (
        "None in FRIDAY yet: turn one on with its switch"
      )}
    </span>
  );
}

/**
 * One line in the bar: how far along the reads are (with Stop reading), or, with "read
 * automatically" off, how many skills aren't read yet, with "Read them".
 */
function ReadingLine({ page, onError }: { page: SkillsPage | null; onError: (t: string) => void }) {
  if (!page) return null;
  const busy = page.skills.filter(isBusy);
  if (busy.length) {
    const reading = busy.filter((s) => s.read?.state === "reading").map((s) => s.name);
    const waiting = busy.length - reading.length;
    return (
      <span className="skill-bar-note busy">
        {reading.length ? `Reading ${andList(reading)}` : "Waiting to read"}{waiting ? `, ${waiting} more in line` : ""} ·{" "}
        <button className="text-btn inline pack-check" onClick={() => skillReadApi.stop().catch((e: Error) => onError(e.message))} title="Stops every read in line">Stop reading</button>
      </span>
    );
  }
  if (page.auto || !page.not_read) return null;
  return (
    <span className="skill-bar-note">
      {plural(page.not_read, "skill")} not read yet ·{" "}
      <button className="text-btn inline pack-check" onClick={() => skillReadApi.readUnread().catch((e: Error) => onError(e.message))}>Read them</button>
    </span>
  );
}

interface GroupProps {
  refs: Ref[];
  page: SkillsPage;
  cols: number;
  seen: Set<string>;
  cards: SkillCards;
  onError: (t: string) => void;
}

/** Where a section sits on the board: as many columns as it has cards (the full width at most), and its rows. */
const spanOf = (n: number, cols: number, full = false) => {
  const k = full ? cols : Math.max(1, Math.min(n, cols));
  return { gridColumn: `span ${k}`, gridRow: `span ${1 + Math.max(1, Math.ceil(n / k))}` };
};

function SubjectGroups({ refs, page, cols, seen, cards, onError }: GroupProps) {
  const groups = bySubject(refs, page);
  let start = 0;
  return (
    <>
      {groups.map((g) => {
        const at = start;
        start += g.items.length;
        return (
          <section key={g.key} className="skill-section" style={spanOf(g.items.length, cols)} aria-label={g.title}>
            <div className="skill-section-head">
              <span className="skill-section-title">
                {g.title}
                {g.items.length > 1 && <span className="skill-section-count">{g.items.length}</span>}
              </span>
              {g.lead && <LeadPicker lead={g.lead} onError={onError} />}
            </div>
            {g.items.length > 0 ? (
              <CardFlow items={g.items} start={at} seen={seen} omitSubject={g.key} onError={onError} {...cards} />
            ) : (
              <div className="skill-ghost">No skill is mainly about {g.key}</div>
            )}
          </section>
        );
      })}
    </>
  );
}

/** "led by emil-design-eng", with a short list to pick another of the skills that speak to it. */
function LeadPicker({ lead, onError }: { lead: SkillLead; onError: (t: string) => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const pick = (id: string | null) => {
    setAt(null);
    skillApi.setLead(lead.subject, id).catch((e: Error) => onError(e.message));
  };
  const panelName = lead.speakers.find((x) => x.id === lead.panel)?.name ?? "";
  return (
    <span className="skill-lead">
      Led by{" "}
      <button
        className="text-btn inline skill-lead-btn"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 6 });
        }}
        title={`${lead.by === "panel" ? "Panel's pick. " : "Your pick. "}Click to choose which skill FRIDAY follows on ${lead.subject}.`}
      >
        {lead.name}
      </button>
      {/* Panel's pick (said in the button's tooltip). A tie is worth seeing: Panel's pick was level with another skill on main subject and lines. */}
      {lead.by === "panel" && lead.tie && <span className="skill-lead-by"> · level with {lead.tie}</span>}
      {at && (
        <Popover x={at.x} y={at.y} onClose={() => setAt(null)}>
          <div className="menu-label">FRIDAY follows on {lead.subject}</div>
          {lead.speakers.map((x) => (
            <button key={x.id} className={`menu-item ${x.id === lead.id ? "on" : ""}`} role="menuitemradio" aria-checked={x.id === lead.id} onClick={() => pick(x.id)}>
              <span className="menu-check">{x.id === lead.id && <Icon name="check" size={12} />}</span>
              {x.name}
              <span className="menu-count">{plural(x.lines, "line")}</span>
            </button>
          ))}
          {lead.by === "designer" && (
            <>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => pick(null)}>
                <span className="menu-check" />
                Let Panel pick{panelName ? ` (${panelName})` : ""}
              </button>
            </>
          )}
        </Popover>
      )}
    </span>
  );
}

/** By pack: skills added one by one first, then each pack, each the full width under its heading. */
function PackGroups({ refs, cols, seen, cards, onSay, onError }: GroupProps & { onSay: (text: string) => void }) {
  const packs = useSyncExternalStore(packStore.subscribe, packStore.get);
  useEffect(() => void packStore.refresh().catch(() => {}), [refs.length]);
  const inPack = new Set(packs?.flatMap((p) => p.skills) ?? []);
  const single = refs.filter((r) => !inPack.has(r.id));
  const byId = new Map(refs.map((r) => [r.id, r]));
  const groups = (packs ?? []).map((p) => ({ p, items: p.skills.flatMap((id) => byId.get(id) ?? []) })).filter((g) => g.items.length);
  let start = single.length;
  return (
    <>
      {single.length > 0 && (
        <section className="skill-section" style={spanOf(single.length, cols, true)} aria-label="Added one by one">
          <div className="skill-section-head">
            <span className="skill-section-title">
              Added one by one
              {single.length > 1 && <span className="skill-section-count">{single.length}</span>}
            </span>
            <span className="pack-head-facts">Single SKILL.md files, not from a pack</span>
          </div>
          <CardFlow items={single} start={0} seen={seen} onError={onError} {...cards} />
        </section>
      )}
      {groups.map(({ p, items }) => {
        const at = start;
        start += items.length;
        return (
          <section key={p.id} className="skill-section" style={spanOf(items.length, cols, true)} aria-label={p.name}>
            <PackHeading pack={p} shown={items.length} onSay={onSay} onError={onError} />
            <CardFlow items={items} start={at} seen={seen} onError={onError} {...cards} />
          </section>
        );
      })}
    </>
  );
}

function PackHeading({ pack, shown, onSay, onError }: { pack: SkillPack; shown: number; onSay: (t: string) => void; onError: (t: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [said, setSaid] = useState("");
  const check = async () => {
    setChecking(true);
    setSaid("");
    try {
      const r = await checkForNewer(pack.id);
      if (r) {
        setSaid("Up to date");
        onSay(r);
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const n = pack.skills.length;
  const facts = [
    pack.source === "folder" ? "from a folder" : pack.author && pack.author !== pack.name.split("/")[0] ? pack.author : null,
    pack.license,
    pack.version.date && day(pack.version.date),
    shown < n ? `${shown} of ${n} skills shown` : null,
    pack.gone.length ? `${pack.gone.length} no longer in the project` : null,
  ].filter(Boolean);
  return (
    <div className="skill-section-head">
      <span className="skill-section-title pack-name">
        {pack.url ? <a href={pack.url} target="_blank" rel="noreferrer">{pack.name}</a> : pack.name}
        <span className="skill-section-count">{shown}</span>
      </span>
      <span className="pack-head-facts">{facts.join(" · ")}</span>
      <ReadThese pack={pack} onError={onError} />
      {pack.source === "github" ? (
        <button className="text-btn inline pack-check" onClick={check} disabled={checking} title="Ask GitHub whether this project has a newer version">
          {checking ? "Checking…" : said || "Check for a newer version"}
        </button>
      ) : (
        <span className="pack-head-facts" title="A folder has no newer version to ask for: drop it again to see what changed.">Drop the folder again to update</span>
      )}
    </div>
  );
}

/**
 * "Read these": Claude reads the pack's skills that aren't read yet, a few at a time. While
 * they're read, says how far along it is and can be stopped. With "read automatically" on they
 * are read without it; the button stays for any whose read failed.
 */
function ReadThese({ pack, onError }: { pack: SkillPack; onError: (t: string) => void }) {
  const page = useSyncExternalStore(skillStore.subscribe, skillStore.get);
  const mine = (page?.skills ?? []).filter((s) => pack.skills.includes(s.id));
  const busy = mine.filter(isBusy);
  const unread = mine.filter((s) => !isBusy(s) && (!s.read?.for || s.read.older));
  useEffect(() => void (page || skillStore.refresh().catch(() => {})), [page]);
  if (busy.length) {
    const done = mine.length - unread.length - busy.length;
    return (
      <span className="pack-head-facts">
        {busy.length === 1 ? "1 skill" : `${busy.length} skills`} in line to be read, {done} of {mine.length} read ·{" "}
        <button className="text-btn inline pack-check" onClick={() => skillReadApi.stop().catch((e: Error) => onError(e.message))} title="Stops every read in line, here and in other packs">Stop reading</button>
      </span>
    );
  }
  if (!unread.length) return null;
  return (
    <button className="text-btn inline pack-check" onClick={() => skillReadApi.readMany(unread.map((s) => s.id)).catch((e: Error) => onError(e.message))}>
      Read {unread.length === mine.length ? "these" : `the ${unread.length} not read`}
    </button>
  );
}

const isBusy = (s: SkillUse) => s.read?.state === "waiting" || s.read?.state === "reading";

// ---------- A skill's detail view: where it came from, and its other files ----------

/** "Check for a newer version" for one pack, saying the answer in place: up to date, or the chooser opens. */
export function CheckNewer({ packId, label = "Check for a newer version", className = "text-btn inline" }: { packId: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "checking" | string>("idle");
  useEffect(() => setState("idle"), [packId]);
  const check = () => {
    setState("checking");
    checkForNewer(packId).then((t) => setState(t ? "Up to date" : "idle"), (e: Error) => setState(e.message));
  };
  if (state !== "idle" && state !== "checking") return <span className="pack-said" title={state}>{state}</span>;
  return (
    <button className={className} onClick={check} disabled={state === "checking"} title="Ask GitHub whether its project has a newer version">
      {className.includes("inline") ? null : <Icon name="refresh" size={13} />}
      {state === "checking" ? "Checking…" : label}
    </button>
  );
}

/**
 * Under "Use in FRIDAY": the pack, folder, version and licence, with the link; the skill's
 * other files (`onShow` shows one in place of SKILL.md, null goes back); what was left out.
 * Nothing for a skill added as a single file.
 */
export function SkillOriginPanel({ id, shown, onShow }: { id: string; shown: string | null; onShow: (path: string | null, text?: string) => void }) {
  const [o, setO] = useState<SkillOrigin | null>(null);
  const [error, setError] = useState("");
  const packs = useSyncExternalStore(packStore.subscribe, packStore.get);
  // Read again when a pack is updated.
  const version = packs?.find((p) => p.skills.includes(id))?.version.sha ?? "";
  useEffect(() => {
    packApi.origin(id).then(setO, (e: Error) => setError(e.message));
  }, [id, version]);
  if (error) return <div className="inline-error">{error}</div>;
  if (!o || (!o.pack && !o.files.length && !o.leftOut.length)) return null;
  const show = async (path: string | null) => {
    if (!path) return onShow(null);
    try {
      onShow(path, (await packApi.file(id, path)).text);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const p = o.pack;
  return (
    <section className="skill-use skill-origin" aria-label="Where this skill came from">
      {p && (
        <div className="skill-origin-facts">
          <span>
            From {o.link || p.url ? <a href={o.link ?? p.url!} target="_blank" rel="noreferrer">{p.name}</a> : p.name}
            {p.source === "folder" && ", a folder on this Mac"}
            {o.folder && <span className="skill-use-label">, in {o.folder}</span>}
          </span>
          <span className="skill-use-label">
            {[o.version?.date && `Version of ${day(o.version.date)}`, o.version?.sha && o.version.sha.slice(0, 7), p.license].filter(Boolean).join(" · ")}
            {p.hasLicenseText && (
              <> · <a href={`/api/skills/packs/${p.id}/license`} target="_blank" rel="noreferrer">Licence</a></>
            )}
          </span>
          {o.gone && <span className="skill-use-label">No longer in the project: kept as it was.</span>}
        </div>
      )}
      {o.files.length > 0 && (
        <div className="skill-files" role="group" aria-label="Its files">
          <button className={`pill ${shown === null ? "on" : ""}`} aria-pressed={shown === null} onClick={() => show(null)}>SKILL.md</button>
          {o.files.map((f) => (
            <button key={f.path} className={`pill ${shown === f.path ? "on" : ""}`} aria-pressed={shown === f.path} onClick={() => show(f.path)} title={`${f.path}, ${Math.max(1, Math.round(f.bytes / 1024))} KB`}>
              {f.path}
            </button>
          ))}
        </div>
      )}
      {o.leftOutLine && (
        <p className="skill-use-note" title={o.leftOut.map((f) => f.path).join("\n")}>
          {o.leftOutLine[0]!.toUpperCase() + o.leftOutLine.slice(1)}: {o.leftOut.slice(0, 4).map((f) => f.path).join(", ")}{o.leftOut.length > 4 ? "…" : ""}
        </p>
      )}
    </section>
  );
}

/** The pack a skill came from, read from its save: "pack:<id>/<folder>". */
export const packOf = (r: Ref) => (r.kind === "skill" && r.source_id?.startsWith("pack:") ? r.source_id.slice(5).split("/")[0]! : null);
