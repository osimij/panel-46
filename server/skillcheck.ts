// The designer's skills, where a machine can check them. A skill's Check section names
// things to measure ("- line_length: 45–85", "- overflow (breaks)"); when Panel renders a
// sketch or a build in Chrome, it measures the real page against the skills that are on,
// beside the rule checks (rulecheck.ts), and Claude gets what was found as skill_checks.
//
// Which checks run: those of skills that are on and used Always, and those of skills used
// "When it applies" when the page has what they're about. Panel finds that out in the page
// itself: it moves (something visible animates or moves when touched, or the page defines
// keyframes), it has a form (an input, a textarea or a select), it's for a phone (the screen
// it is rendered on). Such a skill is also named under skills_that_apply, to be read.
//
// A wrong finding makes Claude "fix" a good design, which is worse than no finding. So each
// check leaves out what it can't judge: text over a picture or a gradient, what isn't
// visible, Panel's own kit, single characters, headlines where body text is meant. Where it
// is unsure, it says nothing.

import type { RuleFinding } from "./rulecheck.ts";
import { evaluate } from "./site.ts";
import type { About, CheckPlan } from "./skills.ts";
import { checkPlanNow } from "./skilluse.ts";

/** A finding against a skill: `rule` is the skill's name, `check` the measurement. */
export interface SkillFinding extends RuleFinding {
  check: string;
}

export interface SkillResult {
  found: SkillFinding[];
  /** "When it applies" skills whose subject is on the page: to read with get_skill. */
  apply: { name: string; line: string }[];
  /** What was measured against (checkPlan's key): a stored result with another key is out of date. */
  key: string;
}

