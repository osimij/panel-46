// The designer's rules (unugly.md), where a machine can check them. When Panel renders a
// sketch or a build in Chrome it also measures the page: corners without smoothing, a
// letter-spaced name in the navbar, a font with no Tajik letters, and the signs of generic
// design the rules list. Claude gets what was found next to the pictures, so a rule isn't
// only something it was asked to remember.
//
// A check runs only while unugly.md still talks about it: delete a rule there and its check
// goes quiet. Rules that take an eye (does the paper look real?) stay with whoever is looking.
//
// One group is Panel's own and always runs: ready-made parts (parts.ts). A sketch names an icon
// or a loading animation with a tag and Panel puts the drawing in, so a few mistakes can be seen
// in the page itself: CSS that styles a part by its tag's name (it does nothing once the tag is
// replaced), a tag a script added (never filled, so it shows nothing), and icons in two weights.

import { designRules } from "./rules.ts";
import { evaluate, glyphCoverage, TAJIK_LETTERS } from "./site.ts";

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
function measure(on: ReturnType<typeof wanted>): { found: RuleFinding[]; type: { family: string; letters: string }[] } {
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

  // ---- Cyrillic and Tajik: which fonts set Cyrillic text, and with which letters ----
  // Whether each font really has those letters is asked of Chrome afterwards (checkRules).
  const type: { family: string; letters: string }[] = [];
  if (on.cyrillic || on.tajik) {
    const byFamily = new Map<string, Set<string>>();
    for (const { el, text } of texts) {
      const cyr = text.match(/[\u0400-\u052F]/g);
      if (!cyr) continue;
      const f = family(el);
      const set = byFamily.get(f) ?? byFamily.set(f, new Set()).get(f)!;
      for (const ch of cyr) if (set.size < 60) set.add(ch);
    }
    const generic = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|cursive|fantasy|inherit|)$/i;
    for (const [fam, used] of byFamily) if (!generic.test(fam)) type.push({ family: fam, letters: [...used].join("") });
  }
  return { found: out, type };
}

/**
 * Runs inside the page: Panel's ready-made parts (parts.ts), checked whatever unugly.md says.
 * Kept as one function so it can be sent to Chrome as text.
 */
function measureParts(): RuleFinding[] {
  const out: RuleFinding[] = [];
  const some = (list: string[], n = 4) => {
    const u = [...new Set(list)];
    return u.length > n ? [...u.slice(0, n), `and ${u.length - n} more`] : u;
  };

  // CSS that selects a part by its tag's name. The tag was replaced by the drawing when the page
  // was saved, so such a rule matches nothing (a class or an id with the same word is fine).
  const byTag: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of [...rules] as (CSSRule & { selectorText?: string; cssRules?: CSSRuleList })[]) {
      if (r.selectorText && /(^|[\s>+~,(])panel-(icon|loading)(?![\w-])/i.test(r.selectorText)) byTag.push(r.selectorText.slice(0, 60));
      if (r.cssRules) walk(r.cssRules);
    }
  };
  for (const sheet of [...document.styleSheets]) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A stylesheet from another site can't be read; it isn't the sketch's own.
    }
  }
  if (byTag.length)
    out.push({
      rule: "Ready-made parts",
      level: "breaks",
      what: `${byTag.length} CSS ${byTag.length === 1 ? "rule styles" : "rules style"} a ready-made part by its tag's name. Panel replaces the tag with the drawing, so ${byTag.length === 1 ? "it does" : "they do"} nothing. Put a class on the tag and style that.`,
      where: some(byTag),
    });

  // A tag still in the page: a script added it, and Panel only fills tags written in the HTML.
  const left = [...document.querySelectorAll("panel-icon, panel-loading")];
  if (left.length)
    out.push({
      rule: "Ready-made parts",
      level: "breaks",
      what: `${left.length} ready-made ${left.length === 1 ? "part was" : "parts were"} added by a script, so ${left.length === 1 ? "it shows" : "they show"} nothing: Panel only fills tags written in the page's HTML. Put the part in a <template> (or hidden in the HTML) for the script to copy.`,
      where: some(left.map((el) => `<${el.tagName.toLowerCase()} name="${el.getAttribute("name") ?? ""}">`)),
    });

  // One weight on a page; fill is the exception, it marks what's active.
  const byWeight = new Map<string, string[]>();
  for (const el of [...document.querySelectorAll("svg[data-panel-icon]")]) {
    const w = el.getAttribute("data-panel-weight") || "regular";
    if (w === "fill") continue;
    byWeight.set(w, [...(byWeight.get(w) ?? []), el.getAttribute("data-panel-icon") ?? ""]);
  }
  if (byWeight.size > 1) {
    // Most used first: the others are the odd ones out.
    const weights = [...byWeight].sort((a, b) => b[1].length - a[1].length);
    out.push({
      rule: "Ready-made parts",
      level: "check",
      what: `Icons are in ${weights.length} weights (${weights.map(([w, names]) => `${names.length} ${w}`).join(", ")}). Keep one weight on a page, with fill only to mark what is active, unless the designer or a skill says otherwise.`,
      where: some(weights.slice(1).flatMap(([w, names]) => names.map((n) => `${n} (${w})`))),
    });
  }
  return out;
}

