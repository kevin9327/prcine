---
name: prcine
description: Render a short code-walkthrough video (MP4 + animated WebP) of a GitHub pull request or a git range with the prcine CLI. Use when the user wants a demo video, GIF/WebP, or visual summary of a PR, branch, commit or release for a README, PR comment, changelog or social post.
---

# prcine

`prcine` turns a pull request or git range into a 15-30 second video: title card, changed files, the key code hunks typed out, and a stats outro. No API key needed.

## Run it

```bash
# a GitHub PR (URL or owner/repo#123); uses `gh` auth if present, else GITHUB_TOKEN, else anonymous
npx -y github:kevin9327/prcine https://github.com/OWNER/REPO/pull/123 -o out/pr-123

# local work, from inside the repo
npx -y github:kevin9327/prcine main...HEAD -o out/branch
npx -y github:kevin9327/prcine HEAD -o out/last-commit
```

Writes `<out>.mp4` (1080p H.264) and `<out>.webp` (looping, under 5.5 MB). The MP4 needs `ffmpeg` on PATH; `--no-mp4` skips it.

Useful flags: `-d 15` (10-60 s), `-a 9:16` (vertical for social), `-a 1:1`, `--hunks 2`, `--title "..."`, `--no-avatar`, `--no-brand`.

## Preview before a full render

`--still 3,8,14 --still-only` writes PNG frames in a few seconds. Look at them before rendering the whole video.

## Embed

- README / issue / PR comment: `![walkthrough](path/to/out.webp)` (GitHub plays animated WebP inline).
- X / LinkedIn: upload the MP4; use `-a 9:16` or `-a 1:1` for mobile-first feeds.

## Notes

- Lockfiles, generated files, snapshots and binaries are never chosen as highlights; tests and docs are ranked lower than source.
- For private repos, make sure `gh auth status` works or set `GITHUB_TOKEN`.
- To get a video comment on every PR, add a workflow with `uses: kevin9327/prcine@main` (see `examples/github-action/prcine.yml`). It updates one marked comment in place.
- With little worth showing, the video gets shorter than `-d` rather than padding.
- Do not claim the video shows the full diff: it shows the highlights, the file list and the totals.
