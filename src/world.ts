import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  ReadState,
  Screen,
} from "./model";
export const directions: Direction[] = ["up", "down", "left", "right"];
export const delta: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const opposite: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
export const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  tx,
  ty,
});
export const tileAt = (x: number, y: number) => ({
  tx: Math.floor((x - C.GRID_ORIGIN_X) / C.TILE),
  ty: Math.floor((y - C.GRID_ORIGIN_Y) / C.TILE),
});
export const cell = (s: ReadState, tx: number, ty: number) =>
  s.tiles[ty]?.[tx] ?? "#";
export const clone = (s: ReadState): FathomState =>
  structuredClone(s) as FathomState;
export function layer(char: string): string[] {
  return Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
}
export function put(rows: string[], tx: number, ty: number, v: string): void {
  rows[ty] = rows[ty].slice(0, tx) + v + rows[ty].slice(tx + 1);
}
export function layout(): string[] {
  const a = layer("#");
  for (const y of [1, 4, 7, 10, 13, 16])
    for (let x = 1; x < C.GRID_COLS - 1; x++)
      if (!([4, 7, 10].includes(y) && x >= 14 && x <= 21)) put(a, x, y, ".");
  for (const x of [1, 4, 7, 10, 13, 22, 25, 28, 31, 34])
    for (let y = 1; y < C.GRID_ROWS - 1; y++) put(a, x, y, ".");
  for (let x = 13; x <= 22; x++) put(a, x, 5, ".");
  put(a, 17, 6, "g");
  for (let y = 7; y <= 9; y++) for (let x = 16; x <= 19; x++) put(a, x, y, "d");
  put(a, 0, 10, ".");
  put(a, C.GRID_COLS - 1, 10, ".");
  return a;
}
export function makePredator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
  slot: number | null = null,
): Predator {
  const g = kind === "gloamfin",
    f = kind === "flarefish";
  return {
    ...center(tx, ty),
    dir: "up",
    lit: false,
    mind: true,
    travel: true,
    kind,
    state: slot === null ? "wander" : "den",
    released: slot === null,
    speed: C.PREDATOR_SPEED,
    alert: false,
    detectRange: g ? null : C.LANTERN_RANGE_BASE,
    hearingRange: g ? C.GLOAMFIN_HEAR : null,
    hearingLock: g ? false : null,
    flareCharging: f ? false : null,
    flaring: f ? false : null,
    flareRadius: f ? 0 : null,
    fix: null,
    linger: C.LINGER_TIME,
    alertLeft: 0,
    mark: 0,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    sincePing: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flarePhase: 0,
    fade: 0,
    slot,
  };
}
export function roster(depth: number): Predator[] {
  return [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ].map((k, i) => makePredator(k, 16 + (i % 4), 8 + Math.floor(i / 4), i));
}
export function initial(muted = false): FathomState {
  const tiles = layout();
  return reconcile({
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) => r.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: layer("u"),
    forager: { ...center(17, 13), dir: "left", moving: false },
    drifters: [],
    predators: roster(1),
    pulses: [],
    inkClouds: [],
    simTime: 0,
    accumulator: 0,
    rng: 913847,
    desired: "left",
    liveTime: 0,
    screenLeft: 2,
    pointerStarts: {},
    pending: [],
  });
}
export function speed(p: Predator): number {
  return p.kind === "lanternjaw" && p.state === "wander"
    ? C.DRIFTER_SPEED
    : p.kind === "gloamfin" && p.state === "chase"
      ? p.chaseSpeed
      : C.PREDATOR_SPEED;
}
export function reconcile(s: FathomState): FathomState {
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(C.SONAR_RANGE_MIN, C.SONAR_RANGE_BASE - s.depth + 1);
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.join("").split("*").length - 1;
  for (const b of [s.forager, ...s.drifters, ...s.predators])
    Object.assign(b, tileAt(b.x, b.y));
  for (const p of s.predators) {
    p.speed = speed(p);
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  }
  return s;
}
export function enter(s: FathomState, screen: Screen): void {
  s.screen = screen;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : ["paused", "gameover"].includes(screen)
        ? 0
        : null;
  if (screen === "countdown" || screen === "cleared") s.screenLeft = 2;
  if (screen === "playing" && s.liveTime === 0) s.liveTime = 0;
  s.pointerStarts = {};
}
export function fresh(
  s: FathomState,
  screen: Screen = "countdown",
): FathomState {
  const n = initial(s.muted);
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.accumulator = s.accumulator;
  enter(n, screen);
  return n;
}
export function resetLife(s: FathomState): void {
  s.forager = { ...center(17, 13), dir: "left", moving: false };
  s.desired = "left";
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.liveTime = 0;
  enter(s, "countdown");
}
export function open(
  s: ReadState,
  tx: number,
  ty: number,
  predator = false,
): boolean {
  const c = cell(s, tx, ty);
  return c === "." || (predator && (c === "d" || c === "g"));
}
export function neighbor(
  s: ReadState,
  tx: number,
  ty: number,
  d: Direction,
  predator = false,
): { tx: number; ty: number } | null {
  const [dx, dy] = delta[d];
  let nx = tx + dx;
  const ny = ty + dy;
  if (nx < 0 || nx >= C.GRID_COLS) {
    const row = s.tiles.findIndex(
      (r) => r[0] === "." && r[C.GRID_COLS - 1] === ".",
    );
    if (ty !== row) return null;
    nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  }
  return open(s, nx, ny, predator) ? { tx: nx, ty: ny } : null;
}
export function options(s: ReadState, b: Body, predator = false): Direction[] {
  return directions.filter((d) => neighbor(s, b.tx, b.ty, d, predator));
}
export function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function wander(s: FathomState, b: Body, predator = false): Direction {
  const opts = options(s, b, predator);
  const forward = opts.filter((d) => d !== opposite[b.dir]);
  const list = forward.length ? forward : opts;
  return list[Math.floor(random(s) * list.length)] ?? b.dir;
}
export function distances(
  s: ReadState,
  tx: number,
  ty: number,
  predator = true,
): number[] {
  const dist = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(-1);
  if (!open(s, tx, ty, predator)) return dist;
  const queue = [{ tx, ty }];
  dist[ty * C.GRID_COLS + tx] = 0;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    for (const d of directions) {
      const n = neighbor(s, q.tx, q.ty, d, predator);
      if (n && dist[n.ty * C.GRID_COLS + n.tx] < 0) {
        dist[n.ty * C.GRID_COLS + n.tx] = dist[q.ty * C.GRID_COLS + q.tx] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}
export function route(
  s: ReadState,
  b: Body,
  target: { tx: number; ty: number },
): Direction | null {
  if (b.tx === target.tx && b.ty === target.ty) return null;
  const dist = distances(s, target.tx, target.ty);
  let best = Infinity,
    result: Direction | null = null;
  for (const d of options(s, b, true)) {
    const n = neighbor(s, b.tx, b.ty, d, true)!;
    const v = dist[n.ty * C.GRID_COLS + n.tx];
    if (v >= 0 && v < best) {
      best = v;
      result = d;
    }
  }
  return result;
}
/** Integrate along center lines, spending the exact remainder after each center. */
export function move(
  s: FathomState,
  b: Body,
  amount: number,
  predator: boolean,
  choose: () => Direction | null,
): boolean {
  if (!open(s, b.tx, b.ty, predator)) return false;
  let moved = false;
  for (let guard = 0; amount > 1e-8 && guard < 20; guard++) {
    const c = center(b.tx, b.ty);
    const at = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (at) {
      const d = choose();
      if (!d || !neighbor(s, b.tx, b.ty, d, predator)) break;
      b.dir = d;
    }
    const [dx, dy] = delta[b.dir];
    let to = dx ? (c.x - b.x) * dx : (c.y - b.y) * dy;
    if (to < 1e-7) to += C.TILE;
    const step = Math.min(amount, to);
    b.x += dx * step;
    b.y += dy * step;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    Object.assign(b, tileAt(b.x, b.y));
    amount -= step;
    moved = true;
  }
  return moved;
}
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y);
export function los(
  s: ReadState,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  const n = Math.ceil(distance(a, b) / 4);
  const end = tileAt(b.x, b.y);
  for (let i = 0; i < n; i++) {
    const t = tileAt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
    if ((t.tx !== end.tx || t.ty !== end.ty) && cell(s, t.tx, t.ty) === "#")
      return false;
  }
  return true;
}
export function segmentDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
