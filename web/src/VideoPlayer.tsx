import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const FRAME = 1 / 30;
const MUTE_KEY = "panel.muted";

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function saveMuted(m: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* private mode etc. */
  }
}

/** Short clips get tenths of a second, which matters when studying motion. */
function clock(t: number, precise: boolean) {
  if (!Number.isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return precise ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}

/**
 * Plays a saved file from disk with quiet, glassy controls that get out of
 * the way while watching. Space/K play, M mute, , and . step frames,
 * Shift+←/→ jump 5s, F full screen.
 */
export function VideoPlayer({ src, poster, kind }: { src: string; poster?: string; kind: "video" | "gif" }) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const resumeAfterScrub = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(() => kind === "gif" || readMuted());
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [idle, setIdle] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [flash, setFlash] = useState<{ id: number; icon: "play" | "pause" } | null>(null);
  const [full, setFull] = useState(false);

  const precise = duration > 0 && duration < 60;

  // Smooth progress: write a CSS variable every frame instead of re-rendering.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v && wrap.current && v.duration) wrap.current.style.setProperty("--p", String(v.currentTime / v.duration));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Try to start with sound; browsers may insist on muted autoplay.
  useEffect(() => {
    const v = video.current!;
    v.muted = muted;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2200);
  }, []);
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const toggle = useCallback(() => {
    const v = video.current!;
    if (v.paused) {
      if (v.ended || v.currentTime >= v.duration - 0.05) v.currentTime = 0;
      void v.play();
      setFlash({ id: Date.now(), icon: "play" });
    } else {
      v.pause();
      setFlash({ id: Date.now(), icon: "pause" });
    }
    wake();
  }, [wake]);

  const setMute = useCallback((m: boolean) => {
    video.current!.muted = m;
    setMuted(m);
    saveMuted(m);
  }, []);

  const step = useCallback((frames: number) => {
    const v = video.current!;
    v.pause();
    v.currentTime = Math.min(Math.max(v.currentTime + frames * FRAME, 0), v.duration || 0);
    setTime(v.currentTime);
  }, []);

  const seekBy = useCallback((s: number) => {
    const v = video.current!;
    v.currentTime = Math.min(Math.max(v.currentTime + s, 0), v.duration || 0);
    wake();
  }, [wake]);

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(video.current!.playbackRate) + 1) % SPEEDS.length]!;
    video.current!.playbackRate = next;
    setRate(next);
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrap.current?.requestFullscreen();
  };
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") {
        e.preventDefault();
        toggle();
      } else if (k === "m" && kind === "video") setMute(!video.current!.muted);
      else if (k === ",") step(-1);
      else if (k === ".") step(1);
      else if (e.shiftKey && k === "arrowleft") seekBy(-5);
      else if (e.shiftKey && k === "arrowright") seekBy(5);
      else if (k === "f" && e.shiftKey) toggleFull();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [toggle, setMute, step, seekBy, kind]);

  // ---- Scrubbing ----
  const ratioAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
  };
  const scrubTo = (clientX: number) => {
    const v = video.current!;
    if (!v.duration) return;
    v.currentTime = ratioAt(clientX) * v.duration;
    setTime(v.currentTime);
  };

  const showControls = !playing || !idle || scrubbing;

  return (
    <div
      ref={wrap}
      className={`player ${showControls ? "" : "idle"} ${scrubbing ? "scrubbing" : ""} ${full ? "full" : ""}`}
      onMouseMove={wake}
      onMouseLeave={() => playing && setIdle(true)}
    >
      <video
        ref={video}
        src={src}
        poster={poster}
        loop={loop}
        playsInline
        preload="auto"
        onClick={toggle}
        onDoubleClick={toggleFull}
        onPlay={() => {
          setPlaying(true);
          wake();
        }}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => !scrubbing && setTime(e.currentTarget.currentTime)}
      />

      {flash && (
        <span key={flash.id} className="player-flash" aria-hidden>
          <Icon name={flash.icon} size={22} />
        </span>
      )}

      <div className="player-bar" onClick={(e) => e.stopPropagation()}>
        <button className="pbtn" onClick={toggle} aria-label={playing ? "Pause (Space)" : "Play (Space)"} title={playing ? "Pause (Space)" : "Play (Space)"}>
          <span key={String(playing)} className="pbtn-icon">
            <Icon name={playing ? "pause" : "play"} size={15} />
          </span>
        </button>

        <span className="ptime">
          {clock(time, precise)}
          <span className="ptime-total"> / {clock(duration, precise)}</span>
        </span>

        <div
          ref={track}
          className="ptrack"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            resumeAfterScrub.current = !video.current!.paused;
            video.current!.pause();
            setScrubbing(true);
            scrubTo(e.clientX);
          }}
          onPointerMove={(e) => {
            const r = ratioAt(e.clientX);
            setHover({ x: r, t: r * duration });
            if (scrubbing) scrubTo(e.clientX);
          }}
          onPointerUp={() => {
            setScrubbing(false);
            if (resumeAfterScrub.current) void video.current!.play();
          }}
          onPointerLeave={() => !scrubbing && setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.stopPropagation();
              e.preventDefault();
              seekBy(e.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        >
          <div className="ptrack-rail">
            <div className="ptrack-fill" />
          </div>
          <div className="ptrack-thumb" />
          {hover && (
            <span className="ptrack-tip" style={{ left: `${hover.x * 100}%` }}>
              {clock(hover.t, precise)}
            </span>
          )}
        </div>

        <button className={`pbtn text ${rate !== 1 ? "on" : ""}`} onClick={cycleSpeed} title="Playback speed" aria-label={`Speed ${rate}×`}>
          <span key={rate} className="pbtn-icon">{rate}×</span>
        </button>
        <button className={`pbtn ${loop ? "on" : ""}`} onClick={() => setLoop(!loop)} title={loop ? "Looping" : "Play once"} aria-pressed={loop} aria-label="Loop">
          <Icon name="repeat" size={14} />
        </button>
        {kind === "video" && (
          <button className="pbtn" onClick={() => setMute(!muted)} title={muted ? "Unmute (M)" : "Mute (M)"} aria-label={muted ? "Unmute" : "Mute"}>
            <span key={String(muted)} className="pbtn-icon">
              <Icon name={muted ? "volume-x" : "volume"} size={15} />
            </span>
          </button>
        )}
        <button className="pbtn" onClick={toggleFull} title="Full screen (Shift+F)" aria-label="Full screen">
          <Icon name={full ? "minimize" : "maximize"} size={14} />
        </button>
      </div>
    </div>
  );
}
