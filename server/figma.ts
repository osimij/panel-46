// Figma and back: a sketch goes to Figma as editable layers, the designer works on it there,
// and it comes back to Panel as the sketch's next version.
//
// Going there is Figma's own doing: Panel's Chrome runs Figma's capture script on the page
// (sketches.ts, captureForFigma) and the studio puts the result on the clipboard, for ⌘V in
// any Figma file. No AI, nothing to set up.
//
// Coming back, Panel reads the frame from the Figma app on this Mac. The app runs a small
// MCP server of its own (http://127.0.0.1:3845/mcp, "Dev Mode MCP server" in its settings),
// which needs no sign-in: it answers about whatever file is open, and about what's selected
// in it. Panel asks it for the frame's picture, the code Figma writes for it, its variables
// and its images, and keeps all that beside the sketch:
//
//   <sketch>/figma/frame.json          the frame this sketch was last brought back from
//   <sketch>/figma/<read>/read.json    one reading: which frame, from which version, Figma's code
//   <sketch>/figma/<read>/picture.png  the frame as Figma draws it
//   <sketch>/figma/<read>/*.png|svg    its images, which the rebuilt page uses by relative path
//
// Figma writes a frame's images only into folders allowed in its own settings, a list that's
// hard to find. When it says no, Panel reads the frame part by part instead (readByParts), so
// nothing has to be set up in Figma.
//
// Rebuilding the page from that is FRIDAY's job (get_figma_frame, then edit_sketch): only
// Claude can keep the page's knobs, states and scripts while taking on what changed.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { sketchDir, versionsOf } from "./sketches.ts";

/** The Figma app's own MCP server. Changed only by tests, which stand in a fake Figma app. */
const FIGMA_APP = () => process.env.PANEL_FIGMA_APP ?? "http://127.0.0.1:3845/mcp";
/** How much of Figma's code is handed to Claude: a big page's code can run to megabytes. */
const MAX_CODE = 120_000;
const READ_ID = /^[0-9a-f]{12}$/;

type Part = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const notRunning = "Panel can't reach the Figma app. Open Figma on this Mac, and turn on its MCP server: in Figma's menu, Preferences → Enable Dev Mode MCP Server.";

/** One conversation with the Figma app's MCP server: open, then ask its tools. */
async function figmaApp() {
  let session = "";
  let n = 0;
  const post = async (body: object) => {
    let res: Response;
    try {
      res = await fetch(FIGMA_APP(), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      throw new Error((e as Error).name === "TimeoutError" ? "The Figma app took too long to answer. Try again in a moment." : notRunning);
    }
    session = res.headers.get("mcp-session-id") ?? session;
    const raw = await res.text();
    if (!("id" in body)) return null;
    // Answers come as JSON or as a short event stream with the JSON in a data: line.
    const lines = /^\s*[{[]/.test(raw) ? [raw] : raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5));
    for (const line of lines.reverse()) {
      try {
        const m = JSON.parse(line);
        if (m.id === (body as { id: number }).id) return m;
      } catch {
        /* not this one */
      }
    }
    throw new Error(`The Figma app answered in a way Panel doesn't understand (${res.status}).`);
  };
  const hello = await post({ jsonrpc: "2.0", id: ++n, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "panel", version: "1" } } });
  if (hello?.error) throw new Error(notRunning);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    /** A tool's answer as its parts. A tool that says it failed throws with Figma's words. */
    async call(name: string, args: Record<string, unknown> = {}): Promise<Part[]> {
      const m = await post({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } });
      if (m?.error) throw new Error(`Figma: ${m.error.message ?? "it didn't answer"}`);
      const parts = (m?.result?.content ?? []) as Part[];
      // Some refusals come as plain answers ("Cannot write to this directory…"), not marked as errors.
      const said = parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
      if (m?.result?.isError || /^(Cannot write to this directory|Path for asset writes|No node could be found|Nothing is selected)/i.test(said)) throw new Error(`Figma: ${said || "it couldn't do that"}`);
      // Figma adds a line about its online server to every answer; it's not about the frame.
      return parts.filter((p) => !(p.type === "text" && /recommends using the remote MCP server/.test(p.text)));
    },
  };
}

const textOf = (parts: Part[]) => parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** What's selected in Figma right now, as the app lists it at the top of get_metadata ("- 12:34: Hero · v3"). */
export function selectionIn(text: string): { node: string; name: string }[] {
  const m = text.match(/Currently selected nodes:\s*\n((?:\s*-\s*[^\n]+\n?)+)/);
  if (!m) return [];
  return m[1]!.split("\n").flatMap((line) => {
    const x = line.match(/^\s*-\s*(\d+:\d+):\s*(.*)$/);
    return x ? [{ node: x[1]!, name: x[2]!.trim() }] : [];
  });
}

