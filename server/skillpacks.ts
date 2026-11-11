// Skills that come as a pack: a GitHub project, or a folder from this Mac, with one folder per
// skill (a SKILL.md, sometimes more Markdown beside it, sometimes scripts and settings for
// other tools). The designer pastes a link or drops a folder, sees the skills Panel found,
// picks the ones they want, and they arrive together, remembering where they came from.
//
// A skill is text, never a program. Panel keeps a skill's text files (Markdown and plain text)
// and nothing else. Scripts, settings, pictures and anything else are never kept, run, imported
// or opened: Panel remembers only their names and sizes, to show what was left out.
//
// The skill itself stays a save with kind = 'skill' and its SKILL.md in refs.text, so
// everything that already reads skills (skills.ts, skilluse.ts, search) keeps working. Its other
// files are in skill_files. Every skill arrives off: nothing reaches FRIDAY until the designer
// turns it on (skill_use).
//
// Panel reaches the internet here only when the designer asks (looking at a link, adding,
// checking for a newer version), and only api.github.com and raw.githubusercontent.com, with no
// sign-in and nothing about the designer in the request. GitHub allows 60 lookups an hour
// without signing in; one look costs about three (the project, its version, its list of files).
// File contents come from raw.githubusercontent.com, which isn't counted. Everything is read
// at one exact version (a commit), so what the designer sees is what is added.
//
// The tables are only ever added to the library, never changed in place, so a Panel still on
// older code works beside them.

import { createHash } from "node:crypto";
import { db, newId, now, refreshStatus, reindex } from "./db.ts";
import { parseSkill } from "./skills.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS skill_packs (
  id TEXT PRIMARY KEY,
  -- github · folder
  source TEXT NOT NULL,
  -- What it is, to know it again: "github:owner/name" or "folder:<folder name>".
  pack_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- The project's page on GitHub (or the folder in it that was linked); NULL for a folder.
  url TEXT,
  owner TEXT,
  repo TEXT,
  -- The folder inside the project the skills were looked for in ('' for all of it).
  path TEXT NOT NULL DEFAULT '',
  -- The branch it follows, for checking for a newer version.
  branch TEXT,
  author TEXT,
  -- The exact version: the commit and its date (for a folder, its newest file's date).
  commit_sha TEXT,
  commit_date TEXT,
  license_name TEXT,
  -- The project's licence file, as written: other people's work keeps its notice.
  license_text TEXT,
  added_at TEXT NOT NULL,
  checked_at TEXT
);

