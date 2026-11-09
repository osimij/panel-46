// The designer's rules (unugly.md), where a machine can check them. When Panel renders a
// sketch or a build in Chrome it also measures the page: corners without smoothing, a
// letter-spaced name in the navbar, a font with no Tajik letters, and the signs of generic
// design the rules list. Claude gets what was found next to the pictures, so a rule isn't
// only something it was asked to remember.
//
// A check runs only while unugly.md still talks about it: delete a rule there and its check
// goes quiet. Rules that take an eye (does the paper look real?) stay with whoever is looking.

import { designRules } from "./rules.ts";

export interface RuleFinding {
  /** The rule's name, as unugly.md calls it. */
  rule: string;
  /** breaks: the rule says never. check: allowed with a real reason, so look at it. */
  level: "breaks" | "check";
  what: string;
  /** A few of the places, as short CSS-like names or the words themselves. */
  where?: string[];
}

/** Which checks the rules file asks for right now. */
function wanted(rules: string) {
  const has = (re: RegExp) => re.test(rules);
  return {
    corners: has(/corner smoothing|continuous corners|squircle/i),
    wordmark: has(/wordmark|letter-spacing/i),
    cyrillic: has(/cyrillic/i),
    tajik: has(/tajik/i),
    instrument: has(/instrument serif/i),
    kerning: has(/negative kerning/i),
    italic: has(/italic/i),
    eyebrow: has(/eyebrow/i),
    numbering: has(/section numbering/i),
    dividers: has(/divider/i),
    borders: has(/containers with borders/i),
    tags: has(/^\s*-\s*tags\b/im),
    breadcrumbs: has(/code breadcrumbs/i),
  };
}

