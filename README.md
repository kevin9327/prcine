<div align="center">

<a href="docs/hero.mp4"><img src="docs/hero.webp" alt="prcine rendering facebook/react#38128 as a 22 second walkthrough" width="100%"></a>

# prcine

**Turn any pull request into a 20-second code walkthrough video.**

[![ci](https://github.com/kevin9327/prcine/actions/workflows/ci.yml/badge.svg)](https://github.com/kevin9327/prcine/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)

`npx github:kevin9327/prcine https://github.com/owner/repo/pull/123`

MP4 + looping WebP · 16:9 or 9:16 · no API key, no browser, no AI

</div>

---

A PR description says *what* changed. A 20-second clip *shows* it: the title, the files that moved, the three hunks that matter typed out line by line, and the totals. Drop it in a README, a release note, a PR comment or an X post.

The hero above was rendered from [facebook/react#38128](https://github.com/facebook/react/pull/38128) with one command and no flags.

## Install

Needs Node 20+. `ffmpeg` on your PATH for the MP4 (`brew install ffmpeg`, `apt install ffmpeg`, `winget install Gyan.FFmpeg`). The WebP is encoded in-process, so `--no-mp4` works without ffmpeg.

```bash
npx github:kevin9327/prcine <pr-url | owner/repo#123 | git-range>
```

or install it globally:

```bash
npm i -g github:kevin9327/prcine
prcine --help
```

## Usage

```bash
# a GitHub pull request (uses your `gh` login if present, else $GITHUB_TOKEN, else anonymous)
prcine https://github.com/vitejs/vite/pull/24044
prcine facebook/react#38128

# your own work, from inside a repo
prcine main...HEAD            # the current branch
prcine HEAD                   # the last commit
prcine v1.2.0..v1.3.0 -d 30   # a release

# vertical for Shorts / Reels / X mobile
prcine main...HEAD -a 9:16

# quick look: PNG stills in a few seconds instead of a full render
prcine owner/repo#42 --still 3,8,14 --still-only
```

Output: `prcine.mp4` (1080p H.264, ~4 MB) and `prcine.webp` (looping, kept under 5.5 MB so it embeds anywhere). Change the name with `-o`.

| Option | Default | |
|---|---|---|
| `-o, --out <path>` | `prcine` | output path without extension |
| `-d, --duration <sec>` | `22` | 10-60; longer videos show more hunks |
| `-a, --aspect <ratio>` | `16:9` | `16:9`, `9:16`, `1:1` |
| `--size <px>` | `1080` | short side of the MP4 |
| `--fps <n>` | `30` | MP4 frame rate (the WebP is 15 fps) |
| `--hunks <n>` | auto | cap the number of code highlights |
| `--title <text>` | PR title | override the title card |
| `--webp-width <px>` | `1280` / `720` | WebP width for 16:9 / 9:16 |
| `--webp-max <MB>` | `5.5` | WebP budget; quality steps down to fit |
| `--no-webp`, `--no-mp4` | | skip one output |
| `--no-avatar` | | don't fetch the author's GitHub avatar |
| `--no-brand` | | hide the small "made with prcine" credit |
| `--still <t,...>`, `--still-only` | | write PNG frames at these seconds |
| `-C, --cwd <dir>` | `.` | repository for git ranges |

## What goes into the video

1. **Title card.** Repo, PR number, author avatar, merged/open state, commit and file counts, and a counter that rolls up `+additions −deletions`.
2. **Files.** Every changed file with a diffstat bar. The files about to be shown light up.
3. **Highlights.** prcine scores every hunk and picks the densest windows from the files that matter. Lockfiles, `dist/`, snapshots, generated code and binaries are never picked; tests, docs and config rank below source. Deleted lines get struck through, added lines are typed in with syntax highlighting (Shiki grammars for 60+ file types), and the camera pushes in on the line being written.
4. **Outro.** Totals and the PR link. The last frames fade to the first, so the WebP loops cleanly.

Everything is drawn with Skia ([@napi-rs/canvas](https://github.com/Brooooooklyn/canvas)): no headless browser, no screen recording, and the same input always gives the same frames.

## Examples

| `vitejs/vite#24044`, 16:9 | `oven-sh/bun#47555`, 9:16 |
|---|---|
| <img src="docs/vite-24044.webp" width="560" alt="vite PR walkthrough"> | <img src="docs/bun-47555-vertical.webp" width="250" alt="bun PR walkthrough, vertical"> |

## On every pull request (GitHub Action)

[`examples/github-action/prcine.yml`](examples/github-action/prcine.yml) renders each PR, uploads the MP4 and WebP as artifacts, pushes the WebP to a `prcine-media` branch and comments it on the PR, so reviewers see the walkthrough inline. Copy it to `.github/workflows/prcine.yml`. It skips PRs from forks, whose token can't push.

## For coding agents

[`skills/prcine/SKILL.md`](skills/prcine/SKILL.md) teaches Claude Code, Codex, Cursor and other agents to make these videos ("make a demo video of this PR"). Copy the folder into your agent's skills directory.

## How it compares

|  | **prcine** | [gitlogue](https://github.com/unhappychoice/gitlogue) | [cinecode](https://github.com/sarpstar/cinecode) | screen recording |
|---|---|---|---|---|
| What it is | PR/range → video file | commit replay in your terminal | agent kit that films anything in code | you, OBS and a diff |
| Input | PR URL, `owner/repo#N`, git range, commit | local commits | a prompt and a conversation | |
| Output | MP4 + looping WebP, 16:9 / 9:16 / 1:1 | live terminal (record it yourself) | MP4 | MP4 |
| Picks the important hunks | yes | replays every change | the agent decides | you scroll |
| Needs | Node, ffmpeg for MP4 | Rust binary | an AI coding agent, Chrome, GPU | time |
| Time for one PR | ~1 min, one command | real time | a session | 10+ min |

gitlogue is a lovely ambient screensaver and the right tool for watching history unfold live. cinecode makes real films. prcine does one narrow thing: a short, shareable clip of one change, made in a minute.

## Development

```bash
git clone https://github.com/kevin9327/prcine && cd prcine
npm install
npm test                      # builds and runs node --test
node dist/cli.js HEAD --still 2,6,12 --still-only
```

Code map: `src/source.ts` (GitHub API / git), `src/diff.ts` (unified diff parser), `src/pick.ts` (hunk scoring), `src/render.ts` (scenes), `src/webp.ts` (animated WebP muxer), `src/encode.ts` (ffmpeg).

## Credits

Typeset in [Geist and Geist Mono](https://vercel.com/font) (SIL OFL 1.1, bundled in `assets/fonts`). Syntax colors from Shiki's `vitesse-dark` theme. The example videos show public pull requests from [facebook/react](https://github.com/facebook/react), [vitejs/vite](https://github.com/vitejs/vite) and [oven-sh/bun](https://github.com/oven-sh/bun); the code belongs to their authors.

## License

[MIT](LICENSE)
