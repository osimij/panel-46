// Reading references: an AI model looks at each save once and writes its design
// profile. Batches by default (half price, back within the hour, 24h at most);
// "Read now" for one reference at full price.
//
// What the model sees is prepared here first, at a size that keeps cost known:
//   images      up to 4, each scaled to about 1.2 megapixels
//   videos/GIFs a 3×3 grid of frames in time order, plus how often the shot cuts
//   sites       first screen, the whole page folded into columns, second screen, phone
// Colors are measured from those pictures (palette.ts), not guessed.

import { fontLine, parseMeasured } from "./sitefacts.ts";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { MEDIA_DIR } from "./config.ts";
import { db, getSetting, now, reindex, setSetting, type MediaRow, type RefRow } from "./db.ts";
import { abs, probe, run } from "./media.ts";
import { measurePalette, PALETTE_VERSION, type Swatch } from "./palette.ts";
import { applyReadTags, tagContext, tagGuide } from "./tagging.ts";

// ---------- Settings ----------

export const MODELS = {
  "claude-sonnet-5-5": { label: "Sonnet 5.5", input: 2, output: 10 },
  "claude-opus-5-5": { label: "Opus 5.5", input: 4, output: 20 },
  "claude-haiku-5-5": { label: "Haiku 5.5", input: 0.1, output: 0.5 },
} as const;
export type ModelId = keyof typeof MODELS;

export const settings = {
  model: () => (getSetting("ai_model") as ModelId | null) ?? "claude-sonnet-5-5",
  /** New saves are read by themselves. The library you already had is read only when you ask. */
  auto: () => getSetting("ai_auto") !== "0",
  /** Dollars per calendar month. Nothing is sent once it's reached. */
  cap: () => Number(getSetting("ai_cap") ?? 20),
  /**
   * "claude-code": reads go through the claude command line, signed in to your Claude
   * subscription, so they count against its usage limits instead of costing API money.
   * "api": the Anthropic API with a key, in half-price batches.
   */
  provider: () => (getSetting("ai_provider") as Provider | null) ?? "claude-code",
  effort: () => (getSetting("ai_effort") as Effort | null) ?? "high",
  /**
   * How much of a video the model sees. "basic": one 9-frame grid. "rich": a grid per
   * 30 seconds (up to 3), plus close-ups of the two busiest moments, 0.1s apart; short
   * clips get frames every fraction of a second instead.
   */
  frames: () => (getSetting("ai_frames") as Frames | null) ?? "basic",
};
export type Frames = "basic" | "rich";
export type Provider = "claude-code" | "api";
// Saves from before reading existed aren't read automatically.
if (!getSetting("ai_auto_since")) setSetting("ai_auto_since", now());

/** New saves wait this long so they go out together in one batch. */
const BATCH_WAIT_MS = 20 * 60_000;
/** Pictures are sent inline, so batches stay well under the 256 MB request limit. */
const BATCH_MAX = 40;

// ---------- The API key ----------
// From PANEL_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY, or else the macOS Keychain item
// "Panel Anthropic API key" (security add-generic-password -s "Panel Anthropic API key" -a panel -w).

const KEYCHAIN_SERVICE = "Panel Anthropic API key";
let client: Anthropic | null = null;

