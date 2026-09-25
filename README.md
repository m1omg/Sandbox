# Rail Rascals

A 3D endless runner for the browser. Sprint down a sunny rail yard as **Kit**, a street artist on the run from the grumpy **rail-yard warden**. Dodge trains, jump hurdles, roll under gates, run up ramps onto train roofs and grab coins and power-ups.

All characters, names, art, sound and music in this project are original.

**Play online:** https://m1omg.github.io/Sandbox/ — or the classic look: https://m1omg.github.io/Sandbox/?theme=classic

## Two looks

- **City** (default): textured trains, graffiti walls and a row of apartment blocks along the line.
- **Classic**: a bright, cel-shaded rail line: sandy track bed with chunky sleepers, overhead-line gantries and sagging wires, red arched retaining walls topped with hedges, avenues of round trees, rows of gabled houses behind picket fences, red-and-white signal posts, and toon trains (four passenger liveries plus a ribbed freight wagon). The camera sits higher and looks down more steeply. Everything in this look is built from coloured geometry, so it loads no textures at all.

Switch with the **Look** button on the title screen (the choice is remembered), or with `?theme=classic` / `?theme=city` in the URL. Gameplay, progress and the shop are shared between the two.

## Playing

The game is a static site with no build step. ES modules and model loading need HTTP, so serve the folder rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works too. The live copy is served by GitHub Pages straight from the `main` branch root (*Settings → Pages → Deploy from a branch → `main` / `(root)`*). The empty `.nojekyll` file tells Pages to serve the files as-is.

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Switch lanes | ← → / A D | Swipe left / right |
| Jump | ↑ / W / Space | Swipe up |
| Roll (fast drop in mid-air) | ↓ / S | Swipe down |
| Hoverboard | E / Shift | Double-tap, or the board button |
| Pause | P / Esc | Pause button |
| FPS counter | F | "FPS" chip on the title screen |

## Features

- **Three lanes** with stationary trains, oncoming trains (headlights on) and ramps up to walkable train roofs.
- **Hurdles** (jump over) and **"DUCK!" gates** (roll under).
- **Stumbles:** clip an obstacle from the side and you bounce back while the warden closes in. Stumble again while he's close and you're caught.
- **Power-ups:** Jetpack (fly above everything along a sky coin trail), Spring Sneakers (super jumps, reach roofs from the ground), Coin Magnet, 2x Score.
- **Hoverboards** absorb one crash and last 30 s. You start with 3; buy more in the shop.
- **Shop:** spend coins to extend power-up durations (5 levels each) and buy hoverboards. Upgrades are permanent and apply automatically whenever you pick up that power-up. Bought hoverboards are used during a run with E / Shift, a double-tap, or the board button in the bottom-right corner. Progress, best score and settings are saved in `localStorage`.
- **Fair procedural levels:** the generator guarantees at most two lanes are ever walled off by trains and clears the full approach path of every oncoming train.
- **Music with real instruments (classic look):** an original, swung street/hip-hop groove played on recorded samples: drum kit, congas, fingered electric bass, electric piano, brass stabs, steel drums, marimba and pizzicato strings. It uses the same ever-changing song structure as the city soundtrack. The samples total about 260 KB and load only in the classic look. If they can't load, the game falls back to the synthesised soundtrack.
- **FPS counter:** toggle it with F or the title-screen chip. It shows frames per second and average frame time, and the setting is remembered.
- **Synthesised audio:** WebAudio sound effects, no audio files. The music is composed procedurally while you play: it moves between intro, verse, chorus, bridge and breakdown sections, each with its own chord progression, drum and bass patterns and a newly generated melody, plus fills, risers and the occasional key change, so it doesn't loop.
- **City rail-yard setting:** grass verges with shrubs, graffiti walls, rows of apartment blocks with rooftop water towers, open stretches with trees behind a fence, and yellow signal gantries over the tracks. Buildings are regenerated as the track scrolls, so the street never repeats exactly.
- **Responsive:** works in landscape and portrait, with mouse, keyboard or touch.

## Frame-rate independence

The simulation runs on a fixed 1/120 s timestep driven by real elapsed time, and rendering interpolates between the last two simulation states. The level generator uses its own seeded RNG, kept separate from visual-only randomness. So the game plays identically on 30 Hz, 60 Hz, 144 Hz, 240 Hz or any other display. A test run of the same seeded level with the same inputs gave bit-identical results from 30 Hz up to 360 Hz. Purely visual things (animation, particles, camera smoothing) also scale with real time.

## Project layout

```
index.html          page, HUD and menu markup
css/style.css       UI styling
src/
  main.js           renderer, asset loading, UI wiring, main loop
  game.js           game state machine, collisions, scoring, camera
  player.js         runner physics, poses, hoverboard and jetpack visuals
  chaser.js         the warden
  character.js      GLB material and clip cleanup, procedural pose rig
  generator.js      procedural level generator
  obstacles.js      trains, ramps, hurdles, gates, ground and collider queries
  pickups.js        coins (instanced) and power-up items
  world.js          city look: track segments, walls, buildings, skyline, lighting
  world_classic.js  classic look: cel-shaded track, overhead line, walls, trees, houses
  trains_toon.js    toon train cars for the classic look
  toon.js           cel-shading material and vertex-coloured geometry helpers
  theme.js          picks and remembers the look
  effects.js        sprite particles
  audio.js          synthesised SFX, sample playback and the music scheduler
  music.js          procedural composer (song sections, chords, melodies), synth band
  music_street.js   the same composer performed by the sampled band (classic look)
  samples.js        instrument sample list, sources and loader
  input.js          keyboard and swipe input
  ui.js             HUD, menus and shop
  config.js         tuning constants
  storage.js        save data
  util.js           helpers and seeded RNG
assets/
  models/           kit.glb, warden.glb (rigged, with run animation)
  textures/         train liveries, graffiti wall, gravel, grass, building facades, skyline, logo
  concept/          character concept art the 3D models were built from
  audio/            instrument samples for the classic look (mono MP3)
tools/              dev pages for checking models and poses
vendor/three/       three.js r186 (MIT)
```

## Asset credits

Assets were generated for this project with Higgsfield:

- **Concept art, textures and logo:** GPT Image 2.5, including the grass and the three apartment facades. The red and green train liveries are hue-shifted copies of the blue one.
- **3D characters:** Meshy image-to-3D from the concept art, auto-rigged with a humanoid skeleton and a run cycle. Textures were downscaled to 1024 px JPEG with [glTF-Transform](https://gltf-transform.dev/). Jump, roll, hoverboard, jetpack and crash poses are layered on procedurally at runtime.
- **Everything else** (tracks, trains, hurdles, coins, power-up items, particles) is built procedurally in code.

**Instrument samples** (`assets/audio/`, each trimmed, mixed to mono and normalised):

- **Drums and percussion:** [Versilian Community Sample Library (VCSL)](https://github.com/sgossner/VCSL) by Versilian Studios, CC0 1.0 (public domain).
- **Bass, electric piano, brass, steel drums, marimba and pizzicato strings:** the Fluid (R3) General MIDI SoundFont by Frank Wen, as rendered by [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

The music itself is composed procedurally by the game and is original.

[three.js](https://threejs.org/) is included under the MIT licence (`vendor/three/LICENSE`).