/** Runs inside the page. Kept as one function so it can be sent to Chrome as text. */
function measure(o: { skills: CheckPlan["skills"]; phone: boolean }) {
  type Found = { rule: string; check: string; level: "breaks" | "check"; what: string; where?: string[] };
  const found: Found[] = [];
  const vw = document.documentElement.clientWidth || innerWidth;
  const all = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => !el.closest("[data-panel-kit]") && !(el instanceof SVGElement)).slice(0, 5000);
  const styles = new Map<Element, CSSStyleDeclaration>();
  const cs = (el: Element) => styles.get(el) ?? (styles.set(el, getComputedStyle(el)), styles.get(el)!);
  const box = new Map<Element, DOMRect>();
  const rect = (el: Element) => box.get(el) ?? (box.set(el, el.getBoundingClientRect()), box.get(el)!);
  const shown = (el: HTMLElement) => {
    const r = rect(el), c = cs(el);
    if (r.width <= 1 || r.height <= 1 || c.visibility === "hidden" || c.display === "none") return false;
    // Faded out, or hidden for screen readers only (clipped to a pixel).
    for (let e: HTMLElement | null = el; e; e = e.parentElement) if (Number(cs(e).opacity) < 0.05) return false;
    return c.clip === "auto" || !/rect\(0/.test(c.clip);
  };
  const own = (el: HTMLElement) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
  const name = (el: Element) => {
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : cls);
  };
  const quote = (t: string, n = 32) => `“${t.length > n ? `${t.slice(0, n - 1)}…` : t}”`;
  const some = (list: string[], n = 4) => {
    const u = [...new Set(list)];
    return u.length > n ? [...u.slice(0, n), `and ${u.length - n} more`] : u;
  };
  const px = (v: string) => parseFloat(v) || 0;
  const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  const rgba = (color: string): [number, number, number, number] | null => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return color === "transparent" ? [0, 0, 0, 0] : null;
    const p = m[1]!.split(/[,/ ]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  const over = (top: number[], under: number[]) => {
    const a = top[3]!;
    return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1);
  };

  const visible = all.filter(shown);
  // Everything that paints a background or a picture, with where it is (for contrast).
  let paintedCache: { el: Element; r: DOMRect; picture: boolean }[] | null = null;
  const painted = () =>
    (paintedCache ??= [
      ...visible.flatMap((el) => {
        const c = cs(el), bg = rgba(c.backgroundColor);
        const picture = c.backgroundImage !== "none" || /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(el.tagName);
        return picture || (bg && bg[3]! > 0.02) ? [{ el, r: rect(el), picture }] : [];
      }),
      ...[...document.querySelectorAll("svg")].filter((el) => !el.closest("[data-panel-kit]") && rect(el).width > 1).map((el) => ({ el, r: rect(el), picture: true })),
    ]);
  // Text a person reads: two characters or more, not a lone icon or symbol.
  const texts = visible.map((el) => ({ el, text: own(el) })).filter((x) => x.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
  const family = (el: Element) => (cs(el).fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim();
  // Initials in an avatar, a count in a dot: two or three capitals or figures in a small filled
  // or round box. They're read as a picture, not as text, so size and contrast checks skip them.
  const badge = (el: HTMLElement, text: string) => {
    if (text.length > 3 || !/^[\p{Lu}\p{N}]+$/u.test(text)) return false;
    for (let e: HTMLElement | null = el, i = 0; e && i < 3; e = e.parentElement, i++) {
      const r = rect(e), c = cs(e);
      if (r.width > 44 || r.height > 44) return false;
      const filled = (rgba(c.backgroundColor)?.[3] ?? 0) > 0.05 || c.backgroundImage !== "none" || px(c.borderTopWidth) > 0;
      if (filled || px(c.borderTopLeftRadius) >= Math.min(r.width, r.height) / 3) return true;
    }
    return false;
  };
  const iconFont = /icon|symbol|awesome|material|glyph|emoji/i;

  // ---- What the page has, for "When it applies" ----
  const sheets: CSSRule[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of [...rules]) {
      sheets.push(r);
      if ("cssRules" in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
    }
  };
  for (const s of [...document.styleSheets]) {
    try {
      if ((s.ownerNode as Element | null)?.closest?.("[data-panel-kit]")) continue;
      walk(s.cssRules);
    } catch {
      /* a stylesheet from another site can't be read */
    }
  }
  const keyframes = sheets.some((r) => r instanceof CSSKeyframesRule);
  // Things that move: a running CSS or script animation, or a transition of where or how big something is.
  const MOVING = /\b(all|transform|translate|scale|rotate|top|left|right|bottom|margin|width|height|inset)\b/;
  const animated = visible.filter((el) => {
    const c = cs(el);
    if (c.animationName && c.animationName !== "none" && px(c.animationDuration) > 0) return true;
    return c.transitionDuration.split(",").some((d) => px(d) > 0) && MOVING.test(c.transitionProperty);
  });
  const scripted = (document.getAnimations?.() ?? []).filter((a) => {
    const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
    return t && !t.closest("[data-panel-kit]");
  });
  const has: Record<string, boolean> = {
    motion: keyframes || animated.length > 0 || scripted.length > 0,
    forms: visible.some((el) => /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "hidden")),
    phone: o.phone,
  };

  const apply: { name: string; line: string }[] = [];
  const run: { skill: string; check: { name: string; min?: number; max?: number; level: "breaks" | "check" } }[] = [];
  for (const s of o.skills) {
    const applies = s.when === "always" || s.about.some((a) => has[a]);
    if (!applies) continue;
    if (s.when === "applies") apply.push({ name: s.name, line: s.line });
    for (const c of s.checks) run.push({ skill: s.name, check: c });
  }

  // ---- Running text: blocks of body-size type set in three lines or more ----
  type Block = { el: HTMLElement; size: number; lines: number[]; pitch: number; text: string };
  let blocksCache: Block[] | null = null;
  const blocks = () => {
    if (blocksCache) return blocksCache;
    const out: Block[] = [];
    const seen = new Set<Element>();
    const blockish = /^(block|list-item|table-cell|flow-root|flex|grid)$/;
    for (const { el } of texts) {
      let b: HTMLElement | null = el;
      while (b && !blockish.test(cs(b).display)) b = b.parentElement;
      if (!b || seen.has(b) || b.closest("pre, code, table, nav, button, h1, h2, h3, h4, h5, h6, [data-panel-kit]")) continue;
      seen.add(b);
      // Other blocks inside it: its words aren't one paragraph.
      if ([...b.querySelectorAll("*")].some((d) => blockish.test(cs(d).display) && (d.textContent ?? "").trim())) continue;
      const size = px(cs(b).fontSize);
      if (size > 24 || size < 8) continue;
      // Each word's line, from where Chrome put it.
      const tops: number[] = [];
      const counts: number[] = [];
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let words = 0;
      for (let n = walker.nextNode(); n && words < 1500; n = walker.nextNode()) {
        const t = n.textContent ?? "";
        for (const m of t.matchAll(/\S+/g)) {
          range.setStart(n, m.index!);
          range.setEnd(n, m.index! + m[0].length);
          const r = range.getClientRects()[0];
          if (!r || r.width === 0) continue;
          words++;
          let i = tops.findIndex((y) => Math.abs(y - r.top) < size * 0.5);
          if (i < 0) { tops.push(r.top); counts.push(0); i = tops.length - 1; }
          // The word and the space after it.
          counts[i]! += m[0].length + 1;
        }
      }
      if (tops.length < 3) continue;
      const order = tops.map((y, i) => [y, counts[i]! - 1] as const).sort((a, z) => a[0] - z[0]);
      const pitches = order.slice(1).map(([y], i) => y - order[i]![0]).sort((a, z) => a - z);
      out.push({ el: b, size, lines: order.map(([, n]) => n), pitch: pitches[Math.floor(pitches.length / 2)]!, text: (b.textContent ?? "").replace(/\s+/g, " ").trim() });
      if (out.length >= 80) break;
    }
    return (blocksCache = out);
  };
  const median = (xs: number[]) => [...xs].sort((a, z) => a - z)[Math.floor(xs.length / 2)]!;

  const say = (skill: string, check: string, level: "breaks" | "check", what: string, where?: string[]) => found.push({ rule: skill, check, level, what, ...(where?.length ? { where: some(where) } : {}) });

  for (const { skill, check: c } of run) {
    // ---- line_length: characters per line of running text ----
    if (c.name === "line_length") {
      const long: string[] = [], short: string[] = [];
      for (const b of blocks()) {
        // Every line but the last, which ends where the paragraph does.
        const n = median(b.lines.slice(0, -1));
        if (c.max != null && n > c.max) long.push(`${name(b.el)} ${quote(b.text, 24)} (${n} a line)`);
        // Too short only for a real paragraph of text-size type, not a caption in a narrow column.
        if (c.min != null && n < c.min && b.lines.length >= 4 && b.size >= 14) short.push(`${name(b.el)} ${quote(b.text, 24)} (${n} a line)`);
      }
      if (long.length) say(skill, c.name, c.level, `${long.length} ${long.length === 1 ? "block" : "blocks"} of running text ${long.length === 1 ? "runs" : "run"} past ${c.max} characters a line. Narrow the measure (max-width in ch).`, long);
      if (short.length) say(skill, c.name, c.level, `${short.length} ${short.length === 1 ? "paragraph is" : "paragraphs are"} set under ${c.min} characters a line, too narrow to read comfortably.`, short);
    }
    // ---- line_height: of running text up to 22px, as a multiple of its size ----
    if (c.name === "line_height") {
      const off: string[] = [];
      for (const b of blocks()) {
        if (b.size > 22) continue;
        const lh = b.pitch / b.size;
        if ((c.min != null && lh < c.min - 0.02) || (c.max != null && lh > c.max + 0.02)) off.push(`${name(b.el)} ${quote(b.text, 24)} (${round(lh, 2)} at ${round(b.size)}px)`);
      }
      if (off.length) say(skill, c.name, c.level, `${off.length} ${off.length === 1 ? "block" : "blocks"} of running text ${off.length === 1 ? "has" : "have"} a line height outside ${c.min ?? "…"}–${c.max ?? "…"} times the type size.`, off);
    }
    // ---- font_sizes: how many different text sizes ----
    if (c.name === "font_sizes" && c.max != null) {
      const sizes = new Map<number, string>();
      for (const { el, text } of texts) {
        if (iconFont.test(family(el))) continue;
        const s = Math.round(px(cs(el).fontSize) * 2) / 2;
        if (!sizes.has(s)) sizes.set(s, quote(text, 20));
      }
      if (sizes.size > c.max) say(skill, c.name, c.level, `The page sets text in ${sizes.size} different sizes; the skill allows ${c.max}. Fold near neighbours into one step of the scale.`, [[...sizes.keys()].sort((a, z) => z - a).map((s) => `${s}px`).join(", ")]);
    }
    // ---- font_families: how many families set text. A mono used only for code or for figures
    // (prices, counts, dates) doesn't count: it's a tool for those, not another voice. ----
    if (c.name === "font_families" && c.max != null) {
      const fams = new Map<string, string>();
      const mono = (el: Element, f: string) => /mono|code|courier|menlo|consolas|monaco/i.test(f) || /monospace/i.test(cs(el).fontFamily.split(",").at(-1) ?? "");
      for (const { el, text } of texts) {
        const f = family(el);
        if (!f || iconFont.test(f) || el.closest("pre, code, kbd, samp")) continue;
        if (mono(el, f) && !/\p{L}{2}/u.test(text)) continue;
        const k = f.toLowerCase();
        if (!fams.has(k)) fams.set(k, `${f} ${quote(text, 20)}`);
      }
      if (fams.size > c.max) say(skill, c.name, c.level, `${fams.size} font families set text on the page; the skill allows ${c.max}.`, [...fams.values()]);
    }
    // ---- small_text: the smallest text ----
    if (c.name === "small_text" && c.min != null) {
      const tiny = texts.filter(({ el, text }) => !el.closest("sup, sub") && !badge(el, text) && px(cs(el).fontSize) < c.min! - 0.25);
      if (tiny.length) say(skill, c.name, c.level, `${tiny.length} ${tiny.length === 1 ? "piece of text is" : "pieces of text are"} smaller than ${c.min}px (the smallest is ${round(Math.min(...tiny.map(({ el }) => px(cs(el).fontSize))))}px).`, tiny.map(({ el, text }) => `${quote(text, 24)} ${round(px(cs(el).fontSize))}px`));
    }
    // ---- contrast: text against what's really behind it ----
    if (c.name === "contrast" && c.min != null) {
      const low: string[] = [];
      for (const { el, text } of texts) {
        const st = cs(el);
        if (el.closest("button:disabled, input:disabled, [aria-disabled=true]") || badge(el, text)) continue;
        // Gradient or clipped text, outlined or shadowed text: its contrast isn't one number.
        if (st.backgroundClip === "text" || (st as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip === "text") continue;
        if (st.textShadow !== "none" || px(st.getPropertyValue("-webkit-text-stroke-width")) > 0) continue;
        const ink = rgba(st.getPropertyValue("-webkit-text-fill-color") || st.color) ?? rgba(st.color);
        if (!ink || ink[3]! < 0.1) continue;
        const r = rect(el);
        // Over a picture, a video or a gradient that isn't its own: no one number says how it reads.
        const mine = (e: Element) => e === el || el.contains(e) || e.contains(el);
        const meet = (x: DOMRect) => x.left < r.right && x.right > r.left && x.top < r.bottom && x.bottom > r.top;
        if (painted().some((p) => !mine(p.el) && p.picture && meet(p.r))) continue;
        // What's under the middle of the text, top first, up to the first solid background. On
        // the first screen Chrome says what lies under a point; further down, only the text's own
        // parents are known, so a solid box beside them that overlaps it makes it unsure.
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1), cy = r.top + r.height / 2;
        const onScreen = cy >= 0 && cy <= innerHeight;
        let under: Element[];
        if (onScreen) {
          const stack = document.elementsFromPoint(cx, cy);
          under = stack.slice(Math.max(0, stack.indexOf(el)));
        } else {
          if (painted().some((p) => !mine(p.el) && meet(p.r))) continue;
          under = [];
          for (let e: Element | null = el; e; e = e.parentElement) under.push(e);
        }
        const layers: number[][] = [];
        let unsure = false;
        for (const e of under) {
          if (e.closest("[data-panel-kit]")) continue;
          if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|svg)$/i.test(e.tagName)) { unsure = true; break; }
          const c2 = cs(e);
          if (c2.backgroundImage !== "none" || (c2.backdropFilter && c2.backdropFilter !== "none")) { unsure = true; break; }
          const bg = rgba(c2.backgroundColor);
          if (bg && bg[3]! > 0.02) {
            layers.push(bg);
            if (bg[3]! >= 0.98) break;
          }
        }
        if (unsure) continue;
        let base = [255, 255, 255, 1];
        for (const l of layers.reverse()) base = over(l, base);
        // The text's own opacity, and its parents' up to its background, fade it.
        let alpha = ink[3]!;
        for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement) alpha *= Number(cs(e).opacity);
        const fg = over([ink[0]!, ink[1]!, ink[2]!, alpha], base);
        const a = lum(fg), b = lum(base);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const big = px(st.fontSize) >= 24;
        const need = big ? Math.min(3, c.min) : c.min;
        if (ratio < need - 0.05) low.push(`${quote(text, 24)} ${round(ratio, 2)}:1${big ? " (large)" : ""}`);
      }
      if (low.length) say(skill, c.name, c.level, `${low.length} ${low.length === 1 ? "piece of text is" : "pieces of text are"} below ${c.min}:1 against ${low.length === 1 ? "its" : "their"} background (large text, 24px and up, needs ${Math.min(3, c.min)}:1).`, low);
    }
    // ---- overflow: sideways scrolling, or text cut off at the edge ----
    if (c.name === "overflow") {
      const root = document.documentElement, body = document.body;
      const clipped = (e: Element) => /hidden|clip/.test(cs(e).overflowX);
      const scrolls = root.scrollWidth > root.clientWidth + 1 && !clipped(root) && !(body && clipped(body));
      const moving = (e: Element) => (e as HTMLElement).getAnimations?.({ subtree: false }).length > 0;
      const wide: string[] = [];
      for (const el of visible) {
        const r = rect(el);
        // Partly on screen and running past an edge; wholly off screen is a menu or slide waiting.
        if (!(r.right > vw + 1 && r.left < vw) && !(r.left < -1 && r.right > 0)) continue;
        if (cs(el).position === "fixed" && r.width > vw * 2) continue;
        // Inside something that scrolls or clips sideways on purpose (a carousel, a marquee).
        let inside = false;
        for (let e = el.parentElement; e && e !== body && e !== root; e = e.parentElement) if (clipped(e) || /auto|scroll/.test(cs(e).overflowX) || moving(e)) { inside = true; break; }
        if (inside || moving(el)) continue;
        // With the page itself clipped, only cut-off words matter; a decorative shape past the edge is a choice.
        if (!scrolls && !own(el)) continue;
        // Only the outermost culprit.
        if (el.parentElement && wide.includes(name(el.parentElement))) continue;
        wide.push(`${name(el)} (${Math.round(r.left)}px to ${Math.round(r.right)}px)`);
      }
      if (scrolls) say(skill, c.name, c.level, `The page scrolls sideways: it is ${root.scrollWidth}px wide on a ${root.clientWidth}px screen.`, wide.length ? wide : undefined);
      else if (wide.length) say(skill, c.name, c.level, `${wide.length} ${wide.length === 1 ? "piece of text runs" : "pieces of text run"} past the edge of the ${vw}px screen and ${wide.length === 1 ? "is" : "are"} cut off.`, wide);
    }
    // ---- reduced_motion: a page that moves turns it down for those who ask ----
    // Keyframes count only when something uses them (a spinner waiting in a hidden state does too).
    if (c.name === "reduced_motion" && (animated.length || scripted.length || (keyframes && all.some((el) => cs(el).animationName !== "none")))) {
      const handled =
        sheets.some((r) => r instanceof CSSMediaRule && /prefers-reduced-motion/.test(r.conditionText || r.media.mediaText)) ||
        [...document.scripts].some((s) => /prefers-reduced-motion/.test(s.textContent ?? "")) ||
        [...document.querySelectorAll("link[media], style[media], source[media]")].some((l) => /prefers-reduced-motion/.test(l.getAttribute("media") ?? ""));
      if (!handled) {
        const where = [...animated.map((el) => `${name(el)} (${cs(el).animationName !== "none" ? `animation ${cs(el).animationName}` : `transition ${cs(el).transitionProperty}`})`), ...scripted.map((a) => `${name((a.effect as KeyframeEffect).target as Element)} (animated by script)`)];
        say(skill, c.name, c.level, "The page moves, but nothing in it answers prefers-reduced-motion. Turn the motion down there and show the end state.", where.length ? where : ["@keyframes in the page"]);
      }
    }
    // ---- tap_targets: on a phone, things to tap smaller than the size both ways ----
    if (c.name === "tap_targets" && o.phone && c.min != null) {
      const small: string[] = [];
      for (const el of visible) {
        if (!el.matches("a[href], button, [role=button], input:not([type=hidden]), select, textarea, summary, [onclick]")) continue;
        if (el.matches(":disabled") || el.parentElement?.closest("a[href], button, [role=button], label")) continue;
        // A link inside a sentence is sized by the sentence.
        if (el.tagName === "A") {
          const p = el.parentElement;
          if (p && own(p).replace(/[^\p{L}]/gu, "").length > 10) continue;
        }
        const r = rect(el);
        if (r.width < c.min - 0.5 && r.height < c.min - 0.5) small.push(`${name(el)}${own(el) ? ` ${quote(own(el), 18)}` : ""} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
      if (small.length) say(skill, c.name, c.level, `${small.length} ${small.length === 1 ? "thing to tap is" : "things to tap are"} smaller than ${c.min}px both ways on a phone.`, small);
    }
  }
  return { found, apply };
}

/**
 * Measure the page that's open against the skills that are on right now. Undefined when
 * no skill asks for anything, so a page's answer is then exactly what it was before skills.
 * Never throws: a check that can't run finds nothing.
 */
export async function checkSkills(s: <T = unknown>(m: string, p?: object) => Promise<T>, phone: boolean): Promise<SkillResult | undefined> {
  const plan = checkPlanNow();
  if (!plan) return undefined;
  try {
    const r = await evaluate<{ found: SkillFinding[]; apply: { name: string; line: string }[] }>(s, `(${measure.toString()})(${JSON.stringify({ skills: plan.skills, phone })})`, 8000);
    return { found: r.found, apply: r.apply, key: plan.key };
  } catch {
    return { found: [], apply: [], key: plan.key };
  }
}

/** The key of what would be measured now, or null when no skill asks for anything. */
export const skillKeyNow = () => checkPlanNow()?.key ?? null;

export type { About };