export async function getClient(): Promise<Anthropic | null> {
  if (client) return client;
  let key = process.env.PANEL_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  if (!key) {
    const { out, code } = await run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], 10_000);
    if (code === 0) key = out.trim();
  }
  if (!key) return null;
  // The base URL is set on purpose: a shell's ANTHROPIC_BASE_URL (Claude Code sets one) shouldn't reroute Panel.
  client = new Anthropic({ apiKey: key, baseURL: process.env.PANEL_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com" });
  return client;
}

export async function hasKey() {
  return !!(await getClient());
}

// ---------- Spending ----------

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function costOf(model: ModelId, usage: Usage, batch: boolean) {
  const p = MODELS[model] ?? MODELS["claude-sonnet-5-5"];
  const input =
    usage.input_tokens * p.input + (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25 + (usage.cache_read_input_tokens ?? 0) * p.input * 0.1;
  return ((input + usage.output_tokens * p.output) / 1e6) * (batch ? 0.5 : 1);
}

export function spentThisMonth() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return db.query<{ s: number }, [string]>("SELECT COALESCE(SUM(cost), 0) s FROM ai_usage WHERE at >= ?").get(start.toISOString())!.s;
}

/** What one read has cost on average lately; before any, a cautious guess. */
function typicalCost(batch: boolean) {
  // Batch reads are stored at half price; doubled here so both kinds average as full price.
  const r = db
    .query<{ c: number | null; n: number }, []>(
      "SELECT AVG(CASE WHEN mode = 'batch' THEN cost * 2 ELSE cost END) c, COUNT(*) n FROM (SELECT cost, mode FROM ai_usage ORDER BY id DESC LIMIT 50)",
    )
    .get()!;
  const per = r.n >= 3 && r.c ? r.c * 1.3 : 0.06;
  return batch ? per / 2 : per;
}

export function logUsage(refId: string | null, model: ModelId, mode: "batch" | "now", usage: Usage) {
  const cost = costOf(model, usage, mode === "batch");
  db.run(
    `INSERT INTO ai_usage (at, ref_id, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [now(), refId, model, mode, usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0, cost],
  );
  return cost;
}

// ---------- What can be read ----------

/** References a read makes sense for: anything with pictures. Not skills, not bare profiles. */
const READABLE = `r.kind NOT IN ('skill', 'account') AND r.hidden = 0 AND (r.status = 'archived' OR (r.status = 'link_only' AND r.preview_path IS NOT NULL))`;

export function unreadIds(limit = 10_000, newestFirst = true) {
  return db
    .query<{ id: string }, [number]>(
      `SELECT r.id FROM refs r WHERE ${READABLE} AND NOT EXISTS (SELECT 1 FROM reads x WHERE x.ref_id = r.id)
       ORDER BY r.created_at ${newestFirst ? "DESC" : "ASC"} LIMIT ?`,
    )
    .all(limit)
    .map((r) => r.id);
}

// ---------- Preparing pictures ----------

interface Visual {
  /** Relative to MEDIA_DIR. */
  rel: string;
  label: string;
  width: number;
  height: number;
}

export interface Signals {
  visuals: Visual[];
  video?: { duration: number; cuts: number; seconds_checked: number };
  frames?: Frames;
}

const MAX_LONG = 1568;
const MAX_AREA = 1_200_000;
/**
 * The one ceiling on a read: pictures that fit in Claude's context with room to think
 * (~1.6k tokens each, so 90 ≈ 145k). Nothing else is capped; only a very long video
 * (10 minutes or so) ever reaches it, and then it gets fewer close-ups, never fewer overview frames.
 */
const PICTURE_BUDGET = 90;

/** Size that fits the cost budget, never larger than the original, even numbers for ffmpeg. */
function fit(w: number, h: number) {
  const s = Math.min(1, MAX_LONG / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
  const even = (n: number) => Math.max(2, Math.floor((n * s) / 2) * 2);
  return { w: even(w), h: even(h) };
}

async function ff(args: string[], timeout = 120_000) {
  const { code, err } = await run(["ffmpeg", "-y", "-v", "error", ...args], timeout);
  if (code !== 0) throw new Error(err.trim().split("\n")[0] || "ffmpeg failed");
}

async function sizeOf(path: string, m?: MediaRow) {
  if (m?.width && m.height) return { w: m.width, h: m.height, d: m.duration };
  const p = await probe(path.startsWith(MEDIA_DIR) ? path.slice(MEDIA_DIR.length + 1) : path);
  return { w: p.width ?? 1000, h: p.height ?? 1000, d: p.duration };
}

async function stillImage(src: string, outRel: string, label: string, m?: MediaRow): Promise<Visual> {
  const { w, h } = await sizeOf(src, m);
  const t = fit(w, h);
  await ff(["-i", src, "-frames:v", "1", "-vf", `scale=${t.w}:${t.h}:flags=lanczos`, "-q:v", "3", abs(outRel)]);
  return { rel: outRel, label, width: t.w, height: t.h };
}

async function cropImage(src: string, outRel: string, label: string, crop: { w: number; h: number; y: number }): Promise<Visual> {
  const t = fit(crop.w, crop.h);
  await ff(["-i", src, "-frames:v", "1", "-vf", `crop=${crop.w}:${crop.h}:0:${crop.y},scale=${t.w}:${t.h}:flags=lanczos`, "-q:v", "3", abs(outRel)]);
  return { rel: outRel, label, width: t.w, height: t.h };
}

/** Stretches of a page side by side in one picture (phone screens, three at a time). */
async function sideBySide(src: string, outRel: string, w: number, screen: number, ys: number[], label: string): Promise<Visual> {
  const n = ys.length;
  const t = fit(w * n, screen);
  const parts = ys.map((y, i) => `[s${i}]crop=${w}:${screen}:0:${y}[c${i}]`).join(";");
  const filter = n === 1
    ? `crop=${w}:${screen}:0:${ys[0]},scale=${t.w}:${t.h}:flags=lanczos`
    : `[0]split=${n}${ys.map((_, i) => `[s${i}]`).join("")};${parts};${ys.map((_, i) => `[c${i}]`).join("")}hstack=inputs=${n},scale=${t.w}:${t.h}:flags=lanczos`;
  await ff(["-i", src, n === 1 ? "-vf" : "-filter_complex", filter, "-frames:v", "1", "-q:v", "3", abs(outRel)]);
  return { rel: outRel, label, width: t.w, height: t.h };
}

/** Where each screen of a page starts; the last one is pulled up so it's full height. */
const screenStarts = (h: number, screen: number) => {
  const n = Math.max(1, Math.ceil(h / screen - 0.15));
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.min(i * screen, h - screen)));
};

/** A long page cut into columns side by side, so its whole structure fits one picture. */
async function foldedPage(src: string, outRel: string, w: number, h: number): Promise<Visual> {
  const n = Math.max(2, Math.round(Math.sqrt(h / w)));
  const seg = Math.floor(h / n / 2) * 2;
  const t = fit(w * n, seg);
  const parts = Array.from({ length: n }, (_, i) => `[s${i}]crop=${w}:${seg}:0:${i * seg}[c${i}]`).join(";");
  const filter = `[0]split=${n}${Array.from({ length: n }, (_, i) => `[s${i}]`).join("")};${parts};${Array.from({ length: n }, (_, i) => `[c${i}]`).join("")}hstack=inputs=${n},scale=${t.w}:${t.h}:flags=lanczos`;
  await ff(["-i", src, "-filter_complex", filter, "-frames:v", "1", "-q:v", "3", abs(outRel)]);
  return { rel: outRel, label: `The whole page, cut into ${n} columns: read the left column top to bottom, then the next`, width: t.w, height: t.h };
}

/** 0:03.4, 1:26 */
const clock = (t: number, tenths = false) => {
  const sec = (t % 60).toFixed(tenths ? 1 : 0);
  return `${Math.floor(t / 60)}:${sec.padStart(tenths ? 4 : 2, "0")}`;
};

/** Columns that make a grid of n frames closest to square, so frames stay as large as they can. */
function squareCols(n: number, w: number, h: number) {
  let best = 1, score = Infinity;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const off = Math.abs(Math.log((c * w) / (rows * h))) + (c * rows - n) * 0.15;
    if (off < score) { score = off; best = c; }
  }
  return best;
}

/** Frames at exactly these times, laid out cols×rows, left to right, top to bottom. */
async function gridAt(src: string, outRel: string, times: number[], cols: number, w: number, h: number, dir: string, label: string): Promise<Visual> {
  const rows = Math.ceil(times.length / cols);
  const g = fit(w * cols, h * rows);
  const fw = Math.floor(g.w / cols / 2) * 2;
  const fh = Math.floor(g.h / rows / 2) * 2;
  const frames: string[] = [];
  const tag = basename(outRel).replace(/\W/g, "");
  for (const [i, t] of times.entries()) {
    const f = join(dir, `f-${tag}-${i}.jpg`);
    await ff(["-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", `scale=${fw}:${fh}`, "-q:v", "3", f], 60_000).catch(() => {});
    if (existsSync(f)) frames.push(f);
    else if (frames.length) frames.push(frames.at(-1)!);
  }
  if (!frames.length) throw new Error("Couldn't take frames from the video");
  while (frames.length < cols * rows) frames.push(frames.at(-1)!);
  const n = frames.length;
  const layout = Array.from({ length: n }, (_, i) => `${(i % cols) * fw}_${Math.floor(i / cols) * fh}`).join("|");
  await ff([...frames.flatMap((f) => ["-i", f]), "-filter_complex", `xstack=inputs=${n}:layout=${layout}`, "-frames:v", "1", "-q:v", "3", abs(outRel)]);
  for (const f of new Set(frames)) rmSync(f, { force: true });
  return { rel: outRel, label, width: fw * cols, height: fh * rows };
}

/**
 * How much the picture changes, every 0.1s, across the whole video. Hard cuts are left out:
 * the busiest stretches between cuts are where the animation is.
 */
async function changeCurve(src: string, duration: number): Promise<{ t: number; s: number }[]> {
  const { err } = await run(
    ["ffmpeg", "-v", "info", "-i", src, "-an", "-vf", "fps=10,scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score", "-f", "null", "-"],
    120_000 + duration * 2_000,
  );
  const out: { t: number; s: number }[] = [];
  let t: number | null = null;
  for (const line of err.split("\n")) {
    const pt = line.match(/pts_time:([\d.]+)/);
    if (pt) t = Number(pt[1]);
    const sc = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (sc && t !== null) out.push({ t, s: Number(sc[1]) });
  }
  return out;
}

/** Start times of the `count` busiest 0.8s stretches, away from hard cuts and from each other. */
function busiest(curve: { t: number; s: number }[], duration: number, count: number) {
  const cuts = curve.filter((c) => c.s > 0.35).map((c) => c.t);
  const nearCut = (a: number, b: number) => cuts.some((c) => c > a - 0.25 && c < b + 0.25);
  const windows: { at: number; sum: number }[] = [];
  for (let i = 0; i + 8 <= curve.length; i++) {
    const at = curve[i]!.t;
    if (at + 0.8 > duration || nearCut(at, at + 0.8)) continue;
    windows.push({ at, sum: curve.slice(i, i + 8).reduce((a, c) => a + c.s, 0) });
  }
  windows.sort((a, b) => b.sum - a.sum);
  const picked: number[] = [];
  for (const w of windows) {
    if (w.sum < 0.02) break; // a still picture has nothing to show close up
    if (picked.every((p) => Math.abs(p - w.at) > 2)) picked.push(w.at);
    if (picked.length === count) break;
  }
  return picked.sort((a, b) => a - b);
}

/** The "rich" frames for one video: overview grids, then motion close-ups (or a dense grid for a short clip). */
async function richVideo(src: string, m: MediaRow, dirRel: string, first: number, room: number): Promise<{ visuals: Visual[]; duration: number }> {
  const { w, h, d } = await sizeOf(src, m);
  const duration = d ?? 0;
  const dir = abs(dirRel);
  const name = (i: number) => `${dirRel}/${first + i}.jpg`;
  const visuals: Visual[] = [];
  if (duration <= 6) {
    // A short clip, like a UI or logo animation: frames close together across all of it,
    // 8 to a picture so each frame stays large enough to see detail.
    const n = duration <= 2 ? 16 : 32;
    const step = duration / n;
    const times = Array.from({ length: n }, (_, i) => Math.min(duration - 0.05, i * step + step / 2));
    const per = 8;
    for (let k = 0; k * per < n; k++) {
      const part = times.slice(k * per, (k + 1) * per);
      visuals.push(await gridAt(src, name(k), part, squareCols(part.length, w, h), w, h, dir,
        `Part ${k + 1} of ${Math.ceil(n / per)}: 8 frames ${step.toFixed(2)}s apart (${clock(part[0]!, true)}–${clock(part.at(-1)!, true)}) of the ${duration.toFixed(1)}s clip, left to right, top to bottom`));
    }
    return { visuals, duration };
  }
  // A grid of 9 for every 20 seconds of the whole video, so no scene is skipped.
  const parts = Math.max(1, Math.ceil(duration / 20));
  for (let p = 0; p < parts; p++) {
    const a = (duration * p) / parts, b = (duration * (p + 1)) / parts;
    const times = Array.from({ length: 9 }, (_, i) => a + (b - a) * (0.04 + (0.92 * i) / 8));
    visuals.push(await gridAt(src, name(visuals.length), times, 3, w, h, dir,
      `${parts > 1 ? `Part ${p + 1} of ${parts}: ` : ""}9 frames from ${clock(a)} to ${clock(b)}, in time order: left to right, top to bottom`));
  }
  const curve = await changeCurve(src, duration).catch(() => []);
  // Close-ups of the busiest moments: about one for every 8 seconds, at least 3,
  // as many as the picture budget leaves room for.
  const closeUps = Math.max(1, Math.min(Math.max(duration <= 20 ? 3 : 4, Math.ceil(duration / 8)), room - visuals.length));
  for (const at of busiest(curve, duration, closeUps)) {
    const times = Array.from({ length: 8 }, (_, i) => at + i * 0.1);
    visuals.push(await gridAt(src, name(visuals.length), times, squareCols(8, w, h), w, h, dir,
      `Motion close-up: 8 frames 0.1s apart (${clock(at, true)}–${clock(at + 0.7, true)}), left to right, top to bottom`));
  }
  return { visuals, duration };
}

/** Frames from across a video in one grid, left to right, top to bottom. */
async function frameGrid(src: string, outRel: string, m: MediaRow, dir: string): Promise<{ visual: Visual; duration: number }> {
  const { w, h, d } = await sizeOf(src, m);
  const duration = d ?? 0;
  const side = duration >= 1.5 ? 3 : 2;
  const n = side * side;
  const g = fit(w * side, h * side);
  const fw = Math.floor(g.w / side / 2) * 2;
  const fh = Math.floor(g.h / side / 2) * 2;
  const frames: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = duration > 0 ? duration * (0.04 + (0.92 * i) / (n - 1)) : 0;
    const f = join(dir, `frame-${i}.jpg`);
    await ff(["-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", `scale=${fw}:${fh}`, "-q:v", "3", f], 60_000).catch(() => {});
    if (existsSync(f)) frames.push(f);
  }
  if (!frames.length) throw new Error("Couldn't take frames from the video");
  // Missing frames (a seek past a short GIF's end) repeat the last one, so the grid stays whole.
  while (frames.length < n) frames.push(frames.at(-1)!);
  const inputs = frames.flatMap((f) => ["-i", f]);
  const layout = Array.from({ length: n }, (_, i) => `${(i % side) * fw}_${Math.floor(i / side) * fh}`).join("|");
  await ff([...inputs, "-filter_complex", `xstack=inputs=${n}:layout=${layout}`, "-frames:v", "1", "-q:v", "3", abs(outRel)]);
  for (const f of new Set(frames)) rmSync(f, { force: true });
  const times = duration > 0 ? ` from 0:00 to ${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, "0")}` : "";
  return {
    visual: { rel: outRel, label: `${n} frames${times}, in time order: left to right, top to bottom`, width: fw * side, height: fh * side },
    duration,
  };
}

/** How many hard cuts the whole video has: the pace of the edit. */
async function countCuts(src: string, duration: number): Promise<{ cuts: number; seconds: number }> {
  const { err } = await run(
    ["ffmpeg", "-v", "info", "-i", src, "-an", "-vf", "scale=160:-2,select='gt(scene,0.35)',showinfo", "-f", "null", "-"],
    120_000 + duration * 2_000,
  );
  const cuts = (err.match(/pts_time:/g) ?? []).length;
  const dur = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const total = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : duration;
  return { cuts, seconds: Math.round(total) };
}

/** `dirRel` puts the pictures somewhere else, for side-by-side tests; Panel uses `<refId>/read`. */
export async function prepare(r: RefRow, opts: { frames?: Frames; dirRel?: string } = {}): Promise<{ signals: Signals; palette: Swatch[] }> {
  const frames = opts.frames ?? settings.frames();
  const media = db
    .query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ? AND status = 'archived' AND local_path IS NOT NULL ORDER BY COALESCE(position, idx), idx")
    .all(r.id);
  const dirRel = opts.dirRel ?? `${r.id}/read`;
  if (!dirRel.startsWith(`${r.id}/`)) throw new Error("Pictures for a read stay in the reference's own folder");
  const dir = abs(dirRel);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const visuals: Visual[] = [];
  const signals: Signals = { visuals, frames };

  if (r.site) {
    const desktop = media.find((m) => basename(m.local_path!).startsWith("desktop")) ?? media[0];
    const phone = media.find((m) => basename(m.local_path!).startsWith("phone"));
    // The whole page, screen by screen, at full detail; the folded page shows its overall structure.
    const next = () => `${dirRel}/${visuals.length}.jpg`;
    if (desktop) {
      const src = abs(desktop.local_path!);
      const { w, h } = await sizeOf(src, desktop);
      const screen = Math.min(h, Math.floor((w * 900) / 1440 / 2) * 2);
      if (h > screen * 2) visuals.push(await foldedPage(src, next(), w, h));
      const starts = screenStarts(h, screen).slice(0, PICTURE_BUDGET - 12);
      for (const [i, y] of starts.entries()) {
        visuals.push(await cropImage(src, next(), `Desktop, screen ${i + 1} of ${starts.length} (${y}–${y + screen}px down the page)`, { w, h: screen, y }));
      }
    }
    if (phone) {
      const src = abs(phone.local_path!);
      const { w, h } = await sizeOf(src, phone);
      const screen = Math.min(h, Math.floor((w * 844) / 390 / 2) * 2);
      const starts = screenStarts(h, screen);
      for (let i = 0; i < starts.length && visuals.length < PICTURE_BUDGET; i += 3) {
        const ys = starts.slice(i, i + 3);
        visuals.push(await sideBySide(src, next(), w, screen, ys,
          `Phone, ${ys.length > 1 ? `screens ${i + 1}–${i + ys.length}` : `screen ${i + 1}`} of ${starts.length}${ys.length > 1 ? ", side by side in scroll order" : ""}`));
      }
    }
  } else {
    for (const [k, m] of media.entries()) {
      if (visuals.length >= PICTURE_BUDGET) break;
      const src = abs(m.local_path!);
      const out = `${dirRel}/${visuals.length}.jpg`;
      if (m.type === "image") {
        visuals.push(await stillImage(src, out, media.length > 1 ? `Item ${k + 1} of ${media.length} (image)` : "The image", m));
      } else {
        // Every video gets rich frames. Leave room for the rest of the post (about 2 pictures each).
        const room = PICTURE_BUDGET - visuals.length - (media.length - k - 1) * 2;
        const { visuals: vs, duration } = frames === "rich"
          ? await richVideo(src, m, dirRel, visuals.length, room)
          : await frameGrid(src, out, m, dir).then((x) => ({ visuals: [x.visual], duration: x.duration }));
        if (media.length > 1) for (const v of vs) v.label = `Item ${k + 1} of ${media.length} (${m.type}): ${v.label}`;
        visuals.push(...vs);
        if (!signals.video && m.type === "video") {
          const c = await countCuts(src, duration).catch(() => null);
          if (c) signals.video = { duration: Math.round(duration * 10) / 10, cuts: c.cuts, seconds_checked: c.seconds };
        }
      }
    }
    if (!visuals.length && r.preview_path && existsSync(abs(r.preview_path))) {
      visuals.push(await stillImage(abs(r.preview_path), `${dirRel}/0.jpg`, "Preview image from the link (not the full media)"));
    }
  }
  if (!visuals.length) throw new Error("Nothing to look at: no saved pictures or video");
  const palette = await measurePalette(visuals.map((v) => abs(v.rel)));
  return { signals, palette };
}

// ---------- What the model is asked ----------

const SYSTEM = `You read saved design references for a designer's private library. Each reference is something they saved because it's good: a website, an app screen, a poster, a brand, a motion piece, a photo.

Your profile is used later to find and combine references by facet. A designer will ask things like "a calm, warm, editorial mobile app" and get color from one reference, type from another and motion from a third. So describe each facet on its own terms, concretely, in a working designer's vocabulary.

- Describe what you can see, not what the post text claims. The text is context; the pictures are the evidence.
- Colors were measured from the pixels and are given to you with exact hex values and shares. Use those hexes when you assign roles; don't invent new ones.
- For typography, name the classification precisely (neo-grotesk, geometric sans, didone, slab, mono…). Guess typefaces only when fairly confident; leave the list empty otherwise. If there's no meaningful type, say present: false.
- For video, you get grids of frames in time order plus a measured count of hard cuts. Some videos also come with motion close-ups: 8 frames 0.1s apart at the busiest moments, or, for short clips, frames a fraction of a second apart across the whole clip. Use those to judge how things move: easing (does it slow into place, overshoot and settle, move linearly), staggering, what enters first, masks and reveals, scale and blur during movement. Keep motion confidence honest: say high only when close-ups actually show the movement. For still images, motion is not present.
- For websites you get the whole page folded into columns (its overall structure), then every desktop screen from top to bottom, then the phone version three screens at a time.
- A post with several images or videos comes with all of them, labeled by item.
- worth_taking is the most useful field: 1–3 specific, transferable ideas ("oversized serif headline cropped by the viewport edge", "single acid-green accent on an otherwise grayscale UI"), never generic praise.
- search_terms: lowercase words and short phrases someone might type to find this, including synonyms.
- tags: the shelves this goes on in their library, picked the way they pick them. Follow the tagging guide below and use their existing tags, listed with each reference.
- Be specific and brief. No filler, no marketing tone.`;

/** The instructions for every read: the profile rules, then how this designer tags. */
const system = () => `${SYSTEM}\n\n${tagGuide()}`;

const str = (description: string) => ({ type: "string", description });
const list = (description: string) => ({ type: "array", items: { type: "string" }, description });
const oneOf = (values: string[], description: string) => ({ type: "string", enum: values, description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

const PROFILE_SCHEMA = obj({
  summary: str("One sentence: what this is and what makes it worth keeping."),
  format: list("What kind of work: landing page, mobile app screen, dashboard, poster, brand identity, packaging, editorial layout, type specimen, motion piece, product video, illustration, 3D render, photography, interaction demo…"),
  mood: list("3–6 words or short phrases for the feeling: calm, editorial, playful, brutal, luxurious, technical, warm, nostalgic…"),
  style_references: list("Movements, eras or schools it draws on (Swiss/International, brutalism, Y2K, Bauhaus, Memphis, skeuomorphism…). Empty if none is clear."),
  color: obj({
    summary: str("The color idea in a sentence."),
    temperature: oneOf(["warm", "cool", "neutral", "mixed"], "Overall temperature."),
    contrast: oneOf(["low", "medium", "high"], "Value contrast."),
    saturation: oneOf(["muted", "balanced", "vivid"], "Overall saturation."),
    roles: {
      type: "array",
      description: "Measured colors and the job each does. Use the measured hex values.",
      items: obj({ hex: str("A measured hex value."), role: str("background, surface, text, accent, highlight, illustration…") }),
    },
  }),
  typography: obj({
    present: { type: "boolean", description: "Is there meaningful type to learn from?" },
    summary: str("The type idea in a sentence, or empty."),
    classification: list("neo-grotesk, geometric sans, humanist sans, transitional serif, didone, slab, mono, script, display…"),
    likely_fonts: list("Typeface guesses, only when fairly confident. Empty otherwise."),
    case: oneOf(["mixed", "sentence", "upper", "lower", "none"], "Dominant case."),
    scale_contrast: oneOf(["none", "low", "medium", "high"], "Size difference between the largest and body text."),
    tracking: oneOf(["tight", "normal", "wide", "mixed", "none"], "Letter spacing of the headlines."),
  }),
  layout: obj({
    summary: str("How the space is organized, in a sentence."),
    density: oneOf(["sparse", "balanced", "dense"], "How much is on the canvas."),
    whitespace: oneOf(["minimal", "moderate", "generous"], "Breathing room."),
    notable: list("Specific layout moves: asymmetric grid, full-bleed image, sticky sidebar, bento cards, edge cropping…"),
  }),
  imagery: obj({
    summary: str("Photos, illustration, 3D, texture: what and how. Empty if none."),
    style: list("photography, illustration, 3D, collage, gradient, grain, iconography, product shots…"),
  }),
  motion: obj({
    present: { type: "boolean", description: "Is there motion to learn from?" },
    summary: str("What moves and how it feels, or empty."),
    pace: oneOf(["none", "slow", "medium", "fast"], "Pace of the edit or animation."),
    techniques: list("hard cuts, crossfade, parallax, scroll-linked, kinetic type, morphing, masking reveal, stagger, camera move…"),
    confidence: oneOf(["none", "low", "medium", "high"], "How sure, given you see frames rather than playback."),
  }),
  components: list("Interface parts shown: navigation, hero, pricing table, onboarding, chart, card grid, tab bar, modal, form… Empty if not an interface."),
  worth_taking: list("1–3 concrete ideas worth reusing elsewhere, one sentence each."),
  search_terms: list("10–25 lowercase words and short phrases someone might search for to find this."),
  tags: list("Usually 1–3 of their existing tags for this section, chosen as the tagging guide describes. A new tag only when none of theirs fits the main reason it was saved."),
  limits: str("What you couldn't see or judge (e.g. motion from stills, text too small). Empty if nothing."),
});

export type Profile = Record<string, unknown>;

function context(r: RefRow, signals: Signals, palette: Swatch[]) {
  const tags = db
    .query<{ name: string }, [string]>("SELECT t.name FROM tags t JOIN ref_tags rt ON rt.tag_id = t.id WHERE rt.ref_id = ?")
    .all(r.id)
    .map((t) => t.name);
  const measured = parseMeasured(r.measured);
  const source = r.site ? "a website (full-page screenshots)" : { x: "an X post", instagram: "an Instagram post", pinterest: "a Pinterest pin", youtube: "a YouTube video", web: "a web page", upload: "a file they added" }[r.kind as string] ?? r.kind;
  const lines = [
    `Saved from: ${source}${r.source_url ? ` (${r.source_url})` : ""}`,
    r.creator_name || r.creator_handle ? `By: ${[r.creator_name, r.creator_handle && `@${r.creator_handle}`].filter(Boolean).join(" ")}` : "",
    r.title ? `Title: ${r.title}` : "",
    r.text ? `Post text: ${r.text}` : "",
    r.note ? `The designer's own note (weigh this most): ${r.note}` : "",
    tags.length ? `Their tags: ${tags.join(", ")}` : "",
    `Measured colors (share of the pictures): ${palette.map((s) => `${s.hex} ${Math.round(s.share * 100)}% (${s.name})`).join(", ")}`,
    signals.video
      ? `Video: ${signals.video.duration}s long; ${signals.video.cuts} hard cuts in ${signals.video.seconds_checked}s (${(signals.video.cuts / Math.max(1, signals.video.seconds_checked / 60)).toFixed(1)} per minute)`
      : "",
    measured ? `Fonts the page really uses (measured in the browser, so name these in likely_fonts rather than guessing): ${measured.fonts.map(fontLine).join("; ")}` : "",
    measured?.radii.length ? `Corner radii in its CSS: ${measured.radii.map((x) => `${x}px`).join(", ")}${measured.smooth_corners ? " (with corner smoothing)" : ""}` : "",
    `Pictures: ${signals.visuals.map((v, i) => `${i + 1}. ${v.label}`).join("; ")}`,
    tagContext(r),
  ];
  return lines.filter(Boolean).join("\n");
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** `cache: false` and a chosen effort are for side-by-side tests (scripts); Panel itself uses the defaults. */
export async function requestFor(
  r: RefRow, signals: Signals, palette: Swatch[], model: ModelId,
  opts: { effort?: Effort; cache?: boolean } = {},
): Promise<Anthropic.MessageCreateParamsNonStreaming> {
  const { effort = settings.effort(), cache = true } = opts;
  const content: Anthropic.ContentBlockParam[] = [];
  for (const v of signals.visuals) {
    const data = Buffer.from(await Bun.file(abs(v.rel)).arrayBuffer()).toString("base64");
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  }
  content.push({ type: "text", text: `${context(r, signals, palette)}\n\nWrite the design profile for this reference.` });
  return {
    model,
    max_tokens: 32000,
    system: [{ type: "text", text: system(), ...(cache ? { cache_control: { type: "ephemeral" as const } } : {}) }],
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema: PROFILE_SCHEMA } },
  } satisfies Anthropic.MessageCreateParamsNonStreaming;
}

