import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayTitle, formatDuration, prefersReducedMotion, STATUS_LABEL, type Ref } from "./api.ts";
import { Icon } from "./Icon.tsx";

/**
 * Columns aim for about this width and the count rounds to the nearest fit, up to
 * 4: a 14" MacBook Pro and anything bigger shows 4 wider cards, smaller windows
 * step down to 3 and 2, and a phone shows 2 (1 when very narrow).
 */
const IDEAL_COL = 320;
const MAX_COLS = 4;
const columnsFor = (width: number) => Math.min(MAX_COLS, Math.max(width < 340 ? 1 : 2, Math.round(width / IDEAL_COL)));

/**
 * Masonry that keeps reading order left-to-right: each card goes into the
 * currently shortest column, using its known aspect ratio (no layout jumps).
 */
/** While selecting, clicking a card picks it instead of opening it. */
export interface Selection {
  active: boolean;
  ids: Set<string>;
  toggle: (r: Ref, range: boolean) => void;
}

export function Masonry({
  items,
  onOpen,
  onFavorite,
  onHide,
  onDelete,
  selection,
}: {
  items: Ref[];
  onOpen: (r: Ref, thumb: HTMLElement) => void;
  onFavorite: (r: Ref) => void;
  onHide: (r: Ref) => void;
  onDelete: (r: Ref) => void;
  selection: Selection;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // First guess from the window (minus sidebar and padding); the ResizeObserver corrects it before paint.
  const [cols, setCols] = useState(() => columnsFor(innerWidth - (innerWidth > 820 ? 276 : 24)));

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setCols(columnsFor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns: { r: Ref; i: number }[][] = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);
  items.forEach((r, i) => {
    const c = heights.indexOf(Math.min(...heights));
    columns[c]!.push({ r, i });
    heights[c] += cardRatio(r) + 0.05;
  });

  return (
    <div className={`masonry ${selection.active ? "selecting" : ""}`} ref={ref}>
      {columns.map((col, c) => (
        <div className="masonry-col" key={c}>
          {col.map(({ r, i }) => (
            <Card
              key={r.id}
              r={r}
              index={i}
              onOpen={onOpen}
              onFavorite={onFavorite}
              onHide={onHide}
              onDelete={onDelete}
              selection={selection}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function cardRatio(r: Ref) {
  // A site's card shows its first screen (1440×900).
  if (r.site) return 0.625;
  const m = r.media[0];
  const ratio = m?.width && m?.height ? m.height / m.width : r.preview_url ? 0.56 : 0.8;
  return Math.min(Math.max(ratio, 0.45), 1.7);
}

function Card({
  r,
  index,
  onOpen,
  onFavorite,
  onHide,
  onDelete,
  selection,
}: {
  r: Ref;
  index: number;
  onOpen: (r: Ref, thumb: HTMLElement) => void;
  onFavorite: (r: Ref) => void;
  onHide: (r: Ref) => void;
  onDelete: (r: Ref) => void;
  selection: Selection;
}) {
  const m = r.media[0];
  const thumbRef = useRef<HTMLDivElement>(null);
  const poster = m?.thumb_url ?? r.preview_url;
  const moving = m && m.type !== "image" && m.url;
  const picked = selection.ids.has(r.id);
  // Delete takes a second click on the same spot, so a stray click can't lose a post.
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 2500);
    return () => clearTimeout(t);
  }, [arming]);
  const activate = (range: boolean) => (selection.active ? selection.toggle(r, range) : onOpen(r, thumbRef.current!));

  return (
    <article
      className={`card ${r.status} ${picked ? "picked" : ""}`}
      data-ref={r.id}
      style={{ "--i": Math.min(index, 14) } as React.CSSProperties}
      onClick={(e) => activate(e.shiftKey)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && activate(e.shiftKey)}
      aria-label={displayTitle(r)}
      aria-selected={selection.active ? picked : undefined}
    >
      <div className="thumb" ref={thumbRef} style={{ aspectRatio: `1 / ${cardRatio(r)}` }}>
        {poster ? <FadeImg src={poster} /> : <Placeholder r={r} />}
        {moving && <AutoVideo src={m.url!} />}

        {r.status !== "archived" && (
          <span className={`chip ${r.status}`}>
            <span className={`dot ${r.status}`} />
            {STATUS_LABEL[r.status]}
          </span>
        )}
        {m && m.type !== "image" && m.duration ? <span className="chip time">{formatDuration(m.duration)}</span> : null}
        {r.media_count > 1 && !r.site && <span className="chip count">{r.media_count}</span>}

        {/* Top left: picks the card, and starts selecting if nothing is picked yet. */}
        <button
          className={`card-check ${picked ? "on" : ""}`}
          aria-label={picked ? "Deselect" : "Select"}
          onClick={(e) => {
            e.stopPropagation();
            selection.toggle(r, e.shiftKey);
          }}
        >
          <Icon name="check" size={14} />
        </button>

        {/* Top right: takes the place of the duration/count chips, which fade out on hover. */}
        <div className="card-top">
          <button
            className={`glass-btn ${r.favorite ? "on" : ""}`}
            aria-label={r.favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={(e) => {
              e.stopPropagation();
              onFavorite(r);
            }}
          >
            <span key={String(r.favorite)} className={r.favorite ? "pop" : ""}>
              <Icon name={r.favorite ? "heart-fill" : "heart"} size={19} />
            </span>
          </button>
          <button
            className="glass-btn"
            aria-label={r.hidden ? "Show in library" : "Hide"}
            title={r.hidden ? "Show in library" : "Hide: keep it, but out of sight"}
            onClick={(e) => {
              e.stopPropagation();
              onHide(r);
            }}
          >
            <Icon name={r.hidden ? "eye" : "eye-off"} size={19} />
          </button>
          <button
            className={`glass-btn delete ${arming ? "armed" : ""}`}
            aria-label={arming ? "Click again to move to Trash" : "Delete"}
            title={arming ? "Click again to move to Trash" : "Delete"}
            onClick={(e) => {
              e.stopPropagation();
              if (arming) onDelete(r);
              else setArming(true);
            }}
            onMouseLeave={() => setArming(false)}
          >
            <Icon name="trash" size={19} />
          </button>
        </div>

        <div className="card-foot">
          <Avatar r={r} size={30} />
          <div className="card-actions">
            {r.source_url && (
              <a
                className="glass-btn"
                href={r.source_url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open original"
                onClick={(e) => e.stopPropagation()}
              >
                <Icon name="arrow-up-right" size={19} />
              </a>
            )}
          </div>
        </div>
        {r.favorite && <span className="fav-mark"><Icon name="heart-fill" size={12} /></span>}
      </div>
    </article>
  );
}

/** Images fade in once decoded instead of popping in line by line. */
export function FadeImg({ src, className = "" }: { src: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      className={`${className} fade ${loaded ? "in" : ""}`}
      ref={(el) => {
        if (el?.complete && el.naturalWidth) setLoaded(true);
      }}
      onLoad={() => setLoaded(true)}
    />
  );
}

/** Plays (muted, from disk) only while on screen, like a living mood board. */
function AutoVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current!;
    if (prefersReducedMotion()) return;
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current!;
    if (visible) el.play().catch(() => {});
    else el.pause();
  }, [visible]);

  return (
    <video
      ref={ref}
      src={visible || playing ? src : undefined}
      muted
      loop
      playsInline
      preload="none"
      className={`fade ${playing ? "in" : ""}`}
      onPlaying={() => setPlaying(true)}
    />
  );
}

export function Avatar({ r, size }: { r: Ref; size: number }) {
  const label = r.creator_name ?? r.creator_handle ?? (r.kind === "upload" ? "↑" : "·");
  if (r.avatar_url)
    return <img className="avatar" src={r.avatar_url} alt="" style={{ width: size, height: size }} draggable={false} />;
  let hue = 0;
  for (const ch of r.creator_handle ?? r.id) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.45, background: `oklch(0.72 0.09 ${hue})` }}>
      {label[0]?.toUpperCase()}
    </span>
  );
}

function Placeholder({ r }: { r: Ref }) {
  if (r.status === "pending")
    return (
      <div className="placeholder shimmer">
        <span>Saving a copy…</span>
      </div>
    );
  return (
    <div className="placeholder">
      <Icon name={r.status === "failed" ? "alert" : "link"} size={18} />
      <span>{r.text?.slice(0, 140) || displayTitle(r)}</span>
    </div>
  );
}
