import { Marked, type Tokens } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  api, atHandle, describeLink, displayTitle, personFace, profileParts, type LinkCard, formatBytes, formatDuration, SECTION_UI, sectionOf, site, skillParts, sourceLabel, STATUS_LABEL, timeAgo,
  type Collection, type Media, packStore, type Ref, type Section, skillApi, skillStore, type SkillAbout, type SkillWhen,
} from "./api.ts";
import { Avatar, FadeImg, PersonAvatar } from "./Grid.tsx";
import { CheckNewer, packOf, SkillOriginPanel } from "./Packs.tsx";
import { SkillReadPanel } from "./SkillRead.tsx";
import { Icon } from "./Icon.tsx";
import { Mark } from "./Glow.tsx";
import { VideoPlayer } from "./VideoPlayer.tsx";
import { DesignReadField, readable } from "./Reading.tsx";

export function Detail(props: {
  initial: Ref;
  collections: Collection[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  onTag: (name: string, section: Section) => void;
  /** Ask the assistant about this save. */
  onAsk?: () => void;
}) {
  const { initial, onClose, onPrev, onNext, onChanged } = props;
  const [ref, setRef] = useState<Ref>(initial);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const id = initial.id;

  const load = useCallback(() => api.ref(id).then(setRef).catch((e) => setError(e.message)), [id]);

  // A skill brought up to a newer version of its pack (Packs.tsx) is read again.
  const packs = useSyncExternalStore(packStore.subscribe, packStore.get);
  const packVersion = initial.kind === "skill" ? packs?.find((p) => p.skills.includes(id))?.version.sha : undefined;
  useEffect(() => {
    if (packVersion) void load();
  }, [packVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Posted, saved copy, on disk, size: rarely needed, so behind the ⓘ button (or I). Remembered between items.
  const [showInfo, setShowInfo] = useState(() => remembered("panel.showInfo"));
  const toggleInfo = useCallback(() => setShowInfo((v) => remember("panel.showInfo", !v)), []);

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
      if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘K, ⌘F etc. aren't ours
      // Shift+arrows belong to the video player (jump 5s).
      if (e.key === "ArrowLeft" && !e.shiftKey) onPrev?.();
      if (e.key === "ArrowRight" && !e.shiftKey) onNext?.();
      if (e.key === "f") void apply(api.update(ref.id, { favorite: !ref.favorite }));
      if (e.key === "h") void apply(api.update(ref.id, { hidden: !ref.hidden }));
      if (e.key === "i") toggleInfo();
      // T: straight into this item's tags (Tab completes, Enter adds, Esc leaves).
      if (e.key === "t" || e.key === "T") {
        const input = document.querySelector<HTMLInputElement>(".detail-panel .tag-editor input");
        if (input) {
          e.preventDefault();
          input.scrollIntoView({ block: "nearest", behavior: "smooth" });
          input.focus({ preventScroll: true });
        }
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, ref, apply, toggleInfo]);

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
            {props.onAsk && (
              <button className="round-btn ask-here" onClick={props.onAsk} aria-label="Ask FRIDAY about this" title="Ask FRIDAY about this (⌘J)">
                <Mark size={14} />
              </button>
            )}
            <button
              className={`round-btn ${showInfo ? "on" : ""}`}
              onClick={toggleInfo}
              aria-pressed={showInfo}
              aria-label={showInfo ? "Hide details" : "Show details"}
              title="Details: when it was posted and saved, files on disk, size (I)"
            >
              <Icon name="info" size={14} />
            </button>
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
            {ref.kind !== "skill" && ref.kind !== "account" && (
              <button
                className={`round-btn ${ref.person ? "on" : ""}`}
                onClick={() => apply(api.update(ref.id, { person: !ref.person }))}
                aria-label={ref.person ? "Remove from People & Accounts" : "Add to People & Accounts"}
                title={ref.person ? "In People & Accounts (click to remove)" : "Add to People & Accounts"}
              >
                <Icon name={ref.person ? "user-check" : "user"} size={14} />
              </button>
            )}
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
          <Info ref_={ref} {...props} apply={apply} reload={load} showInfo={showInfo} />
        </div>
      </aside>

      <div className="detail-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {ref.kind === "skill" && ref.status !== "pending" ? (
          <SkillStage r={ref} />
        ) : ref.person && ref.status !== "pending" ? (
          <PersonStage r={ref} />
        ) : ref.site && ref.media.length ? (
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

/** Rendered Markdown, never raw HTML from the file: a skill file is text, not a web page. */
const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { href, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      return /^(https?:|mailto:|#)/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${inner}</a>` : inner;
    },
    // Pictures in a skill file would reach out to the network; show their description instead.
    image: ({ text }: Tokens.Image) => (text ? `[${escapeHtml(text)}]` : ""),
  },
});

/** A skill file, read like a document: its frontmatter as facts, then the instructions. */
function SkillStage({ r }: { r: Ref }) {
  // A skill from a pack may have more files: one of them can be shown in place of SKILL.md.
  const [other, setOther] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => setOther(null), [r.id, r.text]);
  const text = other?.text ?? r.text ?? "";
  const { fields, body } = useMemo(() => (other ? { fields: [] as [string, string][], body: other.text } : skillParts(text)), [text, other]);
  const html = useMemo(() => md.parse(body, { async: false }) as string, [body]);
  const [copied, setCopied] = useState(false);
  const fileName = other ? other.path.split("/").pop()! : r.source_url && !packOf(r) ? decodeURIComponent(r.source_url.split("/").pop() ?? "SKILL.md") : "SKILL.md";
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="doc-stage">
      <div className="site-top">
        <span className="doc-file"><Icon name="file" size={14} />{fileName}</span>
        <div className="doc-actions">
          <button className="cover-btn" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={12} /> {copied ? "Copied" : "Copy"}
          </button>
          <button className="cover-btn" onClick={download}>
            <Icon name="download" size={12} /> Download
          </button>
        </div>
      </div>
      {/* The panels and the file scroll together: a read can be longer than the screen. */}
      <div className="doc-scroll">
      <SkillUsePanel id={r.id} text={r.text ?? ""} />
      <SkillReadPanel id={r.id} />
      <SkillOriginPanel id={r.id} shown={other?.path ?? null} onShow={(path, t) => setOther(path && t !== undefined ? { path, text: t } : null)} />
      <article className="doc" style={{ viewTransitionName: "hero" }}>
        {fields.length > 0 && (
          <dl className="doc-fields">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
      </div>
    </div>
  );
}

const WHENS: [SkillWhen, string][] = [["always", "Always"], ["applies", "When it applies"], ["asked", "When asked"]];
const ABOUTS: [SkillAbout, string][] = [["motion", "Motion"], ["phone", "Phone screens"], ["forms", "Forms"]];

/**
 * Whether FRIDAY uses this skill, and when: off until the designer turns it on. Under it, in
 * plain words, what FRIDAY gets from the file and the checks Panel measures from it.
 */
function SkillUsePanel({ id, text }: { id: string; text: string }) {
  const page = useSyncExternalStore(skillStore.subscribe, skillStore.get);
  const [error, setError] = useState("");
  // Read again when the file changes (it may have gained or lost its sections).
  useEffect(() => void skillStore.refresh().catch((e: Error) => setError(e.message)), [id, text]);
  const s = page?.skills.find((x) => x.id === id);
  if (!s) return error ? <div className="inline-error">{error}</div> : null;
  const set = (patch: Parameters<typeof skillApi.set>[1]) => skillApi.set(id, patch).then(() => setError(""), (e: Error) => setError(e.message));
  const toggleAbout = (a: SkillAbout) => set({ about: s.about.includes(a) ? s.about.filter((x) => x !== a) : [...s.about, a] });
  return (
    <section className="skill-use" aria-label="Use in FRIDAY">
      <div className="skill-use-row">
        <span className="skill-use-title">Use in FRIDAY</span>
        <button role="switch" aria-checked={s.on} aria-label="Use in FRIDAY" className={`switch ${s.on ? "on" : ""}`} onClick={() => set({ on: !s.on })} title={s.on ? "FRIDAY uses this skill. Click to stop." : "Let FRIDAY use this skill"}>
          <span />
        </button>
      </div>
      {s.on && (
        <div className="skill-use-row wrap">
          <div className="seg" role="radiogroup" aria-label="When FRIDAY uses it">
            {WHENS.map(([w, label]) => (
              <button key={w} role="radio" aria-checked={s.when === w} className={s.when === w ? "on" : ""} onClick={() => set({ when: w })}>{label}</button>
            ))}
          </div>
          {s.when === "applies" && (
            <div className="skill-about" role="group" aria-label="What it is about">
              {ABOUTS.map(([a, label]) => (
                <button key={a} className={`pill ${s.about.includes(a) ? "on" : ""}`} aria-pressed={s.about.includes(a)} onClick={() => toggleAbout(a)}>{label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {s.on && <p className="skill-use-note">{s.gets}</p>}
      {s.whole && <p className="skill-use-note">This file has no Decide, Build or Check headings, so FRIDAY gets it whole, as written.</p>}
      {/* A read skill's checks are listed with its read, below. */}
      {s.forUse === null && (s.checks.length > 0 || s.unknown.length > 0) && (
        <div className="skill-checks">
          <span className="skill-use-label">Panel checks every sketch for</span>
          <ul>
            {s.checks.map((c) => (
              <li key={c.name}>{c.plain}{c.level === "breaks" && <span className="skill-must"> · must be fixed</span>}</li>
            ))}
            {s.unknown.map((u) => (
              <li key={u} className="skill-cant">{u} · Panel can’t measure this yet</li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}

/**
 * A person, big: who they are, then a card for each place they're at. A person
 * saved from their website can switch to the site itself, scrolled like the real thing.
 */
function PersonStage({ r }: { r: Ref }) {
  const f = personFace(r);
  const hasSite = r.site && r.media.length > 0;
  const [view, setView] = useState<"person" | "site">("person");
  const places = [
    ...(r.source_url ? [r.source_url] : []),
    ...r.links.filter((l) => l !== r.source_url),
  ];
  return (
    <div className="person-wrap">
      {hasSite && (
        <div className="seg person-seg" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={view === "person"} className={view === "person" ? "on" : ""} onClick={() => setView("person")}>
            <Icon name="user" size={13} /> Person
          </button>
          <button role="tab" aria-selected={view === "site"} className={view === "site" ? "on" : ""} onClick={() => setView("site")}>
            <Icon name="monitor" size={13} /> Website
          </button>
        </div>
      )}
      {view === "site" && hasSite ? (
        <SiteStage r={r} />
      ) : (
        <div className={`person-stage ${f.cover ? "has-cover" : ""}`} style={{ viewTransitionName: "hero" }}>
          {f.cover && <img className="person-stage-cover" src={f.cover} alt="" draggable={false} />}
          <PersonAvatar r={r} size={148} />
          <h2>{f.name}</h2>
          {f.sub && <div className="person-meta">{f.sub}</div>}
          {f.bio && <p className="person-stage-bio">{f.bio}</p>}
          {f.stats && <div className="person-stats">{f.stats}</div>}
          {places.length > 0 && (
            <div className="place-cards">
              {places.map((url) => (
                <PlaceCard key={url} r={r} url={url} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One place a person is at, as a small card. A profile shows their photo, name and
 * counts; a website its icon and title; LinkedIn or email just say what they are.
 * The link they were saved from describes itself from the person.
 */
function PlaceCard({ r, url, onRemove }: { r: Ref; url: string; onRemove?: () => void }) {
  const d = describeLink(url);
  const main = url === r.source_url;
  const card: LinkCard | null = main
    ? r.kind === "account"
      ? { kind: "profile", platform: null, name: r.creator_name, handle: r.creator_handle, bio: null, stats: profileParts(r).stats, avatar_url: r.avatar_url }
      : { kind: "site", platform: null, name: r.title, handle: d.text, bio: null, stats: null, avatar_url: r.avatar_url }
    : r.link_cards?.[url] ?? null;
  const reading = !main && !d.email && !card;
  const img = card?.avatar_url;
  return (
    <div className={`place-card ${card?.kind ?? (d.email ? "email" : "plain")}`}>
      <a href={url} target={d.email ? undefined : "_blank"} rel="noreferrer" title={url}>
        <span className={`place-icon ${card?.kind === "site" ? "logo" : ""}`}>
          {img ? <img src={img} alt="" draggable={false} /> : <Icon name={d.email ? "mail" : "link"} size={14} />}
        </span>
        <span className="place-text">
          <span className="place-top">
            <span className="place-kind">{d.kind}</span>
            {main && <span className="place-main">Saved from</span>}
          </span>
          <span className="place-name">{card?.name && card.kind === "profile" ? card.name : d.text}</span>
          <span className="place-sub">
            {reading ? "Reading…" : card?.kind === "profile" && card.name ? [d.text, card.stats].filter(Boolean).join(" · ") : card?.name && card.kind === "site" ? card.name : ""}
          </span>
        </span>
        <Icon name="arrow-up-right" size={11} />
      </a>
      {onRemove && (
        <button className="pill-x" onClick={onRemove} aria-label={`Remove ${d.kind} link`}>
          <Icon name="x" size={10} />
        </button>
      )}
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

/**
 * A person's other places: their Instagram, LinkedIn, email, website… Paste or type
 * one and press Enter (several at once work too). The link they were saved from comes first.
 */
function LinksField({ r, apply, reload }: { r: Ref; apply: (p: Promise<Ref>) => Promise<void>; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  // New links are read in the background (photo, name, icon); look again while any are still being read.
  const unread = r.links.some((l) => l !== r.source_url && !l.startsWith("mailto:") && !r.link_cards?.[l]);
  useEffect(() => {
    if (!unread) return;
    const t = setInterval(() => void reload(), 1500);
    const stop = setTimeout(() => clearInterval(t), 30_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [unread, reload]);
  const save = (links: string[]) => apply(api.update(r.id, { links }));
  const add = () => {
    const items = draft.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (!items.length) return;
    // Something that can't be a link or an email address stays in the field so it can be fixed.
    const ok = items.filter((x) => /^[^\s@/:]+@[^\s@/]+\.[a-z]{2,}$/i.test(x) || /^(https?:\/\/|mailto:)?[^\s/@]+\.[a-z]{2,}(\/|$|[?#])/i.test(x) || /^https?:\/\//i.test(x));
    if (ok.length < items.length) {
      setBad(true);
      return;
    }
    setDraft("");
    void save([...r.links, ...ok]);
  };
  return (
    <section className="field">
      <div className="field-label">Links</div>
      <div className="link-list">
        {r.source_url && <PlaceCard r={r} url={r.source_url} />}
        {r.links
          .filter((l) => l !== r.source_url)
          .map((l) => (
            <PlaceCard key={l} r={r} url={l} onRemove={() => save(r.links.filter((x) => x !== l))} />
          ))}
        <input
          className={`link-input ${bad ? "bad" : ""}`}
          value={draft}
          placeholder="Add Instagram, X, LinkedIn, email, website…"
          onChange={(e) => {
            setDraft(e.target.value);
            setBad(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
          onBlur={() => draft.trim() && add()}
          aria-invalid={bad}
        />
        {bad && <p className="link-hint">That doesn’t look like a link or an email address.</p>}
      </div>
    </section>
  );
}

/**
 * The two things most often wanted from a saved item, side by side: the original
 * where it came from, and its files on this Mac.
 */
function SourceButtons({ r }: { r: Ref }) {
  const s = site(r);
  const host = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "") : null;
  const label = s?.name ?? host;
  // Profiles and skill files have nothing worth opening in Finder; everything else that was saved does.
  const files = r.kind !== "account" && r.kind !== "skill" && r.media.some((m) => m.status === "archived");
  if (!r.source_url && !files) return null;
  return (
    <div className="source-buttons">
      {r.source_url && (
        <a className="source-btn" href={r.source_url} target="_blank" rel="noreferrer" title={r.source_url}>
          <Icon name="arrow-up-right" size={13} />
          <span>Open on {label}</span>
        </a>
      )}
      {files && (
        <button className="source-btn" onClick={() => api.reveal(r.id)} title="Show the saved files in Finder">
          <Icon name="folder" size={13} />
          <span>Show in Finder</span>
        </button>
      )}
    </div>
  );
}

/** A remembered on/off preference; private windows and blocked storage just don't remember. */
function remembered(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function remember(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* not remembered, still works */
  }
  return on;
}

function Info({
  ref_: r, collections, apply, reload, onDeleted, onTag, onChanged, showInfo,
}: {
  showInfo: boolean;
  ref_: Ref;
  collections: Collection[];
  apply: (p: Promise<Ref>) => Promise<void>;
  reload: () => Promise<void>;
  onDeleted: () => void;
  onTag: (name: string, section: Section) => void;
  onChanged: () => Promise<void>;
}) {
  // Sites, people and skills each get their own tags, note and fields; only the library has collections.
  const section = sectionOf(r);
  const ui = SECTION_UI[section];
  const [sectionTags, setSectionTags] = useState<string[]>([]);
  const tagKey = r.tags.join("|");
  useEffect(() => {
    let live = true;
    api.tags(section).then((ts) => live && setSectionTags(ts.map((t) => t.name))).catch(() => {});
    return () => {
      live = false;
    };
  }, [section, tagKey]);
  // Tags already made on this page first, then ready-made ideas for it.
  const allTags = [...sectionTags, ...ui.starters.filter((t) => !sectionTags.includes(t))];
  const [note, setNote] = useState(r.note);
  // Collections fold away (remembered); folded, they still say which ones this is in.
  const [colsOpen, setColsOpen] = useState(() => remembered("panel.collectionsOpen"));
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
  // While typing, tags that start with the text come first, then ones with a word starting with it, then the rest.
  const rank = (t: string) => (t.startsWith(draft) ? 0 : new RegExp(`[\\s_-]${draft.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t) ? 1 : 2);
  const suggestions = allTags
    .filter((t) => !r.tags.includes(t) && (!draft || t.includes(draft)))
    .map((t, i) => ({ t, i, rank: draft ? rank(t) : 0 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.t);
  // The suggestion Tab will add: the best match, or one picked with ↑/↓. Only while typing a single tag.
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [draft]);
  const completing = draft && !tagDraft.includes(",") ? suggestions[Math.min(pick, suggestions.length - 1)] ?? null : null;
  // Greyed-out rest of the word, shown right after what you typed.
  const ghost = completing?.startsWith(tagDraft.toLowerCase()) ? completing.slice(tagDraft.length) : "";
  const suggestionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    suggestionsRef.current?.querySelector(".pill.suggested")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [completing]);
  const addSuggestion = (t: string) => {
    setTagDraft("");
    void apply(api.setTags(r.id, [...r.tags, t]));
  };
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

  // Without a custom title, a post's first line is shown bold as its title and the rest below it.
  // A one-line post is just its text: no bold line, so it doesn't read as a title with nothing under it.
  const isPost = r.kind === "x" || r.kind === "instagram" || r.kind === "pinterest";
  const restLines = r.text?.split("\n").slice(1).join("\n").trim();
  const plainPost = isPost && !r.title && !restLines;
  const body =
    plainPost ? r.text :
    r.kind === "skill" ? skillParts(r.text ?? "").description
    : r.kind === "account" ? null
    : r.title ? r.text : r.text?.split("\n").slice(1).join("\n").trim();
  const archived = r.media.filter((m) => m.status === "archived");
  const bytes = archived.reduce((s, m) => s + (m.bytes ?? 0), 0);
  const first = r.media[0];
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const sourceHost = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "") : null;
  const s = site(r);

  // Something went wrong: always shown. Everything else about the copy is behind ⓘ.
  const problemBlock = (
    <>
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
    </>
  );
  const detailsBlock = (
    <>
      {r.status === "archived" && r.kind === "skill" && packOf(r) && (
        <p className="archived-note">
          Its text files are kept in your library; its SKILL.md is searchable.
          {r.source_url && (
            <>
              {" "}
              {/* A pack's skill is a folder at one version, not one file at a link: ask its project for a newer version. */}
              <CheckNewer packId={packOf(r)!} />
            </>
          )}
        </p>
      )}
      {r.status === "archived" && r.kind === "skill" && !packOf(r) && (
        <p className="archived-note">
          The whole file is kept in your library and is searchable.
          {r.source_url && (
            <>
              {" "}
              <button className="text-btn inline" onClick={() => apply(api.retry(r.id))} title="Download the file again from its link">
                Get latest version
              </button>
            </>
          )}
        </p>
      )}
      {r.status === "archived" && r.kind === "account" && (
        <p className="archived-note">
          Name, photo and bio as of when you saved it.{" "}
          <button className="text-btn inline" onClick={() => apply(api.retry(r.id))} title="Read the profile again">
            Refresh profile
          </button>
        </p>
      )}
      {r.status === "archived" && r.kind !== "skill" && r.kind !== "account" && (
        <p className="archived-note">
          {r.site ? "Kept on this Mac as it looked when you saved it." : "Plays offline, even if the original post disappears."}
          {r.site && (
            <>
              {" "}
              <button className="text-btn inline" onClick={() => apply(api.retry(r.id))} title="Replace these screenshots with the site as it is today">
                Take new screenshots
              </button>
            </>
          )}
        </p>
      )}
    </>
  );

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
        {!plainPost && (
          <EditableTitle value={r.title ?? ""} fallback={displayTitle(r)} onSave={(title) => apply(api.update(r.id, { title }))} />
        )}
        {body && <ClampedText text={body} />}
      </div>

      <SourceButtons r={r} />

      {showInfo && (
        <div className="details-block">
      {section === "library" && <dl className="facts">
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
      </dl>}

          {detailsBlock}
        </div>
      )}
      {problemBlock}

      <section className="field">
        <div className="field-label">
          {ui.noteLabel}
          <span className={`note-state ${noteState}`}>{noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved" : ""}</span>
        </div>
        <textarea
          value={note}
          placeholder={ui.notePlaceholder}
          rows={3}
          onChange={(e) => {
            setNote(e.target.value);
            saveNote(e.target.value);
          }}
        />
      </section>

      <section className="field">
        <div className="field-label">{ui.tagsLabel}</div>
        <div className="tag-editor">
          {r.tags.map((t) => (
            <span key={t} className="pill solid">
              <button className="pill-link" onClick={() => onTag(t, section)} title={`Show everything tagged ${t}`}>{t}</button>
              <button className="pill-x" onClick={() => apply(api.setTags(r.id, r.tags.filter((x) => x !== t)))} aria-label={`Remove ${t}`}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          <span className="tag-input">
            {ghost && (
              <span className="tag-ghost" aria-hidden>
                <span>{tagDraft}</span>
                {ghost}
              </span>
            )}
            <input
              value={tagDraft}
              placeholder={r.tags.length ? "Add…" : ui.tagsPlaceholder}
              onChange={(e) => setTagDraft(e.target.value)}
              aria-autocomplete="inline"
              aria-describedby={completing ? `tab-hint-${r.id}` : undefined}
              onKeyDown={(e) => {
                // Enter takes the highlighted suggestion; ⇧Enter adds exactly what was typed,
                // for a new tag that starts like an existing one.
                if (e.key === "Enter" && !e.shiftKey && completing) {
                  e.preventDefault();
                  addSuggestion(completing);
                  return;
                }
                // Tab moves to the next suggestion and ⇧Tab to the previous one, wrapping around.
                // With nothing typed Tab moves focus as usual.
                if (e.key === "Tab" && completing) {
                  e.preventDefault();
                  const n = Math.min(pick, suggestions.length - 1) + (e.shiftKey ? -1 : 1);
                  setPick((n + suggestions.length) % suggestions.length);
                  return;
                }
                if ((e.key === "ArrowDown" || e.key === "ArrowUp") && completing && suggestions.length > 1) {
                  e.preventDefault();
                  const n = Math.min(pick, suggestions.length - 1) + (e.key === "ArrowDown" ? 1 : -1);
                  setPick((n + suggestions.length) % suggestions.length);
                  return;
                }
                // ← → walk along the suggestion chips, while the cursor sits at the end of what you typed.
                // On the first chip ← moves the cursor as usual, so the text can still be edited.
                const input = e.currentTarget;
                const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
                const at = Math.min(pick, suggestions.length - 1);
                if (completing && atEnd && !e.shiftKey && !e.metaKey && !e.altKey) {
                  if (e.key === "ArrowRight" && at < suggestions.length - 1) {
                    e.preventDefault();
                    setPick(at + 1);
                    return;
                  }
                  if (e.key === "ArrowLeft" && at > 0) {
                    e.preventDefault();
                    setPick(at - 1);
                    return;
                  }
                }
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
                if (e.key === "Backspace" && !tagDraft && r.tags.length) void apply(api.setTags(r.id, r.tags.slice(0, -1)));
              }}
              onBlur={addTag}
            />
          </span>
          {completing && (
            <kbd className="tab-hint" id={`tab-hint-${r.id}`} title={`Enter adds “${completing}”; Tab moves to the next suggestion; ⇧Enter adds what you typed`}>
              Enter
            </kbd>
          )}
        </div>
        {suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="tag-suggestions"
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {suggestions.map((t) => (
              <button
                key={t}
                className={`pill ${t === completing ? "suggested" : ""}`}
                // Keep focus in the input so a half-typed draft isn't saved as its own tag.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addSuggestion(t)}
              >
                <Icon name="plus" size={10} />
                {t}
              </button>
            ))}
          </div>
        )}
      </section>

      {readable(r) && <DesignReadField r={r} reload={reload} />}

      {section === "people" && <LinksField r={r} apply={apply} reload={reload} />}



      {ui.collections && <section className={`field cols-field ${colsOpen ? "open" : ""}`}>
        <button
          className="field-label field-toggle"
          onClick={() => setColsOpen(remember("panel.collectionsOpen", !colsOpen))}
          aria-expanded={colsOpen}
        >
          <span className="with-icon">
            Collections
            <span className={`chev ${colsOpen ? "open" : ""}`}><Icon name="chevron-down" size={12} /></span>
          </span>
          <span className="field-summary" aria-hidden={colsOpen}>{r.collections.map((c) => c.name).join(", ") || "None"}</span>
        </button>
        {/* Always rendered so it can fold open and shut; inert while folded so Tab skips it. */}
        <div
          className="cols-body"
          inert={!colsOpen}
          onTransitionEnd={(e) => {
            if (colsOpen && e.target === e.currentTarget && e.propertyName === "grid-template-rows")
              e.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }}
        >
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
        </div>
      </section>}

      <div className="detail-foot">
        {confirmDelete ? (
          <div className="confirm">
            <span>Move files to Trash?</span>
            <button className="text-btn danger" onClick={() => api.remove(r.id).then(onDeleted)}>Remove</button>
            <button className="text-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        ) : (
          <>
            <button className="text-btn muted" onClick={() => setConfirmDelete(true)}>Remove</button>
            {packOf(r) && r.source_url ? (
              // A skill from a GitHub pack: re-checking asks its project for a newer version.
              <CheckNewer packId={packOf(r)!} label="Re-check" className="text-btn muted" />
            ) : (
              <button className="text-btn muted" onClick={() => reload().then(onChanged)} title="Re-check files on disk">
                <Icon name="refresh" size={13} /> Re-check
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