-- Which pack a skill came from, and where in it.
CREATE TABLE IF NOT EXISTS skill_pack_skills (
  ref_id TEXT PRIMARY KEY REFERENCES refs(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES skill_packs(id) ON DELETE CASCADE,
  -- Its folder inside the project ('' when the SKILL.md is at the top).
  folder TEXT NOT NULL,
  -- The version its files are from.
  commit_sha TEXT,
  commit_date TEXT,
  -- What its folder held, to tell later whether it changed.
  digest TEXT NOT NULL,
  -- 1: no longer in the project at the last update. It is kept.
  gone INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- A skill's files other than SKILL.md, by their path inside its folder. text is the file for
-- a kept one; for one left out it is NULL and why says why (script, settings, picture, other,
-- big, many). Only the name and size of a left-out file are known.
CREATE TABLE IF NOT EXISTS skill_files (
  ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  text TEXT,
  why TEXT,
  PRIMARY KEY (ref_id, path)
);
`);

// ---------- What is kept ----------

/** A file over this size is left out. */
export const MAX_FILE = 300 * 1024;
/** A skill keeps at most this many files, its SKILL.md among them. */
export const MAX_FILES = 40;

export type Why = "script" | "settings" | "picture" | "other" | "big" | "many";

const TEXT_EXT = /\.(md|markdown|mdx|txt)$/i;
// Plain text files with no extension that projects carry beside their Markdown.
const TEXT_NAME = /^(licen[cs]e|notice|copying|authors|readme)$/i;
const SCRIPT_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|py|sh|bash|zsh|rb|go|rs|php|pl|lua|swift|java|kt|c|h|cpp|ps1|bat|cmd|applescript|wasm|exe)$/i;
const SETTINGS_EXT = /\.(json|jsonc|ya?ml|toml|ini|cfg|conf|env|lock|xml|plist|properties)$/i;
const PICTURE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|heic|ico|bmp|tiff?|mp4|mov|webm)$/i;

const base = (p: string) => p.split("/").pop() ?? p;
/** Whether a file is text Panel would keep, by its name alone. */
export const isTextName = (p: string) => TEXT_EXT.test(p) || TEXT_NAME.test(base(p));
/** What kind of file one that is left out is, by its name. */
function kindOf(p: string): Why {
  const b = base(p);
  if (SCRIPT_EXT.test(b)) return "script";
  if (SETTINGS_EXT.test(b) || b.startsWith(".")) return "settings";
  if (PICTURE_EXT.test(b)) return "picture";
  return "other";
}

const WHY_WORDS: Record<Why, [string, string]> = {
  script: ["script", "scripts"],
  settings: ["settings file", "settings files"],
  picture: ["picture", "pictures"],
  other: ["other file", "other files"],
  big: ["file over 300 KB", "files over 300 KB"],
  many: ["file past the 40-file limit", "files past the 40-file limit"],
};
/** "2 scripts and 1 settings file not kept", or "" when nothing was left out. */
export function leftOutLine(left: { why: Why }[]) {
  const n = new Map<Why, number>();
  for (const f of left) n.set(f.why, (n.get(f.why) ?? 0) + 1);
  const parts = [...n].map(([w, k]) => `${k} ${WHY_WORDS[w][k === 1 ? 0 : 1]}`);
  if (!parts.length) return "";
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} not kept`;
}

// In KB, at least 1: "3 files, 28 KB".
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ---------- Finding the skills in a list of files ----------

/** A file in a project: its path from the project's top, its size, and its text when Panel has it. */
export interface ProjectFile {
  path: string;
  bytes: number;
  /** GitHub's id for its contents; changes when the file does. */
  sha?: string;
  text?: string;
}

/** One skill found in a project, as the chooser shows it. */
export interface FoundSkill {
  folder: string;
  name: string;
  line: string;
  /** Kept files (SKILL.md first), by their path inside the folder. */
  kept: { path: string; bytes: number }[];
  bytes: number;
  leftOut: { path: string; bytes: number; why: Why }[];
  /** "3 files, 28 KB" */
  size: string;
  /** "2 scripts not kept", or "". */
  leftOutLine: string;
  digest: string;
  /** Why it can't be added, when it can't. */
  problem?: string;
  /** The skill already in the library from this pack, and whether it is the same. */
  have?: { id: string; same: boolean; gone: boolean };
}

const isSkillFile = (p: string) => /^skill\.md$/i.test(base(p));
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const under = (p: string, folder: string) => !folder || p.startsWith(`${folder}/`);
const inside = (p: string, folder: string) => (folder ? p.slice(folder.length + 1) : p);

/**
 * Every skill in a list of files: any folder holding a SKILL.md (any letter case), under
 * `path`. A skill's files are everything under its folder that isn't in a deeper skill's.
 */
export function findSkills(files: ProjectFile[], path = ""): { folder: string; skillPath: string; files: ProjectFile[] }[] {
  const scoped = files.filter((f) => under(f.path, path) || f.path === path);
  const folders = [...new Set(scoped.filter((f) => isSkillFile(f.path)).map((f) => dirOf(f.path)))].sort();
  return folders.map((folder) => {
    const deeper = folders.filter((o) => o !== folder && under(o, folder) && o.length > folder.length);
    const own = scoped.filter((f) => under(f.path, folder) && !deeper.some((d) => under(f.path, d)));
    const skillPath = own.find((f) => dirOf(f.path) === folder && isSkillFile(f.path))!.path;
    return { folder, skillPath, files: own };
  });
}

/** Which of a skill's files are kept, which are left out and why: text up to 300 KB, at most 40. */
export function sortFiles(files: ProjectFile[], folder: string, skillPath: string) {
  const kept: ProjectFile[] = [];
  const leftOut: { path: string; bytes: number; why: Why }[] = [];
  const rel = (f: ProjectFile) => inside(f.path, folder);
  const ordered = [...files].sort((a, b) => (a.path === skillPath ? -1 : b.path === skillPath ? 1 : rel(a).localeCompare(rel(b))));
  for (const f of ordered) {
    const path = rel(f);
    const looksText = isTextName(f.path) && (f.text === undefined || !f.text.includes("\u0000"));
    if (!looksText) leftOut.push({ path, bytes: f.bytes, why: kindOf(f.path) });
    else if (f.bytes > MAX_FILE) leftOut.push({ path, bytes: f.bytes, why: "big" });
    else if (kept.length >= MAX_FILES) leftOut.push({ path, bytes: f.bytes, why: "many" });
    else kept.push(f);
  }
  return { kept, leftOut };
}

/** What a skill's folder holds, as one short hash: changes when any of its files does. */
const digestOf = (files: ProjectFile[]) =>
  createHash("sha1")
    .update(files.map((f) => `${f.path}\u0000${f.sha ?? (f.text !== undefined ? createHash("sha1").update(f.text).digest("hex") : `size:${f.bytes}`)}`).sort().join("\n"))
    .digest("hex")
    .slice(0, 16);

/** One skill as the chooser shows it. `skillText`: its SKILL.md. */
function describeFound(folder: string, skillPath: string, files: ProjectFile[], skillText: string | undefined, have: Map<string, { id: string; digest: string; gone: number }>): FoundSkill {
  const { kept, leftOut } = sortFiles(files, folder, skillPath);
  const bytes = kept.reduce((a, f) => a + f.bytes, 0);
  const fallback = base(folder) || "Untitled skill";
  const parsed = skillText !== undefined ? parseSkill(skillText, fallback) : null;
  const digest = digestOf(files);
  const mine = have.get(folder);
  const main = files.find((f) => f.path === skillPath)!;
  const problem =
    main.bytes > MAX_FILE ? "Its SKILL.md is over 300 KB, too big to keep."
    : skillText === undefined ? "Its SKILL.md couldn't be read."
    : skillText.includes("\u0000") ? "Its SKILL.md isn't plain text."
    : undefined;
  return {
    folder,
    name: parsed?.name ?? fallback,
    line: parsed?.line ?? "",
    kept: kept.map((f) => ({ path: inside(f.path, folder), bytes: f.bytes })),
    bytes,
    leftOut,
    size: `${kept.length} file${kept.length === 1 ? "" : "s"}, ${kb(bytes)}`,
    leftOutLine: leftOutLine(leftOut),
    digest,
    ...(problem ? { problem } : {}),
    ...(mine ? { have: { id: mine.id, same: mine.digest === digest, gone: mine.gone === 1 } } : {}),
  };
}

// ---------- GitHub ----------

/** A failure the designer should read as it is. `retry`: when GitHub says to try again. */
export class PackError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// Replaceable in tests, so tests never touch the internet.
const API = () => (process.env.PANEL_GITHUB_API ?? "https://api.github.com").replace(/\/$/, "");
const RAW = () => (process.env.PANEL_GITHUB_RAW ?? "https://raw.githubusercontent.com").replace(/\/$/, "");
// Nothing about the designer: GitHub only asks that a request name the app.
const HEADERS = { accept: "application/vnd.github+json", "user-agent": "Panel" };

export interface GithubLink {
  owner: string;
  repo: string;
  /** What follows /tree/ in the link: a branch (which may hold slashes) and a folder. */
  rest: string[];
}

/** A GitHub project, or a folder in one: github.com/owner/name[/tree/branch/path], with or without https://. */
export function parseGithubLink(input: string): GithubLink | null {
  let t = input.trim();
  if (!/^[a-z]+:\/\//i.test(t)) t = `https://${t}`;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts.length < 2) return null;
  const [owner, repoRaw, kind, ...rest] = parts;
  const repo = repoRaw!.replace(/\.git$/i, "");
  if (!/^[\w.-]{1,100}$/.test(owner!) || !/^[\w.-]{1,100}$/.test(repo)) return null;
  if (kind === undefined) return { owner: owner!, repo, rest: [] };
  if (kind === "tree" && rest.length) return { owner: owner!, repo, rest };
  return null;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** One question to GitHub's API, with its failures in plain words. Null for "not found" when `missingOk`. */
async function ask<T>(path: string, missingOk = false): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(API() + path, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new PackError(`Couldn't reach GitHub: ${(e as Error).message}`, 502);
  }
  if (res.ok) return (await res.json()) as T;
  const left = res.headers.get("x-ratelimit-remaining");
  if ((res.status === 403 || res.status === 429) && (left === "0" || res.headers.get("retry-after"))) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000 || Date.now() + Number(res.headers.get("retry-after") ?? 60) * 1000;
    const at = new Date(reset).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    throw new PackError(`GitHub asks Panel to wait: it allows 60 lookups an hour without signing in. Try again after ${at}.`, 429);
  }
  if (res.status === 404 || res.status === 422) {
    if (missingOk) return null;
    throw new PackError("That project isn't public, or doesn't exist.", 404);
  }
  throw new PackError(`GitHub answered with an error (HTTP ${res.status}). Try again in a moment.`, 502);
}

/** A file's text at one exact version, from raw.githubusercontent.com (not counted against the hourly limit). */
async function raw(owner: string, repo: string, sha: string, path: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${RAW()}/${enc(owner)}/${enc(repo)}/${sha}/${enc(path)}`, { headers: { "user-agent": "Panel" }, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new PackError(`Couldn't download ${path} from GitHub: ${(e as Error).message}`, 502);
  }
  if (!res.ok) throw new PackError(`Couldn't download ${path} from GitHub (HTTP ${res.status}).`, 502);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_FILE) throw new PackError(`${path} is over 300 KB.`, 400);
  return new TextDecoder().decode(buf);
}

