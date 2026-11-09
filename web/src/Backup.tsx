import { useEffect, useState } from "react";
import { api, formatBytes, type BackupStatus, type MeaningStatus } from "./api.ts";

/** "today", "yesterday", or the date. */
function when(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * In Library settings: the daily snapshot of the database and projects, and a second
 * place (another disk) that also gets the media.
 */
export function BackupSettings() {
  const [s, setS] = useState<BackupStatus | null>(null);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.backup().then((x) => { setS(x); setDir((d) => d || x.dir || ""); }).catch(() => {});
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  if (!s) return null;

  const run = async (p: Promise<BackupStatus>) => {
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
  const saveDir = () => {
    if (dir.trim() !== (s.dir ?? "")) void run(api.setBackupDir(dir.trim()));
  };

  return (
    <div className="reading-settings">
      <div className="reading-head">
        <h3>Backups</h3>
        <span className="muted">{s.snapshots ? `${s.snapshots} kept` : "none yet"}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>Last snapshot</dt>
          <dd title={s.folder}>{when(s.last)}{s.bytes ? ` · ${formatBytes(s.bytes)}` : ""}</dd>
        </div>
        <div>
          <dt>Also copy to</dt>
          <dd>
            <input
              className="cap-input backup-dir"
              value={dir}
              placeholder="a folder on another disk"
              aria-label="A second folder for backups"
              spellCheck={false}
              onChange={(e) => setDir(e.target.value)}
              onBlur={saveDir}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </dd>
        </div>
        {s.dir && (
          <div>
            <dt>Copied there</dt>
            <dd className="with-icon">
              <span className={`dot ${s.mirror_error || !s.dir_there ? "failed" : s.mirroring ? "pending" : "archived"}`} />
              {s.mirroring ? "copying…" : when(s.mirror_last)}
            </dd>
          </div>
        )}
      </dl>
      <button className="btn-wide" disabled={busy} onClick={() => run(api.backupNow())}>
        Take a snapshot now
      </button>
      <p className="muted reading-note">
        Once a day Panel keeps a copy of the database and your projects. The second folder also gets every saved file, so it survives this Mac's disk.
      </p>
      {(error || s.mirror_error) && <p className="read-error">{error ?? s.mirror_error}</p>}
    </div>
  );
}

/**
 * In Library settings: search by meaning and by look for FRIDAY and other AI apps. Two small
 * models that run on this Mac; nothing about the library leaves it.
 */
export function MeaningSettings() {
  const [s, setS] = useState<MeaningStatus | null>(null);
  useEffect(() => {
    const load = () => api.meaning().then(setS).catch(() => {});
    void load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);
  if (!s) return null;
  const fetching = s.on && (!s.meaning_ready || !s.look_ready);
  return (
    <div className="reading-settings">
      <div className="reading-head">
        <h3>Search by meaning and look</h3>
        <span className="muted">{!s.on ? "off" : fetching ? "getting ready…" : s.working ? "catching up…" : "on this Mac"}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>For FRIDAY and other AI apps</dt>
          <dd><input type="checkbox" checked={s.on} onChange={(e) => api.setMeaning(e.target.checked).then(setS).catch(() => {})} aria-label="Search by meaning and by look" /></dd>
        </div>
        {s.on && <div><dt>Ready by meaning</dt><dd>{s.by_meaning} of {s.saves}</dd></div>}
        {s.on && <div><dt>Ready by look</dt><dd>{s.by_look} of {s.saves}</dd></div>}
      </dl>
      <p className="muted reading-note">
        Finds saves that say the same thing in other words, in English or Russian, and saves that look like a description or like another save. The two models are fetched once (about 300 MB) and run on this Mac.
      </p>
    </div>
  );
}
