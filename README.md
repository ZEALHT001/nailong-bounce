# 奶蛙弹跳 (Nailong Bounce)

A four-level 2.5D bounce platformer starring 奶蛙. Hold to squash and charge, release to launch,
chain bounce pads, collect fish treats, and reach the flag. Everything is procedural Three.js —
no external models, textures, or audio files.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5188
```

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
