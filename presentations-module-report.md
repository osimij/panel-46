# Claude presentation editor feature audit and build specification

Second-pass edition. Observed on 11 November 2026 in Chrome on macOS, including a 390 × 844 responsive viewport. Project: presentations-module.

**Use this edition instead of the initial report.** Deliverables are Markdown and PDF. The Markdown is the preferred input for an implementation LLM; the PDF provides a readable visual reference. This edition integrates the second-pass findings into the feature descriptions, rather than leaving contradictory first-pass status labels.

This specification describes the presentation editor exposed by the supplied Claude artifact. It covers the editor shell, slide layouts, nested content, formatting, presentation, notes, export, and the surrounding artifact controls. It is intended for a person or LLM building a comparable presentation module.

The central design is a slide canvas with two complementary layout models: content arranged in nested rows and columns, and objects placed on the canvas. Selecting an object changes the properties panel. Presenting uses a separate audience view and can open a synchronized speaker window. The module should preserve those distinctions in its behavior and data model. This report documents discovered features, not the private application source or a guarantee that undiscovered features do not exist.

## How to interpret the evidence

**Tested** means an action was performed and its resulting state was observed. **Applied** means a setting was accepted and its displayed value updated; it does not by itself certify pixel-level correctness. **Inspected** means a control, menu, or explanatory label was examined, but its full end-to-end behavior was not exercised. **Blocked** means an attempted action could not be verified in this session. **Proposed** identifies implementation guidance, not a claim about Claude's internals.

The original deck contains eight slides. The first pass used temporary content in the original when the duplicate failed to start. The second pass successfully used a private audit copy, grew it to 19 slides, exercised all ten presets and all ten shape choices, and verified previously missing media, grouping, grid, comments, AI editing, mobile layout, keyboard playback, and export behaviors. All five download choices generated files. The closing coverage ledger distinguishes end-to-end tests, applied settings, inspected controls, and actual blockers. This is a comprehensive inventory of the discovered surface, not a claim that every parameter combination, external integration, or failure scenario was proven.

