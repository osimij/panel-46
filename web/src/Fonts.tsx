// The designer's own fonts: the ones they upload (a licensed typeface, a client's brand font)
// so FRIDAY's sketches can use type that isn't on Google Fonts. Every sketch Panel serves has
// them loaded, so naming one to FRIDAY ("set the hero in Söhne", or @Söhne) is enough.
//
// Each family shows every face it has, set in a line the designer can type over. The default
// line is Russian and Tajik, because a font is judged by its Cyrillic here (unugly.md), and the
// Tajik letters (Ғ Ӣ Қ Ӯ Ҳ Ҷ) are the ones most fonts miss.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fontApi, isFontFile, type FontFace_, type FontFamily } from "./api.ts";
import { Icon } from "./Icon.tsx";
import { InlineName } from "./InlineName.tsx";
import "./fonts.css";

const SAMPLE = "Ҳуҷҷати шумо омода аст · Ваш документ готов · Ғ ғ Ӣ ӣ Қ қ Ӯ ӯ Ҳ ҳ Ҷ ҷ";
const SAMPLE_KEY = "panel.fontSample";

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra Bold", 900: "Black",
};
const weightName = (w: number) => WEIGHT_NAMES[Math.round(w / 100) * 100] ?? String(w);

/** The rows a face shows: one, or a few weights across a variable font's range. */
function rowsOf(f: FontFace_) {
  const [lo, hi] = f.weight.split(" ").map(Number) as [number, number | undefined];
  if (hi === undefined) return [{ weight: lo, label: `${weightName(lo)}${f.italic ? " Italic" : ""}` }];
  const picks = [...new Set([lo, 400, 700, hi].filter((w) => w >= lo && w <= hi))].sort((a, b) => a - b);
  return picks.map((w) => ({ weight: w, label: `${weightName(w)}${f.italic ? " Italic" : ""} · variable` }));
}

/** The face whose look stands for the family in its name: upright and nearest to Regular. */
function standIn(faces: FontFace_[]) {
  const upright = faces.filter((f) => !f.italic);
  const pool = upright.length ? upright : faces;
  return pool.reduce((a, b) => (Math.abs(Number(b.weight.split(" ")[0]) - 400) < Math.abs(Number(a.weight.split(" ")[0]) - 400) ? b : a));
}

const preview = (f: FontFace_) => `pf-${f.id}`;

const TAJIK = ["Ғ", "ғ", "Ӣ", "ӣ", "Қ", "қ", "Ӯ", "ӯ", "Ҳ", "ҳ", "Ҷ", "ҷ"];

/**
 * Which letters a face is missing, the way a browser finds out: a letter the font doesn't have is
 * drawn by the fallback, so it measures differently with two different fallbacks behind it.
 */
async function missingIn(f: FontFace_) {
  const family = preview(f);
  await document.fonts.load(`${f.italic ? "italic " : ""}40px "${family}"`, "ЖжҒ").catch(() => {});
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  const has = (ch: string) => {
    const width = (fallback: string) => {
      ctx.font = `${f.italic ? "italic " : ""}40px "${family}", ${fallback}`;
      return ctx.measureText(ch).width;
    };
    return width("monospace") === width("serif");
  };
  if (!["Ж", "ж", "Б", "ы"].every(has)) return "No Cyrillic";
  const gone = TAJIK.filter((ch) => !has(ch));
  return gone.length ? `No Tajik ${gone.filter((_, i) => i % 2 === 0).join(" ")}` : null;
}

