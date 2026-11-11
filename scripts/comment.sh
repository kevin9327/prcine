#!/usr/bin/env bash
# Push the WebP to a media branch and post or update one PR comment that embeds it.
set -euo pipefail
name="$(basename "$WEBP")"
remote="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
dir="$(mktemp -d)"
if git ls-remote --exit-code --heads "$remote" "$BRANCH" >/dev/null 2>&1; then
  git clone -q --depth 1 --branch "$BRANCH" "$remote" "$dir"
else
  git -C "$dir" init -q -b "$BRANCH" && git -C "$dir" remote add origin "$remote"
fi
cp "$WEBP" "$dir/$name"
git -C "$dir" add "$name"
if ! git -C "$dir" diff --cached --quiet; then
  git -C "$dir" -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -qm "prcine: PR #$PR ($name)"
  git -C "$dir" push -q origin "$BRANCH"
fi
url="https://raw.githubusercontent.com/${REPO}/${BRANCH}/${name}"
body="<!-- prcine -->
### 🎬 Walkthrough of this PR

<img src=\"${url}\" width=\"100%\" alt=\"prcine walkthrough of #${PR}\">

MP4 in the [workflow artifacts](${RUN_URL}). Rendered by [prcine](https://github.com/kevin9327/prcine)."
id="$(gh api "repos/${REPO}/issues/${PR}/comments" --paginate --jq '.[] | select(.body | startswith("<!-- prcine -->")) | .id' | tail -n1)"
if [ -n "$id" ]; then
  gh api -X PATCH "repos/${REPO}/issues/comments/${id}" -f body="$body" >/dev/null
else
  gh api "repos/${REPO}/issues/${PR}/comments" -f body="$body" >/dev/null
fi
echo "commented with $url"