/** At most `n` at a time. */
async function inTurns<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]!);
    }
  }));
  return out;
}

/** A project at one exact version: everything a look needs. Kept in memory, since a version never changes. */
interface Snapshot {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  author: string;
  sha: string;
  date: string;
  licenseName: string | null;
  licenseText: string | null;
  files: ProjectFile[];
  /** Each skill's SKILL.md, by its path. */
  skillText: Map<string, string>;
  truncated: boolean;
}
const snapshots = new Map<string, Snapshot>();
const snapKey = (o: string, r: string, sha: string, path: string) => `${o}/${r}@${sha}:${path}`.toLowerCase();

interface RepoInfo { default_branch: string; owner: { login: string }; license: { name: string; spdx_id: string } | null; full_name: string }
interface CommitInfo { sha: string; commit: { committer?: { date: string }; author?: { date: string } } }
interface TreeInfo { truncated: boolean; tree: { path: string; type: string; size?: number; sha: string }[] }

/** Read a project at the version of `ref` (a branch, or an exact commit), and every SKILL.md under `path`. */
async function readProject(owner: string, repo: string, rest: string[], at?: { sha: string; branch: string; path: string }): Promise<Snapshot> {
  if (at) {
    const known = snapshots.get(snapKey(owner, repo, at.sha, at.path));
    if (known) return known;
  }
  const info = (await ask<RepoInfo>(`/repos/${enc(owner)}/${enc(repo)}`))!;
  let branch = info.default_branch;
  let path = "";
  let commit: CommitInfo | null = null;
  if (at) {
    commit = await ask<CommitInfo>(`/repos/${enc(owner)}/${enc(repo)}/commits/${at.sha}`);
    branch = at.branch;
    path = at.path;
  } else if (rest.length) {
    // A branch's name may hold slashes: try the shortest first.
    for (let i = 1; i <= rest.length && !commit; i++) {
      commit = await ask<CommitInfo>(`/repos/${enc(owner)}/${enc(repo)}/commits/${encodeURIComponent(rest.slice(0, i).join("/"))}`, true);
      if (commit) {
        branch = rest.slice(0, i).join("/");
        path = rest.slice(i).join("/");
      }
    }
    if (!commit) throw new PackError("That branch or folder isn't in the project.", 404);
  } else {
    commit = await ask<CommitInfo>(`/repos/${enc(owner)}/${enc(repo)}/commits/${encodeURIComponent(branch)}`);
  }
  const sha = commit!.sha;
  const date = commit!.commit.committer?.date ?? commit!.commit.author?.date ?? "";
  const known = snapshots.get(snapKey(owner, repo, sha, path));
  if (known) return known;
  const tree = (await ask<TreeInfo>(`/repos/${enc(owner)}/${enc(repo)}/git/trees/${sha}?recursive=1`))!;
  const files: ProjectFile[] = tree.tree
    .filter((e) => e.type === "blob" && !e.path.split("/").some((s) => s === "node_modules" || s === ".git"))
    .map((e) => ({ path: e.path, bytes: e.size ?? 0, sha: e.sha }));
  if (path && !files.some((f) => under(f.path, path))) throw new PackError("That folder isn't in the project.", 404);
  const skills = findSkills(files, path);
  const skillText = new Map<string, string>();
  await inTurns(skills.filter((s) => (files.find((f) => f.path === s.skillPath)?.bytes ?? 0) <= MAX_FILE), 6, async (s) => {
    try {
      skillText.set(s.skillPath, await raw(owner, repo, sha, s.skillPath));
    } catch {
      /* shown as "couldn't be read" */
    }
  });
  const lic = files.find((f) => !f.path.includes("/") && /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f.path));
  let licenseText: string | null = null;
  if (lic && lic.bytes <= MAX_FILE) licenseText = await raw(owner, repo, sha, lic.path).catch(() => null);
  const snap: Snapshot = {
    owner: info.owner.login || owner,
    repo: info.full_name?.split("/")[1] ?? repo,
    branch,
    path,
    author: info.owner.login || owner,
    sha,
    date,
    licenseName: info.license && info.license.spdx_id !== "NOASSERTION" ? info.license.name : licenseText ? licenseName(licenseText) : null,
    licenseText,
    files,
    skillText,
    truncated: tree.truncated,
  };
  if (snapshots.size > 50) snapshots.delete(snapshots.keys().next().value!);
  snapshots.set(snapKey(owner, repo, sha, path), snap);
  return snap;
}

