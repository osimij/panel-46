# Combining design references with AI

16 November 2026. Written for Panel and FRIDAY.

The question: FRIDAY copies one save very well. Why is it bad at mixing several saves (color from one, shapes from another, a detail from a third) into something that is good, fits, and feels fresh? And what would fix it?

## The short answer

FRIDAY is not mixing your references. It is mixing short texts about them. You mix with your eyes.

On top of that, the models have four known weak spots that all show up when the job is "mix these".

The fix is to turn "mix many" (what the model is bad at) into "copy one" (what it is good at). FRIDAY first makes one small, exact thing that says what comes from where. You pick it. Then FRIDAY builds to it and checks the result against the saves.

Nobody has tested this exact job in public. So the plan below is built from nearby evidence, and it ends with a test on your own old briefs.

## What FRIDAY does today in Panel

This comes from reading Panel's code and 30 of your real chats (about 1,100 tool calls). The full study is in [panel_today.md](../research_notes/Combining%20design%20references%20with%20AI/panel_today.md).

| What happens | Number |
| --- | --- |
| Searches that show FRIDAY a picture | 0. Search answers in words only |
| Searches where FRIDAY asked to find "by look" | 24 of 128 |
| Times it opened a save with only one picture | 72 of 99 |
| Sites where that one picture is the whole long page squeezed small | 24 of 35 |
| Sketches after which it looked at a save again to compare | 1 of 117 |
| Saves it said it "used" but never saw a picture of in that chat | 20 of 98 |

More facts from the same study:

- FRIDAY's whole instruction for mixing is one sentence: "find, look at and combine their saves". Nothing says how many saves to open, how to check that they fit each other, or to compare the result with them.
- `gather_for_brief` picks the best save for color, for type, for layout, each on its own, by the words of the reads. Nothing checks that the picks suit each other. One pick matched the words "white, tan, muted, low contrast" while its real colors were dark brown with high contrast.
- When FRIDAY gets its sketch back, it sees the sketch alone. The saves are not beside it.
- FRIDAY mixes in sentences: "layout from A, glow from B". The words often come straight from the reads. When a value is missing it guesses, and says so ("The blue is my guess").
- Your complaint was almost never "wrong colors". It was "template", "boring", "generic", "they all look the same". The color and one detail came from your saves. The structure of the page came from FRIDAY's own habits.
- The mixes that worked were yours: you named the saves and the exact part, or you pasted your own screenshots of the part. You cannot point at a part of a save in Panel today, only at a part of a sketch.

## Why the models fail at this

| Cause | What it means | How strong the evidence is |
| --- | --- | --- |
| Pull to a default look | The model has a house style. Telling it "not that" moves it to another fixed look, not to variety | Strong. Anthropic says so in its own guide |
| It follows a clear spec to the letter | One reference is a full spec, so it copies well. "Mix these" is not a spec, so it fills the holes with its habits | Strong for the first half. The second half is a reading of it |
| It relates several pictures badly | It reads one picture far better than it compares two | Strong, but measured on older models |
| It skips "what do these share" | Without a stated common ground, parts are put next to each other, not joined | Medium |

Sources and details:

