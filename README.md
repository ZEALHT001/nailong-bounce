# 奶蛙弹跳 (Nailong Bounce)

A four-level 2.5D bounce platformer starring 奶蛙. Hold to squash and charge, release to launch,
chain bounce pads, collect fish treats, and reach the flag. Everything is procedural Three.js —
no external models, textures, or audio files.

**在线试玩: https://zealht001.github.io/nailong-bounce/**

手机浏览器直接打开即可,竖屏体验最佳(相机已按窄屏重新构图,并且长按蓄力键不会触发系统选择菜单)。

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5188
```

## Deploy

The live site is served by GitHub Pages from the `gh-pages` branch. To publish an update:

```bash
bash scripts/deploy-pages.sh
```

The script builds with the `/nailong-bounce/` base path, commits the output to `gh-pages` from a
throwaway checkout (the working tree and `main` are never touched) and pushes it. `main` stays
source-only; published files are generated.

> `base` must match the repository name, because a Pages *project* site is served from
> `/<repo>/`. If you fork this to a different repository name, pass the path explicitly:
> `bash scripts/deploy-pages.sh <owner>/<repo> /<repo>/`

## Play it from another device on the same network

The dev server listens on every interface, so any phone, tablet or laptop on the same LAN can
open it. Start the server and read the `Network:` line Vite prints:

```bash
npm run dev
#   ➜  Local:   http://localhost:5188/
#   ➜  Network: http://<your-lan-ip>:5188/
```

Open the `Network` URL on the other device. The layout is responsive with touch controls, so a
phone works as-is.

On a phone the game is best played in portrait: the camera reframes for narrow viewports so the
next platform is visible ahead of you. Holding a control never selects text or opens the system
copy menu.

Checklist if another device cannot connect:

- Both devices must be on the same network/subnet; guest Wi-Fi or client isolation will block it.
- Find the host address with `ipconfig getifaddr en0` on macOS.
- Allow incoming connections for `node` if the macOS firewall prompts (this host currently has the
  firewall off).
- To share a frozen copy instead of a live dev server, run `npm run build && npm run preview` and
  share `http://<your-lan-ip>:4188/`.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `A` / `D` or `←` / `→` | left / right buttons |
| Charge & launch | hold / release `Space` or `W` / `↑` | hold / release the 蓄力 button |
| Restart | `R` | — |
| Pause | `P` / `Esc` | pause icon |
| Mute | `M` | speaker icon |

## Scripts

```bash
npm run build             # production build
npm test                  # desktop + mobile browser tests
npm run inspect:canvas    # canvas render diagnostics + screenshot
npm run verify:visual     # visual regression

node scripts/measure-jumps.mjs          # print the charge -> jump-distance envelope
node scripts/shoot-hero.mjs             # render the hero model from four angles
bash scripts/deploy-pages.sh            # publish the build to GitHub Pages
```

Every level has a scripted completion bot in `tests/level-completion.spec.ts`. It measures the
real jump envelope, then plays each level with real input, so a gap that cannot be cleared or a
moving platform that throws the frog off fails the suite.

`tests/jump-reliability.spec.ts` covers the jump input itself, including the two cases players
report as "sometimes the jump does not come out": a jump released just before landing (buffered
for 0.16 s) and a tap shorter than a single frame (latched). `tests/input-fuzz.spec.ts` then runs
seeded random input over all four levels and asserts the frog is never embedded in geometry, never
produces NaN, and never stops being simulated.

`hero.html?view=front|three-quarter|side|back&state=idle|charge|launch|fall|land|hurt|celebrate`
is a standalone model preview used to author the frog.

## Layout

```text
src/core/        loop, renderer, input intents
src/entities/    NailongModel (procedural hero), Player (body + render sync)
src/game/        Game (loop, state machine, level flow), levels (data)
src/systems/     PlatformerPhysics, LevelWorld, CameraRig, Hud, AudioSystem, VfxSystem, DebugTools
src/world/       PropKit (cached procedural props, platform blocks, backdrops)
tests/           bot playtests, level completion, visual smoke tests
artifacts/       design docs, evidence, captures
```

## Design and evidence

- `artifacts/game-progress.md` — design brief, core loop contract, level plan, tuning log.
- `artifacts/final-evidence.md` — physics numbers, jump envelope, test results, render metrics.