// ---------- A folder from this Mac ----------

/** A dropped folder, as the browser read it: its name, and its files with their paths inside it (text for text files). */
export interface DroppedFolder {
  name: string;
  files: { path: string; bytes: number; text?: string; modified?: number }[];
}

/** Check what the browser sent: plain paths inside the folder, sizes, and text only where Panel keeps text. */
function cleanFolder(input: unknown): DroppedFolder {
  const f = input as DroppedFolder;
  if (!f || typeof f.name !== "string" || !Array.isArray(f.files)) throw new PackError("That folder couldn't be read.");
  const name = f.name.replace(/[/\\]/g, "").trim().slice(0, 200) || "Folder";
  let total = 0;
  const files = f.files.slice(0, 5000).flatMap((x) => {
    if (!x || typeof x.path !== "string" || typeof x.bytes !== "number") return [];
    const path = x.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path || path.split("/").some((s) => s === ".." || s === "." || s === "" || s === "node_modules" || s === ".git")) return [];
    let text = typeof x.text === "string" && isTextName(path) ? x.text : undefined;
    // The size Panel judges by is the text's own, not what the browser said.
    const bytes = text !== undefined ? new TextEncoder().encode(text).length : Math.max(0, Math.round(x.bytes));
    if (bytes > MAX_FILE) text = undefined;
    total += text?.length ?? 0;
    return [{ path, bytes, ...(text !== undefined ? { text } : {}), ...(typeof x.modified === "number" ? { modified: x.modified } : {}) }];
  });
  if (total > 40 * 1024 * 1024) throw new PackError("That folder holds too much text to read at once.");
  return { name, files };
}

