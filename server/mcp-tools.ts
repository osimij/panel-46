// The tools Panel offers any AI app over MCP. The logic lives in library.ts; this file
// only describes each tool and shapes its answer. Used by mcp.ts (stdio) and the /mcp route.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readMaterial } from "./materials.ts";
import { fontLines } from "./fonts.ts";
import { BRAND_KINDS, brandLine, brandPaths, getBrandAsset, listBrand } from "./brand.ts";
import { designRules } from "./rules.ts";
import { getSkill, outsideSkills, skillsChecked } from "./skilluse.ts";
import { chosenRefs, findProject, listProjects, projectsOf, summary, verdicts, REF_STATES, TOPIC_FACETS } from "./projects.ts";
import { addNote, addTopic, connectTopics, editSketch, getSketch, lockTopic, makeSketch, markSaves, placeOnBoard, sketchMeta, type SketchResult } from "./board.ts";
import { figmaReading, readFrame } from "./figma.ts";
import { existsSync } from "node:fs";
import { DEVICES, fullUrl, readSketch, renderOf, SCREEN, sketchPath, withSkillChecks, type Device, type Render } from "./sketches.ts";
import { describeFindings } from "./rulecheck.ts";
import { getBuild, messageBuild, seeBuild, startBuild, writeHandoff } from "./builds.ts";
import { FACETS, TYPES, findByColor, gather, overview, reference, search, similar } from "./library.ts";
import { getReadyMade, ICON_WEIGHTS } from "./ready.ts";

const INSTRUCTIONS = `Panel is a designer's private library of saved design references: websites, app screens, posters, brands, motion pieces, photos. Each save has a design read written by Claude Opus from its pictures (and, for videos, frame grids and motion close-ups), split into facets: color (with colors measured from the pixels, as hex), typography, layout, imagery, motion, mood, components, worth_taking and search_terms. The designer's own note, when present, matters most.

Use it to find references for a brief and to combine them: color from one save, type from another, motion from a third.
- Start with library_overview to learn the words the library uses (moods, fonts, motion techniques).
- gather_for_brief gives the best saves per facet for a brief in one call.
- search_library finds by words and, when its answer says found_by includes "meaning", by meaning too (a save described in other words still comes up, in English or Russian). Give it look ("a dark dashboard with glowing charts") to find by the pictures themselves. If found_by is only "words", matching is by words alone: try synonyms when results are thin. It answers with short cards for the best and one line each for the rest.
- find_by_color matches measured palettes by hex (ΔE distance).
- similar_to finds saves like one you have, by facet; the facet "look" compares the pictures themselves.
- get_reference returns everything about a save (the whole read, what's worth taking), and its pictures so you can look at it yourself; with facets, only those parts. Open and look before you recommend. For a website it also has measured_in_page: the fonts the site really uses (with whether each has Cyrillic and Tajik letters), its text sizes, colors and corner radii, read from the live page. Trust those over likely_fonts, which are guesses from pictures. Searching typography for a font's name, or for "cyrillic" or "tajik", finds sites whose own fonts have those letters.
- Projects are the designer's canvases for a piece of work: decisions (Typography, Color…) with the saves chosen, kept and ruled out for each, and the designer's reasons. list_projects shows them; get_project reads one, with its brief and materials (files and links the designer added: specs, brand books, sites); get_project_material reads a material in full. When working on a project, read it and the materials that matter first, and build from its locked decisions.
- get_verdicts is the designer's taste across every project: what they chose and ruled out, with their reasons. Lean on it.
- On a project's canvas you can place_on_board (saves under a topic, as suggestions), add_topic, connect_topics and add_note. The designer decides: mark_saves and lock_topic only when they say so. Each change appears live on their canvas and can be undone there.
- To try a direction before anyone builds it, make_sketch puts a quick page on the canvas: one self-contained HTML file. You get back pictures of it as rendered; look, check it against the brief and the rules, and fix it with edit_sketch before showing it. get_sketch reads one back, on any device or in any of its states.
- The designer uploads their own fonts to Panel (get_fonts lists them). Every sketch has them loaded already: write font-family with the family's name, no @font-face or link. When the designer names one, use it.
- Each project can have brand assets (get_brand_assets): the client's real logos, icons, pictures, patterns and brand books. When a sketch shows the brand, use its real logo with <img src="/brand/…"> (the src given), never a drawn stand-in. When building for real, copy the files from their path on this Mac.
- Give a sketch knobs: declare its colors, fonts, type sizes, radius and spacing as CSS variables on :root (--bg, --ink, --accent, --font-display, --radius…) and use them throughout. Where a name doesn't say what it is, write a short plain note beside it (--c1: #e2372b; /* Cortex */): the studio shows it as the knob's name. The designer adjusts them live in Panel's studio and may keep a version with their own values; build on those.
- A sketch can be clickable: a flow of screens, or states (empty, loading, error). List them in <meta name="panel:states" content="home: Главная, detail: Детали, error: Ошибка"> (a Latin id, then the name shown) and show each when the address ends in #id (#detail, #error; the first shows with no #), switching on hashchange; links between screens just set location.hash.
- A sketch can go to Figma and come back: the designer copies it into Figma from the studio, changes it there, and brings it back. get_figma_frame then gives the Figma frame beside the page it started from; rebuild the page with edit_sketch as its next version, keeping its knobs, states and scripts.
- When the designer chooses a sketch, get_handoff writes down everything needed to build it, and start_build hands it to Claude Code to build in their code (get_build, message_build follow it).
- The designer's skills are craft files they turned on (setting type, motion…): get_skill lists them and reads one. They come after the designer's rules and a project's locked decisions, and before any reference.
- Panel comes with ready-made parts (get_ready_made): loading animations, colour scales and icons. Paste what it gives into the sketch as is; the sketch stays one self-contained file. A loading state uses one of its animations, never one you draw. Every icon comes from its icons, never drawn by hand and never an emoji: find all the icons a page needs in one call, and keep one weight on a page, with fill only to mark what is active, unless the designer or a skill says otherwise. A project's own brand icons (get_brand_assets) come first. A colour scale is a starting point only when the project has no colours of its own: locked decisions, brand assets and the designer's rules come first.
For each save you recommend, give the designer its "open" link from get_reference's answer, so they can watch or look at the original.`;

