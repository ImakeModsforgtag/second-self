# SECOND SELF

A minimalist first-person puzzle game for VR (WebXR, Meta Quest) and desktop.
You solve twelve concrete test chambers with three tools: a copy of yourself,
mirrors that bend laser beams, and crates you can lift and stack. Then the lift
carries you above the clouds for eight sky chambers with a fourth tool: the
Kickback gun.

Built with Three.js, WebXR and Vite. Everything (textures, models, hands, sound)
is generated in code, so there are no external assets to go missing.

---

## Run it locally (Windows)

You need Node.js 18 or newer (20 LTS recommended) from https://nodejs.org.

1. Press the Windows key, type `cmd`, press Enter.
2. Paste these lines (this assumes the zip is in your Downloads folder):

```bat
cd /d "%USERPROFILE%\Downloads"
tar -xf second-self.zip
cd second-self
npm install
npm run dev
```

3. Open http://localhost:5173 in Chrome or Edge.

Other useful commands, run inside the `second-self` folder:

```bat
npm test
npm run build
npm run preview
```

* `npm test` runs the mechanics checks and the automated playthrough that solves all 20 levels.
* `npm run build` makes the production files in `dist`.
* `npm run preview` serves the production build at http://localhost:4173.

VR needs HTTPS, so test VR with the Render URL (below) rather than localhost.

---

## Publish on Render.com

### 1. Put the project on GitHub

Create an empty repository on github.com (for example `second-self`), then in a
new Command Prompt:

```bat
cd /d "%USERPROFILE%\Downloads\second-self"
git init
git add .
git commit -m "SECOND SELF"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/second-self.git
git push -u origin main
```

### 2a. Deploy as a Static Site (dashboard)

1. Go to https://dashboard.render.com and choose **New > Static Site**.
2. Connect your GitHub account and pick the `second-self` repository.
3. Use these settings:

| Setting | Value |
|---|---|
| Branch | `main` |
| Root Directory | (leave empty) |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Environment variables | none needed |

4. Click **Create Static Site**. When the build finishes, your game is live at
   `https://second-self-xxxx.onrender.com` (HTTPS is automatic).

### 2b. Or deploy with the included Blueprint

The repo includes `render.yaml`. In the Render dashboard choose
**New > Blueprint**, pick the repository, and click **Apply**. It creates the
same static site, plus cache headers.

Every `git push` to `main` redeploys automatically.

---

## Play in VR (Meta Quest)

1. On the headset, open the **Meta Quest Browser** and go to your Render URL.
2. Click **Enter VR** on the main menu and allow the VR permission.
3. Pick a chamber on the floating menu with the controller trigger.

Any WebXR browser with a headset works too (for example Chrome with a PC VR headset).

### VR controls

| Control | Action |
|---|---|
| Left stick | Walk (smooth mode) |
| Right stick left/right | Snap turn |
| Right stick forward, release | Teleport (aim the arc) |
| Grip | Grab a crate or portable mirror (reach for it, or point at it). Twist your wrist to turn it. Grip a fixed mirror and twist to rotate it |
| Trigger | Use: press switches, turn mirrors, create a clone at a pod |
| Touch a wall switch | Presses it |
| Right trigger (sky chambers) | Fire the Kickback gun. Left trigger then handles switches and mirrors |
| A | Jump |
| B | Create clone |
| X | Reset clone |
| Y | Menu (resume, restart, remove clone, movement mode, exit VR) |

Settings include smooth or teleport-only movement, snap angle, and a comfort vignette.

### Desktop controls

| Key | Action |
|---|---|
| W A S D | Move (Shift to walk slowly) |
| Mouse | Look |
| Left mouse | Grab / release |
| Mouse wheel | Hold distance |
| E | Interact, or turn a mirror clockwise |
| Q | Turn a mirror (or held object) the other way |
| F | Create clone |
| R | Reset clone |
| Space | Jump |
| Right mouse or G | Fire the Kickback gun (sky chambers) |
| Esc | Pause |

Keys can be rebound in **Settings**.

---

## How the mechanics work

**The clone.** Clones appear at a pod. A clone reacts only while you are inside
its field of view (in front of it) and nothing solid is between you. While it
sees you, it turns toward you and walks forward to your current position. It
never walks backward. The moment it loses sight of you, it freezes exactly where
it is. It is a solid body with gravity: it presses plates, blocks lasers, steps
onto plates, but cannot climb ledges, jump, or pass through walls, low barriers,
crates or closed doors. The ring at its feet glows blue while it can see you.
One clone at a time; creating a new one recalls the old copy.