/** Runs inside the page. Kept as one function so it can be sent to Chrome as text. */
function measure(on: ReturnType<typeof wanted>): RuleFinding[] {
  const out: RuleFinding[] = [];
  const all = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => !el.closest("[data-panel-kit]")).slice(0, 4000);
  const styles = new Map<HTMLElement, CSSStyleDeclaration>();
  const cs = (el: HTMLElement) => styles.get(el) ?? (styles.set(el, getComputedStyle(el)), styles.get(el)!);
  const box = new Map<HTMLElement, DOMRect>();
  const rect = (el: HTMLElement) => box.get(el) ?? (box.set(el, el.getBoundingClientRect()), box.get(el)!);
  const shown = (el: HTMLElement) => {
    const r = rect(el), c = cs(el);
    return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none" && Number(c.opacity) > 0.05;
  };
  /** The words written straight in this element, not in its children. */
  const own = (el: HTMLElement) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
  const name = (el: HTMLElement) => {
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : cls);
  };
  const some = (list: string[], n = 4) => {
    const u = [...new Set(list)];
    return u.length > n ? [...u.slice(0, n), `and ${u.length - n} more`] : u;
  };
  const px = (v: string) => parseFloat(v) || 0;
  const alpha = (color: string) => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return color === "transparent" ? 0 : 1;
    const p = m[1]!.split(/[,/ ]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]!) : 1;
  };
  const lum = (color: string) => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const [r, g, b] = m[1]!.split(/[,/ ]+/).filter(Boolean).map(Number) as [number, number, number];
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /** The color behind an element: its own background, or the nearest one up the tree. */
  const behind = (el: HTMLElement | null): string => {
    for (let e = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (alpha(bg) > 0.5) return bg;
    }
    return "rgb(255, 255, 255)";
  };
  const visible = all.filter(shown);
  const texts = visible.map((el) => ({ el, text: own(el) })).filter((x) => x.text);
  const family = (el: HTMLElement) => (cs(el).fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim();

  // ---- Corners: every radius is a smoothed one ----
  if (on.corners && CSS.supports("corner-shape", "squircle")) {
    const plain: string[] = [];
    for (const el of visible) {
      const c = cs(el), r = rect(el);
      if (r.width < 16 || r.height < 16) continue;
      const radii = [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius].map(px);
      const radius = Math.max(...radii);
      if (radius < 3) continue;
      // A full circle or capsule: smoothing changes nothing you could see.
      if (radius >= Math.min(r.width, r.height) / 2 - 0.5) continue;
      const shapes = ["corner-top-left-shape", "corner-top-right-shape", "corner-bottom-right-shape", "corner-bottom-left-shape"].map((p) => c.getPropertyValue(p).trim());
      // Chrome reports the plain circular corner as "round" or as "superellipse(1)".
      if (shapes.some((s) => s && s !== "round" && s !== "superellipse(1)")) continue;
      // Drawn as its own shape (an SVG squircle used as a clip or a mask): smoothed another way.
      if (c.clipPath !== "none" || (c.maskImage && c.maskImage !== "none")) continue;
      // A radius only shows on something with a fill, an edge, a shadow, or that clips what's inside.
      const drawn = alpha(c.backgroundColor) > 0.02 || c.backgroundImage !== "none" || px(c.borderTopWidth) > 0 || c.boxShadow !== "none" || c.overflow !== "visible" || /^(IMG|VIDEO|CANVAS)$/.test(el.tagName);
      if (drawn) plain.push(`${name(el)} (${Math.round(radius)}px)`);
    }
    if (plain.length) out.push({ rule: "Corners", level: "breaks", what: `${plain.length} rounded ${plain.length === 1 ? "element has" : "elements have"} a plain circular radius, with no corner smoothing. Add corner-shape: squircle (keep border-radius as the fallback).`, where: some(plain) });
  }

  // ---- Wordmark: never the name with wide letter-spacing in the navbar ----
  if (on.wordmark) {
    const spaced = texts.filter(({ el, text }) => {
      const c = cs(el), size = px(c.fontSize) || 16;
      const inNav = !!el.closest("nav, header, [role=banner], [role=navigation]") || rect(el).top + scrollY < 110;
      return inNav && text.length >= 2 && text.length <= 24 && px(c.letterSpacing) / size >= 0.1;
    });
    if (spaced.length) out.push({ rule: "Wordmark", level: "breaks", what: "A name or label in the navbar is set with wide letter-spacing. Set it as plain text, or give it a real symbol.", where: some(spaced.map((x) => `“${x.text}”`)) });
  }

  // ---- Type: Instrument Serif, negative kerning, italics ----
  if (on.instrument) {
    const used = texts.filter(({ el }) => /instrument serif/i.test(family(el)));
    if (used.length) out.push({ rule: "Instrument Serif", level: "check", what: "Instrument Serif is on the page. It's on the list of signs of generic design: use it only with a real reason.", where: some(used.map((x) => `“${x.text.slice(0, 40)}”`), 3) });
  }
  if (on.kerning) {
    const tight = texts.filter(({ el }) => {
      const c = cs(el), size = px(c.fontSize) || 16;
      return size >= 28 && px(c.letterSpacing) / size <= -0.02;
    });
    if (tight.length) out.push({ rule: "Negative kerning", level: "check", what: `${tight.length} large ${tight.length === 1 ? "line is" : "lines are"} tracked tighter than the font's own spacing.`, where: some(tight.map((x) => `“${x.text.slice(0, 40)}”`), 3) });
  }
  if (on.italic) {
    const it = texts.filter(({ el }) => cs(el).fontStyle === "italic");
    if (it.length) out.push({ rule: "Italicized words", level: "check", what: `${it.length} ${it.length === 1 ? "piece of text is" : "pieces of text are"} in italics.`, where: some(it.map((x) => `“${x.text.slice(0, 40)}”`), 3) });
  }

  // ---- Small labels: eyebrows, section numbers, code breadcrumbs, tags ----
  const big = (el: Element | null) => !!el && (/^H[1-3]$/.test(el.tagName) || px(getComputedStyle(el).fontSize) >= 26);
  if (on.eyebrow) {
    const brows = texts.filter(({ el, text }) => {
      const c = cs(el), size = px(c.fontSize) || 16;
      if (size > 15 || text.length > 44) return false;
      const labelLike = c.textTransform === "uppercase" || px(c.letterSpacing) / size >= 0.05 || /mono/i.test(c.fontFamily.split(",")[0] ?? "");
      const next = el.nextElementSibling ?? el.parentElement?.nextElementSibling ?? null;
      return labelLike && big(next) && !el.closest("nav, header, button, a");
    });
    if (brows.length) out.push({ rule: "Eyebrows", level: "check", what: `${brows.length} small ${brows.length === 1 ? "label sits" : "labels sit"} above a heading. Make each one beautiful or leave it out.`, where: some(brows.map((x) => `“${x.text}”`)) });
  }
  if (on.numbering) {
    const nums = texts.filter(({ text }) => /^\(?0\d\)?[.:/—–-]?$/.test(text) || /^0\d\s*[—–/.:-]\s*\S/.test(text));
    if (nums.length >= 2) out.push({ rule: "Section numbering", level: "check", what: `Sections are numbered (${nums.length} numbers).`, where: some(nums.map((x) => `“${x.text.slice(0, 24)}”`), 3) });
  }
  if (on.breadcrumbs) {
    const crumbs = texts.filter(({ el, text }) => /mono/i.test(cs(el).fontFamily.split(",")[0] ?? "") && text.length <= 48 && !el.closest("pre, code") && /^(\/\/|\/\*|#\s|>\s|\$\s|~\/|\.\/|\[)/.test(text));
    if (crumbs.length) out.push({ rule: "Code breadcrumbs", level: "check", what: `${crumbs.length} small code-style ${crumbs.length === 1 ? "label" : "labels"} (like “// section”).`, where: some(crumbs.map((x) => `“${x.text}”`), 3) });
  }
  if (on.tags) {
    const pills = texts.filter(({ el, text }) => {
      const c = cs(el), r = rect(el);
      if (r.height > 34 || r.height < 14 || r.width > 220 || text.length > 28) return false;
      if (el.closest("button, a, label, input, select, nav")) return false;
      const filled = alpha(c.backgroundColor) > 0.02 || px(c.borderTopWidth) > 0;
      return filled && px(c.borderTopLeftRadius) >= 3 && px(c.paddingLeft) >= 4;
    });
    if (pills.length >= 3) out.push({ rule: "Tags", level: "check", what: `${pills.length} tag-like pills.`, where: some(pills.map((x) => `“${x.text}”`)) });
  }

  // ---- Lines and boxes ----
  if (on.dividers) {
    const solid: string[] = [];
    for (const el of visible) {
      const c = cs(el), r = rect(el);
      if (r.width < 80) continue;
      const sides = [["Top", c.borderTopWidth, c.borderTopStyle], ["Bottom", c.borderBottomWidth, c.borderBottomStyle], ["Left", c.borderLeftWidth, c.borderLeftStyle], ["Right", c.borderRightWidth, c.borderRightStyle]] as const;
      const drawn = sides.filter(([, w, s]) => px(w) > 0 && s !== "none" && s !== "hidden");
      const rule = el.tagName === "HR" || (r.height <= 2 && alpha(c.backgroundColor) > 0.05);
      const oneEdge = drawn.length === 1 && (drawn[0]![0] === "Top" || drawn[0]![0] === "Bottom") && drawn[0]![2] === "solid";
      if (rule || oneEdge) solid.push(name(el));
    }
    if (solid.length >= 3) out.push({ rule: "Dividers", level: "check", what: `${solid.length} solid divider lines. Dotted or dashed ones can be good; solid ones need a reason.`, where: some(solid) });
  }
  if (on.borders) {
    const boxes: string[] = [];
    for (const el of visible) {
      const c = cs(el), r = rect(el);
      if (r.width < 120 || r.height < 60 || /^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|VIDEO)$/.test(el.tagName)) continue;
      const w = [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth].map(px);
      if (w.some((x) => x <= 0) || c.borderTopStyle === "none") continue;
      const a = lum(c.borderTopColor), b = lum(behind(el.parentElement));
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      // A light, low-contrast border is fine by the rules; a clear outline is what to look at.
      if (alpha(c.borderTopColor) > 0.2 && contrast >= 1.35) boxes.push(name(el));
    }
    if (boxes.length >= 2) out.push({ rule: "Containers with borders", level: "check", what: `${boxes.length} boxes have a clearly visible border. Fine only when the border is low-contrast and feels light.`, where: some(boxes) });
  }

  // ---- Cyrillic and Tajik: does each font really have the letters? ----
  if (on.cyrillic || on.tajik) {
    const TAJIK = "ҒғӢӣҚқӮӯҲҳҶҷ";
    const byFamily = new Map<string, Set<string>>();
    for (const { el, text } of texts) {
      const cyr = text.match(/[Ѐ-ԯ]/g);
      if (!cyr) continue;
      const f = family(el);
      const set = byFamily.get(f) ?? byFamily.set(f, new Set()).get(f)!;
      for (const ch of cyr) if (set.size < 400) set.add(ch);
    }
    if (byFamily.size) {
      const ctx = document.createElement("canvas").getContext("2d")!;
      const width = (ch: string, fam: string, fallback: string) => {
        ctx.font = `400 48px "${fam}", ${fallback}`;
        return ctx.measureText(ch).width;
      };
      /** A letter the font doesn't have is drawn by the fallback, and two different fallbacks give two widths. */
      const lacks = (ch: string, fam: string) => Math.abs(width(ch, fam, "monospace") - width(ch, fam, "serif")) > 0.01;
      const generic = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|cursive|fantasy|inherit|)$/i;
      for (const [fam, used] of byFamily) {
        if (generic.test(fam)) continue;
        // Not loaded at all (every letter falls back): that's a page error, reported with the others.
        if (lacks("a", fam) && lacks("n", fam)) {
          out.push({ rule: "Cyrillic type", level: "breaks", what: `The font “${fam}” didn't load, so its text is shown in a fallback font.` });
          continue;
        }
        const missing = [...used].filter((ch) => lacks(ch, fam));
        const missingTajik = missing.filter((ch) => TAJIK.includes(ch));
        const missingOther = missing.filter((ch) => !TAJIK.includes(ch));
        if (on.cyrillic && missingOther.length) out.push({ rule: "Cyrillic type", level: "breaks", what: `“${fam}” has no ${missingOther.slice(0, 12).join(" ")}: those letters are drawn by another font. Use a font with real Cyrillic.` });
        if (on.tajik && missingTajik.length) out.push({ rule: "Cyrillic type", level: "breaks", what: `“${fam}” has no Tajik ${missingTajik.join(" ")}: they are drawn by another font and won't match. Use a font that has them.` });
        if (on.tajik && !missingTajik.length) {
          const none = [...TAJIK].filter((ch) => !used.has(ch) && lacks(ch, fam));
          if (none.length) out.push({ rule: "Cyrillic type", level: "check", what: `“${fam}” has no Tajik ${none.join(" ")}. This page doesn't use them, but Tajik text in this font would break.` });
        }
      }
    }
  }
  return out;
}

/** The checks as text to run in a page, for the rules as they are right now. Null when there's nothing to check. */
export function ruleCheckScript(): string | null {
  const rules = designRules();
  if (!rules) return null;
  const on = wanted(rules);
  if (!Object.values(on).some(Boolean)) return null;
  return `(${measure.toString()})(${JSON.stringify(on)})`;
}

/** Findings as Claude reads them: what breaks a rule first. */
export function describeFindings(found: RuleFinding[] | undefined) {
  if (!found?.length) return undefined;
  return [...found].sort((a, b) => (a.level === b.level ? 0 : a.level === "breaks" ? -1 : 1)).map((f) => ({ ...f, where: f.where?.length ? f.where : undefined }));
}
