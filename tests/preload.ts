// Loaded by `bun test` before any test file (bunfig.toml), so no test can ever open the
// designer's real library. bun runs every test file in one process, and some load server
// code (db.ts) directly; without a library folder set, db.ts would open ~/DesignLibrary and
// run its start-up steps on it. Here the folder is always a fresh, empty one in a temporary
// place, even when the shell already names one, and it is removed when the run ends.
// Test companions (helpers.ts) still get their own folder each.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "panel-test-run-"));
process.env.PANEL_LIBRARY_DIR = dir;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
