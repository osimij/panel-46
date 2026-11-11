// A guard: the tests run on a library in a temporary folder, never the designer's real one
// (~/DesignLibrary). If this fails, tests/preload.ts didn't run before the test files
// (check bunfig.toml), and every test that loads server code would open the real library.

import { expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";

test("the library in use is a temporary one, not the real library", async () => {
  const { LIBRARY_DIR, DB_PATH } = await import("../server/config.ts");
  const real = resolve(join(homedir(), "DesignLibrary"));
  expect(LIBRARY_DIR).not.toBe(real);
  expect(DB_PATH.startsWith(real)).toBe(false);
  expect(realpathSync(LIBRARY_DIR).startsWith(realpathSync(tmpdir()))).toBe(true);
});
