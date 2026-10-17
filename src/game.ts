import type { Game } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Direction, FathomState } from "./model";
import { debug, menuItems, menuRect } from "./debug";
import type { FathomDebugApi } from "./debug";
import { clone, enter, fresh, initial, reconcile } from "./world";
import { tick } from "./simulation";
import { BACKGROUND, draw } from "./render";
import type { Art } from "./render";
export { BACKGROUND };
export type { FathomDebugApi } from "./debug";
export type {
  FathomState,
  Body,
  Direction,
  Drifter,
  InkCloud,
  Predator,
  PredatorKind,
  PredatorState,
  Pulse,
  Rect,
  Screen,
} from "./model";
function confirm(s: FathomState): FathomState {
  const index = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = index ?? 0;
    if (index === 1) enter(s, "howto");
    else return fresh(s);
  } else if (s.screen === "paused") {
    if (index === 0) enter(s, "playing");
    else return fresh(s, index === 1 ? "countdown" : "title");
  } else if (s.screen === "gameover")
    return fresh(s, index === 0 ? "countdown" : "title");
  return s;
}
function createGame(): Game<FathomState, FathomDebugApi> {
  // Resources are immutable after initialization; all evolving data lives in state.
  const art: Art = {};
  return {
    async initialize(api) {
      for (const action of C.ACTIONS)
        api.input.register(action, { keys: [...C.BINDINGS[action]] });
      const sounds = [
        { freq: 740, freqTo: 980, durationMs: 50 },
        { freq: 850, freqTo: 180, durationMs: 380 },
        { freq: 90, freqTo: 40, durationMs: 260 },
        { freq: 370, freqTo: 200, durationMs: 200 },
        { freq: 120, freqTo: 1000, durationMs: 440 },
        { freq: 240, freqTo: 35, durationMs: 500 },
        { freq: 350, freqTo: 1300, durationMs: 650 },
      ];
      Object.values(C.CUES).forEach((name, i) =>
        api.audio.define(name, {
          ...sounds[i],
          gain: 0.12,
          wave: i === 2 ? "triangle" : "sine",
        }),
      );
      await Promise.all(
        Object.entries({
          glimmerfin: 8,
          lanternjaw: 16,
          gloamfin: 8,
          flarefish: 8,
          drifter: 8,
          "flare-bloom": 8,
          "trench-walls": 19,
        }).map(async ([name, count]) => {
          art[name] = await Promise.all(
            Array.from({ length: count }, (_, i) =>
              api.assets.loadImage(`${name}/${i}.png`),
            ),
          );
        }),
      );
      for (const name of [
        "screen",
        "depth",
        "score",
        "lives",
        "brightness",
        "visionRadius",
        "windowRadius",
        "planktonRemaining",
      ] as const)
        api.diagnostics.register(name, (s) => s[name]);
      api.diagnostics.register(
        "cooldowns",
        (s) =>
          `sonar ${s.sonar.cooldown.toFixed(2)} / ink ${s.ink.cooldown.toFixed(2)}`,
      );
      api.diagnostics.register(
        "forager",
        (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
      );
      for (let i = 0; i < C.DEN_ORDER.length + C.ROSTER_ADD_ORDER.length; i++)
        api.diagnostics.register(`predator ${i}`, (s) => {
          const p = s.predators[i];
          return p
            ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
            : "none";
        });
      return [initial(), debug];
    },
    update(state, api, dt) {
      let s = clone(state);
      if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
      s.muted = api.audio.muted();
      const edges = Object.fromEntries(
        C.ACTIONS.filter((a) => a !== "mute").map((a) => [
          a,
          api.input.pressed(a),
        ]),
      );
      let activated = false;
      const was = s.screen;
      if (was === "playing" && edges.pause) enter(s, "paused");
      else if (was === "paused" && (edges.pause || edges.back))
        enter(s, "playing");
      else if (was === "howto" && (edges.confirm || edges.back))
        s = fresh(s, "title");
      else if (was === "gameover" && edges.back) s = fresh(s, "title");
      else if (menuItems(was).length) {
        const count = menuItems(was).length;
        if (edges.up) s.menuIndex = ((s.menuIndex ?? 0) + count - 1) % count;
        if (edges.down) s.menuIndex = ((s.menuIndex ?? 0) + 1) % count;
        if (edges.confirm) {
          s = confirm(s);
          activated = true;
        }
      }
      if (!activated && s.screen === was) {
        for (const sample of api.input.pointerSamples()) {
          if (!sample.primary) continue;
          const hit = menuItems(s.screen).findIndex((_, i) => {
            const r = menuRect(s, i)!;
            return (
              sample.x >= r.x &&
              sample.x <= r.x + r.w &&
              sample.y >= r.y &&
              sample.y <= r.y + r.h
            );
          });
          if ((sample.type === "move" || sample.type === "down") && hit >= 0)
            s.menuIndex = hit;
          if (sample.type === "down")
            s.pointerStarts[sample.id] = s.screen === "howto" ? -2 : hit;
          if (sample.type === "up") {
            const start = s.pointerStarts[sample.id];
            delete s.pointerStarts[sample.id];
            if (s.screen === "howto" && start === -2) {
              s = fresh(s, "title");
              break;
            }
            if (hit >= 0 && start === hit) {
              s.menuIndex = hit;
              s = confirm(s);
              break;
            }
          }
        }
      }
      if (was === "playing" && s.screen === "playing") {
        if (edges.a) s.pending.push("sonar");
        if (edges.b) s.pending.push("ink");
      }
      const held = (["up", "down", "left", "right"] as Direction[]).filter(
        (d) => api.input.value(d) > 0,
      );
      s.accumulator += dt;
      while (s.accumulator + 1e-10 >= C.TICK_DT) {
        s.accumulator = Math.max(0, s.accumulator - C.TICK_DT);
        const cues = new Set<C.CueName>();
        s = tick(
          s,
          {
            held,
            sonar: s.pending.includes("sonar"),
            ink: s.pending.includes("ink"),
          },
          cues,
        );
        s.pending = [];
        for (const cue of cues) api.audio.play(cue);
      }
      return reconcile(s);
    },
    render(s, api) {
      draw(s, api, art);
    },
  };
}
export const game = createGame();
