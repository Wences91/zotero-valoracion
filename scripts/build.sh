#!/usr/bin/env bash
# Packages src/ into build/zotero-valoracion-<version>.xpi and regenerates
# updates.json for that version. The archive is reproducible: the same sources
# always give the same file, so the hash in updates.json stays valid.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="zotero-valoracion"
REPO="Wences91/zotero-valoracion"

field() {
  sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" src/manifest.json | head -n 1
}
VERSION="$(field version)"
ID="$(field id)"
MIN_VERSION="$(field strict_min_version)"
MAX_VERSION="$(field strict_max_version)"

XPI="build/$NAME-$VERSION.xpi"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p build
rm -f "$XPI"
cp -R src/. "$STAGE/"
find "$STAGE" -name '.DS_Store' -delete
# Fixed timestamps and entry order, so the archive does not depend on when or where it is built.
# Directory entries are kept on purpose: Zotero finds the locale folders through them.
find "$STAGE" -exec env TZ=UTC touch -t 202001010000 {} +
(cd "$STAGE" && find . -mindepth 1 | LC_ALL=C sort | TZ=UTC zip -q -X -@ "$OLDPWD/$XPI")

HASH="$(shasum -a 256 "$XPI" | cut -d ' ' -f 1)"

cat > updates.json <<EOF
{
  "addons": {
    "$ID": {
      "updates": [
        {
          "version": "$VERSION",
          "update_link": "https://github.com/$REPO/releases/download/v$VERSION/$NAME-$VERSION.xpi",
          "update_hash": "sha256:$HASH",
          "applications": {
            "zotero": {
              "strict_min_version": "$MIN_VERSION",
              "strict_max_version": "$MAX_VERSION"
            }
          }
        }
      ]
    }
  }
}
EOF

echo "$XPI"
echo "sha256:$HASH"