/** A licence's name from the top of its file ("MIT License"), else a pointer to the file. */
function licenseName(text: string | undefined) {
  const first = text?.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  return first.length <= 60 && /licen[cs]e/i.test(first) ? first : "See its licence file";
}

// ---------- What the library already has ----------

interface PackRow {
  id: string; source: "github" | "folder"; pack_key: string; name: string; url: string | null; owner: string | null; repo: string | null;
  path: string; branch: string | null; author: string | null; commit_sha: string | null; commit_date: string | null;
  license_name: string | null; license_text: string | null; added_at: string; checked_at: string | null;
}

const packByKey = (key: string) => db.query<PackRow, [string]>("SELECT * FROM skill_packs WHERE pack_key = ?").get(key);
const packById = (id: string) => db.query<PackRow, [string]>("SELECT * FROM skill_packs WHERE id = ?").get(id);
/** The skills a pack has in the library, by folder. */
function haveIn(packId: string | undefined) {
  const out = new Map<string, { id: string; digest: string; gone: number }>();
  if (!packId) return out;
  for (const r of db.query<{ ref_id: string; folder: string; digest: string; gone: number }, [string]>("SELECT ref_id, folder, digest, gone FROM skill_pack_skills WHERE pack_id = ?").all(packId))
    out.set(r.folder, { id: r.ref_id, digest: r.digest, gone: r.gone });
  return out;
}

// ---------- Looking: what could be added, without saving anything ----------

/** What the chooser shows: the pack, and the skills found in it. */
export interface PackLook {
  source: "github" | "folder";
  key: string;
  name: string;
  url: string | null;
  author: string | null;
  license: string | null;
  /** The exact version: the commit (GitHub) and its date. */
  version: { sha: string | null; date: string | null };
  /** For adding: the link as Panel will read it again, at this exact version. */
  link: { owner: string; repo: string; branch: string; path: string } | null;
  skills: FoundSkill[];
  /** The pack, when the library has it already. */
  pack: { id: string; sha: string | null; date: string | null } | null;
  /** Skills of the pack in the library that are no longer in the project. */
  gone: { id: string; name: string; folder: string }[];
  /** GitHub listed only part of a very large project. */
  partial?: boolean;
}

const ghKey = (o: string, r: string) => `github:${o}/${r}`.toLowerCase();
const githubUrl = (s: { owner: string; repo: string; branch: string; path: string }) =>
  `https://github.com/${s.owner}/${s.repo}${s.path ? `/tree/${s.branch}/${s.path}` : ""}`;

function goneFrom(packId: string | undefined, folders: Set<string>, path: string) {
  if (!packId) return [];
  return db
    .query<{ ref_id: string; folder: string; title: string | null }, [string]>(
      "SELECT s.ref_id, s.folder, r.title FROM skill_pack_skills s JOIN refs r ON r.id = s.ref_id WHERE s.pack_id = ?",
    )
    .all(packId)
    .filter((r) => under(r.folder, path) || r.folder === path)
    .filter((r) => !folders.has(r.folder))
    .map((r) => ({ id: r.ref_id, name: r.title ?? (base(r.folder) || "Untitled skill"), folder: r.folder }));
}

function lookFromSnapshot(s: Snapshot): PackLook {
  const key = ghKey(s.owner, s.repo);
  const pack = packByKey(key);
  const have = haveIn(pack?.id);
  const found = findSkills(s.files, s.path);
  const skills = found.map((f) => describeFound(f.folder, f.skillPath, f.files, s.skillText.get(f.skillPath), have));
  return {
    source: "github",
    key,
    name: `${s.owner}/${s.repo}`,
    url: githubUrl(s),
    author: s.author,
    license: s.licenseName,
    version: { sha: s.sha, date: s.date },
    link: { owner: s.owner, repo: s.repo, branch: s.branch, path: s.path },
    skills,
    pack: pack ? { id: pack.id, sha: pack.commit_sha, date: pack.commit_date } : null,
    gone: goneFrom(pack?.id, new Set(found.map((f) => f.folder)), s.path),
    ...(s.truncated ? { partial: true } : {}),
  };
}

/** The skills in a GitHub project, or a folder in it. Nothing is saved. */
export async function lookAtGithub(input: string): Promise<PackLook> {
  const link = parseGithubLink(input);
  if (!link) throw new PackError("That isn't a link to a GitHub project. Paste one like github.com/owner/name.");
  const look = lookFromSnapshot(await readProject(link.owner, link.repo, link.rest));
  if (!look.skills.length) throw new PackError(`No skills found in ${look.name}${look.link?.path ? `/${look.link.path}` : ""}: no folder in it holds a SKILL.md.`, 404);
  return look;
}

