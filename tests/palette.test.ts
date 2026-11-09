// Colors are measured from the pixels, and must be the ones really printed: a thin bright line
// on black must come out as its own red, not as the dark reds its blurred edges make.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measurePalette } from "../server/palette.ts";

const dir = mkdtempSync(join(tmpdir(), "panel-palette-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A picture made of `paint(x, y)`, saved as a JPEG the way pictures usually reach Panel. */
async function picture(name: string, w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const head = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
  const px = new Uint8Array(head.length + w * h * 3);
  px.set(head);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) px.set(paint(x, y), head.length + (y * w + x) * 3);
  const ppm = join(dir, `${name}.ppm`), jpg = join(dir, `${name}.jpg`);
  writeFileSync(ppm, px);
  const p = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-i", ppm, "-q:v", "4", jpg]);
  await p.exited;
  return jpg;
}

const de = (a: string, b: string) => {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
};

test("thin bright lines on black come out as their own color, without halos", async () => {
  const red: [number, number, number] = [236, 32, 40];
  // A maze of 6px red lines every 30px on black, and a white margin, like a magazine cover.
  const jpg = await picture("maze", 980, 1220, (x, y) =>
    x < 90 || x > 890 || y < 120 || y > 1100 ? [238, 238, 238] : x % 30 < 6 || y % 45 < 6 ? red : [3, 2, 2]);
  const palette = await measurePalette([jpg]);
  const reds = palette.filter((s) => s.name.includes("red"));
  expect(reds.length).toBe(1);
  expect(de(reds[0]!.hex, "#ec2028")).toBeLessThan(18);
  // The lines cover about a fifth of the black area; their share must not shrink to a sliver.
  expect(reds[0]!.share).toBeGreaterThan(0.08);
});

test("a small vivid accent stays even when there are many grays", async () => {
  const jpg = await picture("grays", 600, 600, (x, y) =>
    x >= 540 && y >= 540 ? [254, 238, 9] : [[246, 246, 247], [197, 193, 192], [146, 138, 131], [104, 94, 79], [24, 25, 26], [172, 142, 99]][Math.floor(x / 100)] as [number, number, number]);
  const palette = await measurePalette([jpg]);
  expect(palette.some((s) => de(s.hex, "#feee09") < 25)).toBe(true);
});
