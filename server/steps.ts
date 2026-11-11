// Making a whole thing step by step. A recipe (a file in recipes/ at the top of this folder,
// like unugly.md) says how one kind of work is made, one decision at a time: what makes that
// kind of work great, what to ask first, and its steps in order (Sections, Words, Gem, Color…).
// FRIDAY follows it on a project's canvas: it works on the step that is now, shows it, asks,
// and goes on only when the designer agrees. Each step is a topic on the canvas, locked with
// its decision when it is done, so the canvas shows the chain.
//
// This file reads the recipes (fresh each time, so an edit to one applies to the next
// message) and keeps where each project stands. The recipe file gives the steps and their
// order; the rows here only give each step's state. A step in the file with no row is
// waiting, and a row whose step is no longer in the file is ignored, so the designer can edit
// a recipe while a project is half way through it.
//
// Two tables of their own, so the app still on older code keeps working beside them.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, now } from "./db.ts";
import { findProject, getProject, TOPIC_FACETS, type TopicFacet } from "./projects.ts";
import { stepOnCanvas } from "./board.ts";

/** The recipes' folder. PANEL_RECIPES_DIR points elsewhere, for checking how things are without any. */
export const RECIPES_DIR = process.env.PANEL_RECIPES_DIR ?? join(import.meta.dir, "..", "recipes");

db.exec(`
CREATE TABLE IF NOT EXISTS project_recipes (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  recipe TEXT NOT NULL,                 -- the recipe's id: website
  state TEXT NOT NULL DEFAULT 'on',     -- on · stopped · finished
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_steps (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step TEXT NOT NULL,                   -- the step's name, as the recipe has it: Sections
  state TEXT NOT NULL DEFAULT 'waiting',-- waiting · now · done · skipped
  decision TEXT NOT NULL DEFAULT '',    -- the decision in a sentence, once done
  topic_id TEXT,                        -- its topic on the canvas, once it has one
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, step)
);
`);

// ---------- Reading a recipe ----------

export interface RecipeStep { name: string; text: string; facet?: TopicFacet }
export interface Recipe { id: string; name: string; for: string; top: string; steps: RecipeStep[] }

// A file that isn't a recipe is said once in Panel's log, not on every message that reads the folder.
const warned = new Set<string>();

/** `{{file: wireframe.html}}` becomes that file from the folder, as a fenced block. Other names are left out. */
function withFiles(text: string) {
  return text.replace(/^[ \t]*\{\{\s*file:\s*([^}]*?)\s*\}\}[ \t]*$/gm, (_, name: string) => {
    if (!/^[a-z0-9.-]+$/.test(name) || name.startsWith(".")) return "";
    const path = join(RECIPES_DIR, name);
    if (!existsSync(path)) return "";
    try {
      return "```html\n" + readFileSync(path, "utf8").trim() + "\n```";
    } catch {
      return "";
    }
  });
}

