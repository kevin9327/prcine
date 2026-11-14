<div align="center">

<a href="assets/demo/immutable-js-2325.mp4"><img src="assets/demo/immutable-js-2325.webp" alt="prcine rendering immutable-js/immutable-js#2325 as a 15 second trailer" width="100%"></a>

# prcine

**Turn any pull request into a 15-second trailer.**

[![ci](https://github.com/kevin9327/prcine/actions/workflows/ci.yml/badge.svg)](https://github.com/kevin9327/prcine/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)

</div>

```bash
npx github:kevin9327/prcine https://github.com/owner/repo/pull/123             # 16:9 for READMEs
npx github:kevin9327/prcine https://github.com/owner/repo/pull/123 --vertical  # 9:16 for X, Shorts, Reels
```

Title, author, files, `+/−` counts, then the hunks that matter typed out with syntax highlighting. Everything on screen comes from the diff. No API key, no browser, no AI. Writes `prcine.mp4` (H.264, 30 fps, a few MB) and a looping `prcine.webp`.

Needs Node 20+ and `ffmpeg` on your PATH (`--no-mp4` skips it and writes only the WebP).

## Examples

All three are real merged PRs, rendered with one command and no flags beyond `--vertical`.

| [immutable-js/immutable-js#2325](https://github.com/immutable-js/immutable-js/pull/2325) | [luongnv89/claude-howto#240](https://github.com/luongnv89/claude-howto/pull/240) | [thedotmack/claude-mem#6046](https://github.com/thedotmack/claude-mem/pull/6046) |
|---|---|---|
| <a href="assets/demo/immutable-js-2325-vertical.mp4"><img src="assets/demo/immutable-js-2325-vertical.webp" width="240" alt="immutable-js#2325, vertical"></a> | <a href="assets/demo/claude-howto-240-vertical.mp4"><img src="assets/demo/claude-howto-240-vertical.webp" width="240" alt="claude-howto#240, vertical"></a> | <a href="assets/demo/claude-mem-6046-vertical.mp4"><img src="assets/demo/claude-mem-6046-vertical.webp" width="240" alt="claude-mem#6046, vertical"></a> |

## Usage

```bash
prcine facebook/react#38128          # owner/repo#N works too (uses your gh login or $GITHUB_TOKEN if present)
prcine main...HEAD                   # your current branch
prcine v1.2.0..v1.3.0 -d 30          # a release, longer cut
prcine owner/repo#42 --still 2,6,11 --still-only   # PNG previews in seconds
```

| Option | Default | |
|---|---|---|
| `-o, --out <path>` | `prcine` | output path without extension |
| `-d, --duration <sec>` | `15` | 10-60; longer cuts show more hunks |
| `--vertical`, `-a <ratio>` | `16:9` | `--vertical` = `9:16`; also `1:1` |
| `--hunks <n>` | auto | cap the number of code highlights |
| `--title <text>` | PR title | override the title card |
| `--no-webp`, `--no-mp4` | | skip one output |
| `--webp-max <MB>` | `5.5` | WebP budget |
| `--no-avatar`, `--no-brand` | | hide the avatar / the small credit |

How hunks are picked: changed lines are scored (real code over comments, strings and help text), core source beats tests, docs and config, and lockfiles, `dist/` and generated files never make it in. A one-file fix gets its test as the second shot.

## On every pull request

```yaml
# .github/workflows/prcine.yml
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: write
  pull-requests: write
jobs:
  video:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: kevin9327/prcine@main
```

Renders the PR and keeps **one** comment with the clip up to date. Details in [`examples/github-action`](examples/github-action/prcine.yml).

## Development

```bash
git clone https://github.com/kevin9327/prcine && cd prcine && npm install
npm test
```

Drawn with Skia ([@napi-rs/canvas](https://github.com/Brooooooklyn/canvas)), highlighted with Shiki, set in [Geist](https://vercel.com/font) (OFL, bundled). The example clips show public PRs; the code belongs to their authors. [MIT](LICENSE)
