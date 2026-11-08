import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RailHandle } from "./RailHandle.tsx";
import { flushSync } from "react-dom";
import {
  api, formatBytes, prefersReducedMotion, projectApi, STATUS_LABEL,
  type Collection, type ProjectSummary, type Filters, type Ref, type RefStatus, type Section, type Stats, type TagGroup, type TagInfo,
} from "./api.ts";
import { Detail } from "./Detail.tsx";
import { Masonry } from "./Grid.tsx";
import { Icon } from "./Icon.tsx";
import { ReadingSettings } from "./Reading.tsx";
import { InlineName } from "./InlineName.tsx";
import { Assistant, type AssistantHandle } from "./Assistant.tsx";
import { Mark } from "./Glow.tsx";
import { Popover, TagRow } from "./TagRow.tsx";

// The canvas (and React Flow with it) loads only when a project is opened.
const ProjectCanvas = lazy(() => import("./Canvas.tsx"));

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
  /** Saves the assistant brought up, shown together in the grid. */
  | { kind: "picked"; ids: string[]; title: string };
type MediaFilter = "all" | "image" | "video";

const sameScope = (a: Scope, b: Scope) => JSON.stringify(a) === JSON.stringify(b);
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

  const isUrl = looksLikeUrl(query);
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
  const refresh = useCallback(async () => {
    void refreshProjects();
    const [r, s, c, t, g] = await Promise.all([
      api.refs(filters), api.stats(), api.collections(), api.tags(section), api.tagGroups(section),
    ]);
    setRefs(r);
    setStats(s);
    setCollections(c);
    setTags(t);
    setTagGroups(g);
  }, [filters, section, refreshProjects]);

  const say = useCallback((text: string, tone?: "error") => setToast({ id: Date.now(), text, tone }), []);

  useEffect(() => {
    refresh().catch((e) => say(`Can't reach the Panel companion. ${e.message}`, "error"));
  }, [refresh, say]);

  // While anything is still downloading, keep the grid honest.
  const anyPending = (stats?.byStatus.pending ?? 0) > 0;
  useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(() => refresh().catch(() => {}), 1500);
    return () => clearInterval(t);
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

  const uploadFiles = useCallback(
    async (files: File[]) => {
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
    [refresh, say],
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

  // Paste anywhere (outside a text field) to save a link or files.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
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
      const files = [...e.dataTransfer.files];
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
  const allPicked = !!refs?.length && pickedRefs.length === refs.length;
  const pickAll = useCallback(() => setPicked(new Set(refs?.map((r) => r.id))), [refs]);

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
  const available = useMemo(() => new Set(refs?.flatMap((r) => r.tags) ?? []), [refs]);

  const openIndex = refs && open ? refs.findIndex((r) => r.id === open.id) : -1;
  const { title, subtitle: baseSubtitle } = headingFor(scope, collections, stats);
  // While tags, media type or search narrow the grid, say how many are showing.
  const narrowed = scope.kind === "all" && refs && stats && (selectedTags.length > 0 || media !== "all" || !!debounced);
  const subtitle = narrowed ? `${refs.length} of ${stats.total} references` : baseSubtitle;

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
      aria-label="Ask"
      title="Ask about your library (⌘J)"
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
        {scope.kind === "project" ? (
          <Suspense fallback={null}>
            <ProjectCanvas
              key={scope.id}
              id={scope.id}
              dock={dockSlot}
              onOpenRef={openFromAsk}
              onError={(t) => say(t, "error")}
              onRenamed={refreshProjects}
              onDeleted={leaveProject}
            />
          </Suspense>
        ) : (
        <>
        <header className="header">
          <div className="title-row">
            <h1 key={title}>{title}</h1>
            <span className="subtitle">{subtitle}</span>
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
              ? `${refs.length} match${refs.length === 1 ? "" : "es"} for “${debounced}”`
              : looksLikeQuestion(debounced)
                ? "No save matches those exact words. Press ⇥ to ask instead: Ask reads the whole library."
                : `Nothing matches “${debounced}” yet.`}
          </p>
        )}

        {refs === null ? null : refs.length === 0 ? (
          !debounced && <Empty scope={scope} filtered={media !== "all" || selectedTags.length > 0} />
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
                : scope.kind === "skills" ? "Search skills, or paste a link to a .md file"
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
            <AddFiles onFiles={uploadFiles} skills={scope.kind === "skills"} inputRef={fileInputRef} />
            {askButton}
          </>
        )}
      </div>

      {open && (
        <Detail
          initial={open}
          collections={collections}
          onClose={closeDetail}
          onPrev={openIndex > 0 ? () => setOpen(refs![openIndex - 1]!) : undefined}
          onNext={openIndex >= 0 && openIndex < refs!.length - 1 ? () => setOpen(refs![openIndex + 1]!) : undefined}
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
        onOpenRef={openFromAsk}
        onShowInGrid={showPicked}
        onRunning={setAskRunning}
        onLibraryChanged={() => void refresh()}
      />

      {settingsOpen && stats && <Settings stats={stats} online={online} onClose={() => setSettingsOpen(false)} />}

      <div className={`dropzone ${dragging ? "show" : ""}`} aria-hidden={!dragging}>
        <div className="dropzone-card">
          <Icon name="download" size={22} />
          <p>Drop to save to your library</p>
          <span>Images, videos, .md skill files, or a link</span>
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

function headingFor(scope: Scope, collections: Collection[], stats: Stats | null) {
  switch (scope.kind) {
    case "all": return { title: "Panel", subtitle: stats ? `${stats.total} reference${stats.total === 1 ? "" : "s"}` : "" };
    case "favorites": return { title: "Favorites", subtitle: "The ones that matter most." };
    case "sites": return { title: "Sites", subtitle: "Whole websites, top to bottom, on desktop and phone." };
    case "people": return { title: "People & Accounts", subtitle: "Designers and studios to follow: their profiles and portfolios." };
    case "skills": return { title: "Skills", subtitle: "SKILL.md files for your AI agents. Drop .md files here to add them." };
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
        title: "From Ask",
        subtitle: `${scope.ids.length} saves · ${scope.title.length > 60 ? `${scope.title.slice(0, 59)}…` : scope.title}`,
      };
    case "collection": {
      const c = collections.find((x) => x.id === scope.id);
      return { title: c?.name ?? "Collection", subtitle: c ? `${c.n} reference${c.n === 1 ? "" : "s"}` : "" };
    }
    case "project": return { title: "Project", subtitle: "" };
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
        <button className="command-ask" onClick={props.onAsk} title="Ask about your library (Tab)">
          <Mark size={15} active />
          Ask <kbd>⇥</kbd>
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
  onFiles, skills, inputRef: ref,
}: { onFiles: (f: File[]) => void; skills: boolean; inputRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <>
      <button
        className="round-btn"
        onClick={() => ref.current?.click()}
        title={skills ? "Add .md skill files from this Mac (⌘U)" : "Add images, videos or .md skill files from this Mac (⌘U)"}
        aria-keyshortcuts="Meta+U"
        aria-label="Add files"
      >
        <Icon name="plus" size={18} />
      </button>
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
          Projects
          <button className="side-add" onClick={() => setCreatingProject(true)} aria-label="New project" title="New project">
            <Icon name="plus" size={13} />
          </button>
        </div>
        {props.projects.map((p) => (
          <div key={p.id}>
            {link({ kind: "project", id: p.id }, p.name, undefined, <span className="side-project-dot" />)}
          </div>
        ))}
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
          Collections
          <button className="side-add" onClick={() => setCreating(true)} aria-label="New collection" title="New collection">
            <Icon name="plus" size={13} />
          </button>
        </div>
        {collections.map((c) =>
          renaming === c.id ? (
            <InlineName key={c.id} initial={c.name} onDone={(v) => rename(c.id, v)} onCancel={() => setRenaming(null)} />
          ) : (
            <div key={c.id} className="side-row" onDoubleClick={() => setRenaming(c.id)}>
              {link({ kind: "collection", id: c.id }, c.name, c.n)}
              <button className="side-edit" onClick={() => setRenaming(c.id)} aria-label={`Rename ${c.name}`} title="Rename">
                <Icon name="pencil" size={12} />
              </button>
            </div>
          ),
        )}
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
          No skills yet. Drop SKILL.md (or any .md) files here, add them with the + button, or paste a link to one, like a file on
          GitHub. Each is kept as text you can read, search and copy.
        </p>
      </div>
    );
  if (scope.kind === "hidden")
    return <div className="empty"><p>Nothing hidden. Hover a card and use the eye button to keep something out of sight.</p></div>;
  return <div className="empty"><p>Nothing here yet.</p></div>;
}
