#!/bin/zsh
# A copy of your library to try changes on, so the real one is never touched.
#
#   scripts/copy.sh            copy the library to .copy/lib and build the UI to .copy/dist
#   scripts/copy.sh --pad 3    also repeat every save 3 more times (to test a big library)
#   scripts/copy.sh --build    only rebuild the UI into .copy/dist (after changing web/)
#
# Then run it on port 4747, beside the real Panel on 4646:
#
#   PANEL_PORT=4747 PANEL_LIBRARY_DIR=.copy/lib PANEL_DIST=.copy/dist bun server/index.ts
#
# (In Claude Code: the "panel-copy" server in .claude/launch.json does the same.)
#
# The copy holds the database, the saves' pictures and videos, the projects (with their
# sketches), your own fonts, the projects' brand files and the two search models, so a
# sketch on the copy has your fonts and logos as on the real Panel.
#
# The copy takes almost no disk: on this Mac's disk (APFS) the files are cloned, not
# duplicated. In it, reading new saves by AI is off and nothing waits to be read or
# downloaded, so it spends none of your Claude plan by itself.
set -euo pipefail

ROOT="${0:A:h:h}"
SRC="${PANEL_LIBRARY_DIR:-$HOME/DesignLibrary}"
COPY="$ROOT/.copy"
PAD=0
BUILD_ONLY=0
while (( $# )); do
  case "$1" in
    --pad) PAD="${2:-0}"; shift 2 ;;
    --build) BUILD_ONLY=1; shift ;;
    *) echo "usage: $0 [--pad N] [--build]" >&2; exit 1 ;;
  esac
done

build() {
  (cd "$ROOT" && bunx vite build --outDir "$COPY/dist" --emptyOutDir >/dev/null)
  echo "UI built into .copy/dist"
}

if (( BUILD_ONLY )); then
  build
  exit 0
fi

if lsof -nP -iTCP:4747 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is running on port 4747 (the copy?). Stop it first." >&2
  exit 1
fi
if [[ ! -f "$SRC/library.sqlite" ]]; then
  echo "No library at $SRC" >&2
  exit 1
fi

rm -rf "$COPY/lib"
mkdir -p "$COPY/lib"
# .backup reads the database safely while Panel is using it.
sqlite3 -readonly "$SRC/library.sqlite" ".backup '$COPY/lib/library.sqlite'"
# (models: the two small models for search by meaning, so the copy doesn't fetch them again.
# fonts: the designer's own fonts, which every sketch loads. brand: each project's logos,
# pictures and brand books.)
for d in media projects models fonts brand; do
  [[ -d "$SRC/$d" ]] || continue
  # Cloned where the disk can (no extra space), copied otherwise.
  cp -c -R "$SRC/$d" "$COPY/lib/$d" 2>/dev/null || { rm -rf "$COPY/lib/$d"; cp -R "$SRC/$d" "$COPY/lib/$d"; }
done

sqlite3 "$COPY/lib/library.sqlite" "
INSERT INTO settings (key, value) VALUES ('ai_auto', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
DELETE FROM settings WHERE key IN ('backup_dir', 'backup_mirror_last', 'backup_mirror_error');
UPDATE reads SET state = 'failed', error = 'Not read in the copy' WHERE state IN ('queued', 'sent');
UPDATE media SET status = 'failed', error = 'Not downloaded in the copy' WHERE status = 'pending';
UPDATE refs SET status = 'failed' WHERE status = 'pending';
UPDATE builds SET status = 'stopped' WHERE status = 'working';
" 2>/dev/null || true

if (( PAD > 0 )); then
  # Every round adds one more copy of each original save, dated a month further back.
  SQL="CREATE TEMP TABLE orig AS SELECT id FROM refs WHERE hidden = 0 AND person = 0 AND kind != 'skill'; CREATE TEMP TABLE map (old TEXT, new TEXT);"
  for n in $(seq 1 "$PAD"); do
    SQL+="
DELETE FROM map;
INSERT INTO map SELECT id, lower(hex(randomblob(8))) FROM orig;
INSERT INTO refs (id, kind, source_url, source_id, creator_handle, creator_name, title, text, note, favorite, status, status_detail, preview_path, posted_at, created_at, updated_at, avatar_path, hidden, site, person, links, link_profiles)
  SELECT m.new, kind, source_url, NULL, creator_handle, creator_name, title, text, note, favorite, status, status_detail, preview_path, posted_at, strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-' || ($n * 30) || ' days'), updated_at, avatar_path, hidden, site, person, links, link_profiles
  FROM refs r JOIN map m ON m.old = r.id;
INSERT INTO media (id, ref_id, idx, position, type, remote_url, local_path, thumb_path, mime, bytes, width, height, duration, sha256, status, error)
  SELECT lower(hex(randomblob(8))), m.new, idx, position, type, remote_url, local_path, thumb_path, mime, bytes, width, height, duration, sha256, status, error
  FROM media x JOIN map m ON m.old = x.ref_id;
INSERT INTO ref_tags (ref_id, tag_id, source) SELECT m.new, tag_id, source FROM ref_tags x JOIN map m ON m.old = x.ref_id;"
  done
  sqlite3 "$COPY/lib/library.sqlite" "$SQL"
fi

build
echo "Copy ready in .copy/lib: $(sqlite3 "$COPY/lib/library.sqlite" 'SELECT COUNT(*) FROM refs') saves."
echo "Run it: PANEL_PORT=4747 PANEL_LIBRARY_DIR=.copy/lib PANEL_DIST=.copy/dist bun server/index.ts"
