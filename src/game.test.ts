/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Clock } from "@clockwyrks/simple-2d";
import { game } from "./game";
import * as C from "./constants";
import { debug } from "./debug";
import { center, distances, initial, neighbor } from "./world";

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (url: string) =>
      new Response(await readFile(new URL(`../${url}`, import.meta.url))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((fn) => fn());
});
async function setup(clock: Clock = new ConstantClock(1000 / 60)) {
  const target = new EventTarget();
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game,
    background: "#030a10",
    clock,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  await engine.initialize();
  disposals.push(() => engine.destroy());
  const key = (code: string, down = true) =>
    target.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  const press = async (code: string) => {
    key(code);
    await engine.advance(1);
    key(code, false);
  };
  const pointer = (type: string, x: number, y: number) =>
    target.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );
  const pose = (fn: Parameters<typeof engine.apply>[0]) => engine.apply(fn);
  const live = () => {
    pose((s) => debug.setScreen(s, "playing"));
    pose((s) => debug.clearPredators(s));
  };
  return { engine, key, press, pointer, pose, live };
}
function fixture(): string[] {
  return Array.from({ length: C.GRID_ROWS }, (_, y) =>
    y === 0 || y === C.GRID_ROWS - 1
      ? "#".repeat(C.GRID_COLS)
      : "#" + ".".repeat(C.GRID_COLS - 2) + "#",
  );
}

