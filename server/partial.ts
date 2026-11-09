// Reading a tool's input while Claude is still writing it. Nothing here touches the library,
// so it can be tested on its own.

/**
 * A sketch's page out of a tool input that's still being written: the "html" value as far
 * as it has come, with its JSON escapes undone. Null until there's enough to show.
 */
export function partialHtml(json: string): string | null {
  const m = json.match(/"html"\s*:\s*"/);
  if (!m) return null;
  const from = m.index! + m[0].length;
  // Walk to the string's closing quote, or to where the writing has got to, never
  // stopping in the middle of an escape (a lone backslash, part of a \u code).
  let end = json.length;
  for (let i = from; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') {
      end = i;
      break;
    }
    if (ch !== "\\") continue;
    const need = json[i + 1] === "u" ? 6 : 2;
    if (i + need > json.length) {
      end = i;
      break;
    }
    i += need - 1;
  }
  const raw = json.slice(from, end);
  if (raw.length < 200) return null;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}
