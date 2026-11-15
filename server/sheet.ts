// The sheet: one picture holding up to 16 saves as small numbered pictures, sent with every
// search so FRIDAY can choose by eye and not only by what was written about the saves.
//
// Why one sheet and not a picture per save: the Claude API limits how many pictures one
// conversation may hold, and twelve a search would reach that limit in a long chat. One sheet
// is one picture.
//
// Why the numbers are drawn from small boxes: the ffmpeg on this Mac has no drawtext, so each
// digit is drawn the way a calculator draws it, from up to seven bars. Headless Chrome could
// write real text but is far too slow to run on every search; this takes about 80 ms.
//
// Nothing here is written into the library: the sheet is made in the system's temp folder,
// read, and deleted. When anything goes wrong the search simply answers without a sheet.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_DIR } from "./config.ts";
import { load, type Doc } from "./library.ts";
import { run } from "./media.ts";

const COLS = 4, W = 300, H = 225, GAP = 6;
/** The most saves one sheet holds. Cards past it get no number. */
export const SHEET_MAX = 16;
/** A sheet that takes longer than this is given up on, and the search answers without one. */
const TIMEOUT = 10_000;

/** Which bars light up for each digit, as on a calculator (a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle). */
const SEG: Record<string, string> = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg" };

/** One digit as a calculator draws it: up to seven small white bars. */
function digit(d: string, x: number, y: number) {
  const t = 3, w = 12, h = 20, half = (h - t) / 2;
  const bar: Record<string, [number, number, number, number]> = {
    a: [x, y, w, t], g: [x, y + half, w, t], d: [x, y + h - t, w, t],
    f: [x, y, t, half + t], b: [x + w - t, y, t, half + t], e: [x, y + half, t, half + t], c: [x + w - t, y + half, t, half + t],
  };
  return [...SEG[d]!].map((s) => {
    const [bx, by, bw, bh] = bar[s]!;
    return `drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=white:t=fill`;
  });
}

/**
 * The one picture that stands for a save on a sheet. A site's thumbnail is the whole long page
 * squeezed small, which says nothing at this size, so a site shows its first screen instead.
 */
export function standIn(d: Doc): string | null {
  const at = (rel: string | null | undefined) => (rel ? join(MEDIA_DIR, rel) : null);
  const candidates = [
    d.type === "site" ? at(d.visuals.find((v) => v.label.startsWith("Desktop, screen 1 "))?.rel) : null,
    at(d.media[0]?.thumb_path),
    at(d.r.preview_path),
    at(d.visuals[0]?.rel),
  ];
  return candidates.find((f): f is string => !!f && existsSync(f)) ?? null;
}

// Sheets are made one at a time, so ten searches at once don't start ten ffmpegs.
let queue: Promise<unknown> = Promise.resolve();

/**
 * One JPEG of these saves (at most 16), numbered 1, 2, 3… in the order given. A save with no
 * picture on disk keeps its place as an empty light cell, so the numbers always match the cards.
 * Returns null, and never throws, when none of them has a picture or anything goes wrong.
 */
export function makeSheet(ids: string[]): Promise<{ jpeg: Buffer } | null> {
  const next = queue.then(() => build(ids.slice(0, SHEET_MAX))).catch(() => null);
  queue = next;
  return next;
}

async function build(ids: string[]): Promise<{ jpeg: Buffer } | null> {
  if (!ids.length) return null;
  const { docs } = load();
  const files = ids.map((id) => {
    const d = docs.get(id);
    return d ? standIn(d) : null;
  });
  if (!files.some(Boolean)) return null;

  const cells = files.map((_, i) => ({ x: GAP + (i % COLS) * (W + GAP), y: GAP + Math.floor(i / COLS) * (H + GAP) }));
  const SW = GAP + COLS * (W + GAP), SH = GAP + Math.ceil(files.length / COLS) * (H + GAP);
  // Input 0 is the white ground; inputs 1..n are the pictures, or a light gray cell for a save with none.
  const inputs = files.flatMap((f) => (f ? ["-i", f] : ["-f", "lavfi", "-i", `color=c=0xEEEEEE:s=${W}x${H}`]));
  // A picture taller than 4:5 is cut to its top 4:5 first, then fitted in its cell without stretching.
  const scaled = files.map((_, i) => `[${i + 1}:v]crop=iw:'min(ih\\,iw*1.25)':0:0,scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:-1:-1:color=0xEEEEEE[c${i}]`);
  const overlays = files.map((_, i) => `${i ? `[o${i - 1}]` : "[0:v]"}[c${i}]overlay=${cells[i]!.x}:${cells[i]!.y}[o${i}]`);
  // Each cell's number in its top left corner: a black box with white digits.
  const marks = cells.flatMap((c, i) => {
    const n = String(i + 1);
    return [`drawbox=x=${c.x}:y=${c.y}:w=${12 + n.length * 16}:h=32:color=black:t=fill`, ...[...n].flatMap((d, k) => digit(d, c.x + 7 + k * 16, c.y + 6))];
  });
  const filter = [...scaled, ...overlays].join(";") + `;[o${files.length - 1}]${marks.join(",")}[out]`;

  const dir = mkdtempSync(join(tmpdir(), "panel-sheet-"));
  try {
    const out = join(dir, "sheet.jpg");
    const { code } = await run(
      ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=white:s=${SW}x${SH}`, ...inputs, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", "-q:v", "4", out],
      TIMEOUT,
    );
    if (code !== 0 || !existsSync(out)) return null;
    return { jpeg: Buffer.from(await Bun.file(out).arrayBuffer()) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