export function parseProfile(msg: Anthropic.Message): Profile {
  if (msg.stop_reason === "refusal") throw new Error("The model declined to read this one.");
  if (msg.stop_reason === "max_tokens") throw new Error("The profile was cut off before it finished.");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(text) as Profile;
  } catch {
    throw new Error("The profile came back unreadable.");
  }
}

function saveProfile(refId: string, model: ModelId, profile: Profile, cost: number) {
  db.run("UPDATE reads SET state = 'done', model = ?, profile = ?, error = NULL, cost = ?, read_at = ?, batch_id = NULL WHERE ref_id = ?", [
    model, JSON.stringify(profile), cost, now(), refId,
  ]);
  applyReadTags(refId, profile.tags);
  reindex(refId);
}

function fail(refId: string, message: string) {
  db.run("UPDATE reads SET state = 'failed', error = ?, batch_id = NULL WHERE ref_id = ?", [message.slice(0, 500), refId]);
}

// ---------- Through Claude Code (your subscription) ----------
// Each read runs `claude -p` in the reference's read/ folder. Claude opens the prepared
// pictures with its Read tool and answers with the same profile schema. Auth: a long-lived
// token from `claude setup-token`, kept in the Keychain as "Panel Claude Code token";
// without one, the command line's own sign-in is used.

