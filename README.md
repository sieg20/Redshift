# REDSHIFT

A rhythm racer where speed is the spectacle. The faster you go, the more reality falls apart:

| Tier | What happens |
| --- | --- |
| **CRUISE** | Dusk on a neon salt-flat highway. The music is muffled behind a lowpass filter. |
| **BLUR** | Radial motion blur, speed lines and chromatic fringing. The filter opens and snares kick in. |
| **MIRAGE** | Heat haze ripples the horizon. The sky pools on the road ahead, phantom towers shimmer and vanish as you approach, and the craft sheds afterimages. An arpeggio joins the music. |
| **SONIC** | You break the sound barrier: shockwave, boom, vapor cone. The sky darkens to stratosphere and the lead synth comes in. |
| **WARP** | The road curls up into a wormhole, space ripples on every beat, light Doppler-shifts and trails echo through time. Afterimages from the *future* fall back into you. |
| **SINGULARITY** | The tunnel twists and a black hole opens at the vanishing point, lensing everything around it. The speedometer reads faster than light. |

## How to Play

The menu (and the pause screen) has a **HOW TO PLAY** button: five pages of screenshots explaining rings and walls, boosting on the beat, speed tiers and overdrive, drops, and playing your own music. It also opens by itself before your first run, and its last button starts that run. The pages are written in `src/tutorial.js`; the screenshots are in `public/tutorial/`.

## Level intro

Every run opens with a short fly-by through open space: a low front view of the craft cruising through streaking stars until it boosts past the camera, a cut to a still side view as it crosses in front of a black hole with the song's name fading in inside the event horizon, then a swing round behind it as it flies through a portal, where the music and the run start. Press `Space`, `Enter`, `Esc` or click to skip it. The script and shot timings are in `src/intro.js`.

## Drops

The built-in soundtrack has a drop every 32 bars (4 bars of breakdown and a snare build, then the full track one layer above your tier for 8 bars). In your own songs, drops are found by analysis (see Music below). For the 16 beats before a drop:

- the course straightens into a wall-free line of rings that speeds up into 8ths, ending in a big **drop ring** on the drop beat. The drop ring is a swirling portal you can see coming from far off
- the music muffles, the view tightens and a 4-3-2-1 countdown runs
- over the last 8 beats letterbox bars close in and a riser climbs (uploaded songs get one from the game; the built-in soundtrack has its own), over the last 4 the camera rises and pulls back into a wide shot down the line of rings, and the craft charges up: its engine and trails pulse brighter on every beat and it shakes as if holding back power
- the last second or so (3 beats at 174 BPM, 2 at 128) is a **hang**: the world slows to a crawl, colour drains away, the music drops to a distant thump under a swelling reversed cymbal, the camera creeps back as the view narrows (a dolly zoom) and the picture is drawn in towards the centre, so the world seems to breathe in. Rings still land on their beats; they just sit closer and creep in

On the drop you fly through the portal: the picture freezes for a split second, then the picture bulges back outward as the camera slams in tight with a wide punch and a tilt, the ring shatters into gold glass that tumbles away and flies past the camera, the sun bursts into an expanding ring, a crack of light tears across the sky (it stays open through the surge and heals a few seconds after you are back on the road), a gold shockwave races down the track lighting up the pylons as it goes, the letterbox snaps away and the music opens up. The 16 beats after happen inside the **wormhole**, with the camera kicking on every strong hit, until a huge exit portal throws you back out onto the road with a second shockwave. The choreography lives in `src/drop.js`. You also get a speed surge and score is doubled for those 16 beats. Get through the whole build-up without a miss or crash for a **PERFECT DROP**: a bigger surge and a bonus. The results screen counts your perfect drops.

## Sync

Everything is locked to the music. Rings and walls land on the drum hits (kick and snare, the off-beat kick, fill rolls), the lane pattern repeats in two-bar phrases, and each ring's chime is scheduled to sound exactly on its hit. The downbeat after a drum fill gets a bigger gold-accent ring worth extra points. The track and pylons pulse with the kick, and boosts are judged against the beat.

Rings are forgiving: you collect one if the craft is within 2.6 units of its centre at any moment within 70 ms of its beat, and in the last half beat the craft is eased onto a ring it's already lined up with (unless you steer away). The constants are `GATE_R` and `HIT_WINDOW` in `src/spawner.js` and `ASSIST_BEATS` in `src/main.js`.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Share it

`npm run package` builds the game and zips it into `redshift-web.zip` (about 14 MB, with index.html at the root). It's a plain static site, so any static host works:

- **itch.io** (made for browser games): create a project, set *Kind of project* to **HTML**, upload the zip and tick *This file will be played in the browser*. Set the viewport to 1280 × 720 and turn on *Fullscreen button*. Under *Visibility & access*, **Restricted** with a password (or a secret URL from *Draft*) keeps it to the people you give the link to.
- **Netlify Drop** (app.netlify.com/drop): drag the `dist` folder onto the page and you get a link straight away.
- **GitHub Pages:** the repository has a workflow (`.github/workflows/deploy.yml`) that builds and publishes the game on every push to `main`. Turn it on once under *Settings → Pages → Source: GitHub Actions*. The game is then at `https://<user>.github.io/<repo>/`. On a free account the repository has to be public, and so is the site.
- **Cloudflare Pages, Vercel:** publish the `dist` folder.

