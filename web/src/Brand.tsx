// Brand assets: each project's real logos, icons, pictures, patterns and brand books, as files
// (brand.ts on the server). They show grouped by project, then by kind, so "the Navtech logos"
// is one look away. In FRIDAY, @ → Brand assets lists them the same way, and a sketch uses the
// real file instead of drawing a stand-in.
//
// Files come in three ways: "Add files" (pick the project first), the Add button on a project,
// or dropped anywhere on this page (on a project to add to it; elsewhere, Panel asks which).
// Each file's kind is guessed from its name and format; the ··· menu changes it when it's wrong.
//
// Logos are often white on nothing, so the backdrop behind every asset switches between light
// and dark, and the choice is remembered.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { brandApi, BRAND_KIND_LABEL, BRAND_KIND_ONE, BRAND_KINDS, formatBytes, type BrandAsset, type BrandKind, type ProjectSummary } from "./api.ts";
import { Icon } from "./Icon.tsx";
import { InlineName } from "./InlineName.tsx";
import { Popover } from "./TagRow.tsx";
import "./brand.css";

const DARK_KEY = "panel.brand.dark";
/** The key of the group an asset is in: its project's id, or "none". */
const groupOf = (a: { project_id: string | null }) => a.project_id ?? "none";

/** Files dropped on the page reach the page through this: where they were dropped, and on which project. */
export type BrandDrop = (files: File[], project: string | undefined, at: { x: number; y: number }) => void;

type AddMenu = { x: number; y: number; files?: File[] };
type AssetMenu = { x: number; y: number; id: string; page: "main" | "kind" | "move" };