describe("maze contract", () => {
  it("is mirrored, connected, narrow and without dead ends, with the specified proportions", () => {
    const s = initial(),
      points: { tx: number; ty: number }[] = [];
    let neighbors = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const c = s.tiles[y][x],
          mirror = s.tiles[y][C.GRID_COLS - 1 - x];
        if (!"dg".includes(c) && !"dg".includes(mirror)) expect(c).toBe(mirror);
        if (c !== ".") continue;
        points.push({ tx: x, ty: y });
        const n = ["up", "down", "left", "right"].filter((d) =>
          neighbor(s, x, y, d as "up"),
        );
        expect(n.length).toBeGreaterThanOrEqual(2);
        neighbors += n.length;
        expect(
          [
            s.tiles[y][x + 1],
            s.tiles[y + 1]?.[x],
            s.tiles[y + 1]?.[x + 1],
          ].every((c) => c === "."),
        ).toBe(false);
      }
    const density = points.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2));
    expect(density).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(density).toBeLessThanOrEqual(C.MAZE_DENSITY_MAX);
    expect(neighbors / points.length).toBeGreaterThanOrEqual(
      C.MAZE_OPENNESS_MIN,
    );
    expect(neighbors / points.length).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const dist = distances(s, 17, 13, false);
    expect(points.every((p) => dist[p.ty * C.GRID_COLS + p.tx] >= 0)).toBe(
      true,
    );
    const degree2 = new Set(
      points
        .filter(
          (p) =>
            ["up", "down", "left", "right"].filter((d) =>
              neighbor(s, p.tx, p.ty, d as "up"),
            ).length === 2,
        )
        .map((p) => p.ty * C.GRID_COLS + p.tx),
    );
    const runs: number[] = [];
    while (degree2.size) {
      const first = degree2.values().next().value!;
      degree2.delete(first);
      const stack = [first];
      let count = 0;
      while (stack.length) {
        const i = stack.pop()!;
        count++;
        for (const d of ["up", "down", "left", "right"] as const) {
          const n = neighbor(
            s,
            i % C.GRID_COLS,
            Math.floor(i / C.GRID_COLS),
            d,
          );
          if (n) {
            const j = n.ty * C.GRID_COLS + n.tx;
            if (degree2.delete(j)) stack.push(j);
          }
        }
      }
      runs.push(count);
    }
    const run = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(run).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(run).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
  });
});
describe("engine-driven screens and controls", () => {
  it("opens with complete, serializable state and diagnostic sources", async () => {
    const { engine } = await setup();
    const s = debug.snapshot(engine.state);
    expect(s.screen).toBe("title");
    expect(s.planktonRemaining).toBe(290);
    expect(s.predators.map((p) => p.kind)).toEqual(C.DEN_ORDER);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(engine.diagnostics().every((d) => d.error === undefined)).toBe(true);
  });
  it("remembers the how-to selection, and wraps keyboard menus", async () => {
    const { engine, press } = await setup();
    await press("ArrowUp");
    expect(engine.state.menuIndex).toBe(1);
    await press("Enter");
    expect(engine.state.screen).toBe("howto");
    await press("Escape");
    expect(engine.state.screen).toBe("title");
    expect(engine.state.menuIndex).toBe(1);
    await press("ArrowDown");
    await press("Enter");
    expect(engine.state.screen).toBe("countdown");
    await engine.advance(121);
    expect(engine.state.screen).toBe("playing");
  });
  it("pauses once on Escape and freezes the world while simulation time still counts", async () => {
    const { engine, press, live } = await setup();
    live();
    await press("Escape");
    expect(engine.state.screen).toBe("paused");
    const f = engine.state.forager;
    await engine.advance(30);
    expect(engine.state.forager).toEqual(f);
    await press("Escape");
    expect(engine.state.screen).toBe("playing");
  });
  it("confirms only pointer edges in the same menu item", async () => {
    const { engine, pointer } = await setup();
    const r = debug.menuItemRect(engine.state, 1)!;
    pointer("pointerdown", r.x + 20, r.y + 20);
    pointer("pointerup", 0, 0);
    await engine.advance(1);
    expect(engine.state.screen).toBe("title");
    pointer("pointerdown", r.x + 20, r.y + 20);
    pointer("pointerup", r.x + 20, r.y + 20);
    await engine.advance(1);
    expect(engine.state.screen).toBe("howto");
    pointer("pointerdown", 200, 200);
    pointer("pointerup", 300, 300);
    await engine.advance(1);
    expect(engine.state.screen).toBe("title");
    expect(engine.state.titleIndex).toBe(1);
  });
  it("restarts and quits from pause, and replays from gameover", async () => {
    const { engine, press, pose, live } = await setup();
    live();
    await press("KeyP");
    await press("ArrowDown");
    await press("Enter");
    expect(engine.state.screen).toBe("countdown");
    pose((s) => debug.setScreen(s, "paused"));
    pose((s) => debug.setMenuIndex(s, 2));
    await press("Enter");
    expect(engine.state.screen).toBe("title");
    pose((s) => debug.setScreen(s, "gameover"));
    await press("Enter");
    expect(engine.state.screen).toBe("countdown");
  });
  it("toggles engine mute on every screen", async () => {
    const { engine, press, pose } = await setup();
    await press("KeyM");
    expect(engine.state.muted).toBe(true);
    pose((s) => debug.setScreen(s, "howto"));
    await press("KeyM");
    expect(engine.state.muted).toBe(false);
  });
});
describe("movement and fixed-step integration", () => {
  it("moves at constant speed, stops on release and reverses between centers", async () => {
    const { engine, key, live, pose } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    const start = engine.state.forager.x;
    key("ArrowLeft");
    await engine.advance(6);
    expect(engine.state.forager.x).toBeCloseTo(start - C.FORAGER_SPEED * 0.1);
    key("ArrowLeft", false);
    await engine.advance(6);
    expect(engine.state.forager.x).toBeCloseTo(start - C.FORAGER_SPEED * 0.1);
    key("ArrowRight");
    await engine.advance(6);
    expect(engine.state.forager.x).toBeCloseTo(start);
  });
  it("buffers corners and never passes through rock", async () => {
    const { engine, key, live, pose } = await setup();
    live();
    pose((s) => debug.setForagerTile(s, 5, 13));
    key("ArrowLeft");
    await engine.advance(8);
    key("ArrowLeft", false);
    key("ArrowUp");
    await engine.advance(8);
    expect(engine.state.forager.tx).toBe(4);
    expect(engine.state.forager.y).toBeLessThan(center(4, 13).y);
  });
  it("crosses the wrap tunnel continuously in one tile of travel", async () => {
    const { engine, key, live, pose } = await setup();
    live();
    pose((s) => debug.setForagerTile(s, 0, 10));
    key("ArrowLeft");
    await engine.advance(15);
    expect(engine.state.forager.x).toBeCloseTo(center(C.GRID_COLS - 1, 10).x);
  });
  it("is independent of frame partitioning", async () => {
    const a = await setup(new ConstantClock(1000 / 60)),
      b = await setup(new SequenceClock([5, 25, 10, 20, 30, 10]));
    for (const h of [a, b]) {
      h.live();
      h.key("ArrowLeft");
    }
    await a.engine.advance(60);
    await b.engine.advance(60);
    expect(debug.snapshot(a.engine.state)).toEqual(
      debug.snapshot(b.engine.state),
    );
  });
  it("holds a body when a posed layout closes its tile", async () => {
    const { engine, key, live, pose } = await setup();
    live();
    pose((s) =>
      debug.setMaze(s, Array(C.GRID_ROWS).fill("#".repeat(C.GRID_COLS))),
    );
    const f = engine.state.forager;
    key("ArrowRight");
    await engine.advance(20);
    expect(engine.state.forager.x).toBe(f.x);
  });
});
describe("senses, resources and progression", () => {
  it("eats, holds brightness, then decays on the half-life curve", async () => {
    const { engine, live, pose } = await setup();
    live();
    await engine.advance(1);
    expect(engine.state.score).toBe(C.SCORE_PLANKTON);
    expect(engine.state.brightness).toBe(C.BRIGHT_PER_EAT);
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setBrightness(s, 1));
    pose((s) => debug.setBrightHold(s, 0));
    await engine.advance(54);
    expect(engine.state.brightness).toBeCloseTo(0.5, 8);
  });
  it("reveals only line-of-sight light, keeping memory outside the vision window", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    await engine.advance(1);
    expect(engine.state.visibility[13][17]).toBe("l");
    expect(engine.state.visibility[11][17]).toBe("u");
    pose((s) => debug.setForagerTile(s, 1, 1));
    await engine.advance(1);
    expect(engine.state.visibility[13][17]).toBe("r");
  });
  it("casts corridor wavefronts, cooldowns and stationary ink through engine cues", async () => {
    const { engine, live, press, pose } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    const cues: string[] = [];
    engine.events.on("cue:played", (e) => cues.push(e.cue));
    await press("Space");
    expect(engine.state.pulses[0].source).toBe("forager");
    expect(engine.state.pulses[0].front).toBeLessThan(1);
    expect(engine.state.sonar.ready).toBe(false);
    await press("ShiftLeft");
    expect(engine.state.inkClouds[0].radius).toBe(C.INK_RADIUS);
    expect(cues).toContain(C.CUES.sonar);
    expect(cues).toContain(C.CUES.ink);
    await engine.advance(190);
    expect(engine.state.inkClouds).toHaveLength(0);
    expect(engine.state.pulses).toHaveLength(0);
  });
  it("clears only by eating and descends with score and lives preserved", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    await engine.advance(1);
    expect(engine.state.screen).toBe("playing");
    pose((s) => debug.setPlankton(s, 17, 13, true));
    await engine.advance(1);
    expect(engine.state.screen).toBe("cleared");
    expect(engine.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    await engine.advance(121);
    expect(engine.state.depth).toBe(2);
    expect(engine.state.predators).toHaveLength(4);
    expect(engine.state.sonar.range).toBe(8);
    expect(engine.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
  });
  it("loses reserves before gameover and keeps eaten plankton and fog", async () => {
    const { engine, live, pose } = await setup();
    live();
    await engine.advance(1);
    const remaining = engine.state.planktonRemaining;
    pose((s) => debug.addPredator(s, "gloamfin", 17, 13));
    pose((s) => debug.setPredatorMind(s, 0, false));
    await engine.advance(1);
    expect(engine.state.lives).toBe(C.START_LIVES - 1);
    expect(engine.state.screen).toBe("countdown");
    expect(engine.state.planktonRemaining).toBe(remaining);
    pose((s) => debug.setScreen(s, "playing"));
    pose((s) => debug.clearPredators(s));
    pose((s) => debug.setLives(s, 0));
    pose((s) => debug.addPredator(s, "flarefish", 17, 13));
    await engine.advance(1);
    expect(engine.state.screen).toBe("gameover");
  });
  it("admits drifters by cadence and eats them for the bonus", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.setDrifterIn(s, 0));
    await engine.advance(1);
    expect(engine.state.drifters).toHaveLength(1);
    pose((s) => debug.spawnDrifter(s, 17, 13));
    pose((s) => debug.setDrifterMind(s, 1, false));
    const score = engine.state.score;
    await engine.advance(1);
    expect(engine.state.score).toBe(score + C.SCORE_DRIFTER);
  });
});
describe("predator minds", () => {
  it("releases on live time, not countdown time, and swims through the gate", async () => {
    const { engine, pose } = await setup();
    pose((s) => debug.setScreen(s, "countdown"));
    await engine.advance(60);
    expect(engine.state.predators.every((p) => !p.released)).toBe(true);
    await engine.advance(62);
    expect(engine.state.predators[0].released).toBe(true);
    expect(engine.state.predators[1].released).toBe(false);
    await engine.advance(300);
    expect(engine.state.predators[0].state).not.toBe("den");
    expect(engine.state.predators[1].released).toBe(true);
  });
  it("hunts by light and ink drops the fix, while travel-off leaves sensing live", async () => {
    const { engine, live, pose, press } = await setup();
    live();
    pose((s) => debug.setMaze(s, fixture()));
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 10, 10));
    pose((s) => debug.addPredator(s, "lanternjaw", 12, 10));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(1);
    expect(engine.state.predators[0].state).toBe("chase");
    expect(engine.state.predators[0].alert).toBe(false);
    await press("ShiftLeft");
    expect(engine.state.predators[0].state).toBe("wander");
    expect(engine.state.predators[0].speed).toBe(C.DRIFTER_SPEED);
  });
  it("Gloamfin hears through ink and rock and alerts with its opening chase speed", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.addPredator(s, "gloamfin", 17, 13));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    pose((s) => debug.setForagerTile(s, 18, 13));
    await engine.advance(1);
    const p = engine.state.predators[0];
    expect(p.hearingLock).toBe(true);
    expect(p.alert).toBe(true);
    expect(p.speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("Gloamfin searches a stale fix and casts an orange lost-you ping", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.setMaze(s, fixture()));
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 10, 10));
    pose((s) => debug.addPredator(s, "gloamfin", 10, 10));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    pose((s) => debug.setForagerTile(s, 20, 10));
    await engine.advance(75);
    expect(engine.state.predators[0].state).toBe("search");
    expect(engine.state.pulses.some((p) => p.tint === "orange")).toBe(true);
    await engine.advance(240);
    expect(engine.state.predators[0].state).toBe("wander");
  });
  it("Flarefish charges, blooms through rock, and finishes its reveal", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 1, 1));
    pose((s) => debug.addPredator(s, "flarefish", 28, 13));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(422);
    expect(engine.state.predators[0].flareCharging).toBe(true);
    await engine.advance(30);
    expect(engine.state.predators[0].flaring).toBe(true);
    expect(engine.state.visibility[13][28]).toBe("l");
    await engine.advance(65);
    expect(engine.state.predators[0].flaring).toBe(false);
    expect(engine.state.visibility[13][28]).toBe("r");
  });
  it("mind-off holds position and posed chase while all other simulation continues", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.addPredator(s, "gloamfin", 10, 13));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    pose((s) => debug.setPredatorMind(s, 0, false));
    const p = engine.state.predators[0];
    await engine.advance(120);
    expect(engine.state.predators[0]).toMatchObject({
      x: p.x,
      y: p.y,
      state: "chase",
      hearingLock: false,
    });
  });
  it("takes a shortest route around rock rather than swimming through it", async () => {
    const { engine, live, pose } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 10, 16));
    pose((s) => debug.addPredator(s, "gloamfin", 10, 13));
    pose((s) => debug.setPredatorState(s, 0, "chase"));
    await engine.advance(20);
    const p = engine.state.predators[0];
    expect(p.y).toBeGreaterThan(center(10, 13).y);
    expect(engine.state.tiles[p.ty][p.tx]).not.toBe("#");
  });
});
describe("debug poses are independent immutable transitions", () => {
  it("reconciles derived fields but never senses, eats, moves, reveals or scores", () => {
    let s = initial();
    s = debug.setBrightness(s, 1);
    s = debug.setDepth(s, 9);
    s = debug.clearFog(s);
    s = debug.setScore(s, 123);
    const before = structuredClone(s);
    const n = debug.reconcile(s);
    expect(n).toEqual(before);
    expect(s).toEqual(before);
    expect(n.windowRadius).toBe(C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN);
    expect(n.sonar.range).toBe(C.SONAR_RANGE_MIN);
    expect(n.predators).toHaveLength(6);
  });
  it("resets everything except mute and preserves the input state", () => {
    const s = initial(true);
    const n = debug.setScore(s, 900);
    expect(s.score).toBe(0);
    expect(debug.reset(n)).toEqual(initial(true));
  });
  it("rejects invalid domains loudly", () => {
    const s = initial();
    for (const fn of [
      () => debug.setScore(s, -1),
      () => debug.setLives(s, 0.5),
      () => debug.setBrightness(s, 2),
      () => debug.setMaze(s, []),
      () => debug.setMenuIndex(s, 2),
      () => debug.setPredatorMind(s, 99, false),
      () => debug.setForagerTile(s, 0, 0),
      () => debug.setBrightHold(s, 2),
      () => debug.setDrifterIn(s, 26),
      () => debug.setSonarCooldown(s, NaN),
      () => debug.setInkCooldown(s, -1),
    ])
      expect(fn).toThrow(RangeError);
  });
  it("poses both drifter switches, cooldowns, release flags and facings", () => {
    let s = initial();
    s = debug.spawnDrifter(s, 1, 1);
    s = debug.setDrifterMind(s, 0, false);
    s = debug.setDrifterTravel(s, 0, false);
    s = debug.setSonarCooldown(s, 99);
    s = debug.setInkCooldown(s, 99);
    s = debug.setPredatorReleased(s, 0, true);
    s = debug.setPredatorDir(s, 0, "right");
    s = debug.setForagerDir(s, "down");
    expect(s.drifters[0]).toMatchObject({ mind: false, travel: false });
    expect(s.sonar.ready).toBe(false);
    expect(s.ink.ready).toBe(false);
    expect(s.predators[0].released).toBe(true);
    s = debug.clearDrifters(s);
    expect(s.drifters).toHaveLength(0);
  });
});

