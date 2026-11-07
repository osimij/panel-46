import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, prefersReducedMotion, type Section, type TagGroup, type TagInfo } from "./api.ts";
import { Icon } from "./Icon.tsx";
import { InlineName } from "./InlineName.tsx";

const INNER_GAP = 2; // gap between pills inside an open group capsule
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

type Menu =
  | { kind: "tag"; name: string; x: number; y: number }
  | { kind: "group"; id: string; x: number; y: number };

/**
 * The tag filter row. Tags live in groups; a group is one pill until you open
 * it, then its tags slide out of it inside a growing capsule (and fold back
 * into it on close). Selected tags always sit at the front.
 */
export function TagRow(props: {
  /** Whose tags these are: the page's section. */
  scope: Section;
  /** Goes up by one each time T is pressed on the page: opens "New tag". */
  newTagSignal?: number;
  tags: TagInfo[];
  groups: TagGroup[];
  selected: string[];
  setSelected: (t: string[]) => void;
  mode: "all" | "any";
  setMode: (m: "all" | "any") => void;
  available: Set<string>;
  onChanged: () => Promise<void>;
  onError: (t: string) => void;
  tools?: React.ReactNode;
}) {
  const { tags, groups, selected, setSelected, mode, setMode, available } = props;
  const rowRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [closing, setClosing] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [moreRight, setMoreRight] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null); // just created: pop it in

  // Fade the right edge only while there are tags hidden past it.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const check = () => setMoreRight(row.scrollWidth - row.scrollLeft - row.clientWidth > 1);
    row.addEventListener("scroll", check, { passive: true });
    check();
    const ro = new ResizeObserver(check);
    ro.observe(row);
    const mo = new MutationObserver(check);
    mo.observe(row, { childList: true, subtree: true });
    return () => {
      row.removeEventListener("scroll", check);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const groupIds = new Set(groups.map((g) => g.id));
  const free = (t: TagInfo) => !selected.includes(t.name);
  const childrenOf = (gid: string) => tags.filter((t) => t.group_id === gid && free(t));
  const ungrouped = tags.filter((t) => (!t.group_id || !groupIds.has(t.group_id)) && free(t));
  const selectedTags = selected.map((name) => tags.find((t) => t.name === name) ?? { name, n: 0, group_id: null });
  const isDead = (t: TagInfo) => !editing && mode === "all" && !available.has(t.name);
  const groupDead = (g: TagGroup) => {
    const kids = childrenOf(g.id);
    return kids.length > 0 && kids.every(isDead);
  };

  // When pills change places (e.g. faded ones sink to the end), glide them there
  // instead of jumping: measure where each one was and animate from there (FLIP).
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const items = [...row.querySelectorAll<HTMLElement>(":scope > [data-key]")];
    // While a group is unfolding, its neighbours are already moving; don't double-animate.
    const unfolding = [...row.querySelectorAll<HTMLElement>("[data-child-of]")].some((el) =>
      el.getAnimations().some((a) => a.playState === "running"),
    );
    const next = new Map(items.map((el) => [el.dataset.key!, el.offsetLeft]));
    if (!unfolding && !prefersReducedMotion()) {
      for (const el of items) {
        const before = positions.current.get(el.dataset.key!);
        const dx = before === undefined ? 0 : before - el.offsetLeft;
        if (Math.abs(dx) >= 1) {
          el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 460, easing: EASE_OUT });
        }
      }
    }
    positions.current = unfolding ? new Map() : next;
  });

  // ---- Folding ----

  /** Fold a group's tags back into its pill, then drop them from the DOM. */
  const fold = useCallback((gid: string) => {
    const els = [...(rowRef.current?.querySelectorAll<HTMLElement>(`[data-child-of="${gid}"]`) ?? [])];
    if (!els.length || prefersReducedMotion()) return Promise.resolve();
    setClosing((c) => [...c, gid]);
    const anims = els.reverse().map((el, i) =>
      el.animate(
        [
          { marginLeft: "0px", opacity: 1, transform: "none", filter: "blur(0)" },
          { marginLeft: `${-(el.offsetWidth + INNER_GAP)}px`, opacity: 0, transform: "scale(0.82)", filter: "blur(2px)" },
        ],
        { duration: 260, delay: i * 22, easing: EASE_IN, fill: "forwards" },
      ),
    );
    // Don't wait forever if the window isn't painting (animations stall when hidden).
    const settled = Promise.race([
      Promise.all(anims.map((a) => a.finished.catch(() => {}))),
      new Promise((r) => setTimeout(r, 260 + els.length * 22 + 200)),
    ]);
    return settled.then(() => setClosing((c) => c.filter((x) => x !== gid)));
  }, []);

  const toggleGroup = (gid: string) => {
    if (open === gid) {
      setOpen(null);
      void fold(gid);
      return;
    }
    if (closing.includes(gid)) {
      // Re-opened mid-fold: stop folding and let it spring back out.
      rowRef.current?.querySelectorAll<HTMLElement>(`[data-child-of="${gid}"]`).forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
      setClosing((c) => c.filter((x) => x !== gid));
    }
    if (open) void fold(open);
    setOpen(gid);
  };

  // Keep the opened group in view when it unfolds near the end of the row.
  useLayoutEffect(() => {
    if (!open) return;
    const row = rowRef.current;
    const pill = row?.querySelector<HTMLElement>(`[data-group="${open}"]`);
    if (row && pill && pill.offsetLeft > row.scrollLeft + row.clientWidth * 0.45) {
      row.scrollTo({ left: pill.offsetLeft - 8, behavior: "smooth" });
    }
  }, [open]);

  const finishEditing = async () => {
    // Commit a name that's still being typed before folding everything away.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setRenamingTag(null);
    setRenamingGroup(null);
    await Promise.all(groups.filter((g) => g.id !== open).map((g) => fold(g.id)));
    setEditing(false);
  };

  // ---- Data changes ----

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      await props.onChanged();
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  const renameTag = async (from: string, next: string) => {
    setRenamingTag(null);
    if (!next || next.toLowerCase() === from) return;
    try {
      const { name } = await api.renameTag(props.scope, from, next);
      if (selected.includes(from)) setSelected([...new Set(selected.map((t) => (t === from ? name : t)))]);
      await props.onChanged();
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  const createTag = async (name: string) => {
    try {
      const t = await api.createTag(props.scope, name);
      await props.onChanged();
      setFresh(t.name);
      // Only the first appearance pops; later (e.g. unfolding in a group) it moves like the others.
      setTimeout(() => setFresh((f) => (f === t.name ? null : f)), 700);
      // If it already existed it may be anywhere in the row; bring it into view.
      requestAnimationFrame(() =>
        rowRef.current?.querySelector(`[data-key="t:${CSS.escape(t.name)}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }),
      );
    } catch (e) {
      props.onError((e as Error).message);
    }
  };

  const deleteTag = async (name: string) => {
    if (selected.includes(name)) setSelected(selected.filter((t) => t !== name));
    await run(api.deleteTag(props.scope, name));
  };

  const toggle = (name: string) =>
    setSelected(selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name]);

  const openMenu = (e: React.MouseEvent, m: { kind: "tag"; name: string } | { kind: "group"; id: string }) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ ...m, x: r.left, y: r.bottom + 6 } as Menu);
  };

  // ---- Pieces ----

  const tagPill = (t: TagInfo, opts: { childOf?: string; index?: number; on?: boolean } = {}) => {
    if (renamingTag === t.name)
      return <InlineName key={`t:${t.name}`} initial={t.name} className="pill-input" onDone={(v) => renameTag(t.name, v)} onCancel={() => setRenamingTag(null)} />;
    const dead = !opts.on && isDead(t);
    return (
      <TagPill
        key={`t:${t.name}`}
        dataKey={opts.childOf ? undefined : `t:${t.name}`}
        childOf={opts.childOf}
        index={opts.index ?? 0}
        animateIn={!!opts.childOf && !closing.includes(opts.childOf)}
        className={`pill ${opts.childOf ? "child" : ""} ${opts.on && !editing ? "on" : ""} ${dead ? "dead" : ""} ${fresh === t.name ? "fresh" : ""}`}
        onClick={(e) => (editing ? openMenu(e, { kind: "tag", name: t.name }) : toggle(t.name))}
        onDoubleClick={() => setRenamingTag(t.name)}
        onContextMenu={(e) => openMenu(e, { kind: "tag", name: t.name })}
        title={
          editing
            ? "Rename or move to a group"
            : t.n === 0
              ? "Not on any reference yet · add it from a reference's tags"
              : dead
                ? "Nothing matches this together with your current filters"
                : `${t.n} reference${t.n === 1 ? "" : "s"} · right-click to organize`
        }
        pressed={!!opts.on}
      >
        {opts.on && !editing && <span className="pill-check"><Icon name="check" size={11} /></span>}
        {t.name}
        {editing && <Icon name="pencil" size={10} />}
      </TagPill>
    );
  };

  const groupCapsule = (g: TagGroup) => {
    const kids = childrenOf(g.id);
    if (!kids.length && !editing) return null;
    const expanded = editing || open === g.id || closing.includes(g.id);
    const isOpen = editing || open === g.id;
    const allDead = groupDead(g);
    return (
      <span key={`g:${g.id}`} data-key={`g:${g.id}`} className={`capsule ${isOpen ? "open" : ""} ${allDead && !isOpen ? "dead" : ""}`}>
        {renamingGroup === g.id ? (
          <InlineName
            initial={g.name}
            className="pill-input group-input"
            onDone={(v) => {
              setRenamingGroup(null);
              if (v && v !== g.name) void run(api.renameTagGroup(g.id, v));
            }}
            onCancel={() => setRenamingGroup(null)}
          />
        ) : (
          <button
            className="pill group"
            data-group={g.id}
            aria-expanded={isOpen}
            onClick={() => (editing ? setRenamingGroup(g.id) : toggleGroup(g.id))}
            onContextMenu={(e) => openMenu(e, { kind: "group", id: g.id })}
            title={editing ? "Rename group" : isOpen ? "Fold" : `${kids.length} tag${kids.length === 1 ? "" : "s"}`}
          >
            <span className="group-name">{g.name}</span>
            <span className="group-badge" aria-hidden>
              <span className="group-count">{kids.length}</span>
              <span className="group-x"><Icon name={editing ? "pencil" : "x"} size={10} /></span>
            </span>
          </button>
        )}
        {expanded && kids.map((t, i) => tagPill(t, { childOf: g.id, index: i }))}
      </span>
    );
  };

  return (
    <div className="filters">
      {selected.length > 0 && !editing && (
        <div className="tag-logic">
          {selected.length > 1 && (
            <button
              className="pill logic"
              onClick={() => setMode(mode === "all" ? "any" : "all")}
              title={mode === "all" ? "Showing references with every selected tag. Click to show any of them." : "Showing references with any selected tag. Click to require all of them."}
            >
              <span key={mode} className="logic-word">{mode === "all" ? "Match all" : "Match any"}</span>
            </button>
          )}
          <button className="round-btn small" onClick={() => setSelected([])} aria-label="Clear tag filters" title="Clear tag filters">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      <div
        ref={rowRef}
        className={`pill-scroll ${editing ? "editing" : ""} ${moreRight ? "more-right" : ""}`}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {!editing && selectedTags.map((t) => tagPill(t, { on: true }))}
        {/* What can still match comes first; faded groups and tags sink to the end. */}
        {groups.filter((g) => !groupDead(g)).map(groupCapsule)}
        {ungrouped.filter((t) => !isDead(t)).map((t) => tagPill(t))}
        {groups.filter(groupDead).map(groupCapsule)}
        {ungrouped.filter(isDead).map((t) => tagPill(t))}
        <NewTagButton onCreate={createTag} signal={props.newTagSignal} />
        {editing && (
          <NewGroupButton onCreate={(name) => run(api.createTagGroup(props.scope, name))} />
        )}
      </div>

      {/* Toolbar pinned to the right edge: whatever the page adds (filter), then organize. */}
      <div className="row-tools">
        {props.tools}
        <button
          className={`round-btn small ${editing ? "on" : ""}`}
          onClick={() => (editing ? void finishEditing() : (setEditing(true), setOpen(null)))}
          title={editing ? "Done organizing" : "Organize tags: rename, group, move (or right-click any tag)"}
          aria-label={editing ? "Done organizing tags" : "Organize tags"}
        >
          <Icon name={editing ? "check" : "pencil"} size={13} />
        </button>
      </div>

      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.kind === "tag" ? (
            <TagMenu
              tag={tags.find((t) => t.name === menu.name)!}
              groups={groups}
              onRename={() => {
                setRenamingTag(menu.name);
                setMenu(null);
              }}
              onMove={(gid) => {
                setMenu(null);
                void run(api.moveTag(props.scope, menu.name, gid));
              }}
              onNewGroup={(name) => {
                setMenu(null);
                void run(api.createTagGroup(props.scope, name, [menu.name]));
              }}
              onDelete={() => {
                setMenu(null);
                void deleteTag(menu.name);
              }}
            />
          ) : (
            <GroupMenu
              group={groups.find((g) => g.id === menu.id)!}
              onRename={() => {
                setRenamingGroup(menu.id);
                setMenu(null);
              }}
              onDelete={async () => {
                setMenu(null);
                await fold(menu.id);
                if (open === menu.id) setOpen(null);
                await run(api.deleteTagGroup(menu.id));
              }}
            />
          )}
        </Popover>
      )}
    </div>
  );
}

/** A tag pill; inside a group it slides out from behind the group pill when it mounts. */
function TagPill(props: {
  dataKey?: string;
  childOf?: string;
  index: number;
  animateIn: boolean;
  className: string;
  pressed: boolean;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !props.animateIn || prefersReducedMotion()) return;
    el.animate(
      [
        { marginLeft: `${-(el.offsetWidth + INNER_GAP)}px`, opacity: 0, transform: "scale(0.82)", filter: "blur(2px)" },
        { marginLeft: "0px", opacity: 1, transform: "none", filter: "blur(0)" },
      ],
      { duration: 420, delay: props.index * 38, easing: EASE_OUT, fill: "backwards" },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button
      ref={ref}
      data-key={props.dataKey}
      data-child-of={props.childOf}
      className={props.className}
      aria-pressed={props.pressed}
      title={props.title}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      {props.children}
    </button>
  );
}

/** The dashed pill at the end of the row: type a name, Enter makes the tag. */
function NewTagButton({ onCreate, signal = 0 }: { onCreate: (name: string) => void; signal?: number }) {
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (signal) setAdding(true);
  }, [signal]);
  if (adding)
    return (
      <InlineName
        initial=""
        placeholder="New tag"
        className="pill-input"
        onDone={(v) => {
          setAdding(false);
          if (v) onCreate(v);
        }}
        onCancel={() => setAdding(false)}
      />
    );
  return (
    <button className="pill ghost" onClick={() => setAdding(true)} title="Create a tag (T)" aria-keyshortcuts="T">
      <Icon name="plus" size={11} /> New tag
    </button>
  );
}

function NewGroupButton({ onCreate }: { onCreate: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  if (adding)
    return (
      <InlineName
        initial=""
        placeholder="Group name"
        className="pill-input"
        onDone={(v) => {
          setAdding(false);
          if (v) onCreate(v);
        }}
        onCancel={() => setAdding(false)}
      />
    );
  return (
    <button className="pill ghost" onClick={() => setAdding(true)}>
      <Icon name="plus" size={11} /> New group
    </button>
  );
}

// ---------- Menus ----------

export function Popover({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ x: Math.min(x, innerWidth - w - 12), y: y + h > innerHeight - 12 ? y - h - 40 : y });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("mousedown", onDown);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("mousedown", onDown);
      removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  // Portal to <body>: the header's backdrop blur would otherwise become the
  // containing block for this fixed-position menu and shift it sideways.
  return createPortal(
    <div ref={ref} className="popover" style={{ left: pos.x, top: pos.y }} role="menu">
      {children}
    </div>,
    document.body,
  );
}

function TagMenu(props: {
  tag: TagInfo;
  groups: TagGroup[];
  onRename: () => void;
  onMove: (groupId: string | null) => void;
  onNewGroup: (name: string) => void;
  onDelete: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const n = props.tag.n;
  const current = props.tag.group_id;
  return (
    <>
      <div className="menu-title">{props.tag.name}</div>
      <button className="menu-item" onClick={props.onRename}>
        <Icon name="pencil" size={13} /> Rename
      </button>
      <div className="menu-sep" />
      <div className="menu-label">Group</div>
      {props.groups.map((g) => (
        <button key={g.id} className={`menu-item ${current === g.id ? "on" : ""}`} onClick={() => props.onMove(g.id)}>
          <span className="menu-check">{current === g.id && <Icon name="check" size={12} />}</span>
          {g.name}
        </button>
      ))}
      <button className={`menu-item ${!current ? "on" : ""}`} onClick={() => props.onMove(null)}>
        <span className="menu-check">{!current && <Icon name="check" size={12} />}</span>
        No group
      </button>
      {creating ? (
        <InlineName
          initial=""
          placeholder="New group name"
          className="menu-input"
          onDone={(v) => (v ? props.onNewGroup(v) : setCreating(false))}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button className="menu-item" onClick={() => setCreating(true)}>
          <span className="menu-check"><Icon name="plus" size={12} /></span>
          New group…
        </button>
      )}
      <div className="menu-sep" />
      {/* Removing it from references takes a second click; an unused tag goes at once. */}
      <button className="menu-item danger" onClick={() => (n === 0 || confirming ? props.onDelete() : setConfirming(true))}>
        <Icon name="trash" size={13} />
        {confirming ? `Remove from ${n} reference${n === 1 ? "" : "s"}?` : "Delete tag"}
      </button>
    </>
  );
}

function GroupMenu({ group, onRename, onDelete }: { group: TagGroup; onRename: () => void; onDelete: () => void }) {
  return (
    <>
      <div className="menu-title">{group.name}</div>
      <button className="menu-item" onClick={onRename}>
        <Icon name="pencil" size={13} /> Rename group
      </button>
      <button className="menu-item danger" onClick={onDelete} title="Its tags stay; they just become ungrouped">
        <Icon name="trash" size={13} /> Ungroup
      </button>
    </>
  );
}
