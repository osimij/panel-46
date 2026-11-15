# Image models as the blender: multi-reference style blending, and "one blended picture, then code"

Research date: 16 November 2026. Every finding carries a tag:
**[measured]** = numbers from a benchmark or study; **[demo]** = someone showed it working, no measurement; **[opinion]** = a practitioner's or vendor's view; **[spec]** = a limit or feature stated in vendor docs (says nothing about quality).
"Snippet only" means I saw the claim in search results and did not open the page; treat it as weaker.

## 1. Multi-reference blending in current image models (how many references, can you say what to take from each, coherence, UI and text)

### Takeaway
Every major model now accepts several references (3 to 16), but only two control styles exist: per-image weights (Midjourney, Recraft, Krea, Figma Weave) or plain-language roles in the prompt (Gemini image models, GPT image models, FLUX.2). No product documents a true "palette from A, shapes from B" control, and the only measured evidence (MultiBanana, MultiRef) shows multi-reference quality drops as references and constraints grow, and that it measures subjects, not style blends.

### Cited Findings

**Midjourney (V7 to V8.2)**
- [spec] Several style references are allowed, separated by spaces; per-image weights with `::` work in Discord only, not on the website. `--sw` (0 to 1000, default 100) sets overall strength. `--sv 6` is the default for V7; `--sv 4` is the old V7 style model from before 16 June 2025. Style codes can be mixed with each other and with images. Official docs, read through search snippets because the page blocks direct fetch (403) — [Midjourney Style Reference docs](https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference)
- [spec] Moodboards are built from a set of curated images and get an ID code; strength is set with `--stylize` (0 to 1000, default 100); moodboards cannot be used with `--sv` or `--sw`. Midjourney's own tip: describe the style in words as well when using style references and moodboards, so it applies more consistently — [Midjourney Moodboards docs](https://docs.midjourney.com/hc/en-us/articles/39193335040013-Moodboards)
- [spec] Several moodboards can be mixed with each other, with style references and with a personalization profile (example given: `--sref 142710498 --profile drgmjoi 2jrqbw6`). Post is from early 2025 (V6/V7 era); syntax not re-verified on V8.2 — [Midjourney update: Moodboard Blending](https://updates.midjourney.com/describe-on-web-moodboard-blending/)
- [spec] V8 Alpha launched 17 March 2026; V8.2 became the default on 24 July 2026 — [Midjourney Version docs](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version)
- [spec, via a third party quoting Midjourney posts] V8 Alpha has "full backwards compatibility with V7 profiles/moodboards/srefs"; the new `--sv 7` style system is "approximately 4x faster and 4x cheaper". [opinion, same author, 4 Aug 2026] Numeric style codes are tied to the style system that made them; image references are "interpreted fresh"; distinctive, consistent sources transfer cleanly while generic photos "transfer mush"; use the moodboard as baseline taste and the style reference to steer one render — [Blake Crosley, Midjourney sref library strategy](https://blakecrosley.com/blog/midjourney-sref-library-strategy)
- [opinion, snippet only, 2026 reviews of V8/V8.1] Text in images improved in V8 but is "still unreliable beyond a word or two"; behind Ideogram and Recraft for text-heavy work; "Midjourney produces the aesthetic of information-dense design. Recraft produces the information." No path from a Midjourney image to a design file — [MindStudio, Recraft V4 vs Midjourney V8](https://www.mindstudio.ai/blog/recraft-v4-vs-midjourney-v8-design-comparison); [MindStudio, V8 Alpha strengths and weaknesses](https://www.mindstudio.ai/blog/what-is-midjourney-v8-alpha-strengths-weaknesses)

**Google Gemini image models ("Nano Banana" family)**
- [spec, docs read 16 Nov 2026, API revision 2026-05-20 in examples] Current line-up: Nano Banana 2.1 (`gemini-nano-banana-2.1`, the main workhorse), Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`), Nano Banana 2 (`gemini-3.1-flash-image`, previous generation), Nano Banana Pro (`gemini-3-pro-image`, "the premium choice for complex visual tasks"), Nano Banana (`gemini-2.5-flash-image`, legacy). All "mix up to 14 reference images". Nano Banana Pro: up to 6 object images, up to 5 character images, and "up to 3 images to be used as style references". Nano Banana 2.1 and 2: up to 10 objects and 4 characters; style references listed as "N/A". Nano Banana 2 Lite is "not optimized for multiple reference inputs". Output 1K default, 2K and 4K available. Text: "capable of generating legible, stylized text for infographics, menus, diagrams, and marketing assets". Multi-turn conversation is "the recommended way to iterate". The first 100,000 characters of the page contain no template for style transfer or for combining styles from several images — [Gemini API image generation docs](https://aistudio.google.com/docs/image-generation)
- [spec, secondary report of the Nov 2025 launch of Nano Banana Pro] Combine up to 14 reference images and keep up to 5 people consistent — [InfoQ, Dec 2025](https://www.infoq.com/news/2025/12/nano-banana-pro)

**OpenAI GPT image models**
- [spec, docs read 16 Nov 2026] The current guide documents `gpt-image-2.5` (Sunburst, Flare) and GPT-Image-2.6; it no longer mentions gpt-image-1 or gpt-image-2. Edits can "generate new images using other images as a reference" (the example uses four input images); in the part read, no maximum count is stated. Higher "complexity" settings help with "dense text, complex layouts, and relationships between objects" but can "increase latency and introduce unwanted changes". Masking is prompt-based and "may not follow its exact shape with complete precision" — [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [spec, secondary and conflicting] gpt-image-2 ("ChatGPT Images 2.0") launched 21 April 2026 with a reasoning mode. Reference limit reported as 16 by some sources and 10 by others; text accuracy reported as "above 95%" by some and "99%" by others, none traced to an OpenAI page — [The New Stack](https://thenewstack.io/chatgpt-images-20-openai/); [DataNorth](https://datanorth.ai/news/openai-launches-gpt-image-2-with-99-text-accuracy); [Together AI model page](https://www.together.ai/models/gpt-image-2)
- [demo + opinion, vendor with a stake, Aug to Oct 2026, GPT Image 2] Text rendering rated 5/5, prompt fidelity 4.5/5; a reference's likeness "drifted further from reference over turns" (fix: re-upload the original); 1.5 to 2 minutes per image; it "doesn't output editable, structured UI layouts". The review did not test UI-specific faults (fake components, spacing) — [Banani, GPT Image 2 review](https://www.banani.co/blog/gpt-image-2-generator-review)

**FLUX.2 (Black Forest Labs, launched 25 Nov 2025)**
- [spec] Reference limits: [pro] API up to 8 images (9MP total), [pro] playground up to 10, [flex] up to 10, [dev] recommended max 6. You point at references in plain words or by index ("The person from image 1 is petting the cat from image 2"). The help article's examples combine subjects and objects, not styles — [BFL help: multi-reference editing](https://help.bfl.ai/articles/6546682167-what-is-multi-reference-editing)
- [spec] Variants [max], [pro], [flex], [klein]; "up to 8 via API, up to 10 in the playground"; up to 4MP output. No worked example of style from one image and composition from another — [BFL FLUX.2 image editing docs](https://docs.eu.bfl.ai/flux_2/flux2_image_editing.md)
- [spec, snippet only] A host's page gives the prompt pattern "combine the style of @image1 with the composition of @image2" — [fal, FLUX.2 flex edit](https://fal.ai/models/fal-ai/flux-2-flex/edit)

**Ideogram**
- [spec, Ideogram 3.0, 26 March 2025] "Upload up to 3 reference images" to steer the look; styles can be saved for reuse — [Ideogram 3.0](https://about.ideogram.ai/3.0)
- Ideogram 4.0 (reported June 2026, with editable text layers and box-based layout control) appeared only in a third-party snippet; not confirmed.

**Recraft**
- [spec, docs read 16 Nov 2026] V4 Styles: up to 10 reference images; legacy styles (V3, V2): up to 5. "Use the percentage sliders between reference images to control how much influence each one has on the resulting style." In V4, saved styles cannot themselves be used as references (in legacy they can). Legacy has a "Mimic" choice: "Style essentials" or "Style & composition". V4 has no style prompt. The page does not say which attributes a style captures — [Recraft: how to create a custom style](https://www.recraft.ai/docs/recraft-studio/styles/custom-styles/how-to-create-a-custom-style.md)
- [spec] API: 1 to 10 references; a style gets a reusable `style_id`; a `match` setting (flexible or precise) — [Recraft V4 Styles API](https://www.recraft.ai/docs/api-reference/models/recraft-v4-styles)
- [opinion, snippet only] "Ten images in three different styles produce a muddier style than three images in one style" — [WaveSpeed guide to Recraft V4 styles](https://wavespeed.ai/blog/ai-guides/recraft-v4-style-api-guide/)

**Krea**
- [spec] Krea 2 API: 1 to 10 style references, each with its own strength, negative strengths allowed; in the app, up to 4 references each with a strength slider; references blend additively, so start with strengths that add up to about 1.0. Krea 3 "does not yet support" these style-reference controls — [Krea 2 style transfer docs](https://www.krea.ai/docs/developers/krea-2/style-transfer); [Krea 2 prompting guide](https://www.krea.ai/blog/krea-2-deep-dive-walkthrough); [Runware, Krea 2 Medium](https://runware.ai/docs/models/krea-2-medium)

**Adobe Firefly**
- [spec] A style reference carries "color, texture, lighting and other stylistic qualities" — [Adobe tutorial](https://www.adobe.com/learn/firefly/web/generate-image-using-reference-image?learnIn=1)
- [opinion, user reports, 2025 to Feb 2026] One Composition slot and one Style slot; a community reply says Firefly Image 5 takes only one reference; many threads report references being ignored or the style image's content leaking in — [Adobe community: multiple reference images](https://community.adobe.com/t5/adobe-firefly-discussions/how-to-add-multiple-reference-image-in-an-image-creation/m-p/15574767); [Adobe community: content of style reference used](https://community.adobe.com/bug-reports-403/content-of-style-reference-is-used-instead-of-solely-the-style-1483187)

**Measured evidence on multi-reference generation**
- [measured, Nov 2025 preprint, CVPR 2026] MultiBanana: 3,769 test sets spread over 3 to 8 references. Top models (Nano Banana, GPT-Image-1) nearly max out older benchmarks but struggle here; closed models tend to over-copy reference details, open models (for example Qwen-Image) give cleaner pictures but drop some references. The authors compare it to language models losing instructions as constraints grow — [MultiBanana, arXiv 2511.22989](https://arxiv.org/abs/2511.22989v1); [CVPR 2026 listing](https://cvpr.thecvf.com/virtual/2026/poster/39863)
- [measured, Aug 2025] MultiRef: 990 synthetic and 1,000 real samples; the best tested system (OmniGen) reached 66.6% (synthetic) and 79.0% (real) of the reference answer; models that claim to take any conditioning "often falter when actually confronted with multiple visual inputs". Older models only — [MultiRef, arXiv 2508.06905](https://arxiv.org/abs/2508.06905v3)

### Inferences
- There are two families. "Weight" tools (Midjourney, Recraft, Krea, Weave) average looks: you set how much of each, never which part of each. "Instruction" models (Gemini, GPT image, FLUX.2) let you write roles per image, so "color from image 1, layout from image 2" is possible only as a prompt, with no guarantee it is obeyed.
- Nano Banana Pro is the only model whose docs name a separate style-reference slot (3 images) next to object and character slots; the newer, cheaper Nano Banana 2.1 does not have it. For a style-blending job, Pro is the Gemini model to test.
- The two failure modes measured by MultiBanana (over-copying one reference, or dropping one) are the same two the designer sees in code: "copied" and "patchwork/generic". Moving the blend to an image model does not remove the problem; it moves it to a place where trying again costs seconds.
- For UI with real words, the GPT image and Gemini lines are ahead of Midjourney in 2026; Midjourney remains strongest for atmosphere and weakest for readable text and true layouts.

### Gaps
- No benchmark measures how coherent a *style* blend of several references is (all measured work is about subjects and objects). Coherence claims for every product are demos or opinion.
- No measured test of any 2026 image model on UI or web layouts (grid consistency, component consistency, small-text accuracy). OpenAI's and Google's text-accuracy numbers could not be traced to a primary source.
- Midjourney docs could not be opened directly; V8.2 details on per-image weights and moodboard mixing are from snippets and one third-party article.
- The maximum reference count for gpt-image-2.5/2.6 was not found in the part of the docs read.
- Nothing reliable found on Canva or Visual Electric for multi-reference blending; Firefly Boards and Ideogram 4.0 not confirmed from primary sources.

## 2. Research on separating and recombining style parts (which attributes separate cleanly)

### Takeaway
Research can pull apart color, texture/material, lighting, and (roughly) layout from "style", mostly for art, photos and objects; the cleanest splits are the ones you can name in words or compute as statistics (color). Precise style-versus-content separation is still reported as unsolved, mixing gets worse as more sources are merged, and none of this work targets UI, typography or component shapes.

### Cited Findings
- [measured, self-reported; Mar 2024, ECCV 2024] B-LoRA: training LoRA weights for two specific SDXL blocks together separates one image's style (appearance and texture) from its content (objects and structure), which allows style-content mixing across images — [B-LoRA, arXiv 2403.14572](https://arxiv.org/abs/2403.14572). Its listed limits: weaker identity keeping because color is split off, style leaking from background objects, and failure on complex scenes — [B-LoRA paper, ECCV](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/01549.pdf)
- [measured, self-reported; Mar 2025] ConsisLoRA: "precise style-content separation continues to be challenging, sometimes leading to content leakage" in B-LoRA-type methods — [ConsisLoRA, arXiv 2503.10614](https://arxiv.org/html/2503.10614v1)
- [measured, self-reported; Dec 2024] ZipLoRA merges separately trained style and content LoRAs but needs costly extra training at use time; simple merging gives lower quality — [arXiv 2412.05148](https://arxiv.org/pdf/2412.05148v2). UnZipLoRA separates content and style from a single image — [UnZipLoRA, arXiv 2412.04465](https://arxiv.org/html/2412.04465v1)
- [measured; Feb 2024, TMLR Nov 2024] Multi-LoRA Composition: plain merging causes "detail loss and image distortion as more LoRAs are added"; switching between LoRAs or compositing their guidance works better, more so as the count rises; tested on 480 sets of 2 to 5 LoRAs, judged by GPT-4V — [Multi-LoRA Composition, arXiv 2402.16843](https://arxiv.org/html/2402.16843v2)
- [demo + measured, Apr 2024] InstantStyle: feeding the reference only into style-specific blocks stops content leaking; in SDXL one block mostly governs layout and another style; the experiments use a single style reference — [InstantStyle, arXiv 2404.02733](https://arxiv.org/pdf/2404.02733); [project page](https://instantstyle.github.io)
- [demo + measured, Feb 2025] IP-Composer: training-free; for each named concept (for example "pattern", "color") a language model writes describing texts that define a subspace of CLIP's image embedding; each reference is projected onto its concept's subspace and the parts are joined into one embedding for IP-Adapter. Claims finer control over more concept combinations — [IP-Composer, arXiv 2502.13951](https://arxiv.org/html/2502.13951v1)
- [measured, self-reported; Mar 2025, NeurIPS 2025] SADis: first tuning-free method to take color from one reference and texture from another; color is matched with a statistical transform (whitening and coloring), texture is protected with an added noise term; built on SDXL, tested on WikiArt and StyleDrop images; says earlier methods "struggle with fine-grained style customization" because they cannot control several style attributes separately — [SADis, arXiv 2503.14275](https://arxiv.org/abs/2503.14275)
- [demo, Jan 2025, SIGGRAPH 2025 best paper per project page] TokenVerse: learns a separate adjustment per caption word from one image, so objects, accessories, materials, pose and lighting can each be taken from different images and combined; notes earlier methods struggled with non-object concepts — [TokenVerse project page](https://token-verse.github.io); [arXiv 2501.12224](https://arxiv.org/html/2501.12224v1)
- [demo, May 2023, SIGGRAPH Asia 2023 best paper] Concept Decomposition (Vinker et al.): splits one visual concept into a tree of "aspects"; the aspects are learned "without any external constraint regarding the type of separation, such as shape or texture", so the split is not something you choose; aspects can be recombined within and across trees — [Inspiration Tree project page](https://inspirationtree.github.io/inspirationtree/); [arXiv 2305.18203](https://arxiv.org/abs/2305.18203v2)
- [measured, self-reported; Jan 2026] StyleDecoupler: CLIP keeps both content and the style that can be put in words; DINO keeps mostly content — [StyleDecoupler, arXiv 2601.17697](https://arxiv.org/html/2601.17697v1)

### Inferences
- Separates fairly cleanly: palette (a statistics problem), surface texture and material, lighting, and coarse layout versus surface look. Separates badly or is unstudied: shape language (it is tangled with content), composition, typography, spacing rhythm, and "one small detail from a third image".
- The methods that work best route by words (IP-Composer's text-defined subspaces, TokenVerse's per-word control). That suggests the practical route for a design assistant is the same: name each attribute precisely in language, rather than hope an embedding average keeps the right part of each reference.
- "More sources, worse blend" is a consistent measured result (Multi-LoRA Composition, MultiBanana). Two or three sources is the regime research supports; beyond that expect loss.
- All of this is on SDXL or FLUX-type open models. None of it is exposed as a control in the closed models designers use, and none was tested on interfaces.

### Gaps
- StyleDrop and plain IP-Adapter multi-image use were not verified from primary sources in this pass; no claims about them are made here.
- No 2025 to 2026 paper found on attribute-level control for UI or graphic design (typography from one, grid from another). No survey of style-content separation found.
- B-LoRA's ECCV 2024 venue is from the ecva.net listing, not the arXiv page.

## 3. The image-mock-to-code workflow (who does it, quality, best practices, pitfalls)

### Takeaway
The workflow is real and widely described since Nano Banana Pro (Nov 2025): generate a mock, iterate in seconds, then have Claude Code or Cursor build it. All evidence is demos and opinion; practitioners treat the image as a direction, not a spec, and the more careful ones move to an HTML mock as early as possible. Measured work on screenshot-to-code says models now copy the look well but lose structure and exact values.

### Cited Findings

**Who describes it and how**
- [demo, 26 Nov 2025, `gemini-3-pro-image-preview` + Claude Code on Opus 4.5] A `/nano-banana` command in Claude Code gathers project context, writes the image prompt, generates a 16:9 mock at 2K (about 10 seconds), the author iterates, then Claude builds components, CSS and pages; about 15 minutes end to end. The first mock was a "safe" dark SaaS look; asking for more distinctive gave a result "not something I would have designed myself". The mock is "a direction", fine details need iteration in code; reuse the mock's words ("glass cards", "glow effects") as component and class names; match aspect ratio to target (16:9 web, 9:16 mobile). "Make it more premium" is "vague in words, obvious in pictures" — [paddo.dev](https://paddo.dev/blog/nano-banana-ux-design-workflow/)
- [demo, 18 Dec 2025, Gemini 3 Pro + Nano Banana Pro + Claude Code/Cursor] Plan in text, fix structure with ASCII mocks, render the hero in the image model, ask the image model to isolate assets one at a time, then give the coding agent the plan, the full image and the assets; suggests Playwright so the agent compares its own screenshots with the mock. "Image generators will create much more visually interesting designs than a coding agent"; coding agents drift to overdone patterns like purple gradients. Anthropic's frontend-design skill helps but "the creative output is still significantly short of what Nano Banana can create". Two examples; how closely the code matched the image was not checked — [AI Engineering Report, Bill Prin](https://www.aiengineering.report/p/beautiful-landing-pages-with-nano)
- [opinion + demo videos, 5 Jul 2026, Nano Banana Pro, v0, Cursor, Claude] Four stages: image mocks for concept ("ten directions in ten minutes costs almost nothing"), then HTML mocks, then a component checklist built one component at a time, then versioned iteration. The concept stage hands on "decisions" (palette, density, type, layout skeleton), not the picture. For building, HTML mocks beat images because HTML is "made of the same material as the final product". The author sells courses — [AI Builder Club, Vibe Design](https://www.aibuilderclub.com/blog/vibe-design-ai-ui-workflow)
- [spec, secondhand; 17 Aug 2026] Claude Code gained a `/design` skill in research preview: several editable UI drafts as artboards (each one HTML page) beside the session, you pick one, then Claude builds it. The article cites an X post, not an Anthropic page, and does not say whether it takes reference images — [AlphaSignal](https://alphasignal.ai/news/anthropic-s-claude-code-now-designs-ui-mockups-before-writing-a-single-line)

**Measured evidence on picture-to-code**
- [measured, Mar 2024 to Feb 2025, NAACL 2025; GPT-4o, GPT-4V, Gemini, Claude of that time] Design2Code, 484 real web pages: models "mostly lag in recalling visual elements from the input webpages and generating correct layout designs" — [Design2Code, arXiv 2403.03163](https://arxiv.org/abs/2403.03163)
- [measured, third-party snapshot, 2 Jun 2026] Design2Code scores: GLM-5V-Turbo 94.8%, Kimi K2.5 91.3%, Claude Opus 4.6 77.3%; only three models listed, not an official figure — [BenchLM](https://benchlm.ai/benchmarks/design2code)
- [measured, human-graded, one file; 1 Sep 2026] Five kinds of design-to-code tool on one B2B dashboard: the screenshot-to-code tool scored highest on looks (9/10) and lowest on editability (2/10), accessibility (3/10) and semantics (3/10), with duplicated chunks and positioning hacks; token-aware and component-mapping tools scored 7 to 8 on looks and 6 to 7 on editability. "'Looks right' is easy now. 'Edits cleanly' is still rare." Tools are unnamed categories — [Kunal Ganglani](https://www.kunalganglani.com/blog/design-to-code-tools-benchmark)
- [demo, 5 Dec 2025; Lovable, Bolt, Figma Make] NN/g: a moodboard screenshot made Figma Make follow the board's style; a Material Design screenshot gave a similar tone but more saturated colors; "it's unlikely for AI to achieve pixel-perfect precision"; a polished look hid weak hierarchy; broad prompts gave cluttered "Frankenstein" layouts; tokens or the Figma MCP are more precise than image uploads — [NN/g](https://www.nngroup.com/articles/vague-prototyping/)

**Pitfalls named by practitioners**
- [opinion] A flat image drops the design's structure (components, layout rules, tokens); the author's "80% of metadata vanishes" is an estimate, not a measurement — [Medium, Design-to-Code AI is not magic](https://medium.com/aimonks/design-to-code-ai-is-not-magic-heres-why-it-fails-sometimes-7740051f3580)
- [opinion] "A flawless copy of the image can still be a broken UI" (not responsive, not accessible, off the design system) — [AgentsCamp](https://agentscamp.com/guides/vision/screenshot-to-code-with-ai)
- [demo/opinion] Telling the model to rebuild with a known component library instead of copying pixels gave fewer layout faults, but spacing, sizes, colors and component details still differed — [i3DESIGN note](https://note.com/i3design_design/n/n288cde8ba06c?hl=en)
- [opinion] Images use up context: about a dozen at once can crowd out project instructions — [Claude Code Club](https://www.claudecodeclub.ai/blog/claude-code-screenshots)
- [opinion] Without a checklist the model redesigns parts you already approved; build one component at a time and feed screenshots back when it drifts — [AI Builder Club](https://www.aibuilderclub.com/blog/vibe-design-ai-ui-workflow)

### Inferences
- Best practice across sources: one screen (often just the hero) at a time; 16:9 at 2K or higher; iterate on the picture before any code; carry the mock's vocabulary into the code; give the coding model the picture plus exact values (tokens) plus real assets; let it compare its own screenshot with the mock.
- The coding model "cleaning up" distinctive parts is described indirectly (drift to purple gradients, colors shifting, approved parts redesigned) but nobody has measured it for mock-to-code specifically. The measured weak spots (recalling every visual element, layout) are exactly where distinctive details live.
- Careful practitioners already place an HTML mock between the image and the real build. For a tool whose final output is HTML anyway, the image mock's job is to fix the look; it should not be the last word on layout or text.

### Gaps
- No source measures how closely coded output matches an AI-generated mock (as opposed to a real screenshot). Prin names it as an open problem.
- Impossible layouts, fake text and inconsistent components in AI mocks are widely assumed, but I found no 2026 source that documents how often they occur with Nano Banana Pro or GPT Image 2-class models.
- A claim that image models miss exact hex values (near-green instead of pure green) appeared only in an unattributed search snippet.
- X threads and YouTube walkthroughs were not opened directly; coverage is from blogs.

## 4. Comparison: "coding model given a single blended mock" versus "coding model given several raw references"

### Takeaway
Nobody has published this comparison, even informally. The closest evidence says raw references without roles get mixed at random or nearly copied, that written "take this, do not take that" notes fix much of it, and that an image model's single picture is more distinctive than what a coding model makes on its own.

### Cited Findings
- [demo, small test; 3 Nov 2026, Claude Code in Oct 2026, model not stated] Same request at four levels, 9 runs in total: no references gave a clean template look; two references with no guidance were "mixed unpredictably" (background went dark, art covered the headline) and on one run a reference's card was nearly copied; references plus a few lines on what to take gave the right brand tone. Advice: two or three references, one job each, more than three "blurs things"; write "take" and "don't take" as separate lists. "Showing a reference matters less than saying 'take only this from it.'" One brand, subjective judging, author sells a guide — [Heyn Studio on DEV](https://dev.to/heynstudio/i-ran-the-same-claude-design-request-4-times-only-the-reference-hand-off-changed-4fnb)
- [opinion] Give each reference a job: layout from one, color mood from another, type from a third — [Learn AI with Mariah](https://learnaiwithmariah.com/guides/claude-can-see-screenshots/)
- [opinion] One screenshot plus design tokens beats a screenshot alone — [Claude Code Club](https://www.claudecodeclub.ai/blog/claude-code-screenshots)
- [demo, n=2; Dec 2025] For the same concept, the Nano Banana Pro picture was "much more creative and visually appealing" than the page Gemini coded directly — [AI Engineering Report](https://www.aiengineering.report/p/beautiful-landing-pages-with-nano)
- [measured, user study; CHI 2025, Apple] Misty blends example screenshots into a developer's existing UI code, region by region. With 14 frontend developers: it helped start exploration, let them state intent at different stages, and produced "serendipitous UI blends"; people treated imperfect blends as starting points and wanted to see what changed — [Misty, Apple ML Research](https://machinelearning.apple.com/research/interactive-prototyping); [arXiv 2409.13900](https://arxiv.org/html/2409.13900v3)

### Inferences
- The idea of turning "mix many" into "copy one" is plausible but untested. Its strongest support is indirect: single-reference copying is the well-measured strong case, and multi-reference without roles is the documented weak case.
- A cheaper version of the same idea needs no image model: write a role sheet (per reference: take, do not take) before coding. That is the only intervention with any test behind it, however small.
- If an image model does the blend, the role sheet is still needed, as its prompt. The image model does not decide what to take from each reference any better than the coding model unless told.
- An own test would settle this quickly: same three references, three arms (raw references; references plus role sheet; one blended mock plus tokens), several runs each, judged blind by the designer.

### Gaps
- No head-to-head, formal or informal, was found. This is the main open question of the whole topic.
- Misty's blends were made by a language model writing code from screenshots, not by an image model, so it does not show that an image blend is the better intermediate.

## 5. Intermediate style representations that are not a full mock (style tile, token sheet, component sheet, DESIGN.md, "style DNA")

### Takeaway
The intermediate that the industry settled on in 2026 is a text file, not a picture: exact tokens plus prose rules (Google's DESIGN.md), usually paired with one reference image for feel. Sources agree that tokens give precision and editability, pictures give impression, and prose carries the "why" and the prohibitions; no independent test ranks them.

### Cited Findings
- [spec; alpha, 2026] DESIGN.md (Google Labs): YAML tokens (colors, typography, spacing, rounding, named components with variants) plus markdown sections in fixed order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts. "Tokens give agents exact values. Prose tells them why those values exist and how to apply them." A command-line tool lints it (broken references, contrast below 4.5:1, section order), diffs versions, and exports Tailwind or W3C token files. "Expect changes to the format as it matures" — [google-labs-code/design.md](https://github.com/google-labs-code/design.md); [Google blog: DESIGN.md open-sourced](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/)
- [spec, 2026] Stitch can "extract a design system from any URL" and export or import design rules as DESIGN.md — [Google blog: Stitch](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/)
- [opinion] Limits of DESIGN.md noted by commentators: it can drift from the real design, and nothing checks that generated code follows it — [The Menon Lab](https://themenonlab.blog/blog/google-design-md-ai-agents-design-systems)
- [spec; 17 Apr 2026, Claude Opus 4.7] Claude Design builds a design system (colors, type, components) from a team's codebase and design files at setup and applies it to every project; several systems can be kept — [Anthropic: Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs)
- [opinion, vendor-leaning] Screenshots give "visual impression without exact values"; a tokens file gives exact values but no roles or rules; a markdown file carries roles, rules and prohibitions; use them together — [Orbitexa](https://orbitexaio.com/blog/design-system-context-for-ai-coding-assistants)
- [opinion, vendor claim] A JSON description is about 700 tokens against about 1,500 for a screenshot; the same thread concedes screenshots may hold information no JSON schema captures — [DEV: JSON instead of screenshots](https://dev.to/bickov/why-i-feed-my-coding-agent-json-instead-of-screenshots-439i); [Prompt Insights](https://www.promptinsights.news/news/json-over-screenshots-coding-agent-prompt-technique)
- [measured, one file, human-graded; Sep 2026] Tools fed tokens and components scored far better on editability and accessibility than the screenshot-fed tool, at a small cost in looks (7 to 8 versus 9 out of 10) — [Kunal Ganglani](https://www.kunalganglani.com/blog/design-to-code-tools-benchmark)
- [demo] NN/g: when a tool cannot take images, have a chatbot describe the reference page in words and prompt with that; naming a specific style ("neobrutalism") gave the best result of all prompt types — [NN/g](https://www.nngroup.com/articles/vague-prototyping/)
- [opinion/demo] Image-stage output should be "decisions" (palette, density, typography, layout skeleton) carried forward; the mock's vocabulary becomes the code's vocabulary — [AI Builder Club](https://www.aibuilderclub.com/blog/vibe-design-ai-ui-workflow); [paddo.dev](https://paddo.dev/blog/nano-banana-ux-design-workflow/)
- [spec/opinion, 2026] Variant's Style Dropper saves a design's "visual DNA" (color palette, typographic rhythm, spatial density) and applies it to another design while rearranging layout; Fast Company found the results "flat and same-y" — [Fast Company](https://www.fastcompany.com/91491205/this-new-ai-eyedropper-tool-brings-one-of-the-most-powerful-ux-tricks-into-the-ai-age); [Banani review of Variant](https://www.banani.co/blog/variant-ai-review-and-pricing)
- [spec] Reusable style objects for image models: Recraft `style_id` from 1 to 10 images, Midjourney style codes and moodboard codes — [Recraft V4 Styles API](https://www.recraft.ai/docs/api-reference/models/recraft-v4-styles); [Midjourney Moodboards docs](https://docs.midjourney.com/hc/en-us/articles/39193335040013-Moodboards)

### Inferences
- A layered "single thing" fits the evidence best: (1) a token block with exact values measured from the references, each value tagged with the reference it came from; (2) short prose with take and do-not-take rules; (3) one picture for feel. The picture alone loses values; tokens alone lose character.
- A DESIGN.md-shaped file is a natural home for a blend: the blending decision becomes explicit and reviewable line by line ("colors from A, shapes from B") before any pixels exist, and the designer can correct it in words.
- Tokens cannot hold the things that make a reference distinctive (a specific illustration treatment, an unusual layout move, one detail). Those need the picture or an HTML fragment, so an HTML style tile or component sheet built in real CSS is likely a better carrier than an image of one, since the coding model copies HTML exactly.

### Gaps
- No source found on AI-made style tiles or component-sheet images as the handoff to a coding model, and no test of "style sheet image" against "full mock".
- No independent comparison of DESIGN.md versus screenshot versus both as the thing a coding model follows.
- No tool found that takes several images and outputs one merged DESIGN.md with per-attribute sourcing; Stitch extracts from one URL.

## 6. Picking references that go well together by machine

### Takeaway
Tools exist for "how alike are these in style" (CSD, CLIP, SigLIP) and for "is this good UI" (UIClip), and fashion research shows that "goes together" is a different thing from "looks alike" and must be learned from examples of sets people actually combined. Nothing off the shelf scores whether two design references are different but compatible.

### Cited Findings
- [measured] CSD (Contrastive Style Descriptors, Somepalli et al.): an embedding trained for style, with style similarity as cosine distance; the authors compare it against CLIP, DINO, SSCD and MoCo — [CSD code](https://github.com/learn2phoenix/csd)
- [measured, preprint; May 2026] Raw CSD scores should not be read as absolute: on 91 artists, 23 show negative gaps at pair level; a corrected read-out raises pair-verification AUC from 0.883 to 0.905; supervised models (CSD, CLIP, SigLIP) separate styles better than self-supervised DINOv2, but overlap within a tradition remains — [When Style Similarity Scores Fail, arXiv 2605.09030](https://arxiv.org/pdf/2605.09030.pdf)
- [measured, self-reported; Jan 2026] CLIP holds both content and nameable style; DINO holds mostly content — [StyleDecoupler, arXiv 2601.17697](https://arxiv.org/html/2601.17697v1)
- [measured; UIST 2024] UIClip: CLIP B/32 tuned to score a UI screenshot for design quality and relevance to a description; plain CLIP is poor at this, and large vision-language models were near chance at judging design quality on the paper's tests — [UIClip, arXiv 2404.12500](https://arxiv.org/pdf/2404.12500); [project page](https://uimodeling.github.io/uiclip)
- [measured; ECCV 2018] Type-aware embeddings for fashion: compatibility is learned separately from similarity, with a separate embedding space per pair of item types, trained on 68,306 outfits people put together; 3 to 5% better than earlier methods on outfit compatibility and fill-in-the-blank — [Vasileva et al., arXiv 1803.09196](https://arxiv.org/pdf/1803.09196)
- [measured; SIGGRAPH 2011] Color Compatibility From Large Datasets: tests classic hue-template harmony rules against large sets of rated palettes and learns a model that predicts a palette's rating — [O'Donovan, Agarwala, Hertzmann](https://www.dgp.toronto.edu/~donovan/color/). A later summary reports its finding that designers do not make palettes that match hue templates unless the interface pushes them to (snippet only) — [secondary summary](https://publikasi2.dinus.ac.id/index.php/jcta/article/download/9470/4202)

### Inferences
- The fashion lesson transfers directly: compatibility is per attribute pair ("this palette with that type", like "this shoe with that top") and needs positive examples of sets that worked. The designer's own project history (references chosen together, and ones ruled out, with reasons) is exactly that kind of training signal, small but personal.
- A workable first version without training: embed each reference per facet (color measured from pixels, style via CSD or CLIP, layout separately), then look for pairs that are far apart on the facet being borrowed and close on the others, plus a learned palette-rating check on the merged palette.
- Classic harmony rules are weak guides (the 2011 result), so a palette model learned from data, or the designer's verdicts, should outrank them.

### Gaps
- No research found on compatibility of design references (web, UI, posters) as opposed to clothes; interior-design compatibility work was not found in this pass.
- No style embedding validated on UI or graphic design; CSD is trained on art and artist labels and its use on screenshots is unproven.
- No evidence that machine-picked compatible pairs lead to better blends downstream.

## 7. Design products that mix references with images inside (how they present "mix these")

### Takeaway
Products present mixing in four ways: sliders between references (Recraft, Krea), a node graph where each reference and weight is a visible node (Figma Weave), a board or code that stands for a taste (Midjourney moodboards, style codes), and an eyedropper that lifts a style off one design and drops it on another (Variant). UI-first tools (Stitch, Claude Design) do not offer mixing as such; they take references as context and turn them into a design system.

### Cited Findings
- [spec] Recraft: "percentage sliders between reference images to control how much influence each one has"; up to 10 references in V4; a test panel to try the style before saving — [Recraft custom styles](https://www.recraft.ai/docs/recraft-studio/styles/custom-styles/how-to-create-a-custom-style.md)
- [spec] Krea 2 app: up to four references stacked, each with its own strength slider; API allows negative strengths (push away from a look) — [Krea 2 prompting guide](https://www.krea.ai/blog/krea-2-deep-dive-walkthrough); [Krea style transfer docs](https://www.krea.ai/docs/developers/krea-2/style-transfer)
- [spec + vendor opinion, undated page] Figma Weave: "Each reference, weight, and model choice lives as a visible node", so you can swap a reference and trace how the output was built; the same references can be run through different models (Runway, Luma, Recraft named). "Style mixing rarely lands perfectly on the first pass"; masking and compositing are suggested to control where each style shows — [Figma Weave style mixing](https://www.figma.com/solutions/ai-style-mixing-tool/)
- [spec] Midjourney: a moodboard is a named set of images with an ID you add to any prompt; boards, style references and a personal profile can be stacked in one prompt — [Midjourney Moodboards docs](https://docs.midjourney.com/hc/en-us/articles/39193335040013-Moodboards); [Moodboard Blending update](https://updates.midjourney.com/describe-on-web-moodboard-blending/)
- [spec/opinion, 2026] Variant: Style Dropper (pick up one design's style, drop it on another), plus "Shuffle Layout" and "Remix Colors"; good at variations of one screen, not at multi-screen flows; reported in closed beta as of Feb 2026 — [Banani review of Variant](https://www.banani.co/blog/variant-ai-review-and-pricing); [Fast Company](https://www.fastcompany.com/91491205/this-new-ai-eyedropper-tool-brings-one-of-the-most-powerful-ux-tricks-into-the-ai-age)
- [spec, 18 March 2026 update] Google Stitch: an infinite canvas where images, text and code are dropped in as context; "vibe design" starts from goals, feelings and reference examples; a design agent keeps the project history; design system extraction from a URL. No documented limit or control for combining several references — [Google blog: Stitch](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/); [Neowin coverage](https://www.neowin.net/news/google-updates-stitch-with-vibe-design-and-infinite-ai-canvas/)
- [spec, 17 Apr 2026] Claude Design: start from a prompt, uploaded images and documents, or a codebase; no description of how conflicting references are weighed — [Anthropic: Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs)
- [spec] Adobe Firefly: two labelled slots, Composition and Style, one image each — [Adobe community thread](https://community.adobe.com/t5/adobe-firefly-discussions/how-to-add-multiple-reference-image-in-an-image-creation/m-p/15574767)
- [measured, user study; CHI 2025] FusAIn: designers pull visual attributes (texture, color, objects) out of a collection of inspiration images into "pens" and draw with them to compose the prompt; built around "deconstructing and reconstructing visual attributes" — [FusAIn, arXiv 2502.14747](https://arxiv.org/abs/2502.14747)
- [measured, user study; CHI 2025] AIdeation: search and recombination of reference images for concept designers; with 16 professionals it "significantly enhanced creativity, ideation efficiency, and satisfaction" against their usual workflow; two of four studios kept using it — [AIdeation, snippet via CHI 2025 listing](https://arxiv.org/html/2602.22171v2)
- [measured, user study; CHI 2025] Misty: pick a region of your UI and an example screenshot, blend, then see a plain-language diff of what changed — [Misty, Apple ML Research](https://machinelearning.apple.com/research/interactive-prototyping)

### Inferences
- The products that mix (image tools) only offer "how much of each". The interfaces that let you say "which part of each" exist only in research (FusAIn's attribute pens, Misty's regions, Variant's dropper comes closest in a product). That is the unoccupied space.
- Two patterns recur in the tools people kept using: the blend is visible and traceable (Weave's nodes, Misty's diff), and imperfect blends are accepted as starting points to adjust, not as final answers.
- UI-first tools avoid free mixing and go through a design system instead. That is a signal about what works for interfaces: resolve the mix into explicit rules first, then generate.

### Gaps
- Nothing reliable found for Canva or Visual Electric. Stitch's exact handling of several reference images is undocumented in what I read.
- The AIdeation link is from a search listing; its numbers were not read from the paper itself.
- No usage data on whether designers get coherent results from slider-style mixing; only vendor copy and reviews.
