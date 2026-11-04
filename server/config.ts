import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const LIBRARY_DIR = process.env.PANEL_LIBRARY_DIR ?? join(homedir(), "DesignLibrary");
export const MEDIA_DIR = join(LIBRARY_DIR, "media");
export const DB_PATH = join(LIBRARY_DIR, "library.sqlite");
export const PORT = Number(process.env.PANEL_PORT ?? 4646);
// Only ever listen on loopback: the library is private to this Mac.
export const HOST = "127.0.0.1";

mkdirSync(MEDIA_DIR, { recursive: true });
