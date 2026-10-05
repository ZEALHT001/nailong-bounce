# 奶蛙弹跳 (Nailong Bounce) — Progress & Design

## Design brief

**Player promise.** You are a soft, round 奶蛙: squash yourself down, launch into the air,
and bounce across a bright candy-nature archipelago to reach the flag.

**Target feeling.** Weighty squash-and-stretch launch, a satisfying thump on landing, and the
little thrill of a bounce pad flinging you higher than you planned.

**Primary verb.** Charge & launch — hold to squash and build power, release to fire an arc.

**Secondary verbs.** Steer mid-air, chain green bounce pads, grab fish treats.

**Repeated every 5–30s.** Read the next gap, choose a charge level, launch, adjust in the air,
land or bounce.

**Changes across 1–5 min.** Gaps widen; spikes, water and moving platforms appear; bounce pads
start chaining; later levels demand a pad bounce into a moving platform.

**Lose / learn / restart.** Fall in water or touch spikes → the frog pops, the level snaps back
to the start in well under a second, and the retry drops you straight back into play.

**Reward & risk.** Fish treats are the score; three hidden-route treats per level reward a
harder line. Over-charging overshoots the platform, under-charging falls short, and a pad bounce
can throw you into a hazard you did not read.

**What a better player does differently.** Chains pad bounces, uses the extra hang time to
collect high treats, and lands on the far edge to save momentum.

**How the next decision is communicated.** A live power meter on the frog itself, a tinted
landing arc preview when grounded, glowing pads, and hazard colours that never lie.

**Non-goals for this slice.** No combat, no inventory, no procedural level generation, no
unlockable cosmetics.

## Core loop contract

`Player charges and launches the 奶蛙 to reach the goal flag while water, spikes and moving
platforms create risk; success gives collected treats, a star rating and the next level,
failure causes a fast respawn at the level start.`

Proof in code:

- Verb → real input: hold-to-charge is mapped from keyboard (Space) and touch (charge button).
- Objective → visible: the flag, and a directional hint when it is off-screen.
- Pressure → inside the first minute: level 1 ends on a water gap; level 2 introduces spikes.
- Reward → changes state: treats increment score + star rating, collected treats stay collected.
- Failure → teaches: the frog pops in place, a short banner names the cause, respawn is instant.
- Restart → fast: retry re-seeds state and teleports to spawn in the same frame.

## Level plan

| # | Name | Theme | Teaches | Hazard | Bounce pads |
| - | ---- | ----- | ------- | ------ | ----------- |
| 1 | 甜筒草地 | 0 mint meadow | charge amount vs. gap width | one final water gap | 1 |
| 2 | 果冻栈道 | 1 coral jelly | moving platforms, timing | spike clusters | 2 |
| 3 | 弹跳峡谷 | 2 sky canyon | pad chains, high routes | water + spikes | 4 |
| 4 | 棉花云顶 | 3 cloud top | pads + movers + narrow ledges | all three | 5 |

**Spatial format.** A horizontal corridor roughly 60–90 units long, played in a fixed side-on
camera. The camera sees about 24 units of width, so a gap further than ~8 units is unreadable
and is never authored.

**Escalation.** Every level opens with one free gap to re-teach the verb, then widens to the
hardest jump before the goal. Three treats per level sit on a deliberately risky line.

**Modular pieces.** Platform, moving platform, bounce pad, spike, water, treat, flag. All are
parameterised by the level data in `src/game/levels.ts`.

## Physics decision

Custom fixed-timestep AABB platformer collision, not Rapier. A charge-jump platformer is
authored feel, not simulation: the arc must be bit-identical frame to frame and the contact
response must be hand-tuned, so the "authored feel matters more than simulation" rung of the
physics ladder is the correct one. Timestep 1/120 s with a clamped accumulator, circle-free
axis-separated AABB resolution, one-way platforms resolved on the descending axis only.

## Status

- [x] Scaffold, dependencies
- [x] Design brief, core loop contract, level plan
- [x] Hero model (`src/entities/NailongModel.ts`, preview harness `hero.html`)
- [x] Physics + controller (`src/systems/PlatformerPhysics.ts`, `src/entities/Player.ts`)
- [x] Level data (`src/game/levels.ts`, four levels)
- [x] World props (`src/world/PropKit.ts`) and level assembly (`src/systems/LevelWorld.ts`)
- [x] Audio (`src/systems/AudioSystem.ts`, procedural Web Audio)
- [x] Camera, HUD, overlays, VFX
- [x] Verification: build, screenshots, canvas inspection, bot completion run

## Tuning log

- Launch velocity is set by charge directly (`launchSpeedMin`/`launchSpeedMax`) so charge maps to
  distance instead of being diluted by the run speed. Run speed is only for positioning.
- Air control accelerates toward the run cap but never brakes a faster launch, so a full-charge
  arc keeps its reach.
- Bounce pads became trigger volumes rather than colliders: as solid boxes they blocked the frog
  from the side and forced a step-up that did not exist.
- Platform blocks stack the cap on top of a shortened body instead of sharing a top plane; the
  coplanar faces z-fighted into a speckled patch on every platform.
- Decorative props and the backdrop no longer cast shadows; the blur read as a stain on the
  platform tops and cost shadow budget better spent on the hero and pads.
- `InputController.endFrame()` must run every frame. Without it, a Space press stayed in the
  "just pressed" set forever and auto-confirmed the fail overlay the instant it appeared.
- Moving platforms advanced once per rendered frame while physics ran several substeps, so a
  rider inherited the frame's whole delta on every substep and moved 2-8x the platform's real
  motion. Players feel this as "I land on the floating step and get bounced off". Movers now
  advance inside the fixed-step loop.
- Bounce pads preserved a near-max-charge launch speed, which threw the frog up to 12 units past
  the platform the pad was meant to deliver it to. Pad launches now clamp horizontal speed into
  the steerable range.
- Level authoring bug found by the new bots: level 3 had 6.1-unit gaps that exceed the maximum
  jump from a platform lip, and level 4 dropped a moving platform into a bounce-pad landing zone.
- A jump released a moment before landing was discarded outright (no launch, no feedback). There
  is now a 0.16 s jump buffer, plus a tap latch for presses that begin and end inside one frame,
  which no physics step could ever observe.
- The physics accumulator only gained time, so a device that could not keep up drifted into
  permanent slow motion. Leftover time is now dropped once the substep budget is spent.

## Input model

| Situation | Behaviour |
| --- | --- |
| Hold, release while grounded | Launch immediately, power = charge |
| Hold, release while airborne | Queued for 0.16 s, fires on touchdown |
| Tap shorter than one frame | Latched and queued as a minimal jump |
| Hold through a landing | Charge starts from zero on touchdown |
| Press again while a buffered jump is pending | The active hold wins; the stale buffer is dropped |
| Bounce pad fires | Buffer cleared: the pad owns the next moment |

## Test coverage by level

Every level has a scripted completion run using real input (`tests/level-completion.spec.ts`).
The bot measures the jump envelope from the shipped integrator, walks to each lip, waits for a
moving platform's closest approach, picks the charge that lands nearest the platform centre, and
rides out pad bounces while holding the direction. Whole hops execute inside the page because
driving each key press over the test protocol costs about a second per round trip here, which
made a cross-process key release land long after the frog had walked off the platform.