function parse(id: string, source: string): Recipe | string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const name = lines.find((l) => /^# \S/.test(l))?.slice(2).trim();
  const firstH2 = lines.findIndex((l) => /^## /.test(l));
  const head = firstH2 < 0 ? lines : lines.slice(0, firstH2);
  const forAt = head.findIndex((l) => /^For:/.test(l));
  const stepsAt = lines.findIndex((l) => /^## Steps\s*$/.test(l));
  const missing: string[] = [];
  if (!name) missing.push("a name (a line “# Name”)");
  if (forAt < 0) missing.push("a “For:” line before the first ## heading");
  const steps: RecipeStep[] = [];
  if (stepsAt >= 0) {
    let end = lines.findIndex((l, i) => i > stepsAt && /^## /.test(l));
    if (end < 0) end = lines.length;
    let cur: { name: string; body: string[] } | null = null;
    const close = () => {
      if (!cur) return;
      let facet: TopicFacet | undefined;
      const body = cur.body.filter((l) => {
        const m = l.match(/^Topic:\s*(\S+)\s*$/);
        if (!m) return true;
        const f = m[1]!.toLowerCase();
        if (TOPIC_FACETS.includes(f as TopicFacet)) facet = f as TopicFacet;
        return false;
      });
      steps.push({ name: cur.name, text: withFiles(body.join("\n")).replace(/\n{3,}/g, "\n\n").trim(), ...(facet ? { facet } : {}) });
    };
    for (const l of lines.slice(stepsAt + 1, end)) {
      const h = l.match(/^### (.+)$/);
      if (h) {
        close();
        cur = { name: h[1]!.trim(), body: [] };
      } else cur?.body.push(l);
    }
    close();
  }
  if (!steps.length) missing.push("at least one step (### headings under ## Steps)");
  if (missing.length) return `no ${missing.join(", no ")}`;
  const top = lines.slice(forAt + 1, stepsAt >= 0 ? stepsAt : lines.length).join("\n").trim();
  return { id, name: name!, for: head[forAt]!.slice(4).trim(), top: withFiles(top), steps };
}

/** Every recipe in the folder, read now. A file that isn't one is skipped, and the log says why. */
function readAll(): Recipe[] {
  let files: string[] = [];
  try {
    files = readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: Recipe[] = [];
  for (const f of files) {
    let source = "";
    try {
      source = readFileSync(join(RECIPES_DIR, f), "utf8");
    } catch {
      continue;
    }
    const r = parse(f.slice(0, -3), source);
    if (typeof r === "string") {
      const say = `Recipes: ${f} was skipped: it has ${r}.`;
      if (!warned.has(say)) {
        warned.add(say);
        console.error(say);
      }
      continue;
    }
    out.push(r);
  }
  return out;
}

/** The recipes, each with what it is for and its steps. */
export function listRecipes() {
  return readAll().map((r) => ({ id: r.id, name: r.name, for: r.for, steps: r.steps.map((s) => s.name) }));
}

/** A recipe by its id or its name, in any case. */
export function readRecipe(idOrName: string): Recipe | null {
  const want = idOrName.trim().toLowerCase();
  return readAll().find((r) => r.id.toLowerCase() === want || r.name.toLowerCase() === want) ?? null;
}

// ---------- Where a project stands ----------

export type StepState = "waiting" | "now" | "done" | "skipped";
interface RecipeRow { project_id: string; recipe: string; state: "on" | "stopped" | "finished"; started_at: string; updated_at: string }
interface StepRow { project_id: string; step: string; state: StepState; decision: string; topic_id: string | null; updated_at: string }

const recipeRow = (projectId: string) => db.query<RecipeRow, [string]>("SELECT * FROM project_recipes WHERE project_id = ?").get(projectId) ?? null;
const stepRows = (projectId: string) => db.query<StepRow, [string]>("SELECT * FROM project_steps WHERE project_id = ?").all(projectId);

function projectOf(project: string) {
  const p = findProject(project);
  if (!p) throw new Error(`No project called “${project}”. list_projects shows them.`);
  return p;
}

/** Each step of the recipe with its state, in the recipe's order. */
function standing(projectId: string, recipe: Recipe) {
  const rows = new Map(stepRows(projectId).map((r) => [r.step.toLowerCase(), r]));
  return recipe.steps.map((s) => {
    const r = rows.get(s.name.toLowerCase());
    return { ...s, state: (r?.state ?? "waiting") as StepState, decision: r?.decision ?? "", topic: r?.topic_id ?? null };
  });
}
type Standing = ReturnType<typeof standing>;

function saveStep(projectId: string, step: string, patch: { state?: StepState; decision?: string; topic?: string | null }) {
  const had = db.query<StepRow, [string, string]>("SELECT * FROM project_steps WHERE project_id = ? AND step = ?").get(projectId, step);
  if (!had) {
    db.run("INSERT INTO project_steps (project_id, step, state, decision, topic_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
      projectId, step, patch.state ?? "waiting", patch.decision ?? "", patch.topic ?? null, now(),
    ]);
    return;
  }
  db.run("UPDATE project_steps SET state = ?, decision = ?, topic_id = ?, updated_at = ? WHERE project_id = ? AND step = ?", [
    patch.state ?? had.state, patch.decision ?? had.decision, patch.topic === undefined ? had.topic_id : patch.topic, now(), projectId, step,
  ]);
}

const setRecipeState = (projectId: string, state: RecipeRow["state"]) => db.run("UPDATE project_recipes SET state = ?, updated_at = ? WHERE project_id = ?", [state, now(), projectId]);

/** The topic ids on the canvas now, so a step whose topic was taken off by hand gets a new one. */
const topicsNow = (projectId: string) => new Set((getProject(projectId)?.nodes ?? []).filter((n) => n.kind === "topic").map((n) => n.id));

/**
 * What a step becoming now does on the canvas, for stepOnCanvas: its topic (kept, found by its
 * name, or made), connected after the topic of the nearest earlier step that has one.
 */
function nowOnCanvas(projectId: string, list: Standing, i: number, skip?: string | null, known?: string) {
  const topics = topicsNow(projectId);
  const has = (t: string | null) => !!t && t !== skip && (topics.has(t) || t === known);
  const s = list[i]!;
  const after = list.slice(0, i).reverse().find((x) => has(x.topic))?.topic ?? null;
  return { title: s.name, facet: s.facet ?? "other", topic: has(s.topic) ? s.topic : null, after } as const;
}

/** The first waiting step after `from`, else the first waiting one before it. */
function nextWaiting(list: Standing, from: number) {
  const after = list.findIndex((s, i) => i > from && s.state === "waiting");
  return after >= 0 ? after : list.findIndex((s) => s.state === "waiting");
}

/** Where a project stands, for the app and the tools: null when it never went step by step. */
export function stepsOf(project: string) {
  const p = findProject(project);
  if (!p) return null;
  const row = recipeRow(p.id);
  if (!row) return null;
  const recipe = readRecipe(row.recipe);
  if (!recipe) return { recipe: { id: row.recipe, name: row.recipe }, state: row.state, steps: [] as { step: string; state: StepState; decision: string }[] };
  return {
    recipe: { id: recipe.id, name: recipe.name },
    state: row.state,
    steps: standing(p.id, recipe).map((s) => ({ step: s.name, state: s.state, decision: s.decision })),
  };
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");

/** The status line on each of the designer's messages while a project is going step by step; "" otherwise. */
export function stepsLine(project: string) {
  const p = findProject(project);
  if (!p) return "";
  const row = recipeRow(p.id);
  if (!row || row.state !== "on") return "";
  const recipe = readRecipe(row.recipe);
  if (!recipe) return "";
  const all = standing(p.id, recipe);
  const done = all.filter((s) => s.state === "done").map((s) => (s.decision ? `${s.name} (“${cut(s.decision, 160)}”)` : s.name));
  const skipped = all.filter((s) => s.state === "skipped").map((s) => s.name);
  const cur = all.find((s) => s.state === "now");
  const toCome = all.filter((s) => s.state === "waiting").map((s) => s.name);
  return [
    `This project is being made step by step with the ${recipe.name} recipe.`,
    `Done: ${list(done)}.`,
    skipped.length ? `Skipped: ${list(skipped)}.` : "",
    `Now: ${cur ? cur.name : "none"}.`,
    `To come: ${list(toCome)}.`,
    cur ? `Work only on ${cur.name}, as the recipe says (get_recipe with step "${cur.name}" if you haven't read it in this conversation).` : "",
    "A small change the designer asks for is just made; the steps are for the big decisions.",
  ].filter(Boolean).join(" ");
}

const nowView = (recipe: Recipe, list: Standing) => {
  const s = list.find((x) => x.state === "now");
  return s ? { step: s.name, text: s.text } : undefined;
};

/** Start making a project step by step with a recipe (or carry on with it). */
export function startSteps(project: string, recipeName: string) {
  const p = projectOf(project);
  const recipe = readRecipe(recipeName);
  if (!recipe) {
    const names = listRecipes().map((r) => r.name);
    throw new Error(`No recipe called “${recipeName}”.${names.length ? ` The recipes: ${names.join(", ")}.` : " There are no recipes yet."}`);
  }
  const row = recipeRow(p.id);
  if (row && row.state === "on" && row.recipe !== recipe.id) {
    const other = readRecipe(row.recipe)?.name ?? row.recipe;
    throw new Error(`This project is already going step by step with ${other}. Stop that first (stop_steps).`);
  }
  const fresh = !row || row.recipe !== recipe.id;
  if (fresh) {
    db.transaction(() => {
      db.run("DELETE FROM project_steps WHERE project_id = ?", [p.id]);
      db.run(
        "INSERT INTO project_recipes (project_id, recipe, state, started_at, updated_at) VALUES (?, ?, 'on', ?, ?) ON CONFLICT(project_id) DO UPDATE SET recipe = excluded.recipe, state = 'on', started_at = excluded.started_at, updated_at = excluded.updated_at",
        [p.id, recipe.id, now(), now()],
      );
      // A decision the canvas has already made (a locked Color topic) starts as done; a topic of
      // that kind still open becomes the step's own.
      const topics = (getProject(p.id)?.nodes ?? []).filter((n) => n.kind === "topic");
      const used = new Set<string>();
      for (const s of recipe.steps) {
        if (!s.facet) continue;
        const of = topics.filter((t) => t.data.facet === s.facet && !used.has(t.id));
        const locked = of.find((t) => t.data.status === "locked");
        const t = locked ?? of[0];
        if (!t) continue;
        used.add(t.id);
        saveStep(p.id, s.name, locked ? { state: "done", decision: String(locked.data.summary ?? "").trim().slice(0, 600), topic: t.id } : { topic: t.id });
      }
    })();
  } else if (row.state !== "on") setRecipeState(p.id, "on");

  // The first step that isn't done becomes now (already now: it stays).
  let all = standing(p.id, recipe);
  if (!all.some((s) => s.state === "now")) {
    const i = all.findIndex((s) => s.state === "waiting");
    if (i < 0) setRecipeState(p.id, "finished");
    else {
      const placed = stepOnCanvas(p.id, { now: nowOnCanvas(p.id, all, i) });
      saveStep(p.id, all[i]!.name, { state: "now", topic: placed.topic ?? null });
    }
    all = standing(p.id, recipe);
  }
  return {
    recipe: recipe.name,
    steps: all.map((s) => ({ step: s.name, state: s.state, ...(s.decision ? { decision: s.decision } : {}) })),
    now: nowView(recipe, all),
    ...(recipeRow(p.id)?.state === "finished" ? { finished: true as const } : {}),
  };
}

const FINISHED_NEXT = "Every step is done. The designer chooses the sketch (Choose), and then it can be built.";

/** Move a project's steps on: done (with the decision), skipped, or now (going back to it). */
export function setStep(project: string, stepName: string, state: "done" | "skipped" | "now", decision?: string) {
  const p = projectOf(project);
  const row = recipeRow(p.id);
  if (!row) throw new Error("This project isn't going step by step. start_steps begins it.");
  const recipe = readRecipe(row.recipe);
  if (!recipe) throw new Error(`The recipe “${row.recipe}” isn't in the recipes folder any more.`);
  const all = standing(p.id, recipe);
  const i = all.findIndex((s) => s.name.toLowerCase() === stepName.trim().toLowerCase());
  if (i < 0) throw new Error(`No step “${stepName}” in the ${recipe.name} recipe. Its steps: ${all.map((s) => s.name).join(", ")}.`);
  const step = all[i]!;
  const wasNow = step.state === "now";
  const topics = topicsNow(p.id);
  const ownTopic = step.topic && topics.has(step.topic) ? step.topic : null;

  if (state === "done") {
    const said = (decision ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
    if (!said) throw new Error(`Say the decision for ${step.name} in a sentence (decision), in the designer's words where they gave them.`);
    // The step that is now moves on only when it is itself the one done.
    const next = wasNow ? nextWaiting(all.map((s, k) => (k === i ? { ...s, state: "done" as StepState } : s)), i) : -1;
    // Its topic is locked with the decision (a step done before it had a topic gets one, so the
    // canvas shows it), and the next step gets its topic, after this one where it follows it:
    // all one change, so one undo.
    const LOCKED = "(this step's topic)";
    const nextAt = next >= 0 ? nowOnCanvas(p.id, all.map((s, k) => (k === i ? { ...s, topic: LOCKED } : s)), next, null, LOCKED) : null;
    const placed = stepOnCanvas(p.id, {
      lock: { ...nowOnCanvas(p.id, all, i), decision: said },
      ...(nextAt ? { now: nextAt.after === LOCKED ? { ...nextAt, after: null, afterLock: true } : nextAt } : {}),
    });
    const own = placed.locked ?? null;
    db.transaction(() => {
      saveStep(p.id, step.name, { state: "done", decision: said, topic: own });
      if (next >= 0) saveStep(p.id, all[next]!.name, { state: "now", topic: placed.topic ?? null });
      else if (wasNow) setRecipeState(p.id, "finished");
    })();
  } else if (state === "skipped") {
    const next = wasNow ? nextWaiting(all.map((s, k) => (k === i ? { ...s, state: "skipped" as StepState } : s)), i) : -1;
    const placed = stepOnCanvas(p.id, {
      ...(ownTopic ? { remove: ownTopic } : {}),
      ...(next >= 0 ? { now: nowOnCanvas(p.id, all, next, ownTopic) } : {}),
    });
    db.transaction(() => {
      // Its topic stays its own only when something hangs from it.
      saveStep(p.id, step.name, { state: "skipped", topic: placed.removed ? null : ownTopic });
      if (next >= 0) saveStep(p.id, all[next]!.name, { state: "now", topic: placed.topic ?? null });
      else if (wasNow) setRecipeState(p.id, "finished");
    })();
  } else {
    // Going back (or on) to a step: it becomes now and its topic is reopened. The step that was
    // now waits again; what was done stays done.
    const placed = stepOnCanvas(p.id, {
      ...(ownTopic ? { reopen: ownTopic } : {}),
      now: nowOnCanvas(p.id, all, i),
    });
    db.transaction(() => {
      for (const s of all) if (s.state === "now" && s.name !== step.name) saveStep(p.id, s.name, { state: "waiting" });
      saveStep(p.id, step.name, { state: "now", topic: placed.topic ?? null });
      if (row.state !== "on") setRecipeState(p.id, "on");
    })();
  }

  const after = standing(p.id, recipe);
  const cur = nowView(recipe, after);
  const finished = recipeRow(p.id)?.state === "finished";
  return {
    step: step.name,
    state,
    ...(cur ? { now: cur } : {}),
    to_come: after.filter((s) => s.state === "waiting").map((s) => s.name),
    ...(finished ? { finished: true as const, next: FINISHED_NEXT } : {}),
  };
}

/** Stop going step by step: nothing on the canvas changes. */
export function stopSteps(project: string) {
  const p = projectOf(project);
  const row = recipeRow(p.id);
  if (!row) throw new Error("This project isn't going step by step.");
  setRecipeState(p.id, "stopped");
  return { stopped: true, recipe: readRecipe(row.recipe)?.name ?? row.recipe, note: "What was decided stays on the canvas." };
}

// ---------- A recipe as text, for get_recipe ----------

/** A recipe whole, one step, or the list; with a project, also where it stands. */
export function recipeText(o: { name?: string; step?: string; project?: string }) {
  const where = () => {
    if (!o.project) return "";
    const p = projectOf(o.project);
    const s = stepsOf(p.id);
    if (!s) return `\n\n## Where “${p.name}” stands\n\nIt isn't going step by step.`;
    const word: Record<StepState, string> = { done: "done", now: "now", waiting: "waiting", skipped: "skipped" };
    const lines = s.steps.map((x) => `- ${x.step}: ${word[x.state]}${x.decision ? ` (“${x.decision}”)` : ""}`);
    const state = s.state === "on" ? "going step by step" : s.state === "stopped" ? "stopped (the designer said to stop)" : "finished";
    return `\n\n## Where “${p.name}” stands\n\nWith the ${s.recipe.name} recipe, ${state}.\n${lines.join("\n")}`;
  };
  if (!o.name?.trim()) {
    const all = listRecipes();
    if (!all.length) return "There are no recipes yet." + where();
    return `The recipes (get_recipe with a name reads one whole):\n${all.map((r) => `- ${r.name}: ${r.for} Steps: ${r.steps.join(" → ")}.`).join("\n")}` + where();
  }
  const r = readRecipe(o.name);
  if (!r) throw new Error(`No recipe called “${o.name}”. The recipes: ${listRecipes().map((x) => x.name).join(", ") || "none yet"}.`);
  if (o.step?.trim()) {
    const i = r.steps.findIndex((s) => s.name.toLowerCase() === o.step!.trim().toLowerCase());
    if (i < 0) throw new Error(`No step “${o.step}” in the ${r.name} recipe. Its steps: ${r.steps.map((s) => s.name).join(", ")}.`);
    return `# ${r.name}: ${r.steps[i]!.name} (step ${i + 1} of ${r.steps.length})\n\n${r.steps[i]!.text}` + where();
  }
  return `# ${r.name}\n\nFor: ${r.for}\n\n${r.top}\n\n## Steps\n\n${r.steps.map((s) => `### ${s.name}\n\n${s.text}`).join("\n\n")}` + where();
}
