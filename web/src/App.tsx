import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RailHandle } from "./RailHandle.tsx";
import { flushSync } from "react-dom";
import {
  api, fontApi, formatBytes, isFontFile, isGithubProject, packStore, prefersReducedMotion, projectApi, skillStore, STATUS_LABEL,
  type CanvasSelection, type Collection, type ProjectSummary, type Filters, type Ref, type RefStatus, type Section, type Stats, type TagGroup, type TagInfo,
} from "./api.ts";
import { Detail } from "./Detail.tsx";
import { chooseFromFolder, chooseFromLink, orderSkills, PackChooser, readDroppedFolder, readPickedFolder, SkillGroups, useSkillView } from "./Packs.tsx";
import { Masonry } from "./Grid.tsx";
import { Icon } from "./Icon.tsx";
import { ReadingSettings } from "./Reading.tsx";
import { BackupSettings, MeaningSettings } from "./Backup.tsx";
import { InlineName } from "./InlineName.tsx";
import { Assistant, type AssistantHandle } from "./Assistant.tsx";
import { Mark } from "./Glow.tsx";
import { Popover, TagRow } from "./TagRow.tsx";
import { Fonts } from "./Fonts.tsx";
import { Ready } from "./Ready.tsx";
import { Brand, type BrandDrop } from "./Brand.tsx";

// The canvas (and React Flow with it) loads only when a project is opened.
const ProjectCanvas = lazy(() => import("./Canvas.tsx"));

/** How many saves the grid starts with, and how many more it brings in each time its end comes near. */
const PAGE = 200;

/**
 * A fresh list from the companion, with every save that came back unchanged kept as the
 * object the grid already has: its card isn't drawn again, and when nothing changed at all
 * (the usual case while checking on downloads) the grid isn't either.
 */
const asText = new WeakMap<Ref, string>();
function textOf(r: Ref) {
  let t = asText.get(r);
  if (t === undefined) asText.set(r, (t = JSON.stringify(r)));
  return t;
}
function keepSame(was: Ref[] | null, now: Ref[]) {
  if (!was) return now;
  const old = new Map(was.map((r) => [r.id, r]));
  let same = was.length === now.length;
  const out = now.map((r, i) => {
    const o = old.get(r.id);
    const kept = o && textOf(o) === textOf(r) ? o : r;
    if (kept !== was[i]) same = false;
    return kept;
  });
  return same ? was : out;
}

type Scope =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "sites" }
  | { kind: "people" }
  | { kind: "skills" }
  | { kind: "hidden" }
  | { kind: "status"; status: RefStatus }
  | { kind: "collection"; id: string }
  /** A project's canvas. */
  | { kind: "project"; id: string }
  /** The designer's own fonts, for sketches. */
  | { kind: "fonts" }
  /** Loading animations, colors and icons that come with Panel. */
  | { kind: "ready" }
  /** Each project's logos and files; `focus` brings one asset or project into view. */
  | { kind: "brand"; focus?: string }
  /** Saves the assistant brought up, shown together in the grid. */
  | { kind: "picked"; ids: string[]; title: string };
type MediaFilter = "all" | "image" | "video";

// The brand page is the same page whichever asset it was opened onto.
const sameScope = (a: Scope, b: Scope) => (a.kind === "brand" && b.kind === "brand") || JSON.stringify(a) === JSON.stringify(b);
const looksLikeUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
/** Search text that reads like a question for the assistant rather than words to match. */
const looksLikeQuestion = (s: string) => {
  const t = s.trim();
  if (!t || looksLikeUrl(t)) return false;
  const words = t.split(/\s+/).length;
  return (t.endsWith("?") && words >= 2) ||
    (words >= 4 && /^(what|which|how|why|where|who|find|show|give|suggest|gather|get|any|is|are|do|does|can|could|should|would|help|compare|pair|recommend|i need|i want|i'm|im|make|build|design)\b/i.test(t));
};

/**
 * Run a DOM change as a View Transition when the browser supports it.
 *
 * "open" (an item opening over the grid): the page is not cross-faded. The open item
 * brings its own entrances (scrim, panel, filmstrip) and the sidebar its own slide, so
 * only one copy of the page is ever on screen; a cross-fade would show the old sidebar
 * and grid ghosting through the new panel. Only the hero morphs.
 * "close": the item fades away over the grid, and the sidebar, lifted out of the
 * page into a layer of its own, slides back in once instead of fading in twice.
 */
function transition(update: () => void, kind: "open" | "close" = "open") {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransition };
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return null;
  }
  const root = document.documentElement;
  // Set before the old state is captured, so the sidebar has its name in both states.
  root.classList.remove("vt-open", "vt-close");
  root.classList.add("vt", `vt-${kind}`);
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    flushSync(update);
  };
  const t = doc.startViewTransition(run);
  t.ready.catch(() => {});
  t.finished.catch(() => {}).finally(() => {
    // A newer transition may have started meanwhile; it set its own classes.
    if (current === t) root.classList.remove("vt", "vt-open", "vt-close");
  });
  current = t;
  // If the page isn't painting (hidden window), don't hold the UI hostage to the animation.
  setTimeout(() => {
    if (!done) {
      t.skipTransition();
      run();
    }
  }, 250);
  return t;
}
let current: ViewTransition | null = null;

