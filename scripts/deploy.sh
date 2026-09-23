#!/usr/bin/env bash
# Builds the game and publishes dist/ to the gh-pages branch (served by GitHub Pages).
# Usage: npm run deploy
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REMOTE_URL="$(git remote get-url origin)"

npm run build
touch dist/.nojekyll

cd dist
rm -rf .git
git init -q
git checkout -q -b gh-pages
git add -A
git commit -q -m "Deploy $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)"
# Use the GitHub CLI as credential helper for this push only (no global git config changes).
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f "$REMOTE_URL" gh-pages
rm -rf .git
echo "Deployed to gh-pages."