**Lasers.** Beams travel in straight lines, reflect off mirrors (angle in equals
angle out), stop at any solid object (walls, doors, crates, your clone), and
update instantly. Lit receivers glow. A receiver with a red ring and slash is a
lock: its door wants it dark.

**Crates.** Real gravity and collision. They stack, stay where you put them,
press plates, block beams, and make stairs. A blue footprint shows where a held
crate will land.

**The Kickback gun** (chambers 13 to 20). The pulse pushes you away from
whatever it hits within about 4.5 m: shoot the floor to launch about twice as
high as a jump, shoot a wall in front of you to fly backward across a gap, and
shoot a wall just under you to kick upward. You get two shots per jump (the
pips on the gun and under the crosshair); they refill when you land or touch a
blue grip panel, so grip panels can be climbed as high as they go. Pulses also
press switches and bullseye targets and turn mirrors one step from far away.
Falling off returns you to the last checkpoint ring you stood on.

**Doors** show a lamp for each requirement, with a letter that matches the
plate, receiver or switch that feeds it. Some doors stay open once triggered;
others need their conditions held. Doors will not close on you.

---

## Levels

| # | Name | Difficulty | Introduces |
|---|---|---|---|
| 1 | The First Copy | Very easy | Movement, clone pod, pressure plate, door |
| 2 | Out of Sight | Easy | Guiding a clone around corners, freezing it behind a wall, a door needing two plates |
| 3 | Weight and Height | Easy to medium | Lifting, rotating and stacking crates, ledges, a small gap, an elevated switch, a staircase |
| 4 | Refraction | Medium | Emitters, rotatable mirrors, receivers |
| 5 | The Split Path | Medium to hard | Three emitters, a lock receiver, a portable mirror on sockets, blocking a beam |
| 6 | Two of You | Hard | A clone-powered emitter, aiming mirrors out of the clone's sight, a door needing a plate and a receiver, the clone blocking a beam |
| 7 | Countdown | Hard | Timed switches: press, then race to the door before it shuts |
| 8 | Stand-In | Hard | One crate, two jobs: your clone becomes the beam blocker |
| 9 | Build Your Way Out | Very hard | Two chambers combining every mechanic, with an order that matters |
| 10 | Elevation | Very hard | Stacking crates to lift a mirror into a high beam, plus a climb |
| 11 | Mirror Image | Very hard | A mirror used as a blocker, a shelf plate, and a clone watching a doorway |
| 12 | The Final Experiment | Extremely hard | Four chambers and a stair corridor, all mechanics together, ending in the lift to the sky |
| 13 | Kickback | Easy | The Kickback gun: gun jumps and shooting a bullseye |
| 14 | Wall Climber | Easy to medium | Blue grip panels versus plain concrete |
| 15 | Rebound | Medium | Wall bounces across gaps |
| 16 | Trick Shots | Medium to hard | Turning floating mirrors and hitting far targets with shots |
| 17 | Updraft | Hard | Carrying a crate while you launch, crate steps |
| 18 | Sky Copy | Hard | Your clone holds a plate while you climb a tower for a hidden bullseye |
| 19 | Crosswind | Very hard | Bounce, shoot three floating mirrors (one turns a lock beam aside), climb |
| 20 | The Summit | Extremely hard | Clone, both crates, two beams, a lock, a bullseye and a climb, ending in the final ascent |

Every level is hand built and has a verified solution: `tests/playthrough.mjs`
solves all twenty using only player actions (walk, jump, look, grab, interact,
create clone, fire). The clone is moved only by its own AI.

---

## Project layout

```
index.html              menus and HUD markup
src/main.js             app shell: renderer, VR session, game loop
src/config.js           tuning constants, settings, key bindings, save data
src/sim/                pure game logic (runs in the browser and in Node tests)
  physics.js            AABB physics: gravity, swept collision, stacking
  clone.js              clone AI (field of view, line of sight, walking)
  laser.js              beam tracing and mirror reflection
  game.js               plates, buttons, doors, receivers, pods, exits, hints
src/levels/             level builder, chambers 1 to 12 (levels.js), sky chambers 13 to 20 (sky.js)
src/render/             view (scene building), procedural textures, hands, clone model
src/input/              desktop (keyboard/mouse) and VR controllers
src/ui/                 HTML menus and the in-headset VR panel
src/audio/audio.js      synthesised sound effects and ambience
tests/                  mechanics checks and full-game playthrough
render.yaml             Render Blueprint (static site)
```

All sound effects are synthesised at runtime with the Web Audio API (original, no
samples). There is no music.