Sources: [original presentation](https://claude.ai/artifact/NCZNS6G1o5BUX9tgHM5Zrm#slide-d336bdf4946f) and [audit copy](https://claude.ai/artifact/LQ9MDMPgfHNCHc6CsM8eb1). Product observations came from computer use of these surfaces and associated chats, plus static inspection and rendering of files downloaded through the UI. No private application source or hidden application state was used. Proposed implementation choices appear in their own section.

## Workspace and visual structure

### Main editor

The desktop screen has a thin artifact header across the top. The left side holds the deck name and its dropdown. Sharing, chat, and close controls sit on the right. The working area below uses a very dark charcoal background, contrasting with the slide itself.

In single-slide view, a vertical filmstrip runs down the left. It has an Add slide button and View dropdown at the top, numbered thumbnails below, and a blue outline around the selected slide. The first slide carries a small image-style badge when it is the deck thumbnail. The slide filmstrip scrolls independently when the deck is longer than the screen.

The active slide is centered in the remaining canvas area. A compact floating control strip near the upper right contains Download, Present, Properties, and the zoom percentage. A second floating toolbar near the bottom contains Text, Image or video, Table, Shapes, Comment, and, in the integrated host, Ask Claude.

The optional properties panel occupies the right side. Its observed width was 336 pixels, with a resize separator. Opening it reduced the available canvas area and changed fit zoom. It scrolls independently and divides settings with subtle horizontal separators. Small labels sit on the left; dark rounded inputs and menus occupy the right. Segmented icon controls handle alignment and borders. Active controls and selections use blue.

At the observed 1512 by 805 browser viewport, the filmstrip was approximately 191 pixels wide, the top header about 44 pixels high, and the properties panel began near x=1176. These are screenshot measurements, not proven fixed design tokens. The slide rendered at 960 by 540 pixels at 50% zoom, consistent with a 1920 by 1080 design coordinate system and a 16:9 slide. The second-pass HTML export explicitly declared canvas-width 1920 and canvas-height 1080, confirming these dimensions for this deck.

### Narrow-screen layout

At 390 × 844, the editor adapts substantially. Add slide and View move into a compact upper-left toolbar; Download, Present, Properties, and Zoom remain at the upper right. Text labels shrink to icons where appropriate. Fit zoom fell to about 15%. The slide stays centered above the insertion toolbar.

Properties becomes a bottom sheet instead of a right sidebar, with a Close panel button and Resize sheet separator; its observed height was 384 pixels. Closing it restored the slide-navigation list and notes controls. The open sheet hides those supporting regions to give the canvas room. The host title truncates and host controls become compact icons. This was a narrow Chrome viewport test, not a physical touchscreen test; pinch, touch dragging, device keyboard, and mobile browser differences remain outside the evidence.

### Interaction states

A selected object receives a thin blue outline and square resize handles. A text object can enter inline editing. Escape leaves text editing or dismisses an open menu; escaping object selection returns to slide-level properties. Some controls reveal additional fields only after a feature is enabled. For example, a solid border reveals color and width, and adding a shadow opens a shadow settings popover.

Menus distinguish selected values, disabled actions, and submenus. Font search has a focused search field and a Clear button. Color selection uses Theme and Custom tabs. Dialogs, such as New slide, dim the editor behind them.

The accessibility representation includes meaningful object names such as “Group, Column of 4,” “Table, 3 rows, 3 columns,” and a child's position among siblings. Recreating these labels would make nested content easier to navigate with assistive technology and automation.

### Visual language of the sample deck

The Butterflies content uses warm paper backgrounds, dark green-black ink, muted gray-green body text, thin rules, restrained orange accents, and fine line drawings. The associated creation chat names Cormorant Garamond for headings and Public Sans for body text; both appeared in the editor's font fields.

Do not confuse this particular deck theme with the editor's universal interface. A new module should support different deck themes while keeping the editor chrome consistent.

| Theme color | Observed use or role |
| --- | --- |
| #1E2620 | Dark ink and dark slide background |
| #59605A | Muted supporting text palette color |
| #A9531A | Dark orange accent palette color |
| #CFC7B8 | Fine rules and borders |
| #F5F1EA | Original slide 2 background |
| #B9B3A6 | Muted neutral palette color |
| #EDE7DC | Warm paper variant |
| #EEE8DD | Warm paper variant |
| #E08A4A | Orange palette color |
| #D9823F | Orange palette color |

The original theme picker showed all ten values; later test content introduced additional colors into the displayed palette. Their full semantic naming system was not exposed; do not invent named tokens as if they were observed product labels.

## Slide navigation and management

### Filmstrip and selection

The Slides list shows an ordinal and a live miniature of each slide. Selecting a slide updates the main canvas, accessible title, and URL fragment. Fragments have a stable-looking slide identifier, such as `#slide-d336bdf4946f`, rather than the slide number. Duplicating a slide generated a new identifier. Ordinals changed when slides were inserted.

The canvas heading announces “Slide N of total: title.” Editing the slide's heading changed its filmstrip name, indicating that the label can derive from content rather than a separate slide-name field.

### Slide context menu

Right-clicking a thumbnail opens these commands:

| Command | Behavior and evidence |
| --- | --- |
| Duplicate slide | Tested. Inserts a copy immediately after the source, selects it, increments total, and assigns a new slide identifier. |
| Copy slide | Invoked: “Slide copied” toast confirmed the copy command. Cross-deck paste remains unverified. Keyboard paste in automation used the staged external clipboard, so it is not a valid failure test of the application clipboard. |
| Copy link to slide | Invoked and “Link copied.” appeared. Actual pasted link contents were not independently checked. Slide navigation itself was verified to update the slide-specific URL. |
| Skip slide | Tested. Marks the thumbnail skipped and exposes Unskip slide. In the second pass the editor held 19 slides while Present, notes-enabled PDF, basic-font PPTX, and HTML held 18. The skipped closing heading was absent from those exported files. Print exclusion is stated by the UI but was not separately executed. |
| Set as thumbnail | Tested on the closing preset. The thumbnail badge moved from slide 1 to slide 12; a toast confirmed the change. The command becomes disabled for the current thumbnail. Skipping that slide did not remove its thumbnail status. |
| Add slide after | Inspected. Explicit insertion-position command. |
| Move up | Tested. Closing slide moved from ordinal 12 to 11 and remained selected. |
| Move down | Tested. The same slide returned from ordinal 11 to 12. |
| Delete slide | Tested. Removes the selected slide, updates numbering and total, and selects the next slide. Both temporary slides were removed and the original eight-slide list was verified. |

Skipped slides remain visible and editable in the editor. Playback and three whole-deck export exclusions were verified. The AI also successfully edited a skipped slide without unskipping it.

### New slide dialog

Add slide opens a centered, scrollable dialog with a two-column grid of visual previews and a Close button. Choosing a preset immediately creates a slide after the current slide and selects it.

| Preset | Generated structure verified by creation |
| --- | --- |
| Blank | Empty slide, used for media and shape tests. |
| Title | Column group of two: H1 “Presentation title” and “A one-line subtitle for the presentation.” |
| Section | Column group of two: “SECTION 01” and H1 “Section title”. |
| Title + body | H2 “Heading” and separate body text: “Body copy goes here. Double-click any text to edit it in place.” |
| Bullets | H2 “Key points” and a column of three separate text nodes, each beginning with a bullet character. Do not assume this preset uses the semantic list control. |
| Two columns | H2 “Compare”, two column groups, H3 “Left” / “Right”, and body copy in each. |
| Table | H2 “Summary”, a 4-row × 3-column table, with Item / Status / Owner headers. This differs from the toolbar's 3 × 3 default. |
| Quote | H2 “A memorable line worth a whole slide.” and “— Attribution”. |
| Image + caption | Empty image placeholder and separate caption text “Caption for the image.” The placeholder has no uploaded source. |
| Closing | H1 “Thank you”, a single top-level object. |

All ten presets were created successfully in the second pass. Their objects were selectable and editable.

The tested Two columns slide inherited the preceding test slide's paper background, while its transition was None. This is a specific observation, not a guarantee that every property is inherited by every preset.

## View modes and zoom

The View dropdown contains One slide, Grid, Slide thumbnails, and Speaker notes. The first two are view choices; the latter two are visibility controls.

**Single slide.** Shows one editable canvas. The filmstrip and notes can be shown or hidden. Properties can be toggled separately.

**Grid.** Tested. Replaces the filmstrip with miniature editable slides arranged in sections across the dark workspace. Properties was disabled in the overview. Fit all slides produced approximately 6–7% zoom for the test deck. Each section has a description and a selection checkbox; each slide has its own selection checkbox. Add a slide here and Add a section here appear between items. With notes enabled, each slide exposes an editable notes field below its miniature.

The original deck had four sections, describing its introduction, metamorphosis, senses and migration, and conservation. Adding a section produced “Section 5” and a “Describe Section 5” field. Typing a description and pressing Return committed it. Remove section removed the empty test section. Removing a populated section was tested in the second pass: its slide remained in the deck and rejoined the preceding section; the section boundary disappeared. This is section-boundary removal, not deletion of its contents. Selecting a section disabled Text, Image or video, Table, and Shapes insertion.

Grid slide context menus additionally expose Move to a new section, Move left, and Move right. Move to a new section was tested on the closing slide within a larger section: it isolated that slide and also created a separate section for the slides that followed it. Two new default section labels appeared. Move left/right were inspected; up/down reordering was exercised in the filmstrip. Double-clicking a slide opened it for larger editing, but Grid remained selected in View. Explicitly choosing One slide restored the filmstrip. A builder should model overview and temporary slide focus separately rather than assume every double-click changes the saved view mode.

**Speaker notes.** Tested. Reveals an editable text area associated with the current slide. Notes do not become visible slide content. A note entered in the editor appeared in the separate speaker window.

**Zoom menu.** Contains Zoom in, Zoom out, Fit all slides, 25%, 50%, 75%, 100%, 150%, 200%, Undo, and Redo. The menu's fit wording was observed after grid navigation. Fit all slides and the 50% preset were tested. Fit zoom also changed when the properties panel opened or the available editor width changed. Do not assume the menu label is identical in every state.

**Undo and redo.** Tested with Command-Z and Command-Shift-Z on macOS: an inserted table disappeared and then returned. The zoom menu also exposes these actions and disables Redo when there is no redo entry. The full persistence and history limit were not established.

## Content insertion and object selection

### Text

The Text button enters a one-shot placement mode and shows an active state. Clicking the canvas creates a text object at the clicked location and puts it into editing. The placement toggle returns to off. The initial content was “Text,” using the theme's Body style, Public Sans at 28 design pixels and line height 1.5. Typing replaced the placeholder in the test. Escape ended editing.

### Table

The Table button directly inserts a selected three-column, three-row table with the Header row setting on. The header cells initially read “Column.” In the tested free-placement case, it overlapped existing content rather than automatically finding an empty region. A build should decide deliberately whether to match this behavior or improve placement.

### Image or video

The shared Image or video button and replacement/upload buttons did not expose a usable file picker in repeated attempts, including a fresh standalone tab and the empty-image Upload image button. File-chooser waits timed out. This is a concrete automation/environment blocker; it is not proof that a human cannot upload with the picker.

**Clipboard upload works.** A generated PNG pasted into the slide produced an “Uploading image” placeholder and then an image named clipboard.png. A three-second generated MP4 similarly produced “Uploading video” and a playable clipboard.mp4. The input's exposed accept attributes advertise image/* and video/mp4, video/webm, video/quicktime, .mov. PNG and MP4 ingestion were actually verified; other advertised formats, upload limits, errors, and multi-file selection were not.

**Raster images.** The PNG exposed Cover and Contain, both enabled, with Cover initially selected. Contain applied successfully. Alternative text was edited, persisted, and became the object's accessible label and the slide's content-derived filmstrip title. Remove image clears the source but retains the object and its alt text, showing Image: none and Upload image…. Undo restored the source. This differs from deleting the object.

Double-clicking the image enters crop mode, with eight handles: four edges and four corners. Dragging the left edge and pressing Enter committed the crop, visibly narrowed the image, announced “Cropped.”, and changed fit to Cover. Escape dismissed crop mode in a later test. A crop hint also states that arrow keys move the picture and plus/minus zoom it; those keyboard adjustments were inspected, not individually exercised.

**SVG images.** The cover SVG's contextual toolbar offered Replace the image, Crop, Corner radius, Comment, Properties. Crop and Cover were disabled for that SVG; Contain was selected. These are type-specific restrictions, not global limitations on raster images.

**Video.** Selecting the MP4 exposes source replacement, Remove video, Cover/Contain, Time (seconds input and seek slider), Play/Pause, Start, Delay, Sound, Alt text, and common appearance/effects. The contextual toolbar adds Pause video, Replace the video…, Crop, Corner radius, Comment, Properties. Video cropping was exposed but not separately exercised.

| Video control | Verified behavior |
| --- | --- |
| Time | Setting 1 second updated the slider to 1; editor playback updates the time display. |
| Play/Pause | Changed playback state; the generated motion pattern visibly advanced. |
| Restart | Reset to 0 and began playback. |
| Start: With slide | Selected by default; enables Delay in seconds. A 0.5-second delay was stored. Exact delay accuracy was not timed. |
| Start: On click | Disables Delay with explanation that click-started video has no delay. Present initially showed Play; clicking changed to Pause and displayed moving frames. |
| Sound | Switch changed from on to off and persisted. The fixture had no audio, so audible playback was not validated. Unmute becomes disabled after the no-audio state is detected. |
| Alt text | Edited to “Three-second moving test pattern”, reflected in object and playback labels. |

On-canvas video controls include Restart, Play/Pause, and Mute/Unmute. In the editor, the three-second test repeatedly returned to the start while selected; do not infer a user-configurable looping option because none was exposed. Static exports are discussed separately: the tested PPTX/HTML did not retain a playable video asset.

### Shapes

The menu contains Rectangle, Rounded rectangle, Ellipse, Diamond (decision), Arrow right, Arrow left, Arrow up, Arrow down, Line, and Connector.

All ten shape choices were inserted successfully on a blank test slide, initially overlapping near the center. Arrow right had an observed size of 300 × 300 design pixels and fill #9AA0A6. Rounded rectangle is represented as a Rectangle node with radius 24 by default. Shapes expose common appearance and applicable effects, with type-specific restrictions.

**Line** has a Thickness field, default 8, successfully changed to 16. Its tested color was #1A1A1A. Dashed/dotted appearance controls were disabled for that line.

**Connector** is distinct from Line. It exposes the following controls:

| Setting | Choices and observations |
| --- | --- |
| Direction | Down-right, Down-left, Up-right, Up-left. Changing to Down-left worked; endpoint dragging subsequently changed the displayed direction. |
| Start / End markers | None, Open, Filled. Defaults were Start None and End Filled; both were changed to Open. |
| Route | Straight; Elbow; Bend: across, then down; Bend: down, then across. Elbow was applied and visibly produced a right-angle route. |
| Line style | Solid or Dashed; None and Dotted disabled in the common border control. Dashed applied. |
| Color / Width | Default #9AA0A6 and width 2; width 6 applied. |
| Endpoints | Dragging one endpoint changed its geometry, with the elbow path visible on the canvas. Persistent attachment to a moving object was not demonstrated. |

Connector routes and markers should be modeled separately from a generic arrow shape. All menu choices were inventoried; not every direction/route/marker combination was rendered.

### Dragging and structure

Dragging the inserted arrow into the statistics area changed the document hierarchy: it became a child of an existing column group, and the group's child count increased. The slide's top-level object count decreased. This is stronger evidence than a purely visual movement: drag/drop can reparent content into layout groups.

A click on a large nested group can hit a deeper child under the pointer. Selection, nested hit testing, and group editing must therefore be designed together. Do not model every element as an independent x/y rectangle and expect equivalent behavior.

### Object context menu

Right-clicking an object exposes Cut, Copy, Copy link to slide, Paste, Duplicate, Copy properties, Paste properties, Bring to front, Send to back, Group, Ungroup, Scale…, and Delete.

Availability depends on selection, parent structure, and clipboard state. The second pass verified these operations on placed objects:

- Duplicate added a line and retained its thickness.
- Cut removed an image; context-menu Paste reinserted it, preserving its alternative text and source. Copy/Paste also reproduced a line with an offset.
- Shift-click selected two objects. The menu changed to “Actions for 2 objects”; Group enabled while Copy/Paste properties disabled.
- Group created an Overlay with Layered layout. Ungroup restored the children and selected both.
- Send to back moved the connector from last to first in sibling order. Bring to front moved a rectangle to last/front.
- Copy properties and Paste properties transferred radius 36, opacity 0.4, and a dashed border to another rectangle, with confirmation toasts.

Keyboard paste in this automation environment used the separately staged browser clipboard, which sometimes contained a media or text fixture rather than the application's internal object buffer. Context-menu paste was therefore used to verify object transfer. Cross-deck and external-app clipboard interoperability remain unverified. Shift+F10 on a focused object exposed its exact context menu and made nested parent selection more reliable than clicking through overlapping children.

Scale… opens a small formatting toolbar with a percentage field, initially 100%, and Done (Return) and Cancel (Esc). The helper text states that Return keeps the change and Escape cancels. Cancel was tested and announced “Scale cancelled.” A layered group of two lines was scaled to 150% and committed. The confirmation read “Scaled to 150%.” After ungrouping, a line thickness had changed from 16 to 24, proving that scaling included style dimensions, not only the outer bounds.

## Slide properties

With the slide selected, the panel contains Transition and Appearance > Background.

Transition choices are None, Fade, Push, and Magic move. The interface explains that the setting controls how this slide leaves for the next one in Present. Changing Fade to Push on a temporary slide updated the selected value and triggered saving. Magic move was selected and presentation navigation was exercised. Selecting it revealed an important explanation: it animates shared elements into their next-slide positions; duplicating a slide keeps the element identities used to pair them, after which the user can move or resize them. Preserve identity across slide duplication for this behavior. No duration/easing controls were exposed. Exact frame-by-frame animation, matching edge cases, and transitions in exports were not measured.

The background uses the shared color picker. Changing its custom hex value from #F5F1EA to #EDE7DC updated the slide and its property value.

## Text formatting

### Reusable styles and overrides

The observed text-style menu offered Heading 2 (88), Heading 3 (40), Lead (160), Eyebrow (24), Body (28), and Caption (24). These values belong to this deck's theme. The table's Cell role menu additionally listed Display and Heading 1.

Choosing Heading 3 for an existing heading changed its size from 88 to 40, weight from Regular to Medium, and line height from 1.1 to 1.2. A manual font change then made the style label “Custom,” with a summary such as “Inter · 40.” Reset controls appeared beside overridden properties. The UI sometimes identifies inherited values with “From Heading 3” or “From Body.”

A comparable module should retain the difference between inherited style values and local overrides. Flattening everything into independent values loses the reset behavior.

### Fonts

The font menu is searchable. Entering “Inter” reduced the list to Inter and revealed a Clear button; choosing it changed the selected font.

Observed entries were Cormorant Garamond, Public Sans, Sans-serif, Serif, Monospace, Helvetica, Arial, Bebas Neue, Caveat, Courier New, DM Sans, Garamond, Georgia, Inter, Lato, Lora, Manrope, Merriweather, Montserrat, Nunito, Open Sans, Playfair Display, Poppins, Raleway, Roboto, Space Grotesk, Tahoma, Times New Roman, Trebuchet MS, Verdana, and Work Sans. This is the observed menu, not a guarantee of the product's complete font catalog.

The weight menu for Inter listed Thin, Extra light, Light, Regular, Medium, Semibold, Bold, Extra bold, and Black, with italic variants; regular italic appeared as “Italic.” Bold was applied successfully.

### Core fields

| Control | Meaning and observed interface |
| --- | --- |
| Size | Numeric font size in design pixels. |
| Line height | Numeric multiplier; examples 1.1, 1.2, 1.5. |
| Letter spacing | Numeric spacing in pixels. |
| Color | Shared color picker; supports theme default and explicit override. |
| Align | Left, Center, Right, Justify segmented controls. |
| Resize | Shrink text to fit; Don’t resize text; Grow box to fit text. |
| Padding | One value or separate top, right, bottom, left values. |

The Resize helper explains that overflow can shrink text to fit its box, retain text size, or keep text size and prevent a column from squeezing the box. This is a layout behavior, not simply a font-size toggle. Don’t resize text and Grow box to fit text were both applied in the second pass. A controlled overflowing-text comparison was not performed, so these modes are verified as applied settings with the UI-described behavior, not as a full layout stress test.

### Optional text controls

Add to Text reveals Emphasis, List, and Case. Once added, the setting appears in the panel rather than remaining only in a dropdown.

Emphasis provides Underline and Strikethrough. Underline and Strikethrough were tested. List provides None, Bulleted list, and Numbered list. Enabling both bulleted and numbered lists was tested and automatically set left padding to 40 while other sides remained zero. Numbered text became a semantic list with a “1.” marker. Unequal padding forced the per-side fields to remain visible. Case provides None, Uppercase, Lowercase, and Capitalize. Uppercase, Lowercase, and Capitalize changed the displayed text. Capitalize changed “Body copy goes here” to “Body Copy Goes Here”. The object label continued to represent underlying text.

### Advanced typography

Advanced exposes decoration line style (Default, Solid, Double, Dotted, Dashed, Wavy), line color, numeral style (Default, Normal, Tabular numbers), and text stroke width/color. Decoration fields are disabled when no relevant decoration is active and enabled after adding underline/strikethrough. Wavy line style, Tabular numbers, and stroke width 1 were applied successfully. The numeral test verified the setting, not a font-by-font optical comparison.

For tables and some non-text selections, advanced typography is more generic: font size, numeric font weight, Normal/Italic, line height, letter spacing, case, decoration, family, numerals, color, and stroke. Do not assume all object types show the same simplified text panel.

## Layout and sizing

Groups expose width and height values and a mode for each dimension: Hug, Fixed, or Fill. The interface explains that Hug sizes to content, Fixed uses an exact size, and Fill takes the space provided by the parent group.

Add to Size offers Min width, Max width, Min height, and Max height. These optional constraints were all added and set to 300, 1000, 200, and 700 respectively. Reset buttons appeared. Once all four were added, Add to Size disappeared because there were no remaining optional fields.

The Layout menu showed Stack selected, with Layered and Grid disabled. A tooltip explicitly stated that converting between Stack, Grid, and Layered was not available yet. Treat these disabled choices as visible future or context-specific capabilities, not working conversion commands.

The existing Grid of 4 was successfully selected in the second pass. Its parent has one button per column track. Clicking a track cycles **1fr → 240px → auto → 1fr**, described respectively as flexible share, fixed 240 pixels, and content-sized. Add flexible column created a fifth track; Remove last column restored four. Gap changed from 48 to 24. The grid also exposes padding, appearance, optional size constraints, overflow, and transforms.

Grid children expose Column span and Row span, with a helper describing row-major auto-flow. Changing both from 1 to 2 expanded a child's computed size from 398 × 361 to 820 × 659 in the modified specimen. The child retained its own stack controls. Enabling Distribute disabled the start/center/end Justify buttons; Align center still applied. These are nested layout controls, not a single flat grid editor.

A stack provides Horizontal or Vertical direction, Wrap, justification at start/center/end, alignment at start/center/end, Distribute, Gap, and padding. Changing a two-child row to Vertical changed it to a column and increased its displayed height from 173 to 253. Wrap became disabled in the vertical direction.

Advanced sizing includes:

| Field | Meaning given by the interface |
| --- | --- |
| Grow | Share of leftover space along the group direction; Grow 1 and Basis 0 on siblings gives equal columns. |
| Shrink | How readily a child gives up space when the group overflows; CSS default is 1. |
| Basis | Starting main-axis size in design pixels before grow/shrink; clear means content size. |
| Aspect | Width divided by height, such as 1.78 for 16:9; clear means unconstrained. |
| Overflow | Visible or Hidden for applicable groups. |

These controls closely resemble flex-style layout, but the product's internal implementation was not inspected. A table's Aspect field was disabled with the explanation that a table is as tall as its rows. On a grid child, Grow 1, Shrink 0, Basis 0, and Aspect 1.78 applied; its computed height became 461 for width 820. Overflow Hidden also applied. These tests confirm field operation in that layout context, not every constraint interaction.

## Shared appearance controls

Background, opacity, borders, radius, and effects recur across object types. The exact subset depends on the selection. A shape fill was exposed under Background. Remove background was disabled in some default states but enabled for a styled rectangle; availability is contextual.

Opacity has both a numeric value and slider; the default was 1. Radius has a combined value and a toggle for independent top-left, top-right, bottom-left, and bottom-right corners. Borders offer None, Solid, Dashed, and Dotted. Selecting Solid revealed border color and numeric width. Width can be expanded into four sides. Existing groups demonstrated a top border of 1 with zero on the other sides.

Reset buttons appear when a value is overridden. Independent corner radii were applied: one corner changed from 36 to 10 while the others stayed 36. The combined value became blank and collapsing the independent controls was disabled. Some per-side controls cannot collapse when their values differ. A builder should preserve that state and explain it through disabled controls or useful labels.

### Color picker

Theme lists swatches and hex values, with the current color checked. Custom exposes a saturation/brightness control, hue slider, alpha slider, Pick color from screen, Hex color input, and Alpha percent input. The custom hex change and alpha percent 50 were tested; the button summary became “#9AA0A6 50%” and the alpha slider read 50. Pick color from screen was invoked but its native sampling interaction could not be reliably observed; a later fill value changed to black with 50% alpha, so exact sampled-pixel accuracy is not claimed. Theme search was exposed in the second pass. The palette also included newly used object colors, suggesting that its shown colors are not a fixed universal ten-color list.

The same picker pattern appears for slide background, text color, object background, border color, shadow color, and stroke color. “None,” “Theme default,” and “unset” are distinct states shown in different contexts; they should not be collapsed into a single black or transparent value in an implementation.

## Effects and transforms

Add to Effects lists Drop shadow, Inner shadow, Layer blur, and Background blur. Inner shadow was disabled for a text selection but enabled for a rectangle in the second pass. Adding Drop shadow opened a popover with horizontal offset, vertical offset, blur in pixels, and color/alpha. Defaults observed were x=0, y=1, blur=3, black at 20% alpha. A Remove shadow button appeared. Inner shadow defaults were x=0, y=1, blur=2, spread=0, black at 20%. Setting x=5, y=6, blur=8, spread=3 updated its summary; Remove inner shadow removed it. Text shadow was also exposed for some selections.

Advanced Filter opens numeric controls for Blur, Brightness, Contrast, Saturate, Grayscale, Sepia, Invert, and Hue. Defaults were 0 blur, 1 brightness/contrast/saturate, and 0 for the remaining adjustments. Opening the previously absent filter initialized a neutral filter and made Remove filter available. The basic Layer blur field appeared as part of that state. The second pass applied Blur 4, Brightness 1.1, Contrast 1.2, Saturate 0.8, Grayscale 0.2, Sepia 0.1, Invert 0.1, Hue 20; the summary listed every value and Layer blur read 4. Remove filter returned it to None and removed the basic Layer blur field.

Backdrop was inspected and applied separately: it exposes the same eight named fields as Filter. Values 8, 1.2, 0.8, 0.5, 0.2, 0.3, 0.1, 25 respectively were accepted and summarized. The basic Background blur read 8. Treat backdrop filtering separately from filtering the object itself.

Transform exposes Move X, Move Y, Scale, Rotate, Skew X, and Skew Y. Defaults were zero movement/rotation/skew and scale 1. Opening it initialized a neutral transform and enabled its removal. Move X 20, Move Y 10, Scale 0.9, Rotate 5, Skew X 3, and Skew Y 2 were applied together on a group, then removed using Remove transform. These controls are distinct from changing the object's structural placement in a row or column.

Blend mode offers Default, Normal, Multiply, Screen, Overlay, Darken, and Lighten. Every listed blend mode was selected successfully and its property summary updated. Pixel-by-pixel blending math was not validated.

## Table editing

Selecting a table reveals Columns, Rows, Resize, Cell role, per-column widths, and Header row. Default insertion was 3 by 3 with a header. Increasing Rows from 3 to 4 updated the table's accessible dimensions. Numeric inputs can reveal increase/decrease controls while focused.

A cell enters text editing and is labeled by row and column. Editing the first header cell changed its text to “Test header.” Tab moved focus to the next cell. In the second pass, Tab traversed columns, wrapped to the next row, and at the final cell appended a new fifth row and focused Row 5, column 1. ArrowDown in an empty cell did not move to another cell. Pasting tab/newline-separated text into a cell kept the whole block inside that cell; it did not distribute a 2 × 2 range. This is observed clipboard behavior, not spreadsheet paste parity.

Cell role choices are Default (body), Display, Heading 1, Heading 2, Heading 3, Lead, Eyebrow, Body, and Caption. Columns increased from 3 to 4, Header row toggled off/on, and Caption applied as the cell role. Column widths can remain automatic or accept numeric values; entering 2 for the first column stored 2 and revealed 25 for the other three columns. The input did not state a unit, so do not assume pixels or proportional weights without a deliberate implementation decision. Reducing Rows/Columns is described by the contextual toolbar as dropping bottom/rightmost text, undoably. Tables also expose the common appearance and advanced typography/effects controls described above.

When properties is closed, the Table formatting toolbar provides Rows, Columns, Comment, and Properties. While editing a cell, Table cell formatting provides Text color, Column alignment (observed Left), Comment, and Properties. The alignment dropdown was exposed but not exhaustively exercised.

No table-specific merge, split, formula, sort, chart, or data-import command was observed. That is not proof that such features never exist; they should remain outside a faithful first implementation unless independently verified or explicitly added as enhancements.

## Presentation and speaker notes

### Audience view

Present offers Present and Present with speaker notes. The presentation begins on the current slide, not necessarily slide 1. The audience view hides editing chrome inside the slide area and scales the slide against a dark/black backdrop. A small bottom-centered pill contains Previous, the current/total count, Next, speaker-window toggle, Full screen (F), and Exit (Esc).

Next was tested and advanced from slide 4 to slide 5. Exiting returned to editing. Full screen showed “Full screen isn’t available here” and was disabled in both the integrated and standalone artifact routes in this environment. It is not a verified working feature here.

The second pass verified Right and Left keys after focusing the Slide show region: the counter changed 2/18 → 3/18 → 2/18. Escape exited. At 18/18, Next remained enabled but did not advance or wrap after the view settled. Exiting after this boundary test returned the editor to slide 1; do not promise universal restoration to the last audience slide. The UI advertises F and Esc, but full screen is disabled here.

### Speaker window

Present with speaker notes opens a separate browser window/tab, observed at about:blank. It contains a large current-slide preview on the left, smaller previous and next previews below, and a notes pane on the right. Top controls include elapsed time, Pause/Resume, Reset, slide count, and Previous/Next.

Pause changed the timer label to paused. Reset set the elapsed time to 0:00 while remaining paused. Resume restarted it. Navigating from the speaker window updated the main presentation after a short asynchronous delay.

Previous and next previews are clickable controls labeled “Go to previous slide” and “Go to next slide.” Their displayed captions include the neighboring slide title. The audience end-of-deck behavior was tested as described above; speaker-window end boundaries and physical multi-monitor placement were not separately tested.

An Edit switch changes the notes pane from a reading region to a Notes textbox. Its placeholder states “Speaker notes. Never shown on the slide.” A note entered in the editor appeared here. Editing it in the speaker window and leaving edit mode showed the new text and triggered saving in the main artifact. This is a two-way notes editing workflow.

## Export and downloads

The Download menu offers five choices:

| Export | Scope and evidence |
| --- | --- |
| PDF (.pdf) | Tested through saved file. Opens Download as PDF with Good, Better, Best image quality; Best selected by default; Include speaker notes unchecked; Cancel and Download. The saved 1.3 MB file had eight 960 by 540 point pages and extractable text. The cover was visually checked. The second pass exported an 18-page notes-enabled PDF from 19 slides with one skipped. The test note appeared below a reduced slide preview on page 2, and the skipped heading was absent. All eight pages of the earlier PDF were inspected in a comparison contact sheet. |
| Web page (.html) | Tested through saved file, approximately 744.4 kB. The second-pass HTML contained 18 .slide sections, embedded image data, the test note, and no skipped heading. Browser policy blocked opening a local file URL; playback was not run. Static inspection found remote Google Fonts CSS references and no video tags, so offline font parity and playable video must not be promised. |
| Current slide as an image (.png) | Tested through saved file: “Butterflies - slide 3.png,” approximately 340.7 kB, 3840 by 2160 pixels. It corresponded to the selected slide. Full-resolution appearance was visually checked. |
| PowerPoint, current fonts (.pptx) | Tested through saved file, approximately 276.8 kB. The package contained eight slide parts, eight notes-slide parts, native text elements, and embedded-font parts. Rendered all eight slides with LibreOffice for comparison to the PDF. Layout and illustrations remained recognizable, but font weight/metrics differed; this is not a Microsoft PowerPoint compatibility certification. |
| PowerPoint, basic fonts (.pptx) | Tested through saved file, approximately 236 kB. Export notes explained Public Sans → Arial and Cormorant Garamond → Georgia. The Details button opened a dialog listing both substitutions, with Close and Done. All eight slides were rendered with LibreOffice; typography and some wrapping differed from the PDF. A second 18-slide export omitted the skipped heading and included the test note in notesSlide2.xml. |

Every completed export passed through a host confirmation reading “Let this artifact download a file?” with filename, size, Cancel, and Save file. Save file then returned to the editor and displayed a saved notification. The PDF flow also offered “How was your export?” with Good export, Bad export, and Dismiss. Feedback was dismissed without submitting a rating.

Current-font PowerPoint export warned that Cormorant Garamond could not be downloaded from Google Fonts, so it was not embedded and would be substituted on a computer without that font. This warning is an important part of the product behavior: “current fonts” does not guarantee embedding succeeds. Basic-font export deliberately substitutes common fonts and explains the changes.

The second-pass basic-font PPTX had 18 slide parts, 18 notes parts, the expected note, and no skipped closing heading. Its media directory contained PNG/JPEG assets and **no video asset**. The video was represented as a static preview in the tested PPTX; the HTML similarly contained no video tag. PDF naturally rendered a still image. This is an important export limitation for a builder.

The current-font/basic-font comparison rendered all eight first-pass slides through LibreOffice. Structure, colors, and illustrations survived, while headings, numeral weight, line wrapping, and some text positions differed. The existing font warning explains part of the discrepancy, but the renderer may also contribute. Do not call these formats pixel-identical or claim Microsoft PowerPoint validation. The earlier exported statistics slide contained a leftover test table; it was removed from the original during the final cleanup, so those export specimens are evidence, not clean copies of the user's deck.

Only PNG explicitly says Current slide. Whole-deck export honors skipping in the tested PDF, basic PPTX, and HTML. The audit copy's host title was renamed, but downloads were still named Butterflies; host artifact name and exported deck title are not necessarily the same field.

Export temporarily disables Download and shows “Exporting…”. Early attempts were interrupted; subsequent retries completed. A comparable module should preserve progress, host save confirmation, success notifications, and readable font warnings, and should handle failures without losing edits.

## Comments and Claude assistance

### Comment placement and threads

The integrated editor has a Comment placement control; the standalone artifact uses the host comment toggle. Activating it exposes anchors for the whole slide and individual objects. Choosing a heading anchor opened a composer with a breadcrumb such as `Slide 12 › Display "Thank you"`, an Add a comment textbox, and Send to Claude. The checkbox was on in one first-pass integrated route and off in the second-pass standalone route; preserve the actual context rather than assuming one universal default.

With Send to Claude off, Add comment created a real thread on the private audit copy. A pin appeared on the object, the filmstrip showed one open thread, and the host counted open comment messages. Adding a reply changed the host count to 2 open comments while the slide still showed one thread.

Opening the thread shows author, relative time (with full timestamp available), comment text, Reply field, Resolve, Comment options, Close, and reply action menus. The following were tested:

1. Create a comment on the closing heading.
2. Add a reply in the same thread.
3. Edit the original via Comment options → Edit; the edit form has Cancel and Save. Saving changed the text and added an edited label.
4. Resolve the thread. The open-comment state cleared and the panel offered Show 1 resolved.
5. Enable Show resolved in filters; the thread reappeared with a resolved indicator.
6. Reopen via Comment options → Reopen; the open-thread badge and count returned.

While submitting, relevant actions briefly become disabled. An immediately following click can be ignored until saving finishes; a builder should make pending state explicit. Options also expose Delete thread, and reply actions exist. Thread deletion was not executed because no recoverable deletion flow was established. No other person was invited or notified intentionally.

### Comments panel

More comment options → Show all comments opens the All comments panel with Filter comments and Close comments. Filters are This page, All pages, and Show resolved. The empty states distinguish No comments yet, No open comments, and an available resolved-thread count. The panel can coexist with properties and reduces canvas fit space. Opening a thread from the list identifies its slide/object location. Cross-user delivery, mentions, notifications, and permission behavior were not tested with a second account.

### AI editing

Chat with Claude opened a new associated chat with the audit artifact beside it. The prompt composer, Send, model selector, input/attachment controls, and artifact pane were visible. The observed account selected Opus 5.5 High; model availability is account/time-specific, not a required presentation-module constant.

A real test prompt requested one narrowly scoped change in the private copy: replace the closing heading with `Thank you — AI edit verified`, leaving other content unchanged. Claude showed a streaming/setup state and Stop response, then a Used artifacts item, an artifact card, and a final response. The editor announced **1 slide updated** and the heading changed. The updated heading also appeared in a separately open standalone tab. Its skipped flag and thumbnail marker remained in place.

This verifies natural-language editing of an existing slide and propagation to another open view. Claude's statement that all other properties were unchanged was not independently compared against a complete document diff. It does not establish arbitrary generation quality, complex layout editing, AI undo, failure/retry behavior, or conflict resolution.

Message actions exposed Retry, Edit, Copy for the user message, and Copy, Read aloud, Good response, Bad response, Retry for the response. They were inventoried, not all triggered. Ask Claude also appears as a contextual/integrated entry point. Send to Claude from comments was not submitted separately. Dictation, voice mode, and attachment connectors are surrounding chat capabilities, not verified presentation-editor internals.

## Artifact-level controls

The title dropdown is separate from the slide editor. Its contents varied with host route and loading state. The observed commands were Share, Export, Open chat or Start new chat, Pin, Install artifact, Rename, Duplicate, Turn into, Refresh, Storage, Permissions, Give feedback, Move to…, and Delete. Install artifact was disabled. Move to… appeared in the standalone copy; Export was not always present while loading.

Rename was tested: the title became an inline Artifact name field, and Return committed “Presentations Module Audit Copy.” The surrounding page title updated shortly afterward.

Duplicate was tested: a success notification said “You’re now viewing your copy,” and a new artifact URL appeared with the name “Butterflies (Copy).” The copy's usable startup was unreliable in the first pass, but it loaded and supported the full second-pass audit. The copy opened on slide 1 with Properties off and a different fit zoom, so current view preferences were not fully inherited.

Turn into exposed Claude Docs and Claude Design. Conversion was not executed. Storage exposed a database storage limit, with 0 B of 100 MB in the tested artifact. That figure is artifact database storage, not proof of a maximum presentation-file size.

Permissions showed Google Drive with “Can read and make changes,” an enabled-use switch, and two tools: Create file and Upload file. The status moved from checking to loaded. No permission changes or Drive uploads were made. The presence of these tools does not prove a visible Google Slides export workflow.

### Sharing

The Share control showed Only you. Its panel contained the artifact title, a share-settings control, Close, Invite people by email, People with access, the owner and disabled Owner role, General access, and Copy private link.

General access offered Only people invited and Anyone with the link. The latter explicitly said that people with the link can view but not edit. Access was not changed, and nobody was invited.

Share artifact settings contained Show in Artifacts list, initially on. Its explanation said turning it off hides the artifact from other people's Artifacts tab and Claude Code artifact search, while the creator can still see it and people with access can still open its link. This setting controls discoverability, not the same thing as access permission.

## Saving and reliability

Edits triggered “Saving…” in the artifact header. Rapid changes sometimes showed “Changes waiting — click to save now.” The editor therefore exposes both automatic save and a manual flush of pending changes. The audit copy reopened with its 19 slides, media properties, skipped/thumbnail state, and comments intact. The AI change propagated to another open tab. The original cleanup also survived a reload. These confirm persistence and propagation for the exercised actions; offline, simultaneous conflicting writes, revision-history limits, and interrupted-save recovery were not established.

Startup had multiple stages: spinner; “Still loading. This may take a moment on slower connections”; a longer-loading message; and failure states including “This artifact didn’t start” or “Artifact took too long to load,” with Try again. Retrying returned to loading. The original deck eventually worked through its chat route. These interruptions affected the duplicate and export verification.

At one point accessibility controls existed behind a startup-error overlay. Such hidden controls were not treated as proof that the user-facing editor was usable. The report distinguishes real visible interactions from mere control discovery.

## Proposed implementation model

The following is a suggested architecture for reproducing the observed behavior. It is not a description of Claude's private source code.

Represent a deck with an ID, title, ordered sections with descriptions and slide membership, ordered slides, a selected thumbnail slide, theme colors, text-style definitions, asset references, and save state. Represent each slide with an ID, content tree, background, transition, speaker notes, and optional skipped flag.

Use typed nodes for text, image, video, table, shape, and group. A node needs a stable ID, parent relationship, sizing/layout settings, appearance, effects, and type-specific content. Text must distinguish a style reference from overrides. Tables need cells, row/column counts, column widths, header state, and typography role. Groups need direction, wrapping, justification, alignment, distribution, gap, padding, and child order. Grid groups additionally need tracks (flexible/fixed/content), spans, and row-major placement. Connectors need endpoint geometry, route, stroke, and independent markers. Media nodes need source, alternative text, crop/fit, and for video playback trigger, delay, sound, and export-preview behavior. Comment threads need stable slide/object anchors, replies, edited state, and resolved state. Preserve the element identity relationship used by Magic move when duplicating slides. Placed objects need a positioning representation in addition to structural group membership.

Keep view preferences separate from deck content: selected slide, zoom, one-slide/grid mode, filmstrip visibility, notes visibility, property-panel visibility/width, current selection, insertion mode, and presentation state. The audit showed that duplication did not simply clone the current view state.

Use an explicit interaction state machine for idle selection, text editing, text placement, comment placement, dragging, resizing, scaling, popovers, dialogs, and presentation. Make Escape behavior depend on the current state. Route undo/redo to content edits while avoiding accidental browser navigation.

Use a command history for content mutations and a save queue that can report pending, saving, saved, and failed. Reuse the same rendering rules for editor, thumbnails, grid, audience display, speaker previews, and exports. Separate the speaker window's timer state from the slide content, while synchronizing slide navigation and notes through a reliable shared channel.

For an accessible implementation, expose meaningful object labels and dimensions, keyboard-focusable controls, disabled states with explanations, and announcements for insertion, deletion, reordering, and canceled operations.

## Build checklist and acceptance criteria

1. Open a deck at a slide-specific URL; select a different slide and update the URL without losing edits.
2. Add a slide through every preset; insert after the selected slide; update count and selection.
3. Duplicate, move, skip, copy, and delete slides; restore supported changes through undo; preserve stable slide IDs.
4. Show and hide filmstrip, notes, and properties; resize panels; fit the slide to the available space.
5. Switch to grid, navigate back to a slide, and handle zoom restoration deliberately.
6. Place and edit text; apply a theme style; override its font; reset the override; preserve the difference in stored data.
7. Apply text emphasis, lists, case, alignment, spacing, and each overflow mode; verify long text and small boxes.
8. Change a row to a column; verify wrapping availability, distribution, gap, padding, and nested drag/drop.
9. Insert every shape; resize and move it; test line/connector endpoints and grouping/layering where enabled.
10. Insert images and videos; verify upload, alternative text, aspect, fitting/cropping, replacement, playback, and failure states before claiming parity.
11. Insert a table; edit cells with Tab navigation; change dimensions, header, role, and column widths; verify overflow and export.
12. Test color alpha, transparent/unset/theme-default states, per-side borders, independent radii, shadows, filters, transforms, and blend modes.
13. Present from the current slide; navigate both directions; honor skipped slides; exit predictably; handle unavailable full screen.
14. Open the speaker window; synchronize navigation; pause/resume/reset the timer; edit notes in either surface.
15. Export every format and inspect the actual files for slide count, layout, fonts, image fidelity, notes, and editable content.
16. Test saving during rapid edits, refresh, interruption, failed requests, and simultaneous sessions.
17. Test comments and sharing separately from editing; preserve the distinction between discoverability and access.
18. Verify keyboard navigation, focus restoration, readable labels, and disabled-control explanations throughout.

## Coverage ledger and remaining limits

This ledger is deliberately specific. “Applied” means the control accepted and retained the setting; it is weaker than measuring every resulting pixel or timing interval. A button inventory is not a reason to fabricate behavior that could not be tested.

| Area | Second-pass result | Remaining boundary |
| --- | --- | --- |
| Ten slide presets | All created and structures inspected | Theme inheritance across unrelated decks not tested |
| Ten shapes | All inserted | All geometry/size combinations not tested |
| Connector | Endpoints, elbow, direction, open markers, dashed line, width applied | Object attachment; remaining route combinations |
| Object clipboard | Context-menu copy, cut, paste verified | OS/external and cross-deck interoperability |
| Grouping/layers | Shift multi-select, Group, Ungroup, front/back, duplicate verified | Arbitrary nested-group cases |
| Scale | Cancel and 150% group commit; stroke scaled | Extreme/negative inputs |
| Copy properties | Radius, opacity, border transferred | Every mixed-type pairing |
| Slide management | Duplicate, move up/down, thumbnail, copy/link toasts, skip, delete verified | Actual cross-deck slide paste, clipboard link string; grid left/right and Add slide after inspected |
| Sections | Create, describe, split-to-new, remove empty/populated verified | Complex cross-section drag sequences |
| Text | Style/font/weight, underline/strike, bullets/numbers, case, advanced values | Long-text overflow stress cases; every font and decoration style |
| Table | Dimensions, header, role, width value, editing, Tab, auto-row, TSV behavior verified | Full imported data/format preservation; no spreadsheet parity assumed |
| Stack/grid | Direction, tracks, add/remove column, gap, spans, distribute, sizing constraints applied | Every constraint/wrap interaction |
| Image | PNG paste, progress, alt, fit, crop, source removal/undo verified | File picker replacement blocked; JPEG/GIF/etc. not ingested |
| Video | MP4 paste, progress, play/pause/restart/seek, on-click playback verified | Audible audio, exact automatic-delay timing, other codecs, replacement, video crop |
| Appearance | Opacity, border, alpha, independent corners applied | Exact eyedropper sampling; every border side/style combination |
| Effects | Shadow/inner shadow, filter/backdrop fields, transform, all blend options inspected/applied as described | Pixel-correct compositing and every effect combination |
| Transitions | Options inventoried; selection and navigation verified; Magic move matching hint captured | Frame timing, easing, identity edge cases, export transitions |
| Audience playback | Arrow keys, clicks, Esc, skip, last-slide Next behavior verified | Full screen disabled in both routes |
| Speaker window | Timer, navigation sync, two-way notes verified in first pass | Physical multi-monitor and speaker end-boundary tests |
| PDF | Saved, rendered; notes and skip verified | Every quality tier and long-note overflow |
| PPTX | Both font modes saved and rendered; notes/skip and static-video behavior inspected | Native Microsoft PowerPoint editing; all effects; current-font skip separately |
| HTML | Saved; static structure, notes, skip, asset/remote-font references inspected | Local execution blocked by browser policy; offline/runtime behavior unverified |
| PNG | Saved 3840 × 2160 selected-slide image and visually checked | Every object/effect export combination |
| Comments | Create, reply, edit, resolve, filter, reopen verified | Permanent delete, cross-user notifications/mentions |
| AI | Real heading edit succeeded; another tab updated | Arbitrary generation, AI retry/error/undo, comment-to-AI route |
| Responsive | 390 × 844 layout and bottom sheet inspected; close tested | Touch gestures, actual mobile devices, complete breakpoint mapping |
| Save | Reopen/reload and cross-tab propagation verified | Offline recovery and simultaneous conflicting edits |
| Sharing | Panels, roles, general access, discoverability inventoried | No invitations, public exposure, second-user access testing |
| Artifact host | Rename and duplicate executed; other menus inventoried | Conversion, install (disabled), pin/move, storage changes, permission changes, deletion, feedback not executed |

The remaining blockers are not all the same. File pickers failed to become available through the available computer-use interface. Full screen explicitly reports unavailable. Local HTML execution was rejected by browser policy. Multi-user access and notifications require another participant/account. Destructive deletion and access expansion were not necessary to document the editor and were not executed. The other narrow boundaries above are measurement or combination tests, not missing feature descriptions.

For implementation, keep inspected controls in the inventory, implement their straightforward intended behavior as an explicit product decision, and retain disabled states that the reference exposes. Do not label unverified behavior as copied faithfully from Claude.

## Session cleanup and retained evidence

The second pass found a leftover 3 × 3 test table in the original statistics slide from the first pass. It was removed through the editor. The original again showed eight slides and the original cover thumbnail; the statistics group returned from four children to its three original statistic rows. Reload confirmed the table stayed removed. This corrects the first report's overly broad cleanup statement.

The private audit copy remains intentionally modified with 19 slides, test media, shapes, layout edits, the edited closing heading, and the test comment thread. It is a verification specimen, not a clean presentation. Sharing stayed private. The browser viewport override was reset. Earlier downloaded export specimens can contain test fixtures and should not be distributed as clean copies of the original deck.

## Screenshot and export evidence

Screenshots are paired with the report in the handoff ZIP. The images below are direct UI evidence except the clearly labeled export render comparison.

| File | What it demonstrates |
| --- | --- |
| screenshots/01-editor-properties.jpg | Original editor composition and property panel |
| screenshots-v2/01-video-properties.jpg | Uploaded video and video-specific controls |
| screenshots-v2/02-connector.jpg | Dashed elbow connector and properties |
| screenshots-v2/03-grid-properties.jpg | Grid tracks and nested layout controls |
| screenshots-v2/04-ai-edit.jpg | Completed AI response and changed heading |
| screenshots-v2/05-mobile-editor.jpg | Narrow viewport with bottom properties sheet |
| screenshots-v2/06-original-cleaned.jpg | Original eight-slide deck after test-table removal and reload |
| screenshots-v2/07-audit-final.jpg | Retained audit copy at the end of testing |
| screenshots-v2/08-export-comparison.jpg | All eight first-pass PDF pages beside current/basic PPTX renders through LibreOffice |
| screenshots-v2/09-pdf-speaker-note.png | Notes-enabled export: reduced slide preview with note underneath |

The report's exported-file findings are based on the files actually generated by the UI. File structure evidence confirms canvas size, counts, notes, omission of the skipped heading, and video flattening; it does not reveal the application's private internal implementation.

## Handoff instructions for the builder

Use this second-pass report as the observed feature inventory. Implement the tested behaviors first and retain visible disabled states where the reference does. Treat Applied settings according to their documented evidence, Inspected items as interface requirements with behavior still requiring validation, and Proposed items as engineering recommendations. Keep the warm paper butterfly styling as an example theme, not the only supported theme. Use the screenshots to match spacing, control placement, selection states, dialog structure, and panel hierarchy. Do not claim pixel-perfect equivalence, complete export fidelity, AI parity, or collaboration parity without their separate acceptance tests.


## Selected visual reference pages

The ZIP contains full-resolution versions of all screenshots. These embedded examples make the main design states easy to find. First-pass screenshots may contain temporary test content; use the final cleanup image for the original deck state.

### Desktop editor and properties

![Desktop editor and properties](screenshots/01-editor-properties.jpg)

### New-slide preset gallery

![New-slide preset gallery](screenshots/02-slide-layouts.jpg)

### Grid overview and sections

![Grid overview and sections](screenshots/03-grid-view.jpg)

### Speaker window

![Speaker window](screenshots/05-speaker-notes.jpg)

### Video properties

![Video properties](screenshots-v2/01-video-properties.jpg)

### Connector geometry and controls

![Connector geometry and controls](screenshots-v2/02-connector.jpg)

### Grid track properties

![Grid track properties](screenshots-v2/03-grid-properties.jpg)

### Completed AI heading edit

![Completed AI heading edit](screenshots-v2/04-ai-edit.jpg)

### Mobile properties sheet

![Mobile properties sheet](screenshots-v2/05-mobile-editor.jpg)

### Original statistics slide after cleanup

![Original statistics slide after cleanup](screenshots-v2/06-original-cleaned.jpg)

### Notes-enabled PDF export

![Notes-enabled PDF export](screenshots-v2/09-pdf-speaker-note.png)

### Export comparison: PDF, current-font PPTX, basic-font PPTX

![Export comparison: PDF, current-font PPTX, basic-font PPTX](screenshots-v2/08-export-comparison.jpg)