/** A layer's id from what someone gives: "12:34", "12-34", or a Figma link with ?node-id=12-34. */
export function layerIn(s: string): string | undefined {
  const m = s.match(/node-id=(\d+)[-:%3A]+(\d+)/i) ?? s.trim().match(/^(\d+)[:-](\d+)$/);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

/** The version a frame came from, when its name still says so ("Hero · v3"). */
export function versionInName(name: string): number | undefined {
  // The last one: a title can have a "v2" of its own ("Landing v2 · v5").
  const m = [...name.matchAll(/(?:^|[\s·—-])v(\d{1,5})\b/gi)].at(-1);
  return m ? Number(m[1]) : undefined;
}

export interface FrameMemory { node: string; name: string; at: string }
export interface FigmaRead {
  read: string;
  node: string;
  frame: string;
  width?: number;
  height?: number;
  /** The sketch's version the designer started from in Figma: the page FRIDAY rebuilds from. */
  base_version: number;
  /** Images Figma handed over, as the rebuilt page uses them (relative to the page). */
  assets: string[];
  /** The frame as Figma draws it, relative to the page, for the studio to show before FRIDAY starts. */
  picture?: string;
  /** Where the frame came from: what's selected in Figma, or the frame from last time. */
  found: "selected" | "last time" | "asked for";
  at: string;
}

const figmaDir = (projectId: string, sketchId: string) => join(sketchDir(projectId, sketchId), "figma");

/** The frame this sketch was last brought back from, if any. */
export function rememberedFrame(projectId: string, sketchId: string): FrameMemory | null {
  try {
    return JSON.parse(readFileSync(join(figmaDir(projectId, sketchId), "frame.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Read a frame from the Figma app for a sketch: the one selected in Figma, or else the one this
 * sketch was brought back from last time. Keeps the reading beside the sketch and says which
 * frame it was. `shown` is the version open in the studio, used when the frame's name no longer
 * says which version it came from.
 */
export async function readFrame(projectId: string, sketchId: string, shown?: number, wanted?: string): Promise<FigmaRead> {
  const versions = versionsOf(projectId, sketchId);
  if (!versions.length) throw new Error("That sketch is gone.");
  const app = await figmaApp();

  // Which frame: one asked for by name (a layer id, or a Figma link to it), what's selected in
  // Figma, or the one from last time.
  const asked = wanted ? layerIn(wanted) : undefined;
  if (wanted && !asked) throw new Error("That isn't a Figma layer: give its id (12:34) or a link to it (…?node-id=12-34).");
  const top = asked ? "" : textOf(await app.call("get_metadata", {}));
  let picked = asked ? [{ node: asked, name: "" }] : selectionIn(top);
  if (!picked.length) {
    // Some versions of the app list the selection only when asked about a page.
    for (const page of [...top.matchAll(/^\s*-\s*(\d+:\d+):/gm)].slice(0, 4).map((x) => x[1]!)) {
      picked = selectionIn(textOf(await app.call("get_metadata", { nodeId: page })));
      if (picked.length) break;
    }
  }
  const memory = rememberedFrame(projectId, sketchId);
  const node = picked[0]?.node ?? memory?.node;
  if (!node) throw new Error("Select the frame in Figma first (click its name on the canvas), then press Bring back again.");

  // Its name and size, from the first line of its outline.
  const outline = textOf(await app.call("get_metadata", { nodeId: node }));
  const head = outline.match(/<([\w-]+)\s+id="([^"]+)"\s+name="([^"]*)"[^>]*?width="([\d.]+)"\s+height="([\d.]+)"/);
  if (!head) throw new Error(picked.length ? "Figma didn't say what the selected layer is. Select the frame itself and try again." : "The frame this sketch came back from last time isn't in the file open in Figma. Open that file, or select the frame, and try again.");
  const frame = unescapeXml(head[3]!);
  // A page comes back from a whole frame: a word or a shape picked by mistake would make a page of one letter.
  if (/^(text|vector|rectangle|rounded-rectangle|ellipse|line|star|polygon|boolean-operation|canvas|slice)$/.test(head[1]!)) {
    throw new Error(`What's selected in Figma is a ${head[1]!.replace(/-/g, " ")} (“${frame}”), not a frame. Select the whole frame the sketch was pasted as, then press Bring back again.`);
  }
  const named = versionInName(frame);
  const base = named && versions.includes(named) ? named : shown && versions.includes(shown) ? shown : versions.at(-1)!;

  const read = randomBytes(6).toString("hex");
  const dir = join(figmaDir(projectId, sketchId), read);
  mkdirSync(dir, { recursive: true });
  try {
    return await readInto(app, projectId, sketchId, { read, dir, node, head, frame, base, found: asked ? "asked for" : picked.length ? "selected" : "last time" });
  } catch (e) {
    // A reading that didn't finish leaves nothing behind.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

async function readInto(
  app: Awaited<ReturnType<typeof figmaApp>>,
  projectId: string,
  sketchId: string,
  { read, dir, node, head, frame, base, found }: { read: string; dir: string; node: string; head: RegExpMatchArray; frame: string; base: number; found: FigmaRead["found"] },
): Promise<FigmaRead> {

  // The frame as Figma draws it.
  const shot = (await app.call("get_screenshot", { nodeId: node })).find((p) => p.type === "image") as Extract<Part, { type: "image" }> | undefined;
  if (shot) {
    writeFileSync(join(dir, "picture.png"), Buffer.from(shot.data, "base64"));
    await fitPicture(dir);
  }

  // Figma's code for it, with its images written into this reading's folder. Figma writes images
  // only into folders allowed in its settings (a list most people never find), so when it says
  // no, the frame is read part by part instead: Figma's code for every part that has no images,
  // and each image or icon as a picture of its own (readByParts).
  let code: string;
  let paths: string[];
  let outline: string | undefined;
  try {
    const whole = textOf(await app.call("get_design_context", { nodeId: node, ...CODE_ARGS, dirForAssetWrites: dir }));
    const assets = await gatherAssets(whole, dir, read);
    code = tidyCode(assets.code, dir, read) + drawingsIn(dir, read);
    paths = assets.paths;
  } catch (e) {
    if (!CANT_WRITE.test((e as Error).message)) throw e;
    const tree = parseOutline(textOf(await app.call("get_metadata", { nodeId: node })));
    if (!tree) throw new Error("Figma didn't describe the frame's layers. Try again in a moment.");
    const parts = await readByParts(app, tree, dir, read);
    code = parts.code;
    paths = parts.paths;
    outline = parts.outline;
  }

  let variables = "";
  try {
    variables = textOf(await app.call("get_variable_defs", { nodeId: node, clientLanguages: "html,css", clientFrameworks: "unknown" })).trim();
  } catch {
    /* a frame with no variables, or an app that doesn't say */
  }

  const at = new Date().toISOString();
  const picture = ["picture.png", "picture.jpg"].find((f) => existsSync(join(dir, f)));
  const result: FigmaRead = { read, node, frame, width: Number(head[4]), height: Number(head[5]), base_version: base, assets: paths, picture: picture && `figma/${read}/${picture}`, found, at };
  writeFileSync(join(dir, "read.json"), JSON.stringify({ ...result, kind: head[1], code, outline, variables: variables && variables !== "{}" ? variables : undefined }));
  writeFileSync(join(figmaDir(projectId, sketchId), "frame.json"), JSON.stringify({ node, name: frame, at } satisfies FrameMemory));
  return result;
}

/** What Panel tells Figma about itself when asking for code (Figma uses it for its own records). */
const CODE_ARGS = { clientLanguages: "html,css", clientFrameworks: "unknown", forceCode: true };
/** Figma's ways of saying it may not write a frame's images into Panel's folder. */
const CANT_WRITE = /Cannot write to this directory|allowed directories|Path for asset writes|Failed to write assets/i;
/** How many of Figma's answers one reading by parts may take, so a huge frame still comes back in a minute or two. */
const MAX_PARTS = 60;

export interface Layer { id: string; kind: string; name: string; x: number; y: number; w: number; h: number; hidden: boolean; children: Layer[] }

/** The frame's layers, from the outline Figma gives (get_metadata's XML): kind, name, place, size, and what's inside. */
export function parseOutline(xml: string): Layer | null {
  let root: Layer | null = null;
  const stack: Layer[] = [];
  for (const m of xml.matchAll(/<(\/?)([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[1]) {
      stack.pop();
      continue;
    }
    const a = Object.fromEntries([...m[3]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1]!, unescapeXml(x[2]!)]));
    if (!a.id) continue;
    const layer: Layer = { id: a.id, kind: m[2]!, name: a.name ?? "", x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.width) || 0, h: Number(a.height) || 0, hidden: a.hidden === "true", children: [] };
    if (stack.length) stack.at(-1)!.children.push(layer);
    else root ??= layer;
    if (!m[4]) stack.push(layer);
  }
  return root;
}

/**
 * The frame read part by part, when Figma won't write its images into Panel's folder: each
 * layer gets Figma's code when it has no images; one that does is split into what's inside it,
 * and an image or icon on its own becomes a picture beside the sketch (layer-12-34.png). Every
 * part says where it sits in the frame, so the page can be put together from them.
 */
async function readByParts(app: Awaited<ReturnType<typeof figmaApp>>, root: Layer, dir: string, read: string) {
  const parts: string[] = [];
  const paths: string[] = [];
  let asked = 0;
  const place = (l: Layer) => `${Math.round(l.w)}×${Math.round(l.h)} at ${Math.round(l.x - root.x)}, ${Math.round(l.y - root.y)} in the frame`;
  const asPicture = async (l: Layer) => {
    const shot = (await app.call("get_screenshot", { nodeId: l.id, contentsOnly: true })).find((p) => p.type === "image") as Extract<Part, { type: "image" }> | undefined;
    if (!shot) return;
    const name = `layer-${l.id.replace(/[^0-9]+/g, "-")}.png`;
    writeFileSync(join(dir, name), Buffer.from(shot.data, "base64"));
    paths.push(`figma/${read}/${name}`);
    // Figma draws that area as it looks, so whatever lies over the layer shows in the picture too.
    parts.push(`<!-- ${l.kind} “${l.name}”, ${place(l)}: has an image or drawing, so it came as a picture of that area (what lies over it shows too): figma/${read}/${name} -->`);
  };
  const walk = async (l: Layer): Promise<void> => {
    if (l.hidden) return;
    if (asked >= MAX_PARTS) return asPicture(l);
    asked++;
    try {
      const code = textOf(await app.call("get_design_context", { nodeId: l.id, ...CODE_ARGS, excludeScreenshot: true, dirForAssetWrites: dir }));
      parts.push(`<!-- ${l.kind} “${l.name}”, ${place(l)} -->\n${tidyCode(code, dir, read)}`);
    } catch (e) {
      if (!CANT_WRITE.test((e as Error).message)) throw e;
      if (!l.children.length) return asPicture(l);
      parts.push(`<!-- ${l.kind} “${l.name}”, ${place(l)}: holds the parts below -->`);
      for (const c of l.children) await walk(c);
    }
  };
  for (const c of root.children) await walk(c);
  const outline = (function draw(l: Layer, depth: number): string {
    return [`${"  ".repeat(depth)}${l.kind} “${l.name}” ${place(l)}${l.hidden ? " (hidden)" : ""}`, ...l.children.map((c) => draw(c, depth + 1))].join("\n");
  })(root, 0);
  return { code: parts.join("\n\n"), paths, outline };
}

/**
 * A long page's picture can be too big for Claude to be shown (a few megabytes, 8000 pixels on
 * a side): then it is kept as a JPEG that fits, made by macOS's own sips.
 */
async function fitPicture(dir: string) {
  const png = join(dir, "picture.png");
  const big = statSync(png).size > 3_500_000;
  const p = Bun.spawn(["sips", "-g", "pixelHeight", "-g", "pixelWidth", png], { stdout: "pipe", stderr: "ignore" });
  const dims = (await new Response(p.stdout).text()).match(/\d+/g)?.map(Number) ?? [];
  const tall = Math.max(...dims.slice(-2), 0) > 7800;
  if (!big && !tall) return;
  const conv = Bun.spawn(["sips", ...(tall ? ["-Z", "7800"] : []), "-s", "format", "jpeg", "-s", "formatOptions", "82", png, "--out", join(dir, "picture.jpg")], { stdout: "ignore", stderr: "ignore" });
  if ((await conv.exited) === 0 && existsSync(join(dir, "picture.jpg"))) rmSync(png);
}

/**
 * Figma's images, where the page can use them: beside the sketch, by a path relative to the
 * page (figma/<read>/name.png). Figma either wrote them into the folder already, or serves them
 * from the app (http://localhost:3845/assets/…), and then Panel downloads them.
 */
async function gatherAssets(code: string, dir: string, read: string) {
  const paths = new Set<string>();
  const safeName = (name: string, i: number) => {
    const clean = basename(name).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[-.]+/, "").slice(-90);
    return /\.(png|jpe?g|svg|gif|webp)$/i.test(clean) ? clean : `image-${i}.png`;
  };
  let i = 0;
  // Served by the app: download each one.
  const served = [...new Set(code.match(/https?:\/\/(?:localhost|127\.0\.0\.1):3845\/assets\/[^\s"'`)]+/g) ?? [])];
  for (const url of served) {
    const name = safeName(new URL(url).pathname, ++i);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      writeFileSync(join(dir, name), Buffer.from(await res.arrayBuffer()));
      code = code.split(url).join(`figma/${read}/${name}`);
      paths.add(`figma/${read}/${name}`);
    } catch {
      /* the page will show the picture without that image; FRIDAY is told which ones came */
    }
  }
  // Written into the folder: give each a tidy name, and point the code at it.
  for (const f of readdirSync(dir)) {
    if (/^picture\.(png|jpg)$|^read\.json$/.test(f) || !statSync(join(dir, f)).isFile()) continue;
    const name = safeName(f, ++i);
    if (name !== f) renameSync(join(dir, f), join(dir, name));
    code = code.split(join(dir, f)).join(`figma/${read}/${name}`);
    paths.add(`figma/${read}/${name}`);
  }
  return { code, paths: [...paths] };
}

/**
 * Figma's code comes with notes for a coding agent in someone's codebase ("convert to the target
 * project's stack", where images are on disk). FRIDAY has its own how-to, so they're left out,
 * and no path on this Mac is left in it: only paths relative to the page.
 */
export function tidyCode(code: string, dir: string, read: string) {
  return code
    .replace(/SUPER CRITICAL:[\s\S]*?DO NOT install[^\n]*\n?/g, "")
    .replace(/Image assets should be read from disk[\s\S]*?(?:same approach for both types of assets\.?|\n\n)/g, "")
    .split(dir).join(`figma/${read}`)
    .trim();
}

/** Each SVG drawing in the folder, with what it draws (and the layer it came from), up to this much in all. */
const MAX_DRAWINGS = 40_000;

/**
 * Figma's code imports its drawings from made-up modules (import { imgVector1 } from "./svg-x1y2"),
 * which name no file, while photos come with their paths. So each SVG it wrote is listed after
 * the code with what's in it: the layer's name is inside (<path id="Vector 1">), and Claude can
 * match it to the import by that and its size, or put the drawing straight into the page.
 */
function drawingsIn(dir: string, read: string) {
  const svgs = readdirSync(dir).filter((f) => f.endsWith(".svg"));
  if (!svgs.length) return "";
  let room = MAX_DRAWINGS;
  const out = svgs.map((f) => {
    const svg = readFileSync(join(dir, f), "utf8").trim();
    const shown = room > 0 ? (svg.length <= Math.min(room, 6000) ? svg : `${svg.slice(0, Math.min(room, 6000))}… (cut short; the whole drawing is in the file)`) : "(not shown; it's in the file)";
    room -= shown.length;
    return `figma/${read}/${f}:\n${shown}`;
  });
  return `\n\nThe drawings (SVG) Figma wrote. Its code imports them under made-up names; match each by the layer name inside it and its size, and use the file or put the drawing into the page:\n\n${out.join("\n\n")}`;
}

/** One reading as kept, for get_figma_frame: Figma's code, its variables, and the picture. */
export function figmaReading(projectId: string, sketchId: string, read?: string) {
  const base = figmaDir(projectId, sketchId);
  let id = read?.trim();
  if (!id) {
    // The newest reading.
    const all = existsSync(base) ? readdirSync(base).filter((f) => READ_ID.test(f) && existsSync(join(base, f, "read.json"))) : [];
    id = all.sort((a, b) => statSync(join(base, b)).mtimeMs - statSync(join(base, a)).mtimeMs)[0];
    if (!id) throw new Error("This sketch hasn't been brought back from Figma yet: select its frame in Figma and press Bring back in the studio.");
  }
  if (!READ_ID.test(id) || !existsSync(join(base, id, "read.json"))) throw new Error("There's no such reading from Figma for this sketch.");
  const r = JSON.parse(readFileSync(join(base, id, "read.json"), "utf8")) as FigmaRead & { kind?: string; code?: string; outline?: string; variables?: string };
  const picture = ["picture.png", "picture.jpg"].map((f) => join(base, id!, f)).find((f) => existsSync(f)) ?? "";
  const code = r.code ?? "";
  return {
    ...r,
    code: code.length > MAX_CODE ? `${code.slice(0, MAX_CODE)}\n… (Figma's code goes on; the picture shows the rest)` : code,
    picture: picture || undefined,
  };
}

/** What a frame is called when it's copied into Figma: the sketch, its version, and the state and screen if not the usual. */
export function frameName(title: string, version: number, state?: string, device?: string) {
  return [title, `v${version}`, state, device && device !== "desktop" ? device : ""].filter(Boolean).join(" · ");
}
