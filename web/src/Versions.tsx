// The studio's Versions column: every version of the sketch, newest first, under the day it
// was made, each with its picture, its number, the time, who made it (you, or FRIDAY's mark)
// and what it changed in a line. Every version can be seen and brought back; nothing is ever
// deleted. Bringing one back makes it the newest version (the server writes its file again,
// byte for byte), so the versions after it stay in the list to go back to as well.
//
// A click shows a version on the page, like the header's arrows do; Up and Down move through
// the list while it has the keyboard. The page keeps where it was scrolled (Studio.tsx), so
// two versions can be compared by flipping between them.

import { useEffect, useRef, useState } from "react";
import type { SketchInfo } from "./api.ts";
import { Mark } from "./Glow.tsx";
import { RailHead } from "./Knobs.tsx";

type Version = SketchInfo["versions"][number];

const pictureOf = (project: string, id: string, v: number) => `/sketches/${project}/${id}/v${v}.jpg`;

/** "Today", or the day and month ("10 Nov"), with the year when it isn't this one. */
function dayOf(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
const timeOf = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

export function Versions(props: {
  project: string;
  sketch: string;
  versions: Version[];
  /** The version on the page. */
  current: number;
  /** Versions with hand changes waiting on them, not saved yet. */
  waiting: Set<number>;
  onShow: (v: number) => void;
  onRestore: (v: number) => Promise<void>;
  onClose: () => void;
}) {
  const { versions, current } = props;
  const list = useRef<HTMLDivElement>(null);
  const [bringing, setBringing] = useState(false);
  const newest = versions.at(-1)?.v;
  const shown = [...versions].reverse();

  // The version on the page is in view: when the column opens, and as it changes.
  const first = useRef(true);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(".st-ver.on");
    row?.scrollIntoView({ block: first.current ? "center" : "nearest" });
    first.current = false;
  }, [current, versions.length]);

  const step = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const i = shown.findIndex((x) => x.v === current);
    const next = shown[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    props.onShow(next.v);
    // The keyboard stays on the list as the marked row moves.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-v="${next.v}"]`)?.focus());
  };

  let day = "";
  return (
    <aside className="st-rail st-versions-rail" aria-label="Versions">
      <RailHead name="Versions" onClose={props.onClose}>
        <span className="st-rail-count">{versions.length}</span>
      </RailHead>
      <div className="st-tree st-ver-list" ref={list} role="listbox" aria-label="Versions, newest first" onKeyDown={step}>
        {shown.map((x) => {
          const d = dayOf(x.at);
          const heading = d !== day ? d : null;
          day = d;
          const on = x.v === current;
          return (
            <div key={x.v} className="st-ver-group">
              {heading && <div className="st-day">{heading}</div>}
              <div
                className={`st-ver ${on ? "on" : ""}`}
                role="option"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                data-v={x.v}
                onClick={() => !on && props.onShow(x.v)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) props.onShow(x.v);
                }}
              >
                <span className="st-ver-pic">
                  <img src={pictureOf(props.project, props.sketch, x.v)} alt="" loading="lazy" draggable={false} />
                </span>
                <span className="st-ver-text">
                  <span className="st-ver-line">
                    <b>v{x.v}</b>
                    <span className="st-ver-time">{timeOf(x.at)}</span>
                    {x.by === "you" ? <span className="st-ver-who">You</span> : x.by === "friday" ? <span className="st-ver-who" title="FRIDAY"><Mark size={12} /></span> : null}
                    {props.waiting.has(x.v) && <i className="st-ver-dot" title="Changes here not saved yet" aria-label="changes not saved yet" />}
                  </span>
                  {x.what && <span className="st-ver-what">{x.what}</span>}
                  {on && x.v !== newest && (
                    <button
                      className="st-quiet sm st-ver-back"
                      disabled={bringing}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setBringing(true);
                        try {
                          await props.onRestore(x.v);
                        } finally {
                          setBringing(false);
                        }
                      }}
                      title="Make this version the newest one again. Nothing after it is lost."
                    >
                      {bringing ? "Bringing back…" : `Bring back as v${(newest ?? x.v) + 1}`}
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
