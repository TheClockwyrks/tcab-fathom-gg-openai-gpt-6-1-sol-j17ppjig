import * as C from "./constants";
import type { Direction, FathomState, Predator } from "./model";
import {
  cell,
  center,
  delta,
  distance,
  distances,
  enter,
  fresh,
  layer,
  layout,
  los,
  move,
  neighbor,
  opposite,
  put,
  reconcile,
  resetLife,
  route,
  segmentDistance,
  speed,
  wander,
} from "./world";
export type TickInput = { held: Direction[]; sonar: boolean; ink: boolean };
const down = (v: number) => (v <= C.TICK_DT + 1e-10 ? 0 : v - C.TICK_DT);
const same = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) =>
  a.tx === b.tx && a.ty === b.ty;
export function pulse(
  s: FathomState,
  source: "forager" | "gloamfin",
  tint: "cyan" | "violet" | "orange",
  tx: number,
  ty: number,
  range: number,
  owner: number | null,
): void {
  s.pulses.push({
    source,
    tint,
    ox: tx,
    oy: ty,
    front: -1e-9,
    range,
    distances: distances(s, tx, ty),
    owner,
    caught: false,
  });
}
function acquire(s: FathomState, p: Predator): void {
  if (p.state !== "chase") {
    p.alertLeft = p.kind === "lanternjaw" ? 0 : C.ALERT_TIME;
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  // An acquisition can reverse between centers, but cannot take a corner there.
  const d = route(s, p, p.fix);
  if (d === opposite[p.dir]) p.dir = d;
  if (p.kind === "flarefish") {
    if (p.flarePhase > 0) p.fade = 0.4;
    p.flarePhase = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function drop(p: Predator): void {
  p.fix = null;
  p.state = "wander";
  p.flareIn = C.FLARE_INTERVAL;
  p.flarePhase = 0;
  p.flaring = p.kind === "flarefish" ? false : null;
  p.flareCharging = p.kind === "flarefish" ? false : null;
  p.flareRadius = p.kind === "flarefish" ? 0 : null;
}
function blinded(s: FathomState, p: Predator): boolean {
  return s.inkClouds.some((c) => segmentDistance(p, s.forager, c) <= c.radius);
}
function ping(
  s: FathomState,
  p: Predator,
  i: number,
  orange: boolean,
  cues: Set<C.CueName>,
): void {
  pulse(
    s,
    "gloamfin",
    orange ? "orange" : "violet",
    p.tx,
    p.ty,
    C.GLOAMFIN_PING_RANGE,
    i,
  );
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  cues.add(C.CUES.predatorPing);
}
function mind(
  s: FathomState,
  p: Predator,
  i: number,
  cues: Set<C.CueName>,
): void {
  if (!p.mind) return;
  p.alertLeft = down(p.alertLeft);
  p.mark = down(p.mark);
  p.fade = down(p.fade);
  p.alert = p.alertLeft > 0;
  if (p.state === "den") {
    if (p.slot !== null && s.liveTime + 1e-8 >= p.slot * C.DEN_RELEASE_GAP)
      p.released = true;
    if (!s.tiles.some((r) => r.includes("d")) || !p.released) return;
    const gateY = s.tiles.findIndex((r) => r.includes("g"));
    const gateX = s.tiles[gateY]?.indexOf("g") ?? -1;
    if (gateX < 0) return;
    const target = { tx: gateX, ty: gateY - 1 };
    if (p.travel)
      move(s, p, C.PREDATOR_SPEED * C.TICK_DT, true, () => {
        // The gate is not necessarily directly above a corridor in a fixture.
        // Find any reachable corridor without repairing the posed layout.
        if (cell(s, target.tx, target.ty) === ".") return route(s, p, target);
        const flood = distances(s, p.tx, p.ty);
        let best = Infinity;
        let exit: { tx: number; ty: number } | null = null;
        for (let ty = 0; ty < C.GRID_ROWS; ty++)
          for (let tx = 0; tx < C.GRID_COLS; tx++) {
            const d = flood[ty * C.GRID_COLS + tx];
            if (cell(s, tx, ty) === "." && d >= 0 && d < best) {
              best = d;
              exit = { tx, ty };
            }
          }
        return exit ? route(s, p, exit) : null;
      });
    if (cell(s, p.tx, p.ty) === ".") p.state = "wander";
    return;
  }
  if (p.kind === "gloamfin") {
    const was = p.hearingLock;
    p.hearingLock = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
    p.pingIn = down(p.pingIn);
    p.sincePing += C.TICK_DT;
    if (p.hearingLock) acquire(s, p);
    else if (was) p.pingIn = 0;
    if (p.state === "chase" && p.fix && same(p, p.fix) && !same(p, s.forager)) {
      p.state = "search";
      p.searchTime = 0;
      p.searchPing = false;
    }
    if (p.state === "search") {
      p.searchTime += C.TICK_DT;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) drop(p);
    }
    const orange =
      p.state === "search" &&
      !p.searchPing &&
      p.searchTime >= C.GLOAMFIN_SEARCH_DELAY;
    if (
      !p.hearingLock &&
      p.sincePing + 1e-8 >= C.GLOAMFIN_PING_MIN_GAP &&
      (orange || p.pingIn === 0)
    ) {
      ping(s, p, i, orange, cues);
      if (orange) p.searchPing = true;
    }
    if (p.state === "chase")
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) /
            C.GLOAMFIN_RAMP_TIME) *
            C.TICK_DT,
      );
  } else {
    const blind = blinded(s, p);
    const sensed =
      !blind &&
      ((distance(p, s.forager) <=
        C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness &&
        los(s, p, s.forager)) ||
        (p.flaring && distance(p, s.forager) <= C.FLARE_RADIUS));
    if (blind && p.state === "chase") drop(p);
    else if (sensed) acquire(s, p);
    else if (p.state === "chase") {
      p.linger = down(p.linger);
      if (p.linger === 0) drop(p);
    }
    if (p.kind === "flarefish" && p.state === "wander") {
      if (p.flarePhase > 0) {
        p.flarePhase += C.TICK_DT;
        if (p.flarePhase >= C.FLARE_CHARGE && !p.flaring) {
          p.flaring = true;
          p.flareCharging = false;
          p.flareRadius = C.FLARE_RADIUS;
          cues.add(C.CUES.flare);
        }
        if (p.flarePhase >= C.FLARE_CHARGE + C.FLARE_BLOOM) {
          p.flarePhase = 0;
          p.flaring = false;
          p.flareRadius = 0;
          p.fade = 0.4;
          p.flareIn = C.FLARE_INTERVAL;
        }
      } else {
        p.flareIn = down(p.flareIn);
        if (p.flareIn === 0) {
          p.flarePhase = 1e-9;
          p.flareCharging = true;
        }
      }
    }
  }
  p.alert = p.alertLeft > 0;
  if (p.travel)
    move(s, p, speed(p) * C.TICK_DT, false, () => {
      const before = p.dir;
      let d: Direction | null;
      if (p.state === "chase" && p.fix) d = route(s, p, p.fix);
      else if (
        p.state === "search" &&
        p.fix &&
        Math.abs(p.tx - p.fix.tx) + Math.abs(p.ty - p.fix.ty) >
          C.GLOAMFIN_SEARCH_ROAM
      )
        d = route(s, p, p.fix);
      else d = wander(s, p);
      if (
        p.kind === "gloamfin" &&
        p.state === "chase" &&
        d &&
        d !== before &&
        d !== opposite[before]
      )
        p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
      return d;
    });
}
function wavefronts(s: FathomState): void {
  for (const p of s.pulses) {
    const old = p.front;
    p.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const reached = (tx: number, ty: number) => {
      const d = p.distances[ty * C.GRID_COLS + tx];
      return d >= 0 && d <= p.range && d > old && d <= p.front;
    };
    if (p.source === "forager") {
      for (let ty = 0; ty < C.GRID_ROWS; ty++)
        for (let tx = 0; tx < C.GRID_COLS; tx++)
          if (reached(tx, ty)) {
            put(s.visibility, tx, ty, "l");
            for (const [dx, dy] of Object.values(delta))
              if (
                cell(s, tx + dx, ty + dy) === "#" &&
                tx + dx >= 0 &&
                tx + dx < C.GRID_COLS &&
                ty + dy >= 0 &&
                ty + dy < C.GRID_ROWS
              )
                put(s.visibility, tx + dx, ty + dy, "l");
          }
      for (const hunter of s.predators)
        if (hunter.state !== "den" && reached(hunter.tx, hunter.ty)) {
          if (hunter.kind !== "lanternjaw") hunter.mark = C.SONAR_MARK_TIME;
          if (hunter.kind === "gloamfin" && hunter.mind) acquire(s, hunter);
        }
    } else if (!p.caught && reached(s.forager.tx, s.forager.ty)) {
      const hunter = p.owner === null ? null : s.predators[p.owner];
      if (hunter?.mind) {
        acquire(s, hunter);
        p.caught = true;
      }
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
export function lighting(s: FathomState): void {
  const flares = s.predators.filter((p) => p.flaring);
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const c = center(tx, ty);
      const lit =
        (distance(c, s.forager) <= s.visionRadius && los(s, s.forager, c)) ||
        flares.some((p) => distance(p, c) <= C.FLARE_RADIUS);
      const prev = s.visibility[ty][tx];
      put(s.visibility, tx, ty, lit ? "l" : prev === "l" ? "r" : prev);
    }
  // A sonar arrival lights its newly flooded tiles for this tick; memory survives it.
  for (const wave of s.pulses)
    if (wave.source === "forager")
      for (let ty = 0; ty < C.GRID_ROWS; ty++)
        for (let tx = 0; tx < C.GRID_COLS; tx++) {
          const d = wave.distances[ty * C.GRID_COLS + tx];
          if (
            d >= 0 &&
            d <= wave.front &&
            d > wave.front - C.SONAR_WAVE_SPEED * C.TICK_DT
          ) {
            put(s.visibility, tx, ty, "l");
            for (const [dx, dy] of Object.values(delta))
              if (
                tx + dx >= 0 &&
                tx + dx < C.GRID_COLS &&
                ty + dy >= 0 &&
                ty + dy < C.GRID_ROWS &&
                cell(s, tx + dx, ty + dy) === "#"
              )
                put(s.visibility, tx + dx, ty + dy, "l");
          }
        }
  const litBody = (b: { x: number; y: number }) =>
    (distance(b, s.forager) <= s.visionRadius && los(s, s.forager, b)) ||
    flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (const p of s.predators) {
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 0;
    p.lit =
      p.state !== "den" &&
      (litBody(p) || (p.kind !== "lanternjaw" && p.mark > 0) || p.alert);
  }
  for (const b of s.drifters) b.lit = litBody(b);
}
export function tick(
  s: FathomState,
  input: TickInput,
  cues: Set<C.CueName>,
): FathomState {
  s.simTime += C.TICK_DT;
  if (s.screen === "countdown") {
    s.screenLeft = down(s.screenLeft);
    lighting(s);
    if (s.screenLeft === 0) {
      enter(s, "playing");
      s.liveTime = 0;
    }
    return s;
  }
  if (s.screen === "cleared") {
    s.screenLeft = down(s.screenLeft);
    if (s.screenLeft === 0) {
      const n = fresh(s);
      n.score = s.score;
      n.lives = s.lives;
      n.depth = s.depth + 1;
      n.tiles = layout();
      n.plankton = n.tiles.map((r) =>
        r.replace(/[^.]/g, "-").replace(/\./g, "*"),
      );
      n.visibility = layer("u");
      resetLife(n);
      return reconcile(n);
    }
    return s;
  }
  if (s.screen !== "playing") return s;
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  if (s.brightHold > 0) s.brightHold = down(s.brightHold);
  else s.brightness *= Math.pow(0.5, C.TICK_DT / C.BRIGHT_HALFLIFE);
  if (input.sonar && s.sonar.cooldown === 0) {
    pulse(
      s,
      "forager",
      "cyan",
      s.forager.tx,
      s.forager.ty,
      s.sonar.range,
      null,
    );
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (input.ink && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  s.inkClouds = s.inkClouds
    .map((c) => ({ ...c, remaining: down(c.remaining) }))
    .filter((c) => c.remaining > 0);
  const f = s.forager;
  if (input.held.length) {
    s.desired = input.held[input.held.length - 1];
    if (s.desired === opposite[f.dir]) f.dir = s.desired;
    f.moving = move(s, f, C.FORAGER_SPEED * C.TICK_DT, false, () =>
      neighbor(s, f.tx, f.ty, s.desired)
        ? s.desired
        : neighbor(s, f.tx, f.ty, f.dir)
          ? f.dir
          : null,
    );
  } else f.moving = false;
  if (cell(s, f.tx, f.ty) === "." && s.plankton[f.ty][f.tx] === "*") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      enter(s, "cleared");
      cues.add(C.CUES.descend);
      reconcile(s);
      lighting(s);
      return s;
    }
  }
  for (let i = 0; i < s.predators.length; i++) mind(s, s.predators[i], i, cues);
  wavefronts(s);
  for (const d of s.drifters)
    if (d.mind && d.travel)
      move(s, d, C.DRIFTER_SPEED * C.TICK_DT, false, () => wander(s, d));
  s.drifters = s.drifters.filter((d) => {
    if (same(d, f)) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const y = s.tiles.findIndex((r) => r.includes("g"));
    const x = s.tiles[y]?.indexOf("g") ?? -1;
    if (x >= 0 && cell(s, x, y - 1) === ".") {
      s.drifters.push({
        ...center(x, y - 1),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
      s.drifterIn = C.DRIFTER_INTERVAL;
    }
  }
  reconcile(s);
  lighting(s);
  if (s.predators.some((p) => p.state !== "den" && same(p, f))) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) enter(s, "gameover");
    else {
      s.lives--;
      resetLife(s);
      reconcile(s);
    }
  }
  if (s.screen === "playing") s.liveTime += C.TICK_DT;
  return s;
}
