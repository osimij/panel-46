import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayTitle, formatDuration, prefersReducedMotion, STATUS_LABEL, type Ref } from "./api.ts";
import { Icon } from "./Icon.tsx";

/**
 * Columns aim for about this width and the count rounds to the nearest fit, so
 * cards scale smoothly with the window: 4 columns on a 14" MacBook Pro, 5 on a
 * 16" or a 1080p display, 7 on a 1440p one, 2 on a phone.
 */
const IDEAL_COL = 320;
const columnsFor = (width: number) => Math.max(width < 340 ? 1 : 2, Math.round(width / IDEAL_COL));

/**
 * Masonry that keeps reading order left-to-right: each card goes into the
 * currently shortest column, using its known aspect ratio (no layout jumps).
 */
export function Masonry({
  items,
  onOpen,
  onFavorite,
}: {
  items: Ref[];
  onOpen: (r: Ref, thumb: HTMLElement) => void;
  onFavorite: (r: Ref) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // First guess from the window (minus sidebar and padding); the ResizeObserver corrects it before paint.
  const [cols, setCols] = useState(() => columnsFor(innerWidth - (innerWidth > 820 ? 192 : 24)));

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
    <div className="masonry" ref={ref}>
      {columns.map((col, c) => (
        <div className="masonry-col" key={c}>
          {col.map(({ r, i }) => (
            <Card key={r.id} r={r} index={i} onOpen={onOpen} onFavorite={onFavorite} />
          ))}
        </div>
      ))}
    </div>
  );
}

function cardRatio(r: Ref) {
  const m = r.media[0];
  const ratio = m?.width && m?.height ? m.height / m.width : r.preview_url ? 0.56 : 0.8;
  return Math.min(Math.max(ratio, 0.45), 1.7);
}

function Card({
  r,
  index,
  onOpen,
  onFavorite,
}: {
  r: Ref;
  index: number;
  onOpen: (r: Ref, thumb: HTMLElement) => void;
  onFavorite: (r: Ref) => void;
}) {
  const m = r.media[0];
  const thumbRef = useRef<HTMLDivElement>(null);
  const poster = m?.thumb_url ?? r.preview_url;
  const moving = m && m.type !== "image" && m.url;
  const open = () => onOpen(r, thumbRef.current!);

  return (
    <article
      className={`card ${r.status}`}
      data-ref={r.id}
      style={{ "--i": Math.min(index, 14) } as React.CSSProperties}
      onClick={open}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && open()}
      aria-label={displayTitle(r)}
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
        {r.media_count > 1 && <span className="chip count">{r.media_count}</span>}

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
