// Packs the Phosphor icons (the @phosphor-icons/core package, MIT) into Panel's ready-made parts:
// ready/icons/<weight>.json, one file per weight with each icon's name and the inside of its SVG,
// and ready/icons/index.json, every icon's name with its search words and categories.
//
//   bun scripts/pack-icons.ts <the unpacked package folder>
//
// The folder is the one the package's .tgz unpacks to (it holds package.json, assets/ and dist/).
// Everything is read as text: nothing from the package is imported or run. The catalogue comes
// from dist/icons.d.ts, which lists every icon as plain text, so it can be read without its code.
// Run it again with a newer version of the package to bring Panel's icons up to date.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, "package.json")) || !existsSync(join(dir, "assets"))) {
  console.error("Give the unpacked package folder: bun scripts/pack-icons.ts <folder with package.json and assets/>");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string; version: string };
if (pkg.name !== "@phosphor-icons/core") throw new Error(`That folder holds ${pkg.name}, not @phosphor-icons/core.`);

const OUT = resolve(import.meta.dir, "..", "ready", "icons");
mkdirSync(OUT, { recursive: true });

// Every icon file opens with exactly this tag; one that doesn't stops the packing, so a change in
// a new version is noticed instead of being packed wrong.
const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">';
const WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"] as const;

let names: string[] | null = null;
for (const weight of WEIGHTS) {
  const folder = join(dir, "assets", weight);
  // Regular icons are "trash.svg"; the other weights add their name: "trash-bold.svg".
  const suffix = weight === "regular" ? ".svg" : `-${weight}.svg`;
  const icons: Record<string, string> = {};
  for (const file of readdirSync(folder).filter((f) => f.endsWith(".svg")).sort()) {
    if (!file.endsWith(suffix)) throw new Error(`${weight}/${file} isn't named like the others.`);
    const svg = readFileSync(join(folder, file), "utf8").trimEnd();
    if (!svg.startsWith(OPEN) || !svg.endsWith("</svg>")) throw new Error(`${weight}/${file} doesn't open and close like the others.`);
    icons[file.slice(0, -suffix.length)] = svg.slice(OPEN.length, -"</svg>".length);
  }
  const these = Object.keys(icons).sort();
  if (names && these.join() !== names.join()) throw new Error(`${weight} doesn't have the same icons as the other weights.`);
  names = these;
  writeFileSync(join(OUT, `${weight}.json`), JSON.stringify({ version: pkg.version, weight, viewBox: "0 0 256 256", icons }) + "\n");
  console.log(`${weight}: ${these.length} icons`);
}

// ---- The catalogue: names, search words and categories, read from the type declarations as text ----

/** The categories' names, from "CATEGORY = \"value\"" lines in dist/types.d.ts. */
function enumValues(types: string, name: string) {
  const body = types.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))?.[1];
  if (!body) throw new Error(`No ${name} in types.d.ts.`);
  return Object.fromEntries([...body.matchAll(/(\w+) = "([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
}
const types = readFileSync(join(dir, "dist", "types.d.ts"), "utf8");
const CATEGORY = enumValues(types, "IconCategory");
const strings = (s: string) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);

const decl = readFileSync(join(dir, "dist", "icons.d.ts"), "utf8");
// Each icon is one "{ readonly name: …; … }" block in the declared array.
const blocks = decl.slice(decl.indexOf("[{") + 1, decl.lastIndexOf("}]") + 1).split(/\n\}, \{/);
const catalogue = blocks.map((block) => {
  const field = (key: string) => block.match(new RegExp(`\\n    readonly ${key}: (.*);`))?.[1];
  const name = strings(field("name") ?? "")[0];
  if (!name) throw new Error(`An entry in icons.d.ts has no name: ${block.slice(0, 80)}`);
  const alias = block.match(/readonly alias: \{\s*readonly name: "([^"]+)"/)?.[1];
  const categories = [...(field("categories") ?? "").matchAll(/IconCategory\.(\w+)/g)].map((m) => CATEGORY[m[1]!] ?? m[1]!);
  // "*new*" and "*updated*" mark what changed in a version: not words anyone searches for.
  const tags = strings(field("tags") ?? "").filter((t) => !/^\*.*\*$/.test(t));
  return { name, ...(alias ? { alias } : {}), tags, categories };
});
const files = new Set(names);
const listed = new Set(catalogue.map((c) => c.name));
const missing = [...files].filter((n) => !listed.has(n));
const extra = [...listed].filter((n) => !files.has(n));
if (missing.length || extra.length) throw new Error(`The catalogue and the files differ: ${[...missing, ...extra].slice(0, 5).join(", ")}`);
catalogue.sort((a, b) => a.name.localeCompare(b.name));

const license = readFileSync(join(dir, "LICENSE"), "utf8").replace(/\r\n/g, "\n").trim();
writeFileSync(join(OUT, "index.json"), JSON.stringify({
  source: `${pkg.name} ${pkg.version} (MIT), github.com/phosphor-icons/core`,
  license,
  weights: WEIGHTS,
  count: catalogue.length,
  icons: catalogue,
}, null, 0).replace(/\},\{/g, "},\n{") + "\n");
console.log(`index: ${catalogue.length} icons, ${catalogue.filter((c) => c.tags.length).length} with search words, ${catalogue.filter((c) => c.alias).length} with an older name`);
