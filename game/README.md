# Hollow Bastion

A 2D pixel-art, top-down base-building idle game. Build drills and towers around a
crystal core, then hold the line while endless waves of monsters walk in from the wilds.
Everything runs in the browser — no build step, no dependencies, no external assets.
Every sprite and every ground pixel is generated at runtime from code.

Play it at `/game/` on the site, or open `game/index.html` locally.

## The loop

1. **Mine.** Scrap Drills produce scrap continuously, awake or asleep.
2. **Build.** Spend scrap on walls, towers, dynamos, labs, drone bays and barracks.
3. **Hold.** Waves arrive on a timer and are fought automatically by your structures.
4. **Research.** Monsters drop Cores; spend them on permanent upgrades.
5. **Rebuild.** Once you have pushed deep enough, evacuate for Relics — a permanent
   +6% to damage and production each — and start again stronger.

## Systems

| System | Notes |
| --- | --- |
| Pathing | Dijkstra flow field out from the core. Walls are passable at high cost, so monsters walk around your maze when they can and chew through it when they cannot. Flyers ignore it entirely. |
| Power | Dynamos supply it, everything else draws it. Run a deficit and production and fire rates drop to as low as 25%. |
| Idle | Production, wave rewards and offline wave clears are simulated when you return (up to 12 hours, at 60% efficiency). If your defence cannot clear a wave on its own, offline progress stalls there. |
| Overrun | Losing the core is not game over — you lose a quarter of your scrap and fall back two waves. |
| Save | Autosaves to `localStorage` every 15 seconds and on exit. |

## Controls

- **1–9** pick a structure, **click** to place, **drag** to paint a row
- **Right-click** cancels the ghost, or sells the structure under the cursor
- **Click** a structure to inspect, then **U** upgrade / **X** sell
- **R** repair all · **C** call the next wave early for bonus scrap · **Space** pause

## Running it locally

Open `index.html` directly in a browser and it works. Saving uses `localStorage`,
which some browsers refuse on `file://` URLs — if progress does not stick, serve the
folder over HTTP instead:

```sh
python3 -m http.server 8000     # then open http://localhost:8000/
```

## Files

```
game/
  index.html    markup shell
  style.css     interface
  src/sprites.js  pixel-map sprite compiler, palettes, procedural art and noise
  src/defs.js     structures, monsters, research, wave composition
  src/engine.js   state, grid, flow field, combat, economy, saves, offline catch-up
  src/render.js   terrain baking and the draw pass
  src/ui.js       panels, input, synthesised sound
  src/main.js     boot and main loop
```
