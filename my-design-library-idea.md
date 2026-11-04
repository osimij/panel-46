# A personal home for my design references

Notes from our conversation, 5 November 2026.

I want a personal place for all the design work I save: websites, interfaces, graphics, branding, images, and videos. I save around 10–15 designs a day, mostly on X. I want to keep collecting naturally, but have a better way to browse those saves and actually use them when I’m designing something.

[Recent](https://recent.design/) is the starting reference for how it could feel: visual, easy to browse, and focused on the work itself. My version would be a private library of my own references. We explored a gallery and a layout that groups references into project collections; the final design is still open.

I want to be able to enjoy browsing the collection, but also find something specific without remembering who posted it or what I called it.

For example, I should be able to ask:

> I’m designing a minimal architecture website. Find references from my collection that could help with the typography, layout, and overall feeling.

The app should bring back things I actually saved, show them visually, and help explain why they might be useful.

Saving something should mean keeping the actual media whenever we can. A link to an X post is useful for context and credit, but I don’t want the collection to depend on that post existing forever. If a video has been downloaded successfully, I want my copy to keep playing even if the original post disappears.

Each reference should keep its source and creator alongside the saved images or videos. I’d also like room for a small personal note, such as “love how this menu opens” or “keep this for the portfolio redesign.”

The app needs to be honest about what it has saved:

- **Archived:** the actual media has been saved successfully.
- **Link only:** there is a bookmark or preview, but playback still depends on the source.
- **Copy failed:** the media wasn’t saved and needs another attempt.

A working thumbnail or embedded player shouldn’t be treated as proof that we have a copy.

For now, the library will live on my own hardware. I have an M5 Pro Mac with 1 TB of internal storage and a 2 TB external SSD. I’m keeping the budget low, so I want to use that space before paying for cloud media storage.

The library should consist of permanent local files, with the notes, tags, and collections kept locally too. I don’t want my saved collection to depend on a temporary browser cache.

A practical starting arrangement is to keep the main library on the Mac and use the external SSD for backups. We can move heavier media to the SSD if that becomes useful. Files stored there would need the drive connected to play. The exact split between the two drives isn’t fixed yet.

The playback experience matters a lot: download a video once, then read that saved file from disk every time I play it. Replaying it should not fetch it from X again. I want fast browsing and playback even when I have no internet connection.

The website can be live, while the media stays on my Mac. To make that work, we discussed a small Mac companion that manages the local library and gives the interface access to it. The same experience should also be available offline, ideally something I can open from my Dock without visiting a web address.

We haven’t chosen the exact packaging yet. What matters is that it feels like one product and doesn’t make me manage a complicated setup every day.

Having a live website won’t automatically make my Mac’s files available on my phone or another computer. That would need cloud syncing or a separate remote-access setup. For the first version, the main experience is on my Mac.

For AI, my intended main choices are **Sonnet 5.5 or Haiku 5.5**. Apple’s **Foundation Models** should remain an optional on-device choice, especially for offline use. The AI provider should be switchable. We still need to confirm the exact available API model names and connection details when we set that up.

Using cloud AI doesn’t mean putting the whole library into cloud storage. The originals can stay on my Mac while the app sends the relevant text or selected images for a particular request. Cloud AI requests may have their own usage costs, separate from file storage.

When I choose offline mode, the app should make no cloud AI requests and shouldn’t silently switch to an online provider. If I want AI while offline, it should use the available Apple model. Browsing, local search, and playback should remain useful even without AI.

The distinction is straightforward:

- Browsing saved references, playing downloaded videos, and searching local titles, tags, and notes can work offline.
- Apple’s on-device AI can work offline once the required model is installed and available.
- Getting new media from X needs internet.
- Using Sonnet or Haiku through an online service needs internet.

We’ve already done a small test with Apple’s on-device model on this Mac. It analyzed three public design images with internet access blocked for the test program. After simplifying the prompts, it passed three of four small search checks. It also missed visual details, produced a mistaken label, and rejected some ordinary images in earlier attempts. That makes it worth keeping as an option, with editable suggestions. We haven’t tested video understanding or a finished app yet.

The organization should help me without making saving feel like homework. AI could suggest titles, tags, and short descriptions based on the reference: colors, typography, layout, subject, mood, or the kind of interface component shown. I should be able to correct those suggestions easily.

Collections should be flexible. One design might belong in both “Portfolio ideas” and “Typography” without creating two copies of the same file. Favorites and personal notes would give me another way to mark what matters.

When a reference is added, the app can analyze it and keep useful information for later searches. Asking for references shouldn’t mean reprocessing the entire collection from scratch every time.

For videos, selected frames could be a starting point for understanding the visual content. Understanding the actual movement, timing, and interaction is a separate challenge we still need to explore. A still frame alone won’t capture why an animation feels good.

Getting references out of X reliably is another thing we still need to prove. We discussed pasting links, saving through a convenient capture tool, and potentially importing existing bookmarks. We haven’t picked the exact method or verified that every old bookmark and attachment can be imported. The app should make saving easy, while clearly showing when it couldn’t preserve the media.

Later, when I’m comfortable paying for cloud storage, I want to upload or sync the existing library without starting over. My notes, collections, tags, and source links should come with it. We discussed services such as Cloudflare R2, but haven’t committed to a provider.

Adding cloud storage should still let me keep local copies for fast playback and offline use. It would add access from more devices and another place to keep the files. I also want a way to export the media and its accompanying information, so the collection stays portable.

The first usable version should prove the everyday experience: save a reference, confirm the media is on disk, find it again, and play it offline. Then we can build up the AI search and organization around that dependable library.

We have the direction and an initial AI test. The full app, its final interface, the capture method, and the later cloud syncing still need to be built and tested.