const RULES_NOTE = `
- The designer keeps standing rules for every design (unugly.md): get_design_rules returns them, and get_project starts with them. Read them before you design, build or judge anything, follow them over any reference, and check the result against them before you show it.`;

const skillsHeading = "## The designer's skills\n\nCraft they chose for every design: how to decide and how to build it well. They come after the rules above and a project's locked decisions, and before any reference.";

const rulesHeading = "The designer's rules (unugly.md). They hold for everything designed or built here and outrank any reference; check the result against them before showing it.";

const facet = z.enum(FACETS);
const filterShape = {
  types: z.array(z.enum(TYPES)).optional().describe("Only these kinds of save. video includes GIFs; site is a whole website as full-page screenshots; person is a designer's profile; skill is a text file for AI agents."),
  favorites: z.boolean().optional().describe("Only saves the designer starred."),
  tags: z.array(z.string()).optional().describe("Only saves with every one of these tags."),
  collection: z.string().optional().describe("Only saves in this collection (by name)."),
  has_motion: z.boolean().optional().describe("true: only saves with motion worth learning from."),
  has_type: z.boolean().optional().describe("true: only saves with typography worth learning from."),
  temperature: z.enum(["warm", "cool", "neutral", "mixed"]).optional(),
  contrast: z.enum(["low", "medium", "high"]).optional(),
  saturation: z.enum(["muted", "balanced", "vivid"]).optional(),
  density: z.enum(["sparse", "balanced", "dense"]).optional(),
  whitespace: z.enum(["minimal", "moderate", "generous"]).optional(),
  pace: z.enum(["slow", "medium", "fast"]).optional().describe("Pace of the motion."),
};

// How much each save in a search's answer says. Short is the default because a search is
// read in full by the model, and most of a full card only matters for the saves it then opens.
const detail = z.enum(["short", "full"]).optional().describe("short (default): a short card each. full: the whole card, up to 4× longer; only when you need every save's detail.");

type Content = ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];

/** A sketch's answer: what it is, what went wrong in the page, and its screens as pictures to look at. */
async function sketchContent(head: Record<string, unknown>, render: Render, pictures = true, device: Device = "desktop"): Promise<Content> {
  const screen = DEVICES[device];
  const content: Content = [{
    type: "text",
    text: JSON.stringify({
      ...head,
      page_height: render.height || undefined,
      page_errors: render.errors.length ? render.errors : undefined,
      // Measured in the page, not judged: "breaks" must be fixed, "check" needs a real reason to stay.
      rule_checks: describeFindings(render.rules),
      // Measured against the designer's skills that are on; absent with none on.
      skill_checks: describeFindings(render.skills),
      // Which skills were measured, also when nothing was found; absent when nothing was measured.
      skills_checked: render.skillKey ? nonEmpty(skillsChecked(render.apply)) : undefined,
      skills_that_apply: render.apply?.length ? render.apply : undefined,
      not_rendered: render.failed,
    }),
  }];
  if (!pictures) return content;
  for (const [i, file] of render.screens.entries()) {
    const f = Bun.file(file);
    if (!(await f.exists())) continue;
    const top = i * screen.height;
    content.push({ type: "text", text: `Screen ${i + 1} of ${render.screens.length} on ${device} at ${screen.width}×${screen.height}${screen.scale > 1 ? ` (${screen.scale}× pixels)` : ""} (page from ${top}px)${i === 0 ? ", what the designer sees first" : ""}` });
    content.push({ type: "image", data: Buffer.from(await f.arrayBuffer()).toString("base64"), mimeType: "image/jpeg" });
  }
  return content;
}

const nonEmpty = <T,>(a: T[]) => (a.length ? a : undefined);

const LOOK = "Look at the screens before you answer: check them against the brief, the locked decisions and the designer's rules, and fix what's off with edit_sketch first. page_errors come from the page itself (scripts, fonts, images that failed). rule_checks are what Panel measured in the page against the designer's rules: fix every one marked breaks before you reply; for each marked check, remove it or be ready to say why it earns its place. The checks can't see everything (whether something physical looks real, whether a font's Cyrillic is well drawn), so still look.";

/** How a page comes back from Figma: what to take from the frame, and what of the page to keep. */
const FIGMA_HOW_TO = (sketch: string, base: number) =>
  `Rebuild the page so it looks like the Figma frame, as the sketch's next version: edit_sketch with sketch "${sketch}", from_version ${base}, and html: the whole new page. Don't make a new sketch. ` +
  "Start from the page as it was (below) and take on everything the designer changed in Figma: layout, words, sizes, colors, type, images, what was added or taken away. Read exact values from Figma's code; don't copy its structure, class names or absolute positions, rebuild with flex and grid so the page still works at other widths. " +
  "Keep what Figma can't hold: the :root variables (same names; give one its new value when the frame shows a new color, font, size or radius, and keep using the variable where the page did), the states in <meta name=\"panel:states\"> and the script that switches them, other scripts, hover, motion and links, and fonts by their family name. The frame shows one state on one screen size; keep the others working, changed the same way where it applies. " +
  "Figma's images are beside the page: use each by the relative path given in images (figma/…/name.png). Pictures that were in the page before stay as they were. When the frame came part by part, a part's picture shows that whole area as Figma draws it, with whatever lies over it: use one as an image only for a photo or an illustration, and draw shapes, icons and words yourself (CSS, inline SVG, text), with the sizes and places the outline gives. " +
  "Then look at the new version's render next to the Figma picture and fix what differs before you answer. Say in a line or two what changed and anything you couldn't carry over.";