describe("fixture and sensing edge cases", () => {
  it("keeps a missing-den roster inert and allows disconnected fixtures", async () => {
    const { engine, pose } = await setup();
    pose((s) => debug.setMaze(s, fixture()));
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setScreen(s, "playing"));
    const before = engine.state.predators.map((p) => ({ x: p.x, y: p.y }));
    await engine.advance(90);
    expect(engine.state.predators.map((p) => ({ x: p.x, y: p.y }))).toEqual(
      before,
    );
    expect(engine.state.predators.every((p) => !p.lit)).toBe(true);
    expect(engine.state.screen).toBe("playing");
  });
  it("sonar marks a listener at arrival, but never resolves the amber disguise", async () => {
    const { engine, pose, live, press } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 10, 13));
    pose((s) => debug.addPredator(s, "gloamfin", 15, 13));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    pose((s) => debug.addPredator(s, "lanternjaw", 15, 13));
    pose((s) => debug.setPredatorTravel(s, 1, false));
    await press("Space");
    expect(engine.state.predators[0].state).toBe("wander");
    await engine.advance(22);
    expect(engine.state.predators[0]).toMatchObject({
      state: "chase",
      lit: true,
      alert: true,
    });
    expect(engine.state.predators[1].lit).toBe(false);
  });
  it("an ordinary enemy ping reveals no fog and locks on only when its front arrives", async () => {
    const { engine, pose, live } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 10, 13));
    pose((s) => debug.addPredator(s, "gloamfin", 16, 13));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(241);
    expect(engine.state.pulses.some((p) => p.tint === "violet")).toBe(true);
    expect(engine.state.visibility[13][16]).toBe("u");
    expect(engine.state.predators[0].state).toBe("wander");
    await engine.advance(26);
    expect(engine.state.predators[0].state).toBe("chase");
    expect(engine.state.visibility[13][16]).toBe("u");
  });
  it("a Flarefish bloom locks through rock at any point of its live window", async () => {
    const { engine, pose, live } = await setup();
    live();
    pose((s) => debug.clearPlankton(s));
    pose((s) => debug.setForagerTile(s, 1, 1));
    pose((s) => debug.addPredator(s, "flarefish", 28, 13));
    pose((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(460);
    expect(engine.state.predators[0].flaring).toBe(true);
    pose((s) => debug.setForagerTile(s, 25, 10));
    await engine.advance(1);
    expect(engine.state.predators[0]).toMatchObject({
      state: "chase",
      flaring: false,
      alert: true,
    });
  });
});
