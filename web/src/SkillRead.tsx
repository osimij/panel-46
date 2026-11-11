// A skill's read, in its detail view (server/skillread.ts says what a read is).
//
// Not read: one line on what a read gives, and "Read this skill". Reading: says so, and can be
// stopped. Read: what the skill is for and who it is for, what FRIDAY carries (Decide and Build,
// line by line with each line's subject; a line on a subject another skill leads says so in small
// type, as that skill wins where the two differ), which the designer can edit (each line keeps its subject in front) and put back;
// what Panel checks and could check later, where it disagrees with the designer's rules, the
// skills it points to, and "Read again".
//
// With "read automatically" on, skills are read by themselves (server/skillreads.ts); these
// buttons are for reading again, or when the setting is off.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { skillReadApi, skillStore, type SkillLine, type SkillReadView } from "./api.ts";
const modelLabel = (m: string | null) => (m ? m.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^\w/, (c) => c.toUpperCase()) : "Claude");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

const FOR_WORDS = {
  sketches: "For sketches",
  both: "For sketches and real builds",
  builds: "For real builds: FRIDAY won't carry it in sketches",
  neither: "Not something Panel can use yet",
} as const;

export function SkillReadPanel({ id }: { id: string }) {
  const [v, setV] = useState<SkillReadView | null>(null);
  const [error, setError] = useState("");
  const page = useSyncExternalStore(skillStore.subscribe, skillStore.get);
  const s = page?.skills.find((x) => x.id === id);
  const load = useCallback(() => skillReadApi.get(id).then(setV, (e: Error) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);
  // While it waits or is read, look again every few seconds.
  const busy = v?.state === "waiting" || v?.state === "reading";
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      void load();
      void skillStore.refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [busy, load]);
  const act = (p: Promise<unknown>) => p.then(() => load(), (e: Error) => setError(e.message));

  if (!v) return error ? <div className="inline-error">{error}</div> : null;
  const a = v.answer;
  return (
    <section className="skill-use skill-read" aria-label="Panel's read of this skill">
      <div className="skill-use-row">
        <span className="skill-use-title">Panel's read</span>
        {a && v.read_at && !busy && <span className="skill-use-label">By {modelLabel(v.model)}, {day(v.read_at)}</span>}
      </div>

      {!a && v.state === "none" && (
        <>
          <p className="skill-use-note">
            Claude reads the skill once: what it is for, a short version FRIDAY can carry, what Panel can check, and where it disagrees
            with your rules.
          </p>
          <div className="skill-use-row wrap">
            <button className="cover-btn" onClick={() => act(skillReadApi.read(id))}>Read this skill</button>
          </div>
        </>
      )}
      {busy && (
        <div className="skill-use-row wrap">
          <span className="skill-read-busy"><span className="spinner" /> {v.state === "reading" ? "Reading this skill…" : "Waiting its turn to be read…"}</span>
          <button className="text-btn inline" onClick={() => act(skillReadApi.stop())} title="Stops every read in line">Stop reading</button>
        </div>
      )}
      {v.state === "failed" && (
        <div className="skill-use-row wrap">
          <span className="inline-error">{a ? "The last read failed: " : "The read failed: "}{v.error}</span>
          <button className="text-btn inline" onClick={() => act(skillReadApi.read(id))}>Try again</button>
        </div>
      )}

      {a && <ReadDone id={id} v={v} checks={s?.checks ?? []} onChanged={load} onError={setError} busy={busy} />}
      {error && <div className="inline-error">{error}</div>}
    </section>
  );
}

/**
 * One line of Decide or Build: its subject, its text, and, in small type, the skill that leads its
 * subject. FRIDAY gets the line either way; the lead wins only where the two say different things.
 */
function Line({ l }: { l: SkillLine }) {
  return (
    <li className="skill-line">
      <span className="skill-line-subject">{l.subject}</span>
      <span className="skill-line-text">
        {l.text}
        {l.led_by && <span className="skill-line-why"> · {l.led_by} leads {l.subject}</span>}
      </span>
    </li>
  );
}

