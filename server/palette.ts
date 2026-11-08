// Colors measured from the pixels themselves, so a profile's hex values are exact,
// not an AI's guess. ffmpeg shrinks each picture to a small grid of raw RGB pixels,
// and k-means (in Lab, where distance matches what the eye sees) finds the main colors.

export interface Swatch {
  hex: string;
  /** Share of the picture, 0–1. */
  share: number;
  /** Plain name for search: "dark blue", "warm white". */
  name: string;
}

type RGB = [number, number, number];
type Lab = [number, number, number];

/** Raw RGB pixels of a picture, shrunk to side×side. */
export async function pixels(path: string, side = 72): Promise<RGB[]> {
  const proc = Bun.spawn(
    ["ffmpeg", "-v", "error", "-i", path, "-frames:v", "1", "-vf", `scale=${side}:${side}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const buf = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await proc.exited;
  const out: RGB[] = [];
  for (let i = 0; i + 2 < buf.length; i += 3) out.push([buf[i]!, buf[i + 1]!, buf[i + 2]!]);
  return out;
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
  const all: RGB[] = [];
  for (const p of paths) all.push(...(await pixels(p)));
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
  let clusters = centers.map((_, i) => {
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
  clusters = merged.sort((a, b) => b.n - a.n);

  // Keep the big ones, plus any small but vivid accent (a 2% orange button matters).
  const total = all.length;
  const chroma = (l: Lab) => Math.hypot(l[1], l[2]);
  const kept = clusters.filter((c, i) => i < 4 || c.n / total >= 0.04 || (c.n / total >= 0.008 && chroma(c.lab) > 35));
  return kept.slice(0, max).map((c) => ({ hex: hex(c.rgb), share: Math.round((c.n / total) * 1000) / 1000, name: colorName(c.rgb) }));
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
