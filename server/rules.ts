// The designer's standing rules for every design: unugly.md at the top of this folder.
// Ask has them in its instructions on every turn; any AI app over MCP gets them at the top
// of get_project and from get_design_rules, so the rules travel with the work.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const RULES_PATH = join(import.meta.dir, "..", "unugly.md");

/** Read fresh each time, so edits apply to the next message without a restart. Empty without the file. */
export function designRules(): string {
  try {
    return readFileSync(RULES_PATH, "utf8").trim();
  } catch {
    return "";
  }
}