function ReadDone({ id, v, checks, onChanged, onError, busy }: {
  id: string; v: SkillReadView; checks: { name: string; plain: string; level: string }[];
  onChanged: () => void; onError: (e: string) => void; busy: boolean;
}) {
  const a = v.answer!;
  const [decide, setDecide] = useState(v.carries?.decide ?? "");
  const [build, setBuild] = useState(v.carries?.build ?? "");
  const [editing, setEditing] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  // What FRIDAY carries changed on the server (a new read, put back): show it.
  useEffect(() => {
    setDecide(v.carries?.decide ?? "");
    setBuild(v.carries?.build ?? "");
  }, [v.carries?.decide, v.carries?.build]);
  const dirty = decide !== (v.carries?.decide ?? "") || build !== (v.carries?.build ?? "");
  const save = () => skillReadApi.edit(id, {
    decide: decide === v.panel?.decide ? null : decide,
    build: build === v.panel?.build ? null : build,
  }).then(() => { setEditing(false); onChanged(); }, (e: Error) => onError(e.message));
  const putBack = () => skillReadApi.edit(id, { reset: true }).then(onChanged, (e: Error) => onError(e.message));
  const again = () => {
    setConfirmAgain(false);
    skillReadApi.read(id).then(onChanged, (e: Error) => onError(e.message));
  };
  const sketchable = a.for === "sketches" || a.for === "both";
  const lines = v.lines;
  const auto = useSyncExternalStore(skillStore.subscribe, () => !!skillStore.get()?.auto);
  return (
    <>
      <div className="skill-read-what">
        <p className="skill-read-line">{a.one_line}</p>
        <span className="skill-labels">
          {a.subjects.map((x) => <span key={x} className="skill-label">{x}</span>)}
          <span className="skill-use-label">{FOR_WORDS[a.for]}</span>
        </span>
      </div>
      {v.changed && !busy && (
        <p className="skill-use-note">
          The skill changed since it was read.{" "}
          {v.edited ? "You changed what FRIDAY carries, so it isn't read again by itself: read it again to bring this up to date." : auto ? "It is in line to be read again." : "Read it again to bring this up to date."}
        </p>
      )}
      {v.older && !v.changed && !busy && (
        <p className="skill-use-note">
          Read with Panel's older instructions.{" "}
          {v.edited ? "You changed what FRIDAY carries, so it isn't read again by itself." : auto ? "It is in line to be read again." : "Read it again with the new ones."}
        </p>
      )}
      {v.own_parts && <p className="skill-use-note">This file has its own Decide, Build or Check headings: FRIDAY uses those, not this read.</p>}

      {(sketchable || v.carries?.decide || v.carries?.build) && (
        <div className="skill-read-carries">
          <div className="skill-use-row">
            <span className="skill-use-label">
              {sketchable ? "What FRIDAY carries" : "What Claude Code gets when it builds for real"}, about {v.tokens.toLocaleString("en")} tokens
            </span>
            {!editing && !v.own_parts && <button className="text-btn inline" onClick={() => setEditing(true)}>Edit</button>}
          </div>
          {editing || !lines ? (
            <>
              <label className="field">
                <span className="field-label">Decide</span>
                <textarea value={decide} onChange={(e) => setDecide(e.target.value)} spellCheck={false} />
              </label>
              <label className="field">
                <span className="field-label">Build</span>
                <textarea value={build} onChange={(e) => setBuild(e.target.value)} spellCheck={false} />
              </label>
              <p className="skill-use-note">One line each, its subject in front (“motion: …”). A line without one counts as {a.subjects[0] ?? "other"}.</p>
            </>
          ) : (
            <>
              {lines.decide.length > 0 && (
                <div className="skill-lines">
                  <span className="field-label">Decide</span>
                  <ul>{lines.decide.map((l, i) => <Line key={i} l={l} />)}</ul>
                </div>
              )}
              {lines.build.length > 0 && (
                <div className="skill-lines">
                  <span className="field-label">Build</span>
                  <ul>{lines.build.map((l, i) => <Line key={i} l={l} />)}</ul>
                </div>
              )}
            </>
          )}
          {(editing || v.edited) && (
            <div className="skill-use-row wrap">
              {editing && <button className="cover-btn" onClick={save} disabled={!dirty}>Save</button>}
              {editing && <button className="text-btn inline" onClick={() => { setDecide(v.carries?.decide ?? ""); setBuild(v.carries?.build ?? ""); setEditing(false); }}>Cancel</button>}
              {v.edited && !editing && <span className="skill-use-label">You changed what FRIDAY carries.</span>}
              {v.edited && <button className="text-btn inline" onClick={putBack}>Put back Panel's version</button>}
            </div>
          )}
        </div>
      )}

      {!v.own_parts && (checks.length > 0 || a.could_measure.length > 0) && (
        <div className="skill-checks">
          {checks.length > 0 && (
            <>
              <span className="skill-use-label">Panel checks every sketch for</span>
              <ul>
                {checks.map((c) => <li key={c.name}>{c.plain}{c.level === "breaks" && <span className="skill-must"> · must be fixed</span>}</li>)}
              </ul>
            </>
          )}
          {a.could_measure.length > 0 && (
            <>
              <span className="skill-use-label">Panel could check later</span>
              <ul className="skill-cant">
                {a.could_measure.map((c, i) => <li key={i}>{c.what}{c.value && `: ${c.value}`}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {a.look_for.length > 0 && (
        <div className="skill-checks">
          <span className="skill-use-label">For your eye</span>
          <ul className="skill-cant">{a.look_for.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      {a.conflicts.length > 0 && (
        <div className="skill-checks skill-conflicts">
          <span className="skill-use-label">Where it disagrees with your rules</span>
          <ul>
            {a.conflicts.map((c, i) => (
              <li key={i}>
                The skill says {c.skill_says} · Your rule ({c.rule}) says {c.rule_says} · <span className="skill-must">Left out of what FRIDAY carries.</span>
              </li>
            ))}
          </ul>
          <p className="skill-use-note">To go the skill's way, add the line to what FRIDAY carries with Edit, or change the rule in unugly.md.</p>
        </div>
      )}

      {v.points_to.length > 0 && (
        <p className="skill-use-note">
          It points to{" "}
          {v.points_to.map((p, i) => (
            <span key={p.name}>
              {i > 0 && ", "}
              {p.name} <span className="skill-cant">({p.id ? (p.on ? "in your library, on" : "in your library, off") : "not in your library"})</span>
            </span>
          ))}
        </p>
      )}

      {!busy && (
        confirmAgain ? (
          <div className="skill-use-row wrap">
            <span className="skill-use-note">A new read replaces your changes to what FRIDAY carries.</span>
            <button className="cover-btn" onClick={again}>Read again</button>
            <button className="text-btn inline" onClick={() => setConfirmAgain(false)}>Cancel</button>
          </div>
        ) : (
          <div className="skill-use-row wrap">
            <button className="text-btn inline" onClick={() => (v.edited ? setConfirmAgain(true) : again())}>Read again</button>
          </div>
        )
      )}
    </>
  );
}
