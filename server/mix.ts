// The mix card: what a sketch takes from which save. One hero gives the structure (what sits
// where, the proportions, the rhythm down the page); one or two helpers each give one other
// thing (the color, the type, one detail). For each, the exact thing to take, what to leave,
// and which of the save's pictures shows it.
//
// Why it exists: FRIDAY copies one clear picture well, and mixes several badly when it works
// from what was written about them. Writing the mix down turns "mix these" into "copy this
// exact thing", and keeping it with the sketch lets the sketch come back with the pictures it
// took from beside it, so the two can be compared.
//
// It is kept per version in its own table (sketch_mix, made in db.ts). A version with no row of
// its own keeps the mix of the version before it, so small edits don't need to repeat it.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, now } from "./db.ts";
import { load } from "./library.ts";
import { run } from "./media.ts";
import { MEDIA_DIR } from "./config.ts";
import { standIn } from "./sheet.ts";

export interface Take {
  /** The save's id. */
  save: string;
  role: "hero" | "helper";
  /** What it gives: "structure", "color", "the glow", or a section's name on a whole page. */
  job: string;
  /** The exact thing: the move, the hex, the font, the proportion. */
  take: string;
  /** What not to take from it. */
  leave?: string;
  /** Which of the save's pictures shows it (its n in get_reference's pictures list). */
  picture?: number;
}

export interface Mix {
  /** 1 to 8, exactly one hero. */
  takes: Take[];
  /** What the saves have in common, one line. */
  shares?: string;
  /** The one thing that makes it not look like the hero. */
  unusual?: string;
  /** The parts that come from no save. */
  no_save_behind?: string[];
}

const cut = (s: string | undefined, n: number) => {
  const t = s?.trim();
  return t ? t.slice(0, n) : undefined;
};

/**
 * Checks a mix and tidies it. Throws a plain message FRIDAY can act on (and nothing is saved)
 * when it has no hero or two, names a save that isn't there, or doesn't say which picture of a
 * save with several shows what is taken.
 */
export function cleanMix(input: Mix): Mix {
  const takes = input.takes ?? [];
  const heroes = takes.filter((t) => t.role === "hero").length;
  if (heroes !== 1) throw new Error(`A mix has exactly one hero: the save that gives the structure. This one has ${heroes}.`);
  if (takes.length > 8) throw new Error(`A mix takes from 8 saves at most; this one has ${takes.length}. Three is the usual limit.`);
  const { docs } = load();
  const clean: Take[] = takes.map((t) => {
    const d = docs.get(t.save);
    if (!d) throw new Error(`No save with id ${t.save}.`);
    const count = d.visuals.length;
    if (t.picture === undefined && count > 1) {
      throw new Error(`Say which picture of ${t.save} shows what you take (picture: n). It has ${count} pictures; get_reference lists them.`);
    }
    if (t.picture !== undefined && (t.picture < 1 || t.picture > Math.max(count, 1))) {
      throw new Error(`${t.save} has ${count} picture${count === 1 ? "" : "s"}${count ? ` (1 to ${count})` : ""}, so there is no picture ${t.picture}. get_reference lists them.`);
    }
    return {
      save: t.save,
      role: t.role,
      job: cut(t.job, 40) ?? "",
      take: cut(t.take, 240) ?? "",
      leave: cut(t.leave, 160),
      picture: t.picture ?? (count === 1 ? 1 : undefined),
    };
  });
  // The hero first, so it is the first thing read and the first picture seen.
  clean.sort((a, b) => (a.role === "hero" ? 0 : 1) - (b.role === "hero" ? 0 : 1));
  const lines = (input.no_save_behind ?? []).map((x) => cut(x, 80)).filter((x): x is string => !!x).slice(0, 12);
  return {
    takes: clean,
    shares: cut(input.shares, 200),
    unusual: cut(input.unusual, 200),
    no_save_behind: lines.length ? lines : undefined,
  };
}

/** Keep a sketch version's mix. A version's mix can be written again (the fresh look adds its checks to it). */
export function saveMix(project: string, sketch: string, version: number, mix: Mix) {
  db.run(
    "INSERT INTO sketch_mix (sketch, version, project, mix, checks, created_at) VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT(sketch, version) DO UPDATE SET mix = excluded.mix, checks = NULL",
    [sketch, version, project, JSON.stringify(mix), now()],
  );
}

/**
 * The mix that holds for this version: its own, or the newest one before it. Null when it never
 * had one, or when the newest row has no takes (a version rebuilt from one that had no mix).
 */
export function mixOf(sketch: string, version: number): { mix: Mix; version: number; checks: unknown } | null {
  const row = db
    .query<{ mix: string; version: number; checks: string | null }, [string, number]>(
      "SELECT mix, version, checks FROM sketch_mix WHERE sketch = ? AND version <= ? ORDER BY version DESC LIMIT 1",
    )
    .get(sketch, version);
  if (!row) return null;
  try {
    const mix = JSON.parse(row.mix) as Mix;
    if (!mix.takes?.length) return null;
    return { mix, version: row.version, checks: row.checks ? JSON.parse(row.checks) : null };
  } catch {
    return null;
  }
}

/** The most pictures a sketch's answer carries of what it took from, hero first. */
const MIX_PICTURES = 6;

/**
 * For each take, hero first, the file of the picture it takes from and a caption that says
 * what was taken. A take whose save has no prepared picture uses the save's thumbnail.
 */
export function mixPictures(mix: Mix): { file: string; caption: string }[] {
  const { docs } = load();
  const out: { file: string; caption: string }[] = [];
  for (const t of mix.takes) {
    if (out.length >= MIX_PICTURES) break;
    const d = docs.get(t.save);
    if (!d) continue;
    const n = t.picture ?? (d.visuals.length === 1 ? 1 : undefined);
    const v = n ? d.visuals[n - 1] : undefined;
    const file = v ? join(MEDIA_DIR, v.rel) : standIn(d);
    if (!file || !existsSync(file)) continue;
    out.push({ file, caption: `Took from ${t.save}, ${v ? `picture ${n} (${v.label})` : "its thumbnail"}: ${t.job}: ${t.take}` });
  }
  return out;
}

/**
 * A picture made small for the sketch's answer: at most 768 px on its long side, so six of
 * them cost little beside the sketch's own screens. Made in the temp folder and deleted after
 * reading; if ffmpeg fails, the picture as it is.
 */
export async function smallPicture(file: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "panel-mix-"));
  try {
    const out = join(dir, "small.jpg");
    const { code } = await run(
      ["ffmpeg", "-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", "scale='min(768,iw)':'min(768,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-q:v", "4", out],
      10_000,
    );
    if (code === 0 && existsSync(out)) return Buffer.from(await Bun.file(out).arrayBuffer());
  } catch {
    /* the picture as it is, below */
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return Buffer.from(await Bun.file(file).arrayBuffer());
}
