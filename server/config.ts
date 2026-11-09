import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

// Always a full path, so a copy started with a relative one (.copy/lib) works everywhere.
export const LIBRARY_DIR = resolve(process.env.PANEL_LIBRARY_DIR ?? join(homedir(), "DesignLibrary"));
export const MEDIA_DIR = join(LIBRARY_DIR, "media");
export const DB_PATH = join(LIBRARY_DIR, "library.sqlite");
export const PORT = Number(process.env.PANEL_PORT ?? 4646);
// Only ever listen on loopback: the library is private to this Mac.
export const HOST = "127.0.0.1";

mkdirSync(MEDIA_DIR, { recursive: true });