const CC_TOKEN_SERVICE = "Panel Claude Code token";
/** Reads running at once. Each is a claude process plus ffmpeg work on this Mac. */
const CC_PARALLEL = 8;
/** After a rate or usage limit, nothing new starts until this time; the queue simply waits. */
let ccPausedUntil = 0;
const isLimit = (m: string) => /rate.?limit|429|overloaded|usage limit|too many requests|529/i.test(m);

export async function claudeBinary(): Promise<string | null> {
  const home = process.env.HOME ?? "";
  const candidates = [
    process.env.PANEL_CLAUDE_BIN,
    `${home}/.npm-global/bin/claude`, `${home}/.local/bin/claude`, `${home}/.claude/local/claude`,
    "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  const { out, code } = await run(["/bin/zsh", "-lc", "command -v claude"], 10_000);
  return code === 0 && out.trim() ? out.trim() : null;
}

export async function claudeToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const { out, code } = await run(["security", "find-generic-password", "-s", CC_TOKEN_SERVICE, "-w"], 10_000);
  return code === 0 ? out.trim() : "";
}

interface CcResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: Usage;
  total_cost_usd?: number;
  /** Which model(s) actually answered, as Claude Code reports it. */
  modelUsage?: Record<string, unknown>;
}

export async function readWithClaudeCode(r: RefRow, signals: Signals, palette: Swatch[], model: ModelId, effort: Effort) {
  const bin = await claudeBinary();
  if (!bin) throw new Error("The claude command line isn't installed.");
  const token = await claudeToken();
  const dir = dirname(abs(signals.visuals[0]!.rel));
  const pictures = signals.visuals.map((v, i) => `${i + 1}. ${abs(v.rel)} (${v.label})`).join("\n");
  const prompt = `Open each of these pictures with the Read tool, in order:\n${pictures}\n\n${context(r, signals, palette)}\n\nWrite the design profile for this reference.`;
  const instructions = `${system()}\n\nOpen every listed picture with the Read tool before answering. Then answer only with the profile.`;
  // A clean environment: nothing from a shell (an ANTHROPIC_BASE_URL, an API key) should change where this goes.
  const env: Record<string, string> = {
    HOME: process.env.HOME ?? "",
    USER: process.env.USER ?? "",
    PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`,
    ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}),
  };
  const proc = Bun.spawn(
    [
      bin, "-p", prompt,
      "--model", model, "--effort", effort,
      "--output-format", "json", "--json-schema", JSON.stringify(PROFILE_SCHEMA),
      "--system-prompt", instructions,
      "--tools", "Read", "--allowedTools", "Read",
      "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "",
    ],
    { cwd: dir, env, stdout: "pipe", stderr: "pipe" },
  );
  // More pictures take longer to open and think over.
  const timer = setTimeout(() => proc.kill(), (6 + signals.visuals.length * 0.25) * 60_000);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  let res: CcResult;
  try {
    res = JSON.parse(out) as CcResult;
  } catch {
    throw new Error(`Claude Code didn't answer: ${(err || out).trim().split("\n").pop()?.slice(0, 200) || "no output"}`);
  }
  if (res.is_error) throw new Error(`Claude Code: ${res.result?.slice(0, 300) ?? "failed"}`);
  let profile = res.structured_output as Profile | undefined;
  if (!profile && res.result) {
    try {
      profile = JSON.parse(res.result.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Profile;
    } catch {
      /* handled below */
    }
  }
  if (!profile || typeof profile !== "object") throw new Error("Claude Code's answer wasn't a profile.");
  profile.limits = asSentences(profile.limits);
  return { profile, usage: res.usage ?? { input_tokens: 0, output_tokens: 0 }, apiEquivalent: res.total_cost_usd ?? 0, models: Object.keys(res.modelUsage ?? {}) };
}

/** The "limits" note is meant to be text; a list (or a list written as text) becomes sentences. */
function asSentences(v: unknown): string {
  let x = v;
  if (typeof x === "string" && x.trim().startsWith("[")) {
    try {
      x = JSON.parse(x);
    } catch {
      /* it's just text that starts with a bracket */
    }
  }
  if (Array.isArray(x)) return x.map((i) => String(i).trim()).filter(Boolean).join(" ");
  return typeof x === "string" ? x : "";
}

/** One reference through Claude Code: prepare, read, save. */
async function readOneWithClaudeCode(refId: string) {
  const r = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  if (!r) return;
  const model = settings.model();
  try {
    const { signals, palette } = await prepare(r);
    db.run("UPDATE reads SET palette = ?, palette_v = ?, signals = ? WHERE ref_id = ?", [JSON.stringify(palette), PALETTE_VERSION, JSON.stringify(signals), refId]);
    const { profile, usage, apiEquivalent } = await readWithClaudeCode(r, signals, palette, model, settings.effort());
    // Nothing is billed: it counts against the subscription's usage limits.
    db.run(
      `INSERT INTO ai_usage (at, ref_id, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost) VALUES (?, ?, ?, 'subscription', ?, ?, ?, ?, 0)`,
      [now(), refId, model, usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0],
    );
    db.run("UPDATE reads SET mode = 'subscription' WHERE ref_id = ?", [refId]);
    saveProfile(refId, model, profile, 0);
    console.log(`Reading: ${refId} read through Claude Code (${usage.output_tokens} tokens out, ~$${apiEquivalent.toFixed(3)} at API prices)`);
  } catch (e) {
    const message = (e as Error).message;
    if (isLimit(message)) {
      // Not this save's fault: put it back and let everything wait a few minutes.
      db.run("UPDATE reads SET state = 'queued' WHERE ref_id = ?", [refId]);
      ccPausedUntil = Date.now() + 5 * 60_000;
      lastStatus = "Claude's usage limit was reached; reading resumes by itself.";
      console.log(`Reading: limit reached, pausing (${message.slice(0, 160)})`);
    } else fail(refId, message);
  }
}

/** Works through everything queued, a few at a time, until the queue is empty. */
async function drainWithClaudeCode() {
  const next = () => {
    if (Date.now() < ccPausedUntil) return undefined;
    const q = db.query<{ ref_id: string }, []>("SELECT ref_id FROM reads WHERE state = 'queued' ORDER BY mode = 'now' DESC, queued_at LIMIT 1").get();
    if (q) db.run("UPDATE reads SET state = 'sent', batch_id = NULL WHERE ref_id = ?", [q.ref_id]);
    return q?.ref_id;
  };
  await Promise.all(
    Array.from({ length: CC_PARALLEL }, async () => {
      for (let id = next(); id; id = next()) await readOneWithClaudeCode(id);
    }),
  );
}


// ---------- Queue ----------

/** Ask for these to be read. Keeps any earlier profile until the new one arrives. */
export function queue(ids: string[], mode: "batch" | "now") {
  const ts = now();
  db.transaction(() => {
    for (const id of ids) {
      db.run(
        `INSERT INTO reads (ref_id, state, mode, queued_at) VALUES (?, 'queued', ?, ?)
         ON CONFLICT(ref_id) DO UPDATE SET state = 'queued', mode = excluded.mode, queued_at = excluded.queued_at, error = NULL
         WHERE reads.state != 'sent'`,
        [id, mode, ts],
      );
    }
  })();
  void tick(true);
}

/** Taken from the queue up to what's left of this month's budget. */
function affordable(ids: string[], batch: boolean) {
  const left = settings.cap() - spentThisMonth();
  const n = Math.max(0, Math.floor(left / typicalCost(batch)));
  return { take: ids.slice(0, n), over: ids.slice(n) };
}

async function readNow(refId: string) {
  const ai = await getClient();
  const r = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  if (!ai || !r) return;
  const model = settings.model();
  db.run("UPDATE reads SET state = 'sent' WHERE ref_id = ?", [refId]);
  try {
    const { signals, palette } = await prepare(r);
    db.run("UPDATE reads SET palette = ?, palette_v = ?, signals = ? WHERE ref_id = ?", [JSON.stringify(palette), PALETTE_VERSION, JSON.stringify(signals), refId]);
    const msg = await ai.messages.create(await requestFor(r, signals, palette, model));
    const cost = logUsage(refId, model, "now", msg.usage);
    saveProfile(refId, model, parseProfile(msg), cost);
  } catch (e) {
    fail(refId, (e as Error).message);
  }
}

async function sendBatch(ids: string[]) {
  const ai = await getClient();
  if (!ai || !ids.length) return;
  const model = settings.model();
  const requests: Anthropic.Messages.BatchCreateParams.Request[] = [];
  for (const id of ids) {
    const r = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(id);
    if (!r) continue;
    try {
      const { signals, palette } = await prepare(r);
      db.run("UPDATE reads SET palette = ?, palette_v = ?, signals = ? WHERE ref_id = ?", [JSON.stringify(palette), PALETTE_VERSION, JSON.stringify(signals), id]);
      requests.push({ custom_id: id, params: await requestFor(r, signals, palette, model) });
    } catch (e) {
      fail(id, (e as Error).message);
    }
  }
  if (!requests.length) return;
  try {
    const batch = await ai.messages.batches.create({ requests });
    db.transaction(() => {
      db.run("INSERT INTO read_batches (id, model, count, state, created_at) VALUES (?, ?, ?, 'in_progress', ?)", [batch.id, model, requests.length, now()]);
      for (const q of requests) db.run("UPDATE reads SET state = 'sent', batch_id = ?, model = ? WHERE ref_id = ?", [batch.id, model, q.custom_id]);
    })();
    console.log(`Reading: sent ${requests.length} to Anthropic in batch ${batch.id}`);
  } catch (e) {
    const message = `Couldn't send the batch: ${(e as Error).message}`;
    for (const q of requests) fail(q.custom_id, message);
  }
}

async function collect(batchId: string) {
  const ai = await getClient();
  if (!ai) return;
  const b = await ai.messages.batches.retrieve(batchId);
  if (b.processing_status !== "ended") return;
  const model = (db.query<{ model: string }, [string]>("SELECT model FROM read_batches WHERE id = ?").get(batchId)?.model ?? settings.model()) as ModelId;
  const seen = new Set<string>();
  for await (const res of await ai.messages.batches.results(batchId)) {
    seen.add(res.custom_id);
    const out = res.result;
    if (out.type === "succeeded") {
      const cost = logUsage(res.custom_id, model, "batch", out.message.usage);
      try {
        saveProfile(res.custom_id, model, parseProfile(out.message), cost);
      } catch (e) {
        fail(res.custom_id, (e as Error).message);
      }
    } else if (out.type === "errored") fail(res.custom_id, `Anthropic couldn't read it: ${out.error.error?.message ?? out.error.type}`);
    else fail(res.custom_id, out.type === "expired" ? "The batch ran out of time; read it again." : "The batch was canceled.");
  }
  // Anything the results didn't mention goes back in the queue.
  for (const { ref_id } of db.query<{ ref_id: string }, [string]>("SELECT ref_id FROM reads WHERE batch_id = ? AND state = 'sent'").all(batchId))
    if (!seen.has(ref_id)) db.run("UPDATE reads SET state = 'queued', batch_id = NULL WHERE ref_id = ?", [ref_id]);
  db.run("UPDATE read_batches SET state = 'ended', ended_at = ? WHERE id = ?", [now(), batchId]);
  console.log(`Reading: batch ${batchId} done (${seen.size} results)`);
}

// ---------- The loop ----------

let busy = false;
let lastStatus: string | null = null;
export const lastProblem = () => lastStatus;

/**
 * Runs every minute: picks up new saves, sends what's waiting, collects finished batches.
 * `urgent` sends batch-mode reads right away instead of waiting to group them.
 */
export async function tick(urgent = false) {
  if (busy) return;
  busy = true;
  try {
    const viaSubscription = settings.provider() === "claude-code";
    if (viaSubscription ? !(await claudeBinary()) : !(await getClient())) {
      lastStatus = viaSubscription ? "The claude command line isn't installed." : "No API key yet.";
      return;
    }
    lastStatus = null;

    if (settings.auto()) {
      const since = getSetting("ai_auto_since")!;
      const fresh = db
        .query<{ id: string }, [string]>(
          `SELECT r.id FROM refs r WHERE ${READABLE} AND r.created_at >= ? AND NOT EXISTS (SELECT 1 FROM reads x WHERE x.ref_id = r.id)`,
        )
        .all(since)
        .map((r) => r.id);
      const ts = now();
      for (const id of fresh) db.run("INSERT OR IGNORE INTO reads (ref_id, state, mode, queued_at) VALUES (?, 'queued', 'batch', ?)", [id, ts]);
    }

    // Batches already at Anthropic are collected whichever way new reads go.
    if (await getClient()) {
      for (const { id } of db.query<{ id: string }, []>("SELECT id FROM read_batches WHERE state = 'in_progress'").all()) {
        await collect(id).catch((e) => console.error(`Reading: checking batch ${id} failed:`, (e as Error).message));
      }
    }

    if (viaSubscription) {
      await drainWithClaudeCode();
      return;
    }

    const queued = db
      .query<{ ref_id: string; mode: string; queued_at: string }, []>("SELECT ref_id, mode, queued_at FROM reads WHERE state = 'queued' ORDER BY queued_at")
      .all();

    const now_ = queued.filter((q) => q.mode === "now").map((q) => q.ref_id);
    const nowOk = affordable(now_, false);
    for (const id of nowOk.take) await readNow(id);
    for (const id of nowOk.over) fail(id, "This month's AI budget is used up. Raise it, or wait for next month.");

    const batch = queued.filter((q) => q.mode === "batch");
    const oldest = batch[0] ? Date.parse(batch[0].queued_at) : Infinity;
    if (batch.length && (urgent || batch.length >= BATCH_MAX || Date.now() - oldest >= BATCH_WAIT_MS)) {
      const { take, over } = affordable(batch.map((q) => q.ref_id), true);
      for (let i = 0; i < take.length; i += BATCH_MAX) await sendBatch(take.slice(i, i + BATCH_MAX));
      if (over.length) lastStatus = `${over.length} waiting: this month's AI budget is used up.`;
    }
  } catch (e) {
    lastStatus = (e as Error).message;
    console.error("Reading:", e);
  } finally {
    busy = false;
  }
}

export function startReading() {
  // Reads that were running through Claude Code when Panel stopped start again.
  db.run("UPDATE reads SET state = 'queued' WHERE state = 'sent' AND batch_id IS NULL");
  void tick();
  setInterval(() => void tick(), 60_000);
}

/**
 * Palettes measured the older way are measured again from the same pictures, one every few
 * seconds, so they come out exact without reading anything again (it costs nothing). Each
 * measure holds the server for a moment; the pause keeps saving and browsing smooth.
 */
export function startRemeasuring() {
  let busy = false;
  const next = async () => {
    if (busy) return;
    const row = db
      .query<{ ref_id: string; signals: string }, [number]>(
        "SELECT ref_id, signals FROM reads WHERE signals IS NOT NULL AND palette IS NOT NULL AND (palette_v IS NULL OR palette_v < ?) ORDER BY read_at DESC LIMIT 1",
      )
      .get(PALETTE_VERSION);
    if (!row) return clearInterval(timer);
    busy = true;
    try {
      const paths = (JSON.parse(row.signals) as Signals).visuals.map((v) => abs(v.rel)).filter((p) => existsSync(p));
      const palette = paths.length ? await measurePalette(paths) : [];
      // Pictures gone from disk: keep the old palette rather than none.
      if (palette.length) db.run("UPDATE reads SET palette = ?, palette_v = ? WHERE ref_id = ?", [JSON.stringify(palette), PALETTE_VERSION, row.ref_id]);
      else db.run("UPDATE reads SET palette_v = ? WHERE ref_id = ?", [PALETTE_VERSION, row.ref_id]);
      reindex(row.ref_id);
    } catch (e) {
      db.run("UPDATE reads SET palette_v = ? WHERE ref_id = ?", [PALETTE_VERSION, row.ref_id]);
      console.error("Measuring colors again:", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void next(), 3000);
}

// ---------- For the API ----------

export function readOf(refId: string) {
  const row = db
    .query<{ state: string; mode: string; model: string | null; palette: string | null; signals: string | null; profile: string | null; error: string | null; cost: number | null; read_at: string | null }, [string]>(
      "SELECT state, mode, model, palette, signals, profile, error, cost, read_at FROM reads WHERE ref_id = ?",
    )
    .get(refId);
  if (!row) return null;
  const signals = row.signals ? (JSON.parse(row.signals) as Signals) : null;
  return {
    state: row.state,
    mode: row.mode,
    model: row.model,
    model_label: row.model ? (MODELS[row.model as ModelId]?.label ?? row.model) : null,
    palette: row.palette ? (JSON.parse(row.palette) as Swatch[]) : [],
    profile: row.profile ? (JSON.parse(row.profile) as Profile) : null,
    visuals: signals?.visuals.map((v) => ({ url: `/media/${v.rel}`, label: v.label })) ?? [],
    video: signals?.video ?? null,
    error: row.error,
    cost: row.cost,
    read_at: row.read_at,
  };
}

export async function status() {
  const counts = Object.fromEntries(
    db.query<{ state: string; n: number }, []>("SELECT state, COUNT(*) n FROM reads GROUP BY state").all().map((r) => [r.state, r.n]),
  );
  const usage = db
    .query<{ n: number; cost: number; input: number; output: number }, []>(
      "SELECT COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens),0) input, COALESCE(SUM(output_tokens),0) output FROM ai_usage WHERE mode != 'subscription'",
    )
    .get()!;
  const viaSubscription = db.query<{ n: number }, []>("SELECT COUNT(*) n FROM ai_usage WHERE mode = 'subscription'").get()!.n;
  return {
    key: await hasKey(),
    provider: settings.provider(),
    claude_code: !!(await claudeBinary()),
    effort: settings.effort(),
    subscription_reads: viaSubscription,
    model: settings.model(),
    models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
    auto: settings.auto(),
    cap: settings.cap(),
    spent_this_month: Math.round(spentThisMonth() * 10000) / 10000,
    per_read: usage.n ? { cost: usage.cost / usage.n, input_tokens: Math.round(usage.input / usage.n), output_tokens: Math.round(usage.output / usage.n), reads: usage.n } : null,
    queued: counts.queued ?? 0,
    sent: counts.sent ?? 0,
    done: counts.done ?? 0,
    failed: counts.failed ?? 0,
    unread: unreadIds().length,
    problem: Date.now() < ccPausedUntil ? "Claude's usage limit was reached; reading resumes by itself." : lastStatus,
  };
}