Paths in the build are relative, so it runs from any folder or sub-path.

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` or `←` / `→` | steer |
| `Space` (or `Shift`, `W`, `↑`) | boost. Press it **on the beat** for a PERFECT |
| `Esc` / `P` | pause |
| `Space` / `Enter` / `Esc` / click | skip the level intro |
| `M` | mute / unmute |
| `-` / `=` | volume down / up |
| `[` / `]` | nudge audio sync by 10 ms if hits feel early or late |

Volume, music and effects sliders sit on the title screen and the pause menu, along with **FLASHES**, which sets how much the screen brightens on beats and tier breaks (0 turns flashing off; motion effects stay). Your settings are remembered.

On touch screens, hold the left or right half of the screen to steer and tap both sides at once to boost, so both thumbs stay where they are. While steering with one thumb, tapping the other side boosts; if you lift the first thumb straight away instead, it counts as switching direction (the boost waits 70 ms to tell which, and is timed from when you pressed). The round **pause button** at the top centre of the screen pauses on any device.

**Performance:** phones start at a lower resolution, and on any device the game watches its frame rate. If frames run slow for a couple of seconds it drops the resolution (down to half) and uses fewer blur samples. When there's headroom again it steps back up, one step every 10 seconds or so. The levels and thresholds are in the adaptive quality block near the top of `src/main.js`; `quality` in the dev console shows the current level.

**How speed works:** every ring you fly through adds to your combo, and the combo sets the speed you can *sustain*, up to SONIC (combo 14). Past that, only **overdrive** pushes you further. It charges slowly (one point per ring, half a point per perfect boost) and only while your combo is maxed, so WARP and SINGULARITY take a long, clean stretch and the world bends gradually. Boosts are short bursts (at most +60 over sustained speed) paid for with FLUX, which you refill by collecting rings. They give you a glimpse of the next tier but don't hold it. A missed ring costs 2 combo and 4 overdrive. Hitting a wall halves your combo, your overdrive and your speed.

The pacing knobs (`COMBO_CAP`, `OD_PER_RING`, `OD_PER_PERFECT`, `OD_SPEED`, `BOOST_HEADROOM`) sit together near the top of the gameplay section in `src/main.js`.

## Music

- **Built-in soundtrack:** a procedurally synthesized 174 BPM drum & bass track (Web Audio, no audio files). New layers come in, always on a bar line, as you climb tiers: snare and reese bass, then arpeggio, lead, extra percussion.
- **Included songs:** NIVIRO – Paranormal and Ripple – Everyday (NCS releases), in `public/music/` and listed in `src/songs.js`. They play like your own music (analysed when picked) and are credited on the menu: "Music provided by NoCopyrightSounds". To add another, drop the file in `public/music/` and add a line to `SONGS`.
- **Your own music:** pick any mp3/ogg/wav on the title screen. The game detects its tempo and beat phase, then builds the course around it. Rings go on the beats the song actually hits, plus strong off-beat hits. Louder sections spawn denser courses, and the run lasts as long as the song.

The analysis also finds **drops**: a sudden jump in loudness and bass after a quieter stretch. `npm run test:drops` checks the detector against synthetic songs with known drops (EDM, dubstep, drum & bass, hip-hop, a loud master with a one-bar fake-out, quiet and noisy masters, plus songs with no drop: a crescendo, a flat groove, a chorus lift) and against real songs in `scripts/drop-corpus/`. `npm run test:drops -- --sweep` tries 1125 combinations of the thresholds (`DROP_DEFAULTS` in `src/audio/customTrack.js`) and shows how many get every song right; the defaults sit where every combination still passes.

**Teaching it new songs:** with `npm run dev` running, open http://localhost:5173/tools/drops.html, load a song, listen, and mark where its drops really are (Shift+click on the graph, or `M` at the playhead), then *Save to corpus*. Only the song's per-beat levels and your drop beats are saved, never the audio. Rerun the test (and the sweep) to see whether the detector agrees, and tune from there. The three songs in the corpus now were labelled from their level curves, not by ear, so they're worth checking by listening. Known limit: drum & bass can be read at half tempo (87 instead of 174).

## Dev mode

Add `?dev` to the URL (`http://localhost:5173/?dev`):

- Number keys `1`–`6` jump straight to each speed tier.
- `devStep(seconds)` in the console runs the game forward without waiting for frames (handy when the tab isn't being drawn).
- `?dev&auto` turns on an autopilot that chases rings and boosts on the beat.
- `await captureShot('name')` saves the current frame (without the HUD) as `public/tutorial/name.jpg`, for refreshing the How to Play screenshots after the visuals change. Set the window to 16:9 first (1280×720 was used).

## Code map

| File | What's in it |
| --- | --- |
| `src/main.js` | game loop, speed/combo rules, camera, wiring speed into every effect |
| `src/speed.js` | tier thresholds, speedometer units (km/h → Mach → × light), world scroll speed |
| `src/warp.js` | the space-bending vertex code (curl into tube, twist, sway, beat ripples), shared by all world shaders and mirrored in JS |
| `src/world.js` | sky (dusk → space), salt-flat track with mirage reflections, pylons, phantom towers, speed lines, dust |
| `src/player.js` | craft, light trails, afterimages, vapor cone |
| `src/songs.js` | the songs that ship with the game |
| `src/tutorial.js` | the How to Play pages |
| `src/intro.js` | the level intro: camera shots, black hole, portal, song title |
| `src/drop.js` | drop cinematics: letterbox, camera pull-back, dolly zoom and punch, slow-motion hang, wormhole surge, camera kicks |
| `src/shards.js` | shards of a shattered portal ring |
| `src/spawner.js` | beat-locked rings, walls and arches |
| `src/fx.js` | post-processing: bloom, motion blur, heat haze, lensing, echo feedback, Doppler, shockwaves |
| `src/audio/engine.js` | audio graph, speed-controlled lowpass, sound effects |
| `src/audio/soundtrack.js` | the procedural 174 BPM soundtrack |
| `src/audio/customTrack.js` | user tracks: tempo/phase detection and per-beat loudness |
