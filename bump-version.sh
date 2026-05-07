#!/usr/bin/env bash
# bump-version.sh — Bump the game version across all source files
#
# Usage:
#   bash bump-version.sh <new-version> [date-label]
#
# Examples:
#   bash bump-version.sh 26.1.5
#   bash bump-version.sh 26.1.5 "May 10"

set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
    echo "Usage: bash bump-version.sh <new-version> [date-label]"
    echo "Example: bash bump-version.sh 26.1.5"
    exit 1
fi

# Strip a leading "v" if the caller typed it
NEW_VERSION="${NEW_VERSION#v}"

# Build the date label (e.g. "May 10").
# %B = full month name, %d = zero-padded day — strip the leading zero manually.
if [[ -n "${2:-}" ]]; then
    DATE_LABEL="$2"
else
    DAY=$(date "+%d" | sed 's/^0//')
    MONTH=$(date "+%B")
    DATE_LABEL="$MONTH $DAY"
fi

TODAY=$(date "+%Y-%m-%d")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Detect the current version from README.md
# ---------------------------------------------------------------------------
CURRENT_VERSION=$(sed -n 's/.*\*\*Current Version:\*\* v\([0-9][0-9.]*\).*/\1/p' \
    "$SCRIPT_DIR/README.md" | head -1)

if [[ -z "$CURRENT_VERSION" ]]; then
    echo "ERROR: Could not detect current version from README.md"
    echo "Make sure README.md contains a line like: **Current Version:** vX.Y.Z"
    exit 1
fi

if [[ "$CURRENT_VERSION" == "$NEW_VERSION" ]]; then
    echo "Version is already v${NEW_VERSION} — nothing to do."
    exit 0
fi

echo "=============================================="
echo "  Redline: Zombie Assault — Version Bump"
echo "  v${CURRENT_VERSION}  →  v${NEW_VERSION}  (${DATE_LABEL})"
echo "=============================================="
echo ""

# ---------------------------------------------------------------------------
# Helper: replace a fixed string in a file (portable, no regex needed)
# ---------------------------------------------------------------------------
replace_in_file() {
    local file="$1"
    local old="$2"
    local new="$3"

    if [[ ! -f "$file" ]]; then
        echo "  SKIP  $file — file not found"
        return
    fi

    if grep -qF "$old" "$file"; then
        perl -i -pe "s/\Q${old}\E/${new}/g" "$file"
        echo "  OK    $file"
    else
        echo "  SKIP  $file — pattern not found: \"$old\""
    fi
}

# ---------------------------------------------------------------------------
# 1. README.md — Current Version badge line
# ---------------------------------------------------------------------------
echo "[1/4] README.md"
replace_in_file \
    "$SCRIPT_DIR/README.md" \
    "**Current Version:** v${CURRENT_VERSION}" \
    "**Current Version:** v${NEW_VERSION}"

# README version badge (img.shields.io static badge)
replace_in_file \
    "$SCRIPT_DIR/README.md" \
    "Version-v${CURRENT_VERSION}-red" \
    "Version-v${NEW_VERSION}-red"

# ---------------------------------------------------------------------------
# 2. HUD.ts — console.log version string
# ---------------------------------------------------------------------------
echo "[2/4] HUD.ts"
replace_in_file \
    "$SCRIPT_DIR/HUD.ts" \
    "Script Loaded v${CURRENT_VERSION}" \
    "Script Loaded v${NEW_VERSION}"

# ---------------------------------------------------------------------------
# 3. Changelog.ts — in-world text gizmo header
# ---------------------------------------------------------------------------
echo "[3/4] Changelog.ts"
# Replace the version number in the UPDATE line (keeps whatever date was there)
# Also stamp today's date label
perl -i -pe \
    "s/=== UPDATE v${CURRENT_VERSION}[^=]*/=== UPDATE v${NEW_VERSION} (${DATE_LABEL}) ===/g" \
    "$SCRIPT_DIR/Changelog.ts"
echo "  OK    Changelog.ts"
echo "  NOTE  Update the changelog notes inside Changelog.ts manually."

# ---------------------------------------------------------------------------
# 4. CHANGELOG.md — prepend a new release entry
# ---------------------------------------------------------------------------
echo "[4/4] CHANGELOG.md"
CHANGELOG="$SCRIPT_DIR/CHANGELOG.md"

if [[ ! -f "$CHANGELOG" ]]; then
    echo "  SKIP  CHANGELOG.md — file not found"
else
    NEW_ENTRY="## [${NEW_VERSION}] — ${TODAY}

### Changes
- <!-- Describe what changed -->

### Bug Fixes
- <!-- Describe bug fixes -->

---
"
    # Read the file, insert the new entry after the title block (first 3 lines)
    TMPFILE=$(mktemp)
    head -n 3 "$CHANGELOG" > "$TMPFILE"
    printf "\n%s\n" "$NEW_ENTRY" >> "$TMPFILE"
    tail -n +4 "$CHANGELOG"   >> "$TMPFILE"
    mv "$TMPFILE" "$CHANGELOG"
    echo "  OK    CHANGELOG.md — template entry added (fill in the details)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Done. Next steps:"
echo "  1. Fill in release notes in CHANGELOG.md and Changelog.ts"
echo "  2. Stage and commit:"
echo "     git add README.md HUD.ts Changelog.ts CHANGELOG.md"
echo "     git commit -m \"Bump version to v${NEW_VERSION}\""
