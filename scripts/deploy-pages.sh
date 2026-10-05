#!/usr/bin/env bash
#
# Publishes the production build to the gh-pages branch, which GitHub Pages serves.
#
# The build is published from a separate throwaway checkout so the working tree is never
# disturbed and the generated files never land on main. Each deploy is based on the previous
# gh-pages tip, so the push is a fast-forward rather than a force.
#
# Usage: bash scripts/deploy-pages.sh [owner/repo] [base-path]

set -euo pipefail

REPO_SLUG="${1:-ZEALHT001/nailong-bounce}"
BASE_PATH="${2:-/nailong-bounce/}"
REMOTE="https://github.com/${REPO_SLUG}.git"
BRANCH="gh-pages"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

author_name="$(git config user.name || echo 'github-actions')"
author_email="$(git config user.email || echo 'github-actions@users.noreply.github.com')"

echo "==> Building (VITE_BASE=${BASE_PATH})"
rm -rf dist
VITE_BASE="${BASE_PATH}" npm run build

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

echo "==> Staging ${BRANCH}"
if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
  # Continue from the existing branch so the push stays a fast-forward.
  git clone --quiet --depth 1 --branch "$BRANCH" "$REMOTE" "$tmp"
  find "$tmp" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
else
  git init --quiet -b "$BRANCH" "$tmp"
  git -C "$tmp" remote add origin "$REMOTE"
fi

cp -R dist/. "$tmp/"
# Stop GitHub Pages from running Jekyll over the build output.
touch "$tmp/.nojekyll"

git -C "$tmp" add -A
if git -C "$tmp" diff --cached --quiet; then
  echo "==> No changes to publish"
  exit 0
fi

git -C "$tmp" \
  -c user.name="$author_name" \
  -c user.email="$author_email" \
  commit --quiet -m "Deploy: $(git -C "$root" rev-parse --short HEAD) $(date -u '+%Y-%m-%d %H:%M UTC')"

echo "==> Pushing ${BRANCH}"
# GitHub occasionally drops HTTP/2 pushes with a framing error; HTTP/1.1 is reliable here.
git -C "$tmp" -c http.version=HTTP/1.1 push --quiet origin "$BRANCH"

echo "==> Published: https://${REPO_SLUG%%/*}.github.io/${REPO_SLUG##*/}/"