- **Default look.** Anthropic's guide for Claude Opus 4.8 says the model has a steady default style (warm cream, serif display type, a terracotta accent), that the default is hard to shake, and that general "avoid this" lines only move it to another fixed palette. What works, they say, is a concrete direction or asking for several directions first. [Anthropic prompt guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8)
- **Structure falls back first.** One designer compared tactics on the same landing page brief. Set colors and fonts fixed the color mistakes, but the layouts stayed the same. Reference pictures were the first thing that gave layouts outside the model's usual two or three. [Repaint, April 2026](https://repaint.com/blog/picture-is-worth-a-thousand-tokens)
- **Several pictures.** On a test that asks what two pictures have in common, the best models were right about 35% of the time. The same models were right 65 to 85% of the time about one picture. This was measured in late 2025, and no current Claude model was in it. [Common-O Bench](https://arxiv.org/html/2511.03768v1)
- **Shared ground.** A test of 35 language models found they are 10 to 16 points worse at blending two ideas than at finding links between them, and names the reason: they struggle to find what the two inputs share. A fair counterpoint from the same paper: ordinary people did worse than the models. Blending is hard for everyone except people with a trained eye. [Kombine](https://arxiv.org/abs/2509.21043)
- **Image models have the same problem.** With 3 to 8 references, the strongest image models copy one reference too closely or drop some. [MultiBanana, CVPR 2026](https://arxiv.org/abs/2511.22989v1)

## What works, by the evidence

**1. Nobody gets good results from "here are several screenshots, mix them".** Every method that people report as working adds a step in the middle. See [practitioner_workflows.md](../research_notes/Combining%20design%20references%20with%20AI/practitioner_workflows.md).

**2. Give each reference one job, and keep it to three.** One designer ran the same request four ways in Claude Code. Two references with no words: mixed at random, or one nearly copied. The same two with a few lines on what to take from each: it worked. Their rule is two or three references with different jobs, a "take" list and a "don't take" list. It is one person's small test, but it is the only direct one. [Heyn Studio](https://dev.to/heynstudio/i-ran-the-same-claude-design-request-4-times-only-the-reference-hand-off-changed-4fnb)

**3. One main reference, small loans from the others, written down and checked.** The clearest published method picks one main reference, borrows one or two narrow details from others, writes a short "lock" (what must survive, what was borrowed, what is rejected), and checks the finished page against that lock. It also names the bland middle you get when strong references are averaged. [Refero's skill](https://github.com/referodesign/refero_skill/blob/HEAD/skills/refero-design/SKILL.md)

**4. Say what the sources share before joining them.** A tool for blending two objects into one picture gave beginners a clear rule for what the two must share and two written checks. Good blends went from 21% to 96%. This was about objects, not web design, so it is a pointer, not proof. [VisiBlends](https://www.cs.columbia.edu/~chilton/web/my_publications/VisiBlends_CHI2019.pdf)

**5. In every research tool that mixes references, the person picks the parts.** The tools split each reference into named parts, the designer chooses, and the tool makes several rough options. None lets the AI choose the mix alone. When designers could pick parts from several references, results were rated more consistent than with Google Stitch (5.52 against 4.18 out of 7 for style). [SpecifyUI](https://arxiv.org/html/2509.07334v1), [CreativeConnect](https://arxiv.org/html/2312.11949v2), [AIdeation](https://arxiv.org/html/2502.14747v1)

**6. Mostly familiar, plus one unusual thing.** In a study of 17.9 million science papers, work that was mostly conventional with a small unusual part was a hit almost twice as often as normal (9.11% against 5%). All conventional or all unusual did no better than normal. It is about science, not design, but it matches your "gem". [Uzzi and others, 2013](https://www.kellogg.northwestern.edu/faculty/uzzi/htm/papers/Science-2013-Uzzi-468-72.pdf)

**7. A second pair of eyes that only checks.** Anthropic's own method for better design is a separate, strict checker that looks at the rendered page. [Anthropic, March 2026](https://www.anthropic.com/engineering/harness-design-long-running-apps). Models are good at one kind of check and weak at another:

| Kind of check | How well models do |
| --- | --- |
| "Does this match that one reference?" | Very well. Agrees with people almost always (0.93). [Source](https://arxiv.org/pdf/2511.08195) |
| "Which of these two designs is better?" | About 60 to 70% agreement with people. Experts agree with each other about 85%. See [orchestration_techniques.md](../research_notes/Combining%20design%20references%20with%20AI/orchestration_techniques.md) |

So FRIDAY's checker should ask the first kind of question. You stay the judge of the second kind.

**8. Do not split one chain of steps across many agents.** A Google study found that on step-by-step work, several agents did 39 to 70% worse than one. On work that can be done side by side, they did much better. So: one FRIDAY for the chain, extra copies only for making options at the same time and for the check. [Google Research, January 2026](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)

**A warning.** Showing people AI pictures early made them stick to those pictures, with no gain in fresh ideas. So options should be few, rough and different from each other. [Wadinambiarachchi and others, CHI 2024](https://arxiv.org/html/2403.11164v1)

## The workflow for Panel

| Step | What happens | What in Panel it builds on |
| --- | --- | --- |
| 1. Look by eye | Search shows FRIDAY a sheet of small pictures. FRIDAY can open one exact screen of a save at full size | The single screens are already saved for every site. Today FRIDAY can only ask for the first picture or all of them |
| 2. Mix card | Before any sketch, FRIDAY writes a small card: one hero save that gives the structure, one or two helpers with one job each, "take" and "don't take" for each, what they share, and the one unusual thing. The real crops are on the card. It makes three different cards | The planner already has to write "each save and the exact thing to take". Questions can already show saves in a row |
| 3. You pick or change | You choose a card, swap a helper, or point at the part of a save you want | Pointing works on sketches today. For saves you paste screenshots |
| 4. Small tile first | Each card becomes a small tile: colors, type, one component, the detail. Not a page | The wireframe kind of sketch is the same idea. "Try 3 alternates" already runs copies side by side |
| 5. Build to the tile | The tile and its card become the single reference. Now it is a copy job | The recipe steps |
| 6. Check against the saves | FRIDAY gets its sketch next to the crops it took from. A fresh look asks: is each taken part really there? Is it a copy of one save? Which sections have no save behind them? | The Figma round trip already returns two pictures to compare. The rule checks already come back with every sketch |
| 7. Remember the mix | Panel stores which save gave what, and whether you kept it | The "uses" lines: 77 exist, but they store only the save, not what was taken |

Why the hero must give the structure: your "template" complaint is the model filling the structure from habit. Whatever has no reference behind it falls back to the default. Step 6 makes those sections visible.

## What to build first

Steps 1, 2 and 6. They are the smallest, and they have the strongest evidence. Step 2 is mostly words in FRIDAY's instructions and the recipe.

Then test before building more:

1. Take three old briefs where you were not happy: the CRM hero, the NavTech landing page, the journaling app.
2. Run each the old way and the new way on a copy of the library.
3. You look at the results without knowing which is which, and say which you would keep.

If the new way wins, build steps 3, 4 and 7. If it does not, we know before spending more.

## What I would not do first

**An image model as the mixer.** People do make one blended picture and have Claude Code copy it. But nobody has compared it with anything, no image tool lets you say "color from A, shape from B", and the careful people still put an HTML page between the picture and the build. It is worth one experiment later. See [image_models_as_blender.md](../research_notes/Combining%20design%20references%20with%20AI/image_models_as_blender.md).

**A big search over hundreds of options.** Systems that do this cost hundreds of model calls, and the scores they climb drift away from what people like.

## What is not proven

- No study tests "several references in, one fresh design out" with people rating the result. Every step above is a careful reading of nearby evidence.
- The numbers on comparing pictures come from 2025 models. Today's models are better, but the gap is not closed.
- The best mixes in your chats came from you. The plan makes FRIDAY's own picks much better informed, but it keeps you choosing at step 3, because that is what all the evidence supports.
- Some numbers in the notes were seen only in short summaries of the sources. The notes mark each one.

## A side finding

The last part of Panel's own instructions to FRIDAY does not arrive. It is cut after about 4,100 characters, in the middle of the line about knobs. Everything after that line is lost. It is a small fix and separate from this work.

## The research notes

All in [docs/research_notes/Combining design references with AI](../research_notes/Combining%20design%20references%20with%20AI/):

- [panel_today.md](../research_notes/Combining%20design%20references%20with%20AI/panel_today.md): what FRIDAY is given and does today
- [why_models_fail.md](../research_notes/Combining%20design%20references%20with%20AI/why_models_fail.md)
- [hci_design_cognition.md](../research_notes/Combining%20design%20references%20with%20AI/hci_design_cognition.md): design research
- [practitioner_workflows.md](../research_notes/Combining%20design%20references%20with%20AI/practitioner_workflows.md): what designers do
- [orchestration_techniques.md](../research_notes/Combining%20design%20references%20with%20AI/orchestration_techniques.md): workflow methods
- [image_models_as_blender.md](../research_notes/Combining%20design%20references%20with%20AI/image_models_as_blender.md)
