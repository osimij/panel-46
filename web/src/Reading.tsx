import { useEffect, useState } from "react";
import { api, type DesignRead, type Measured, type Profile, type ReadingStatus, type Ref, type Swatch } from "./api.ts";
import { Icon } from "./Icon.tsx";

const cents = (usd: number) => (usd < 0.01 ? "<1¢" : usd < 1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`);
const dollars = (usd: number) => `$${usd < 10 ? usd.toFixed(2) : Math.round(usd)}`;
/** Before any read has been measured, a cautious guess at Sonnet 5.5 full price. */
const perRead = (s: ReadingStatus | null) => s?.per_read?.cost ?? 0.04;

/** Reads go through the Claude subscription (no money per read) or an API key. */
const viaPlan = (s: ReadingStatus | null) => s?.provider === "claude-code";
const canRead = (s: ReadingStatus | null) => !!s && (viaPlan(s) ? s.claude_code : s.key);
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** Can this reference be read at all? Skills and bare profiles have no pictures. */
export const readable = (r: Ref) => r.kind !== "skill" && r.kind !== "account" && (r.status === "archived" || (r.status === "link_only" && !!r.preview_url));

// ---------- In the detail panel ----------

export function DesignReadField({ r, reload }: { r: Ref; reload: () => Promise<void> }) {
  const [status, setStatus] = useState<ReadingStatus | null>(null);
  const [showSeen, setShowSeen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = r.read ?? null;
  const waiting = read?.state === "queued" || read?.state === "sent";

  useEffect(() => {
    api.ai().then(setStatus).catch(() => {});
  }, []);

  // While it's being read, check back: quickly for "Read now", slowly for a batch.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reload, read?.mode === "batch" ? 30_000 : 3000);
    return () => clearInterval(t);
  }, [waiting, read?.mode, reload]);

  const ask = async (mode: "now" | "batch") => {
    setError(null);
    try {
      await api.aiRead({ ids: [r.id], mode });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const p = read?.profile ?? null;
  const est = perRead(status);

  return (
    <section className="field read-field">
      <div className="field-label">
        Design read
        {read?.state === "done" && (
          <span className="read-meta" title={read.read_at ? `Read ${new Date(read.read_at).toLocaleString()}` : undefined}>
            {read.model_label}{read.mode === "subscription" ? " · Claude plan" : read.cost != null ? ` · ${cents(read.cost)}` : ""}
          </span>
        )}
      </div>

      {waiting && (
        <p className="read-wait">
          <span className="dot pending" />
          {read!.mode !== "batch" || viaPlan(status) ? "Reading…" : read!.state === "queued" ? "Waiting for the next batch" : "In a batch at Anthropic, usually back within the hour"}
        </p>
      )}
      {read?.state === "failed" && <p className="read-error">{read.error}</p>}
      {error && <p className="read-error">{error}</p>}

      {status && !canRead(status) && !p && (
        <p className="read-hint">{viaPlan(status) ? "Install Claude Code to read references with your Claude plan." : "Add an Anthropic API key in Library settings to read references."}</p>
      )}

      {p && <ProfileView p={p} read={read!} />}
      {r.measured && <MeasuredView m={r.measured} />}

      {canRead(status) && !waiting && (
        <div className="read-actions">
          <button
            className="text-btn"
            onClick={() => ask("now")}
            title={viaPlan(status) ? "Through Claude Code, on your Claude plan. About half a minute" : "Full price, back in about half a minute"}
          >
            <Icon name="eye" size={13} /> {p ? "Read again" : "Read now"} {!viaPlan(status) && <span className="read-cost">~{cents(est)}</span>}
          </button>
          {!p && !viaPlan(status) && (
            <button className="text-btn muted" onClick={() => ask("batch")} title="Half price, back within the hour (24 hours at most)">
              Next batch <span className="read-cost">~{cents(est / 2)}</span>
            </button>
          )}
          {read?.visuals.length ? (
            <button className="text-btn muted read-seen-btn" onClick={() => setShowSeen(!showSeen)} aria-expanded={showSeen}>
              What it saw
            </button>
          ) : null}
        </div>
      )}
      {showSeen && read && (
        <div className="read-seen">
          {read.visuals.map((v) => (
            <a key={v.url} href={v.url} target="_blank" rel="noreferrer" title={v.label}>
              <img src={v.url} alt={v.label} loading="lazy" />
              <span>{v.label}</span>
            </a>
          ))}
          {read.video && (
            <p className="read-hint">
              {read.video.cuts} cut{read.video.cuts === 1 ? "" : "s"} in the first {read.video.seconds_checked}s
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** A site as measured in the page: facts, where the read's fonts are guesses from pictures. */
function MeasuredView({ m }: { m: Measured }) {
  const letters = (f: Measured["fonts"][number]) => (f.tajik ? "Cyrillic and Tajik" : f.cyrillic ? "Cyrillic, no Tajik letters" : "Latin only");
  const weights = (w: number[]) => (w.length > 1 ? `${w[0]}–${w.at(-1)}` : String(w[0] ?? ""));
  return (
    <div className="read-measured">
      <div className="read-take-label">Measured in the page</div>
      <dl className="read-rows">
        <div>
          <dt>Fonts</dt>
          <dd>
            {m.fonts.map((f) => (
              <span key={f.family} className="measured-font">
                {f.family}
                <span className="read-bits">{[f.role === "both" ? "headings and text" : f.role, weights(f.weights), letters(f)].filter(Boolean).join(" · ")}</span>
              </span>
            ))}
          </dd>
        </div>
        {m.sizes.length > 0 && (
          <div>
            <dt>Sizes</dt>
            <dd>{[...m.sizes].sort((a, b) => b - a).join(", ")} px</dd>
          </div>
        )}
        {m.radii.length > 0 && (
          <div>
            <dt>Corners</dt>
            <dd>
              {m.radii.join(", ")} px
              {m.smooth_corners && <span className="read-bits">with corner smoothing</span>}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * The measured colors as one bar, each as wide as its share. Hovering never changes any
 * widths (that made the bar jump under the cursor): the color you point at stays lit, the
 * rest dim, and the line below names it. Click copies the hex.
 */
function Swatches({ palette, role, copied, copy }: {
  palette: Swatch[];
  role: (hex: string) => string | undefined;
  copied: string | null;
  copy: (hex: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = palette.reduce((a, s) => a + Math.max(s.share, 0.04), 0);
  const s = active !== null ? palette[active] : undefined;
  return (
    <div className="swatch-wrap">
      <div className={`swatches ${active !== null ? "has-active" : ""}`} role="list" aria-label="Measured colors" onMouseLeave={() => setActive(null)}>
        {palette.map((c, i) => (
          <button
            key={c.hex}
            role="listitem"
            className={`swatch ${active === i ? "active" : ""}`}
            style={{ background: c.hex, flexGrow: Math.max(c.share, 0.04) / total }}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={() => copy(c.hex)}
            aria-label={`${c.hex}, ${c.name}, ${Math.round(c.share * 100)}%. Copy`}
          />
        ))}
      </div>
      <div className="swatch-info" aria-live="polite">
        {s ? (
          <span key={s.hex} className="swatch-line">
            <i style={{ background: s.hex }} />
            <code>{s.hex}</code>
            <span>{copied === s.hex ? "Copied" : s.name}</span>
            <span className="faint">{Math.round(s.share * 100)}%{role(s.hex) ? ` · ${role(s.hex)}` : ""}</span>
          </span>
        ) : (
          <span className="swatch-line faint">{palette.length} colors measured from the pixels · click one to copy</span>
        )}
      </div>
    </div>
  );
}

function ProfileView({ p, read }: { p: Profile; read: DesignRead }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (hex: string) => {
    void navigator.clipboard?.writeText(hex);
    setCopied(hex);
    setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1200);
  };
  const role = (hex: string) => p.color?.roles?.find((x) => x.hex.toLowerCase() === hex.toLowerCase())?.role;
  const typeBits = [...(p.typography?.classification ?? []), ...(p.typography?.likely_fonts ?? []).map((f) => `maybe ${f}`)];
  const rows: [string, string | undefined, string[]?][] = [
    ["Type", p.typography?.present ? p.typography.summary : undefined, typeBits],
    ["Layout", p.layout?.summary, p.layout?.notable],
    ["Color", p.color?.summary],
    ["Motion", p.motion?.present ? p.motion.summary : undefined, p.motion?.techniques],
    ["Imagery", p.imagery?.summary || undefined, p.imagery?.style],
  ];

  return (
    <div className="read-body">
      {p.summary && <p className="read-summary">{p.summary}</p>}

      {read.palette.length > 0 && <Swatches palette={read.palette} role={role} copied={copied} copy={copy} />}

      {!!p.mood?.length && (
        <div className="read-pills">
          {p.mood.map((m) => <span key={m} className="pill">{m}</span>)}
        </div>
      )}

      <dl className="read-rows">
        {rows.filter(([, text]) => text).map(([label, text, bits]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {text}
              {!!bits?.length && <span className="read-bits">{bits.join(" · ")}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {!!p.worth_taking?.length && (
        <div className="read-take">
          <div className="read-take-label">Worth taking</div>
          <ul>{p.worth_taking.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}

      {p.limits && <p className="read-hint">{p.limits}</p>}
    </div>
  );
}

// ---------- In Library settings ----------

export function ReadingSettings() {
  const [s, setS] = useState<ReadingStatus | null>(null);
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.ai().then((x) => { setS(x); setCap((c) => c || String(x.cap)); }).catch(() => {});
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  if (!s) return null;

  const run = async (p: Promise<ReadingStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setS(await p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const waiting = s.queued + s.sent;
  const plan = viaPlan(s);
  const batchEach = perRead(s) / (s.per_read ? 1 : 2);
  const first = s.done === 0 && waiting === 0;

  return (
    <div className="reading-settings">
      <div className="reading-head">
        <h3>Design reads</h3>
        <span className="muted">{s.models.find((m) => m.id === s.model)?.label}</span>
      </div>

      <dl className="facts">
        <div>
          <dt>Reads through</dt>
          <dd>
            <select className="model-select" value={s.provider} onChange={(e) => run(api.aiSettings({ provider: e.target.value as ReadingStatus["provider"] }))}>
              <option value="claude-code">Claude plan (Claude Code)</option>
              <option value="api">API key, in batches</option>
            </select>
          </dd>
        </div>
      </dl>

      {plan && !s.claude_code ? (
        <div className="read-key">
          <p>Reading with your Claude plan needs Claude Code’s command line on this Mac.</p>
        </div>
      ) : !plan && !s.key ? (
        <div className="read-key">
          <p>To let Panel read your references, add your Anthropic API key to the Keychain. Run this in Terminal and paste the key when it asks:</p>
          <code>security add-generic-password -s "Panel Anthropic API key" -a panel -w</code>
          <p className="muted">Panel picks it up within a minute.</p>
        </div>
      ) : (
        <>
          <dl className="facts">
            <div><dt>Read</dt><dd>{s.done} of {s.done + s.unread + waiting + s.failed}</dd></div>
            {waiting > 0 && <div><dt>Being read</dt><dd className="with-icon"><span className="dot pending" />{waiting}</dd></div>}
            {s.failed > 0 && <div><dt>Couldn’t read</dt><dd className="with-icon"><span className="dot failed" />{s.failed}</dd></div>}
            {plan && s.subscription_reads > 0 && <div><dt>Read with your plan</dt><dd>{s.subscription_reads}</dd></div>}
            {!plan && s.per_read && (
              <div>
                <dt>Per read, measured</dt>
                <dd title={`${s.per_read.input_tokens.toLocaleString()} tokens in, ${s.per_read.output_tokens.toLocaleString()} out, on average over ${s.per_read.reads} reads`}>
                  {cents(s.per_read.cost)}
                </dd>
              </div>
            )}
            {!plan && <div>
              <dt>This month</dt>
              <dd>
                {dollars(s.spent_this_month)} of $
                <input
                  className="cap-input"
                  value={cap}
                  inputMode="decimal"
                  aria-label="Monthly budget in dollars"
                  onChange={(e) => setCap(e.target.value)}
                  onBlur={() => Number(cap) >= 0 && Number(cap) !== s.cap && run(api.aiSettings({ cap: Number(cap) }))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
              </dd>
            </div>}
            <div>
              <dt>Model</dt>
              <dd>
                <select className="model-select" value={s.model} onChange={(e) => run(api.aiSettings({ model: e.target.value }))}>
                  {s.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt>Thinking</dt>
              <dd>
                <select className="model-select" value={s.effort} onChange={(e) => run(api.aiSettings({ effort: e.target.value as ReadingStatus["effort"] }))}>
                  {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt>Read new saves by themselves</dt>
              <dd>
                <input type="checkbox" checked={s.auto} onChange={(e) => run(api.aiSettings({ auto: e.target.checked }))} aria-label="Read new saves by themselves" />
              </dd>
            </div>
          </dl>

          {s.unread > 0 && plan && (
            <button className="btn-wide" disabled={busy} onClick={() => run(api.aiRead({ limit: s.unread, mode: "now" }))}>
              Read all {s.unread} with your Claude plan
            </button>
          )}
          {s.unread > 0 && !plan && (
            first ? (
              <button className="btn-wide" disabled={busy} onClick={() => run(api.aiRead({ limit: 10, mode: "batch" }))}>
                Read 10 to test · ~{cents(batchEach * 10)}
              </button>
            ) : (
              <button className="btn-wide" disabled={busy} onClick={() => run(api.aiRead({ limit: s.unread, mode: "batch" }))}>
                Read the other {s.unread} · ~{dollars(batchEach * s.unread)}
              </button>
            )
          )}
          <p className="muted reading-note">
            {plan
              ? "Each read uses a little of your Claude plan’s usage limit, a few at a time, about half a minute each."
              : "Batches cost half and come back within the hour, 24 hours at most."}
          </p>
        </>
      )}
      {(error || (canRead(s) && s.problem)) && <p className="read-error">{error ?? s.problem}</p>}
    </div>
  );
}
