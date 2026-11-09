// A sketch's knobs: the CSS variables it declares on :root. Nothing here touches the library,
// so it can be tested on its own.

/**
 * A page with some of its :root variables given new values (the studio's knobs). Each is
 * changed where the page declares it; one the page doesn't declare yet is added to its
 * first :root block. Everything else in the page stays byte for byte as it was.
 */
export function withVars(html: string, vars: Record<string, string>): string {
  const clean = Object.entries(vars).filter(([k, v]) => /^--[A-Za-z0-9_-]{1,60}$/.test(k) && typeof v === "string" && v.trim() && v.length <= 200 && !/[;{}<>]/.test(v));
  if (!clean.length) throw new Error("Nothing to change.");
  const blocks = [...html.matchAll(/(?:^|[\s},;])(?::root|html)\s*\{([^}]*)\}/g)].map((m) => ({ from: m.index! + m[0].lastIndexOf("{") + 1, body: m[1]! }));
  if (!blocks.length) throw new Error("This sketch has no variables to change (no :root block).");
  // Work from the end of the page back, so earlier positions stay right as the text changes.
  const edits: { at: number; len: number; text: string }[] = [];
  for (const [name, value] of clean) {
    let placed = false;
    for (const b of blocks) {
      const m = b.body.match(new RegExp(`(^|[;\\s])(${name.replace(/[-]/g, "\\-")}\\s*:)([^;]*)`));
      if (!m) continue;
      const at = b.from + m.index! + m[1]!.length + m[2]!.length;
      edits.push({ at, len: m[3]!.length, text: ` ${value.trim()}` });
      placed = true;
      break;
    }
    if (!placed) edits.push({ at: blocks[0]!.from, len: 0, text: ` ${name}: ${value.trim()};` });
  }
  let out = html;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len);
  return out;
}
