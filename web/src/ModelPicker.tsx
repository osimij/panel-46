// Which model FRIDAY uses and how hard it thinks, picked the way Claude Code does it. Either
// one model at one effort, or two models on one answer: one plans and decides (Fable, for
// its eye), the other builds what was planned (Opus). The choice is kept by Panel and holds
// from the next message on. How full the conversation is lives beside it (ContextMeter.tsx).

import { useEffect, useState } from "react";
import { chatApi, type ChatSettings, type Effort } from "./api.ts";
import { Icon } from "./Icon.tsx";
import { Popover } from "./TagRow.tsx";

const EFFORTS: { value: Effort; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "Answers fast and looks at little. Fine for small, clear changes." },
  { value: "medium", label: "Medium", hint: "Quicker, looks at less." },
  { value: "high", label: "High", hint: "Searches a few ways and looks before it answers." },
  { value: "xhigh", label: "Extra", hint: "Takes its time: more searches, more looking, more checking." },
  { value: "max", label: "Max", hint: "Everything it has. Slow, and uses the most of your plan; for the hardest asks." },
];

type Patch = Partial<Omit<ChatSettings, "models">>;

export function ModelPicker() {
  const [s, setS] = useState<ChatSettings | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    chatApi.settings().then(setS).catch(() => {});
  }, []);
  if (!s) return null;

  const change = (patch: Patch) => {
    setS((v) => (v ? { ...v, ...patch } : v));
    void chatApi.setSettings(patch).then(setS).catch(() => {});
  };
  const name = (id: string) => s.models.find((m) => m.id === id)?.name ?? id;
  const first = (id: string) => name(id).split(" ")[0];
  const effortOf = (e: Effort) => EFFORTS.find((x) => x.value === e)!;
  const duo = s.mode === "duo";

  return (
    <>
      <button
        className={`model-chip ${at ? "on" : ""}`}
        // Open: the click closes it (without this, the menu's own outside-click closes it first and the click opens it again).
        onMouseDown={(e) => at && e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // The chip sits at the bottom of the screen, so the menu opens upward (Popover moves it up by its height + 40): this puts it just above the message box.
          setAt(at ? null : { x: r.left - 120, y: r.top + 24 });
          chatApi.settings().then(setS).catch(() => {});
        }}
        title={duo ? `${name(s.plan_model)} plans, ${name(s.build_model)} builds` : `${name(s.model)}, ${effortOf(s.effort).label.toLowerCase()} effort`}
        aria-label="Model and effort"
      >
        {duo ? <>{first(s.plan_model)} <span className="faint">→</span> {first(s.build_model)}</> : <>{name(s.model)} <span className="faint">{effortOf(s.effort).label}</span></>}
        <Icon name="chevron-down" size={10} />
      </button>
      {at && (
        <Popover x={at.x} y={at.y} onClose={() => setAt(null)} className="mp">
          <div className="ask-depth mp-mode" role="radiogroup" aria-label="How FRIDAY works">
            <button role="radio" aria-checked={!duo} className={!duo ? "on" : ""} onClick={() => change({ mode: "solo" })}>One model</button>
            <button role="radio" aria-checked={duo} className={duo ? "on" : ""} onClick={() => change({ mode: "duo" })}>Plan, then build</button>
          </div>
          {duo ? (
            <>
              <p className="mp-hint">
                {name(s.plan_model)} reads the project, looks at your saves and decides, then writes a plan. {name(s.build_model)} makes it. A question is answered by {first(s.plan_model)} alone; a change you point at in the studio goes straight to {first(s.build_model)}.
              </p>
              <Role title="Plans and decides" s={s} model={s.plan_model} effort={s.plan_effort} onModel={(v) => change({ plan_model: v })} onEffort={(v) => change({ plan_effort: v })} />
              <Role title="Builds" s={s} model={s.build_model} effort={s.build_effort} onModel={(v) => change({ build_model: v })} onEffort={(v) => change({ build_effort: v })} />
            </>
          ) : (
            <>
              <div className="menu-label mp-label">Model</div>
              {s.models.map((m) => (
                <button key={m.id} role="radio" aria-checked={s.model === m.id} className={`mp-model ${s.model === m.id ? "on" : ""}`} onClick={() => change({ model: m.id })}>
                  <span className="mp-model-text">
                    <span className="mp-name">{m.name}</span>
                    <span className="mp-note">{m.note}</span>
                  </span>
                  {s.model === m.id && <Icon name="check" size={13} />}
                </button>
              ))}
              <div className="menu-label mp-label">Effort</div>
              <EffortPick value={s.effort} onChange={(v) => change({ effort: v })} />
              <p className="mp-hint">{effortOf(s.effort).hint}</p>
            </>
          )}
        </Popover>
      )}
    </>
  );
}

/** One of the two models in "plan, then build": which, and how hard it thinks. */
function Role(props: { title: string; s: ChatSettings; model: string; effort: Effort; onModel: (id: string) => void; onEffort: (e: Effort) => void }) {
  return (
    <div className="mp-role">
      <div className="menu-label mp-label">{props.title}</div>
      <div className="ask-depth" role="radiogroup" aria-label={`${props.title}: model`}>
        {props.s.models.map((m) => (
          <button key={m.id} role="radio" aria-checked={props.model === m.id} className={props.model === m.id ? "on" : ""} onClick={() => props.onModel(m.id)} title={m.note}>
            {m.name.split(" ")[0]}
          </button>
        ))}
      </div>
      <EffortPick value={props.effort} onChange={props.onEffort} />
    </div>
  );
}

function EffortPick({ value, onChange }: { value: Effort; onChange: (e: Effort) => void }) {
  return (
    <div className="ask-depth mp-effort" role="radiogroup" aria-label="Effort">
      {EFFORTS.map((e) => (
        <button key={e.value} role="radio" aria-checked={value === e.value} className={value === e.value ? "on" : ""} onClick={() => onChange(e.value)} title={e.hint}>
          {e.label}
        </button>
      ))}
    </div>
  );
}
