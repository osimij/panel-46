# Orchestration techniques for original and coherent design generation from several references

Notes compiled 16 November 2026. Every finding carries its source, the source's date, and a tag:

- **[measured]**: a number from an experiment. "authors' own" means self-reported and not replicated as far as I found.
- **[practice report]**: what a team says it saw while building, without a controlled comparison.
- **[opinion]**: a recommendation or argument.
- **[secondary]**: I only saw a search summary or abstract, not the full text. Check before relying on it.

Mapping to design generation is always under "Inferences", because almost none of these sources tested "combine several design references into one new design" directly.

---

## 1. Anthropic's own guidance: what they do to push originality, and what they found

### Takeaway
Anthropic's strongest lever for originality is a separate, skeptical evaluator that looks at the rendered page and grades it on criteria that weight "design quality" and "originality" above craft and function, calibrated with a few scored examples; the generator then chooses to refine or throw the direction away. All of this is practice report: Anthropic publishes costs (roughly 20x a solo run) but no controlled measurement of how much more original the designs are, and its newer guidance says to remove harness parts as models improve.

### Cited Findings

**Harness design for long-running apps (Anthropic Engineering, 24 March 2026)** — [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- What it is: a "GAN-inspired" loop on the Claude Agent SDK. A generator writes an HTML/CSS/JS frontend; a separate evaluator opens the live page through Playwright, takes screenshots, scores four criteria and writes a critique that feeds the next round. [practice report]
- The four criteria: design quality (does it "feel like a coherent whole rather than a collection of parts"), originality (penalizes template layouts and "telltale signs of AI generation" such as purple gradients over white cards), craft (type, spacing, color harmony, contrast; a competence check), functionality. Design quality and originality were weighted more heavily because Claude already did well on craft and functionality by default. [practice report]
- Criteria wording steers the look: including a phrase like "the best designs are museum quality" pushed outputs toward one particular visual convergence. [practice report, anecdotal]
- Judge calibration: the evaluator was given few-shot examples with detailed score breakdowns, which aligned it with the author's own preferences and reduced score drift across iterations. No number given. [practice report]
- Self-grading is lenient: agents "skew positive when grading their own work"; tuning a standalone evaluator to be skeptical was "far more tractable" than making a generator self-critical. The separate evaluator was still generous toward LLM output. "Out of the box, Claude is a poor QA agent": early evaluators found real problems and then talked themselves into approving. Fixing this took several rounds of reading evaluator logs and editing its prompt. [practice report]
- Iterations: 5 to 15 per generation; full runs up to four hours. Scores rose then plateaued; improvement was not linear; the author sometimes preferred a middle iteration to the last; implementation complexity rose over rounds. [practice report]
- Originality by pivot: after each evaluation the generator chose to refine or to pivot to a different aesthetic. Example: iteration 9 was a polished dark landing page for a Dutch art museum; at iteration 10 the generator "scrapped the approach entirely" and rebuilt the site as a 3D room with a CSS-perspective checkered floor and doorway navigation. One anecdote, not a rate. [practice report]
- Cost: retro game maker with Opus 4.5 took 20 min / $9 solo versus 6 hr / $200 with the full harness ("over 20x more expensive"). A later run with Opus 4.6 took 3 hr 50 min / $124.70; the planner cost $0.46 and each QA round about $3 to $4, so nearly all the cost was building, not judging. [measured, single runs]
- Simplifying with a stronger model (Opus 4.6): the sprint structure was removed, the planner was kept (without it the generator under-scoped), and the evaluator moved to one pass at the end. The evaluator "is worth the cost when the task sits beyond what the current model does reliably solo." "Every component in a harness encodes an assumption about what the model can't do on its own." A first attempt to cut radically made results worse and hid which parts mattered; removing one part at a time worked. [practice report / opinion]

**Building effective agents (Anthropic Engineering, 19 December 2024)** — [Source](https://www.anthropic.com/engineering/building-effective-agents)
- Evaluator–optimizer: "one LLM call generates a response while another provides evaluation and feedback in a loop." It fits when criteria are clear and when (a) the output improves if a human gives feedback and (b) the model can give that kind of feedback itself. [opinion]
- Parallelization has two forms: sectioning (independent subtasks) and voting (the same task run several times to get diverse outputs). [opinion]
- Warnings: "finding the simplest solution possible, and only increasing complexity when needed"; agents carry "higher costs, and the potential for compounding errors"; frameworks hide prompts and make it "tempting to add complexity." [opinion]

**How we built our multi-agent research system (Anthropic Engineering, 13 June 2025)** — [Source](https://www.anthropic.com/engineering/multi-agent-research-system)
- A lead agent with parallel subagents beat a single agent by 90.2% on Anthropic's internal research eval; token use alone explained about 80% of performance variance on BrowseComp; agents use about 4x the tokens of chat and multi-agent systems about 15x. [measured, authors' own]
- Poor fit: work where all agents need the same context or where there are many dependencies between agents. [opinion from practice]
- Judging: one LLM call with one rubric prompt giving 0.0 to 1.0 scores and pass/fail was the most consistent and closest to human judgment; start with about 20 real cases; humans still caught things the judge missed. [practice report]

**Improving frontend design through skills (Claude blog, 12 November 2025)** — [Source](https://claude.com/blog/improving-frontend-design-through-skills)
- Explanation for generic output: "distributional convergence". With no direction the model samples from the high-probability center of web design (Inter, purple gradients). [opinion/explanation]
- Technique: a roughly 400-token prompt that tells the model it tends to converge, gives direction on four axes (typography, color and theme, motion, backgrounds), names patterns to avoid, and ends with a reminder to vary. Even with it, the model settles on new favorites (Space Grotesk is named). [practice report]
- Evidence: none measured. Only author-chosen before/after screenshots. [gap stated by the source's own content]

**Prompting best practices, frontend design section (Claude docs, read 16 November 2026)** — [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- The published snippet says: "You still tend to converge on common choices (Space Grotesk, for example) across generations." [practice report]
- Explicit chaining (draft, review against criteria, refine, each a separate call) is "still useful when you need to inspect intermediate outputs or enforce a specific pipeline structure"; otherwise current models handle most multistep reasoning internally. Opus 4.6 and Opus 5 are noted as over-eager to spawn subagents. [opinion]
- Letting the model zoom into parts of an image gave "consistent uplift on image evaluations." [measured internally, no number published]

**Prompting Claude Opus 4.8, "Design and frontend defaults" (Claude docs, read 16 November 2026)** — [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8)
- The model has "a consistent default house style": warm cream background (about #F4F1EA), serif display type (Georgia, Fraunces, Playfair), italic word-accents, terracotta/amber accent. [practice report]
- "This default is persistent. Generic instructions ('don't use cream,' 'make it clean and minimal') tend to shift the model to a different fixed palette rather than producing variety." [practice report]
- Two approaches "work reliably": (1) give a concrete alternative spec (hex values, typeface, radius, spacing, structure); (2) have the model propose options first: "propose 4 distinct visual directions tailored to this brief (each as: bg hex / accent hex / typeface — one-line rationale)", then build only the chosen one. "If you previously relied on temperature for design variety, use this approach; it produces meaningfully different directions across runs." [practice report, no numbers]
- Newer models need less anti-slop prompting; the recommended snippet shrank to a few lines. [practice report]

**frontend-design skill, current file (anthropics/skills, read 16 November 2026; summarized by the fetch tool)** — [Source](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)
- The skill is now a staged process: plan a compact token system (4 to 6 named hex colors, type, layout as prose plus ASCII wireframes, principles), review the plan against the brief and replace anything that reads as a generic default, build only after that, then critique with screenshots. [opinion]
- Originality is sourced from the subject, not from style lists: take choices from the subject's "industry, subject matter, materials, and vernacular"; "spend your boldness in one place." [opinion]
- The avoid list now names the model's own newer defaults (cream + serif + terracotta; near-black + one acid accent; broadsheet hairlines; identical rounded SaaS cards; tracked all-caps eyebrows), and says to follow the brief exactly when it asks for one of those looks. [opinion]

**Claude Design launch (Anthropic, 17 April 2026)** — [Source](https://www.anthropic.com/news/claude-design-anthropic-labs)
- Structure that is public: a design system (colors, type, components) is built once from the team's codebase and design files and applied to later projects; refinement is by inline comments, direct edits and sliders Claude creates; "Designers can quickly create a wide range of directions to explore." Runs on Opus 4.7. [product description]
- Nothing on originality or on the internal pipeline is published. [gap]

### Inferences
- Anthropic's recipe, in order of how much they lean on it: (1) a plan or token system before code, (2) a concrete direction instead of "be creative", (3) several named directions proposed before building, (4) a separate evaluator with weighted criteria and few-shot calibration, (5) permission to pivot. Items 1 to 3 cost one or two calls; item 4 costs 5 to 15 full build-and-judge rounds.
- The "avoid" list is a moving target. Anthropic's 2025 list banned Inter and purple gradients; its 2026 list bans cream, serif and terracotta, which look like what the model moved to next. An anti-pattern list on its own relocates the default; it does not create range. A concrete positive direction (which several references can supply) is the stronger lever.
- For combining references, the harness criteria map directly: "coherent whole rather than a collection of parts" is the test for patchwork, and "originality" can be redefined as "not recognizably any one of the references".
- The evaluator's cost is small next to the build cost (about $3 to $4 against $36 to $71 per round in Anthropic's run), so judging more candidates is cheap relative to building them at full fidelity.

### Gaps
- No Anthropic source gives a measured originality or quality gain for the generator–evaluator design loop (no rater study, no sample size). The evidence is cost figures and anecdotes.
- No public description of how Claude Design generates or ranks multiple directions internally.
- The frontend-design skill file text was summarized by a small model during fetch; exact wording should be checked in the file.

---

## 2. Diversity techniques at generation time

### Takeaway
The best-measured cheap techniques are: ask for several candidates in one call (most of the gain), add stated probabilities and "sample from the tails" (Verbalized Sampling, 1.6 to 2.1x diversity in creative writing), and make the model list ideas then push them further apart (chain-of-thought brainstorming). Temperature, personas, and stacked "do not use X" rules have weak or costly effects; over-generation saturates fast (about 5% unique out of 4,000).

### Cited Findings

**Verbalized Sampling (arXiv 2510.01171, 1 October 2025; published in PMLR 306 / ICML 2026)** — [Source](https://arxiv.org/html/2510.01171v3); venue from [PMLR](https://proceedings.mlr.press/v306/zhang26hy.html)
- What it is: one call asks for k responses (k = 5 for creative work), each with a numeric probability; an optional line asks for the "tails of the distribution, such that the probability of each response is less than 0.10". Variants: VS-CoT (reason first), VS-Multi ("5 more" in later turns). [description]
- Effect: 1.6 to 2.1x diversity over direct prompting in creative writing. Human-rated diversity on a 1 to 4 scale: poems 1.90 direct, 2.07 plain list of five, 2.39 VS (+25.8% over direct); stories 2.74, 2.76, 3.06 (+11.7%); jokes 1.83, 2.93, 3.01 (+64.5%). [measured, authors' own]
- Honest reading of that table: for jokes almost all of the gain comes from simply asking for a list (1.83 to 2.93); the probabilities add 0.08. For poems and stories the probabilities add more than the list does. [measured]
- Quality: plain lists and VS-Standard cause a quality drop that is smaller on larger models; VS-CoT and VS-Multi hold or improve quality on larger models. Very large k lowers quality. [measured, authors' own]
- Gains are orthogonal to temperature, and larger models gain 1.5 to 2x more than small ones (limited model pairs). Models tested include Claude 3.7 Sonnet and Claude 4 Sonnet. [measured, authors' own]
- Cause they propose: typicality bias in human preference data. At equal correctness, raters favored more typical text (fitted weight 0.57 ± 0.07 on HelpSteer, 6,874 pairs). [measured]
- Visual work: only a qualitative figure showing more varied image captions; no metric. [weak evidence]
- Cost: one call returns k candidates; more tokens per call; no extra calls. [description]
- Follow-ups in 2026 are mixed: one preprint reports a structurally identical method is statistically indistinguishable from VS on an opinion benchmark and argues per-call sampling is degenerate in instruction-tuned models. — [Source](https://www.alphaxiv.org/abs/2607.25292.md) [secondary]

**Prompting Diverse Ideas (Meincke, Mollick, Terwiesch; arXiv 2402.01727, 27 January 2024; GPT-4)** — [Source](https://arxiv.org/abs/2402.01727)
- Pools of GPT-4 product ideas are less diverse than pools from human groups; prompting can substantially close the gap; chain-of-thought prompting gave the highest diversity and the most unique ideas of all prompts tested, close to human groups. [measured]
- Persona and "creativity technique" prompts barely moved the similarity score (baseline 0.377; Steve Jobs persona 0.368; a creativity-tools prompt 0.387, which is worse). — [Source](https://mackinstitute.wharton.upenn.edu/wp-content/uploads/2024/02/for-web-AI-idea-variance.pdf) [secondary: numbers seen in a search summary of the working paper, not verified in the PDF]

**Over-generation saturates (Si, Yang, Hashimoto; arXiv 2409.04109, September 2024; ICLR 2025)** — [Source](https://arxiv.org/html/2409.04109v1)
- Of 4,000 generated seed ideas per topic, only about 200 (5%) were non-duplicates at a 0.8 cosine threshold; the share of new ideas in each batch kept falling. [measured]

**Denial prompting, "not like the last one" (NeoCoder; arXiv 2407.09007; NAACL 2025)** — [Source](https://arxiv.org/html/2407.09007v2)
- What it is: after each solution, detect a technique it used and forbid it next round, up to 5 rounds. [description]
- Effect on GPT-4 as constraints stack from 0 to 5: novelty score 4.5 to 15.3 (up), correctness 16.1% to 2.1% (down), constraint-following 100% to 14.4% (down). The combined creativity score peaked at one constraint and reached zero by four. [measured]
- Reasoning add-ons (MCTS, self-correction, planning, sampling) gave no significant creativity gain. [measured]

**Temperature (Peeperkorn et al.; arXiv 2405.00492; ICCC 2024; Llama 2-Chat stories)** — [Source](https://arxiv.org/abs/2405.00492)
- Temperature is weakly correlated with novelty and moderately correlated with incoherence; no relation to cohesion or typicality. [measured, small older model]
- Anthropic now advises replacing temperature with "propose several directions" for design variety. — [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8) [practice report]

**Anti-pattern lists**
- Generic negatives shift the model to another fixed look instead of producing range; a named avoid list still converges on a new favorite. — [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8); [Source](https://claude.com/blog/improving-frontend-design-through-skills) [practice report]

**Dimensions first (Luminate; arXiv 2310.12953; CHI 2024)** — [Source](https://arxiv.org/abs/2310.12953)
- What it is: the model first generates the dimensions of the design space for the prompt (with values for each), then generates outputs spread across those values; users arrange outputs on one or two chosen dimensions. Study with 14 professional writers; reported to help exploration. [measured qualitatively, small study; secondary]

**Outside inspiration each round (Nova; arXiv 2410.14255, October 2024)** — [Source](https://arxiv.org/abs/2410.14255)
- Each round the model plans a search for material that would make the current idea set more novel and diverse, instead of only being told to avoid past ideas. Authors report 3.4x more unique novel ideas and at least 2.5x more top-rated ideas. [measured, authors' own; secondary]

**Role-play discussion (LLM Discussion; arXiv 2405.06373; COLM 2024)** — [Source](https://arxiv.org/html/2405.06373v3)
- Several agents with different assigned roles discuss, then converge; authors report it beats single-LLM baselines on originality, elaboration, fluency and flexibility on divergent-thinking tests. Effect sizes not seen. [measured, authors' own; secondary]

**Why this matters: homogenization and fixation**
- Stories written with one AI idea were 10.7% more similar to each other than stories without AI, though each was rated more creative. (Doshi and Hauser, Science Advances, 12 July 2024) — [Source](https://pmc.ncbi.nlm.nih.gov/articles/PMC11244532) [measured; secondary]
- In a 60-person design study, people using an AI image generator fixated more on the first example and produced fewer ideas with less variety and lower originality than a no-tool baseline. (CHI 2024) — [Source](https://arxiv.org/html/2403.11164v1) [measured; secondary]

### Inferences
- Cheapest strong step for design: one call that returns four or five directions as short specs (palette hex, type, layout idea, one-line reason, and which reference each part comes from), with a request to spread them and include low-probability ones. That uses the two measured effects (list, tails) and Anthropic's "propose 4 directions" advice, for one call.
- Diversity belongs at the direction stage, not the build stage. Running the same build prompt in parallel with no differing direction should give near-duplicates; the 5% unique figure is the warning.
- "Not like the last one" is useful for one or two rounds only. The NeoCoder numbers show quality collapsing as bans stack, which matches the designer's experience of patchwork: the model satisfies the bans and drops the brief.
- Personas and temperature are the weakest levers; the evidence for both is small or null.
- The ruled-out marks in the library are a ready-made, specific anti-pattern list. The evidence says specific positives beat generic negatives, so ruled-out items are better used by a judge than as a long ban list in the generator prompt.
- Showing the designer many AI variants risks fixation on the first good-looking one (CHI 2024). Showing directions that differ on named dimensions (Luminate) is a reasonable counter.

### Gaps
- No study measures Verbalized Sampling, tails sampling, or list prompting on visual or UI design with a human-rated diversity or quality metric.
- I found no measured evidence for "random seed concept" injection (random words or random constraints) on current frontier models. The nearest evidence is QDAIF's random target assignment (section 3).
- The exact chain-of-thought brainstorming prompt and its numbers in the Wharton paper could not be read from the PDF.
- Persona evidence conflicts: near-zero effect for single-call personas (Wharton, secondary), positive for multi-agent role-play (LLM Discussion, authors' own). Different setups; no head-to-head.

---

## 3. Search over candidates: quality-diversity, evolution, tournaments

### Takeaway
The systems that reliably get both range and quality share four parts: named dimensions that force candidates to differ, an archive that keeps the best candidate per region instead of one overall winner, pairwise tournaments for ranking, and "crossover" done by a model that is shown parents plus their scores and writes a new whole, with the child competing rather than replacing its parents. They cost hundreds to thousands of calls in the published versions, and the automated scores they climb are not ground truth.

### Cited Findings

**QDAIF, Quality-Diversity through AI Feedback (arXiv 2310.13032, v4 7 December 2023)** — [Source](https://arxiv.org/html/2310.13032v4)
- Dimensions: humans name the axes (sentiment; story genre; story ending; a 2D grid of genre × ending; poem genre × tone). A model labels each candidate on the axis; the axis is cut into bins (20 for the 1D runs), denser near the ends because model scores do not move evenly. Each bin keeps its best candidate (MAP-Elites). [description]
- Crossover/mutation: "LMX-Near" puts a few existing candidates in a prompt and asks for a similar new one; "LMX-rewrite" asks a model to rewrite one parent; "LMX-guided" adds a randomly chosen target cell (genre and tone) to the rewrite instruction, which fixed cells that plain rewriting never filled. [description]
- Scale: 2,000 iterations per run for stories and opinions; 200 for poems. [description]
- Effect: poems QD score 130 (CI 118–145) versus 76 for random generation and 99 for rewriting a fixed seed. In human evaluation across three domains QDAIF had the best combined quality-diversity score (0.772), but a fixed hand-written few-shot prompt had higher average quality (4.13 versus 3.90 out of 5). [measured]
- Judge agreement: model and human agreed on the diversity label 73% of the time, the same rate at which two humans agreed; 95% when both humans gave a clear label. [measured]
- Failure modes: quality-score hacking at the very top of the score range (the judge's score stops tracking human judgment); badly chosen axes give incoherent results (stories varied on "hero is a spy vs a politician" forgot to make the characters interact); prompt order sensitivity. [measured/observed]

**AlphaEvolve (Google DeepMind; arXiv 2506.13131, 16 June 2025)** — [Source](https://arxiv.org/html/2506.13131v1)
- Loop: a prompt holds several earlier programs sampled from a database with their scores and outputs, plus problem context; the model proposes changes; an automated evaluator scores the child; the database (inspired by MAP-Elites and island populations) keeps diverse good programs. A fast model supplies many candidates and a stronger model fewer, better ones. Candidates pass a cheap test before an expensive one. [description]
- Ablations: removing evolution, prompt context, meta-prompt evolution, whole-file evolution, or the strong model each hurt significantly (shown in plots; no numbers in text). On 50+ open math problems it matched the best known result in about 75% and beat it in about 20%. [measured, authors' own]
- Requirement: an automatic, trustworthy scoring function. [description]

**AI co-scientist (Google Research blog, 19 February 2025; arXiv 2502.18864, 26 February 2025)** — [Source](https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/); [Source](https://arxiv.org/html/2502.18864v1)
- Roles: Generation (literature search, simulated debates), Reflection (several depths of review), Ranking (tournament), Proximity (similarity graph, dedup), Evolution, Meta-review (summarizes recurring critique and appends it to the other agents' prompts next round). [description]
- Tournament: every new hypothesis starts at Elo 1200; top-ranked ones are compared in multi-turn debates, lower ones in single-turn comparisons; similar hypotheses are matched against each other; newer and top-ranked ones get priority. [description]
- Evolution strategies: grounding in literature, feasibility fixes, inspiration from top-ranked ideas, combining strengths of several top ideas, simplification, out-of-the-box thinking. The Evolution agent never edits an existing hypothesis in place; it creates a new one that must win its own matches, which protects good ideas from bad edits. [description]
- Evidence: higher Elo went with higher accuracy on GPQA diamond (top-Elo pick 78.4% top-1); Elo of best and top-10 hypotheses kept rising with more compute across 203 goals; on 11 goals experts rated novelty 3.64/5 and impact 3.09/5 and preferred it to baselines (average rank 2.36 of 4). The authors state Elo is an auto-evaluation, not ground truth, and the expert sample is small. [measured, authors' own]
- The May 2026 DeepMind post describes the same three phases (generate, debate, evolve) and says the tournament also injects fresh knowledge to widen the search. — [Source](https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/) [secondary]

**Tournament ranking of ideas (Si et al.; arXiv 2409.04109, 2024)** — [Source](https://arxiv.org/html/2409.04109v1)
- A 5-round Swiss tournament of pairwise comparisons; pairwise accuracy at telling accepted from rejected ICLR papers was 71.4% (Claude 3.5 Sonnet) while direct scoring was near chance (50.0 to 51.7%). [measured]
- The model's top picks and a human expert's top picks overlapped on only 17 of 49 ideas; every LLM evaluator agreed with human reviewers less than reviewers agreed with each other (53.3% versus 56.1%). [measured]

**Blending references in UI code (Misty; arXiv 2409.13900; CHI 2025)** — [Source](https://arxiv.org/html/2409.13900v3)
- What it is: "conceptual blending" for UI. The developer picks a region or aspect of an example screenshot (style, layout, content) and the model blends that aspect into existing work-in-progress code, then shows a "semantic diff" of what changed. Study with 14 frontend developers: helped start explorations and gave useful "serendipitous" blends. No quality metric. [measured qualitatively; secondary]

### Inferences
- How dimensions are chosen is the main design decision. QDAIF's lesson: axes must be things a judge can label reliably and that do not break coherence when varied. For design, usable axes would be few and concrete (for example: where the structure comes from, type character, color temperature or density), and a model can label them from a screenshot. Axes like "which reference contributes the hero" are the design version of "spy vs politician" and risk patchwork.
- The clean crossover recipe across all four systems: (1) show the parents with their critiques or scores, (2) state what to keep from each, (3) have the model write a new whole from scratch, not splice code, (4) add the child as a new candidate that must beat its parents in a pairwise comparison. Misty adds: name the aspect taken from each source. None of these splice fragments, which is the direct cause of patchwork.
- QDAIF's "random target cell" is the best-evidenced form of seed injection: give each parallel variation an assigned, different cell (a combination of axis values) instead of hoping they diverge.
- A small version is affordable: an archive of about 6 to 9 cells, 1 or 2 rounds, and pairwise judging is tens of calls, not the 2,000 iterations of the paper. No published evidence says the benefit survives at that scale; it is an extrapolation.
- These loops climb the judge's score. QDAIF and the co-scientist both note the score detaches from human judgment at the top. The designer's pick, not the Elo, has to be the final step.
- Meta-review (collect what the judge keeps saying and put it in the next round's generator prompt) is a cheap part to copy: one call per round.

### Gaps
- No quality-diversity or evolutionary system has published results on UI or web design. Mapping is by analogy from text, code and hypotheses.
- AlphaEvolve does not publish how MAP-Elites and islands are combined, and its ablation numbers are only in plots.
- FunSearch was not separately checked.
- No source measures whether "write a new whole from parents" beats "merge code from parents" for visual coherence.

---

## 4. Judging visual design with models

### Takeaway
Vision models are usable but mediocre design judges: about 60 to 70% agreement with human preference on single pairs (humans agree with each other about 85%), near chance when two designs are close, and over 90% only when the gap is large or when ranking many outputs in aggregate. Pairwise beats absolute scoring by roughly 8 to 20 points, rubrics and a handful of similar worked examples help, and known biases (position, leniency toward model-made work, preference for the typical) all push toward generic polish.

### Cited Findings

**MLLM as a UI Judge (arXiv 2510.08783, 9 October 2025; GPT-4o, Claude 3.5 Sonnet, Llama 3.2 Vision; 30 UIs; 9,296 human responses)** — [Source](https://arxiv.org/html/2510.08783v1)
- Absolute 1–7 scores: exact match 35 to 38%, within ±1 72 to 77%, Pearson 0.69 to 0.73. Model scores vary less than human scores. [measured]
- Pairwise: Claude 3.5 59.98%, GPT-4o 59.60%, Llama 52.96% overall. Near chance when the two UIs' human scores are close; about 90 to 93% when the gap is large. [measured]
- By dimension: best on "interesting" (Claude 78.5% pairwise), at chance on "ease of use" and "comfort"; models overrate ease of use and underrate aesthetic pleasure and interest. [measured]
- Authors' conclusion: "UI testing approximators, not replacements." The paper has some internal number inconsistencies between text and tables. [opinion; caveat]

**WebDevJudge (arXiv 2510.18560; v2 2 March 2026; 654 pairs with human preference from WebDev Arena)** — [Source](https://arxiv.org/html/2510.18560v2)
- Pairwise agreement with humans: GPT-4.1 70.34%, Claude 4 Sonnet 70.18%; single-answer grading 60.86% and 59.17%; human experts 84.56%. Pairwise averages over 8 points higher. [measured]
- Inputs: screenshots only 59.5 to 60.6%; code only 67.6 to 69.6%; both 70.2 to 70.3%. [measured]
- An agentic judge that operates the page did not beat a plain model call (60.55% versus 63.91% best plain single-answer), because of compounding errors. [measured]
- Position bias is systematic and instructions alone do not remove it. Rubrics raised agreement between human annotators from 65% to 92% (human-written) or 90% (LLM-written). [measured]

**ArtifactsBench (Tencent; arXiv 2507.04952, v2 September 2025)** — [Source](https://arxiv.org/html/2507.04952v2)
- A model judge using per-task 10-item checklists and three screenshots per artifact reached 94.4% ranking consistency with WebDev Arena's human ranking of models and up to 90.95% pairwise agreement with experts on 280 instances. [measured, authors' own; secondary]

**UICrit (arXiv 2407.08850; 2024; 3,059 critiques of 983 mobile screens by 7 designers)** — [Source](https://arxiv.org/html/2407.08850v3)
- Designers themselves only fairly agree on critiques (Fleiss' kappa 0.29 to 0.31; 0.55 on rankings). [measured]
- Few-shot calibration: 8 examples chosen by task and visual similarity to the screen being judged raised valid-critique score from 0.31 (zero-shot) to 0.48 (+55%, p = 5e-4). Human designers scored 0.75. Experts preferred the few-shot critiques over zero-shot 67% of the time and human critiques over few-shot 81% of the time. [measured]
- Predicting numeric ratings worked only partly (best 0.53 on a lenient accuracy measure; other setups 0.17 to 0.31). [measured]

**UIClip (arXiv 2404.12500, April 2024)** — [Source](https://arxiv.deeppaper.ai/papers/2404.12500v1)
- A trained model that scores UI design quality from a screenshot and description; highest agreement with 12 designers' rankings among the baselines tested. [measured, authors' own; secondary]

**Pairwise versus absolute, other domains**
- Idea ranking: pairwise 71.4% versus direct scoring about 50%. — [Source](https://arxiv.org/html/2409.04109v1) [measured]
- Rubric-based absolute scoring has its own position bias (models favor the first score option); rotating option order and averaging improves agreement with humans. (arXiv 2602.02219, February 2026) — [Source](https://arxiv.org/abs/2602.02219) [measured; secondary]

**Biases**
- Leniency and self-approval: agents grade their own work too kindly; a separate evaluator is still generous to model output. — [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps) [practice report]
- Self-preference: models rate their own text higher at equal human-rated quality, in proportion to how well they recognize it as theirs. (NeurIPS 2024) — [Source](https://arxiv.org/abs/2404.13076v1) [measured; secondary]
- Model-over-human preference: GPT-4 chose model-written product descriptions in 87 to 88% of cases. (PNAS, July 2025) — [Source](https://arxiv.org/pdf/2407.12856) [measured; secondary coverage for the figures]
- Typicality: preference data itself rewards typical outputs at equal correctness (weight 0.57 ± 0.07). — [Source](https://arxiv.org/html/2510.01171v3) [measured]
- Stable is not valid: a poster judge had run-to-run standard deviation under 0.024, yet scored a one-shot HTML poster 3.52 against 3.72 for the staged system and 3.77 for the human-made one, a narrow spread. — [Source](https://arxiv.org/html/2505.21497v2) [measured]

**What improves a visual judge**
- Zooming into regions and giving reference examples reduced a visual critic's hallucinations and false alarms. — [Source](https://arxiv.org/html/2505.21497v2) [measured qualitatively]; Anthropic reports "consistent uplift" from a crop tool. — [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) [practice report]
- One judge call with one rubric was more consistent than more elaborate judge setups. — [Source](https://www.anthropic.com/engineering/multi-agent-research-system) [practice report]

### Inferences
- Use the judge to cut, not to crown. At 60 to 70% per-pair agreement and about 90% on large gaps, a model judge is good at removing clearly weak candidates and poor at choosing between two good ones. The designer picks among the survivors.
- Use pairwise comparisons, run each pair in both orders, and give the judge both the screenshot and the code (the code added about 10 points in WebDevJudge).
- A plain "which is better" judge will favor the more typical, more polished candidate (typicality and model-preference biases). To protect originality the judge needs separate criteria (Anthropic's split of originality from craft) and should compare against the references themselves ("is this recognizably one of them?").
- Per-person calibration is supported by two sources: UICrit (8 similar examples, +55% valid critiques) and Anthropic (few-shot with score breakdowns). The designer's chosen and ruled-out marks with reasons are exactly this material; retrieve the handful most similar to the candidate being judged.
- Do not build an agentic judge that clicks around; a single call with a rubric did as well or better in two sources.
- "Interesting" is the dimension models judge best and "comfort/ease" the worst, which suits a judge whose job is originality and coherence more than usability.

### Gaps
- No study measures a vision judge calibrated to one individual designer's accept/reject history.
- No direct measurement of whether vision judges penalize unconventional but good designs; the "favors generic polish" claim rests on adjacent evidence (typicality bias, model-over-human preference, Anthropic's leniency reports).
- I found no published agreement study between model judges and Design Arena's human votes.
- All agreement figures are for 2024 to early-2026 models (GPT-4o, Claude 3.5 to 4 Sonnet, GPT-4.1); no figures for current frontier models.

---

## 5. Staged pipelines for design generation

### Takeaway
Staging helps most where it creates a small, checkable artifact before the expensive build (a plan, a token system, a layout skeleton) and where a visual critic looks at the render afterwards; measured gains exist (for example up to +17.8% over three critique rounds, and overflow in every poster without a critic), but gains flatten or wobble after a few rounds and most "staged beats one-shot" results are authors' own and scored by model judges.

### Cited Findings

**Paper2Poster / PosterAgent (arXiv 2505.21497; v2 30 October 2025; NeurIPS 2025)** — [Source](https://arxiv.org/html/2505.21497v2); venue from [NeurIPS slides](https://neurips.cc/media/neurips-2025/Slides/121461.pdf)
- Stages and artifacts: Parser (an asset library of section summaries and figures) → Planner (pairs text with visuals and fixes a binary-tree panel layout) → Painter–Commenter loop per panel (render, a vision critic with zoom-in and reference examples flags "overflow" or "too blank", repeat until it passes). [description]
- Ablations (qualitative): model-chosen layout instead of the tree gave broken structure; no critic gave text overflow in all cases; critic without reference examples missed overflow and blank space. [measured qualitatively]
- Scores (model judge, out of 5): human poster 3.77, PosterAgent 3.72, one-shot HTML from GPT-4o 3.52, generic multi-agent baselines 3.19 and 2.11, direct image generation 2.33 (looked fine at a glance, text unreadable up close). [measured, authors' own]
- Cost: about 101K tokens and $0.55 per poster with GPT-4o; about 4.5 minutes because panels are refined in sequence. A generic multi-agent baseline used about 361K tokens for a worse result. [measured]

**Vision-guided iterative refinement (arXiv 2604.05839, 7 April 2026; ICLR 2026 workshop)** — [Source](https://arxiv.org/abs/2604.05839)
- A vision model critiques the rendered page and the code model revises; up to 17.8% better than a single pass over three cycles on real WebDev Arena requests. The metric and judge are not named in the abstract. [measured, authors' own]

**Refinement is not monotonic (RubSE; arXiv 2608.24138, August 2026)** — [Source](https://www.alphaxiv.org/abs/2608.24138)
- Broad "fix the differences" feedback is unstable round to round; rubric-guided feedback beat naive self-revision in 15 of 18 settings, with an average gain of +1.90 points out of 100 on frontier models. [measured; secondary, abstract only]
- Anthropic saw the same: scores plateau, a middle iteration is sometimes best, complexity creeps up. — [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps) [practice report]

**ScreenCoder (arXiv 2507.22827, 30 July 2025)** — [Source](https://arxiv.org/html/2507.22827v2)
- Splits screenshot-to-code into grounding (find and label components), planning (hierarchical layout), generation (HTML/CSS); authors report better layout accuracy and code correctness than end-to-end models. Numbers not checked. [measured, authors' own; secondary]

**PrototypeAgent and MAxPrototyper (arXiv 2412.20071, December 2024; arXiv 2405.07131, CHI EA 2024)** — [Source](https://arxiv.org/html/2412.20071v1); [Source](https://arxiv.org/pdf/2405.07131)
- A central theme-design agent first writes a high-level theme description (and theme image), then text, image and icon sub-agents fill the layout while a shared cache keeps context consistent; designers can edit intermediate results. Authors report better quality and diversity than baselines. [measured, authors' own; secondary]

**COLE and OpenCOLE (arXiv 2311.16974, November 2023; arXiv 2406.08232, June 2024)** — [Source](https://arxiv.deeppaper.ai/papers/2311.16974v2); [Source](https://arxiv.deeppaper.ai/papers/2406.08232v1)
- Graphic design generation broken into a hierarchy of simpler sub-tasks handled by specialized fine-tuned models. I could not retrieve ablations comparing staged with end-to-end. [description; secondary]

**Anthropic's own staging**
- The planner is the stage that survived simplification; without it the generator under-scoped. The planner should stay high-level so its mistakes do not cascade. — [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps) [practice report]
- The current frontend-design skill stages plan (tokens, ASCII wireframe) → review plan for generic defaults → build → critique with screenshots. — [Source](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md) [opinion]
- Claude Design builds the design system once and applies it. — [Source](https://www.anthropic.com/news/claude-design-anthropic-labs) [product description]

### Inferences
- The intermediate artifacts with the best support are: (1) a short written direction or theme, (2) a token system (a few named colors, type, spacing, radius), (3) a layout skeleton, (4) the rendered screenshot with a critic's notes. Evidence is strongest for the layout skeleton (Paper2Poster ablation) and the rendered critique (three sources).
- For combining references, the token system is where the merge should happen. A merge at the level of 4 to 6 colors, one or two type families and one layout idea is small enough to check for coherence before any HTML exists, and it is editable by the designer. This is an inference from Anthropic's skill, Claude Design and PrototypeAgent, not a measured result.
- Review the plan before building. Anthropic's skill puts the "is this generic?" check on the plan, where a fix costs one call, instead of on the finished page.
- Budget two or three critique rounds, keep every round's render, and let the best round win. More rounds add cost and complexity without reliable gain.
- Critique feedback should be rubric-shaped and specific; open "make it better" feedback is the unstable kind.

### Gaps
- No ablation in any source isolates the value of a token-system stage for UI generation.
- Paper2Poster's stage ablations are qualitative; several other staged systems' numbers were not verified in full text.
- The paper found for the PrototypeAgent line is arXiv 2412.20071; whether its system is also published under the name "PrototypeFlow" was not confirmed.
- No staged-pipeline paper targets "several visual references in, one new coherent design out" with a human-rated originality measure.

---

## 6. Separation of roles: separate agents or one agent doing everything?

### Takeaway
The evidence supports exactly one separation strongly: the judge should be a fresh-context call separate from the maker. It supports parallel separation for independent exploration (several directions at once). It argues against splitting dependent, sequential design decisions (choosing, merging, building) across agents that do not share full context: that is where measured degradations of 39 to 70% and "conflicting implicit decisions" come from.

### Cited Findings

**For separating the judge**
- A standalone skeptical evaluator was "far more tractable" than a self-critical generator. — [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps) (24 March 2026) [practice report]
- A reviewer that starts with no shared context catches an average of 2 bugs per pull request, about 58% severe; it works because it sees only the result, with a short, sharp context, and can question the instructions. — [Source](https://cognition.com/blog/multi-agents-working) (Cognition, 22 April 2026) [measured, company's own]
- Adding a high-level verification step to a multi-agent coding system raised task success by 15.6%; clearer roles raised it 9.4%. — [Source](https://arxiv.org/html/2503.13657v3) (MAST; arXiv 2503.13657, v3 26 October 2025) [measured]
- A critic stage removed text overflow that appeared in every poster without it. — [Source](https://arxiv.org/html/2505.21497v2) [measured qualitatively]

**For parallel, independent work**
- Parallel subagents: +90.2% on a breadth-first research eval, at about 15x the tokens of chat. — [Source](https://www.anthropic.com/engineering/multi-agent-research-system) (13 June 2025) [measured, authors' own]
- On a parallelizable task, centralized multi-agent coordination improved performance by 80.9% over one agent. — [Source](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) (Google Research, 28 January 2026; 180 configurations, 4 benchmarks, 3 model families including Claude) [measured]

**Against splitting dependent work**
- On strictly sequential tasks every multi-agent variant degraded performance by 39 to 70%. Independent agents amplified errors 17.2x; a central orchestrator held it to 4.4x. Coordination overhead grows with the number of tools. A simple model of task properties picked the best architecture 87% of the time. — [Source](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) [measured]
- Seven open-source multi-agent systems failed 41% to 86.7% of the time; 14 failure modes in three groups: system design (for example step repetition 15.7%, ignoring the task spec 11.8%), inter-agent misalignment (reasoning–action mismatch 13.2%, task derailment 7.4%), and verification (wrong 9.1%, missing 8.2%, premature stop 6.2%). Multi-agent gains over single agents "often remain minimal." — [Source](https://arxiv.org/html/2503.13657v3) [measured]
- "Share context" and "actions carry implicit decisions": agents given only a summary misread the task, and agents writing in parallel make conflicting unstated choices about style and edge cases. (Cognition, June 2025) — [Source](https://cognition.com/blog/dont-build-multi-agents) [opinion; secondary for the wording]
- The 2026 follow-up: multi-agent works when "writes stay single-threaded and the additional agents contribute intelligence rather than actions"; parallel-writer swarms and free-form agent networks still do not work. — [Source](https://cognition.com/blog/multi-agents-working) [opinion from practice]
- Multi-agent is a poor fit when all agents need the same context or have many dependencies. — [Source](https://www.anthropic.com/engineering/multi-agent-research-system) [opinion from practice]
- Current Claude models over-delegate; guidance is to use subagents for parallel, isolated work and to work directly when context must be kept across steps. — [Source](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) [opinion]
- A judge that plans and acts did worse than a plain judge call because errors compounded. — [Source](https://arxiv.org/html/2510.18560v2) [measured]
- A generic multi-agent framework used 3.6x the tokens of a purpose-built staged pipeline and scored lower. — [Source](https://arxiv.org/html/2505.21497v2) [measured]
- The full harness cost over 20x a solo run; each part "encodes an assumption about what the model can't do on its own" and should be re-tested as models improve. — [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps) [measured cost; opinion]

### Inferences
- Applied to the four proposed roles:
  - "Choose what to take from each reference" and "merge into one system" are tightly dependent and full of implicit taste decisions. Keep them in one context (one agent, possibly two steps with a written artifact between them). Splitting them across agents that pass summaries is the pattern the evidence warns against, and a plausible cause of patchwork.
  - "Build" depends on the merged system; one writer per candidate. Different candidates can be built in parallel because they are independent of each other.
  - "Critique" should be a separate fresh-context call that sees the render, the code, the brief, the references and the designer's verdicts, but not the maker's reasoning.
- Reading each reference closely (what is worth taking) is read-only and independent, so it can be done in parallel or cached once per reference without the risks above.
- A workable shape that follows the evidence, with rough call counts (my estimates, not from any source):

| Step | Who | Calls | Evidence strength |
|---|---|---|---|
| Read verdicts and references; write "what to take from each" | one agent, shared context | 1 | Indirect (context-sharing evidence) |
| Propose 4–5 distinct directions as token-level specs, spread on named axes, tails included | same agent, one call | 1 | Good for text (VS, list effect); practice report for design (Anthropic) |
| Check the specs for generic defaults and for patchwork; drop or fix | same agent or judge | 1 | Opinion (Anthropic skill) |
| Build 3–4 specs in parallel, one writer each | parallel builders | 3–4 | Good (parallel independent work) |
| Fresh-context pairwise judge with rubric and retrieved verdicts, both orders | separate judge | about 6–12 | Moderate (60–70% per pair; better at cutting than crowning) |
| One or two critique-and-revise rounds on the top 1–2; optionally one "new whole from two parents" child that must beat its parents | builder + judge | 2–6 | Moderate (+17.8% over 3 rounds, authors' own; plateaus) |
| Designer picks; verdict and reason stored | designer | 0 | — |

  Total is roughly 15 to 25 model calls, against 1 for one-shot and 5 to 15 full build-judge rounds (hours) for Anthropic's loop.
- Add parts one at a time and keep only those that visibly change results, following Anthropic's own experience when simplifying.

### Gaps
- No source compares separate "select / merge / build / critique" agents with a single agent on a design task. The recommendation above is by analogy from coding and research benchmarks.
- The Google scaling study's sequential task was a planning benchmark, not creative work.
- The exact wording of Cognition's June 2025 principles was seen only through search summaries.

---

## 7. Learning one person's taste from accept/reject history and reasons

### Takeaway
The supported approach is to turn the person's history into readable, itemized preference rules, retrieve the past verdicts most similar to the thing being judged, and show both to the generator and the judge; reasons in words are worth more than bare thumbs. A model shown only a thin profile predicts individual preference poorly, and no source says how many verdicts are enough for design taste: the nearest figures are 8 similar examples for critique quality and 10 to 100 rated images per person in aesthetics research, where 10 in-context examples did badly.

### Cited Findings

**Learning written preferences from edits (PRELUDE/CIPHER; arXiv 2404.15269; NeurIPS 2024)** — [Source](https://arxiv.org/pdf/2404.15269)
- What it is: when the user edits the model's output, the model infers a short text description of the preference behind the edit, stores it with the context, and for a new task retrieves the preferences from the k most similar past contexts and combines them. No fine-tuning; the person can read and change the learned preferences. [description]
- Effect: lowest user-edit cost among baselines on summarization and email writing, with a shorter prompt than pasting raw past edits. Tested with a simulated GPT-4 user, not real people. [measured, authors' own; secondary]

**Preferences from comments on a few images (ViPer; arXiv 2407.17365; ECCV 2024)** — [Source](https://arxiv.org/html/2407.17365v1)
- The person comments once on a small set of images, saying why they like or dislike each; a language model turns the comments into structured lists of liked and disliked visual attributes, which then steer image generation, with a slider for strength. In user studies people preferred the personalized results most of the time. [measured, authors' own; secondary]

**Model judges standing in for one person**
- Given a simple persona, model judges show "low and inconsistent agreement with human ground truth"; letting the judge state its uncertainty gave over 80% agreement on the high-certainty cases for binary choices, comparable to third-party human judges. (arXiv 2406.11657, June 2024) — [Source](https://arxiv.org/abs/2406.11657) [measured]
- Generating an explicit checklist of criteria from the user's context, and weighting criteria by how well they separate that user's judgments, improves personalized reward accuracy over treating history as implicit context. No numbers in the abstract. (P-Check; arXiv 2601.02986; ACL 2026) — [Source](https://arxiv.org/abs/2601.02986) [measured, authors' own; secondary]
- Judges without a reference can confuse "fits this person" with "is generally good". (APM benchmark; arXiv 2605.21063) — [Source](https://www.alphaxiv.org/abs/2605.21063.md) [secondary]

**How many examples**
- Personal image-aesthetics research uses 10-shot and 100-shot protocols because collecting many ratings from one person is impractical. (arXiv 2407.07176) — [Source](https://arxiv.org/html/2407.07176v1) [description; secondary]
- In one 2026 study, in-context prompting with 10 examples scored 0.197, LoRA tuning with 100 examples 0.578, and a linear probe on the vision model's hidden states 0.611 on the same correlation-style metric. (arXiv 2604.11374, April 2026) — [Source](https://arxiv.org/pdf/2604.11374) [measured; secondary, check the table]
- Few-shot personal predictions fit some people much better than others. (AAAI) — [Source](https://ojs.aaai.org/index.php/AAAI/article/view/26395/26167) [measured; secondary]
- 8 examples chosen by similarity to the screen at hand raised valid design critiques by 55%; random examples helped less. — [Source](https://arxiv.org/html/2407.08850v3) [measured]
- Anthropic calibrated its design evaluator to one person's taste with a few scored examples and started its research eval with about 20 cases. — [Source](https://www.anthropic.com/engineering/harness-design-long-running-apps); [Source](https://www.anthropic.com/engineering/multi-agent-research-system) [practice report]

**Itemized rule memory (ACE, Agentic Context Engineering; arXiv 2510.04618, October 2025; ICLR 2026)** — [Source](https://arxiv.org/html/2510.04618v2)
- Problem: when a model rewrites its whole memory each time, the memory shrinks into generic summaries ("context collapse") and prompt optimizers drift toward short generic rules ("brevity bias"). [measured/observed]
- Fix: keep memory as a list of itemized bullets; add small delta entries after each task (generate → reflect → curate) and prune occasionally instead of rewriting. Reported gains: +8.6% on finance tasks and +11.9% over a prompt-optimizer baseline in offline adaptation, with much lower adaptation latency and cost. [measured, authors' own; secondary for the numbers]

### Inferences
- Three stores, used differently:
  1. Itemized taste rules written from the designer's reasons ("ruled out because the type felt corporate"), added one at a time and never rewritten wholesale. A rules file of this kind already matches the ACE pattern; the risk to avoid is periodic "summarize my taste" rewrites that flatten it.
  2. Retrieved verdicts: for each candidate, pull the handful of chosen and ruled-out items most similar to it (by look and by facet) and show them to the judge with the reasons. Similarity-chosen examples are what worked in UICrit.
  3. Chosen references as positive anchors for the generator.
- Reasons matter more than counts. ViPer and CIPHER both work by converting a small number of explained judgments into explicit attributes. A few dozen verdicts with reasons is likely enough to help a judge when retrieved by similarity; that figure is my estimate, bounded by "8 similar examples helped" and "10 unexplained in-context ratings did poorly".
- Expect the taste judge to be most reliable on clear cases. Asking it to say when it is unsure, and passing unsure cases to the designer, follows the personalized-judge result.
- Taste rules and originality pull against each other: a judge calibrated on past choices will favor designs like past choices. Keeping "fits this designer's taste" and "is not a repeat of a reference or an earlier sketch" as separate criteria follows Anthropic's split of quality from originality.

### Gaps
- No study uses a real designer's accept/reject history with written reasons to calibrate a vision judge for UI or web design; all mapping is by analogy.
- No source gives the number of verdicts needed. The number of images ViPer asks a person to comment on was not in the material I could read.
- CIPHER was only tested with simulated users.
- Whether frontier vision models in late 2026 predict an individual's design preference better than the 2024 to early-2026 models in these studies is unmeasured in what I found.
