// The tools Panel offers any AI app over MCP. The logic lives in library.ts; this file
// only describes each tool and shapes its answer. Used by mcp.ts (stdio) and the /mcp route.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readMaterial } from "./materials.ts";
import { chosenRefs, findProject, listProjects, projectsOf, summary, REF_STATES, TOPIC_FACETS } from "./projects.ts";
import { addNote, addTopic, connectTopics, lockTopic, markSaves, placeOnBoard } from "./board.ts";
import { FACETS, TYPES, findByColor, gather, overview, reference, saveToCollection, search, similar } from "./library.ts";

const INSTRUCTIONS = `Panel is a designer's private library of saved design references: websites, app screens, posters, brands, motion pieces, photos. Each save has a design read written by Claude Opus from its pictures (and, for videos, frame grids and motion close-ups), split into facets: color (with colors measured from the pixels, as hex), typography, layout, imagery, motion, mood, components, worth_taking and search_terms. The designer's own note, when present, matters most.

Use it to find references for a brief and to combine them: color from one save, type from another, motion from a third.
- Start with library_overview to learn the words the library uses (moods, fonts, motion techniques).
- gather_for_brief gives the best saves per facet for a brief in one call.
- search_library finds by words, optionally within facets and filters; try synonyms if results are thin, since matching is by words, not meaning.
- find_by_color matches measured palettes by hex (ΔE distance).
- similar_to finds saves like one you have, by facet.
- get_reference returns everything about a save, and its pictures so you can look at it yourself. Look before you recommend.
- save_to_collection puts the saves you chose in a Panel collection the designer can open.
- Projects are the designer's canvases for a piece of work: decisions (Typography, Color…) with the saves chosen, kept and ruled out for each, and the designer's reasons. list_projects shows them; get_project reads one, with its brief and materials (files and links the designer added: specs, brand books, sites); get_project_material reads a material in full. When working on a project, read it and the materials that matter first, and build from its locked decisions.
- On a project's canvas you can place_on_board (saves under a topic, as suggestions), add_topic, connect_topics and add_note. The designer decides: mark_saves and lock_topic only when they say so. Each change appears live on their canvas and can be undone there.
Always give the designer the "open" link for each save you recommend, so they can watch or look at the original.`;

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

export function createMcpServer() {
  const server = new McpServer({ name: "panel", title: "Panel design library", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool("library_overview", {
    title: "Library overview",
    description: "What's in the library: how many saves of each kind, the designer's tags and collections, and the vocabulary the design reads use (moods, formats, style references, type classifications, likely fonts, motion techniques, imagery styles, components, color families), each with a count. Call this first to know which words will find things.",
    inputSchema: {},
    annotations: readOnly,
  }, safe(() => overview()));

  server.registerTool("search_library", {
    title: "Search the library",
    description: "Find saves by words, ranked by how many of the words they match, then by relevance. With facets, the words must match within those facets only: e.g. query \"stagger spring\" with facets [\"motion\"] finds motion that staggers, not a poster that mentions springs. With no query, lists the newest saves that pass the filters. Combine with colors and filters freely. Matching is by words (with stemming and prefixes), not meaning, so search a few phrasings.",
    inputSchema: {
      query: z.string().optional().describe("Words to look for: mood, style, technique, component, font, subject, creator…"),
      facets: z.array(facet).optional().describe("Search only within these facets of the read."),
      colors: z.array(z.string()).optional().describe("Also require these colors in the measured palette: hex (#1d1765) or a plain name (navy, warm white)."),
      color_match: z.enum(["any", "all"]).optional().describe("With colors: any (default) or all must be present."),
      ...filterShape,
      limit: z.number().int().min(1).max(60).optional().describe("Default 12."),
      offset: z.number().int().min(0).optional(),
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
    },
    annotations: readOnly,
  }, safe((a) => findByColor(a)));

  server.registerTool("similar_to", {
    title: "Similar saves",
    description: "Saves like a given one, judged by the facets you choose: color compares measured palettes; the others compare what the reads say about that facet. Several facets are combined, so [\"color\",\"motion\"] finds saves close in both. Use it for \"more like this\" or \"this palette but different type\".",
    inputSchema: {
      id: z.string().describe("The save to compare against."),
      facets: z.array(z.enum([...FACETS, "overall"])).optional().describe("Default [\"overall\"]."),
      ...filterShape,
      limit: z.number().int().min(1).max(40).optional().describe("Default 10."),
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
    description: "Everything about one or more saves: the whole design read, measured palette with roles, the designer's note and tags, the source link, the original files on this Mac (images, videos) and the pictures the read was made from. With images, returns those pictures so you can see the save yourself: for a video they are frame grids in time order and motion close-ups 0.1s apart; for a site, crops and the whole page folded into columns.",
    inputSchema: {
      ids: z.array(z.string()).min(1).max(10),
      images: z.enum(["none", "first", "all"]).optional().describe("Pictures to include: none, first (default) or all."),
    },
    annotations: readOnly,
  }, async ({ ids, images = "first" }) => {
    const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
    for (const id of ids) {
      try {
        const { data, pictures } = reference(id);
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
      const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
        { type: "text", text: JSON.stringify(summary(project)) },
      ];
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
    description: "One of a project's materials in full: a file the designer added (a spec, a brand book, notes; its text) or a picture (to look at), or a web page they linked (its text). get_project lists the materials with their ids and short ones whole; read the longer ones that matter here before designing. Long texts come in pages: call again with the offset it gives.",
    inputSchema: {
      project: z.string().describe("The project's id or name."),
      id: z.string().describe("The material's id (or its name) from get_project."),
      offset: z.number().int().min(0).optional().describe("Where to start in the text, for the next page of a long one."),
    },
    annotations: readOnly,
  }, async ({ project, id, offset = 0 }) => {
    try {
      const p = findProject(project);
      if (!p) throw new Error(`No project called “${project}”. list_projects shows them.`);
      const m = readMaterial(p.id, id, offset);
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
    description: "Put saves from the library on a project's canvas under a topic (Typography, Color, Layout…), as suggestions the designer then chooses, keeps or rules out. The topic is found by name or kind (\"type\" finds Typography) and made if it isn't there. Saves already under that topic are skipped. Give each save a short why: what to take from it for this topic, shown on its card. Place 4 to 8 at a time, the strongest first.",
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

  server.registerTool("save_to_collection", {
    title: "Save to a collection",
    description: "Put saves into a Panel collection, made if it doesn't exist yet, so the designer can open the set you picked. Use a name that says what it's for (\"Banking app: calm warm refs\"). Only adds; never removes or deletes.",
    inputSchema: {
      name: z.string().min(1),
      ids: z.array(z.string()).min(1).max(200),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, safe((a) => saveToCollection(a.name, a.ids)));

  return server;
}