export function App() {
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [media, setMedia] = useState<MediaFilter>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"all" | "any">("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [refs, setRefs] = useState<Ref[] | null>(null);
  // What the grid last got: for which view, how many it asked for, how many that view has
  // in all, and the tags among all of them (not only the ones loaded so far).
  const [got, setGot] = useState<{ for: Filters; limit: number; total: number; tags: string[] } | null>(null);
  // Past the first page: how many saves this view should show.
  const [more, setMore] = useState<{ for: Filters; n: number } | null>(null);
  const [gridEnd, setGridEnd] = useState<HTMLElement | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [open, setOpen] = useState<Ref | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);

  // The extension links straight to something it saved: /?open=<id>. Claude links to a
  // project the same way: /?project=<id>.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("open");
    const project = params.get("project");
    if (!id && !project) return;
    history.replaceState(null, "", location.pathname);
    if (project && /^[0-9a-f]{16}$/.test(project)) setScope({ kind: "project", id: project });
    if (id) api.ref(id).then(setOpen).catch(() => {});
  }, []);
  // An open project stays in the address, so a reload comes back to its canvas.
  useEffect(() => {
    const want = scope.kind === "project" ? `${location.pathname}?project=${scope.id}` : location.pathname;
    if (location.pathname + location.search !== want) history.replaceState(null, "", want);
  }, [scope]);
  const [toast, setToast] = useState<{ id: number; text: string; tone?: "error" } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [saving, setSaving] = useState<"idle" | "busy" | "done">("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  // The assistant: open beside the library, remembered between visits.
  const [askOpen, setAskOpenState] = useState(() => {
    try {
      return localStorage.getItem("panel.ask.open") === "1";
    } catch {
      return false;
    }
  });
  const setAskOpen = useCallback((v: boolean) => {
    setAskOpenState(v);
    try {
      localStorage.setItem("panel.ask.open", v ? "1" : "0");
    } catch {
      /* not remembered, that's all */
    }
  }, []);
  // The sidebar, tucked away to a strip with ⌘B (hover the strip to see it), remembered between visits.
  const [tucked, setTuckedState] = useState(() => {
    try {
      return localStorage.getItem("panel.side.tucked") === "1";
    } catch {
      return false;
    }
  });
  const setTucked = useCallback((v: boolean | ((was: boolean) => boolean)) => {
    setTuckedState((was) => {
      const next = typeof v === "function" ? v(was) : v;
      try {
        localStorage.setItem("panel.side.tucked", next ? "1" : "0");
      } catch {
        /* not remembered, that's all */
      }
      return next;
    });
  }, []);
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const peekTo = useCallback((show: boolean, delay: number) => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(show), delay);
  }, []);
  const [askRunning, setAskRunning] = useState(false);
  /** What FRIDAY is doing right now, in a few words (for the studio's bar). */
  const [askDoing, setAskDoing] = useState<React.ReactNode>(null);
  // An answer that finished while Ask was closed: a dot on its button until you look.
  const [askUnread, setAskUnread] = useState(false);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !askRunning && !askOpen) setAskUnread(true);
    wasRunning.current = askRunning;
  }, [askRunning, askOpen]);
  useEffect(() => {
    if (askOpen) setAskUnread(false);
  }, [askOpen]);
  const askRef = useRef<AssistantHandle>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const anchor = useRef<string | null>(null);

  // On Skills, a GitHub project's link counts even without https:// (it opens the skill chooser).
  const isUrl = looksLikeUrl(query) || (scope.kind === "skills" && isGithubProject(query));
  useEffect(() => {
    const t = setTimeout(() => setDebounced(isUrl ? "" : query.trim()), 140);
    return () => clearTimeout(t);
  }, [query, isUrl]);

  const filters = useMemo<Filters>(
    () => ({
      q: debounced || undefined,
      favorite: scope.kind === "favorites" || undefined,
      hidden: scope.kind === "hidden" || undefined,
      site: scope.kind === "sites" || undefined,
      person: scope.kind === "people" || undefined,
      skill: scope.kind === "skills" || undefined,
      library: scope.kind === "all" || scope.kind === "sites" || undefined,
      status: scope.kind === "status" ? scope.status : undefined,
      collection: scope.kind === "collection" ? scope.id : undefined,
      ids: scope.kind === "picked" ? scope.ids : undefined,
      type: media === "all" ? undefined : media,
      tags: selectedTags.length ? selectedTags : undefined,
      tagMode,
    }),
    [debounced, scope, media, selectedTags, tagMode],
  );

  // Each page has its own tags; Favorites, Hidden and collections use the library's.
  const section: Section = scope.kind === "sites" || scope.kind === "people" || scope.kind === "skills" ? scope.kind : "library";
  // A tag from one page means nothing on another.
  const lastSection = useRef(section);
  useEffect(() => {
    if (lastSection.current !== section) setSelectedTags([]);
    lastSection.current = section;
  }, [section]);

  const refreshProjects = useCallback(() => projectApi.list().then(setProjects).catch(() => {}), []);
  // The grid shows the first `want` saves of the view and asks for more as its end comes
  // near. A change of view starts again from the first page.
  const want = more?.for === filters ? more.n : PAGE;
  const wantRef = useRef(want);
  wantRef.current = want;
  const refsAsked = useRef(0);
  const loadRefs = useCallback(async () => {
    const asked = ++refsAsked.current;
    const limit = wantRef.current;
    const page = await api.refsPage(filters, limit);
    // Asked again since (another view, or more of this one): that answer is the one to show.
    if (asked !== refsAsked.current) return;
    setRefs((was) => keepSame(was, page.items));
    setGot({ for: filters, limit, total: page.total, tags: page.tags });
  }, [filters]);
  const refresh = useCallback(async () => {
    void refreshProjects();
    const [, s, c, t, g] = await Promise.all([
      loadRefs(), api.stats(), api.collections(), api.tags(section), api.tagGroups(section),
    ]);
    setStats(s);
    setCollections(c);
    setTags(t);
    setTagGroups(g);
  }, [loadRefs, section, refreshProjects]);

  // Everything asked for has arrived and the view has more: the next page can be brought in.
  const canLoadMore = !!got && got.for === filters && got.limit === want && got.total > want;
  const loadMore = useCallback(() => setMore({ for: filters, n: want + PAGE }), [filters, want]);
  useEffect(() => {
    if (more && more.for === filters) loadRefs().catch(() => {});
  }, [more, filters, loadRefs]);
  // Well before the end of the grid scrolls into view, so the next saves are there on arrival.
  useEffect(() => {
    if (!gridEnd || !canLoadMore) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && loadMore(), { rootMargin: "0px 0px 2400px 0px" });
    io.observe(gridEnd);
    return () => io.disconnect();
  }, [gridEnd, canLoadMore, loadMore]);

  const say = useCallback((text: string, tone?: "error") => setToast({ id: Date.now(), text, tone }), []);
  const sayError = useCallback((text: string) => say(text, "error"), [say]);
  // What's selected on the canvas: Ask talks about it, and the canvas's Ask button opens Ask on it.
  const [canvasPick, setCanvasPick] = useState<CanvasSelection | null>(null);
  const askAboutPick = useCallback(() => {
    setAskOpenState(true);
    try {
      localStorage.setItem("panel.ask.open", "1");
    } catch {
      /* fine */
    }
    // Once Ask is open (and can take focus).
    setTimeout(() => askRef.current?.focus(), 80);
  }, []);

  // From the studio: ask about a sketch (or a part of it), with FRIDAY open to show the work,
  // or `quiet`ly, leaving its panel as it is (the studio's own bar then shows what it's doing).
  const askWith = useCallback((text: string, about: CanvasSelection, quiet?: boolean) => {
    if (!quiet) {
      setAskOpenState(true);
      try {
        localStorage.setItem("panel.ask.open", "1");
      } catch {
        /* fine */
      }
    }
    askRef.current?.ask(text, about);
  }, []);

  useEffect(() => {
    refresh().catch((e) => say(`Can't reach the Panel companion. ${e.message}`, "error"));
  }, [refresh, say]);

  // While anything is still downloading, keep the grid honest.
  const anyPending = (stats?.byStatus.pending ?? 0) > 0;
  useEffect(() => {
    if (!anyPending) return;
    // Only what a download changes: the saves and the counts. Tags, collections and projects stay as they are.
    const t = setInterval(() => {
      loadRefs().catch(() => {});
      api.stats().then(setStats).catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [anyPending, loadRefs]);
  // When the last download finishes, bring everything up to date once.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !anyPending) refresh().catch(() => {});
    wasPending.current = anyPending;
  }, [anyPending, refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "error" ? 6000 : 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);

  const saveLink = useCallback(
    async (url: string) => {
      setSaving("busy");
      // On Skills, a GitHub project (or a folder in one) opens the chooser of the skills in it.
      // Anywhere else, and for a link to one .md file, a link is saved as it always was.
      if (scope.kind === "skills" && isGithubProject(url)) {
        say("Looking for skills in it…");
        try {
          await chooseFromLink(url);
          setToast(null);
        } catch (e) {
          say((e as Error).message, "error");
        }
        setSaving("idle");
        return;
      }
      try {
        const person = scope.kind === "people";
        const res = await api.capture(url, { person });
        if (res.board) {
          const n = res.board.pins;
          say(`Saving ${n ? `${n.toLocaleString()} ${n === 1 ? "pin" : "pins"}` : "the pins"} from “${res.board.name}”…`);
          setSaving("done");
          setTimeout(() => setSaving("idle"), 1400);
          // They arrive over the next while; show them as they come.
          for (const ms of [3000, 8000, 20000, 45000]) setTimeout(() => void refresh(), ms);
          return;
        }
        say(
          res.existing
            ? person && !res.ref.person ? "Moved to People & Accounts" : "Already in your library"
            : res.ref.kind === "account" ? "Saving the profile…"
            : res.ref.kind === "skill" ? "Saving the skill…"
            : "Saving a copy to this Mac…",
        );
        setSaving("done");
        setTimeout(() => setSaving("idle"), 1400);
        await refresh();
        if (res.existing) setOpen(res.ref);
      } catch (e) {
        setSaving("idle");
        say((e as Error).message, "error");
      }
    },
    [refresh, say, scope.kind],
  );

  // Fonts dropped anywhere go to the font manager; it shows them when it's open.
  const [fontsVersion, setFontsVersion] = useState(0);
  const uploadFonts = useCallback(
    async (files: File[]) => {
      say(`Adding ${files.length} font${files.length > 1 ? "s" : ""}…`);
      try {
        const r = await fontApi.add(files);
        if (r.failed.length) say(r.failed[0]!, "error");
        else say(`Added ${r.added.length} font${r.added.length === 1 ? "" : "s"}. Name one to FRIDAY to use it.`);
        setFontsVersion((v) => v + 1);
      } catch (e) {
        say((e as Error).message, "error");
      }
    },
    [say],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const fonts = files.filter(isFontFile);
      if (fonts.length) void uploadFonts(fonts);
      files = files.filter((f) => !isFontFile(f));
      if (fonts.length && !files.length) return;
      const isSkill = (f: File) => /\.(md|markdown)$/i.test(f.name);
      const list = files.filter((f) => /^(image|video)\//.test(f.type) || isSkill(f));
      if (!list.length) return say("Only images, videos and .md skill files can be added.", "error");
      const skills = list.filter(isSkill).length;
      const n =
        skills === list.length
          ? `${skills} skill${skills > 1 ? "s" : ""}`
          : `${list.length} file${list.length > 1 ? "s" : ""}`;
      say(`Adding ${n}…`);
      try {
        await api.upload(list);
        say(`Added ${n}`);
        await refresh();
      } catch (e) {
        say((e as Error).message, "error");
      }
    },
    [refresh, say, uploadFonts],
  );

  // A folder of skills, dropped on Skills or chosen with its + button: the chooser shows what's in it.
  const addFolder = useCallback(
    async (read: Promise<Parameters<typeof chooseFromFolder>[0] | null>) => {
      try {
        const folder = await read;
        if (!folder) return;
        say(`Reading “${folder.name}”…`);
        await chooseFromFolder(folder);
        setToast(null);
      } catch (e) {
        say((e as Error).message, "error");
      }
    },
    [say],
  );

  const searchRef = useRef<HTMLInputElement>(null);

  const [newTagSignal, setNewTagSignal] = useState(0);
  // The + button's file picker, so ⌘U can open it too.
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Keyboard: ⌘K brings up the search bar from anywhere (closing whatever is open over
  // it); ⌘U adds files from this Mac (the + button); P, F, S, H jump between the Browse
  // pages when nothing else is open; T makes a new tag.
  const overlayOpen = !!open || settingsOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        flushSync(() => {
          setOpen(null);
          setSettingsOpen(false);
          setSelecting(false);
          setPicked(new Set());
          setConfirmRemove(false);
        });
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      // ⌘J: the assistant, open or closed.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAskOpenState((v) => {
          try {
            localStorage.setItem("panel.ask.open", v ? "0" : "1");
          } catch {
            /* fine */
          }
          return !v;
        });
        return;
      }
      // ⌘B: the sidebar, tucked away or back.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setPeek(false);
        setTucked((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || overlayOpen) return;
      if ((e.target as Element).closest?.("input, textarea, select, [contenteditable]")) return;
      // T: make a new tag for this page.
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        setNewTagSignal((n) => n + 1);
        return;
      }
      const to = ({ p: { kind: "all" }, f: { kind: "favorites" }, s: { kind: "sites" }, h: { kind: "hidden" } } as Record<string, Scope>)[
        e.key.toLowerCase()
      ];
      if (!to) return;
      e.preventDefault();
      setScope(to);
      window.scrollTo({ top: 0 });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [overlayOpen]);

  // While the brand assets page is open, files dropped or pasted go to it (Brand.tsx sets this).
  const brandDrop = useRef<BrandDrop | null>(null);
  // Paste anywhere (outside a text field) to save a link or files.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        // Pasted on the brand assets page: brand assets, and Panel asks for which project.
        if (brandDrop.current) return brandDrop.current(files, undefined, { x: innerWidth / 2 - 110, y: innerHeight / 3 });
        return void uploadFiles(files);
      }
      const text = e.clipboardData?.getData("text") ?? "";
      if (looksLikeUrl(text)) {
        e.preventDefault();
        void saveLink(text.trim());
      }
    };
    addEventListener("paste", onPaste);
    return () => removeEventListener("paste", onPaste);
  }, [saveLink, uploadFiles]);

  const dragDepth = useRef(0);
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].some((t) => t === "Files" || t === "text/uri-list")) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      // On Skills, a folder is a pack of skills (or one skill): read it while the drop lets us.
      if (scope.kind === "skills") {
        const dirs = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemDirectoryEntry => !!x?.isDirectory);
        if (dirs.length) {
          if (dirs.length > 1) say("Drop one folder at a time: showing the first.");
          void addFolder(readDroppedFolder(dirs[0]!));
          const plain = [...e.dataTransfer.files].filter((f) => /\.(md|markdown)$/i.test(f.name));
          if (plain.length) void uploadFiles(plain);
          return;
        }
      }
      const files = [...e.dataTransfer.files];
      // On the brand assets page, files are brand assets: for the project they were dropped on.
      if (files.length && brandDrop.current) {
        const on = (e.target as Element | null)?.closest?.("[data-brand-project]")?.getAttribute("data-brand-project") ?? undefined;
        return brandDrop.current(files, on, { x: e.clientX, y: e.clientY });
      }
      if (files.length) return void uploadFiles(files);
      const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text")).split("\n")[0] ?? "";
      if (looksLikeUrl(url)) void saveLink(url.trim());
    },
  };

  // ---- Opening and closing: the card's media morphs into the detail view ----

  // The grid thumb that last carried the "hero" name back on close. Opening again before
  // its name was cleared would leave two heroes, and the browser drops the whole transition.
  const lastHero = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearHero = () => {
    if (!lastHero.current) return;
    clearTimeout(lastHero.current.timer);
    lastHero.current.el.style.viewTransitionName = "";
    lastHero.current = null;
  };

  const openRef = (r: Ref, thumb: HTMLElement) => {
    // Something is already open: its stage holds the hero name, so just switch to this one.
    if (open) return setOpen(r);
    clearHero();
    thumb.style.viewTransitionName = "hero";
    const t = transition(() => {
      thumb.style.viewTransitionName = "";
      setOpen(r);
    });
    if (!t) thumb.style.viewTransitionName = "";
  };

  const closeDetail = useCallback(() => {
    const id = open?.id;
    transition(() => {
      setOpen(null);
      const thumb = id && document.querySelector<HTMLElement>(`[data-ref="${id}"] .thumb`);
      clearHero();
      if (thumb) {
        thumb.style.viewTransitionName = "hero";
        lastHero.current = { el: thumb, timer: setTimeout(clearHero, 600) };
      }
    }, "close");
  }, [open?.id]);

  // ---- From the assistant ----

  const openFromAsk = useCallback((id: string) => {
    api
      .ref(id)
      .then((r) => {
        // In a narrow window Ask covers everything, so it steps aside for the save.
        if (innerWidth <= 900) setAskOpen(false);
        transition(() => setOpen(r));
      })
      .catch(() => say("That save isn't in the library any more.", "error"));
  }, [say, setAskOpen]);

  const showPicked = useCallback((ids: string[], title: string) => {
    setOpen(null);
    setSelectedTags([]);
    setMedia("all");
    setQuery("");
    setScope({ kind: "picked", ids, title });
    window.scrollTo({ top: 0 });
  }, []);

  const askFromSearch = () => {
    const text = query.trim();
    if (!text) return;
    setQuery("");
    setAskOpen(true);
    searchRef.current?.blur();
    askRef.current?.ask(text);
  };

  const toggleFavorite = async (r: Ref) => {
    setRefs((list) => list?.map((x) => (x.id === r.id ? { ...x, favorite: !x.favorite } : x)) ?? null);
    try {
      await api.update(r.id, { favorite: !r.favorite });
      void refresh();
    } catch (e) {
      say((e as Error).message, "error");
    }
  };

  // ---- Selecting several to remove at once ----

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
    setConfirmRemove(false);
    anchor.current = null;
  }, []);

  /** Shift picks everything between the last card picked and this one. */
  const togglePick = (r: Ref, range: boolean) => {
    const from = anchor.current;
    setSelecting(true);
    setConfirmRemove(false);
    setPicked((prev) => {
      const next = new Set(prev);
      const a = range && from && refs ? refs.findIndex((x) => x.id === from) : -1;
      const b = refs?.findIndex((x) => x.id === r.id) ?? -1;
      if (a >= 0 && b >= 0) for (const x of refs!.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.id);
      else if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
    anchor.current = r.id;
  };

  // Only what's on screen counts, so a filter can't hide what's about to be removed.
  const pickedRefs = useMemo(() => refs?.filter((r) => picked.has(r.id)) ?? [], [refs, picked]);
  // "All" means the whole view, so the saves further down that haven't been loaded yet are
  // brought in first, then picked with the rest.
  const unloaded = got && got.for === filters && refs ? Math.max(0, got.total - refs.length) : 0;
  const allPicked = !!refs?.length && pickedRefs.length === refs.length && !unloaded;
  const pickingAll = useRef<{ for: Filters; n: number } | null>(null);
  const pickAll = useCallback(() => {
    if (!refs) return;
    if (unloaded && got) {
      pickingAll.current = { for: filters, n: got.total };
      setMore({ for: filters, n: got.total });
    } else setPicked(new Set(refs.map((r) => r.id)));
  }, [refs, unloaded, got, filters]);
  useEffect(() => {
    const p = pickingAll.current;
    if (!p) return;
    if (p.for !== filters) pickingAll.current = null;
    else if (refs && got?.for === filters && got.limit >= p.n) {
      pickingAll.current = null;
      setPicked(new Set(refs.map((r) => r.id)));
    }
  }, [refs, got, filters]);

  const removePicked = async () => {
    try {
      const { removed } = await api.removeMany(pickedRefs.map((r) => r.id));
      say(`Moved ${removed} to Trash`);
      stopSelecting();
      await refresh();
    } catch (e) {
      say((e as Error).message, "error");
    }
  };

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") stopSelecting();
      else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        pickAll();
      } else if ((e.key === "Backspace" || e.key === "Delete") && picked.size) setConfirmRemove(true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [selecting, picked.size, pickAll, stopSelecting]);

  // Hidden ones leave the grid at once (and come back to it from the Hidden view).
  const toggleHidden = async (r: Ref) => {
    setRefs((list) => list?.filter((x) => x.id !== r.id) ?? null);
    try {
      await api.update(r.id, { hidden: !r.hidden });
      say(r.hidden ? "Back in your library" : "Hidden · find it under Hidden");
      void refresh();
    } catch (e) {
      say((e as Error).message, "error");
      void refresh();
    }
  };

  const removeOne = async (r: Ref) => {
    setRefs((list) => list?.filter((x) => x.id !== r.id) ?? null);
    try {
      await api.removeMany([r.id]);
      say("Moved to Trash");
    } catch (e) {
      say((e as Error).message, "error");
    }
    void refresh();
  };

  const hidePicked = async () => {
    const unhide = scope.kind === "hidden";
    try {
      const { changed } = await api.hideMany(pickedRefs.map((r) => r.id), !unhide);
      say(unhide ? `${changed} back in your library` : `Hid ${changed}`);
      stopSelecting();
      await refresh();
    } catch (e) {
      say((e as Error).message, "error");
    }
  };

  // ---- The sidebar while something is open: tucked away to a strip, back on hover ----
  // A short pause before it opens (so brushing past the edge does nothing) and a slightly
  // longer one before it closes (so slipping off it for a moment doesn't snap it shut).
  // The same strip stands in for the sidebar while it's tucked away (⌘B).
  const railed = !!open || tucked;
  useEffect(() => {
    if (!railed) {
      clearTimeout(peekTimer.current);
      setPeek(false);
    }
  }, [railed]);
  const sidebarHover = railed
    ? { onMouseEnter: () => clearTimeout(peekTimer.current), onMouseLeave: () => peekTo(false, 220) }
    : undefined;

  const changeScope = (s: Scope) => {
    // Picking a page from the sidebar (revealed over an open item) closes the item and goes there.
    setOpen(null);
    clearTimeout(peekTimer.current);
    setPeek(false);
    setScope(s);
    window.scrollTo({ top: 0 });
  };

  // Tags that appear in the current results; the others would empty the grid.
  const available = useMemo(
    () => new Set(got?.for === filters ? got.tags : refs?.flatMap((r) => r.tags) ?? []),
    [got, filters, refs],
  );

  // On Skills, cards are grouped by subject or by pack, so going to the next one follows that order.
  const packs = useSyncExternalStore(packStore.subscribe, packStore.get);
  const skillPage = useSyncExternalStore(skillStore.subscribe, skillStore.get);
  const skillView = useSkillView();
  const ordered = useMemo(
    () => (refs && scope.kind === "skills" ? orderSkills(refs, packs, skillView) : refs),
    // skillPage: a skill read or a lead changed moves cards between subjects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refs, scope.kind, packs, skillView, skillPage],
  );
  const openIndex = ordered && open ? ordered.findIndex((r) => r.id === open.id) : -1;
  // Stepping through saves one by one: bring in the next page before the last loaded one is reached.
  useEffect(() => {
    if (refs && openIndex >= 0 && openIndex >= refs.length - 3 && canLoadMore) loadMore();
  }, [refs, openIndex, canLoadMore, loadMore]);
  // How many the view has in all, not how many are loaded so far.
  const matching = got?.for === filters ? got.total : refs?.length ?? 0;
  const { title, subtitle: baseSubtitle } = headingFor(scope, collections, stats);
  // While tags, media type or search narrow the grid, say how many are showing.
  const narrowed = scope.kind === "all" && refs && stats && (selectedTags.length > 0 || media !== "all" || !!debounced);
  const subtitle = narrowed ? `${matching} of ${stats.total} references` : baseSubtitle;

  const tools = (
    <>
      <MediaFilterButton media={media} setMedia={setMedia} stats={stats} />
      <button
        className={`round-btn small ${selecting ? "on" : ""}`}
        onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
        aria-pressed={selecting}
        aria-label="Select several"
        title={selecting ? "Done selecting (Esc)" : "Select several"}
      >
        <Icon name="select" size={14} />
      </button>
    </>
  );

  const onCanvas = scope.kind === "project";
  const leaveProject = useCallback(() => {
    setScope({ kind: "all" });
    void refreshProjects();
  }, [refreshProjects]);
  const askButton = (
    <button
      className={`round-btn ask-btn ${askOpen ? "on" : ""} ${askUnread ? "unread" : ""}`}
      onClick={() => setAskOpen(!askOpen)}
      aria-pressed={askOpen}
      aria-label="FRIDAY"
      title="Ask FRIDAY about your library (⌘J)"
      aria-keyshortcuts="Meta+J"
    >
      <Mark size={24} active={askRunning} />
    </button>
  );

  return (
    <div className={`app ${open ? "detail-open" : ""} ${tucked ? "side-tucked" : ""} ${railed && peek ? "side-peek" : ""} ${askOpen ? "chat-open" : ""} ${onCanvas ? "on-canvas" : ""}`} {...dropHandlers}>
      {/* While something is open, or the sidebar is tucked away (⌘B), the sidebar waits in this strip;
          hover it to bring the sidebar over the page. Clicking it while tucked brings the sidebar back for good. */}
      {railed && (
        <div
          className="side-rail"
          aria-hidden
          onMouseEnter={() => peekTo(true, 70)}
          onMouseLeave={() => peekTo(false, 220)}
          onClick={() => !open && setTucked(false)}
          title={!open ? "Show the sidebar (⌘B)" : undefined}
        >
          <RailHandle />
        </div>
      )}
      <Sidebar
        scope={scope}
        setScope={changeScope}
        stats={stats}
        collections={collections}
        projects={projects}
        onProjectsChanged={refreshProjects}
        online={online}
        onChanged={refresh}
        onError={(t) => say(t, "error")}
        onSettings={() => setSettingsOpen(true)}
        hover={sidebarHover}
        tucked={tucked}
        onTuck={() => {
          setPeek(false);
          setTucked((v) => !v);
        }}
      />

      <main className="main">
        {scope.kind === "fonts" ? (
          <Fonts version={fontsVersion} onError={sayError} onSay={say} />
        ) : scope.kind === "ready" ? (
          <Ready onError={sayError} onSay={say} />
        ) : scope.kind === "brand" ? (
          <Brand projects={projects} version={0} dropRef={brandDrop} focus={scope.focus} onError={sayError} onSay={say} />
        ) : scope.kind === "project" ? (
          <Suspense fallback={null}>
            <ProjectCanvas
              key={scope.id}
              id={scope.id}
              dock={dockSlot}
              onOpenRef={openFromAsk}
              onError={sayError}
              onRenamed={refreshProjects}
              onDeleted={leaveProject}
              onSelection={setCanvasPick}
              onAsk={askAboutPick}
              onAskWith={askWith}
              askRunning={askRunning}
              askDoing={askDoing}
              askUnread={askUnread}
              askOpen={askOpen}
              setAskOpen={setAskOpen}
            />
          </Suspense>
        ) : (
        <>
        <header className="header">
          <div className="title-row">
            <h1 key={title}>{title}</h1>
            <span className="subtitle">{subtitle}</span>
            {scope.kind === "skills" && <SkillsLine count={stats?.skills ?? 0} />}
            {tags.length > 0 ? (
              <>
                <span className="filters-divider" />
                <TagRow
                  scope={section}
                  newTagSignal={newTagSignal}
                  groups={tagGroups}
                  selected={selectedTags}
                  setSelected={setSelectedTags}
                  mode={tagMode}
                  setMode={setTagMode}
                  available={available}
                  tags={tags}
                  onChanged={refresh}
                  onError={(t) => say(t, "error")}
                  tools={tools}
                />
              </>
            ) : (
              <div className="row-tools">{tools}</div>
            )}
          </div>
        </header>

        {debounced && refs && (
          <p className="results-note">
            {refs.length
              ? `${matching} match${matching === 1 ? "" : "es"} for “${debounced}”`
              : looksLikeQuestion(debounced)
                ? "No save matches those exact words. Press ⇥ to ask FRIDAY instead: FRIDAY reads the whole library."
                : `Nothing matches “${debounced}” yet.`}
          </p>
        )}

        {refs === null ? null : refs.length === 0 ? (
          !debounced && <Empty scope={scope} filtered={media !== "all" || selectedTags.length > 0} />
        ) : (
          <>
            {scope.kind === "skills" ? (
              <SkillGroups
                refs={refs}
                onSay={say}
                onError={sayError}
                grid={(items, key) => (
                  <Masonry
                    key={key}
                    items={items}
                    onOpen={openRef}
                    onFavorite={toggleFavorite}
                    onHide={toggleHidden}
                    onDelete={removeOne}
                    selection={{ active: selecting, ids: picked, toggle: togglePick }}
                  />
                )}
              />
            ) : (
              <Masonry
                items={refs}
                onOpen={openRef}
                onFavorite={toggleFavorite}
                onHide={toggleHidden}
                onDelete={removeOne}
                selection={{ active: selecting, ids: picked, toggle: togglePick }}
              />
            )}
            {/* The end of what's loaded: when it comes near, the next saves are brought in. */}
            <div ref={setGridEnd} aria-hidden style={{ height: 1 }} />
          </>
        )}
        </>
        )}
      </main>

      {/* The primary action: search, or paste a link to save. Floats at the bottom of the grid. */}
      <div className="dock">
        {onCanvas ? (
          <>
            {/* The canvas puts its tools here. */}
            <div ref={setDockSlot} style={{ display: "contents" }} />
            {askButton}
          </>
        ) : scope.kind === "fonts" || scope.kind === "ready" || scope.kind === "brand" ? (
          askButton
        ) : selecting ? (
          <div className="select-bar" role="toolbar" aria-label="Selection" key="select">
            <span className="select-count">
              {pickedRefs.length ? `${pickedRefs.length} selected` : "Pick references"}
            </span>
            <button className="select-btn" onClick={() => (allPicked ? setPicked(new Set()) : pickAll())}>
              {allPicked ? "Select none" : "Select all"}
            </button>
            <button className="select-btn" disabled={!pickedRefs.length} onClick={hidePicked}>
              <Icon name={scope.kind === "hidden" ? "eye" : "eye-off"} size={15} />
              {scope.kind === "hidden" ? "Unhide" : "Hide"}
            </button>
            {confirmRemove ? (
              <button className="select-btn danger solid" onClick={removePicked} autoFocus>
                Move {pickedRefs.length} to Trash
              </button>
            ) : (
              <button className="select-btn danger" disabled={!pickedRefs.length} onClick={() => setConfirmRemove(true)}>
                <Icon name="trash" size={15} />
                Delete
              </button>
            )}
            <button className="select-x" onClick={stopSelecting} aria-label="Done selecting" title="Done (Esc)">
              <Icon name="x" size={15} />
            </button>
          </div>
        ) : (
          <>
            <Command
              placeholder={
                scope.kind === "people" ? "Search, or paste a profile or portfolio link"
                : scope.kind === "skills" ? "Search skills, or paste a GitHub project or a link to a .md file"
                : "Search, or paste a link to save"
              }
              inputRef={searchRef}
              value={query}
              setValue={setQuery}
              isUrl={isUrl}
              question={looksLikeQuestion(query)}
              onAsk={askFromSearch}
              saving={saving}
              onSave={() => {
                void saveLink(query.trim());
                setQuery("");
              }}
            />
            <AddFiles onFiles={uploadFiles} onFolder={(files) => void addFolder(readPickedFolder(files))} skills={scope.kind === "skills"} inputRef={fileInputRef} />
            {askButton}
          </>
        )}
      </div>

      {open && (
        <Detail
          initial={open}
          collections={collections}
          onClose={closeDetail}
          onPrev={openIndex > 0 ? () => setOpen(ordered![openIndex - 1]!) : undefined}
          onNext={openIndex >= 0 && openIndex < ordered!.length - 1 ? () => setOpen(ordered![openIndex + 1]!) : undefined}
          onChanged={refresh}
          onDeleted={() => {
            setOpen(null);
            say("Moved to Trash");
            void refresh();
          }}
          onAsk={() => {
            setAskOpen(true);
            setTimeout(() => askRef.current?.focus(), 140);
          }}
          onTag={(name, tagSection) => {
            setOpen(null);
            // Show everything with this tag on the tag's own page.
            if (tagSection !== section) {
              lastSection.current = tagSection;
              setScope(tagSection === "library" ? { kind: "all" } : { kind: tagSection });
            }
            setSelectedTags([name]);
          }}
        />
      )}

      <Assistant
        handle={askRef}
        open={askOpen}
        onClose={() => setAskOpen(false)}
        looking={open}
        project={scope.kind === "project" ? scope.id : null}
        projectName={scope.kind === "project" ? projects.find((p) => p.id === scope.id)?.name : undefined}
        onGoTo={(p) => setScope(p ? { kind: "project", id: p } : { kind: "all" })}
        picked={scope.kind === "project" && canvasPick?.project === scope.id ? canvasPick : null}
        onOpenRef={openFromAsk}
        onOpenBrand={(focus) => setScope({ kind: "brand", focus })}
        onShowInGrid={showPicked}
        onRunning={setAskRunning}
        onDoing={setAskDoing}
        onLibraryChanged={() => void refresh()}
      />

      <PackChooser
        onDone={(text) => {
          say(text);
          void refresh();
        }}
        onError={sayError}
      />

      {settingsOpen && stats && <Settings stats={stats} online={online} onClose={() => setSettingsOpen(false)} />}

      <div className={`dropzone ${dragging && scope.kind !== "brand" ? "show" : ""}`} aria-hidden={!dragging}>
        <div className="dropzone-card">
          <Icon name="download" size={22} />
          <p>Drop to save to your library</p>
          <span>Images, videos, fonts, .md skill files, or a link</span>
        </div>
      </div>

      {toast && (
        <div key={toast.id} className={`toast ${toast.tone ?? ""}`} role="status">
          {toast.tone === "error" ? <Icon name="alert" size={14} /> : <span className="toast-dot" />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** One quiet line at the top of Skills: how many FRIDAY uses, and what they add to every message. */
function SkillsLine({ count }: { count: number }) {
  const page = useSyncExternalStore(skillStore.subscribe, skillStore.get);
  // Read again when a skill is added or removed.
  useEffect(() => void skillStore.refresh().catch(() => {}), [count]);
  if (!page || !page.skills.length) return null;
  const text = page.on
    ? `${page.on} used by FRIDAY${page.tokens ? `, adding about ${page.tokens.toLocaleString("en")} tokens to every message` : ""}`
    : "None used by FRIDAY yet: open one to turn it on";
  return <span className="subtitle skills-line">{text}</span>;
}

function headingFor(scope: Scope, collections: Collection[], stats: Stats | null) {
  switch (scope.kind) {
    case "all": return { title: "Panel", subtitle: stats ? `${stats.total} reference${stats.total === 1 ? "" : "s"}` : "" };
    case "favorites": return { title: "Favorites", subtitle: "The ones that matter most." };
    case "sites": return { title: "Sites", subtitle: "Whole websites, top to bottom, on desktop and phone." };
    case "people": return { title: "People & Accounts", subtitle: "Designers and studios to follow: their profiles and portfolios." };
    case "skills": return { title: "Skills", subtitle: "SKILL.md files for your AI agents. Drop files or a folder here, or paste a GitHub link." };
    case "hidden": return { title: "Hidden", subtitle: "Kept, but out of sight everywhere else." };
    case "status":
      return {
        title: STATUS_LABEL[scope.status],
        subtitle: {
          archived: "Media saved and verified on this Mac.",
          link_only: "Only a link or preview. Playback depends on the source.",
          failed: "The media wasn’t saved. Open one to try again.",
          pending: "Downloading and checking files…",
        }[scope.status],
      };
    case "picked":
      return {
        title: "From FRIDAY",
        subtitle: `${scope.ids.length} saves · ${scope.title.length > 60 ? `${scope.title.slice(0, 59)}…` : scope.title}`,
      };
    case "collection": {
      const c = collections.find((x) => x.id === scope.id);
      return { title: c?.name ?? "Collection", subtitle: c ? `${c.n} reference${c.n === 1 ? "" : "s"}` : "" };
    }
    case "project": return { title: "Project", subtitle: "" };
    case "fonts": return { title: "Fonts", subtitle: "" };
    case "ready": return { title: "Ready-made", subtitle: "" };
    case "brand": return { title: "Brand assets", subtitle: "" };
  }
}

// ---------- Header ----------

function Command(props: {
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  setValue: (v: string) => void;
  isUrl: boolean;
  question: boolean;
  onAsk: () => void;
  saving: "idle" | "busy" | "done";
  onSave: () => void;
}) {
  const { value, setValue, isUrl, saving, question } = props;
  return (
    <div className={`command ${isUrl ? "is-url" : ""} ${value ? "has-value" : ""}`}>
      {/* No magnifier for now (trying the field without it); still show when a link is
          recognized and while it saves. */}
      {(saving !== "idle" || isUrl) && (
        <span className="command-icon">
          {saving === "busy" ? <span className="spinner" /> : saving === "done" ? <span className="check-in"><Icon name="check" size={18} /></span> : <Icon name="link" size={18} />}
        </span>
      )}
      <input
        ref={props.inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" && isUrl) props.onSave();
          // A question goes to the assistant: Tab, or Enter when it plainly is one.
          if (question && (e.key === "Tab" || (e.key === "Enter" && value.trim().endsWith("?")))) {
            e.preventDefault();
            props.onAsk();
          }
        }}
        placeholder={props.placeholder}
        spellCheck={false}
        aria-label="Search your library or paste a link to save"
      />
      {question && !isUrl ? (
        <button className="command-ask" onClick={props.onAsk} title="Ask FRIDAY about your library (Tab)">
          <Mark size={15} active />
          Ask FRIDAY <kbd>⇥</kbd>
        </button>
      ) : isUrl ? (
        <button className="command-save" onClick={props.onSave}>
          Save <kbd>↵</kbd>
        </button>
      ) : value ? (
        <button className="command-clear" onClick={() => setValue("")} aria-label="Clear">
          <Icon name="x" size={13} />
        </button>
      ) : (
        <kbd className="command-kbd">⌘K</kbd>
      )}
    </div>
  );
}

function AddFiles({
  onFiles, onFolder, skills, inputRef: ref,
}: { onFiles: (f: File[]) => void; onFolder: (f: File[]) => void; skills: boolean; inputRef: React.RefObject<HTMLInputElement | null> }) {
  // On Skills, the + offers .md files or a whole folder of skills.
  const folderRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        className="round-btn"
        onClick={(e) => {
          if (!skills) return ref.current?.click();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: r.left, y: r.top - 8 });
        }}
        title={skills ? "Add .md skill files or a folder of skills from this Mac (⌘U)" : "Add images, videos or .md skill files from this Mac (⌘U)"}
        aria-keyshortcuts="Meta+U"
        aria-label="Add files"
      >
        <Icon name="plus" size={18} />
      </button>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button className="menu-item" onClick={() => { setMenu(null); ref.current?.click(); }}>
            <span className="menu-check"><Icon name="file" size={13} /></span>
            .md skill files…
          </button>
          <button className="menu-item" onClick={() => { setMenu(null); folderRef.current?.click(); }}>
            <span className="menu-check"><Icon name="folder" size={13} /></span>
            A folder of skills…
          </button>
        </Popover>
      )}
      <input
        ref={ref}
        type="file"
        accept={skills ? ".md,.markdown,text/markdown" : "image/*,video/*,.md,.markdown"}
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {skills && (
        <input
          ref={folderRef}
          type="file"
          // A folder: the browser hands over every file in it, with its path inside.
          {...({ webkitdirectory: "" } as Record<string, string>)}
          hidden
          onChange={(e) => {
            onFolder([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      )}
    </>
  );
}

/**
 * Media type filter, tucked behind a button since it's rarely needed. When a
 * filter is on, the button opens up into a chip that says so, with a quick ×.
 */
function MediaFilterButton({ media, setMedia, stats }: { media: MediaFilter; setMedia: (m: MediaFilter) => void; stats: Stats | null }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const label = media === "image" ? "Images" : media === "video" ? "Videos" : null;
  const open = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 6 });
  };
  const options: { value: MediaFilter; label: string; n?: number }[] = [
    { value: "all", label: "Everything", n: stats?.total },
    { value: "image", label: "Images", n: stats ? stats.total - stats.videos : undefined },
    { value: "video", label: "Videos", n: stats?.videos },
  ];
  return (
    <>
      {label ? (
        <span className="filter-chip" key="chip">
          <button className="filter-chip-main" onClick={open} title="Change media filter">
            <Icon name="filter" size={13} />
            {label}
          </button>
          <button className="filter-chip-x" onClick={() => setMedia("all")} aria-label="Show everything" title="Show everything">
            <Icon name="x" size={11} />
          </button>
        </span>
      ) : (
        <button className="round-btn small" onClick={open} aria-label="Filter by media type" title="Filter: images or videos">
          <Icon name="filter" size={13} />
        </button>
      )}
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="menu-label">Show</div>
          {options.map((o) => (
            <button
              key={o.value}
              className={`menu-item ${media === o.value ? "on" : ""}`}
              onClick={() => {
                setMedia(o.value);
                setMenu(null);
              }}
            >
              {/* Only the chosen one is marked; the others line up after an empty slot. */}
              <span className="menu-check">{media === o.value && <Icon name="check" size={12} />}</span>
              {o.label}
              {o.n !== undefined && <span className="menu-count">{o.n}</span>}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

// ---------- Sidebar ----------

// A yes/no the browser remembers between visits (a folded sidebar group, say). If the browser
// won't keep it, it simply starts from the default next time.
function useRemembered(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* not remembered, that's all */
      }
    },
    [key],
  );
  return [value, set];
}

function Sidebar(props: {
  scope: Scope;
  setScope: (s: Scope) => void;
  stats: Stats | null;
  collections: Collection[];
  projects: ProjectSummary[];
  onProjectsChanged: () => Promise<void>;
  online: boolean;
  onChanged: () => Promise<void>;
  onError: (text: string) => void;
  onSettings: () => void;
  hover?: { onMouseEnter: () => void; onMouseLeave: () => void };
  tucked: boolean;
  onTuck: () => void;
}) {
  const { scope, setScope, stats, collections } = props;
  const [creating, setCreating] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // A collection's menu (the ··· on its row, or a right-click): rename, duplicate, delete.
  const [colMenu, setColMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openColMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).closest(".side-row")!.getBoundingClientRect();
    setConfirmDelete(false);
    setColMenu({ id, x: r.right - 180, y: r.bottom + 4 });
  };

  const duplicate = async (id: string) => {
    setColMenu(null);
    try {
      const c = await api.duplicateCollection(id);
      await props.onChanged();
      setScope({ kind: "collection", id: c.id });
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    setColMenu(null);
    try {
      await api.deleteCollection(id);
      if (scope.kind === "collection" && scope.id === id) setScope({ kind: "all" });
      await props.onChanged();
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  const createProject = async (name: string) => {
    setCreatingProject(false);
    if (!name) return;
    try {
      const p = await projectApi.create(name);
      await props.onProjectsChanged();
      setScope({ kind: "project", id: p.id });
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  // Projects and Collections fold away with a click on their heading, and stay that way between visits.
  const [projectsOpen, setProjectsOpen] = useRemembered("panel.side.projects", true);
  const [collectionsOpen, setCollectionsOpen] = useRemembered("panel.side.collections", true);
  const foldHead = (label: string, open: boolean, setOpen: (v: boolean) => void) => (
    <button
      className={`side-fold-head ${open ? "" : "closed"}`}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      title={open ? `Fold ${label} away` : `Show ${label}`}
    >
      {label}
      <span className={`chev ${open ? "open" : ""}`}><Icon name="chevron-down" size={11} /></span>
    </button>
  );

  const link = (s: Scope, label: React.ReactNode, count?: number, extra?: React.ReactNode, key?: string) => (
    <button
      className={`side-link ${sameScope(scope, s) ? "on" : ""}`}
      onClick={() => setScope(s)}
      title={key ? `Press ${key}` : undefined}
      aria-keyshortcuts={key}
    >
      {extra}
      <span className="side-label">{label}</span>
      <span className="side-dot" />
      {count !== undefined && <span className="side-count">{count}</span>}
    </button>
  );

  const create = async (name: string) => {
    setCreating(false);
    if (!name) return;
    try {
      const c = await api.createCollection(name);
      await props.onChanged();
      setScope({ kind: "collection", id: c.id });
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  const rename = async (id: string, next: string) => {
    setRenaming(null);
    if (!next || next === collections.find((c) => c.id === id)?.name) return;
    try {
      await api.renameCollection(id, next);
      await props.onChanged();
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  // Only surface references that aren't safely archived. Keep the row you're viewing
  // so it doesn't vanish under you after a successful retry.
  const statuses = (["failed", "link_only", "pending"] as RefStatus[]).filter(
    (s) => (stats?.byStatus[s] ?? 0) > 0 || (scope.kind === "status" && scope.status === s),
  );
  const onlySaving = statuses.every((s) => s === "pending");

  return (
    <aside className="sidebar" {...props.hover}>
      <div className="side-top">
        <button className="brand" onClick={() => setScope({ kind: "all" })} aria-label="Panel, go to library">
          <span className="brand-mark" aria-hidden />
        </button>
        <button
          className="side-tuck"
          onClick={props.onTuck}
          aria-label={props.tucked ? "Keep the sidebar open" : "Tuck the sidebar away"}
          title={props.tucked ? "Keep the sidebar open (⌘B)" : "Tuck the sidebar away (⌘B)"}
          aria-keyshortcuts="Meta+B"
        >
          <Icon name="sidebar" size={16} />
        </button>
      </div>

      <div className="side-group">
        <div className="side-heading">Browse</div>
        {link({ kind: "all" }, "Panel", stats?.total, undefined, "P")}
        {link({ kind: "favorites" }, "Favorites", stats?.favorites, undefined, "F")}
        {link({ kind: "sites" }, "Sites", stats?.sites, undefined, "S")}
        {link({ kind: "people" }, "People & Accounts", stats?.people)}
        {link({ kind: "skills" }, "Skills", stats?.skills)}
        {link({ kind: "fonts" }, "Fonts")}
        {link({ kind: "ready" }, "Ready-made")}
        {link({ kind: "brand" }, "Brand assets")}
        {link({ kind: "hidden" }, "Hidden", stats?.hidden, undefined, "H")}
      </div>

      {statuses.length > 0 && (
        <div className="side-group attention">
          <div className="side-heading">{onlySaving ? "In progress" : "Needs attention"}</div>
          {statuses.map((s) => (
            <div key={s}>{link({ kind: "status", status: s }, STATUS_LABEL[s], stats?.byStatus[s] ?? 0, <span className={`dot ${s}`} />)}</div>
          ))}
        </div>
      )}

      <div className="side-group">
        <div className="side-heading">
          {foldHead("Projects", projectsOpen, setProjectsOpen)}
          <button className="side-add" onClick={() => { setProjectsOpen(true); setCreatingProject(true); }} aria-label="New project" title="New project">
            <Icon name="plus" size={13} />
          </button>
        </div>
        <div className={`side-fold ${projectsOpen ? "open" : ""}`} inert={!projectsOpen}>
          <div>
            {props.projects.map((p) => (
              <div key={p.id}>
                {link({ kind: "project", id: p.id }, p.name, undefined, <span className="side-project-dot" />)}
              </div>
            ))}
          </div>
        </div>
        {creatingProject ? (
          <InlineName initial="" placeholder="Project name" onDone={createProject} onCancel={() => setCreatingProject(false)} />
        ) : (
          props.projects.length === 0 && (
            <button className="side-link faint" onClick={() => setCreatingProject(true)}>
              <span className="side-label">New project</span>
            </button>
          )
        )}
      </div>

      <div className="side-group">
        <div className="side-heading">
          {foldHead("Collections", collectionsOpen, setCollectionsOpen)}
          <button className="side-add" onClick={() => { setCollectionsOpen(true); setCreating(true); }} aria-label="New collection" title="New collection">
            <Icon name="plus" size={13} />
          </button>
        </div>
        <div className={`side-fold ${collectionsOpen ? "open" : ""}`} inert={!collectionsOpen}>
          <div>
        {collections.map((c) =>
          renaming === c.id ? (
            <InlineName key={c.id} initial={c.name} onDone={(v) => rename(c.id, v)} onCancel={() => setRenaming(null)} />
          ) : (
            <div key={c.id} className={`side-row ${colMenu?.id === c.id ? "menu-open" : ""}`} onDoubleClick={() => setRenaming(c.id)} onContextMenu={(e) => openColMenu(e, c.id)}>
              {link({ kind: "collection", id: c.id }, c.name, c.n)}
              <button className="side-edit" onClick={(e) => openColMenu(e, c.id)} aria-label={`More for ${c.name}`} aria-haspopup="menu" title="Rename, duplicate or delete">
                <Icon name="more" size={14} />
              </button>
            </div>
          ),
        )}
          </div>
        </div>
        {colMenu && (() => {
          const c = collections.find((x) => x.id === colMenu.id);
          if (!c) return null;
          return (
            <Popover x={colMenu.x} y={colMenu.y} onClose={() => setColMenu(null)}>
              <div className="menu-title">{c.name}</div>
              <button className="menu-item" onClick={() => { setColMenu(null); setRenaming(c.id); }}>
                <Icon name="pencil" size={13} /> Rename
              </button>
              <button className="menu-item" onClick={() => void duplicate(c.id)}>
                <Icon name="copy" size={13} /> Duplicate
              </button>
              <div className="menu-sep" />
              {/* A collection with saves in it takes a second click; the saves themselves stay. */}
              <button
                className="menu-item danger"
                onClick={() => (c.n === 0 || confirmDelete ? void remove(c.id) : setConfirmDelete(true))}
                title="The saves in it stay in Panel"
              >
                <Icon name="trash" size={13} />
                {confirmDelete ? "Delete it? Its saves stay" : "Delete collection"}
              </button>
            </Popover>
          );
        })()}
        {creating ? (
          <InlineName initial="" placeholder="Collection name" onDone={create} onCancel={() => setCreating(false)} />
        ) : (
          collections.length === 0 && (
            <button className="side-link faint" onClick={() => setCreating(true)}>
              <span className="side-label">New collection</span>
            </button>
          )
        )}
      </div>

      <div className="side-foot">
        <span className={`dot ${props.online ? "archived" : "link_only"}`} />
        <span className="side-foot-text">{props.online ? "Online" : "Offline · library still works"}</span>
        <button className="side-add side-settings" onClick={props.onSettings} aria-label="Library settings" title="Library & storage">
          <Icon name="settings" size={14} />
        </button>
      </div>
    </aside>
  );
}

/** Things worth a glance once in a while: storage, location, health. */
function Settings({ stats, online, onClose }: { stats: Stats; online: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const imageBytes = stats.bytes - stats.videoBytes;
  const used = stats.diskFree !== null ? stats.bytes / (stats.bytes + stats.diskFree) : null;
  const problems = (stats.byStatus.failed ?? 0) + (stats.byStatus.link_only ?? 0);

  return (
    <div className="sheet-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Library and storage">
        <div className="sheet-head">
          <h2>Library</h2>
          <button className="round-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </div>

        <div className="sheet-big">
          <span>{formatBytes(stats.bytes)}</span>
          <span className="muted">saved on this Mac</span>
        </div>
        {used !== null && (
          <div className="meter" title={`${(used * 100).toFixed(2)}% of the space available to the library`}>
            <span className="meter-video" style={{ width: `${Math.max((stats.videoBytes / (stats.bytes + stats.diskFree!)) * 100, stats.videoBytes ? 0.6 : 0)}%` }} />
            <span className="meter-image" style={{ width: `${Math.max((imageBytes / (stats.bytes + stats.diskFree!)) * 100, imageBytes ? 0.6 : 0)}%` }} />
          </div>
        )}
        <div className="legend">
          <span><i className="meter-video" /> Videos {formatBytes(stats.videoBytes)}</span>
          <span><i className="meter-image" /> Images {formatBytes(imageBytes)}</span>
          {stats.diskFree !== null && <span><i /> Free {formatBytes(stats.diskFree)}</span>}
        </div>

        <dl className="facts">
          <div><dt>References</dt><dd>{stats.total}</dd></div>
          <div><dt>Files on disk</dt><dd>{stats.files}</dd></div>
          <div><dt>Archived</dt><dd className="with-icon"><span className="dot archived" />{stats.byStatus.archived ?? 0}</dd></div>
          {problems > 0 && <div><dt>Need attention</dt><dd className="with-icon"><span className="dot failed" />{problems}</dd></div>}
          <div><dt>Connection</dt><dd className="with-icon"><span className={`dot ${online ? "archived" : "link_only"}`} />{online ? "Online" : "Offline"}</dd></div>
          <div>
            <dt>Location</dt>
            <dd title={stats.libraryDir}>{stats.libraryDir.replace(/^\/Users\/[^/]+/, "~")}</dd>
          </div>
        </dl>

        <ReadingSettings />
        <MeaningSettings />
        <BackupSettings />

        <button className="btn-wide" onClick={() => api.revealLibrary()}>
          <Icon name="folder" size={14} /> Show library in Finder
        </button>
      </div>
    </div>
  );
}

function Empty({ scope, filtered }: { scope: Scope; filtered: boolean }) {
  if (filtered) return <div className="empty"><p>Nothing here with these filters.</p></div>;
  if (scope.kind === "all")
    return (
      <div className="empty hero">
        <div className="empty-art" aria-hidden>
          <span /><span /><span />
        </div>
        <h2>Start your library</h2>
        <p>Paste an X post or any link into the field above, or press ⌘V anywhere. You can also drop in images and videos.</p>
        <p className="faint">Everything is saved to this Mac and keeps playing offline.</p>
      </div>
    );
  if (scope.kind === "collection")
    return <div className="empty"><p>This collection is empty. Open any reference and add it here.</p></div>;
  if (scope.kind === "sites")
    return (
      <div className="empty">
        <p>No sites yet. Paste any website's link (⌘V anywhere) and Panel keeps a full-page screenshot of it, on desktop and on phone.</p>
      </div>
    );
  if (scope.kind === "people")
    return (
      <div className="empty">
        <p>
          No one here yet. Paste a profile link (⌘V anywhere) to keep the person: their photo, name and bio. Instagram, X, Threads,
          TikTok, YouTube, LinkedIn, Dribbble, Behance, Pinterest, Vimeo, Are.na, Bluesky and GitHub all work. Any other link
          pasted on this page is kept here as a portfolio, with full-page screenshots.
        </p>
      </div>
    );
  if (scope.kind === "skills")
    return (
      <div className="empty">
        <p>
          No skills yet. Drop SKILL.md (or any .md) files here, add them with the + button, or paste a link to one. To add
          several at once, paste a GitHub project's link (like github.com/emilkowalski/skills) or drop a folder of skills,
          then pick the ones you want. Each is kept as text you can read, search and copy.
        </p>
      </div>
    );
  if (scope.kind === "hidden")
    return <div className="empty"><p>Nothing hidden. Hover a card and use the eye button to keep something out of sight.</p></div>;
  return <div className="empty"><p>Nothing here yet.</p></div>;
}
