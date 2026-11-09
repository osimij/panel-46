import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { displayTitle, formatDuration, personFace, prefersReducedMotion, skillParts, STATUS_LABEL, type Ref } from "./api.ts";
import { Icon } from "./Icon.tsx";

/**
 * Columns aim for about this width and the count rounds to the nearest fit, up to
 * 4: a 14" MacBook Pro and anything bigger shows 4 wider cards, smaller windows
 * step down to 3 and 2, and a phone shows 2 (1 when very narrow).
 */
const IDEAL_COL = 320;
const MAX_COLS = 4;
const columnsFor = (width: number) => Math.min(MAX_COLS, Math.max(width < 340 ? 1 : 2, Math.round(width / IDEAL_COL)));

/** While selecting, clicking a card picks it instead of opening it. */
export interface Selection {
  active: boolean;
  ids: Set<string>;
  toggle: (r: Ref, range: boolean) => void;
}

/** Where a card sits in the grid, in px from the grid's top left. */
interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The same curve the Ask drawer and the sidebar move on, so the grid moves with them. */
const GLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The width the grid is headed for. While Ask slides open or shut, .main's margin is
 * mid-transition; laying out for every in-between width would re-flow the columns
 * several times on the way (2, then 3, then 4). Lay out once, for where it ends up.
 */
function targetWidth(el: HTMLElement) {
  // Fractional, unlike clientWidth, so it lines up exactly with the fractional margin.
  const w = el.getBoundingClientRect().width;
  const main = el.closest<HTMLElement>(".main");
  if (!main) return { now: w, target: w };
  for (const a of main.getAnimations()) {
    if (!(a instanceof CSSTransition) || a.transitionProperty !== "margin-right") continue;
    const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
    const to = parseFloat(String(frames[frames.length - 1]?.marginRight ?? ""));
    const now = parseFloat(getComputedStyle(main).marginRight);
    if (Number.isFinite(to) && Number.isFinite(now)) return { now: w, target: w + now - to };
  }
  return { now: w, target: w };
}

