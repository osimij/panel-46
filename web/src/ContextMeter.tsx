// How full the open conversation is, by the message box: a small ring and its percent, the way
// Claude Code's own app shows it. Pressed, it says what takes the room: FRIDAY's instructions,
// Panel's tools, and the conversation itself (what FRIDAY read, its answers, the designer's
// messages), down to the tools whose results take the most. 100% is where Claude Code
// summarizes the earlier part of the conversation, so "Summarize now" lives here too.
//
// The numbers come after each answer (server/contextparts.ts); a conversation whose answers
// were all made before the meter knows only the total until the next one.

import { useEffect, useState } from "react";
import { chatApi, type ContextUse } from "./api.ts";
import { Popover } from "./TagRow.tsx";

/** 212000 → "212K"; small numbers as they are. */
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));

/** One gray per row, darkest for the biggest, so the bar reads at a glance. */
const SHADES = ["var(--text)", "var(--muted)", "var(--faint)", "var(--fill-hover)"];

export function ContextMeter({ use, running, onCompact }: { use: ContextUse | null; running: boolean; onCompact: () => void }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [duo, setDuo] = useState(false);
  // Known before the panel opens, so its height is right when it's placed above the box.
  useEffect(() => {
    chatApi.settings().then((s) => setDuo(s.mode === "duo")).catch(() => {});
  }, []);
  // Shown once the conversation has an answer.
  if (!use) return null;

  const full = Math.min(100, Math.round((use.used / use.limit) * 100));
  const high = full >= 85;
  const parts = use.parts ?? null;
  const used = parts?.rows.filter((r) => r.kind === "used") ?? [];
  const rest = parts?.rows.filter((r) => r.kind !== "used") ?? [];
  const shade = (i: number) => SHADES[Math.min(i, SHADES.length - 1)];
  // The ring: a circle of radius 5.5 drawn from the top, filled as far as the percent.
  const R = 5.5, C = 2 * Math.PI * R;

  return (
    <>
      <button
        className={`context-meter ${at ? "on" : ""} ${high ? "high" : ""}`}
        // Open: the click closes it (without this, the panel's own outside-click closes it first and the click opens it again).
        onMouseDown={(e) => at && e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // At the bottom of the screen, the panel opens upward (Popover moves it up by its height + 40), just above the box.
          setAt(at ? null : { x: r.left - 4, y: r.top + 24 });
          if (!at) chatApi.settings().then((s) => setDuo(s.mode === "duo")).catch(() => {});
        }}
        title={`This conversation is ${full}% full. Press to see what fills it.`}
        aria-label={`This conversation is ${full}% full`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle className="cm-track" cx="7" cy="7" r={R} />
          <circle className="cm-arc" cx="7" cy="7" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - full / 100)} transform="rotate(-90 7 7)" />
        </svg>
        <span>{full}%</span>
      </button>
      {at && (
        // Placed again if the mode changed since (the planner's line changes its height).
        <Popover key={String(duo)} x={at.x} y={at.y} onClose={() => setAt(null)} className="cm">
          <div className="cm-head">
            <span>This conversation</span>
            <span className="cm-total">{k(use.used)} of {k(use.limit)} · {full}%</span>
          </div>
          <span className="mp-use-bar cm-bar">
            {used.length
              ? used.map((r, i) => <i key={r.id} style={{ width: `${(r.tokens / use.limit) * 100}%`, background: shade(i) }} />)
              : <i style={{ width: `${full}%` }} />}
          </span>
          {parts ? (
            <div className="cm-rows">
              {used.map((r, i) => (
                <div key={r.id}>
                  <Row name={r.name} tokens={r.tokens} dot={shade(i)} />
                  {r.id === "messages" && parts.talk?.map((t) => (
                    <div key={t.id}>
                      <Row name={t.name} tokens={t.tokens} depth={1} />
                      {t.tools?.map((x) => <Row key={x.name} name={x.name} tokens={x.tokens} depth={2} />)}
                    </div>
                  ))}
                </div>
              ))}
              {rest.map((r) => <Row key={r.id} name={r.name} tokens={r.tokens} faint />)}
            </div>
          ) : (
            <p className="cm-note">Send a message to see what fills it.</p>
          )}
          {duo && <p className="cm-note">This is the planner's conversation. The builder keeps its own.</p>}
          <div className="cm-foot">
            <p className="cm-note">When it fills up, the earlier part is summarized and FRIDAY gets the project card again.</p>
            <button
              className="mp-compact"
              disabled={running}
              onClick={() => {
                setAt(null);
                onCompact();
              }}
              title="Summarize the conversation so far now (same as typing /compact). The project card comes back after."
            >
              Summarize now
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

function Row({ name, tokens, depth = 0, dot, faint }: { name: string; tokens: number; depth?: number; dot?: string; faint?: boolean }) {
  return (
    <div className={`cm-row d${depth} ${faint ? "faint" : ""}`}>
      {depth === 0 && <i className="cm-dot" style={{ background: dot ?? "transparent" }} />}
      <span className="cm-name">{name}</span>
      <span className="cm-n">{k(tokens)}</span>
    </div>
  );
}