/** The skills in a dropped folder. Nothing is saved. */
export function lookAtFolder(input: unknown): PackLook {
  const folder = cleanFolder(input);
  const key = `folder:${folder.name}`.toLowerCase();
  const pack = packByKey(key);
  const have = haveIn(pack?.id);
  const files: ProjectFile[] = folder.files.map((f) => ({ path: f.path, bytes: f.bytes, ...(f.text !== undefined ? { text: f.text } : {}) }));
  const found = findSkills(files);
  if (!found.length) throw new PackError(`No skills found in “${folder.name}”: no folder in it holds a SKILL.md.`, 404);
  const newest = Math.max(0, ...folder.files.map((f) => f.modified ?? 0));
  const lic = folder.files.find((f) => !f.path.includes("/") && /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f.path));
  return {
    source: "folder",
    key,
    name: folder.name,
    url: null,
    author: null,
    license: lic ? licenseName(lic.text) : null,
    version: { sha: null, date: newest ? new Date(newest).toISOString() : null },
    link: null,
    skills: found.map((f) => describeFound(f.folder, f.skillPath, f.files, f.files.find((x) => x.path === f.skillPath)?.text, have)),
    pack: pack ? { id: pack.id, sha: null, date: pack.commit_date } : null,
    gone: goneFrom(pack?.id, new Set(found.map((f) => f.folder)), ""),
  };
}

// ---------- Adding ----------

interface Version { sha: string | null; date: string | null }

/** Save one skill of a pack, or replace the files of the one already there. What the designer set for it stays. */
function saveSkill(packId: string, folder: string, main: string, others: { path: string; bytes: number; text: string }[], leftOut: FoundSkill["leftOut"], digest: string, v: Version, origin: { url: string | null; author: string | null }) {
  const ts = now();
  const was = db.query<{ ref_id: string }, [string, string]>("SELECT ref_id FROM skill_pack_skills WHERE pack_id = ? AND folder = ?").get(packId, folder);
  let id = was?.ref_id;
  const title = parseSkill(main, base(folder) || "Untitled skill").name;
  if (id) {
    db.run("UPDATE refs SET text = ?, source_url = COALESCE(?, source_url), updated_at = ? WHERE id = ?", [main, origin.url, ts, id]);
  } else {
    id = newId();
    db.run(
      `INSERT INTO refs (id, kind, source_url, source_id, creator_handle, title, text, status, created_at, updated_at) VALUES (?, 'skill', ?, ?, ?, ?, ?, 'archived', ?, ?)`,
      [id, origin.url, `pack:${packId}/${folder}`, origin.author, title, main, ts, ts],
    );
  }
  db.run("DELETE FROM skill_files WHERE ref_id = ?", [id]);
  for (const f of others) db.run("INSERT INTO skill_files (ref_id, path, bytes, text, why) VALUES (?, ?, ?, ?, NULL)", [id, f.path, f.bytes, f.text]);
  for (const f of leftOut) db.run("INSERT INTO skill_files (ref_id, path, bytes, text, why) VALUES (?, ?, ?, NULL, ?)", [id, f.path, f.bytes, f.why]);
  db.run(
    `INSERT INTO skill_pack_skills (ref_id, pack_id, folder, commit_sha, commit_date, digest, gone, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(ref_id) DO UPDATE SET commit_sha = excluded.commit_sha, commit_date = excluded.commit_date, digest = excluded.digest, gone = 0, updated_at = excluded.updated_at`,
    [id, packId, folder, v.sha, v.date, digest, ts],
  );
  reindex(id);
  refreshStatus(id);
  return { id, updated: !!was };
}

