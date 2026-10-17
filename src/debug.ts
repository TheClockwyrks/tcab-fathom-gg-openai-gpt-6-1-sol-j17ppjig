import * as C from "./constants";
import type {
  Direction,
  FathomState,
  PredatorKind,
  PredatorState,
  ReadState,
  Rect,
  Screen,
} from "./model";
import {
  cell,
  center,
  clone,
  enter,
  initial,
  layer,
  makePredator,
  put,
  reconcile,
  roster,
} from "./world";
export function menuItems(screen: Screen): readonly string[] {
  return screen === "title"
    ? C.TITLE_ITEMS
    : screen === "paused"
      ? C.PAUSE_ITEMS
      : screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuRect(s: ReadState, index: number): Rect | null {
  return Number.isInteger(index) &&
    index >= 0 &&
    index < menuItems(s.screen).length
    ? {
        x: 470,
        y: (s.screen === "title" ? 410 : 365) + index * 62,
        w: 340,
        h: 50,
      }
    : null;
}
function valid(ok: boolean): asserts ok {
  if (!ok) throw new RangeError("Fathom: invalid debug argument or subject");
}
function number(n: number, min = 0, max = Infinity, whole = false): void {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!whole || Number.isInteger(n)),
  );
}
function tile(s: ReadState, tx: number, ty: number, pred = false): void {
  number(tx, 0, C.GRID_COLS - 1, true);
  number(ty, 0, C.GRID_ROWS - 1, true);
  valid((pred ? ".dg" : ".").includes(cell(s, tx, ty)));
}
function dir(d: Direction): void {
  valid(["up", "down", "left", "right"].includes(d));
}
function pose(s: ReadState, fn: (s: FathomState) => void): FathomState {
  const n = clone(s);
  fn(n);
  return reconcile(n);
}
function predator(s: FathomState, i: number) {
  number(i, 0, s.predators.length - 1, true);
  return s.predators[i];
}
function drifter(s: FathomState, i: number) {
  number(i, 0, s.drifters.length - 1, true);
  return s.drifters[i];
}
export const debug = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s: ReadState) => initial(s.muted),
  snapshot(s: ReadState) {
    const n = reconcile(clone(s));
    return {
      version: n.version,
      screen: n.screen,
      menuIndex: n.menuIndex,
      titleIndex: n.titleIndex,
      depth: n.depth,
      score: n.score,
      lives: n.lives,
      muted: n.muted,
      planktonRemaining: n.planktonRemaining,
      drifterIn: n.drifterIn,
      brightness: n.brightness,
      brightHold: n.brightHold,
      visionRadius: n.visionRadius,
      windowRadius: n.windowRadius,
      sonar: n.sonar,
      ink: n.ink,
      grid: n.grid,
      tiles: n.tiles,
      plankton: n.plankton,
      visibility: n.visibility,
      forager: n.forager,
      drifters: n.drifters.map(({ x, y, tx, ty, lit, mind, travel }) => ({
        x,
        y,
        tx,
        ty,
        lit,
        mind,
        travel,
      })),
      predators: n.predators.map(
        ({
          kind,
          x,
          y,
          tx,
          ty,
          dir,
          state,
          released,
          mind,
          travel,
          speed,
          alert,
          lit,
          detectRange,
          hearingRange,
          hearingLock,
          flareCharging,
          flaring,
          flareRadius,
        }) => ({
          kind,
          x,
          y,
          tx,
          ty,
          dir,
          state,
          released,
          mind,
          travel,
          speed,
          alert,
          lit,
          detectRange,
          hearingRange,
          hearingLock,
          flareCharging,
          flaring,
          flareRadius,
        }),
      ),
      pulses: n.pulses.map(({ source, tint, ox, oy, front, range }) => ({
        source,
        tint,
        ox,
        oy,
        front,
        range,
      })),
      inkClouds: n.inkClouds,
      simTime: n.simTime,
    };
  },
  reconcile: (s: ReadState) => reconcile(clone(s)),
  setScreen: (s: ReadState, value: Screen) =>
    pose(s, (n) => {
      valid(
        [
          "title",
          "howto",
          "countdown",
          "playing",
          "paused",
          "cleared",
          "gameover",
        ].includes(value),
      );
      if (value === "playing" && n.screen !== "paused") n.liveTime = 0;
      enter(n, value);
    }),
  setMenuIndex: (s: ReadState, i: number) =>
    pose(s, (n) => {
      valid(menuRect(n, i) !== null);
      n.menuIndex = i;
    }),
  setTitleIndex: (s: ReadState, i: number) =>
    pose(s, (n) => {
      number(i, 0, C.TITLE_ITEMS.length - 1, true);
      n.titleIndex = i;
    }),
  menuItemRect: menuRect,
  setScore: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v, 0, Infinity, true);
      n.score = v;
    }),
  setLives: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v, 0, Infinity, true);
      n.lives = v;
    }),
  setDepth: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v, 1, Infinity, true);
      n.depth = v;
      n.predators = roster(v);
      n.liveTime = 0;
    }),
  setMaze: (s: ReadState, rows: readonly string[]) =>
    pose(s, (n) => {
      valid(
        rows.length === C.GRID_ROWS &&
          rows.every((r) => r.length === C.GRID_COLS && /^[#.dg]+$/.test(r)),
      );
      const text = rows.join("");
      valid(!/[dg]/.test(text) || text.split("g").length === 2);
      n.tiles = [...rows];
    }),
  setPlankton: (s: ReadState, tx: number, ty: number, present: boolean) =>
    pose(s, (n) => {
      tile(n, tx, ty);
      valid(typeof present === "boolean");
      put(n.plankton, tx, ty, present ? "*" : "-");
    }),
  clearPlankton: (s: ReadState) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s: ReadState) =>
    pose(s, (n) => {
      n.visibility = layer("u");
    }),
  setForagerTile: (s: ReadState, tx: number, ty: number) =>
    pose(s, (n) => {
      tile(n, tx, ty);
      Object.assign(n.forager, center(tx, ty), { moving: false });
    }),
  setForagerDir: (s: ReadState, d: Direction) =>
    pose(s, (n) => {
      dir(d);
      n.forager.dir = d;
      n.desired = d;
      n.forager.moving = false;
    }),
  setBrightness: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v, 0, 1);
      n.brightness = v;
    }),
  setBrightHold: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v, 0, C.BRIGHT_HOLD);
      n.brightHold = v;
    }),
  clearPredators: (s: ReadState) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s: ReadState, kind: PredatorKind, tx: number, ty: number) =>
    pose(s, (n) => {
      valid(C.DEN_ORDER.includes(kind));
      tile(n, tx, ty);
      n.predators.push(makePredator(kind, tx, ty));
    }),
  setPredatorTile: (s: ReadState, i: number, tx: number, ty: number) =>
    pose(s, (n) => {
      tile(n, tx, ty, true);
      Object.assign(predator(n, i), center(tx, ty));
    }),
  setPredatorDir: (s: ReadState, i: number, d: Direction) =>
    pose(s, (n) => {
      dir(d);
      predator(n, i).dir = d;
    }),
  setPredatorState: (
    s: ReadState,
    i: number,
    v: Exclude<PredatorState, "search">,
  ) =>
    pose(s, (n) => {
      valid(["den", "wander", "chase"].includes(v));
      const p = predator(n, i);
      valid((v === "den" ? "dg" : ".").includes(cell(n, p.tx, p.ty)));
      p.state = v;
      p.fix = v === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = C.LINGER_TIME;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    }),
  setPredatorReleased: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      valid(typeof v === "boolean");
      predator(n, i).released = v;
    }),
  setPredatorMind: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      valid(typeof v === "boolean");
      predator(n, i).mind = v;
    }),
  setPredatorTravel: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      valid(typeof v === "boolean");
      predator(n, i).travel = v;
    }),
  spawnDrifter: (s: ReadState, tx: number, ty: number) =>
    pose(s, (n) => {
      tile(n, tx, ty);
      n.drifters.push({
        ...center(tx, ty),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
    }),
  clearDrifters: (s: ReadState) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      valid(typeof v === "boolean");
      drifter(n, i).mind = v;
    }),
  setDrifterTravel: (s: ReadState, i: number, v: boolean) =>
    pose(s, (n) => {
      valid(typeof v === "boolean");
      drifter(n, i).travel = v;
    }),
  setDrifterIn: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v, 0, C.DRIFTER_INTERVAL);
      n.drifterIn = v;
    }),
  setSonarCooldown: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v);
      n.sonar.cooldown = v;
    }),
  setInkCooldown: (s: ReadState, v: number) =>
    pose(s, (n) => {
      number(v);
      n.ink.cooldown = v;
    }),
};
export type FathomDebugApi = typeof debug;