export function Brand(props: {
  projects: ProjectSummary[];
  version: number;
  dropRef: React.MutableRefObject<BrandDrop | null>;
  /** An asset or project to bring into view (from a chip in FRIDAY). */
  focus?: string;
  onError: (t: string) => void;
  onSay: (t: string) => void;
}) {
  const { projects, onError, onSay } = props;
  const [assets, setAssets] = useState<BrandAsset[] | null>(null);
  const [kind, setKind] = useState<BrandKind | "all">("all");
  // Until the designer picks one, the backdrop follows Panel's own light or dark look.
  const [dark, setDark] = useState(() => {
    try {
      const kept = localStorage.getItem(DARK_KEY);
      if (kept) return kept === "1";
    } catch {
      /* Private window: nothing kept. */
    }
    return matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [addMenu, setAddMenu] = useState<AddMenu | null>(null);
  const [menu, setMenu] = useState<AssetMenu | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // The groups files are going up to right now.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // The project a drag is over, lit up so it's clear where the files will land.
  const [over, setOver] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string>("none");

  const load = useCallback(() => brandApi.list().then(setAssets).catch((e: Error) => onError(e.message)), [onError]);
  useEffect(() => void load(), [load, props.version]);

  const remember = (v: boolean) => {
    setDark(v);
    try {
      localStorage.setItem(DARK_KEY, v ? "1" : "0");
    } catch {
      /* Private window: the backdrop just isn't remembered. */
    }
  };

  const nameOf = useCallback((group: string) => (group === "none" ? "Not in a project" : projects.find((p) => p.id === group)?.name ?? "Project"), [projects]);

  const upload = useCallback(
    async (files: File[], group: string) => {
      if (!files.length) return;
      setBusy((b) => new Set(b).add(group));
      try {
        const r = await brandApi.add(files, group === "none" ? null : group);
        if (r.failed.length) onError(r.failed[0]!);
        if (r.added.length) onSay(`Added ${r.added.length} to ${nameOf(group)}`);
        await load();
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setBusy((b) => {
          const next = new Set(b);
          next.delete(group);
          return next;
        });
      }
    },
    [load, nameOf, onError, onSay],
  );

  // Files dropped on the page: straight into the project they were dropped on, or Panel asks.
  useEffect(() => {
    props.dropRef.current = (files, project, at) => {
      setOver(null);
      if (project) void upload(files, project);
      else setAddMenu({ ...at, files });
    };
    return () => {
      props.dropRef.current = null;
    };
  }, [props.dropRef, upload]);
  useEffect(() => {
    const clear = () => setOver(null);
    addEventListener("drop", clear);
    addEventListener("dragend", clear);
    return () => {
      removeEventListener("drop", clear);
      removeEventListener("dragend", clear);
    };
  }, []);

  const pick = (group: string) => {
    pickFor.current = group;
    fileRef.current?.click();
  };

  const change = async (id: string, patch: Parameters<typeof brandApi.update>[1]) => {
    try {
      await brandApi.update(id, patch);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const remove = async (a: BrandAsset) => {
    setMenu(null);
    setConfirming(false);
    try {
      await brandApi.remove(a.id);
      onSay(`Moved “${a.name}” to the Trash`);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // Kinds present, for the filter; then the groups to show, each with its kinds in order.
  const counts = useMemo(() => {
    const c = new Map<BrandKind, number>();
    for (const a of assets ?? []) c.set(a.kind, (c.get(a.kind) ?? 0) + 1);
    return c;
  }, [assets]);
  useEffect(() => {
    if (kind !== "all" && !counts.get(kind)) setKind("all");
  }, [counts, kind]);
  const groups = useMemo(() => {
    const out = new Map<string, Map<BrandKind, BrandAsset[]>>();
    for (const a of assets ?? []) {
      if (kind !== "all" && a.kind !== kind) continue;
      const g = out.get(groupOf(a)) ?? out.set(groupOf(a), new Map()).get(groupOf(a))!;
      (g.get(a.kind) ?? g.set(a.kind, []).get(a.kind)!).push(a);
    }
    // A project being added to shows at once, before anything is in it.
    for (const g of busy) if (!out.has(g)) out.set(g, new Map());
    return [...out].map(([group, kinds]) => ({
      group,
      kinds: BRAND_KINDS.filter((k) => kinds.has(k)).map((k) => ({ kind: k, list: kinds.get(k)! })),
      n: [...kinds.values()].reduce((s, l) => s + l.length, 0),
    }));
  }, [assets, kind, busy]);

  // Coming from a chip in FRIDAY: that asset (or project) comes into view and lights up a moment.
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    if (!props.focus || !assets) return;
    const el = document.querySelector<HTMLElement>(`[data-brand-asset="${props.focus}"], [data-brand-project="${props.focus}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setLit(props.focus);
    const t = setTimeout(() => setLit(null), 1600);
    return () => clearTimeout(t);
  }, [props.focus, assets]);

  const openAdd = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAddMenu({ x: r.right - 220, y: r.bottom + 6 });
  };

  const addButton = (
    <button className="fonts-upload" onClick={openAdd} aria-haspopup="menu">
      <Icon name="upload" size={14} />
      Add files
    </button>
  );

  const current = menu ? assets?.find((a) => a.id === menu.id) : null;

  return (
    <div className={`brand-page ${dark ? "brand-dark" : ""}`}>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void upload(files, pickFor.current);
        }}
      />
      <header className="header">
        <div className="title-row">
          <h1>Brand assets</h1>
          <span className="subtitle">Each project's logos and files. @ them in FRIDAY, and sketches use the real thing.</span>
          <span className="fonts-spacer" />
          {assets && assets.length > 0 && (
            <>
              <div className="seg" role="group" aria-label="Backdrop">
                <button className={dark ? "" : "on"} onClick={() => remember(false)} title="Show them on light">Light</button>
                <button className={dark ? "on" : ""} onClick={() => remember(true)} title="Show them on dark, for white logos">Dark</button>
              </div>
              {addButton}
            </>
          )}
        </div>
        {counts.size > 1 && (
          <div className="seg brand-kinds" role="group" aria-label="Show">
            <button className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>
              All <span className="brand-n">{assets?.length}</span>
            </button>
            {BRAND_KINDS.filter((k) => counts.get(k)).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                {BRAND_KIND_LABEL[k]} <span className="brand-n">{counts.get(k)}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      {assets === null ? null : groups.length === 0 ? (
        <div className="empty hero">
          <div className="brand-empty-mark" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <h2>Brand assets</h2>
          <p>Each project's logos, icons, pictures and brand books, kept as the real files.</p>
          <p>Drop them here, or add them to a project. FRIDAY uses them when you @ them.</p>
          <div className="fonts-empty-action">{addButton}</div>
        </div>
      ) : (
        groups.map(({ group, kinds, n }) => (
          <section
            key={group}
            className={`brand-project ${over === group ? "over" : ""} ${lit === group ? "lit" : ""}`}
            data-brand-project={group}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) setOver(group);
            }}
          >
            <div className="brand-project-head">
              <h2>{nameOf(group)}</h2>
              <span className="ff-meta">{busy.has(group) ? "Adding…" : `${n} file${n === 1 ? "" : "s"}`}</span>
              <span className="fonts-spacer" />
              <button className="text-btn ff-act" onClick={() => pick(group)} disabled={busy.has(group)}>
                <Icon name="plus" size={13} /> Add
              </button>
            </div>
            {kinds.map(({ kind: k, list }) => (
              <div key={k} className="brand-kind">
                <div className="brand-kind-name">{BRAND_KIND_LABEL[k]}</div>
                <div className="brand-tiles">
                  {list.map((a) => (
                    <div key={a.id} className={`brand-tile ${menu?.id === a.id ? "menu-open" : ""} ${lit === a.id ? "lit" : ""}`} data-brand-asset={a.id}>
                      <a className="brand-look" href={a.url} target="_blank" rel="noreferrer" title={`Open ${a.original_name}`}>
                        {a.thumb_url ? (
                          <img src={a.thumb_url} alt={a.name} loading="lazy" draggable={false} />
                        ) : (
                          <span className="brand-format">{a.format.toUpperCase()}</span>
                        )}
                      </a>
                      <div className="brand-caption">
                        {renaming === a.id ? (
                          <InlineName
                            initial={a.name}
                            className="brand-rename"
                            onDone={(v) => {
                              setRenaming(null);
                              if (v && v !== a.name) void change(a.id, { name: v });
                            }}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span className="brand-name" onDoubleClick={() => setRenaming(a.id)} title={a.name}>
                            {a.name}
                          </span>
                        )}
                        <span className="brand-meta">
                          {a.format.toUpperCase()} · {a.width && a.height ? `${a.width}×${a.height}` : formatBytes(a.size)}
                        </span>
                      </div>
                      <button
                        className="brand-more"
                        aria-label={`More for ${a.name}`}
                        aria-haspopup="menu"
                        onClick={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setConfirming(false);
                          setMenu({ x: r.left, y: r.bottom + 4, id: a.id, page: "main" });
                        }}
                      >
                        <Icon name="more" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}

      {addMenu && (
        <Popover x={addMenu.x} y={addMenu.y} onClose={() => setAddMenu(null)} className="brand-menu">
          <div className="menu-label">{addMenu.files ? `Add ${addMenu.files.length} file${addMenu.files.length === 1 ? "" : "s"} to` : "Add files to"}</div>
          <div className="brand-menu-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className="menu-item"
                onClick={() => {
                  const files = addMenu.files;
                  setAddMenu(null);
                  if (files) void upload(files, p.id);
                  else pick(p.id);
                }}
              >
                <Icon name="folder" size={13} /> <span className="brand-menu-name">{p.name}</span>
              </button>
            ))}
          </div>
          {projects.length > 0 && <div className="menu-sep" />}
          <button
            className="menu-item"
            onClick={() => {
              const files = addMenu.files;
              setAddMenu(null);
              if (files) void upload(files, "none");
              else pick("none");
            }}
          >
            <Icon name="grid" size={13} /> Not in a project
          </button>
        </Popover>
      )}

      {menu && current && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="brand-menu">
          {menu.page === "main" ? (
            <>
              <div className="menu-title">{current.name}</div>
              <a className="menu-item" href={`${current.url}?download`} onClick={() => setMenu(null)}>
                <Icon name="download" size={13} /> Download
              </a>
              <button className="menu-item" onClick={() => { setMenu(null); setRenaming(current.id); }}>
                <Icon name="pencil" size={13} /> Rename
              </button>
              <button className="menu-item" onClick={() => setMenu({ ...menu, page: "kind" })}>
                <Icon name="brand" size={13} /> <span className="brand-menu-name">It's a {BRAND_KIND_ONE[current.kind].toLowerCase()}</span>
                <span className="brand-menu-go"><Icon name="chevron-right" size={12} /></span>
              </button>
              <button className="menu-item" onClick={() => setMenu({ ...menu, page: "move" })}>
                <Icon name="folder" size={13} /> <span className="brand-menu-name">Move to another project</span>
                <span className="brand-menu-go"><Icon name="chevron-right" size={12} /></span>
              </button>
              <div className="menu-sep" />
              <button className="menu-item danger" onClick={() => (confirming ? void remove(current) : setConfirming(true))}>
                <Icon name="trash" size={13} /> {confirming ? "Move it to the Trash?" : "Delete"}
              </button>
            </>
          ) : menu.page === "kind" ? (
            <>
              <button className="menu-item" onClick={() => setMenu({ ...menu, page: "main" })}>
                <Icon name="arrow-left" size={13} /> <span className="brand-menu-name">“{current.name}” is a</span>
              </button>
              <div className="menu-sep" />
              {BRAND_KINDS.map((k) => (
                <button
                  key={k}
                  className={`menu-item ${current.kind === k ? "on" : ""}`}
                  onClick={() => {
                    setMenu(null);
                    if (current.kind !== k) void change(current.id, { kind: k });
                  }}
                >
                  <span className="menu-check">{current.kind === k && <Icon name="check" size={12} />}</span>
                  {BRAND_KIND_ONE[k]}
                </button>
              ))}
            </>
          ) : (
            <>
              <button className="menu-item" onClick={() => setMenu({ ...menu, page: "main" })}>
                <Icon name="arrow-left" size={13} /> <span className="brand-menu-name">Move “{current.name}” to</span>
              </button>
              <div className="menu-sep" />
              <div className="brand-menu-list">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className={`menu-item ${current.project_id === p.id ? "on" : ""}`}
                    onClick={() => {
                      setMenu(null);
                      if (current.project_id !== p.id) void change(current.id, { project_id: p.id });
                    }}
                  >
                    <span className="menu-check">{current.project_id === p.id && <Icon name="check" size={12} />}</span>
                    <span className="brand-menu-name">{p.name}</span>
                  </button>
                ))}
              </div>
              <div className="menu-sep" />
              <button
                className={`menu-item ${current.project_id === null ? "on" : ""}`}
                onClick={() => {
                  setMenu(null);
                  if (current.project_id !== null) void change(current.id, { project_id: null });
                }}
              >
                <span className="menu-check">{current.project_id === null && <Icon name="check" size={12} />}</span>
                Not in a project
              </button>
            </>
          )}
        </Popover>
      )}
    </div>
  );
}