/** The pack's row: made the first time, brought up to this version after. */
function upsertPack(p: Omit<PackRow, "id" | "added_at" | "checked_at">) {
  const was = packByKey(p.pack_key);
  const ts = now();
  if (was) {
    // Linked once at a folder and once at the whole project: follow the wider one.
    const path = was.path.startsWith(p.path) ? p.path : p.path.startsWith(was.path) ? was.path : "";
    db.run(
      `UPDATE skill_packs SET name = ?, url = ?, path = ?, branch = ?, author = ?, commit_sha = ?, commit_date = ?, license_name = ?, license_text = ?, checked_at = ? WHERE id = ?`,
      [p.name, p.source === "github" ? `https://github.com/${p.owner}/${p.repo}${path ? `/tree/${p.branch}/${path}` : ""}` : null, path, p.branch, p.author, p.commit_sha, p.commit_date, p.license_name, p.license_text ?? was.license_text, ts, was.id],
    );
    return was.id;
  }
  const id = newId();
  db.run(
    `INSERT INTO skill_packs (id, source, pack_key, name, url, owner, repo, path, branch, author, commit_sha, commit_date, license_name, license_text, added_at, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, p.source, p.pack_key, p.name, p.url, p.owner, p.repo, p.path, p.branch, p.author, p.commit_sha, p.commit_date, p.license_name, p.license_text, ts, ts],
  );
  return id;
}

/** Mark the pack's skills no longer in the project (they are kept), and bring back any that returned. */
function markGone(packId: string, present: Set<string>, path: string) {
  for (const r of db.query<{ ref_id: string; folder: string }, [string]>("SELECT ref_id, folder FROM skill_pack_skills WHERE pack_id = ?").all(packId)) {
    if (!(under(r.folder, path) || r.folder === path)) continue;
    db.run("UPDATE skill_pack_skills SET gone = ? WHERE ref_id = ?", [present.has(r.folder) ? 0 : 1, r.ref_id]);
  }
}

export interface AddResult { pack: string; added: number; updated: number; same: number; ids: string[] }

/**
 * Add the chosen skills of a GitHub project at the exact version shown (`sha`). A skill the
 * library already has from this pack is brought up to this version (its files replaced; what
 * the designer set stays); one that is the same is left alone. Nothing is ever doubled.
 */
export async function addFromGithub(body: { owner?: unknown; repo?: unknown; branch?: unknown; path?: unknown; sha?: unknown; folders?: unknown }): Promise<AddResult> {
  const { owner, repo, branch, path, sha } = body;
  if (typeof owner !== "string" || typeof repo !== "string" || typeof sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(sha) || typeof branch !== "string")
    throw new PackError("Look at the project again, then add.");
  const folders = Array.isArray(body.folders) ? body.folders.filter((f): f is string => typeof f === "string") : [];
  if (!folders.length) throw new PackError("Tick at least one skill to add.");
  const s = await readProject(owner, repo, [], { sha, branch, path: typeof path === "string" ? path : "" });
  const look = lookFromSnapshot(s);
  const found = findSkills(s.files, s.path);
  const packId = upsertPack({
    source: "github", pack_key: look.key, name: look.name, url: look.url, owner: s.owner, repo: s.repo, path: s.path, branch: s.branch,
    author: s.author, commit_sha: s.sha, commit_date: s.date, license_name: s.licenseName, license_text: s.licenseText,
  });
  const out: AddResult = { pack: packId, added: 0, updated: 0, same: 0, ids: [] };
  for (const folder of folders) {
    const f = found.find((x) => x.folder === folder);
    const shown = look.skills.find((x) => x.folder === folder);
    if (!f || !shown || shown.problem) continue;
    if (shown.have?.same) {
      out.same++;
      db.run("UPDATE skill_pack_skills SET gone = 0, commit_sha = ?, commit_date = ? WHERE ref_id = ?", [s.sha, s.date, shown.have.id]);
      continue;
    }
    const { kept, leftOut } = sortFiles(f.files, f.folder, f.skillPath);
    const texts = await inTurns(kept, 6, async (k) => (k.path === f.skillPath ? s.skillText.get(k.path) ?? (await raw(s.owner, s.repo, s.sha, k.path)) : await raw(s.owner, s.repo, s.sha, k.path)));
    // A file that turns out not to be text (it has NUL bytes) is left out after all.
    const others: { path: string; bytes: number; text: string }[] = [];
    kept.forEach((k, i) => {
      if (k.path === f.skillPath) return;
      if (texts[i]!.includes("\u0000")) leftOut.push({ path: inside(k.path, folder), bytes: k.bytes, why: "other" });
      else others.push({ path: inside(k.path, folder), bytes: k.bytes, text: texts[i]! });
    });
    const main = texts[kept.findIndex((k) => k.path === f.skillPath)]!;
    const r = saveSkill(packId, folder, main, others, leftOut, shown.digest, { sha: s.sha, date: s.date }, {
      url: `https://github.com/${s.owner}/${s.repo}/tree/${s.sha}${folder ? `/${folder}` : ""}`,
      author: s.author,
    });
    out.ids.push(r.id);
    if (r.updated) out.updated++;
    else out.added++;
  }
  markGone(packId, new Set(found.map((f) => f.folder)), s.path);
  return out;
}

/** Add the chosen skills of a dropped folder. The same rules as for GitHub. */
export function addFromFolder(body: { folder?: unknown; folders?: unknown }): AddResult {
  const look = lookAtFolder(body.folder);
  const folder = cleanFolder(body.folder);
  const folders = Array.isArray(body.folders) ? body.folders.filter((f): f is string => typeof f === "string") : [];
  if (!folders.length) throw new PackError("Tick at least one skill to add.");
  const files: ProjectFile[] = folder.files.map((f) => ({ path: f.path, bytes: f.bytes, ...(f.text !== undefined ? { text: f.text } : {}) }));
  const found = findSkills(files);
  const lic = folder.files.find((f) => !f.path.includes("/") && /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f.path));
  const packId = upsertPack({
    source: "folder", pack_key: look.key, name: look.name, url: null, owner: null, repo: null, path: "", branch: null, author: null,
    commit_sha: null, commit_date: look.version.date, license_name: look.license, license_text: lic?.text ?? null,
  });
  const out: AddResult = { pack: packId, added: 0, updated: 0, same: 0, ids: [] };
  for (const name of folders) {
    const f = found.find((x) => x.folder === name);
    const shown = look.skills.find((x) => x.folder === name);
    if (!f || !shown || shown.problem) continue;
    if (shown.have?.same) {
      out.same++;
      continue;
    }
    const { kept, leftOut } = sortFiles(f.files, f.folder, f.skillPath);
    const main = f.files.find((x) => x.path === f.skillPath)!.text!;
    const others = kept.filter((k) => k.path !== f.skillPath && k.text !== undefined).map((k) => ({ path: inside(k.path, name), bytes: k.bytes, text: k.text! }));
    const r = saveSkill(packId, name, main, others, leftOut, shown.digest, look.version, { url: null, author: null });
    out.ids.push(r.id);
    if (r.updated) out.updated++;
    else out.added++;
  }
  markGone(packId, new Set(found.map((f) => f.folder)), "");
  return out;
}