export function Fonts({ version, onError, onSay }: { version: number; onError: (t: string) => void; onSay: (t: string) => void }) {
  const [families, setFamilies] = useState<FontFamily[] | null>(null);
  const [sample, setSample] = useState(() => {
    try {
      return localStorage.getItem(SAMPLE_KEY) || SAMPLE;
    } catch {
      return SAMPLE;
    }
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per family, what its Cyrillic lacks (unugly.md: a font is judged by its Cyrillic here).
  const [gaps, setGaps] = useState<Record<string, string | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => fontApi.list().then(setFamilies).catch((e: Error) => onError(e.message)), [onError]);
  useEffect(() => void load(), [load, version]);

  const remember = (v: string) => {
    setSample(v);
    try {
      localStorage.setItem(SAMPLE_KEY, v);
    } catch {
      /* Private window: the line just isn't remembered. */
    }
  };

  const upload = async (files: File[]) => {
    const fonts = files.filter(isFontFile);
    if (!fonts.length) return onError("Those aren't font files. Panel takes .woff2, .woff, .ttf and .otf.");
    setBusy(true);
    try {
      const r = await fontApi.add(fonts);
      if (r.failed.length) onError(r.failed[0]!);
      if (r.added.length) onSay(`Added ${r.added.length} font${r.added.length === 1 ? "" : "s"}`);
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (family: string, next: string) => {
    setRenaming(null);
    if (!next || next === family) return;
    try {
      await fontApi.rename(family, next);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const removeFamily = async (family: string) => {
    setConfirming(null);
    try {
      await fontApi.removeFamily(family);
      onSay(`Deleted ${family}`);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const removeFace = async (id: string) => {
    try {
      await fontApi.remove(id);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!families?.length) return;
    let live = true;
    void Promise.all(families.map(async (fam) => [fam.family, await missingIn(standIn(fam.faces))] as const)).then((list) => {
      if (live) setGaps(Object.fromEntries(list));
    });
    return () => {
      live = false;
    };
  }, [families]);

  // Each face under a name of its own for the previews here, so an uploaded "Inter" can't
  // change Panel's own type. Sketches get them under their real family names instead.
  const faces = useMemo(
    () =>
      (families ?? [])
        .flatMap((f) => f.faces)
        .map((f) => `@font-face{font-family:"${preview(f)}";src:url("${f.url}");font-weight:${f.weight};font-style:${f.italic ? "italic" : "normal"};font-display:block}`)
        .join("\n"),
    [families],
  );

  const picker = (
    <input
      ref={fileRef}
      type="file"
      multiple
      accept=".woff2,.woff,.ttf,.otf"
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (files.length) void upload(files);
      }}
    />
  );
  const uploadButton = (
    <button className="fonts-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
      <Icon name="upload" size={14} />
      {busy ? "Adding…" : "Upload fonts"}
    </button>
  );

  return (
    <div className="fonts">
      <style>{faces}</style>
      {picker}
      <header className="header">
        <div className="title-row">
          <h1>Fonts</h1>
          <span className="subtitle">Every sketch can use them. Name one to FRIDAY, or @ it.</span>
          <span className="fonts-spacer" />
          {families && families.length > 0 && uploadButton}
        </div>
      </header>

      {families === null ? null : families.length === 0 ? (
        <div className="empty hero">
          <div className="fonts-empty-mark" aria-hidden>Аа</div>
          <h2>Your own fonts</h2>
          <p>Drop .woff2, .woff, .ttf or .otf files anywhere in Panel, or upload them here.</p>
          <p>FRIDAY's sketches use one when you name it.</p>
          <div className="fonts-empty-action">{uploadButton}</div>
        </div>
      ) : (
        <>
          <input
            className="fonts-sample"
            value={sample}
            onChange={(e) => remember(e.target.value)}
            onBlur={() => !sample.trim() && remember(SAMPLE)}
            placeholder="Type to see it in every font"
            aria-label="The line every font is set in"
            spellCheck={false}
          />
          {families.map((fam) => {
            const lead = standIn(fam.faces);
            const styles = fam.faces.reduce((n, f) => n + rowsOf(f).length, 0);
            const variable = fam.faces.some((f) => f.weight.includes(" "));
            return (
              <section key={fam.family} className="font-family">
                <div className="ff-head">
                  {renaming === fam.family ? (
                    <InlineName initial={fam.family} className="ff-rename" onDone={(v) => void rename(fam.family, v)} onCancel={() => setRenaming(null)} />
                  ) : (
                    <h2 style={{ fontFamily: `"${preview(lead)}", "Inter Variable", sans-serif`, fontWeight: Number(lead.weight.split(" ")[0]) }} onDoubleClick={() => setRenaming(fam.family)}>
                      {fam.family}
                    </h2>
                  )}
                  <span className="ff-meta">
                    {variable ? "Variable" : `${styles} style${styles === 1 ? "" : "s"}`} · {[...new Set(fam.faces.map((f) => f.format))].join(", ")}
                  </span>
                  {gaps[fam.family] && (
                    <span className="ff-gap" title="These letters show in another font here, and would in a sketch too">
                      <Icon name="alert" size={12} /> {gaps[fam.family]}
                    </span>
                  )}
                  <span className="fonts-spacer" />
                  <button className="text-btn ff-act" onClick={() => setRenaming(fam.family)} title="The name sketches use for it">
                    <Icon name="pencil" size={13} /> Rename
                  </button>
                  <button
                    className={`text-btn ff-act ${confirming === fam.family ? "armed" : ""}`}
                    onClick={() => (confirming === fam.family ? void removeFamily(fam.family) : setConfirming(fam.family))}
                    onBlur={() => confirming === fam.family && setConfirming(null)}
                  >
                    <Icon name="trash" size={13} /> {confirming === fam.family ? "Delete for good?" : "Delete"}
                  </button>
                </div>
                <div className="ff-faces">
                  {fam.faces.flatMap((f) =>
                    rowsOf(f).map((row, i) => (
                      <div key={`${f.id}-${row.weight}`} className="ff-face">
                        <span className="ff-label" title={f.original_name}>{row.label}</span>
                        <span className="ff-sample" style={{ fontFamily: `"${preview(f)}", "Inter Variable", sans-serif`, fontWeight: row.weight, fontStyle: f.italic ? "italic" : "normal" }}>
                          {sample || SAMPLE}
                        </span>
                        {i === 0 && fam.faces.length > 1 && (
                          <button className="ff-remove" onClick={() => void removeFace(f.id)} aria-label={`Delete ${f.original_name}`} title={`Delete this file (${f.original_name})`}>
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </div>
                    )),
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
