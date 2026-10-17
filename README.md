# Fathom — Kindle

**Hunt in the dark.** A bioluminescent maze chase in the deep sea. Graze every
plankton mote to descend, balancing the light that helps you explore against the
attention it draws. Your circular window grows as you eat; even remembered paths
vanish beyond its edge.

Three hunters listen to different signals: the disguised Lanternjaw follows light,
the Gloamfin follows sound, and the Flarefish hunts in its own flash. Sonar maps
corridors and marks hunters, but it also tells the Gloamfin where you are. Ink
blinds the light hunters—not the listener.

## Run locally

Requires a current Node.js version supported by Vite.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Static production build

```sh
npm run build
npm run preview
```

Publish `dist/` as-is. The build contains all art and uses relative URLs, so it
works at a server root or beneath a sub-path. No backend, external font, account,
or network service is required. Audio is synthesized locally.

## Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Swim; up/down select menu items |
| Space | Sonar pulse |
| Shift | Ink cloud |
| Enter / Space | Confirm menu choice |
| P / Escape | Pause / resume |
| Escape | Back |
| M | Toggle sound |
| Backtick | Engine diagnostic overlay |

Release movement to stop. Turns are buffered until the next tile center;
reversals are immediate. Menus also accept pointer and touch. The engine supplies
an on-screen directional pad and two ability buttons on touch devices.

Three reserve lives supplement your current attempt. Eaten plankton and explored
ground survive a catch. Clearing a maze awards a bonus and increases depth, adding
hunters up to six and reducing your sonar range.

## Development checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

The Vitest suite drives the actual Simple 2D engine with a headless canvas,
scripted clocks and dispatched input. The simulation runs at 120 fixed ticks per
second, independently of rendering. `game.initialize` returns the typed debug
surface; callers pose state through `engine.apply` and read it with
`engine.debug.snapshot(engine.state)`. See `specs/instrumentation.md` for its
complete contract. No debugging objects are installed on the page.

Player-facing screenshots and an engine-recorded live-play replay are in
[`showcase/`](showcase/showcase.md).
