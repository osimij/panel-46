// A part's font size, changed by hand in the studio, written so it keeps scaling the way the
// page made it scale.
//
// Pages size their text in many ways: a share of the page's width (3cqw), a range
// (clamp(…)), one of the page's knobs (var(--size-title)). The sketch page tells the studio
// which of these the part really has (its "size rule"), and a change is written as that rule
// times a number: calc((3cqw) * 1.2). On a phone the part then shrinks with everything around
// it. Writing it in em of the text around it, as before, froze such a part at one size
// whenever the text around it didn't scale too.
//
// A part that only takes its size from the text around it has no rule of its own; em of that
// text is exactly right for it, so that's what it gets.

/** What the studio knows of the part's size as the page itself makes it. */
export interface SizeLook {
  /** In px, on the screen shown now. */
  size: number | null;
  /** The font size of the text around it, in px. */
  parentSize: number | null;
  /** How the page writes the part's size (3cqw, clamp(…), calc((3cqw) * 1.2)); null when it only inherits. */
  sizeRule?: string | null;
}

const round = (n: number, d: number) => Number(n.toFixed(d));
const balanced = (s: string) => {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0;
};

/** "calc((3cqw) * 1.2)" is the rule 3cqw, 1.2 times; anything else is itself, once. */
export function splitSize(value: string): { rule: string; times: number } {
  const m = value.trim().match(/^calc\(\((.+)\) \* (\d*\.?\d+)\)$/);
  if (m && balanced(m[1]!) && Number(m[2]) > 0) return { rule: m[1]!.trim(), times: Number(m[2]) };
  return { rule: value.trim(), times: 1 };
}

/** The value to write on the part so it is `px` tall now and keeps scaling as the page does. */
export function sizeFor(px: number, look: SizeLook): string {
  if (look.sizeRule && look.size) {
    const { rule, times } = splitSize(look.sizeRule);
    const value = `calc((${rule}) * ${round((times * px) / look.size, 4)})`;
    // The page and the server both refuse a longer value; em is the fallback then.
    if (value.length <= 200) return value;
  }
  return look.parentSize ? `${round(px / look.parentSize, 4)}em` : `${round(px, 2)}px`;
}

/** How tall, in px, a value written on the part makes it now; null when it can't be told. */
export function sizeOf(value: string, look: SizeLook): number | null {
  const v = value.trim();
  const plain = v.match(/^(\d*\.?\d+)(em|px)$/);
  if (plain) return plain[2] === "px" ? Number(plain[1]) : look.parentSize ? Number(plain[1]) * look.parentSize : null;
  if (look.sizeRule && look.size) {
    const mine = splitSize(v);
    const page = splitSize(look.sizeRule);
    if (mine.rule === page.rule) return (look.size * mine.times) / page.times;
  }
  return null;
}