/**
 * Masonry that keeps reading order left-to-right: each card goes into the currently
 * shortest column, using its known aspect ratio (no layout jumps).
 *
 * Cards are placed absolutely, all in one parent, so a re-layout (the window, or Ask
 * opening beside the grid) never remounts them: they glide from where they were to
 * where they go, and their images and videos carry on undisturbed.
 */
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
  // Cards get handlers that never change, which call the latest ones: a card then only
  // re-renders when something about it changed, not whenever the page around it does.
  const latest = useRef({ onOpen, onFavorite, onHide, onDelete, toggle: selection.toggle });
  latest.current = { onOpen, onFavorite, onHide, onDelete, toggle: selection.toggle };
  const handlers = useMemo<CardHandlers>(
    () => ({
      onOpen: (r, thumb) => latest.current.onOpen(r, thumb),
      onFavorite: (r) => latest.current.onFavorite(r),
      onHide: (r) => latest.current.onHide(r),
      onDelete: (r) => latest.current.onDelete(r),
      onToggle: (r, range) => latest.current.toggle(r, range),
    }),
    [],
  );
  // First guess from the window (minus sidebar and padding); measured before the first paint.
  const [box, setBox] = useState(() => ({
    w: innerWidth - (innerWidth > 820 ? 276 : 24),
    gap: innerWidth > 820 ? 12 : 8,
  }));
  // Set when the width changed because Ask is sliding, rather than the window being dragged.
  const sliding = useRef(false);

  // Only the cards on or near the screen are mounted: a long library is thousands of cards,
  // and the ones far away cost memory and time for nothing. `view` is the band of the grid
  // (in px from its top) worth keeping: the screen and two screens either side, moved in
  // steps so scrolling re-renders the grid a few times a second at most, not every frame.
  const [view, setView] = useState<{ top: number; bottom: number } | null>(null);
  const lookAgain = useRef(() => {});
  useLayoutEffect(() => {
    const el = ref.current!;
    const STEP = 500;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const above = -el.getBoundingClientRect().top;
      const margin = Math.max(1600, innerHeight * 2);
      const top = Math.floor((above - margin) / STEP) * STEP;
      const bottom = Math.ceil((above + innerHeight + margin) / STEP) * STEP;
      setView((v) => (v && v.top === top && v.bottom === bottom ? v : { top, bottom }));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    lookAgain.current = soon;
    measure();
    addEventListener("scroll", soon, { passive: true });
    addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", soon);
      removeEventListener("resize", soon);
    };
  }, []);
  // Cards that have been on screen once: when one comes back after scrolling away, it's
  // simply there, without playing its entrance again.
  const seen = useRef(new Set<string>());

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const { now, target } = targetWidth(el);
      const w = Math.round(target * 2) / 2;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 12;
      const slide = Math.abs(target - now) > 1;
      sliding.current = slide;
      // Under half a pixel is rounding, not a new layout; mid-slide the target can also
      // read a hair different frame to frame.
      setBox((b) => (b.gap === gap && Math.abs(b.w - w) < (slide ? 2 : 0.5) ? b : { w, gap }));
    };
    measure();
    // Re-lay out before the browser paints the resized grid, never a frame later.
    const ro = new ResizeObserver(() => {
      flushSync(measure);
      lookAgain.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = columnsFor(box.w);
  const colW = Math.max(0, (box.w - box.gap * (cols - 1)) / cols);
  const spots = new Map<string, Spot>();
  const heights = new Array<number>(cols).fill(0);
  for (const r of items) {
    const c = heights.indexOf(Math.min(...heights));
    const h = colW * cardRatio(r);
    spots.set(r.id, { x: c * (colW + box.gap), y: heights[c]!, w: colW, h });
    heights[c]! += h + box.gap;
  }
  const height = Math.max(0, Math.max(...heights) - box.gap);

  // FLIP: each card that moved starts where it was (or where its last glide had got to)
  // and glides to its new spot. Only cards on or near the screen animate.
  const last = useRef<{ spots: Map<string, Spot>; cols: number; w: number } | null>(null);
  const glides = useRef(new Map<string, { anim: Animation; from: Spot; to: Spot }>());
  useLayoutEffect(() => {
    const el = ref.current!;
    // Cards are placed here rather than through their props: when the width changes (a
    // drag of Ask's edge or the window's, every frame) no card re-renders, only these
    // three numbers each change, which the browser restyles and lays out in well under a ms.
    for (const card of el.children as HTMLCollectionOf<HTMLElement>) {
      const s = card.dataset.ref && spots.get(card.dataset.ref);
      if (!s) continue;
      card.style.left = `${s.x}px`;
      card.style.top = `${s.y}px`;
      card.style.width = `${s.w}px`;
      seen.current.add(card.dataset.ref!);
    }
    const prev = last.current;
    last.current = { spots, cols, w: box.w };
    if (!prev || prefersReducedMotion()) return;
    // Dragging the window edge with the same columns: follow the edge exactly, no glide.
    const widthOnly = prev.w !== box.w && prev.cols === cols && !sliding.current;
    const duration = sliding.current || prev.w !== box.w ? 500 : 420;
    const top = el.getBoundingClientRect().top;
    const near = (s: Spot) => top + s.y + s.h > -200 && top + s.y < innerHeight + 200;

    for (const card of el.children as HTMLCollectionOf<HTMLElement>) {
      const id = card.dataset.ref;
      const to = id && spots.get(id);
      if (!to) continue;
      const g = glides.current.get(id!);
      let from: Spot | undefined;
      if (g && g.anim.playState === "running") {
        // Mid-glide: start from where it is on screen right now.
        const p = g.anim.effect?.getComputedTiming().progress ?? 1;
        from = {
          x: g.from.x + (g.to.x - g.from.x) * p,
          y: g.from.y + (g.to.y - g.from.y) * p,
          w: g.from.w + (g.to.w - g.from.w) * p,
          h: g.from.h + (g.to.h - g.from.h) * p,
        };
        g.anim.cancel();
        glides.current.delete(id!);
      } else if (!widthOnly) {
        from = prev.spots.get(id!);
      }
      if (!from || (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.w - to.w) < 0.5)) continue;
      if (!to.w || (!near(from) && !near(to))) continue;
      const anim = card.animate(
        [
          { transformOrigin: "0 0", transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w})` },
          { transformOrigin: "0 0", transform: "none" },
        ],
        { duration, easing: GLIDE_EASE },
      );
      glides.current.set(id!, { anim, from, to });
      anim.onfinish = anim.oncancel = () => {
        if (glides.current.get(id!)?.anim === anim) glides.current.delete(id!);
      };
    }
  });

  return (
    <div className={`masonry ${selection.active ? "selecting" : ""}`} ref={ref} style={{ height }}>
      {items.map((r, i) => {
        const s = spots.get(r.id)!;
        // Before the first look at the screen: just the first few, never the whole library.
        if (view ? s.y + s.h < view.top || s.y > view.bottom : i >= 40) return null;
        return (
          <Card
            key={r.id}
            r={r}
            index={i}
            seen={seen.current}
            selecting={selection.active}
            picked={selection.ids.has(r.id)}
            handlers={handlers}
          />
        );
      })}
    </div>
  );
}

function cardRatio(r: Ref) {
  // A person: their card, a little taller when there's a cover (a portfolio's first screen, a banner).
  if (r.person) return personFace(r).cover ? 1.12 : 1;
  // A site's card shows its first screen (1440×900).
  if (r.site) return 0.625;
  if (r.kind === "skill") return 0.86;
  const m = r.media[0];
  const ratio = m?.width && m?.height ? m.height / m.width : r.preview_url ? 0.56 : 0.8;
  return Math.min(Math.max(ratio, 0.45), 1.7);
}

interface CardHandlers {
  onOpen: (r: Ref, thumb: HTMLElement) => void;
  onFavorite: (r: Ref) => void;
  onHide: (r: Ref) => void;
  onDelete: (r: Ref) => void;
  onToggle: (r: Ref, range: boolean) => void;
}

const Card = memo(function Card({
  r,
  index,
  seen,
  selecting,
  picked,
  handlers: { onOpen, onFavorite, onHide, onDelete, onToggle },
}: {
  r: Ref;
  index: number;
  /** The cards the grid has shown before (the same set every time, so it never re-renders a card). */
  seen: Set<string>;
  selecting: boolean;
  picked: boolean;
  handlers: CardHandlers;
}) {
  const m = r.media[0];
  // Its entrance is staggered by where it first appeared; a later move mustn't change
  // the delay of an entrance that already played (that could replay it).
  const [stagger] = useState(() => Math.min(index, 14));
  // Back on screen after being scrolled away: no entrance this time.
  const [back] = useState(() => seen.has(r.id));
  const thumbRef = useRef<HTMLDivElement>(null);
  const poster = m?.thumb_url ?? r.preview_url;
  const moving = m && m.type !== "image" && m.url;
  // Delete takes a second click on the same spot, so a stray click can't lose a post.
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 2500);
    return () => clearTimeout(t);
  }, [arming]);
  const activate = (range: boolean) => (selecting ? onToggle(r, range) : onOpen(r, thumbRef.current!));

  return (
    <article
      className={`card ${r.status} ${picked ? "picked" : ""} ${back ? "back" : ""}`}
      data-ref={r.id}
      // Its place (left, top, width) is set by the grid, straight on the element.
      style={{ "--i": stagger } as React.CSSProperties}
      onClick={(e) => activate(e.shiftKey)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && activate(e.shiftKey)}
      aria-label={displayTitle(r)}
      aria-selected={selecting ? picked : undefined}
    >
      <div className="thumb" ref={thumbRef} style={{ aspectRatio: `1 / ${cardRatio(r)}` }}>
        {r.person && r.status !== "pending" ? (
          <PersonFace r={r} />
        ) : r.kind === "skill" && r.status !== "pending" ? (
          <SkillFace r={r} />
        ) : poster ? (
          <FadeImg src={poster} />
        ) : (
          <Placeholder r={r} />
        )}
        {moving && <AutoVideo src={m.loop_url ?? m.url!} />}

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
            onToggle(r, e.shiftKey);
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
          {r.person || r.kind === "skill" ? <span /> : <Avatar r={r} size={30} />}
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
});

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

/**
 * A person on the card, the same whether they were saved from a profile or their
 * website: their photo (or their site's icon), name, where they are, and a cover
 * when there is one: their portfolio's first screen, or a banner.
 */
function PersonFace({ r }: { r: Ref }) {
  const f = personFace(r);
  return (
    <div className={`face person-face ${f.cover ? "has-cover" : ""}`}>
      {f.cover && <FadeImg src={f.cover} className="person-cover" />}
      <PersonAvatar r={r} size={88} />
      <div className="person-name">{f.name}</div>
      {f.sub && <div className="person-meta">{f.sub}</div>}
      {f.bio && <p className="person-bio">{f.bio}</p>}
      {f.stats && <div className="person-stats">{f.stats}</div>}
      {f.places.length > 1 && (
        <div className="person-places">
          {f.places.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A person's face: their photo, else their website's icon on a tile, else their initial. */
export function PersonAvatar({ r, size }: { r: Ref; size: number }) {
  const f = personFace(r);
  if (f.photo) return <img className="avatar" src={f.photo} alt="" style={{ width: size, height: size }} draggable={false} />;
  if (f.logo)
    return (
      <span className="avatar logo" style={{ width: size, height: size }}>
        <img src={f.logo} alt="" draggable={false} />
      </span>
    );
  return <Avatar r={r} size={size} />;
}

/** A skill file on the card: its name and what it's for, like a page of a manual. */
function SkillFace({ r }: { r: Ref }) {
  const { description } = skillParts(r.text ?? "");
  return (
    <div className="face skill-face">
      <span className="skill-label">SKILL.md</span>
      <div className="skill-name">{displayTitle(r)}</div>
      {description && <p className="skill-desc">{description}</p>}
    </div>
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
