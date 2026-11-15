# Why large AI models copy one design reference well but combine several badly

Notes written 16 November 2026. Every finding carries a tag:

- **[Measured]** a paper or benchmark with numbers.
- **[Vendor]** a statement by the model maker in its own docs or blog (informed, but not an independent study).
- **[Opinion]** analysis, position paper or practitioner post.

And a reading depth: *(full)* I read the paper or page text, *(abstract)* I read only the abstract page, *(snippet)* I only have a search summary and the number should be re-checked before it is quoted.

Models named in a source are given so that old-model claims can be spotted. "2024 models" means GPT-4V, GPT-4o, Gemini 1.5, Claude 3.x and similar.

---

## 1. Multi-image reasoning: how well do vision-language models reason across several images at once?

### Takeaway
Across every benchmark found, models are clearly worse at comparing and combining information across images than at reading one image, and the gap to humans is still open in 2026 (GPT-5 reaches 58% on a 2026 multi-image benchmark). The best-supported mechanisms are: models behave like single-image models, lose fine detail, depend on image position, and fail when the answer needs information from more than one image.

### Cited Findings

**Level of performance against humans**
- [Measured] *(full)* MuirBench (arXiv June 2024, ICLR 2025; 2,600 questions, 11,264 images, 2 to 9 images per question, 4.3 on average): humans 93.15%, GPT-4o 68.00%, GPT-4-Turbo 62.31%, Gemini Pro 49.35%, best open multi-image model (Mantis-8B-Idefics2) 44.50%. No Claude model was tested. 2024 models. — [MuirBench](https://arxiv.org/html/2406.09411v2)
- [Measured] *(full)* In MuirBench's analysis of 100 GPT-4o errors, the largest group was "failure of capturing details in images" (26%), then counting (20%), logic (18%), recognising the same object across scenes (14%), inferring intent from a sequence (12%). — [MuirBench](https://arxiv.org/html/2406.09411v2)
- [Measured] *(full)* MuirBench's weakest GPT-4o tasks were ordering (23.44%) and visual grounding (36.90%); its strongest were diagram (88.69%), matching (86.85%) and retrieval (80.14%). So "find which image matches" is much easier than "relate the images to each other". — [MuirBench](https://arxiv.org/html/2406.09411v2)
- [Measured] *(snippet, abstract quoted)* MMIU (arXiv August 2024, ICLR 2025; 52 tasks, 77K images, 11K questions): GPT-4o reached 55.7%. 2024 models. — [MMIU](https://arxiv.org/abs/2408.02718)
- [Measured] *(snippet, abstract quoted)* BLINK (arXiv April 2024): humans 95.70%, GPT-4V 51.26%, Gemini 45.72% on visual perception tasks, several of which need comparison across images. 2024 models. — [BLINK](https://arxiv.org/abs/2404.12390v1)
- [Measured] *(full)* Common-O Bench (Meta FAIR, arXiv 5 November 2025): the task is to say which objects two images have in common. Best models reach about 35% (GPT-4o 35.11%, Llama 4 Scout 35.12%), while the same models reach 65 to 85% when asked about one image (GPT-4o 77.28%). At least one object was hallucinated in 53% of answers. On the harder set with 8 to 16 objects per scene, accuracy is about 1% or less. Models hallucinate more when similar objects are present. Chain-of-thought had a "mixed effect". Scale gave "modest improvements". No GPT-5, Gemini or Claude model was tested. — [Common-O](https://arxiv.org/html/2511.03768v1)
- [Measured] *(abstract)* MMR-Life (arXiv 2 March 2026, accepted at ICLR 2026; 2,646 questions over 19,108 real-life images, 37 models): "Even top models like GPT-5 achieve only 58% accuracy." — [MMR-Life](https://arxiv.org/abs/2603.02024)
- [Measured] *(snippet, secondary source)* A summary of MMR-Life says GPT-5's 58.69% is 14 points below humans, that the best model on spatial reasoning scores 25.10% against 79.76% for humans, and that some closed models beat humans on analogical and deductive reasoning. — [MMR-Life notes](https://en.papernotes.org/ICLR2026/vlm_reasoning/mmr-life_piecing_together_real-life_scenes_for_multimodal_multi-image_reasoning/)

**What happens as images are added**
- [Measured] *(full)* "More Images, More Problems?" (MIMIC benchmark, Samsung AI Cambridge and MPI, arXiv 12 January 2026). Open-weight models only (LLaVA-OneVision, Qwen2-VL, InternVL2). Findings: (a) models "primarily behave as single-image models"; LLaVA-OV peaks when the visual token count equals one or two images; (b) when the needed information is spread over several images, accuracy "approaches 0 even when very few distractors are present"; (c) with one relevant image among 34 distractors, counting accuracy fell from 79.0% to 66.5%, but with two relevant images it fell from 75.0% to 12.5%; (d) the authors say the drop "stems primarily from increased sequence length rather than the increased number of images"; stitching images into one grid gave similar results; (e) in attention maps, early layers look across images, deeper layers look almost only inside each image; (f) performance "degrades sharply" as the number of concepts to track rises. — [MIMIC](https://arxiv.org/html/2601.07812v1)
- [Measured] *(full)* The same paper shows this is trainable: fine-tuning on synthetic multi-image data lifted one cross-image counting case "from 9% to 45.8%". — [MIMIC](https://arxiv.org/html/2601.07812v1)
- [Measured] *(snippet)* RealBench (arXiv September 2025) grouped questions by 1 to 6, 7 to 9 and 10 to 18 images and reports that both open and closed models decline as the count rises. — [RealBench](https://arxiv.org/pdf/2509.17421)
- [Measured] *(full)* MICON-Bench (arXiv 23 February 2026) tests making one image from several reference images. Open models fall steadily with more references: BAGEL 88.50 (2 references), 84.37 (3), 75.11 (4), 66.36 (5); OmniGen2 92.18, 89.52, 74.92, 67.00. The by-count test was not run on closed models. — [MICON-Bench](https://arxiv.org/html/2602.19497)

**Uneven attention and position**
- [Measured] *(snippet, CVPR 2025 oral)* "Identifying and Mitigating Position Bias of Multi-image Vision-Language Models": predictions change when the order of images changes. Open models do best on images placed late; GPT-4o does well on the first and last image and worst on the middle ones. 2024 models. — [Position bias, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Tian_Identifying_and_Mitigating_Position_Bias_of_Multi-image_Vision-Language_Models_CVPR_2025_paper.html)
- [Measured] *(full)* MuirBench: the highest error rate is when images sit in the middle of a question (no numbers given). — [MuirBench](https://arxiv.org/html/2406.09411v2)
- [Measured] *(full)* MICON-Bench: unified image models "tend to distribute attention uniformly across reference images, often focusing on irrelevant regions", which causes attribute mixing and hallucinated details. — [MICON-Bench](https://arxiv.org/html/2602.19497)

**Loss of fine detail (resolution and token limits)**
- [Vendor] *(full)* Claude reads images as 28×28 pixel patches. Claude 4.7 and later accept up to 2,576 px on the long edge and 4,784 visual tokens per image; older models 1,568 px and 1,568 tokens. "Images larger than either limit are downscaled before processing." A 3840×2160 image becomes 2576×1449 on current models and 1456×819 on older ones. — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Vendor] *(full)* When a request holds more than 20 images, a stricter per-image size limit applies to every image in it (the docs advise keeping each side under 3,000 px). Listed limitations: mistakes on "low-quality, rotated, or very small images", approximate spatial output, approximate counting. — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Vendor] *(full)* "Testing has shown consistent uplift on image evaluations when Claude is able to 'zoom' in on relevant regions of an image." — [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

### Inferences
- Strength of evidence: **strong and consistent** that cross-image reasoning is weaker than single-image reading (six independent benchmarks, 2024 to 2026). **Moderate** on the mechanism (single-image behaviour, attention that stays inside each image), because the mechanism studies use small open models.
- Does it hold for 2026 frontier models? **Partly.** The level has risen (GPT-4o 68% on MuirBench in 2024), but MMR-Life shows GPT-5 at 58% on a harder 2026 set. The human gap is smaller, not closed. No benchmark found tested a late-2026 Claude model, so the size of the gap for that model is unknown.
- The task that matters for mixing references, "what do these images share and how do they differ", is exactly the kind (Common-O, ordering, cross-image aggregation) where scores are lowest. Retrieval and matching ("which image fits this description") are the easy kind. This fits the observed pattern: the model can find a reference and copy it, but relating references to each other is weak.
- Detail loss is a simple arithmetic problem for long pages. A full-page website capture of 1440×6000 px is scaled to about 618×2576 px on current Claude models (about 43% scale), so 16 px body text is seen at about 7 px. On older models it would be about 376×1568 px. Type details, spacing rhythm and thin strokes are the first things lost. (My arithmetic from the vendor limits.)
- MIMIC's finding that the damage comes from total visual token length suggests that many large reference pictures in one context hurt each other, even when each one is readable alone.

### Gaps
- No public multi-image benchmark result for a late-2026 Claude model was found.
- No benchmark tests cross-image reasoning on design material (websites, posters, type). All use photos, diagrams or puzzles.
- No numbers on how a 2026 closed model's accuracy changes from 2 to 10+ images; the per-count curves found are for open models (MIMIC, MICON-Bench) or come from a snippet (RealBench).
- A CVPR 2026 benchmark (MIRACLE) was mentioned in search results with Gemini 2.5 Pro near 56%, but I could not confirm the source page, so it is left out.

---

## 2. Homogenization and regression to the mean

### Takeaway
There is strong measured evidence that LLM output clusters around a narrow "typical" set of answers, and the model maker itself says this is why its front ends look generic. The 2026 vendor docs show the problem has changed shape rather than gone away: the newer model has a different, equally persistent default look.

### Cited Findings

**The model maker's own account (design)**
- [Vendor] *(full)* Anthropic, "Improving frontend design through Skills", 12 November 2025: "Distributional convergence. During sampling, models predict tokens based on statistical patterns in training data." "Safe design choices–those that work universally and offend no one–dominate web training data. Without direction, Claude samples from this high-probability center." The stated result is "Inter fonts, purple gradients on white backgrounds, and minimal animations". — [Anthropic blog](https://claude.com/blog/improving-frontend-design-through-skills)
- [Vendor] *(full)* Same post: "Even with explicit instructions to avoid certain patterns, the model can default to other common choices", and the shipped prompt admits "You still tend to converge on common choices (Space Grotesk, for example) across generations." The post also says "Claude is highly steerable with the right prompting." — [Anthropic blog](https://claude.com/blog/improving-frontend-design-through-skills)
- [Vendor] *(full, current docs read 16 November 2026)* The prompting guide for all current Claude models still says "without guidance, models can default to generic patterns that create what users call the 'AI slop' aesthetic" and offers a prompt that begins "You tend to converge toward generic, 'on distribution' outputs." — [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Vendor] *(full, 2026)* Claude Opus 4.8 guide: the model has "a consistent default house style: warm cream/off-white backgrounds (~#F4F1EA), serif display type (Georgia, Fraunces, Playfair), italic word-accents, and a terracotta/amber accent." "This default is persistent. Generic instructions ('don't use cream,' 'make it clean and minimal') tend to shift the model to a different fixed palette rather than producing variety." Two things "work reliably": give a concrete alternative ("The model follows explicit specs precisely"), or have it propose several directions first. The guide adds: "If you previously relied on temperature for design variety, use this approach." The index of the same docs lists "design and frontend defaults" as a section for Claude Sonnet 5 as well. — [Prompting Claude Opus 4.8](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8)

**Measured studies (mostly text, not design)**
- [Measured] *(full)* Verbalized Sampling (arXiv October 2025; listed as an ICML 2026 poster). Diagnosis: human raters prefer familiar text ("typicality bias"), and preference training then sharpens the model toward its most typical answer. On 6,874 pairs of equally correct answers, the fitted bias weight was 0.57 ± 0.07 and 0.65 ± 0.07 with two base models (p < 10⁻¹⁴). In a staged training test (Tulu-3 70B, poems), diversity fell from 45.4% for the base model to 20.8% after supervised tuning and 10.8% after preference tuning; direct prompting kept only about 23.8% of the base model's diversity. Models tested include Claude 3.7 Sonnet, Claude 4 Sonnet, GPT-4.1 and Gemini 2.5 Pro. Larger models gained 1.5 to 2 times more from the fix than smaller ones. — [Verbalized Sampling](https://arxiv.org/html/2510.01171v2)
- [Measured] *(full)* "Examining and Addressing Barriers to Diversity in LLM-Generated Ideas" (arXiv 23 February 2026, GPT-4o): across a pool of product ideas, humans produced 28 categories and 206 category combinations, default LLM runs 22 and 88. In first ideas alone, humans gave 14.51 unique categories against 8.37. The authors' explanation: LLMs "aggregate knowledge into a unified distribution rather than exhibiting the knowledge partitioning inherent to human populations", whereas "each person occupies a distinct region of the knowledge space". With varied personas plus step-by-step reasoning, the LLM pool reached 248 combinations against 197 for humans. — [Deng, Brucks, Toubia](https://arxiv.org/html/2602.20408v1)
- [Measured] *(snippet, abstract quoted)* "We're Different, We're the Same: Creative Homogeneity Across LLMs" (arXiv 31 January 2025; 22 LLMs, 102 humans, three standard creativity tests): LLM responses are much more similar to other LLMs' responses than humans' are to each other, after controlling for response structure. Secondary summaries disagree on the direction of the same-family effect. — [Creative Homogeneity](https://arxiv.org/abs/2501.19361v1)
- [Measured] *(snippet, abstract quoted)* Doshi and Hauser, Science Advances, 12 July 2024: stories written with LLM ideas were rated more creative and better written, but were more similar to each other than stories written without. 2023 to 2024 model. — [Science Advances paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11244532)
- [Measured] *(snippet, abstract quoted)* Anderson, Shah and Kreminski (arXiv February 2024, revised May 2024; 36 participants): different users produced less distinct ideas with ChatGPT than with a non-AI aid, while diversity inside one user's own ideas did not differ. 2023 to 2024 model, small sample. — [Homogenization Effects](https://arxiv.org/abs/2402.01536v2)
- [Measured] *(abstract)* Kombine benchmark (arXiv 2509.21043, first version September 2025, sixth version 7 October 2026; 35 LLMs): about one in five invented concepts reuses a property that another model also invented; reuse is more common on blends than on analogies, and among models from the same provider. — [Kombine](https://arxiv.org/abs/2509.21043)

**Design-specific studies**
- [Measured, preliminary] *(full)* "Understanding Design Fixation in Generative AI" (arXiv 9 February 2025; 10 novice designers, chairs, GPT-4o and Midjourney, compared with 105 Red Dot award entries): Midjourney images were closer to each other than the award entries on shape (0.0592 against 0.0700), color (0.0685 against 0.0821) and texture (0.0862 against 0.0882), p < 0.01. Of 96 AI images only 2 were front views; the rest were mostly the same 45-degree angle. The authors call the study preliminary. — [Design Fixation in GenAI](https://arxiv.org/html/2502.05870v1)
- [Opinion] *(abstract)* "Interrogating Design Homogenization in Web Vibe Coding" (arXiv 13 March 2026): a position paper with case studies and no measurements. "Generative AI is known for its tendency to homogenize, often reproducing dominant style conventions found in training data." — [Web Vibe Coding](https://arxiv.org/abs/2603.13036)
- [Opinion with an unreviewed measurement] *(snippet)* A practitioner post reports 480 generation runs in which 95.4% of sampled UI colors clustered near hue 240° (blue-purple). Not peer-reviewed; method not checked. — [DEV post on UI color](https://dev.to/kenimo49/why-ai-generated-uis-are-all-the-same-color-and-the-data-to-prove-it-12oe)
- [Opinion] *(snippet)* A practitioner post argues the purple default traces to Tailwind's indigo accent being everywhere in training code. Speculation, not tested. — [DEV post on Tailwind indigo](https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p)

### Inferences
- Strength of evidence: **strong** for text (several controlled studies with a causal account in the Verbalized Sampling paper). **Moderate** for design: the direct evidence is the vendor's own statements plus one small study and practitioner posts. No peer-reviewed measurement of sameness in generated websites was found.
- Does it hold for 2026 frontier models? **Yes, in changed form.** The 2026 Opus 4.8 guide says the default look is "persistent" and that a ban moves the model to "a different fixed palette rather than producing variety". The old default (Inter, purple gradient) was replaced by a new one (cream, serif, terracotta). So newer models are less generic-looking but still pull toward one centre.
- This explains the "generic" failure in the designer's case directly: several references give the model no single explicit spec, and wherever the brief leaves a choice open, the model fills it from its own centre. The vendor says the model "follows explicit specs precisely", which is the one-reference case.
- The "one aggregated mind" account (Deng et al.) says why a human looking through 300 references behaves differently: a person brings a narrow, personal slice of taste and so lands on an unusual combination, while the model's choice among references is drawn from the average of everyone's taste. The same paper shows this can be countered by forcing varied viewpoints, so it is a default, not a hard limit.
- The typicality-bias account implies the pull toward safe answers is strongest exactly where several answers are equally "correct", which is the situation when choosing which parts of which references to take.

### Gaps
- No peer-reviewed study measures how similar LLM-generated web pages are to each other (fonts, palettes, layouts) across models and time.
- The vendor statements describe the default but give no numbers on how often it appears.
- No study measures whether homogenization gets better or worse when references are supplied, as opposed to a bare text prompt.

---

## 3. Combinational creativity: can models blend concepts, and where exactly do they fall short?

### Takeaway
Models are good at understanding a finished blend and at finding loose associations, and clearly weaker at producing a blend; the step they skip is working out the shared abstraction that makes two sources fit together. When that step is forced, results improve, and execution of the merge is a second, smaller bottleneck.

### Cited Findings
- [Measured] *(full)* "Probing and Inducing Combinational Creativity in Vision-Language Models" (arXiv April 2025, CogSci 2025). Framework from conceptual blending theory with three levels: Identification (what was combined), Explanation (how: shared attributes, mapping, "compatibility assessment"), Implication (what the blend means). Dataset: 666 mashups by professional artists, each blending two ordinary objects. — [Combinational Creativity in VLMs](https://arxiv.org/html/2504.13120v2)
- [Measured] *(full)* Understanding results from that paper: on Identification, GPT-4o 75.67% precision against 53.42% for average people; on Explanation, GPT-4o and Claude 3.5 Sonnet 74.19% against 69.89%; on Implication (win rate), human experts 78.3%, GPT-4o 73.5%, Gemini 1.5 Pro 71.7%, Claude 3.5 Sonnet 62.9%, average people 51.0%, Claude 3 Opus 39.2%. "Human experts demonstrate superior understanding with a 78.3% winning rate, significantly outperforming all models." 2024 models. — [Combinational Creativity in VLMs](https://arxiv.org/html/2504.13120v2)
- [Measured] *(full)* Generation results from that paper: adding an explicit step that names the shared attributes of the two sources (the Explanation level) before generating improved blends. With Midjourney, mean rank improved from 2.40 to 1.98 (lower is better) and the win rate against human experts rose from 0.26 to 0.35. Prompt length did not explain the gain. Even so, human experts still won about two thirds of the time. — [Combinational Creativity in VLMs](https://arxiv.org/html/2504.13120v2)
- [Measured] *(full)* Execution bottleneck in the same paper: with DALL-E 3, 90% (36 of 40) of outputs did include both objects, yet 27.8% (10 of 36) of good written blend plans "failed to produce satisfactory visuals". — [Combinational Creativity in VLMs](https://arxiv.org/html/2504.13120v2)
- [Measured] *(abstract)* Kombine (35 LLMs, 75 people; latest version 7 October 2026): LLMs are "10-16 percentage points better at discovering associations and analogies than blends." The abstract names an "abstraction bottleneck": even frontier models struggle to find a shared abstraction between inputs. Both people and models find blending the hardest of the three tasks. Counterpoint: the 75 lay participants scored below nearly every LLM on each task. — [Kombine](https://arxiv.org/abs/2509.21043)
- [Measured] *(snippet, earlier version of the same arXiv entry)* The September 2025 version reported a novelty-utility tradeoff that persists as models get larger, and that as tasks get more complex, models fail more often by breaking usefulness constraints than by being unoriginal. This wording is not in the latest abstract, so treat it as possibly revised. — [Combinatorial Creativity, v2](https://arxiv.org/html/2509.21043v2)
- [Measured] *(full)* MICON-Bench (February 2026) has an "Attribute Disentanglement" task: subject from one reference image, style from a second, background from a third. Over all six tasks the closed image models average 91.51 (GPT-Image) and 89.25 (Gemini 2.5 Flash Image), open models 45 to 76. Named failures of weaker models: attribute mixing, missing objects, inconsistent component transfer. — [MICON-Bench](https://arxiv.org/html/2602.19497)
- [Measured, small] *(full)* SpecifyUI formative study (arXiv 9 September 2025; 6 professional designers): designers often want layout from one reference and colors from another; this was the hardest thing to do with current AI tools, which "lacked mechanisms for selective extraction and recombination." — [SpecifyUI](https://arxiv.org/html/2509.07334v1)

### Inferences
- Where the failure sits, by stage:
  1. **Finding what is worth taking from each source**: no direct measurement for design. Identification of what was combined in a finished blend is good (above average people), but that is a different skill from choosing what to take from an unblended source. In the two UI systems that do support mixing (SpecifyUI, UI Remix, see question 5), the human does this step.
  2. **Seeing which parts fit together**: this is the best-evidenced weak point. Kombine calls it the "abstraction bottleneck"; the CreativeMashup paper shows that forcing the model to state shared attributes first is what improved output. Left alone, models skip it.
  3. **Executing the merge**: a real but smaller loss (27.8% of good plans failed at rendering with a 2024 image model). In the designer's setting the model writes HTML and CSS, where execution of a clear spec is strong, so this stage is likely the least important.
- Strength of evidence: **moderate**. Two good studies point the same way, but one uses two-object visual mashups and 2024 models, and the other is text-only. Neither is about design references.
- Does it hold for 2026 frontier models? **Probably, with less force.** Kombine's latest version is from October 2026 and still reports the bottleneck for frontier models. MICON-Bench shows that when the attributes are cleanly separable and each reference has an assigned role (subject, style, background), 2026 closed image models do well. This suggests the hard part is deciding the roles and the common ground, not carrying out an assigned mix.
- Caution on "humans can do it": the humans who beat models are experts (78.3% against 73.5%). Lay people score below models on blending. The designer's advantage is expertise and a personal point of view, not a general human one.

### Gaps
- No benchmark tests blending of design references (color from A, shapes from B, detail from C) into one layout, for either VLMs writing code or image models.
- No study separates stage 1 (what to take) from stage 2 (what fits) for design.
- The CreativeMashup generation test used text-to-image models driven by GPT-4o prompts, so it does not tell us how a 2026 model that both sees and writes code would do.

---

## 4. Example anchoring and fixation

### Takeaway
Vendors say plainly that their models follow examples and explicit specs very closely, and research shows copying from in-context examples is a real bias. There is no direct study of what happens to design output when several visual examples are shown; the indirect evidence points to "pick one or a few" in understanding tasks and "smear attributes together" in image generation.

### Cited Findings
- [Vendor] *(full, current 2026 docs)* Anthropic: "Examples are one of the most reliable ways to steer Claude's output format, tone, and structure." Examples should be "Diverse: Cover edge cases and vary enough that Claude doesn't pick up unintended patterns." — [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Vendor] *(full, 2026)* Claude Opus 4.8 "interprets prompts literally and explicitly... It does not silently generalize an instruction from one item to another, and it does not infer requests you didn't make." And for design: "The model follows explicit specs precisely." — [Prompting Claude Opus 4.8](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8)
- [Vendor] *(full, undated page)* Google: "The model attempts to identify patterns and relationships from the examples and applies them when generating a response," and "if you include too many examples, the model may start to overfit the response to the examples." — [Gemini prompting strategies](https://aistudio.google.com/docs/prompting-strategies)
- [Measured] *(snippet)* "Mitigating Copy Bias in In-Context Learning" (arXiv October 2024; listed in Findings of EACL 2026): LLMs copy answers from the demonstrations instead of learning the underlying pattern. Text tasks. — [Copy bias](https://arxiv.org/abs/2410.01288)
- [Measured] *(snippet)* A 2026 arXiv paper reports that when in-context examples are similar to the target, in-context learning "degenerates to copying labels without regard to relevance." Text tasks. — [arXiv 2604.01601](https://arxiv.org/html/2604.01601v1)
- [Measured] *(full)* Fixation inside one session: an LLM's early ideas constrain its later ones about as much as a person's do (slopes 1.013 and 1.035, p = 0.51). Seeding the LLM with a human's first idea did not raise the diversity of what followed (18.34 against 18.35 categories). Step-by-step reasoning reduced fixation in the LLM but not in people. GPT-4o. — [Deng, Brucks, Toubia](https://arxiv.org/html/2602.20408v1)
- [Measured] *(full)* Latching onto a subset: MIMIC's authors attribute the collapse on cross-image questions to models possibly "focusing on a small subset of images", and find models "primarily behave as single-image models". Open models. — [MIMIC](https://arxiv.org/html/2601.07812v1)
- [Measured] *(full)* Smearing across references: unified image models "distribute attention uniformly across reference images", giving attribute mixing. Open models. — [MICON-Bench](https://arxiv.org/html/2602.19497)
- [Measured] *(full, PDF read)* UI Remix (IUI 2026; 24 end users; a UI assistant that retrieves real app screens and applies a chosen one to the whole design or to one component). The paper says tools that adapt "a single example" risk "design fixation", and broad browsing risks "design drift". A participant on applying one chosen example: "you can perfectly copy the style and layout and apply the reference I choose to our app." Users felt they explored more alternatives (6.58 against 4.17 on a 7-point scale, p < .01), but the process benefits "did not translate into significantly higher expert-rated output quality", and the authors warn that reliance on retrieved examples "raises potential risks of stylistic homogenization or over-dependence on existing designs". — [UI Remix](https://arxiv.org/pdf/2601.18759)
- [Measured, preliminary] *(full)* In the design fixation study, nearly all of the 10 participants used ChatGPT's descriptions or Midjourney prompts unchanged; only two edited them. The paper does not compare one example with several. — [Design Fixation in GenAI](https://arxiv.org/html/2502.05870v1)
- [Measured] *(snippet)* Cloning is a well-practised task: "Clone Development" is 11.6% of WebDev Arena prompts, the third largest category. — [WebDev Arena](https://arena.ai/blog/webdev-arena)

### Inferences
- Strength of evidence: **strong** that models follow a single example or explicit spec closely (vendor statements from two makers plus copy-bias research). **Weak** on the specific question "several examples lead to averaging or to picking one", because nobody has tested it for design.
- Best reading of the indirect evidence: both happen, by route. When the model reasons over several pictures (a VLM writing code), the documented shortcut is to lean on one or a few images and treat the rest lightly, which matches "a near copy of one reference". When the model has no clear mapping and fills gaps from its prior, the result is "generic". The "patchwork" result fits a third route: it does take parts from each, but without the shared-abstraction step from question 3, so nothing ties them together.
- Does it hold for 2026 frontier models? **Yes, and literalism has grown.** The 2026 guide describes more literal instruction following than earlier models. A literal model given one reference has a complete spec. Given five references and "mix these", it has an instruction that names no mapping, and the guide says it "does not infer requests you didn't make".
- The fixation finding implies order effects: whichever reference the model engages with first will shape what comes after. That is consistent with the position-bias results in question 1.

### Gaps
- No study found that shows a model N design examples (N = 1, 2, 5, 10) and measures how close the output is to each one. This is the single most relevant missing experiment.
- The copy-bias papers are about labels in text classification; whether the same mechanism drives visual copying of a reference is an assumption.
- No vendor guide found addresses several visual references at once.

---

## 5. UI and web generation benchmarks: single-reference fidelity versus open-ended design quality

### Takeaway
Benchmarks measure two things: how faithfully a model rebuilds one given screenshot, and which of two outputs people prefer for a text prompt. Models are strong and fast-improving on the first. No benchmark, and no study, was found that tests generating a design from several references or a mood board without a person choosing the parts.

### Cited Findings
- [Measured] *(full)* Design2Code (arXiv March 2024, latest version February 2025; 484 real web pages; GPT-4V, GPT-4o, Gemini, Claude): "49% of the AI-generated webpages are considered exchangeable with the reference webpages", and GPT-4V's pages "are preferred in 64% cases" over the original. Models "mostly lag in recalling visual elements from the input webpages and generating correct layout designs." On the hard subset, "state-of-the-art models fail to generate 30% - 40% of the block elements." Human judges weigh high-level look (layout, color) more than exact text. 2024 models. — [Design2Code](https://arxiv.org/html/2403.03163v3)
- [Measured] *(snippet)* By late 2025 an automatic VLM judge of screenshot fidelity matched human pairwise judgments on Design2Code-HARD with a correlation of 0.93. This is fidelity to one reference, not design quality. — [UI2Code^N](https://arxiv.org/pdf/2511.08195)
- [Measured] *(snippet, abstract quoted)* DesignBench (arXiv June 2025; 900 web page samples; generation, editing and repair): performance is much lower with React, Vue and Angular than with plain HTML and CSS, and drops with large UI images and complex edit instructions. — [DesignBench](https://arxiv.org/abs/2506.06251)
- [Measured] *(abstract)* Sketch2Code (arXiv 21 October 2024; ten models): "even the most capable models struggle to accurately interpret sketches"; UI/UX experts showed "a significant preference for proactive question-asking over passive feedback reception." 2024 models. — [Sketch2Code](https://arxiv.org/abs/2410.16232)
- [Measured] *(snippet)* WebDev Arena: blind pairwise human votes on apps built from one prompt, ranked with a Bradley-Terry model. Largest prompt categories: Website Design 15.3%, Game Development 12.1%, Clone Development 11.6%. It measures preference, not correctness, and has no multi-reference task. — [WebDev Arena](https://arena.ai/blog/webdev-arena)
- [Measured] *(snippet)* Design Arena: crowdsourced pairwise human preference for AI-made designs; describes itself as a subjective framework. No multi-reference task. — [Design Arena](https://designarena.ai/about)
- [Measured] *(snippet, abstract quoted)* UICrit (UIST 2024; 3,059 critiques of 983 mobile UIs by seven designers): LLM-based critique does not yet match human evaluators; few-shot and visual prompting improved LLM feedback by 55%. 2024 models. — [UICrit](https://arxiv.org/html/2407.08850v3)
- [Measured] *(full)* SpecifyUI (arXiv 9 September 2025) is the closest thing to a multi-reference UI study. Each reference is parsed into a structured spec (global layout, color, shape language, usage; then page, section, component). The designer picks parts from several references; a rule forces each section's attributes to be a subset or specialisation of the global spec. Against Google Stitch with 16 participants: style consistency 5.52 against 4.18, layout consistency 4.99 against 3.73, intent adherence 6.06 against 4.25 (all on 7 points, p < .01). Fidelity of regeneration: CLIP similarity 0.887 with the structured spec against 0.755 for the best prompt-only baseline. — [SpecifyUI](https://arxiv.org/html/2509.07334v1)
- [Measured] *(full, PDF read)* UI Remix (IUI 2026): mixing is done one example at a time, with the user pointing at what to take. Expert-rated quality of the final designs did not differ significantly from the baseline. — [UI Remix](https://arxiv.org/pdf/2601.18759)
- [Measured] *(snippet)* CreativeConnect (arXiv December 2023, CHI 2024; graphic design, 16 participants): the tool pulls keywords (subject, pose, theme and mood, arrangement) out of several reference images and lets the designer recombine them; users produced more ideas than with a mood board plus ChatGPT. 2023 models. — [CreativeConnect](https://arxiv.org/html/2312.11949v2)

### Inferences
- Strength of evidence: **strong** that single-reference rebuilding is the well-measured, well-practised task; in 2024 half of generated pages were already judged exchangeable with the original, and fidelity is now so regular that an automatic judge tracks humans at 0.93. This matches the designer's experience that one reference is reproduced very well.
- The field has **no measurement at all** of the designer's actual task (model chooses and blends from a library on its own). The absence is itself a finding: nothing in public evaluation pushes models to be good at this, while cloning is both a benchmark (Design2Code) and a top arena category.
- Both systems that got good multi-reference results (SpecifyUI, CreativeConnect) share a pattern: break each reference into named facets, let a person choose facets, and enforce one global spec that everything else must agree with. In both, the choosing is human. This is weak but consistent evidence that the model's missing piece is selection and the unifying rule, not rendering.
- Does it hold for 2026 frontier models? The fidelity numbers are surely out of date (higher now). The lack of a multi-reference benchmark still holds as of this search.

### Gaps
- No benchmark or study of fully automatic UI generation from several references or a mood board was found. This was searched for directly.
- WebDev Arena and Design Arena percentages come from search summaries of their own pages; current leaderboards were not checked and would not answer this question anyway.
- DesignBench and UICrit numbers come from abstracts, not full text.

---

## 6. Text versus picture as the carrier of a reference

### Takeaway
A written description of a design loses most of what makes it particular, and models handle visual details they cannot name far worse than ones they can; where the description is silent, the evidence says models answer from their priors. The losses are measured mostly on photos and small open models, so the direction is well supported but the size for 2026 frontier models reading design work is not known.

### Cited Findings
- [Measured, small] *(full)* SpecifyUI formative study (6 professionals): "LLMs operate primarily through textual instructions, whereas designers predominantly think and communicate in visual terms." A designer: "I want the layout and visual feel from this image, but describing all that in words is too much work." Uploading the image instead "often missed or distorted intended elements." Short prompts gave outputs that "felt generic and aesthetically weaker." — [SpecifyUI](https://arxiv.org/html/2509.07334v1)
- [Measured, not peer-reviewed] *(abstract)* "The Describe-Then-Generate Bottleneck" (arXiv 18 September 2025; 150 image pairs made by describing an image with a VLM and regenerating it from the text): "99.3% of samples exhibit substantial perceptual degradation" and "91.5% demonstrate significant structural information loss." Natural images, models not named in the abstract. — [Describe-Then-Generate](https://arxiv.org/abs/2509.18179)
- [Measured] *(snippet)* A 2026 paper measuring what survives in VLM captions finds they describe coarse concepts and skip or misstate fine details. — [Cross-modal Identity Mapping](https://arxiv.org/html/2603.01696v1)
- [Measured] *(full)* "VLMs Need Words" (arXiv 2 April 2026; open models Qwen3-VL, InternVL3.5, Gemma 3; no closed frontier model): matching visual details across images works much better when the detail has a name. Named keypoints 53.8%, unnamed 40.3% (Qwen3-VL 8B). On unfamiliar shapes, the model answered correctly 29.0% of the time although its own internal representation held the answer 74.2% of the time. Asking it to reason in words made things worse on unfamiliar shapes (57.1% to 37.7%): "verbal reasoning devolves into hallucinated descriptions that actively mislead." Teaching the model arbitrary names for the shapes raised accuracy from 29.0% to 62.8%. — [VLMs Need Words](https://arxiv.org/html/2604.02486v1)
- [Measured] *(full)* "Lost in Embeddings" (arXiv 15 September 2025; LLaVA, Idefics2, Qwen2.5-VL 7 to 8B): the step that passes picture features into the language model distorts them, with nearest neighbours "diverging by 40–60% post-projection", and image regions with high loss predict wrong answers in two of three models. Small open models. — [Lost in Embeddings](https://arxiv.org/html/2509.11986v1)
- [Measured] *(abstract)* "Vision Language Models are Biased" (arXiv 29 May 2025, fourth version April 2026): when a picture looks like something familiar but has been altered, state-of-the-art VLMs average 17.05% counting accuracy, answering from what they know rather than what is shown. Removing the background nearly doubles accuracy (+21.09 points). More reasoning helps up to a point (about 40%), then hurts. — [VLMs are Biased](https://arxiv.org/abs/2505.23941)
- [Measured] *(snippet)* Researchers disagree on where the loss happens. One 2025 paper says open VLMs fail to use visual information they do hold and fall back on language priors; a 2026 paper argues the image is seen correctly and the failure is in deciding between what is seen and what is expected. — [search summary of "Hidden in plain sight"](https://www.themoonlight.io/tw/review/hidden-in-plain-sight-vlms-overlook-their-visual-representations); [VLMs Need Words, related work](https://arxiv.org/html/2604.02486v1)
- [Measured] *(snippet)* In web code generation, picture and text carry different things: Interaction2Code finds picture-only input misses visually subtle interactions and that picture plus text is best; Design2Code finds adding the page's extracted text to the screenshot improves fidelity. — [Interaction2Code](https://arxiv.org/html/2411.03292v3); [Design2Code](https://arxiv.org/html/2403.03163v3)
- [Vendor] *(full)* Gap-filling by default: "Without direction, Claude samples from this high-probability center." The same post advises against both "low-altitude hardcoded logic like specifying exact hex codes" and "vague high-altitude guidance that assumes shared context". — [Anthropic blog](https://claude.com/blog/improving-frontend-design-through-skills)
- [Measured] *(full)* The reverse also holds: a structured written spec extracted from the picture, used together with the picture and region crops, reproduced a reference better than prompting from the picture alone (CLIP 0.887 against 0.755, structural similarity 0.854 against 0.787). — [SpecifyUI](https://arxiv.org/html/2509.07334v1)

### Inferences
- Strength of evidence: **moderate**. The direction is consistent across six sources, but the strongest numbers come from photos, synthetic shapes and 7B-class open models. Nothing measures a 2026 frontier model turning a design into words.
- What is most likely lost in words is exactly what makes a reference fresh. A description keeps what has a name (dark theme, serif headline, three-column grid, hex colors) and drops what does not (the specific proportion, the rhythm of spacing, the character of a curve, how the type sits on the image). "VLMs Need Words" shows this is not only a writing problem: the model itself compares unnamed visual detail badly even when it sees it.
- Named properties are also the generic ones. If the model plans a mix by reasoning in words about references ("take the muted palette from A and the bold type from B"), each named part is close to a stock phrase, and stock phrases are rebuilt from the model's default version of them. This is a plausible route from "mix of specific references" to "generic result", and it stacks with question 2.
- The finding that verbal reasoning can make visual matching worse is a warning for workflows where the model describes each reference first and then works only from those descriptions.
- Facet-wise written specs are not the problem in themselves: SpecifyUI shows a structured spec plus the picture beats the picture alone for reproduction. The loss comes when text replaces the picture rather than accompanying it.
- Does it hold for 2026 frontier models? **Likely yes in kind, smaller in size.** Higher input resolution (2,576 px) and zoom tools reduce pure seeing errors. The "needs a name" effect and prior-driven answers are reported in papers from April 2026, though on open models.

### Gaps
- No controlled test of "design passed as image" against "design passed as description" against "both" for UI generation quality or distinctiveness. The describe-then-generate study is on natural images and is a small preprint.
- No test of the "needs a name" effect on closed 2026 models, or on design attributes.
- No direct evidence on which design attributes survive description best and worst; the list above is inference.

---

## 7. Coherence: why mixed-source designs look "Frankenstein", and can models judge coherence?

### Takeaway
No study was found that explains why mixed-source UI designs fall apart. The nearest evidence says coherence comes from one governing rule that every part obeys, that models do not form this rule on their own when mixing, and that model judgment of design quality still trails expert judgment in 2026.

### Cited Findings
- [Measured] *(full)* The one system that reports coherent multi-reference results gets there by rule, not by model taste: in SpecifyUI every section's layout and color must be a subset or specialisation of one global spec (layout, color, shape language, usage). Style consistency was rated 5.52 against 4.18 for a prompt-driven tool. — [SpecifyUI](https://arxiv.org/html/2509.07334v1)
- [Measured] *(abstract)* Blending needs a shared abstraction, and that is where frontier models struggle ("abstraction bottleneck"). — [Kombine](https://arxiv.org/abs/2509.21043)
- [Measured] *(full)* Asking the model to state the shared attributes and check compatibility before generating a blend improved the result (Midjourney win rate against experts 0.26 to 0.35). — [Combinational Creativity in VLMs](https://arxiv.org/html/2504.13120v2)
- [Measured] *(full)* In multi-reference image generation, attention spread evenly over all references produces "attribute mixing" and stray details from irrelevant regions. — [MICON-Bench](https://arxiv.org/html/2602.19497)
- [Vendor] *(full)* The maker's own design prompt asks for the unifying step explicitly: "Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes." — [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Measured] *(abstract)* AesEval-Bench (arXiv 1 March 2026, ICLR 2026; graphic design, four dimensions, twelve indicators): proprietary, open and reasoning-augmented VLMs all show "clear performance gaps against the nuanced demands of aesthetic assessment." No numbers on the abstract page. — [AesEval-Bench](https://arxiv.org/abs/2603.01083)
- [Measured] *(snippet, abstract quoted)* UICrit (UIST 2024): LLM critique of UI does not yet match human designers. 2024 models. — [UICrit](https://arxiv.org/html/2407.08850v3)
- [Measured] *(snippet)* A 2025 study of design sketches found a well-prompted reasoning VLM reached expert-level agreement on some measures (uniqueness, drawing quality) but not all. — [AI Judges in Design](https://arxiv.org/abs/2504.00938v1)
- [Measured] *(full)* Fidelity judging is strong while quality judging is not: models compare an output to one reference well (correlation 0.93 with humans, question 5), and UI Remix's expert raters saw no quality gain from an example-mixing workflow. — [UI2Code^N](https://arxiv.org/pdf/2511.08195); [UI Remix](https://arxiv.org/pdf/2601.18759)

### Inferences
- A plausible account of the "Frankenstein" look, built from the above (not directly tested): each reference is a complete system whose parts were tuned to each other. A part lifted out carries its source's assumptions (scale, contrast, density, mood). A designer re-tunes the lifted part to a new governing idea; a model that copies parts faithfully (question 4), without first stating a governing idea (question 3), keeps each part tuned to its old home. Literal fidelity, the same trait that makes single-reference copying good, is what makes the mix incoherent.
- The self-check loop probably does not catch it. When the model renders its page and looks, the well-evidenced skill is "does this match the reference". With several references there is no single target to match, and judging "does this hold together and feel fresh" is the weaker skill (AesEval-Bench, UICrit). So a patchwork can pass the model's own review.
- Strength of evidence: **weak to moderate**. The parts are each supported; the chain that links them is my inference. No study tests it.
- Does it hold for 2026 frontier models? Judgment of design quality is still reported as below expert level in a March 2026 benchmark. The vendor's 2026 guide says newer models have "strong design instincts", so coherence inside the model's own house style is probably good; coherence across borrowed parts is untested.

### Gaps
- No study of style consistency or "design system coherence" in designs assembled from several sources was found.
- No benchmark asks a model to judge whether a design is coherent, or to tell a coherent mix from a patchwork.
- AesEval-Bench per-dimension numbers were not available from the abstract; the full paper should be read before quoting which aspects are weakest.

### Cross-question summary of causes (inference, for the report writer)

| Cause | Evidence | Likely still true for late-2026 frontier models? |
|---|---|---|
| Pull to the model's own centre whenever a choice is left open (generic result) | Strong for text; vendor-confirmed for design | Yes. 2026 docs call the default look "persistent"; only the look changed |
| Literal following of one clear spec; several references give no spec (near copy of one) | Strong (two vendors, copy-bias research) | Yes, literalism has increased |
| Weak reasoning across images compared with one image | Strong, six benchmarks | Partly. Gap smaller, not closed (GPT-5 at 58% on a 2026 benchmark) |
| Skipping the "what do these share" step when blending (patchwork) | Moderate, two studies | Probably. Reported for frontier models in October 2026 |
| Unnamed visual detail lost when the reference is carried or reasoned about in words | Moderate; open models and photos | Likely in kind, smaller in size |
| Fine detail lost to downscaling of large pictures | Certain as arithmetic; effect on design not measured | Reduced (2,576 px limit, zoom), still real for long pages |
| Weak judgment of coherence and freshness in its own output | Moderate | Probably. Still below experts in March 2026 |
| No public benchmark rewards multi-reference design | Certain (none found) | Yes |