const made = async (r: SketchResult, device: Device = "desktop") =>
  sketchContent({
    sketch: r.id, title: r.title, version: r.version, page: fullUrl(sketchPath(r.project, r.id, r.version)),
    states: r.states?.length ? r.states : undefined,
    linked_saves: r.linked_saves,
    on_canvas: "as a suggestion; the designer keeps, chooses or rules it out",
    next: r.states && r.states.length > 1 ? `${LOOK} These pictures show the first state; look at the others with get_sketch state.` : LOOK,
  }, await withSkillChecks(r.render, fullUrl(sketchPath(r.project, r.id, r.version)), device), true, device);

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const failure = (e: unknown) => ({ content: [{ type: "text" as const, text: (e as Error).message }], isError: true });
const safe = <A,>(fn: (a: A) => unknown) => async (a: A) => {
  try {
    return text(await fn(a));
  } catch (e) {
    return failure(e);
  }
};
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

/** withRules: false for Ask, which has the designer's rules in its instructions already. */
export function createMcpServer({ withRules = true }: { withRules?: boolean } = {}) {
  const server = new McpServer({ name: "panel", title: "Panel design library", version: "1.0.0" }, { instructions: withRules ? INSTRUCTIONS + RULES_NOTE : INSTRUCTIONS });

  if (withRules) {
    server.registerTool("get_design_rules", {
      title: "The designer's rules",
      description: "The designer's standing rules for every design (unugly.md): what to always do (realism for anything physical, careful Cyrillic, Apple corner smoothing, three button shapes) and the signs of generic design to avoid. Read before designing, building or judging anything, and check the result against them.",
      inputSchema: {},
      annotations: readOnly,
    }, async () => {
      const rules = designRules();
      // The Always skills' Decide and Build follow the rules, under their own heading.
      const skills = outsideSkills("decide+build");
      const skillText = skills.length ? `\n\n${skillsHeading}\n\n${skills.map((x) => `### ${x.name}\n\n${x.text}`).join("\n\n")}` : "";
      return { content: [{ type: "text" as const, text: (rules ? `${rulesHeading}\n\n${rules}` : "The designer hasn't written any rules yet (unugly.md is missing).") + skillText }] };
    });
  }

  server.registerTool("get_skill", {
    title: "Read one of the designer's skills",
    description: "The designer's skills are craft files they turned on (setting type, motion…). With a name, the skill as FRIDAY uses it: for one Panel has read, its short version (what to decide, how to build, what Panel checks) and its files; file \"SKILL.md\" gives the whole skill as its author wrote it. With none, the list of skills that are on and when each is used.",
    inputSchema: {
      name: z.string().optional().describe("The skill's name, as listed."),
      file: z.string().optional().describe("One of the skill's files, as its answer lists them: \"SKILL.md\" for the whole skill as written."),
    },
    annotations: readOnly,
  }, async ({ name, file }) => {
    try {
      return { content: [{ type: "text" as const, text: getSkill(name, file) }] };
    } catch (e) {
      return failure(e);
    }
  });

  server.registerTool("get_fonts", {
    title: "The designer's fonts",
    description: "The fonts the designer uploaded to Panel (licensed or brand typefaces that aren't on Google Fonts): each family with its weights and italics. Every sketch has them loaded already, so a sketch only writes font-family: \"The Family\". Use one when the designer names it.",
    inputSchema: {},
    annotations: readOnly,
  }, async () => {
    const lines = fontLines();
    return { content: [{ type: "text" as const, text: lines.length ? `The designer's fonts, loaded in every sketch (write font-family with the name in quotes, plus a fallback):\n${lines.map((l) => `- ${l}`).join("\n")}` : "The designer hasn't uploaded any fonts yet." }] };
  });

  server.registerTool("get_brand_assets", {
    title: "Brand assets",
    description: "The brand assets the designer keeps in Panel: each project's real logos, icons, images, patterns and brand books (guides), as files. Each comes with the src a sketch uses (<img src=\"/brand/….svg\">, which works in every sketch as is) and its path on this Mac for building for real. With pictures, you also see them (an SVG's own code comes too, when it's small). Use the real logo whenever a sketch shows the brand, never a drawn stand-in.",
    inputSchema: {
      project: z.string().optional().describe("A project's id or name: only its assets. \"none\" for those in no project. Leave out for all of them."),
      ids: z.array(z.string()).optional().describe("Particular assets, by id (from a list, or [[brand:id]] in the designer's message)."),
      kind: z.enum(BRAND_KINDS).optional().describe("Only one kind: logo, icon, image, pattern, guide (brand books) or other."),
      pictures: z.boolean().optional().describe("Look at them too (default: true when ids are given or there are 8 or fewer)."),
    },
    annotations: readOnly,
  }, async ({ project, ids, kind, pictures }) => {
    let list = ids?.length ? ids.flatMap((id) => getBrandAsset(id) ?? []) : listBrand(project === undefined ? undefined : project === "none" ? "none" : findProject(project)?.id ?? project);
    if (kind) list = list.filter((a) => a.kind === kind);
    if (!list.length) return { content: [{ type: "text" as const, text: ids?.length ? "Those assets aren't in Panel." : "No brand assets there yet. The designer adds them in Panel (Brand assets, in the sidebar)." }] };
    const content: Content = [{
      type: "text",
      text: `Brand assets (src works in any sketch as is; path is the file on this Mac):\n${list.map((a) => `- ${brandLine(a)}; path: ${brandPaths(a.id)?.file}`).join("\n")}`,
    }];
    const look = pictures ?? (!!ids?.length || list.length <= 8);
    if (look) {
      for (const a of list.slice(0, 12)) {
        const where = brandPaths(a.id);
        if (a.format === "svg" && a.size <= 12_000) {
          const code = await Bun.file(where!.file).text().catch(() => "");
          if (code) content.push({ type: "text", text: `“${a.name}” as SVG code:\n${code}` });
        }
        const pic = where?.look;
        const mime = pic?.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(pic ?? "") ? "image/jpeg" : pic?.endsWith(".webp") ? "image/webp" : null;
        if (!pic || !mime || !existsSync(pic)) continue;
        content.push({ type: "text", text: `“${a.name}” (${a.kind}, ${a.format.toUpperCase()}):` });
        content.push({ type: "image", data: Buffer.from(await Bun.file(pic).arrayBuffer()).toString("base64"), mimeType: mime });
      }
    }
    return { content };
  });

  // Ready-made parts that ship with Panel (ready.ts): loading animations, colour scales, icons.
  server.registerTool("get_ready_made", {
    title: "Ready-made parts",
    description: "Loading animations, colour scales (OKLCH, light and dark) and icons (Phosphor) that come with Panel, to paste into a sketch as given. With nothing, the list.",
    inputSchema: {
      loading: z.string().optional().describe("A loading animation's name: its piece to paste."),
      palette: z.string().optional().describe("A colour scale's name: its steps, light and dark, and what each is for."),
      find_icons: z.string().optional().describe("What each icon is for, comma-separated (\"trash, settings, arrow right\"): the best names for each."),
      icons: z.array(z.string()).optional().describe("Icon names, up to 12: each as an SVG to paste."),
      weight: z.enum(ICON_WEIGHTS).optional().describe("The icons' weight (default regular)."),
    },
    annotations: readOnly,
  }, async (a) => ({ content: [{ type: "text" as const, text: getReadyMade(a) }] }));

  server.registerTool("get_verdicts", {
    title: "The designer's verdicts",
    description: "Everything the designer has chosen and ruled out across all their projects, grouped by the reason they gave: what they keep choosing and what they keep turning down, in their own words, with examples. Read it before suggesting references or sketching, to lean on their taste, and to notice a reason that keeps coming back (worth offering as a line for their rules).",
    inputSchema: {},
    annotations: readOnly,
  }, safe(() => verdicts()));

  server.registerTool("library_overview", {
    title: "Library overview",
    description: "What's in the library: how many saves of each kind, the designer's tags and collections, and the vocabulary the design reads use (moods, formats, style references, type classifications, likely fonts, motion techniques, imagery styles, components, color families), each with a count. Call this first to know which words will find things.",
    inputSchema: {},
    annotations: readOnly,
  }, safe(() => overview()));

  server.registerTool("search_library", {
    title: "Search the library",
    description: "Find saves by words and by meaning: saves matching more words come first, and saves whose reads say the same in other words are found too (found_by says which ways were used; with only \"words\", try a few phrasings). With facets, the search stays within those facets: query \"stagger spring\" with facets [\"motion\"] finds motion that staggers, not a poster that mentions springs. With look, saves are ranked by how their pictures match it. No query: the newest. Combine with colors and filters. Answers with short cards for the best and a line each for the rest; the whole read is in get_reference.",
    inputSchema: {
      query: z.string().optional().describe("Words to look for: mood, style, technique, component, font, subject, creator…"),
      look: z.string().optional().describe("How it should look, described plainly in English, e.g. \"a dark dashboard with glowing charts\" or \"a poster with one huge red word\". Matches the pictures themselves, not what was written about them. Alone or together with query."),
      facets: z.array(facet).optional().describe("Search only within these facets of the read."),
      colors: z.array(z.string()).optional().describe("Also require these colors in the measured palette: hex (#1d1765) or a plain name (navy, warm white)."),
      color_match: z.enum(["any", "all"]).optional().describe("With colors: any (default) or all must be present."),
      ...filterShape,
      limit: z.number().int().min(1).max(60).optional().describe("Default 12."),
      offset: z.number().int().min(0).optional(),
      detail,
    },
    annotations: readOnly,
  }, safe((a) => search(a)));

  server.registerTool("find_by_color", {
    title: "Find by color",
    description: "Saves whose measured palette contains these colors, nearest first. Colors were measured from the pixels, so this is exact, not an AI's guess. Distance is ΔE2000 (as the eye judges it): about 2 is barely visible, 5 a close match, 10 the same family, 20 loose. If nothing is that close, the nearest are returned with a note.",
    inputSchema: {
      colors: z.array(z.string()).min(1).describe("Hex values (#e85d3a) or plain names (terracotta matches only if the palette uses that word; prefer hex)."),
      match: z.enum(["any", "all"]).optional().describe("any (default): at least one color; all: every color."),
      max_distance: z.number().min(1).max(40).optional().describe("ΔE2000 allowed. Default 10."),
      min_share: z.number().min(0).max(1).optional().describe("Ignore swatches smaller than this share of the picture. Default 0.03."),
      role: z.string().optional().describe("Only swatches whose role contains this word: background, accent, text, surface…"),
      ...filterShape,
      limit: z.number().int().min(1).max(60).optional(),
      detail,
    },
    annotations: readOnly,
  }, safe((a) => findByColor(a)));

  server.registerTool("similar_to", {
    title: "Similar saves",
    description: "Saves like a given one, judged by the facets you choose: color compares measured palettes; look compares the pictures themselves; the others compare what the reads say about that facet, by shared words and by meaning. Several facets are combined, so [\"color\",\"motion\"] finds saves close in both. Use it for \"more like this\" (look) or \"this palette but different type\".",
    inputSchema: {
      id: z.string().describe("The save to compare against."),
      facets: z.array(z.enum([...FACETS, "overall", "look"])).optional().describe("Default [\"overall\"]. look: by the pictures themselves."),
      ...filterShape,
      limit: z.number().int().min(1).max(40).optional().describe("Default 10."),
      detail,
    },
    annotations: readOnly,
  }, safe((a) => similar(a)));

  server.registerTool("gather_for_brief", {
    title: "Gather references for a brief",
    description: "For a design brief, the best saves for each facet on its own (color, typography, layout, imagery, motion by default), preferring different saves per facet so the mix is wide. This is where combining starts: e.g. \"calm warm editorial banking app\" might take its palette from a poster, its type from a magazine site and its motion from an onboarding video. Write it in the library's vocabulary (see library_overview), and give each facet its own words with facet_briefs.",
    inputSchema: {
      brief: z.string().describe("The feeling, subject and qualities wanted, in plain words."),
      facet_briefs: z.object(Object.fromEntries(FACETS.map((f) => [f, z.string().optional()])) as Record<(typeof FACETS)[number], z.ZodOptional<z.ZodString>>).optional()
        .describe("Words for each facet on its own, which find far better picks than the whole brief: e.g. {typography: \"mono, technical, tight tracking\", motion: \"stagger, spring, blur\", color: \"dark, neon accent\"}. Facets left out use the brief."),
      facets: z.array(facet).optional(),
      colors: z.array(z.string()).optional().describe("Colors the palette picks should contain (hex)."),
      per_facet: z.number().int().min(1).max(8).optional().describe("Default 3."),
      ...filterShape,
    },
    annotations: readOnly,
  }, safe((a) => gather(a)));

  server.registerTool("get_reference", {
    title: "Open a save",
    description: "Everything about one or more saves: the whole design read (every facet, what's worth taking), measured palette with roles, the designer's note and tags, the source link, the original files on this Mac and the pictures the read was made from. Searches give short cards: open a save before saying what to take from it. With images, you see those pictures: for a video, frame grids in time order and motion close-ups 0.1s apart; for a site, crops and the whole page folded into columns.",
    inputSchema: {
      ids: z.array(z.string()).min(1).max(10),
      images: z.enum(["none", "first", "all"]).optional().describe("Pictures to include: none, first (default) or all."),
      facets: z.array(facet).optional().describe("Only these parts of the read, when that's all you need: much shorter."),
    },
    annotations: readOnly,
  }, async ({ ids, images = "first", facets }) => {
    const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
    for (const id of ids) {
      try {
        const { data, pictures } = reference(id, facets);
        const used = projectsOf(id);
        content.push({ type: "text", text: JSON.stringify(used.length ? { ...data, in_projects: used.map((p) => ({ project: p.name, state: p.state ?? "kept" })) } : data) });
        for (const p of images === "none" ? [] : images === "first" ? pictures.slice(0, 1) : pictures) {
          const file = Bun.file(p.path);
          if (!(await file.exists())) continue;
          content.push({ type: "text", text: `${data.id} picture: ${p.label}` });
          content.push({ type: "image", data: Buffer.from(await file.arrayBuffer()).toString("base64"), mimeType: "image/jpeg" });
        }
      } catch (e) {
        content.push({ type: "text", text: (e as Error).message });
      }
    }
    return { content };
  });

  server.registerTool("list_projects", {
    title: "List projects",
    description: "The designer's projects, most recently worked on first: each is a canvas of design decisions for one piece of work (a site, an app, a brand), with how many topics it has and how many are locked.",
    inputSchema: {},
    annotations: readOnly,
  }, safe(() => listProjects().map((p) => ({
    id: p.id, name: p.name, brief: p.brief || undefined, topics: p.topics, locked: p.locked, saves: p.refs, updated_at: p.updated_at,
  }))));

  server.registerTool("get_project", {
    title: "Read a project",
    description: "A project's canvas as decisions: the brief and the materials the designer added (files and links, short ones whole, longer ones to read with get_project_material), then each topic (Typography, Color, …) in the order the designer connected them, with its status (locked or exploring), the saves chosen, kept, proposed and ruled out for it, what each offers for that topic, and the designer's notes on why. Then saves and notes not filed under a topic yet. Locked topics are settled: build from them. Read this before designing or building anything for a project.",
    inputSchema: {
      project: z.string().describe("The project's id or its name."),
      pictures: z.boolean().optional().describe("Also return the first picture of each chosen save, to see them. Default false."),
    },
    annotations: readOnly,
  }, async ({ project, pictures = false }) => {
    try {
      const rules = withRules ? designRules() : "";
      const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
        ...(rules ? [{ type: "text" as const, text: `${rulesHeading}\n\n${rules}` }] : []),
        { type: "text", text: JSON.stringify(summary(project)) },
      ];
      // Its brand assets, so a sketch uses the real logo without being told where it is.
      const kit = listBrand(findProject(project)?.id ?? project);
      if (kit.length) content.push({ type: "text", text: `Its brand assets (get_brand_assets to see them):\n${kit.map((a) => `- ${brandLine(a)}`).join("\n")}` });
      if (pictures) {
        for (const id of chosenRefs(project).slice(0, 12)) {
          try {
            const pic = reference(id).pictures[0];
            if (!pic || !(await Bun.file(pic.path).exists())) continue;
            content.push({ type: "text", text: `${id} picture: ${pic.label}` });
            content.push({ type: "image", data: Buffer.from(await Bun.file(pic.path).arrayBuffer()).toString("base64"), mimeType: "image/jpeg" });
          } catch {
            /* a save that's gone has no picture */
          }
        }
      }
      return { content };
    } catch (e) {
      return failure(e);
    }
  });

  server.registerTool("get_project_material", {
    title: "Read a project's material",
    description: "One of a project's materials: a file the designer added (a spec, a brand book, notes; its text) or a picture (to look at), or a web page they linked (its text). get_project lists them with their ids, short ones whole and long ones as a summary. For a detail in a long one, use find: it returns the passages where those words appear (a screen's name, a term, a section title from the summary), each with its offset to read on from. Without find, long texts come in pages: call again with the offset it gives.",
    inputSchema: {
      project: z.string().describe("The project's id or name."),
      id: z.string().describe("The material's id (or its name) from get_project."),
      find: z.string().optional().describe("Words to look up in it; the passages around them come back instead of a page. Use the document's own language and terms."),
      offset: z.number().int().min(0).optional().describe("Where to start in the text, for the next page of a long one."),
    },
    annotations: readOnly,
  }, async ({ project, id, offset = 0, find }) => {
    try {
      const p = findProject(project);
      if (!p) throw new Error(`No project called “${project}”. list_projects shows them.`);
      const m = readMaterial(p.id, id, offset, undefined, find);
      const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
        { type: "text", text: JSON.stringify(m.head) },
      ];
      if (m.text) content.push({ type: "text", text: m.text });
      if (m.picture && (await Bun.file(m.picture).exists())) {
        content.push({ type: "image", data: Buffer.from(await Bun.file(m.picture).arrayBuffer()).toString("base64"), mimeType: "image/jpeg" });
      }
      return { content };
    } catch (e) {
      return failure(e);
    }
  });

  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const projectArg = z.string().describe("The project's id or name.");

  server.registerTool("place_on_board", {
    title: "Place saves on a project's canvas",
    description: "Put saves from the library on a project's canvas under a topic (Typography, Color, Layout…), as suggestions the designer then chooses, keeps or rules out. The topic is found by name or kind (\"type\" finds Typography) and made if it isn't there. Saves already under that topic, or that the designer took off it, are skipped. Give each save a short why: what to take from it for this topic, shown on its card. Place 4 to 8 at a time, the strongest first.",
    inputSchema: {
      project: projectArg,
      topic: z.string().describe("The topic to put them under, by name: \"Typography\", \"Color\", \"Hero layout\"…"),
      saves: z.array(z.object({ id: z.string(), why: z.string().optional().describe("A few words: what to take from it here (\"tall serif headings, generous leading\").") })).min(1).max(16),
      after_topic: z.string().optional().describe("If the topic is new: the topic it follows, so they're connected (e.g. Color after Typography)."),
    },
    annotations: write,
  }, safe((a) => placeOnBoard(a)));

  server.registerTool("add_topic", {
    title: "Add a topic to a project",
    description: "Add a decision to make to a project's canvas (Typography, Color, Layout, Imagery, Motion, Components, or anything else), optionally connected after another topic, as in Typography → Color.",
    inputSchema: {
      project: projectArg,
      title: z.string().min(1),
      facet: z.enum(TOPIC_FACETS).optional().describe("What kind of decision it is; guessed from the title if left out."),
      after: z.string().optional().describe("The topic this one follows."),
    },
    annotations: write,
  }, safe((a) => addTopic(a)));

  server.registerTool("connect_topics", {
    title: "Connect two topics",
    description: "Say that one topic leads to the next on a project's canvas (Typography → Color), so they're read in that order.",
    inputSchema: { project: projectArg, from: z.string(), to: z.string() },
    annotations: write,
  }, safe((a) => connectTopics(a)));

  server.registerTool("add_note", {
    title: "Add a note to a project",
    description: "Write a short note on a project's canvas, attached to a topic (by name) or a save (by id), or loose. Use it to record a reason the designer gave, or a question to come back to. Keep it to a sentence or two.",
    inputSchema: { project: projectArg, text: z.string().min(1), on: z.string().optional().describe("A topic's name or a save's id.") },
    annotations: write,
  }, safe((a) => addNote(a)));

  const html = z.string().min(1).describe("The whole page: one self-contained HTML file with its CSS and scripts inline. The designer's own fonts (get_fonts) are loaded already: just write font-family with their name. Other fonts and libraries from CDNs are fine (Google Fonts, cdnjs, jsdelivr, unpkg); so are three.js and shaders. It runs sandboxed: no localStorage, cookies or calls to Panel. Real content in the project's language, never lorem ipsum.");

  server.registerTool("make_sketch", {
    title: "Sketch a direction",
    description: `Put a quick page on a project's canvas to try a direction: a hero, a screen, a type specimen, a component, a motion study. It's rendered in Chrome at ${SCREEN.width}×${SCREEN.height}, and you get back pictures of up to three screens down the page plus any errors the page threw, so you can see it before the designer does. Build it from the project's locked decisions and materials. The card goes next to what it came from (from) as a suggestion; the designer keeps, chooses or rules it out. For a few directions at once, make one sketch per direction from the same thing, each with its own title and tries.`,
    inputSchema: {
      project: projectArg,
      title: z.string().min(1).max(120).describe("A short name for what this is: \"Hero, paper and stamp\", \"Tajik type specimen\"."),
      tries: z.string().max(300).optional().describe("In a line, what this direction tries, so it can be told apart from the others: \"stamp lands from above with a soft shadow\"."),
      html,
      from: z.string().optional().describe("What it comes from: a topic's name, a save's id, or another sketch's id or title (a branch of it)."),
      uses: z.array(z.string()).max(12).optional().describe("Ids of the saves it takes from (type from one, color from another). Each one on the canvas gets a line to the sketch, so the designer sees where it came from."),
      device: z.enum(["desktop", "tablet", "phone"]).optional().describe("The screen it's made for, and rendered on. Default desktop; phone for a mobile app screen (390×844)."),
    },
    annotations: write,
  }, async (a) => {
    try {
      return { content: await made(await makeSketch(a), a.device ?? "desktop") };
    } catch (e) {
      return failure(e);
    }
  });

  server.registerTool("edit_sketch", {
    title: "Change a sketch",
    description: "Change a sketch on a project's canvas: the result is a new version of it (old ones are kept; the designer can undo). For small changes give edits, each replacing an exact piece of the page; rewrite the whole page with html only when most of it changes. Returns the new version's pictures to look at again. To try something different while keeping this one, make a new sketch from it instead.",
    inputSchema: {
      project: projectArg,
      sketch: z.string().describe("The sketch's id (or its title)."),
      edits: z.array(z.object({
        find: z.string().min(1).describe("An exact piece of the current page, enough of it to be found once."),
        replace: z.string().describe("What goes there instead."),
        all: z.boolean().optional().describe("Replace every place it's found, not just one."),
      })).optional(),
      html: html.optional(),
      from_version: z.number().int().min(1).optional().describe("Build on this earlier version instead of the one on the canvas."),
      title: z.string().max(120).optional(),
      tries: z.string().max(300).optional(),
    },
    annotations: write,
  }, async (a) => {
    try {
      const r = await editSketch(a);
      const { getProject } = await import("./projects.ts");
      const device = (getProject(r.project)?.nodes.find((n) => n.id === r.id)?.data.device as Device | undefined) ?? "desktop";
      return { content: await made(r, device) };
    } catch (e) {
      return failure(e);
    }
  });

  server.registerTool("get_sketch", {
    title: "Read a sketch",
    description: "A sketch on a project's canvas: its page (the HTML), what it tries, the designer's verdict, its versions, and pictures of it as rendered. Read it before talking about or changing a sketch you haven't seen in this conversation.",
    inputSchema: {
      project: projectArg,
      sketch: z.string().describe("The sketch's id (or its title)."),
      version: z.number().int().min(1).optional().describe("Default: the version on the canvas."),
      device: z.enum(["desktop", "tablet", "phone"]).optional().describe("See it on this screen instead of the one it was made for: check a desktop sketch on a phone."),
      state: z.string().optional().describe("See it in one of its states (from its meta panel:states), e.g. \"Loading\" or \"Error\"."),
      html: z.boolean().optional().describe("Include the page's HTML. Default true."),
      pictures: z.boolean().optional().describe("Include pictures of it. Default true."),
    },
    annotations: readOnly,
  }, async ({ html: withHtml = true, pictures = true, ...a }) => {
    try {
      const { render, html: page, ...head } = await getSketch(a);
      // Measured against the skills that are on now, even if it was rendered before they were.
      const slug = head.seen_state?.match(/\(#([^)]+)\)$/)?.[1];
      const content = await sketchContent(head, await withSkillChecks(render, head.page + (slug ? `#${slug}` : ""), head.seen_on), pictures, head.seen_on);
      if (withHtml) content.push({ type: "text", text: page });
      return { content };
    } catch (e) {
      return failure(e);
    }
  });

  server.registerTool("get_figma_frame", {
    title: "Bring a sketch back from Figma",
    description: "The designer copied a sketch into Figma, changed it there, and wants it back as the sketch's next version. Returns the Figma frame (a picture of it, the code Figma writes for it, its variables and images) and the page it started from. Without read, reads the frame selected in the Figma app on this Mac now (or the one the sketch came back from last time). Then rebuild the page with edit_sketch, following how_to.",
    inputSchema: {
      project: projectArg,
      sketch: z.string().describe("The sketch's id (or its title)."),
      read: z.string().optional().describe("A reading Panel already made (the studio's Bring back gives one). Leave it out to read Figma now."),
      frame: z.string().optional().describe("Which Figma frame to read now, when the designer names one: its layer id (12:34) or a link to it. Default: what's selected in Figma, or the frame from last time."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (a) => {
    try {
      const sk = sketchMeta(a.project, a.sketch);
      const id = a.read?.trim() || (await readFrame(sk.project, sk.id, sk.version, a.frame?.trim() || undefined)).read;
      const r = figmaReading(sk.project, sk.id, id);
      const page = readSketch(sk.project, sk.id, r.base_version);
      const content: Content = [{
        type: "text",
        text: JSON.stringify({
          sketch: sk.id,
          title: sk.title,
          figma_frame: r.frame,
          frame_size: r.width && r.height ? `${r.width}×${r.height}` : undefined,
          started_from_version: r.base_version,
          showing_now: sk.version,
          images: r.assets.length ? r.assets : undefined,
          figma_variables: r.variables,
          how_to: FIGMA_HOW_TO(sk.id, r.base_version),
        }),
      }];
      if (r.picture) {
        content.push({ type: "text", text: "The frame as it is in Figma now: this is what the new version must look like." });
        content.push({ type: "image", data: Buffer.from(await Bun.file(r.picture).arrayBuffer()).toString("base64"), mimeType: r.picture.endsWith(".jpg") ? "image/jpeg" : "image/png" });
      }
      const before = renderOf(sk.project, sk.id, r.base_version).screens[0];
      if (before && existsSync(before)) {
        content.push({ type: "text", text: `Version ${r.base_version} as it was before Figma (its first screen), to see what changed.` });
        content.push({ type: "image", data: Buffer.from(await Bun.file(before).arrayBuffer()).toString("base64"), mimeType: "image/jpeg" });
      }
      if (r.outline) {
        content.push({ type: "text", text: `Figma would only give its code part by part (it may not write images into Panel's folder), so here are the frame's layers first, each with its size and place in the frame, then the code of each part. Parts with images came as pictures, listed in images.\n${r.outline}` });
      }
      content.push({ type: "text", text: `Figma's code for the frame${r.outline ? ", part by part" : ""} (React and Tailwind, a reference for exact values, not a structure to copy):\n${r.code || "(Figma gave no code; work from the picture.)"}` });
      content.push({ type: "text", text: `The page of version ${r.base_version}, to rebuild from:\n${page}` });
      return { content };
    } catch (e) {
      return failure(e);
    }
  });

  server.registerTool("get_handoff", {
    title: "Hand-off for a sketch",
    description: "Everything needed to build a chosen sketch for real, written down: the brief, the designer's rules, the locked decisions with their chosen saves (and pictures), the sketch's page and pictures, its states, and the directions ruled out and why. Returns the text and the folder its files are in. Use it when you (as Claude Code, in the designer's codebase) are asked to build a sketch from Panel.",
    inputSchema: { project: projectArg, sketch: z.string().describe("The sketch's id (or its title)."), note: z.string().optional().describe("Anything the designer adds for the builder.") },
    annotations: readOnly,
  }, safe(async (a) => {
    const { getSketch: gs } = await import("./board.ts");
    const head = await gs({ project: a.project, sketch: a.sketch });
    const p = findProject(a.project)!;
    const h = writeHandoff(p.id, head.sketch, a.note ?? "");
    return { folder: h.dir, files: "HANDOFF.md, sketch/index.html, sketch/screen-N.jpg, references/*", handoff: h.text };
  }));

  server.registerTool("start_build", {
    title: "Hand a sketch to Claude Code",
    description: "Hand a sketch to Claude Code to build for real, in a folder of the designer's code (a git repo gets a branch and checkout of its own, so their working copy isn't touched; a folder that doesn't exist yet is made, to build from scratch). It runs in the background; a card on the canvas shows its progress and, when done, the result running. Only when the designer asks to build or hand it off, and only with a folder they named.",
    inputSchema: {
      project: projectArg,
      sketch: z.string().describe("The sketch's id (or its title)."),
      folder: z.string().describe("The project folder to build in, as the designer named it (~/Desktop/hujjat-site)."),
      note: z.string().optional().describe("What the designer asks of the build, in their words."),
    },
    annotations: write,
  }, safe(async (a) => {
    const b = await startBuild({ ...a, actor: "assistant" });
    return { build: b.id, status: b.status, folder: b.workdir, branch: b.branch, next: "It works in the background. get_build shows how far it got; message_build asks it for changes when it's done." };
  }));

  server.registerTool("get_build", {
    title: "How a build is going",
    description: "A build of a sketch by Claude Code: its status (working, done, failed, stopped), its plan, the steps so far, what it said last, and how to see it running.",
    inputSchema: { build: z.string().describe("The build's id.") },
    annotations: readOnly,
  }, safe((a) => {
    const b = getBuild(a.build);
    if (!b) throw new Error("No such build. get_project lists a project's builds.");
    return { ...b, steps: b.steps.slice(-25), shot: undefined };
  }));

  server.registerTool("see_build", {
    title: "See what you built",
    description: "For Claude Code working on a build from Panel: Panel starts your page (the command, run in the build's folder) and gives you pictures of it in a real browser, with any errors the page threw and the end of the server's log. Look before you finish, fix what's off, then look again. Only while the build is working.",
    inputSchema: {
      build: z.string().describe("The build's id (in your instructions)."),
      command: z.string().describe("The command that starts it, from the build's folder: npm run dev -- --port 5180, python3 -m http.server 5180…"),
      url: z.string().describe("The page to look at: http://localhost:PORT/…"),
    },
    annotations: readOnly,
  }, async (a) => {
    try {
      const { render, log } = await seeBuild(a);
      const content = await sketchContent({ url: a.url, server_log_end: log || undefined }, render, true);
      return { content };
    } catch (e) {
      return failure(e);
    }
  });

  server.registerTool("message_build", {
    title: "Ask a build for changes",
    description: "Pass the designer's change request to Claude Code, in the same session that made the build (it remembers everything). Only when the designer asks for a change to the built version. It works in the background like the build did.",
    inputSchema: { build: z.string(), text: z.string().min(1).describe("The change, in the designer's words, plus anything you know that helps (what they pointed at).") },
    annotations: write,
  }, safe((a) => {
    const b = messageBuild(a.build, a.text);
    return { build: b.id, status: b.status };
  }));

  server.registerTool("mark_saves", {
    title: "Choose, keep or rule out saves",
    description: "Mark saves on a project's canvas as chosen, kept or ruled out. Only when the designer says so (\"go with the second one\", \"drop the neon ones\").",
    inputSchema: {
      project: projectArg,
      ids: z.array(z.string()).min(1),
      state: z.enum(REF_STATES),
      topic: z.string().optional().describe("Only under this topic, when a save is on the canvas twice."),
    },
    annotations: write,
  }, safe((a) => markSaves(a)));

  server.registerTool("lock_topic", {
    title: "Lock a decision",
    description: "Lock a topic on a project's canvas: the decision is made. Only when the designer says so. Give the decision in a sentence, and the saves chosen for it if they named them. The rest under the topic fold away on the canvas but stay in the project. unlock: true reopens it.",
    inputSchema: {
      project: projectArg,
      topic: z.string(),
      decision: z.string().optional().describe("The decision in a sentence: \"Humanist serif for headings, neutral grotesk for forms; must cover Cyrillic.\""),
      choose: z.array(z.string()).optional().describe("Save ids to mark chosen."),
      unlock: z.boolean().optional(),
    },
    annotations: write,
  }, safe((a) => lockTopic(a)));

  return server;
}