/**
 * Check the page that's open against the rules as they are right now, and its ready-made
 * parts. Never throws: a check that can't run just finds nothing.
 */
export async function checkRules(s: <T = unknown>(m: string, p?: object) => Promise<T>): Promise<RuleFinding[] | undefined> {
  // Panel's own, whatever the rules file says. They come first: they are quick to fix.
  const parts = await evaluate<RuleFinding[]>(s, `(${measureParts.toString()})()`, 3000).catch(() => [] as RuleFinding[]);
  const found = await checkDesignRules(s).catch(() => undefined);
  return parts.length ? [...parts, ...(found ?? [])] : found;
}

/** The designer's rules (unugly.md), where a machine can check them. */
async function checkDesignRules(s: <T = unknown>(m: string, p?: object) => Promise<T>): Promise<RuleFinding[] | undefined> {
  const rules = designRules();
  if (!rules) return undefined;
  const on = wanted(rules);
  if (!Object.values(on).some(Boolean)) return undefined;
  try {
    const { found, type } = await evaluate<ReturnType<typeof measure>>(s, `(${measure.toString()})(${JSON.stringify(on)})`, 6000);
    if (!type.length) return found;
    // Ask Chrome which font really draws each letter: the ones on the page, the Tajik ones, and a Latin pair.
    const lacks = await glyphCoverage(s, type.map((t) => t.family), `an${type.map((t) => t.letters).join("")}${TAJIK_LETTERS}`).catch(() => null);
    if (!lacks) return found;
    for (const { family: fam, letters } of type) {
      const missing = lacks.get(fam);
      if (!missing) continue;
      if (missing.includes("a") && missing.includes("n")) {
        found.push({ rule: "Cyrillic type", level: "breaks", what: `The font “${fam}” didn't load, so its text is shown in a fallback font.` });
        continue;
      }
      const used = [...letters];
      const tajik = (ch: string) => TAJIK_LETTERS.includes(ch);
      const gone = used.filter((ch) => missing.includes(ch));
      const goneOther = gone.filter((ch) => !tajik(ch)), goneTajik = gone.filter(tajik);
      if (on.cyrillic && goneOther.length) found.push({ rule: "Cyrillic type", level: "breaks", what: `“${fam}” has no ${goneOther.slice(0, 12).join(" ")}: those letters are drawn by another font. Use a font with real Cyrillic.` });
      if (on.tajik && goneTajik.length) found.push({ rule: "Cyrillic type", level: "breaks", what: `“${fam}” has no Tajik ${goneTajik.join(" ")}: they are drawn by another font and won't match. Use a font that has them.` });
      if (on.tajik && !goneTajik.length) {
        const none = [...TAJIK_LETTERS].filter((ch) => !used.includes(ch) && missing.includes(ch));
        if (none.length) found.push({ rule: "Cyrillic type", level: "check", what: `“${fam}” has no Tajik ${none.join(" ")}. This page doesn't use them, but Tajik text in this font would break.` });
      }
    }
    return found;
  } catch {
    return undefined;
  }
}

/** Findings as Claude reads them: what breaks a rule first. */
export function describeFindings(found: RuleFinding[] | undefined) {
  if (!found?.length) return undefined;
  return [...found].sort((a, b) => (a.level === b.level ? 0 : a.level === "breaks" ? -1 : 1)).map((f) => ({ ...f, where: f.where?.length ? f.where : undefined }));
}
