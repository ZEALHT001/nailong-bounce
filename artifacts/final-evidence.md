# 奶蛙弹跳 (Nailong Bounce) — Final Evidence

## What was built

A four-level 2.5D side-view bounce platformer starring 奶蛙: hold to squash and charge, release
to launch in a readable arc, chain green bounce pads, collect fish treats, and reach the flag.
The whole game is procedural Three.js — no external models, textures, or audio files.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `A` / `D` or arrow keys | left / right buttons |
| Charge & launch | hold / release `Space` or `W` / `↑` | hold / release the round 蓄力 button |
| Restart level | `R` | — |
| Pause | `P` or `Esc` | the pause icon |
| Mute | `M` | the speaker icon |
| Confirm overlay | `Space` / `Enter` | the primary button |

## Design artifacts

- [game-progress.md](./game-progress.md) — design brief, core loop contract, level plan, physics decision.

## Physics

**Engine:** custom fixed-timestep AABB platformer collision (`src/systems/PlatformerPhysics.ts`),
deliberately chosen over Rapier. A charge-jump platformer is authored feel rather than
simulation: the arc must be frame-identical and the contact response hand-tuned, which is the
"authored feel matters more than simulation" rung of the physics ladder.

| Property | Value |
| --- | --- |
| Timestep | fixed 1/120 s, clamped accumulator, max 8 substeps per frame |
| Body | one AABB, `0.56` half-width x `1.566` height (matches the visual frog) |
| Resolution | axis-separated sweep, horizontal then vertical, leftover time on the second axis |
| Pads | trigger volumes, never colliders — a solid pad would block the frog from the side |
| Pad launch | vertical boost plus a horizontal speed *clamped* into the steerable range |
| Movers | kinematic colliders that publish a per-step delta; riders inherit it before the sweep |
| Mover stepping | advanced inside the fixed-step loop, one step per physics step |

## Fixes from playtest feedback

Reported: "level 2's first floating step — I jump on it and get bounced off, it feels stuck."

That was real, and it had a second cause hiding behind it.

1. **Riders moved 2-8x the platform.** Moving platforms computed one delta per rendered frame, but
   a frame runs several 1/120 s physics substeps and the rider inherited that delta on every
   substep. The frog fell off and was snapped back repeatedly: measured as grounded on only 75.8%
   of frames. Movers now advance inside the fixed-step loop (`LevelWorld.advanceMovers`), so the
   rider inherits the motion of one step and stays on the platform.
2. **The bot had only ever completed level 1.** Levels 2-4 were validated for gap geometry but
   never played end to end. Once all four ran, three more real problems surfaced: level 3 had
   6.1-unit gaps that exceed the maximum jump from a platform lip, bounce pads flung the frog
   12 units past the platform they were meant to deliver it to, and level 4 put a moving platform
   inside a pad landing zone. All three are fixed and covered by tests.

Reported next: "sometimes the jump still gets stuck."

Three input-side bugs, each of which shows up only intermittently in play. All three are now
covered by failing-first tests in `tests/jump-reliability.spec.ts`.

1. **A jump released just before landing was eaten.** The launch was only allowed while the frog
   was grounded, so letting go a frame early discarded the whole charge with no jump and no
   feedback. Players release jump early constantly; this is the classic "sometimes my jump does
   not come out". Now a released jump is **buffered for 0.16 s** and fires on touchdown. A hold
   that never had a chance to charge (released mid-air) also counts as a request.
2. **A tap shorter than one frame was swallowed.** At a low frame rate no physics step ever
   observed the button as held, so press+release inside one frame produced no jump at all. The
   input layer now latches that tap and queues it as a minimal buffered jump.
3. **The physics accumulator could grow without bound.** It only ever gained time, so a device
   that could not keep up fell into permanent slow motion — everything gets sticky rather than
   looking like a frame-rate problem. Leftover time is now dropped once the substep budget is
   spent.

## Level changes

- Level 2: the spike cluster moved out from under the moving platform's travel, so landing *on*
  the platform is always safe and only falling short is punished.
- Level 3 and 4: re-authored so every gap is inside the jump envelope with slack, and every pad
  lands the frog on a platform rather than past it.
- Bounce pads now normalise horizontal speed into `[padSpeed, maxSpeed]` instead of preserving a
  near-max-charge launch speed.

## Measured jump envelope

`scripts/measure-jumps.mjs` drives the deterministic `measureJump` test hook, which runs the
shipped integrator on an isolated flat runway. Real numbers:

| Charge | 0.10 | 0.20 | 0.30 | 0.40 | 0.50 | 0.60 | 0.70 | 0.80 | 0.90 | 1.00 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Distance | 2.05 | 2.47 | 2.89 | 3.22 | 3.56 | 3.81 | 4.51 | 5.27 | 6.14 | 7.00 |
| Apex | 0.90 | 1.09 | 1.30 | 1.52 | 1.77 | 2.03 | 2.31 | 2.60 | 2.92 | 3.25 |

Every authored gap in all four levels sits inside this envelope, and every level has at least one
gap that cannot be cleared by the shortest hop — verified by
`tests/level-completion.spec.ts › every authored gap is inside the measured jump envelope`.

## Verification run

`npx playwright test` — **18 passed, 10 skipped** (mobile skips are the desktop-only keyboard bots).

