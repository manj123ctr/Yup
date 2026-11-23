# Vice Coast

An original open-world crime game set in **Vice Coast**, a fictional Miami-inspired city. It runs entirely in the browser using Three.js and WebGL 2. Everything is generated procedurally in code: the city, the models, the textures, every sound effect and all of the music. There are no external art or audio files.

![genre](https://img.shields.io/badge/genre-open--world-ff3cac) ![engine](https://img.shields.io/badge/engine-three.js%20r180-36e2ff)

---

## How to run

The game uses ES modules, so it has to be served over HTTP. Opening `index.html` directly as a file won't work.

```bash
cd vice-coast
python3 -m http.server 8000        # or: npx serve .   /   php -S localhost:8000
```

Then open **http://localhost:8000** in a recent desktop Chrome, Edge or Firefox. A dedicated GPU is recommended.

* Click **New Game** to start. Clicking the game view captures the mouse; **Esc** pauses and releases it.
* If performance is low, open **Settings** and drop *Quality* to Medium or Low, or turn down traffic and pedestrian density.
* The three.js library is vendored in `vendor/three`, so the game itself needs no internet connection. The only online request is for the Google Fonts, and if that fails the UI falls back to system fonts.

---

## Controls

| On foot | | Driving | |
|---|---|---|---|
| WASD | Move | W / S | Accelerate / brake & reverse |
| Shift | Sprint (uses stamina) | A / D | Steer |
| Space | Jump | Space | Handbrake (drift) |
| C | Crouch | F | Exit vehicle (bail out at speed) |
| Z | Toggle walk | H | Headlights |
| F | Enter / carjack a vehicle | Q | Horn (siren in police cars and ambulances) |
| E | Interact (shops, missions) | V | Cycle camera: far / near / hood / interior |
| LMB / RMB | Attack or shoot / aim | C | Cinematic camera |
| R | Reload | R | Next radio station |
| 1 / 2 / X | Fists / pistol / next weapon | B | Look behind |
| Mouse / wheel | Orbit camera / zoom | | |

**Interface:** M = map · T = phone · Tab/I = inventory · Esc/P = pause.
A gamepad also works: left stick moves, right stick looks, RT/LT are throttle and brake, A jumps or handbrakes, Y enters vehicles and X interacts.

---

## What's in the game

### The world
* **Downtown**: glass towers with setbacks, antennas with aviation lights, crown lighting and rooftop billboards.
* **Ocean Drive**: pastel art-deco hotels with neon signs, a beach with palms, umbrellas, loungers and lifeguard towers, and an animated ocean with surf foam.
* **Starfish Island**: a luxury island of mansions, pools and supercars, reached by a cable-stayed **Starfish Causeway** bridge with a real hump you can jump.
* **Midtown**: the mall (enterable, with storefronts and a food court), restaurants, the safehouse, the police HQ, the hospital and parks.
* **Little Haven** (poorer neighbourhood) and **Coral Gardens** (suburbs): houses with pitched roofs, yards, pools, fences and a basketball court.
* **Port of Vice**: container stacks, gantry cranes, warehouses and a docked cargo ship.
* **Vice Coast International**: terminal, control tower, runway lights, hangars and airliners.
* **Everglade Flats**: rolling countryside with farms, barns, silos, fields, forest, a water tower, a country gas station and an expressway.
* Gas stations, nightclubs (enterable, with pulsing dance floors), diners, parking lots, alleys, bus stops, streetlights and working traffic lights at every intersection.

### Graphics
* A day–night cycle with physically based sun and moon lighting, sunrise and sunset colour keys, stars and city light pollution.
* Dynamic weather: clear, cloudy, rain, thunderstorm with lightning, and fog. Rain is drawn on the GPU, and roads get wet and reflective with puddles.
* Shadow maps that follow the player, and image-based reflections regenerated from the sky. Car paint has a clear-coat finish.
* Procedural building facades whose windows light up at night, neon signs, streetlight pools, and car headlight beams and tail-light glow.
* Post-processing: bloom, colour grading, vignette, speed chromatic aberration, a "drunk" wobble, and desaturation when you flatline.
* Cinematic camera work: an FOV kick at speed, camera shake on impacts, an automatic chase cam, an interior view and a cinematic auto-director.

### Player
Walk, jog, sprint (with stamina), jump, crouch and swim. The character has procedural animation for each state. You can punch and shoot, take fall damage, get knocked down by cars, and carjack drivers. Health regenerates slowly, and body armor absorbs damage.

### Vehicles
| Vehicle | Class |
|---|---|
| Cruiser | sedan |
| Cab | taxi |
| Stinger GT | sports |
| Vortex | supercar |
| Ranger XL | SUV |
| Bayou 1500 | pickup |
| Razor 600 | motorcycle |
| Interceptor | police |
| Rescue Van | ambulance |

Each vehicle has its own mass, top speed, acceleration, grip and steering. Driving is arcade-style: grip and drift with handbrake oversteer, speed-sensitive steering, wet-road grip loss, jumps and landings, and pitch and roll on terrain. Crashes do impact damage, **dent the body mesh** where you hit, throw sparks, and can make the engine smoke, catch fire and explode. Cars sink in water. Motorcycles lean into corners and can throw you off.

### AI and city life
* **Traffic** follows lanes on the road graph, stops at red lights, follows other cars, turns and U-turns, honks when blocked, and panics at gunfire.
* **Pedestrians** follow routines. They walk the sidewalks and cross at crosswalks only on red, stop to chat in pairs (with speech bubbles and synthesized voices), use their phones, and sunbathe at the beach by day. Nightclubs fill up at night and fewer people go out in the rain.
* Pedestrians react to you: they complain when bumped, put their hands up when aimed at, flee or cower from gunfire, dodge speeding cars, and sometimes fight back.
* **Police** patrol in traffic. When you're wanted they pursue you with sirens, deploy officers on foot, and send a helicopter with a searchlight from 3 stars.
* **Emergency vehicles** respond to incidents. **Random events** include muggings you can stop, fender benders with arguing drivers, police chasing a suspect, and street performers you can tip.

### Gameplay
* **Wanted system (1–5 stars):** crimes need witnesses. A search area appears on the minimap. Break line of sight and leave the red circle to escape, or get a quick respray at Coast Customs. Getting caught means you're **Arrested**; dying means you **Flatline**. Both cost you money.
* **Story missions:**
  1. *Welcome to Vice Coast*: learn to drive and park.
  2. *Fresh Threads*: shopping and customization.
  3. *Island Hopper*: steal a supercar and lose the cops.
  4. *Midnight Run*: a timed delivery to the airport.
  5. *Coastal Kingpin*: hunt down the smugglers' SUV.
* **Side activities:** two street races against AI rivals, repeatable delivery jobs, 35 hidden Coast Tokens (with a bonus for finding them all), store robberies and tipping street performers.
* **Economy and shops:**
  * Sunny Mart convenience stores (enterable)
  * Coastline Arms, for a pistol, ammo and armor
  * Diners
  * Threads clothing store, with a live 3D preview for shirts, pants, shoes, sleeves, hats, glasses, hair and skin
  * Coast Customs, for repair, respray and engine, brake and armor upgrades
  * Nightclubs
  * The Vice Autos phone app, for buying cars
* **Safehouse:** a garage that stores 4 vehicles (store, retrieve, sell), a wardrobe, sleep, and save.
* **Save and load:** 3 manual slots plus an autosave, all in browser localStorage. You can quick-save from the phone.
* **GPS:** A* routing on the road graph to mission targets or to any map waypoint, drawn on the minimap.

### UI
* Rotating circular minimap with blips, the GPS route, the police search radius and a north marker.
* Health and armor bars, money with change indicator, wanted stars, weapon and ammo display.
* An analog speedometer with RPM, gear and vehicle health, plus a pop-up showing the radio station.
* Notification feed, contextual help, mission banners, subtitles, timers, district and street names, and NPC speech bubbles.
* **Phone** with these apps: Contacts (with working calls to the mechanic, a taxi, Rico and others), Messages, Jobs, Map, Weather forecast, Autos, Snap (hides the HUD), Quick Save and Settings.
* **Pause menu** with tabs for the full zoomable map (click to set a waypoint), Missions, Stats, Settings, Save/Load and Controls.

### Sound
Everything is synthesized with the Web Audio API:
* Engine sound driven by RPM and gear, intake noise and tire skids
* City ambience, traffic hum, wind, rain, thunder, waves, crickets and birds
* Footsteps that depend on the surface
* Weapons, impacts, crashes, explosions, horns, sirens and the helicopter
* UI sounds
* NPC voices through the browser's speech synthesis, with a synthesized "babble" fallback
* A **procedural adaptive music system:** ambient title music, lo-fi for exploring (with a night variant), synthwave on the radio, house in clubs, a driving mission score and a tense track when wanted. It also has three in-car radio stations.

---

## Code layout

```
vice-coast/
├── index.html, styles.css         UI shell & styling
├── vendor/three/                  three.js r180 (+ postprocessing addons)
└── src/
    ├── main.js                    boot, renderer & post-fx, game loop, glue
    ├── input.js, camera.js        input mapping, third-person camera rig
    ├── audio.js, fx.js            synthesized audio & music; particles/lights
    ├── util.js                    math, RNG, noise
    ├── world/
    │   ├── layout.js              map data: grid, districts, terrain, road graph, A*
    │   ├── city.js                procedural city generation (instanced)
    │   ├── collision.js           spatial-hash AABB collision & raycasts
    │   ├── materials.js           shader patches: facades, wet surfaces, glow
    │   ├── textures.js            canvas-generated textures
    │   ├── sky.js, water.js, weather.js
    ├── entities/
    │   ├── human.js               articulated character + procedural animation
    │   ├── player.js              player controller, combat, vehicles
    │   └── vehicle.js             vehicle models, physics, damage
    ├── ai/
    │   ├── traffic.js             traffic & AI drivers (cruise/pursuit/race)
    │   ├── peds.js                pedestrians, cops on foot, clerks, dancers
    │   └── police.js              wanted system, dispatch, helicopter
    ├── gameplay/
    │   ├── missions.js            missions, races, jobs, tokens, GPS
    │   ├── events.js              random city events
    │   └── state.js               state, settings, save/load
    └── ui/
        ├── hud.js                 HUD, minimap, map rendering
        ├── menus.js               pause/settings/map/shops/garage/customs…
        └── phone.js               smartphone
```

When the game is running, `window.VC` gives you the game instance in the browser console. For example, `VC.time.hour = 21` or `VC.weather.set('storm')`.

## Simplifications

A few systems are simplified to keep the game playable in a browser:
* Vehicle physics is arcade-style rather than a full rigid-body simulation.
* Getting hit or killed plays a fall animation instead of a ragdoll.
* Interiors are limited to shops, the mall, clubs, diners, the garage and the hangars.
* The helicopter belongs to the police only and can't be flown.
