// Colors measured from the pixels themselves, so a profile's hex values are exact,
// not an AI's guess. ffmpeg decodes each picture at a good size, and k-means (in Lab, where
// distance matches what the eye sees) finds the main colors.
//
// Only "pure" pixels count: ones that sit inside an area of their own color. Shrinking a
// picture, JPEG and anti-aliasing all blend neighbors, so a thin bright red line on black
// leaves a halo of dark reds that aren't really in the design. Measuring those (as an earlier
// version did, from a 72×72 thumbnail) reported #761417 for a cover printed in #EC1E28.

/** Raised whenever measuring changes, so older palettes are measured again (read.ts). */
export const PALETTE_VERSION = 2;

export interface Swatch {
  hex: string;
  /** Share of the picture, 0–1. */
  share: number;
  /** Plain name for search: "dark blue", "warm white". */
  name: string;
}

type RGB = [number, number, number];
type Lab = [number, number, number];

/** A picture's raw RGB pixels, its longest side at most `side`, keeping its shape. */
export async function image(path: string, side = 400): Promise<{ w: number; h: number; px: RGB[] } | null> {
  const proc = Bun.spawn(
    [
      "ffmpeg", "-v", "error", "-i", path, "-frames:v", "1",
      // Never enlarge; full_chroma_int keeps colored edges from smearing when JPEG's half-size color is rebuilt.
      "-vf", `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease:flags=area+accurate_rnd+full_chroma_int`,
      "-f", "image2pipe", "-c:v", "ppm", "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const buf = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await proc.exited;
  // A PPM starts with "P6 <width> <height> 255" and one whitespace, then the pixels.
  let pos = 0;
  const head: string[] = [];
  while (head.length < 4 && pos < buf.length) {
    let word = "";
    while (pos < buf.length && buf[pos]! > 32) word += String.fromCharCode(buf[pos++]!);
    pos++;
    if (word) head.push(word);
  }
  const w = Number(head[1]), h = Number(head[2]);
  if (head[0] !== "P6" || !w || !h || buf.length - pos < w * h * 3) return null;
  const px: RGB[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) px[i] = [buf[pos + i * 3]!, buf[pos + i * 3 + 1]!, buf[pos + i * 3 + 2]!];
  return { w, h, px };
}

/**
 * From one picture: the pure pixels to find colors with, and an even sample of every pixel to
 * say how much of the picture each color covers. A pixel is pure when at least three of its four
 * neighbors look the same as it (ΔE under `flat`): that keeps the middle of a thin line and drops
 * the blended edge on either side of it. A grainy photo has few such pixels, so the bar is raised
 * until at least a fifth of the picture passes.
 */
function samplePixels(img: { w: number; h: number; px: RGB[] }, cap: number): { pure: RGB[]; every: RGB[] } {
  const { w, h, px } = img;
  const lab = px.map(toLab);
  // For each pixel, the third-largest difference to its four neighbors: under the bar means three match.
  const near = new Float32Array(w * h).fill(Infinity);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const d = [dist(lab[i]!, lab[i - 1]!), dist(lab[i]!, lab[i + 1]!), dist(lab[i]!, lab[i - w]!), dist(lab[i]!, lab[i + w]!)].sort((a, b) => a - b);
      near[i] = d[2]!;
    }
  let picked: number[] = [];
  for (const flat of [6, 10, 16, 26]) {
    picked = [];
    for (let i = 0; i < near.length; i++) if (near[i]! < flat) picked.push(i);
    if (picked.length >= near.length * 0.2) break;
  }
  // Too small or too busy to judge: use every pixel rather than none.
  if (picked.length < 50) picked = px.map((_, i) => i);
  const spread = (from: number[] | null, n: number) => {
    const out: RGB[] = [];
    const step = Math.max(1, n / cap);
    for (let k = 0; k < n; k += step) out.push(px[from ? from[Math.floor(k)]! : Math.floor(k)]!);
    return out;
  };
  return { pure: spread(picked, picked.length), every: spread(null, px.length) };
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function toLab([r, g, b]: RGB): Lab {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** The main colors across several pictures, each picture counting equally. */
export async function measurePalette(paths: string[], max = 6): Promise<Swatch[]> {
  // About 40,000 pixels in all, each picture giving the same number so each counts equally.
  // A video read can bring dozens of frames; those are decoded smaller.
  const cap = Math.max(400, Math.floor(40_000 / Math.max(1, paths.length)));
  const side = paths.length > 12 ? 200 : 400;
  const all: RGB[] = [];
  const every: RGB[] = [];
  for (const p of paths) {
    const img = await image(p, side);
    if (!img) continue;
    const s = samplePixels(img, cap);
    for (const c of s.pure) all.push(c);
    for (const c of s.every) every.push(c);
  }
  if (!all.length) return [];
  const labs = all.map(toLab);

  // Deterministic k-means++ start: the first center is the pixel nearest the mean,
  // each next one the pixel farthest from every center so far.
  const k = 10;
  const mean: Lab = [0, 1, 2].map((i) => labs.reduce((s, l) => s + l[i]!, 0) / labs.length) as Lab;
  let centers: Lab[] = [labs.reduce((best, l) => (dist(l, mean) < dist(best, mean) ? l : best))];
  while (centers.length < k) {
    let far = labs[0]!, farD = -1;
    for (const l of labs) {
      const d = Math.min(...centers.map((c) => dist(l, c)));
      if (d > farD) { farD = d; far = l; }
    }
    if (farD < 2) break;
    centers.push(far);
  }

  let assign = new Array<number>(labs.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    assign = labs.map((l) => {
      let bi = 0, bd = Infinity;
      centers.forEach((c, i) => { const d = dist(l, c); if (d < bd) { bd = d; bi = i; } });
      return bi;
    });
    centers = centers.map((c, i) => {
      const mine = labs.filter((_, j) => assign[j] === i);
      if (!mine.length) return c;
      return [0, 1, 2].map((d) => mine.reduce((s, l) => s + l[d]!, 0) / mine.length) as Lab;
    });
  }

  // Each cluster is shown as the average of its real pixels (in RGB, so the hex is a real color).
  const clusters = centers.map((_, i) => {
    const px = all.filter((_, j) => assign[j] === i);
    const rgb = [0, 1, 2].map((d) => px.reduce((s, p) => s + p[d]!, 0) / (px.length || 1)) as RGB;
    return { rgb, lab: toLab(rgb), n: px.length };
  }).filter((c) => c.n > 0);

  // Merge colors the eye wouldn't tell apart.
  clusters.sort((a, b) => b.n - a.n);
  const merged: typeof clusters = [];
  for (const c of clusters) {
    const twin = merged.find((m) => dist(m.lab, c.lab) < 9);
    if (twin) {
      const n = twin.n + c.n;
      twin.rgb = [0, 1, 2].map((d) => (twin.rgb[d]! * twin.n + c.rgb[d]! * c.n) / n) as RGB;
      twin.lab = toLab(twin.rgb);
      twin.n = n;
    } else merged.push({ ...c });
  }

  // How much of the picture each color covers, counting every pixel, blended edges included
  // (each goes to the color it's nearest): a thin red line still counts at its full size.
  const found = merged.map((m) => ({ ...m, pure: m.n / all.length, n: 0 }));
  for (const c of every) {
    const l = toLab(c);
    let best = found[0]!, bd = Infinity;
    for (const m of found) { const d = dist(l, m.lab); if (d < bd) { bd = d; best = m; } }
    best.n++;
  }

  // A halo is not a color of the design: the dark red around a red line on black is a mix of the
  // two, and almost none of it sits in a clean area. Fold such colors into the nearer of the two
  // they're mixed from. A photo's smooth gradient is clean all along, so its middle tones stay.
  const total = every.length;
  // The mixed-from colors must be clearly cleaner, not bigger: around many thin lines, the halo
  // can cover more of the picture than the line itself.
  const live = found.filter((m) => m.n > 0).sort((a, b) => a.pure - b.pure);
  for (const c of [...live]) {
    const share = c.n / total;
    if (!share || c.pure / share > 0.25) continue;
    const cleaner = live.filter((m) => m !== c && m.n > 0 && m.pure > c.pure * 3 + 0.002);
    let into: (typeof live)[number] | null = null;
    for (const a of cleaner)
      for (const b of cleaner) {
        if (a === b) continue;
        const t = mixAmount(c.rgb, a.rgb, b.rgb);
        if (t === null) continue;
        const nearer = t < 0.5 ? a : b;
        if (!into || dist(c.lab, nearer.lab) < dist(c.lab, into.lab)) into = nearer;
      }
    if (into) {
      into.n += c.n;
      c.n = 0;
    }
  }
  const colors = live.filter((m) => m.n > 0).sort((a, b) => b.n - a.n);

  // Keep the big ones, plus any small but vivid accent (a 2% orange button matters).
  const chroma = (l: Lab) => Math.hypot(l[1], l[2]);
  // A small color that is almost never found in a clean area is edge noise, not part of the design.
  const real = colors.filter((c) => c.n / total >= 0.04 || c.pure / (c.n / total) >= 0.25);
  const kept = real.filter((c, i) => i < 4 || c.n / total >= 0.04 || (c.n / total >= 0.008 && chroma(c.lab) > 35));
  // When there are more than `max`, a vivid accent beats the smallest dull color (a yellow
  // highlight says more about a design than its fourth gray). The three biggest always stay.
  const vivid = (c: (typeof kept)[number]) => chroma(c.lab) > 35;
  const pick = kept.slice(0, max);
  for (const accent of kept.slice(max).filter(vivid)) {
    let at = -1;
    for (let i = pick.length - 1; i >= 3; i--) if (!vivid(pick[i]!)) { at = i; break; }
    if (at < 0) break;
    pick[at] = accent;
  }
  pick.sort((x, y) => y.n - x.n);
  return pick.map((c) => ({ hex: hex(c.rgb), share: Math.round((c.n / total) * 1000) / 1000, name: colorName(c.rgb) }));
}

/**
 * If `c` looks like a mix of `a` and `b` (as pixels blend at an edge, in the file's own RGB),
 * how much of `b` is in it, 0–1; null when it isn't such a mix or is nearly one of the two.
 */
function mixAmount(c: RGB, a: RGB, b: RGB): number | null {
  const ab = [0, 1, 2].map((i) => b[i]! - a[i]!);
  const len = ab.reduce((s, v) => s + v * v, 0);
  if (len < 1) return null;
  const t = [0, 1, 2].reduce((s, i) => s + (c[i]! - a[i]!) * ab[i]!, 0) / len;
  if (t < 0.08 || t > 0.92) return null;
  const mix = [0, 1, 2].map((i) => a[i]! + ab[i]! * t) as RGB;
  return dist(toLab(c), toLab(mix)) < 6 ? t : null;
}

/** OKLCH: a color space where equal hue steps look equal, so hue ranges name colors reliably. */
function oklch([r, g, b]: RGB): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(Bb, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(A, Bb), h];
}

/** A plain name for a color, good enough for search ("orange", "dark blue", "off-white"). */
export function colorName(rgb: RGB): string {
  const [L, C, h] = oklch(rgb);
  const warm = h > 40 && h < 115;
  if (C < 0.03) {
    if (L < 0.2) return "black";
    if (L > 0.97) return "white";
    if (L > 0.9) return warm && C > 0.008 ? "warm white" : "off-white";
    if (L < 0.35) return "charcoal";
    return warm && C > 0.012 ? "warm gray" : "gray";
  }
  let hue: string;
  if (h < 45 || h >= 350) hue = L > 0.7 && C < 0.16 ? "pink" : "red";
  else if (h < 75) hue = L < 0.5 ? "brown" : C < 0.08 ? (L > 0.8 ? "beige" : "tan") : L > 0.82 ? "peach" : "orange";
  else if (h < 110) hue = L < 0.55 ? (h > 95 ? "olive" : "brown") : C < 0.08 ? (L > 0.8 ? "cream" : "khaki") : "yellow";
  else if (h < 165) hue = "green";
  else if (h < 215) hue = "teal";
  else if (h < 270) hue = L < 0.4 ? "navy" : "blue";
  else if (h < 310) hue = "purple";
  else hue = L > 0.75 ? "pink" : "magenta";
  const fixed = ["beige", "tan", "cream", "khaki", "peach", "brown", "olive", "navy", "pink"].includes(hue);
  const tone = L < 0.35 ? "dark " : L > 0.87 && !fixed ? "light " : "";
  return `${tone}${C < 0.06 && !fixed ? "muted " : ""}${hue}`;
}
