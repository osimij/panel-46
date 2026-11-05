import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, atHandle, displayTitle, formatBytes, formatDuration, site, sourceLabel, STATUS_LABEL, timeAgo,
  type Collection, type Media, type Ref,
} from "./api.ts";
import { Avatar, FadeImg } from "./Grid.tsx";
import { Icon } from "./Icon.tsx";
import { VideoPlayer } from "./VideoPlayer.tsx";

export function Detail(props: {
  initial: Ref;
  collections: Collection[];
  allTags: string[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onTag: (name: string) => void;
}) {
  const { initial, onClose, onPrev, onNext, onChanged } = props;
  const [ref, setRef] = useState<Ref>(initial);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const id = initial.id;

  const load = useCallback(() => api.ref(id).then(setRef).catch((e) => setError(e.message)), [id]);

  useEffect(() => {
    setRef(initial);
    setActive(0);
    setError(null);
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while a copy is still being made.
  useEffect(() => {
    if (ref.status !== "pending") return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [ref.status, load]);

  const apply = useCallback(
    async (p: Promise<Ref>) => {
      try {
        setRef(await p);
        void onChanged();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [onChanged],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea")) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "Escape") onClose();
      // Shift+arrows belong to the video player (jump 5s).
      if (e.key === "ArrowLeft" && !e.shiftKey) onPrev?.();
      if (e.key === "ArrowRight" && !e.shiftKey) onNext?.();
      if (e.key === "f") void apply(api.update(ref.id, { favorite: !ref.favorite }));
      if (e.key === "h") void apply(api.update(ref.id, { hidden: !ref.hidden }));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, ref, apply]);

  const current = ref.media[active];

  // ---- Ordering a carousel: drag the thumbnails, or make the one showing the cover ----

  const [dragging, setDragging] = useState<string | null>(null);
  const orderAtStart = useRef<string[]>([]);

  /** Shows the new order right away (keeping the same image in view), then saves it. */
  const reorder = async (ids: string[], save = true) => {
    const showing = ref.media[active]?.id;
    const media = ids.map((mid) => ref.media.find((m) => m.id === mid)!);
    setRef({ ...ref, media });
    setActive(Math.max(0, media.findIndex((m) => m.id === showing)));
    if (!save) return;
    try {
      setRef(await api.reorder(ref.id, ids));
      void onChanged();
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  };

  const makeCover = () => {
    const ids = ref.media.map((m) => m.id);
    const [picked] = ids.splice(active, 1);
    void reorder([picked!, ...ids]);
  };

  const dragOver = (e: React.DragEvent, over: string) => {
    if (!dragging || dragging === over) return;
    e.preventDefault();
    const ids = ref.media.map((m) => m.id).filter((mid) => mid !== dragging);
    ids.splice(ref.media.findIndex((m) => m.id === over), 0, dragging);
    void reorder(ids, false);
  };

  const dragEnd = () => {
    const ids = ref.media.map((m) => m.id);
    setDragging(null);
    if (ids.join() !== orderAtStart.current.join()) void reorder(ids);
  };

  return (
    <div className="detail" role="dialog" aria-label={displayTitle(ref)}>
      <div className="detail-scrim" onMouseDown={onClose} />

      <aside className="detail-panel">
        <div className="detail-bar">
          <button className="round-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" size={14} />
          </button>
          <div className="detail-bar-right">
            <button
              className={`round-btn ${ref.favorite ? "fav-on" : ""}`}
              onClick={() => apply(api.update(ref.id, { favorite: !ref.favorite }))}
              aria-label={ref.favorite ? "Remove from favorites" : "Add to favorites"}
              title="Favorite (F)"
            >
              <span key={String(ref.favorite)} className={ref.favorite ? "pop" : ""}>
                <Icon name={ref.favorite ? "heart-fill" : "heart"} size={14} />
              </span>
            </button>
            <button
              className="round-btn"
              onClick={() => apply(api.update(ref.id, { hidden: !ref.hidden }))}
              aria-label={ref.hidden ? "Show in library" : "Hide"}
              title={ref.hidden ? "Show in library (H)" : "Hide (H)"}
            >
              <Icon name={ref.hidden ? "eye" : "eye-off"} size={14} />
            </button>
            <button className="round-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous" title="Previous (←)">
              <Icon name="arrow-left" size={14} />
            </button>
            <button className="round-btn" onClick={onNext} disabled={!onNext} aria-label="Next" title="Next (→)">
              <Icon name="arrow-right" size={14} />
            </button>
          </div>
        </div>

        <div className="detail-scroll" key={ref.id}>
          {error && <div className="inline-error">{error}</div>}
          <Info ref_={ref} {...props} apply={apply} reload={load} />
        </div>
      </aside>

      <div className="detail-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {ref.site && ref.media.length ? (
          <SiteStage r={ref} />
        ) : current ? (
          <Stage key={current.id} m={current} hero={active === 0} />
        ) : ref.preview_url ? (
          <div className="stage-frame preview" style={{ viewTransitionName: "hero", "--ar": 1.78 } as React.CSSProperties}>
            <FadeImg src={ref.preview_url} />
            <span className="chip link_only"><span className="dot link_only" />Preview only, not the media</span>
          </div>
        ) : (
          <div className="stage-empty" style={{ viewTransitionName: "hero" }}>
            {ref.status === "pending" ? <span className="spinner big" /> : <Icon name="link" size={24} />}
            <p>{ref.status === "pending" ? "Saving a copy to this Mac…" : "No media saved for this reference"}</p>
          </div>
        )}

        {ref.media.length > 1 && !ref.site && (
          <div className="filmstrip-row">
            <div className="filmstrip">
              {ref.media.map((m, i) => (
                <button
                  key={m.id}
                  className={`${i === active ? "on" : ""} ${dragging === m.id ? "dragging" : ""}`}
                  onClick={() => setActive(i)}
                  aria-label={`Show item ${i + 1}${i === 0 ? " (cover)" : ""}`}
                  title="Drag to reorder"
                  draggable
                  onDragStart={(e) => {
                    orderAtStart.current = ref.media.map((x) => x.id);
                    setDragging(m.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("application/x-panel-media", m.id);
                  }}
                  onDragOver={(e) => dragOver(e, m.id)}
                  onDrop={(e) => e.preventDefault()}
                  onDragEnd={dragEnd}
                >
                  {m.thumb_url ? <img src={m.thumb_url} alt="" draggable={false} /> : <Icon name={m.status === "failed" ? "alert" : "image"} />}
                </button>
              ))}
            </div>
            {active === 0 ? (
              <span className="cover-btn is-cover">
                <Icon name="check" size={13} />
                Cover
              </span>
            ) : (
              <button className="cover-btn" onClick={makeCover} title="Show this one first, and on the card">
                Make cover
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A website, scrolled like the real thing. Desktop and phone screenshots of the whole page. */
function SiteStage({ r }: { r: Ref }) {
  const shots = r.media.filter((m) => m.type === "image").sort((a, b) => a.idx - b.idx);
  const [view, setView] = useState(0);
  const m = shots[view] ?? shots[0]!;
  const phone = m.idx === 1;
  const host = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "") : "";
  return (
    <div className="site-stage">
      <div className="site-top">
        <div className="seg" role="tablist" aria-label="Screen size">
          {shots.map((s, i) => (
            <button key={s.id} role="tab" aria-selected={i === view} className={i === view ? "on" : ""} onClick={() => setView(i)}>
              <Icon name={s.idx === 1 ? "phone" : "monitor"} size={13} />
              {s.idx === 1 ? "Phone" : "Desktop"}
            </button>
          ))}
        </div>
        {r.source_url && (
          <a className="cover-btn" href={r.source_url} target="_blank" rel="noreferrer">
            Open live site <Icon name="arrow-up-right" size={12} />
          </a>
        )}
      </div>
      <div
        className={`site-window ${phone ? "phone" : "desktop"}`}
        style={{ viewTransitionName: "hero" } as React.CSSProperties}
      >
        <div className="site-chrome" aria-hidden>
          <span /><span /><span />
          <div className="site-url">{host}</div>
        </div>
        <div className="site-scroll" key={m.id}>
          {m.url ? (
            <img src={m.url} alt={`${host} on ${phone ? "a phone" : "desktop"}, full page`} draggable={false} />
          ) : (
            <div className="stage-empty">
              <Icon name="alert" size={24} />
              <p>This screenshot wasn’t saved{m.error ? `: ${m.error}` : ""}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stage({ m, hero }: { m: Media; hero: boolean }) {
  const ar = m.width && m.height ? m.width / m.height : 1;
  const style = { "--ar": ar, viewTransitionName: hero ? "hero" : undefined } as React.CSSProperties;

  if (m.status === "pending")
    return (
      <div className="stage-empty" style={style}>
        <span className="spinner big" />
        <p>Downloading…</p>
      </div>
    );
  if (!m.url)
    return (
      <div className="stage-empty" style={style}>
        <Icon name="alert" size={24} />
        <p>This file wasn’t saved{m.error ? `: ${m.error}` : ""}</p>
      </div>
    );
  return (
    <div className="stage-frame" style={style}>
      {/* The small thumbnail is already cached from the grid, so the morph lands on a real image. */}
      {m.thumb_url && <img className="stage-under" src={m.thumb_url} alt="" draggable={false} />}
      {m.type === "image" ? (
        <FadeImg src={m.url} className="stage-media" />
      ) : (
        <VideoPlayer src={m.url} poster={m.thumb_url ?? undefined} kind={m.type === "gif" ? "gif" : "video"} />
      )}
    </div>
  );
}

/** Reads as a heading; click to edit. Wraps instead of cutting long titles off. */
function EditableTitle({ value, fallback, onSave }: { value: string; fallback: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false); // Escape also blurs the field; only the first outcome counts

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    if (!editing) return;
    done.current = false;
    fit();
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = draft.replace(/\s+/g, " ").trim();
    // Leaving the post's own first line untouched shouldn't freeze it as a custom title.
    if (save && next !== value && !(next === fallback && !value)) onSave(next);
  };

  if (!editing)
    return (
      <h2
        className="detail-title"
        tabIndex={0}
        title="Click to rename"
        onClick={() => {
          setDraft(value || fallback);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setDraft(value || fallback);
            setEditing(true);
          }
        }}
      >
        {value || fallback}
      </h2>
    );
  return (
    <textarea
      ref={ref}
      className="detail-title editing"
      rows={1}
      value={draft}
      aria-label="Title"
      onChange={(e) => {
        setDraft(e.target.value);
        fit();
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

/** Long post text stays to a few lines until you ask for more. */
function ClampedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);
  return (
    <div className="detail-text-wrap">
      <p ref={ref} className={`detail-text ${open ? "open" : ""}`}>{text}</p>
      {(overflows || open) && (
        <button className="text-btn inline more" onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

function Info({
  ref_: r, collections, allTags, apply, reload, onDeleted, onTag, onChanged,
}: {
  ref_: Ref;
  collections: Collection[];
  allTags: string[];
  apply: (p: Promise<Ref>) => Promise<void>;
  reload: () => Promise<void>;
  onDeleted: () => void;
  onTag: (name: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState(r.note);
  const [tagDraft, setTagDraft] = useState("");
  const [newCol, setNewCol] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setNote(r.note);
  }, [r.note]);

  const saveNote = (value: string) => {
    clearTimeout(noteTimer.current);
    setNoteState("saving");
    noteTimer.current = setTimeout(async () => {
      await apply(api.update(r.id, { note: value }));
      setNoteState("saved");
      setTimeout(() => setNoteState("idle"), 1400);
    }, 500);
  };
  const addTag = () => {
    const names = tagDraft.split(",").map((t) => t.trim()).filter(Boolean);
    setTagDraft("");
    if (names.length) void apply(api.setTags(r.id, [...r.tags, ...names]));
  };
  const draft = tagDraft.trim().toLowerCase();
  const suggestions = allTags.filter((t) => !r.tags.includes(t) && (!draft || t.includes(draft)));
  const toggleCollection = (cid: string) => {
    const ids = r.collections.map((c) => c.id);
    void apply(api.setCollections(r.id, ids.includes(cid) ? ids.filter((x) => x !== cid) : [...ids, cid]));
  };
  const createCollection = async () => {
    const name = newCol.trim();
    setNewCol("");
    if (!name) return;
    const c = await api.createCollection(name);
    await apply(api.setCollections(r.id, [...r.collections.map((x) => x.id), c.id]));
  };

  // Without a custom title, the post's first line already is the title; don't repeat it.
  const body = r.title ? r.text : r.text?.split("\n").slice(1).join("\n").trim();
  const archived = r.media.filter((m) => m.status === "archived");
  const bytes = archived.reduce((s, m) => s + (m.bytes ?? 0), 0);
  const first = r.media[0];
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const sourceHost = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "") : null;
  const s = site(r);

  return (
    <>
      <div className="detail-intro">
        <div className="byline">
          <Avatar r={r} size={28} />
          <div className="byline-text">
            <div className="byline-name">
              {s && r.creator_handle ? (
                <a href={s.profile(r.creator_handle)} target="_blank" rel="noreferrer">
                  {r.creator_name ?? atHandle(r) ?? r.creator_handle}
                </a>
              ) : (
                (r.kind === "upload" ? "Added from this Mac" : r.creator_name ?? sourceLabel(r))
              )}
            </div>
            <div className="byline-meta">
              {s && atHandle(r) && <span>{atHandle(r)}</span>}
              {r.source_url && (
                <a href={r.source_url} target="_blank" rel="noreferrer" className="with-icon" title="Open original">
                  {s ? s.name : sourceHost}
                  <Icon name="arrow-up-right" size={11} />
                </a>
              )}
              <span title={`Saved ${fmtDate(r.created_at)}`}>{timeAgo(r.created_at)}</span>
            </div>
          </div>
        </div>
        <EditableTitle
          value={r.title ?? ""}
          fallback={displayTitle(r)}
          onSave={(title) => apply(api.update(r.id, { title }))}
        />
        {body && <ClampedText text={body} />}
      </div>

      <dl className="facts">
        {r.posted_at && (
          <div>
            <dt>Posted</dt>
            <dd>{fmtDate(r.posted_at)}</dd>
          </div>
        )}
        <div>
          <dt>Saved copy</dt>
          <dd className="with-icon">
            <span className={`dot ${r.status}`} />
            {STATUS_LABEL[r.status]}
          </dd>
        </div>
        {archived.length > 0 && (
          <div>
            <dt>On disk</dt>
            <dd>{archived.length > 1 ? `${archived.length} files · ` : ""}{formatBytes(bytes)}</dd>
          </div>
        )}
        {first?.width && (
          <div>
            <dt>{first.type === "image" ? "Size" : "Video"}</dt>
            <dd>
              {first.width}×{first.height}
              {first.duration ? ` · ${formatDuration(first.duration)}` : ""}
            </dd>
          </div>
        )}
      </dl>

      {(r.status === "failed" || r.status === "link_only") && (
        <div className={`callout ${r.status}`}>
          <p>{r.status_detail ?? (r.status === "failed" ? "The media wasn’t saved." : "Only the link is kept.")}</p>
          {r.media.filter((m) => m.status === "failed").map((m) => (
            <p key={m.id} className="callout-file">
              {m.type === "image" ? "Image" : "Video"} {m.idx + 1}: {m.error}
            </p>
          ))}
          {r.kind !== "upload" && (
            <button className="text-btn" onClick={() => apply(api.retry(r.id))}>
              <Icon name="refresh" size={13} /> Try again
            </button>
          )}
        </div>
      )}
      {r.status === "archived" && (
        <p className="archived-note">
          {r.site ? "Kept on this Mac as it looked when you saved it." : "Plays offline, even if the original post disappears."}{" "}
          <button className="text-btn inline" onClick={() => api.reveal(r.id)}>Show in Finder</button>
          {r.site && (
            <>
              {" · "}
              <button className="text-btn inline" onClick={() => apply(api.retry(r.id))} title="Replace these screenshots with the site as it is today">
                Take new screenshots
              </button>
            </>
          )}
        </p>
      )}

      <section className="field">
        <div className="field-label">
          Note
          <span className={`note-state ${noteState}`}>{noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved" : ""}</span>
        </div>
        <textarea
          value={note}
          placeholder="What do you like about it? e.g. love how this menu opens"
          rows={3}
          onChange={(e) => {
            setNote(e.target.value);
            saveNote(e.target.value);
          }}
        />
      </section>

      <section className="field">
        <div className="field-label">Tags</div>
        <div className="tag-editor">
          {r.tags.map((t) => (
            <span key={t} className="pill solid">
              <button className="pill-link" onClick={() => onTag(t)} title={`Show everything tagged ${t}`}>{t}</button>
              <button className="pill-x" onClick={() => apply(api.setTags(r.id, r.tags.filter((x) => x !== t)))} aria-label={`Remove ${t}`}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            placeholder={r.tags.length ? "Add…" : "typography, menu, dark…"}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
              if (e.key === "Backspace" && !tagDraft && r.tags.length) void apply(api.setTags(r.id, r.tags.slice(0, -1)));
            }}
            onBlur={addTag}
          />
        </div>
        {suggestions.length > 0 && (
          <div
            className="tag-suggestions"
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {suggestions.map((t) => (
              <button
                key={t}
                className="pill"
                // Keep focus in the input so a half-typed draft isn't saved as its own tag.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setTagDraft("");
                  void apply(api.setTags(r.id, [...r.tags, t]));
                }}
              >
                <Icon name="plus" size={10} />
                {t}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="field">
        <div className="field-label">Collections</div>
        <div className="collection-list">
          {collections.map((c) => {
            const on = r.collections.some((x) => x.id === c.id);
            return (
              <button key={c.id} className={`check-row ${on ? "on" : ""}`} onClick={() => toggleCollection(c.id)} aria-pressed={on}>
                <span className="checkbox">
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </span>
                {c.name}
              </button>
            );
          })}
          <input
            className="new-collection"
            value={newCol}
            placeholder="+ New collection"
            onChange={(e) => setNewCol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createCollection()}
          />
        </div>
      </section>

      <div className="detail-foot">
        {confirmDelete ? (
          <div className="confirm">
            <span>Move files to Trash?</span>
            <button className="text-btn danger" onClick={() => api.remove(r.id).then(onDeleted)}>Remove</button>
            <button className="text-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        ) : (
          <button className="text-btn muted" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={13} /> Remove
          </button>
        )}
        <button className="text-btn muted" onClick={() => reload().then(onChanged)} title="Re-check files on disk">
          <Icon name="refresh" size={13} /> Re-check
        </button>
      </div>
    </>
  );
}
