// Snapshots of the library, so a bad day (a damaged database, a migration gone wrong, a
// project deleted by mistake) can be undone. Once a day Panel keeps a copy of the database
// and of the projects folder (sketches, materials) in <library>/backups/<date>/. Media isn't
// copied there: the files never change once saved, and a removed save goes to the Trash.
//
// A second place (an external disk, a synced folder) can be set in Library settings: the
// newest snapshot and all the media are mirrored there, so the Mac's disk failing doesn't
// take the library with it.

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { LIBRARY_DIR, MEDIA_DIR } from "./config.ts";
import { db, getSetting, setSetting } from "./db.ts";

export const BACKUP_DIR = join(LIBRARY_DIR, "backups");
const PROJECTS_DIR = join(LIBRARY_DIR, "projects");

/** Today's date here (not in UTC), as the snapshot's folder name. */
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function snapshots(): string[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && existsSync(join(BACKUP_DIR, n, "library.sqlite"))).sort();
}

/** A folder copied without using more disk where the disk allows it (APFS clones), else copied plainly. */
async function copyFolder(from: string, to: string) {
  const cloned = await Bun.spawn(["cp", "-c", "-R", from, to], { stdout: "ignore", stderr: "ignore" }).exited;
  if (cloned !== 0) cpSync(from, to, { recursive: true });
}

/**
 * Keep the last 7 days, then one a week for two months. Anything older goes.
 * `names` are sorted oldest first.
 */
export function toDrop(names: string[]): string[] {
  const keep = new Set(names.slice(-7));
  const weeks = new Set<string>();
  for (const n of [...names].reverse()) {
    if (keep.has(n)) continue;
    const d = new Date(`${n}T12:00:00`);
    if (Date.now() - d.getTime() > 62 * 86_400_000) continue;
    // The newest snapshot of each week (weeks counted from a fixed Monday).
    const week = String(Math.floor((d.getTime() / 86_400_000 + 3) / 7));
    if (weeks.has(week)) continue;
    weeks.add(week);
    keep.add(n);
  }
  return names.filter((n) => !keep.has(n));
}

/** Take today's snapshot if there isn't one (or `force` a fresh one). Returns its folder. */
export async function snapshot(force = false): Promise<string> {
  const dir = join(BACKUP_DIR, day());
  if (existsSync(join(dir, "library.sqlite")) && !force) return dir;
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  // VACUUM INTO writes a whole, consistent database even while Panel is using it.
  db.run("VACUUM INTO ?", [join(tmp, "library.sqlite")]);
  const check = new Database(join(tmp, "library.sqlite"), { readonly: true });
  const ok = check.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check === "ok";
  check.close();
  if (!ok) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error("The snapshot of the database didn't pass its check, so it wasn't kept.");
  }
  if (existsSync(PROJECTS_DIR)) await copyFolder(PROJECTS_DIR, join(tmp, "projects"));
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  for (const old of toDrop(snapshots())) rmSync(join(BACKUP_DIR, old), { recursive: true, force: true });
  setSetting("backup_last", new Date().toISOString());
  return dir;
}

let mirroring = false;

/** Copy the newest snapshot and all the media to the second place, if one is set and there. */
export async function mirror(): Promise<void> {
  const to = getSetting("backup_dir");
  if (!to || mirroring) return;
  if (!existsSync(to)) {
    setSetting("backup_mirror_error", "The backup folder isn't there right now (is the disk connected?).");
    return;
  }
  const newest = snapshots().at(-1);
  if (!newest) return;
  mirroring = true;
  try {
    const root = join(to, "Panel backup");
    mkdirSync(root, { recursive: true });
    const run = async (args: string[]) => {
      const p = Bun.spawn(["rsync", "-a", ...args], { stdout: "ignore", stderr: "pipe" });
      const err = await new Response(p.stderr).text();
      if ((await p.exited) !== 0) throw new Error(err.trim().split("\n").pop() || "rsync failed");
    };
    // The trailing slashes: copy what's inside each folder into the folder of the same name.
    await run(["--delete", `${join(BACKUP_DIR, newest)}/`, `${join(root, "snapshot")}/`]);
    await run([`${MEDIA_DIR}/`, `${join(root, "media")}/`]);
    setSetting("backup_mirror_last", new Date().toISOString());
    setSetting("backup_mirror_error", "");
  } catch (e) {
    setSetting("backup_mirror_error", (e as Error).message.slice(0, 300));
  } finally {
    mirroring = false;
  }
}

export function backupStatus() {
  const all = snapshots();
  const newest = all.at(-1);
  let bytes = 0;
  try {
    if (newest) bytes = statSync(join(BACKUP_DIR, newest, "library.sqlite")).size;
  } catch {
    /* gone meanwhile */
  }
  const dir = getSetting("backup_dir") || null;
  return {
    snapshots: all.length,
    newest: newest ?? null,
    last: getSetting("backup_last"),
    bytes,
    folder: BACKUP_DIR,
    /** The second place, if set. */
    dir,
    dir_there: dir ? existsSync(dir) : false,
    mirror_last: getSetting("backup_mirror_last"),
    mirror_error: getSetting("backup_mirror_error") || null,
    mirroring,
  };
}

/** Set (or clear, with "") the second place. It has to be a folder that exists. */
export function setBackupDir(path: string) {
  const clean = path.trim().replace(/^~(?=\/|$)/, process.env.HOME ?? "~");
  if (clean && (!clean.startsWith("/") || !existsSync(clean) || !statSync(clean).isDirectory())) throw new Error("That folder doesn't exist. Give its full path, e.g. /Volumes/SSD.");
  if (clean && (clean === LIBRARY_DIR || clean.startsWith(`${LIBRARY_DIR}/`))) throw new Error("Pick a folder outside the library, ideally on another disk.");
  setSetting("backup_dir", clean);
  setSetting("backup_mirror_error", "");
}

async function daily() {
  try {
    await snapshot();
    await mirror();
  } catch (e) {
    console.error("Backup:", (e as Error).message);
  }
}

/** A snapshot soon after Panel starts, then a look every hour for a new day. */
export function startBackups() {
  setTimeout(() => void daily(), 20_000);
  setInterval(() => void daily(), 3_600_000);
}
