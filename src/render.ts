import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Direction, ReadState } from "./model";
import { cell, center } from "./world";
import { menuItems, menuRect } from "./debug";
export const BACKGROUND = "#030a10";
export type Art = Record<string, ImageBitmap[]>;
const cyan = "#8ef9e6",
  muted = "#658e99",
  white = "#e3f6ed";
const face: Record<Direction, number> = { down: 0, up: 2, left: 4, right: 6 };
export function draw(s: ReadState, api: RenderApi, art: Art): void {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  const text = (
    str: string,
    x: number,
    y: number,
    size = 16,
    color = white,
    align: CanvasTextAlign = "left",
  ) => {
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, y);
  };
  const line = (x: number, y: number, w: number, color = "#1c3640") => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 1);
  };
  const sprite = (
    sheet: string,
    frame: number,
    x: number,
    y: number,
    size = C.TILE,
  ) => {
    const img = art[sheet]?.[frame];
    if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  };
  const glow = (
    x: number,
    y: number,
    r: number,
    color: string,
    alpha = 0.3,
  ) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  };
  const amber = (x: number, y: number) => {
    glow(x, y, 19, "#fb7e34", 0.55);
    ctx.fillStyle = "#ffb568";
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  };
  const terrain = (tx: number, ty: number, force = false) => {
    const v = force ? "l" : s.visibility[ty][tx];
    if (v === "u") return;
    const c = cell(s, tx, ty),
      p = center(tx, ty);
    let frame = 16;
    if (c === "#")
      frame =
        (cell(s, tx, ty - 1) === "#" ? 1 : 0) +
        (cell(s, tx + 1, ty) === "#" ? 2 : 0) +
        (cell(s, tx, ty + 1) === "#" ? 4 : 0) +
        (cell(s, tx - 1, ty) === "#" ? 8 : 0);
    else if (c === "g") frame = 18;
    ctx.globalAlpha = v === "r" ? 0.24 : 1;
    sprite("trench-walls", frame, p.x, p.y);
    if (s.plankton[ty][tx] === "*" && c === ".") {
      ctx.fillStyle = cyan;
      ctx.shadowColor = cyan;
      ctx.shadowBlur = v === "r" ? 0 : 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  };
  const title =
    s.screen === "title" || s.screen === "howto" || s.screen === "gameover";
  if (!title) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
    ctx.clip();
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) terrain(x, y);
    glow(s.forager.x, s.forager.y, s.windowRadius, "#1c7d83", 0.13);
    for (const p of s.predators)
      if (p.kind === "lanternjaw" && p.state !== "den") amber(p.x, p.y);
    for (const d of s.drifters) {
      if (d.lit) sprite("drifter", Math.floor(s.liveTime * 8) % 8, d.x, d.y);
      amber(d.x, d.y);
    }
    ctx.restore();
    // Flare vision is additive, including drifter bodies beyond the window.
    for (const d of s.drifters) {
      if (
        d.lit &&
        Math.hypot(d.x - s.forager.x, d.y - s.forager.y) > s.windowRadius
      )
        sprite("drifter", Math.floor(s.liveTime * 8) % 8, d.x, d.y);
    }
    for (const p of s.predators)
      if (p.flaring) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
        ctx.clip();
        for (let y = 0; y < C.GRID_ROWS; y++)
          for (let x = 0; x < C.GRID_COLS; x++) terrain(x, y, true);
        ctx.restore();
      }
    for (const cloud of s.inkClouds) {
      ctx.globalAlpha = Math.min(1, cloud.remaining) * 0.94;
      ctx.fillStyle = "#010307";
      ctx.beginPath();
      ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const p of s.predators) {
      if (p.state === "den") continue;
      if (p.lit) {
        const frame =
          p.kind === "lanternjaw" && p.state === "wander"
            ? 8 + (Math.floor(s.liveTime * 8) % 8)
            : face[p.dir] + (Math.floor(s.liveTime * 7) % 2);
        sprite(p.kind, frame, p.x, p.y);
      }
      if (p.alert) {
        const t = p.alertLeft / C.ALERT_TIME;
        ctx.strokeStyle = p.kind === "gloamfin" ? "#c9a4ff" : "#ffb56e";
        ctx.lineWidth = 2;
        ctx.globalAlpha = t;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4,
            r = 18 + (1 - t) * 26;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
          ctx.lineTo(
            p.x + Math.cos(a) * (r + 10),
            p.y + Math.sin(a) * (r + 10),
          );
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (p.flareCharging || p.flaring || p.fade > 0) {
        const frame = p.flareCharging
          ? Math.min(2, Math.floor((p.flarePhase / C.FLARE_CHARGE) * 3))
          : p.flaring
            ? 3 +
              Math.min(
                2,
                Math.floor(
                  ((p.flarePhase - C.FLARE_CHARGE) / C.FLARE_BLOOM) * 3,
                ),
              )
            : p.fade > 0.2
              ? 6
              : 7;
        sprite("flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
      }
    }
    for (const p of s.pulses) {
      ctx.fillStyle =
        p.tint === "cyan" ? cyan : p.tint === "violet" ? "#b891fc" : "#ff9951";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++) {
          const d = p.distances[y * C.GRID_COLS + x],
            age = p.front - d;
          if (d >= 0 && age >= 0 && age < 1.4) {
            ctx.globalAlpha = (1 - age / 1.4) * 0.8;
            const c = center(x, y);
            ctx.fillRect(c.x - 13, c.y - 13, 26, 26);
          }
        }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    glow(s.forager.x, s.forager.y, 48, "#5dffe1", 0.3);
    sprite(
      "glimmerfin",
      face[s.forager.dir] +
        (s.forager.moving ? Math.floor(s.liveTime * 9) % 2 : 0),
      s.forager.x,
      s.forager.y,
    );
    // Quiet frame and cartographic edge marks sit outside the sensing mask.
    ctx.strokeStyle = "#17303a";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      C.GRID_ORIGIN_X - 0.5,
      C.GRID_ORIGIN_Y - 0.5,
      C.GRID_COLS * C.TILE + 1,
      C.GRID_ROWS * C.TILE + 1,
    );
    text("F A T H O M", 64, 35, 17, cyan);
    text(C.DIVE_LABEL, 64, 59, 11, muted);
    text(String(s.score).padStart(6, "0"), 640, 59, 48, white, "center");
    text("PLANKTON", 1216, 31, 11, muted, "right");
    text(`${s.planktonRemaining} REMAIN`, 1216, 56, 18, cyan, "right");
    for (let i = 0; i < s.lives; i++)
      sprite("glimmerfin", 6, 80 + i * 28, 685, 24);
    text(`DEPTH ${s.depth}`, 218, 692, 16, white);
    const gauge = (label: string, x: number, value: number) => {
      text(label, x, 683, 12, muted);
      ctx.fillStyle = "#142e36";
      ctx.fillRect(x, 695, 160, 4);
      ctx.fillStyle = cyan;
      ctx.fillRect(x, 695, 160 * value, 4);
    };
    gauge("SPACE  /  SONAR", 440, 1 - s.sonar.cooldown / C.SONAR_COOLDOWN);
    gauge("SHIFT  /  INK", 670, 1 - s.ink.cooldown / C.INK_COOLDOWN);
    text("P  PAUSE", 1000, 691, 12, muted);
    text(
      s.muted ? "M  SOUND OFF" : "M  SOUND ON",
      1216,
      691,
      12,
      muted,
      "right",
    );
  } else {
    // A restrained sonar chart frames the title's living specimen.
    for (let i = 0; i < 90; i++) {
      const x = (i * 277 + 49) % C.STAGE_W,
        y = (i * 137 + 31) % C.STAGE_H;
      ctx.fillStyle = i % 4 === 0 ? "#20404b" : "#10242d";
      ctx.fillRect(x, y, 1, 1);
    }
    const ox = s.screen === "title" ? 640 : 1080,
      oy = s.screen === "title" ? 245 : 330;
    glow(ox, oy, 260, "#126b72", 0.22);
    ctx.strokeStyle = "#12313a";
    ctx.lineWidth = 1;
    for (const r of [90, 150, 215]) {
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 36; i++) {
      const a = (i * Math.PI) / 18;
      ctx.beginPath();
      ctx.moveTo(ox + Math.cos(a) * 222, oy + Math.sin(a) * 222);
      ctx.lineTo(ox + Math.cos(a) * 228, oy + Math.sin(a) * 228);
      ctx.stroke();
    }
    sprite("glimmerfin", 6, ox, oy, 64);
    glow(ox, oy, 62, cyan, 0.25);
    text("ABYSSAL FIELD NOTES   /   01", 64, 48, 12, muted);
    text("KINDLE EXPEDITION", 1216, 48, 12, muted, "right");
    line(64, 64, 1152);
    if (s.screen === "title") {
      text(C.TITLE_TEXT, 640, 335, 94, white, "center");
      text(C.TAGLINE_TEXT, 640, 375, 16, cyan, "center");
      text(
        "A light in the trench. A signal for the hunters.",
        640,
        580,
        14,
        muted,
        "center",
      );
      text("01  /  LIGHT", 198, 265, 12, muted);
      text("02  /  SOUND", 930, 265, 12, muted);
    } else if (s.screen === "howto") {
      text("SURVIVE THE SIGNAL", 96, 135, 40, white);
      text("Your light is a map. It is also a lure.", 96, 174, 17, cyan);
      const notes = [
        [
          "01  FIND YOUR WAY",
          "ARROWS / WASD to swim. Eat every mote to descend.",
          "Your light reveals rock; explored paths stay in memory.",
        ],
        [
          "02  MAKE SOME NOISE",
          "SPACE sends sonar around corners. It marks hidden hunters.",
          "SHIFT leaves ink to blind light hunters. Sound cuts through.",
        ],
        [
          "03  KNOW WHAT HUNTS YOU",
          "LANTERNJAW follows light. Its amber lure looks like a drifter.",
          "GLOAMFIN hears you. Turn corners to break its speed advantage.",
        ],
        [
          "04  WATCH FOR THE FLASH",
          "FLAREFISH lights the dark, then chases what its bloom finds.",
          "Your circular view grows as you eat. Beyond it: only darkness.",
        ],
      ];
      notes.forEach((n, i) => {
        const y = 235 + i * 89;
        text(n[0], 96, y, 13, cyan);
        text(n[1], 96, y + 25, 14, white);
        text(n[2], 96, y + 46, 13, muted);
      });
      text("ENTER / ESC / TAP ANYWHERE TO RETURN", 96, 654, 13, cyan);
      text("P / ESC  PAUSE     M  MUTE", 96, 685, 12, muted);
    } else {
      text("SIGNAL LOST", 640, 260, 56, white, "center");
      text(
        `SCORE ${s.score}   /   DEPTH ${s.depth}`,
        640,
        307,
        20,
        cyan,
        "center",
      );
    }
    line(64, 648, 1152);
    if (s.screen !== "howto") {
      text(
        "WASD / ARROWS  SWIM    SPACE  SONAR    SHIFT  INK",
        64,
        683,
        12,
        muted,
      );
      text(
        "HEADPHONES OPTIONAL. COURAGE REQUIRED.",
        1216,
        683,
        11,
        muted,
        "right",
      );
    }
  }
  if (
    s.screen === "paused" ||
    s.screen === "countdown" ||
    s.screen === "cleared"
  ) {
    ctx.fillStyle = s.screen === "paused" ? "#030a10d9" : "#030a1077";
    ctx.fillRect(0, 80, C.STAGE_W, 576);
    if (s.screen === "paused") {
      text("HOLD YOUR BREATH", 640, 275, 44, white, "center");
      text("THE TRENCH CAN WAIT", 640, 313, 13, cyan, "center");
    } else {
      text(
        s.screen === "cleared" ? `DEPTH ${s.depth} CLEARED` : "DIVE",
        640,
        335,
        50,
        white,
        "center",
      );
      text(
        s.screen === "cleared"
          ? "DESCENDING INTO DARKER WATER"
          : String(Math.max(1, Math.ceil(s.screenLeft))),
        640,
        385,
        24,
        cyan,
        "center",
      );
    }
  }
  for (let i = 0; i < menuItems(s.screen).length; i++) {
    const r = menuRect(s, i)!;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#143b40" : "#081820";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#5ccdbd" : "#19343c";
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = cyan;
      ctx.fillRect(r.x, r.y, 3, r.h);
      text("›", r.x + 20, r.y + 32, 22, cyan);
    }
    text(
      menuItems(s.screen)[i],
      640,
      r.y + 32,
      18,
      selected ? white : muted,
      "center",
    );
  }
  if (s.screen === "title")
    text("↑ ↓  SELECT    ENTER  DIVE", 640, 609, 11, muted, "center");
  // Compass-like registration corners finish the instrument-panel silhouette.
  ctx.strokeStyle = "#37626a";
  for (const [x, y, dx, dy] of [
    [32, 28, 1, 1],
    [1248, 28, -1, 1],
    [32, 692, 1, -1],
    [1248, 692, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * 12);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * 12, y);
    ctx.stroke();
  }
}