// ---------- A newer version ----------

/**
 * Ask GitHub for the project's current version. The same: `same` is true. Newer: the chooser's
 * look at it, where each skill says whether it is new or changed, and `gone` lists those no
 * longer there. Nothing is saved; the designer picks what to update. Panel never checks by itself.
 */
export async function checkPack(packId: string): Promise<{ same: true; date: string | null } | ({ same: false } & PackLook)> {
  const p = packById(packId);
  if (!p) throw new PackError("That pack is gone.", 404);
  if (p.source !== "github" || !p.owner || !p.repo) throw new PackError("A pack from a folder has nothing to check: drop the folder again to see what changed.");
  db.run("UPDATE skill_packs SET checked_at = ? WHERE id = ?", [now(), p.id]);
  // One question when nothing changed: the branch's newest commit.
  const branch = p.branch ?? (await ask<RepoInfo>(`/repos/${enc(p.owner)}/${enc(p.repo)}`))!.default_branch;
  const head = (await ask<CommitInfo>(`/repos/${enc(p.owner)}/${enc(p.repo)}/commits/${encodeURIComponent(branch)}`))!;
  if (head.sha === p.commit_sha) return { same: true, date: p.commit_date };
  return { same: false, ...lookFromSnapshot(await readProject(p.owner, p.repo, [], { sha: head.sha, branch, path: p.path })) };
}

// ---------- Reading ----------

/** Every pack with skills in the library, newest first, with its skills' ids: for the Skills page. */
export function listPacks() {
  const packs = db.query<PackRow, []>("SELECT * FROM skill_packs ORDER BY added_at DESC").all();
  const skills = db.query<{ ref_id: string; pack_id: string; gone: number }, []>(
    "SELECT s.ref_id, s.pack_id, s.gone FROM skill_pack_skills s JOIN refs r ON r.id = s.ref_id ORDER BY s.folder",
  ).all();
  return packs
    .map((p) => ({
      id: p.id,
      source: p.source,
      name: p.name,
      url: p.url,
      author: p.author,
      license: p.license_name,
      version: { sha: p.commit_sha, date: p.commit_date },
      checked: p.checked_at,
      skills: skills.filter((s) => s.pack_id === p.id).map((s) => s.ref_id),
      gone: skills.filter((s) => s.pack_id === p.id && s.gone).map((s) => s.ref_id),
    }))
    .filter((p) => p.skills.length);
}

/** Where a skill came from, its other files and what was left out: for its detail view. Null for a single file. */
export function skillOrigin(refId: string) {
  const row = db.query<{ pack_id: string; folder: string; commit_sha: string | null; commit_date: string | null; gone: number }, [string]>(
    "SELECT pack_id, folder, commit_sha, commit_date, gone FROM skill_pack_skills WHERE ref_id = ?",
  ).get(refId);
  const files = db.query<{ path: string; bytes: number; why: Why | null }, [string]>("SELECT path, bytes, why FROM skill_files WHERE ref_id = ? ORDER BY path").all(refId);
  const kept = files.filter((f) => !f.why).map((f) => ({ path: f.path, bytes: f.bytes }));
  const leftOut = files.filter((f) => f.why).map((f) => ({ path: f.path, bytes: f.bytes, why: f.why! }));
  const p = row ? packById(row.pack_id) : null;
  if (!p || !row) return { pack: null, files: kept, leftOut, leftOutLine: leftOutLine(leftOut) };
  return {
    pack: {
      id: p.id,
      source: p.source,
      name: p.name,
      url: p.url,
      author: p.author,
      license: p.license_name,
      hasLicenseText: !!p.license_text,
    },
    folder: row.folder,
    version: { sha: row.commit_sha, date: row.commit_date },
    link: p.source === "github" && p.owner && p.repo && row.commit_sha ? `https://github.com/${p.owner}/${p.repo}/tree/${row.commit_sha}${row.folder ? `/${row.folder}` : ""}` : null,
    gone: row.gone === 1,
    files: kept,
    leftOut,
    leftOutLine: leftOutLine(leftOut),
  };
}

/** One of a skill's other files, as written. Null when it has no such kept file. */
export function skillFileText(refId: string, path: string): string | null {
  return db.query<{ text: string | null }, [string, string]>("SELECT text FROM skill_files WHERE ref_id = ? AND path = ? AND why IS NULL").get(refId, path)?.text ?? null;
}

/** A pack's licence file, as written. */
export function packLicense(packId: string) {
  return packById(packId)?.license_text ?? null;
}

/** A skill's kept files other than SKILL.md, by path and size (for get_skill). */
export function skillFilesOf(refId: string): { path: string; bytes: number }[] {
  return db.query<{ path: string; bytes: number }, [string]>("SELECT path, bytes FROM skill_files WHERE ref_id = ? AND why IS NULL ORDER BY path").all(refId);
}