| Test | What it proves |
| --- | --- |
| `bot completes level 1..4` (4 tests) | Real input, charge per gap, reaches every flag and scores |
| `jump distance grows with charge` | The charge-to-distance curve is monotonic |
| `every authored gap is inside the measured jump envelope` | Level data and physics still agree, all 4 levels |
| `the frog rides a vertical mover without being thrown off` | Stays grounded for >90% of a full travel cycle |
| `standing still on a mover keeps the frog at the platform top` | Feet track the platform top, never sink or float |
| `a jump released just before landing still fires` | Jump buffer: no eaten jumps |
| `a jump held through the landing fires as soon as the frog is down` | Holding through a landing charges |
| `a very short tap of the jump button is not swallowed` | Tap latch: one-frame presses still jump |
| `landing on the lip of a platform lands on top` | Corner landings settle on the platform |
| `a platform seen as a step is not blocked while walking` | The frog is never blocked short of a lip |
| `a horizontally moving platform pushes the frog out instead of trapping it` | Movers never embed the frog |
| `random input never wedges the frog inside geometry` | 700 fuzzed frames x 4 levels: no embed, no NaN, no freeze |
| `charge-and-move covers ground without errors` | Launches and landings register under scripted play |
| `hazards fail the run and retry returns to the spawn` | Fail state and retry flow |
| `pause stops simulation and resume restores it` | Pause does not advance game state |
| `audio unlocks on a real gesture and mute is honoured` | Web Audio unlocks on a gesture; mute round-trips |
| `renders a non-blank game canvas` (desktop + mobile) | Canvas is non-blank on both target viewports |
| `the frog charges and moves right under real input` (desktop + mobile) | Keyboard and touch both drive the verb |

`npm run build` — production build succeeds.

## Render measurements

From `scripts/inspect-threejs-canvas.mjs` on hardware GPU (Apple M2, not software fallback):

| View | Draw calls | Triangles | Geometries | Textures | Console/page errors |
| --- | --- | --- | --- | --- | --- |
| Desktop 1280x720 | 57 / 300 | 24,096 / 750,000 | 26 / 300 | 5 / 60 | 0 |
| Mobile 390x844 | 47 / 150 | 22,232 / 300,000 | 21 / 200 | 5 / 40 | 0 |
| Level 2 | 53 / 300 | 22,660 / 750,000 | 26 / 300 | 5 / 60 | 0 |
| Level 3 | 55 / 300 | 22,564 / 750,000 | 29 / 300 | 5 / 60 | 0 |

## Captures

| File | Content |
| --- | --- |
| `artifacts/canvas-inspection/desktop.png` | Level 1 gameplay, desktop |
| `artifacts/canvas-inspection/mobile.png` | Level 1 gameplay, mobile with touch controls |
| `artifacts/canvas-inspection/mobile-charging.png` | Charge pose, squash, and the charge meter on mobile |
| `artifacts/canvas-inspection/desktop-level-2.png` | Level 2, moving jelly platforms and spikes |
| `artifacts/canvas-inspection/desktop-level-3.png` | Level 3, pad chains over water |
| `artifacts/canvas-inspection/desktop-level-4.png` | Level 4, pads and moving clouds |
| `artifacts/canvas-inspection/desktop-fail.png` | Fail overlay |
| `artifacts/canvas-inspection/desktop-level-complete.png` | Level-complete overlay with star rating |
| `artifacts/hero/idle-front.png` | Hero model, game camera angle |
| `artifacts/hero/idle-three-quarter.png` | Hero model, three-quarter view |
| `artifacts/hero/idle-side.png`, `idle-back.png` | Hero model, remaining angles |

## Hero model

`src/entities/NailongModel.ts` builds the frog procedurally: a `LatheGeometry` pear body, a
painted cream belly in UV space (so the silhouette never gets a bump from a second mesh), sphere
eyes on the head surface, and jointed stubby arms and feet with digits. `NAILONG_SCALE`,
`NAILONG_HEIGHT` and `NAILONG_HALF_WIDTH` are exported so the render model and the physics body
can never drift apart. The frog is yawed 0.55 rad toward the camera so both eyes and the belly
read in a side-on view.

Authored with `scripts/shoot-hero.mjs` (see `hero.html`), which renders the model in isolation
from four angles and six animation states.

## Audio

`src/systems/AudioSystem.ts` is fully procedural Web Audio: a master gain into a
`DynamicsCompressorNode` limiter, a persistent charge voice that sweeps 170→710 Hz, event sounds
for launch, land, bounce, collect, hurt, win and level start, and a warm four-oscillator pad with
a scheduled arpeggio whose brightness rises with danger. Every method is a safe no-op when
`AudioContext` is missing, and nothing sounds before the first user gesture.

## Known limitations

- Mobile skips the scripted keyboard bots; mobile is covered by the canvas, real-input, and
  charge-curve tests, plus captures, but not by a full touch playthrough of the level.
- The bot minimises overshoot when picking a charge; it does not model the platform's exact
  position at landing time, so it waits for a mover's closest approach and aims at its centre.
- The jump buffer is 0.16 s. That value is a feel choice, not a measured one: it is long enough
  to catch an early release and short enough not to fire an unwanted jump after a deliberate
  mid-air release.
- Bounce-pad timing on moving platforms is authored by judgement, not verified by a bot.
- Audio balance was tuned against target levels, not by ear in this environment.
