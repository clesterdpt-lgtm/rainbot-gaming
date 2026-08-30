/* ============================================================
   Tardigrade Simulator - player-facing interface

   Owns every pixel inside #ts-hud, #ts-touch and #ts-overlay.
   All markup and all styling are created here, from JavaScript,
   so the page shell never has to know what the UI looks like.

   Layers (z-order set by the page):
     #ts-hud     10  score / combo / tricks / gauges / callouts
     #ts-touch   20  virtual stick, look pad, action buttons
     #ts-overlay 30  main menu, pause, settings, controls, credits

   ------------------------------------------------------------
   HOUSE RULES OBSERVED HERE
   ------------------------------------------------------------
   * The three containers are `pointer-events: none`. Only the
     specific interactive elements opt back in, or the canvas
     stops receiving clicks and pointer lock dies.
   * `window.__TSIM.hideHud()` sets `display:none` on the three
     containers. Nothing here ever writes `display` on them.
   * Per-frame DOM writes are gated behind change detection.
     Everything caches its last written value.
   * No Math.random(): jitter comes from ctx.rng.
   ============================================================ */

import { clamp, clamp01, damp, fmtInt } from "./core.js";

/* ------------------------------------------------------------------ */
/* Static content                                                     */
/* ------------------------------------------------------------------ */

const COMBO_WINDOW = 3.0;      // seconds a combo survives without a new hit
const CALLOUT_LIFE = 1.55;     // seconds a world-space score label lives
const TRICK_LIFE = 2.5;        // seconds a trick banner stays on screen
const MAX_CALLOUTS = 16;
const MAX_TRICKS = 3;

/** Fallback trick names, used when a `score` event arrives with no reason. */
const GENERIC_TRICKS = [
  "Nice Wiggle", "Water Bear Special", "Cryptobiotic Chaos",
  "Micro-Mayhem", "Tun Time", "Unreasonable Physics",
];

const CONTROL_GROUPS = [
  {
    title: "Locomotion",
    hint: "Eight claws, no brakes.",
    rows: [
      { name: "Scuttle", note: "Walk the water bear", keyboard: ["W", "A", "S", "D"], gamepad: ["L-Stick"], touch: ["L-Stick"] },
      { name: "Sprint", note: "Overclock the claws", keyboard: ["Shift"], gamepad: ["LT"], touch: ["Tilt stick fully"] },
      { name: "Jump", note: "Hydrostatic launch", keyboard: ["Space"], gamepad: ["A"], touch: ["JUMP"] },
    ],
  },
  {
    title: "Abilities",
    hint: "This is where the score comes from.",
    rows: [
      { name: "Sticky proboscis", note: "Grapple onto anything, swing, yank", keyboard: ["E", "LMB"], gamepad: ["RB", "RT"], touch: ["GRAB"] },
      { name: "Headbutt", note: "Slam downward, wreck the scenery", keyboard: ["Q", "RMB"], gamepad: ["X"], touch: ["SLAM"] },
      { name: "Curl (tun)", note: "Cryptobiosis. Indestructible, rolls forever", keyboard: ["C"], gamepad: ["B"], touch: ["TUN"] },
      { name: "Ragdoll", note: "Give up entirely. Physics takes the wheel", keyboard: ["R"], gamepad: ["Y"], touch: ["FLOP"] },
    ],
  },
  {
    title: "System",
    hint: "",
    rows: [
      { name: "Camera", note: "Cycle follow / shoulder / free", keyboard: ["V"], gamepad: ["LB"], touch: ["—"] },
      { name: "Photo mode", note: "Freeze and frame the carnage", keyboard: ["P"], gamepad: ["—"], touch: ["—"] },
      { name: "Field map", note: "Where in the garden am I", keyboard: ["M"], gamepad: ["—"], touch: ["—"] },
      { name: "Pause", note: "Menus, settings, escape hatch", keyboard: ["Esc"], gamepad: ["Start"], touch: ["❚❚"] },
    ],
  },
];

const DEFAULT_OBJECTIVES = [
  { id: "score", label: "Bank 10,000 points", goal: 10000, format: "int" },
  { id: "combo", label: "Land a x5 combo", goal: 5, format: "int" },
  { id: "wreck", label: "Wreck 12 objects", goal: 12, format: "int" },
  { id: "grapple", label: "Fire the proboscis 8 times", goal: 8, format: "int" },
  { id: "airtime", label: "Stay airborne 6 seconds", goal: 6, format: "sec" },
];

const TOUCH_BUTTONS = [
  { action: "grapple", label: "GRAB", cls: "is-grab" },
  { action: "slam", label: "SLAM", cls: "is-slam" },
  { action: "tun", label: "TUN", cls: "is-tun" },
  { action: "ragdoll", label: "FLOP", cls: "is-flop" },
  { action: "jump", label: "JUMP", cls: "is-jump" },
];

/* ------------------------------------------------------------------ */
/* Stylesheet                                                         */
/* ------------------------------------------------------------------ */

const CSS = `
#ts-hud, #ts-touch, #ts-overlay {
  --ui-line: rgba(150, 214, 255, 0.20);
  --ui-line-hot: rgba(150, 214, 255, 0.44);
  --ui-fill: linear-gradient(170deg, rgba(12, 20, 27, 0.90), rgba(5, 9, 13, 0.94));
  --ui-chamfer: 13px;
  --ui-pad: clamp(14px, 1.5vw, 22px);
  --ui-edge: clamp(14px, 2vw, 34px);
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  font-family: var(--ts-sans);
  color: var(--ts-text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
#ts-hud *, #ts-touch *, #ts-overlay * { box-sizing: border-box; margin: 0; }

/* ---------- shared chrome ----------
   The chamfered "instrument panel" frame is two stacked pseudo-elements
   (1px outline layer + inset fill layer) rather than a border, because a
   border would be sliced off by the clip-path. Children are lifted to
   z-index 1 instead of pushing the pseudos to -1: a negative index needs
   isolation:isolate, which creates a backdrop root and kills the blur. */
.ts-panel {
  position: relative;
  padding: var(--ui-pad);
}
.ts-panel > * { position: relative; z-index: 1; }
.ts-panel::before, .ts-panel::after {
  content: "";
  position: absolute;
  z-index: 0;
  clip-path: polygon(var(--ui-chamfer) 0, 100% 0, 100% calc(100% - var(--ui-chamfer)), calc(100% - var(--ui-chamfer)) 100%, 0 100%, 0 var(--ui-chamfer));
}
.ts-panel::before { inset: 0; background: var(--ui-line); }
.ts-panel::after {
  inset: 1px;
  background: var(--ui-fill);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  backdrop-filter: blur(14px) saturate(150%);
}
.ts-panel--flip::before, .ts-panel--flip::after {
  clip-path: polygon(0 0, calc(100% - var(--ui-chamfer)) 0, 100% var(--ui-chamfer), 100% 100%, var(--ui-chamfer) 100%, 0 calc(100% - var(--ui-chamfer)));
}

.ts-label {
  font-size: clamp(9px, 0.72vw, 11px);
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--ts-dim);
  white-space: nowrap;
}
.ts-rule {
  height: 1px;
  background: linear-gradient(90deg, var(--ui-line-hot), rgba(150, 214, 255, 0));
}
.ts-num {
  font-family: var(--ts-display);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  line-height: 0.86;
}
.ts-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}

/* ================================================================== */
/* HUD                                                                */
/* ================================================================== */
.ts-hudwrap {
  position: absolute; inset: 0;
  opacity: 0;
  transition: opacity 320ms ease;
}
.ts-hudwrap[data-active="1"] { opacity: 1; }
/* Full-bleed layer: world-space callouts and the reticle need raw viewport
   pixel coordinates, so this one is deliberately unpadded. */
.ts-hudfx { position: absolute; inset: 0; overflow: hidden; }
.ts-hud {
  position: absolute;
  inset: 0;
  padding: calc(var(--ui-edge) + var(--safe-t)) calc(var(--ui-edge) + var(--safe-r)) calc(var(--ui-edge) + var(--safe-b)) calc(var(--ui-edge) + var(--safe-l));
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}
.ts-hud__row { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.ts-hud__row--bottom { align-items: flex-end; }
.ts-hud__col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ts-hud__col--r { align-items: flex-end; }

/* ---------- viewfinder brackets + graticule ---------- */
.ts-frame { position: absolute; inset: 0; pointer-events: none; }
.ts-frame i {
  position: absolute;
  width: clamp(16px, 2vw, 28px);
  height: clamp(16px, 2vw, 28px);
  border: 2px solid rgba(150, 214, 255, 0.30);
}
.ts-frame i:nth-child(1) { top: 0; left: 0; border-right: 0; border-bottom: 0; }
.ts-frame i:nth-child(2) { top: 0; right: 0; border-left: 0; border-bottom: 0; }
.ts-frame i:nth-child(3) { bottom: 0; left: 0; border-right: 0; border-top: 0; }
.ts-frame i:nth-child(4) { bottom: 0; right: 0; border-left: 0; border-top: 0; }

/* ---------- reticle ---------- */
.ts-reticle {
  position: absolute; left: 50%; top: 50%;
  width: 74px; height: 74px; margin: -37px 0 0 -37px;
  opacity: 0.42;
}
.ts-reticle svg { width: 100%; height: 100%; display: block; }

/* ---------- score ---------- */
.ts-score { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.ts-score__value {
  font-size: clamp(42px, 5.4vw, 82px);
  background: linear-gradient(178deg, #ffffff 4%, var(--ts-accent-2) 58%, #e0a132 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 5px 16px rgba(0, 0, 0, 0.72)) drop-shadow(0 0 22px rgba(255, 209, 102, 0.24));
  transition: transform 140ms cubic-bezier(0.2, 1.6, 0.4, 1);
  transform-origin: 100% 50%;
}
.ts-score.is-pop .ts-score__value { transform: scale(1.075); }
.ts-score__label { display: flex; align-items: center; gap: 9px; }
.ts-score__label::before { content: ""; width: clamp(24px, 4vw, 62px); height: 1px; background: linear-gradient(90deg, rgba(150,214,255,0), var(--ui-line-hot)); }
.ts-score__delta {
  font-family: var(--ts-display); font-weight: 700; font-size: 15px; letter-spacing: 0.08em;
  color: var(--ts-accent); opacity: 0; transform: translateY(-4px);
  transition: opacity 200ms ease, transform 200ms ease; min-height: 1em;
}
.ts-score__delta.is-on { opacity: 1; transform: translateY(0); }

/* ---------- combo ---------- */
.ts-combo {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  gap: 0 14px;
  padding: 10px 14px 11px 16px;
  opacity: 0;
  transform: translateX(14px);
  transition: opacity 220ms ease, transform 260ms cubic-bezier(0.2, 1, 0.3, 1);
  --combo-hue: var(--ts-accent);
}
.ts-combo[data-on="1"] { opacity: 1; transform: none; }
.ts-combo[data-heat="1"] { --combo-hue: var(--ts-accent-2); }
.ts-combo[data-heat="2"] { --combo-hue: #ff9f43; }
.ts-combo[data-heat="3"] { --combo-hue: var(--ts-hot); }
.ts-combo__mult {
  grid-row: span 2;
  font-family: var(--ts-display); font-weight: 800;
  font-size: clamp(30px, 3.2vw, 46px); line-height: 0.82;
  color: var(--combo-hue);
  text-shadow: 0 0 26px color-mix(in srgb, var(--combo-hue) 55%, transparent);
  font-variant-numeric: tabular-nums;
  transition: transform 130ms cubic-bezier(0.2, 1.8, 0.4, 1), color 200ms ease;
  transform-origin: 50% 60%;
}
.ts-combo.is-bump .ts-combo__mult { transform: scale(1.18) rotate(-2.5deg); }
.ts-combo__mult small { font-size: 0.56em; opacity: 0.7; margin-right: 1px; }
.ts-combo__meta { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ts-combo__hits { font-size: 10px; font-weight: 700; letter-spacing: 0.26em; text-transform: uppercase; color: var(--ts-dim); }
.ts-combo__best { font-size: 10px; font-weight: 700; letter-spacing: 0.18em; color: rgba(233,242,248,0.5); font-variant-numeric: tabular-nums; }
.ts-combo__bar {
  grid-column: 2; width: clamp(112px, 12vw, 176px); height: 5px; margin-top: 7px;
  background: rgba(255,255,255,0.10); overflow: hidden; position: relative;
}
.ts-combo__bar i {
  position: absolute; inset: 0; transform-origin: 0 50%; display: block;
  background: linear-gradient(90deg, var(--combo-hue), color-mix(in srgb, var(--combo-hue) 40%, #ffffff));
  box-shadow: 0 0 14px color-mix(in srgb, var(--combo-hue) 60%, transparent);
}
.ts-combo__bar::after {
  content: ""; position: absolute; inset: 0;
  background-image: repeating-linear-gradient(90deg, rgba(0,0,0,0.55) 0 1px, transparent 1px 14px);
}

/* ---------- objectives ---------- */
.ts-obj { width: clamp(210px, 21vw, 288px); padding: 13px 15px 14px; }
.ts-obj__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.ts-obj__count { font-family: var(--ts-display); font-weight: 800; font-size: 15px; color: var(--ts-accent); letter-spacing: 0.06em; }
.ts-obj__list { display: flex; flex-direction: column; gap: 8px; }
.ts-obj__row { display: grid; grid-template-columns: 13px 1fr auto; gap: 0 9px; align-items: center; }
.ts-obj__tick {
  width: 11px; height: 11px; border: 1.5px solid rgba(150,214,255,0.42);
  position: relative; transform: rotate(45deg); transition: background 220ms ease, border-color 220ms ease;
}
.ts-obj__row[data-done="1"] .ts-obj__tick { background: var(--ts-accent); border-color: var(--ts-accent); box-shadow: 0 0 12px rgba(110,231,168,0.55); }
.ts-obj__name {
  font-size: 11.5px; font-weight: 500; letter-spacing: 0.012em; color: rgba(233,242,248,0.9);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ts-obj__row[data-done="1"] .ts-obj__name { color: var(--ts-accent); }
.ts-obj__val { font-family: var(--ts-display); font-weight: 700; font-size: 12px; color: var(--ts-dim); font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
.ts-obj__bar { grid-column: 2 / -1; height: 2px; background: rgba(255,255,255,0.09); margin-top: 5px; overflow: hidden; }
.ts-obj__bar i { display: block; height: 100%; transform-origin: 0 50%; background: linear-gradient(90deg, var(--ts-accent), var(--ts-accent-2)); }

/* ---------- speed gauge ---------- */
.ts-speed { display: flex; align-items: flex-end; gap: 14px; }
.ts-gauge { position: relative; width: clamp(126px, 12vw, 166px); }
.ts-gauge svg { width: 100%; height: auto; display: block; overflow: visible; }
.ts-gauge__track { fill: none; stroke: rgba(255,255,255,0.12); stroke-width: 6; stroke-linecap: round; }
.ts-gauge__fill { fill: none; stroke: url(#tsGaugeGrad); stroke-width: 6; stroke-linecap: round; filter: drop-shadow(0 0 8px rgba(110,231,168,0.45)); }
.ts-gauge__tick { stroke: rgba(150,214,255,0.38); stroke-width: 1.4; }
.ts-gauge__tick.is-major { stroke: rgba(150,214,255,0.75); stroke-width: 2; }
.ts-gauge__read {
  position: absolute; left: 0; right: 0; bottom: 2px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
}
.ts-gauge__val { font-size: clamp(24px, 2.6vw, 34px); color: #fff; text-shadow: 0 3px 14px rgba(0,0,0,0.7); }
.ts-gauge__unit { font-size: 8.5px; font-weight: 700; letter-spacing: 0.3em; color: var(--ts-dim); }
.ts-speed__side { display: flex; flex-direction: column; gap: 7px; padding-bottom: 4px; }
.ts-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ts-dim); padding: 4px 9px; border: 1px solid rgba(150,214,255,0.18);
  background: rgba(6,10,14,0.6); white-space: nowrap;
}
.ts-chip b { font-family: var(--ts-display); font-size: 12px; letter-spacing: 0.05em; color: var(--ts-text); font-weight: 800; }
.ts-chip[data-on="1"] { color: var(--ts-accent-2); border-color: rgba(255,209,102,0.5); box-shadow: 0 0 18px rgba(255,209,102,0.18) inset; }
.ts-chip[data-on="1"] b { color: var(--ts-accent-2); }
.ts-scalebar { display: flex; flex-direction: column; gap: 3px; }
.ts-scalebar__ruler {
  width: 78px; height: 9px; border: 1px solid rgba(150,214,255,0.4); border-top: 0;
  background-image: repeating-linear-gradient(90deg, rgba(150,214,255,0.4) 0 1px, transparent 1px 13px);
}
.ts-scalebar__cap { font-size: 8.5px; font-weight: 700; letter-spacing: 0.24em; color: var(--ts-dim); }

/* ---------- trick banners ---------- */
.ts-tricks {
  position: absolute; left: 50%; bottom: 19%; transform: translateX(-50%);
  display: flex; flex-direction: column-reverse; align-items: center; gap: 6px;
  width: min(620px, 86vw); pointer-events: none;
}
.ts-trick { text-align: center; will-change: transform, opacity; }
.ts-trick__name {
  font-family: var(--ts-display); font-weight: 800; text-transform: uppercase;
  font-size: clamp(21px, 2.5vw, 34px); letter-spacing: 0.045em; line-height: 1;
  color: #fff; -webkit-text-stroke: 0.6px rgba(5,7,10,0.7);
  text-shadow: 0 3px 0 rgba(5,7,10,0.55), 0 0 30px rgba(255,209,102,0.42);
}
.ts-trick__pts {
  font-family: var(--ts-display); font-weight: 800; font-size: clamp(14px, 1.5vw, 20px);
  letter-spacing: 0.12em; color: var(--ts-accent-2); margin-top: 1px;
  text-shadow: 0 2px 10px rgba(0,0,0,0.8);
}
.ts-trick.is-in { animation: ts-slam 460ms cubic-bezier(0.15, 1.25, 0.35, 1) both; }
.ts-trick.is-out { animation: ts-trickout 380ms ease forwards; }
@keyframes ts-slam {
  0%   { opacity: 0; transform: translateY(16px) scale(1.34) skewX(-9deg); filter: blur(6px); }
  55%  { opacity: 1; filter: blur(0); }
  72%  { transform: translateY(0) scale(0.965) skewX(1deg); }
  100% { opacity: 1; transform: none; filter: blur(0); }
}
@keyframes ts-trickout { to { opacity: 0; transform: translateY(-16px) scale(0.94); } }

/* ---------- world-space callouts ---------- */
.ts-callouts { position: absolute; inset: 0; overflow: hidden; }
.ts-callout {
  position: absolute; left: 0; top: 0; display: none;
  will-change: transform, opacity; white-space: nowrap;
  font-family: var(--ts-display); font-weight: 800;
  transform-origin: 50% 100%;
}
.ts-callout.is-on { display: block; }
.ts-callout b {
  display: block; font-size: 27px; line-height: 1; letter-spacing: 0.02em;
  color: var(--ts-accent-2);
  text-shadow: 0 2px 0 rgba(5,7,10,0.8), 0 0 20px rgba(255,209,102,0.5);
}
.ts-callout span {
  display: block; font-family: var(--ts-sans); font-size: 10px; font-weight: 700;
  letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.86);
  text-shadow: 0 1px 6px rgba(0,0,0,0.9); margin-top: 2px;
}
.ts-callout[data-kind="big"] b { color: #fff; font-size: 34px; text-shadow: 0 2px 0 rgba(5,7,10,0.8), 0 0 26px rgba(255,107,107,0.7); }

/* ---------- control hints ---------- */
.ts-hints { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px 8px; max-width: 46vw; }
.ts-hint { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; letter-spacing: 0.04em; color: rgba(233,242,248,0.66); }
.ts-key {
  display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 5px;
  font-family: var(--ts-sans); font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
  color: var(--ts-text); background: linear-gradient(180deg, rgba(38,52,64,0.95), rgba(15,22,29,0.95));
  border: 1px solid rgba(150,214,255,0.28); border-bottom-width: 2px; border-radius: 4px;
  box-shadow: 0 2px 0 rgba(0,0,0,0.45);
}
.ts-key--wide { min-width: 44px; }

/* ---------- perf overlay ---------- */
.ts-perf { width: clamp(200px, 19vw, 250px); padding: 11px 13px 12px; display: none; }
.ts-perf[data-on="1"] { display: block; }
.ts-perf__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ts-perf__fps { font-family: var(--ts-display); font-weight: 800; font-size: 24px; line-height: 1; color: var(--ts-accent); font-variant-numeric: tabular-nums; }
.ts-perf__fps[data-warn="1"] { color: var(--ts-accent-2); }
.ts-perf__fps[data-warn="2"] { color: var(--ts-hot); }
.ts-perf canvas { display: block; width: 100%; height: 30px; margin-bottom: 8px; background: rgba(255,255,255,0.05); }
.ts-perf__grid { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; }
.ts-perf__k { font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ts-dim); }
.ts-perf__v { font-family: var(--ts-display); font-weight: 700; font-size: 12.5px; color: var(--ts-text); font-variant-numeric: tabular-nums; text-align: right; }

/* ================================================================== */
/* Touch controls                                                     */
/* ================================================================== */
.ts-touch { position: absolute; inset: 0; display: none; }
.ts-touch[data-on="1"] { display: block; }
.ts-touch__look {
  position: absolute; right: 0; top: 0; bottom: 0; width: 58%;
  pointer-events: auto; touch-action: none;
}
.ts-stick {
  position: absolute;
  left: calc(20px + var(--safe-l)); bottom: calc(24px + var(--safe-b));
  width: 152px; height: 152px; pointer-events: auto; touch-action: none;
  display: grid; place-items: center;
}
.ts-stick__ring {
  position: absolute; inset: 12px; border-radius: 50%;
  border: 1.5px solid rgba(150,214,255,0.32);
  background: radial-gradient(circle at 50% 50%, rgba(10,18,25,0.42), rgba(6,10,14,0.62));
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.ts-stick__ring::after {
  content: ""; position: absolute; inset: 14px; border-radius: 50%;
  border: 1px dashed rgba(150,214,255,0.16);
}
.ts-stick__knob {
  position: relative; width: 58px; height: 58px; border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, rgba(255,255,255,0.5), rgba(110,231,168,0.32) 44%, rgba(8,14,19,0.86) 78%);
  border: 1.5px solid rgba(110,231,168,0.65);
  box-shadow: 0 6px 20px rgba(0,0,0,0.6), 0 0 22px rgba(110,231,168,0.24);
  will-change: transform;
}
.ts-touch__pads {
  position: absolute; right: calc(16px + var(--safe-r)); bottom: calc(20px + var(--safe-b));
  width: 214px; height: 200px; pointer-events: none;
}
.ts-tbtn {
  position: absolute; pointer-events: auto; touch-action: none;
  display: grid; place-items: center; border-radius: 50%;
  font-family: var(--ts-display); font-weight: 800; font-size: 13px; letter-spacing: 0.1em;
  color: var(--ts-text);
  border: 1.5px solid rgba(150,214,255,0.34);
  background: radial-gradient(circle at 40% 32%, rgba(38,54,68,0.86), rgba(7,12,17,0.9));
  box-shadow: 0 5px 16px rgba(0,0,0,0.55);
  -webkit-tap-highlight-color: transparent;
  transition: transform 90ms ease, box-shadow 120ms ease, border-color 120ms ease;
  user-select: none; -webkit-user-select: none;
}
.ts-tbtn.is-active { transform: scale(0.9); border-color: var(--ts-accent); box-shadow: 0 0 26px rgba(110,231,168,0.45); }
.ts-tbtn.is-jump { right: 4px; bottom: 6px; width: 88px; height: 88px; font-size: 15px; border-color: rgba(110,231,168,0.5); background: radial-gradient(circle at 40% 30%, rgba(58,102,84,0.9), rgba(7,14,12,0.92)); }
.ts-tbtn.is-grab { right: 96px; bottom: 44px; width: 66px; height: 66px; }
.ts-tbtn.is-slam { right: 20px; bottom: 100px; width: 66px; height: 66px; }
.ts-tbtn.is-tun  { right: 108px; bottom: 122px; width: 54px; height: 54px; font-size: 11px; }
.ts-tbtn.is-flop { right: 34px; bottom: 168px; width: 54px; height: 54px; font-size: 11px; }
.ts-touch__pause {
  position: absolute; top: calc(12px + var(--safe-t)); right: calc(14px + var(--safe-r));
  width: 44px; height: 44px; pointer-events: auto;
  display: grid; place-items: center; font-size: 13px; letter-spacing: 0.1em;
  color: var(--ts-text); border: 1px solid rgba(150,214,255,0.3);
  background: rgba(6,10,14,0.7); -webkit-tap-highlight-color: transparent;
}

/* ================================================================== */
/* Overlay screens                                                    */
/* ================================================================== */
.ts-ov { position: absolute; inset: 0; }
/* pointer-events stay off until the screen is genuinely on, so a screen that
   is fading out can never swallow the click that starts the game. */
.ts-screen {
  position: absolute; inset: 0;
  pointer-events: none;
  opacity: 0; visibility: hidden;
  transition: opacity 260ms ease, visibility 0s linear 260ms;
}
.ts-screen[data-on="1"] { opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s; }
.ts-screen__grid {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.5;
  background-image:
    repeating-linear-gradient(0deg, rgba(150,214,255,0.05) 0 1px, transparent 1px 52px),
    repeating-linear-gradient(90deg, rgba(150,214,255,0.05) 0 1px, transparent 1px 52px);
  -webkit-mask-image: radial-gradient(130% 100% at 50% 50%, #000 20%, transparent 78%);
  mask-image: radial-gradient(130% 100% at 50% 50%, #000 20%, transparent 78%);
}

/* ---------- main menu ---------- */
.ts-menu__bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(78% 96% at 8% 42%, rgba(9,17,24,0.94) 0%, rgba(6,11,15,0.82) 42%, rgba(4,7,10,0.10) 82%),
    linear-gradient(180deg, rgba(4,7,10,0.72) 0%, rgba(4,7,10,0.10) 32%, rgba(4,7,10,0.24) 68%, rgba(4,7,10,0.88) 100%);
}
.ts-menu__inner {
  position: relative; height: 100%;
  display: grid; grid-template-rows: auto 1fr auto;
  padding: calc(24px + var(--safe-t)) calc(32px + var(--safe-r)) calc(24px + var(--safe-b)) calc(40px + var(--safe-l));
  gap: 16px;
}
.ts-menu__top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ts-back {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.26em; text-transform: uppercase;
  color: var(--ts-dim); text-decoration: none; padding: 8px 2px; background: none; border: 0; cursor: pointer;
  font-family: var(--ts-sans);
}
.ts-back:hover, .ts-back:focus-visible { color: var(--ts-text); }
.ts-menu__stamp { display: flex; align-items: center; gap: 10px; }
.ts-menu__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ts-accent); box-shadow: 0 0 12px var(--ts-accent); }

.ts-menu__body { display: flex; flex-direction: column; justify-content: center; min-height: 0; }
.ts-title { margin-bottom: clamp(20px, 3.4vh, 42px); }
.ts-title__eyebrow { display: flex; align-items: center; gap: 12px; margin-bottom: clamp(8px, 1.4vh, 16px); }
.ts-title__eyebrow .ts-rule { width: clamp(28px, 5vw, 74px); }
.ts-title__main {
  font-family: var(--ts-display); font-weight: 800; text-transform: uppercase;
  font-size: clamp(52px, 10.4vw, 156px); line-height: 0.8; letter-spacing: 0.008em;
  background: linear-gradient(178deg, #ffffff 6%, #cfeee0 34%, var(--ts-accent) 72%, #3f9d76 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 10px 34px rgba(0,0,0,0.72));
}
.ts-title__main span { display: block; }
.ts-title__main span:last-child {
  font-size: 0.53em; letter-spacing: 0.19em; margin-top: 0.12em; margin-left: 0.16em;
  background: none; color: var(--ts-text); -webkit-text-fill-color: var(--ts-text); opacity: 0.92;
}
.ts-title__meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
  margin-top: clamp(12px, 1.8vh, 20px);
}
.ts-title__meta span { display: inline-flex; align-items: center; gap: 8px; }
.ts-title__meta span + span::before { content: ""; width: 4px; height: 4px; background: var(--ui-line-hot); transform: rotate(45deg); }

.ts-mlist { display: flex; flex-direction: column; gap: 2px; width: min(430px, 78vw); }
.ts-mitem {
  position: relative; display: grid; grid-template-columns: 34px 1fr auto; align-items: center;
  gap: 14px; padding: 13px 16px 13px 4px; background: none; border: 0; cursor: pointer;
  text-align: left; font-family: var(--ts-sans); color: var(--ts-text);
  transition: transform 190ms cubic-bezier(0.2, 1, 0.3, 1), background 190ms ease;
}
.ts-mitem::before {
  content: ""; position: absolute; left: -14px; top: 50%; width: 3px; height: 0;
  background: var(--ts-accent); transform: translateY(-50%);
  transition: height 200ms cubic-bezier(0.2, 1, 0.3, 1); box-shadow: 0 0 16px var(--ts-accent);
}
.ts-mitem:hover, .ts-mitem:focus-visible {
  transform: translateX(11px);
  background: linear-gradient(90deg, rgba(110,231,168,0.10), rgba(110,231,168,0));
  outline: none;
}
.ts-mitem:hover::before, .ts-mitem:focus-visible::before { height: 72%; }
.ts-mitem:focus-visible { box-shadow: inset 0 0 0 1px rgba(110,231,168,0.45); }
.ts-mitem__idx { font-family: var(--ts-display); font-weight: 700; font-size: 13px; letter-spacing: 0.14em; color: var(--ts-dim); }
.ts-mitem__body { min-width: 0; }
.ts-mitem__name {
  font-family: var(--ts-display); font-weight: 800; text-transform: uppercase;
  font-size: clamp(24px, 2.6vw, 34px); line-height: 1; letter-spacing: 0.055em;
}
.ts-mitem__note { font-size: 11px; letter-spacing: 0.03em; color: var(--ts-dim); margin-top: 3px; }
.ts-mitem__go { font-size: 15px; color: var(--ts-accent); opacity: 0; transform: translateX(-8px); transition: opacity 190ms ease, transform 190ms ease; }
.ts-mitem:hover .ts-mitem__go, .ts-mitem:focus-visible .ts-mitem__go { opacity: 1; transform: none; }
.ts-mitem--primary .ts-mitem__name {
  background: linear-gradient(178deg, #fff 8%, var(--ts-accent-2) 92%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}

.ts-menu__foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.ts-specimen { display: grid; grid-template-columns: auto auto; gap: 2px 18px; padding: 12px 16px; }
.ts-specimen dt { font-size: 9px; font-weight: 700; letter-spacing: 0.26em; text-transform: uppercase; color: var(--ts-dim); }
.ts-specimen dd { font-family: var(--ts-display); font-weight: 700; font-size: 13px; letter-spacing: 0.07em; text-align: right; }

/* ---------- card screens (pause / settings / controls / credits) ---------- */
.ts-sheet {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  padding: calc(20px + var(--safe-t)) calc(18px + var(--safe-r)) calc(20px + var(--safe-b)) calc(18px + var(--safe-l));
  background: radial-gradient(120% 100% at 50% 40%, rgba(4,8,11,0.72), rgba(3,5,8,0.93));
  -webkit-backdrop-filter: blur(9px) saturate(115%); backdrop-filter: blur(9px) saturate(115%);
}
.ts-card {
  width: min(680px, 100%); max-height: 100%; display: flex; flex-direction: column;
  --ui-chamfer: 18px;
}
.ts-card--wide { width: min(880px, 100%); }
.ts-card__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 14px; }
.ts-card__titles { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.ts-card__title {
  font-family: var(--ts-display); font-weight: 800; text-transform: uppercase;
  font-size: clamp(26px, 3.2vw, 40px); line-height: 0.94; letter-spacing: 0.05em;
}
.ts-card__sub { font-size: 11.5px; color: var(--ts-dim); letter-spacing: 0.04em; }
.ts-card__body { overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; padding-right: 4px; margin-right: -4px; }
.ts-card__body::-webkit-scrollbar { width: 6px; }
.ts-card__body::-webkit-scrollbar-thumb { background: rgba(150,214,255,0.28); }
.ts-card__foot { display: flex; gap: 10px; flex-wrap: wrap; padding-top: 16px; }

.ts-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  padding: 12px 22px; cursor: pointer; border: 1px solid rgba(150,214,255,0.30);
  background: linear-gradient(180deg, rgba(26,38,48,0.82), rgba(9,15,20,0.86));
  color: var(--ts-text); font-family: var(--ts-display); font-weight: 800;
  font-size: 15px; letter-spacing: 0.16em; text-transform: uppercase;
  transition: background 160ms ease, border-color 160ms ease, transform 120ms ease, color 160ms ease;
}
.ts-btn:hover { border-color: rgba(150,214,255,0.62); background: linear-gradient(180deg, rgba(38,55,68,0.9), rgba(13,21,28,0.9)); }
.ts-btn:active { transform: translateY(1px); }
.ts-btn--primary {
  border-color: rgba(110,231,168,0.6); color: #06120d;
  background: linear-gradient(180deg, #a7f2ca, var(--ts-accent));
  box-shadow: 0 8px 26px -10px rgba(110,231,168,0.8);
}
.ts-btn--primary:hover { background: linear-gradient(180deg, #c3ffe0, #7ff0b8); border-color: #b9ffdc; }
.ts-btn--ghost { background: none; border-color: rgba(150,214,255,0.22); color: var(--ts-dim); }
.ts-btn--ghost:hover { color: var(--ts-text); }
.ts-btn--icon { padding: 10px 14px; font-size: 13px; letter-spacing: 0.1em; }

/* ---------- settings rows ---------- */
.ts-group { padding: 4px 0 18px; }
.ts-group + .ts-group { border-top: 1px solid rgba(150,214,255,0.13); padding-top: 18px; }
.ts-group__head { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
.ts-group__head .ts-rule { flex: 1; }
.ts-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, 260px); gap: 10px 22px; align-items: center; padding: 9px 0; }
.ts-row__label { font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }
.ts-row__note { font-size: 10.5px; color: var(--ts-dim); margin-top: 2px; line-height: 1.45; }
.ts-row__ctl { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }

.ts-seg { display: flex; border: 1px solid rgba(150,214,255,0.26); background: rgba(6,10,14,0.6); width: 100%; }
.ts-seg button {
  flex: 1; padding: 8px 4px; cursor: pointer; border: 0; background: none; color: var(--ts-dim);
  font-family: var(--ts-display); font-weight: 800; font-size: 12.5px; letter-spacing: 0.14em; text-transform: uppercase;
  transition: background 150ms ease, color 150ms ease;
}
.ts-seg button + button { border-left: 1px solid rgba(150,214,255,0.16); }
.ts-seg button:hover { color: var(--ts-text); background: rgba(150,214,255,0.08); }
.ts-seg button[aria-checked="true"] { color: #06120d; background: linear-gradient(180deg, #a7f2ca, var(--ts-accent)); }

.ts-slider { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; }
.ts-slider input[type="range"] {
  -webkit-appearance: none; appearance: none; flex: 1; min-width: 0; height: 22px; background: none; cursor: pointer;
}
.ts-slider input[type="range"]::-webkit-slider-runnable-track {
  height: 4px; background: linear-gradient(90deg, var(--ts-accent) var(--fill, 50%), rgba(255,255,255,0.14) var(--fill, 50%));
}
.ts-slider input[type="range"]::-moz-range-track { height: 4px; background: rgba(255,255,255,0.14); }
.ts-slider input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 15px; height: 15px; margin-top: -5.5px;
  background: #fff; border: 2px solid var(--ts-accent); border-radius: 50%;
  box-shadow: 0 0 12px rgba(110,231,168,0.6);
}
.ts-slider input[type="range"]::-moz-range-thumb {
  width: 13px; height: 13px; background: #fff; border: 2px solid var(--ts-accent); border-radius: 50%;
}
.ts-slider__val {
  font-family: var(--ts-display); font-weight: 800; font-size: 14px; letter-spacing: 0.06em;
  color: var(--ts-accent); min-width: 48px; text-align: right; font-variant-numeric: tabular-nums;
}

.ts-switch {
  position: relative; width: 52px; height: 26px; padding: 0; cursor: pointer; flex: 0 0 auto;
  border: 1px solid rgba(150,214,255,0.3); background: rgba(6,10,14,0.7); transition: background 180ms ease, border-color 180ms ease;
}
.ts-switch::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
  background: var(--ts-dim); transition: transform 180ms cubic-bezier(0.2, 1, 0.3, 1), background 180ms ease;
}
.ts-switch[aria-checked="true"] { border-color: rgba(110,231,168,0.65); background: rgba(110,231,168,0.16); }
.ts-switch[aria-checked="true"]::after { transform: translateX(26px); background: var(--ts-accent); box-shadow: 0 0 14px rgba(110,231,168,0.7); }

/* ---------- controls sheet ---------- */
.ts-dev { display: flex; gap: 8px; align-items: center; }
.ts-dev__chip {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase;
  padding: 5px 10px; border: 1px solid rgba(150,214,255,0.22); color: var(--ts-dim); background: none; cursor: pointer;
  font-family: var(--ts-sans);
}
.ts-dev__chip[aria-checked="true"] { color: #06120d; background: var(--ts-accent); border-color: var(--ts-accent); }
.ts-ctrl__group + .ts-ctrl__group { margin-top: 20px; }
.ts-ctrl__rows { display: flex; flex-direction: column; }
.ts-ctrl__row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 20px; align-items: center;
  padding: 10px 0; border-bottom: 1px solid rgba(150,214,255,0.09);
}
.ts-ctrl__name { font-size: 13.5px; font-weight: 600; }
.ts-ctrl__note { font-size: 10.5px; color: var(--ts-dim); margin-top: 2px; }
.ts-ctrl__keys { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }

/* ---------- credits ---------- */
.ts-credits { display: flex; flex-direction: column; gap: 16px; }
.ts-credits p { font-size: 13px; line-height: 1.65; color: rgba(233,242,248,0.82); max-width: 62ch; }
.ts-credits__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px 24px; }
.ts-credits__item dt { font-size: 9px; font-weight: 700; letter-spacing: 0.26em; text-transform: uppercase; color: var(--ts-dim); margin-bottom: 4px; }
.ts-credits__item dd { font-family: var(--ts-display); font-weight: 700; font-size: 15px; letter-spacing: 0.05em; }

/* ---------- focus ---------- */
#ts-overlay :focus-visible, #ts-touch :focus-visible {
  outline: 2px solid var(--ts-accent);
  outline-offset: 2px;
}

/* ================================================================== */
/* Responsive                                                         */
/* ================================================================== */
@media (max-width: 900px) {
  .ts-row { grid-template-columns: 1fr; }
  .ts-row__ctl { justify-content: flex-start; }
  .ts-slider__val { min-width: 44px; }
  .ts-menu__inner { padding-left: calc(22px + var(--safe-l)); padding-right: calc(20px + var(--safe-r)); }
  .ts-specimen { display: none; }
  .ts-hints { display: none; }
  .ts-obj { width: clamp(168px, 46vw, 230px); }
  .ts-ctrl__row { grid-template-columns: 1fr; }
  .ts-ctrl__keys { justify-content: flex-start; }
}
@media (max-width: 620px) {
  .ts-hud { --ui-edge: 12px; }
  .ts-score__value { font-size: clamp(34px, 12vw, 52px); }
  .ts-title__main { font-size: clamp(44px, 15vw, 82px); }
  .ts-mitem__name { font-size: 26px; }
  .ts-menu__foot { justify-content: flex-start; }
  .ts-frame { display: none; }
  .ts-speed { transform-origin: 0 100%; }
  .ts-gauge { width: 116px; }
  .ts-obj { padding: 10px 12px; }
  .ts-card__foot .ts-btn { flex: 1; }
}
@media (max-height: 560px) {
  .ts-title { margin-bottom: 14px; }
  .ts-mitem { padding-top: 8px; padding-bottom: 8px; }
  .ts-mitem__note { display: none; }
}
@media (min-width: 1900px) {
  #ts-hud, #ts-overlay { --ui-edge: 44px; }
  .ts-mlist { width: 500px; }
}

@media (prefers-reduced-motion: reduce) {
  #ts-hud *, #ts-touch *, #ts-overlay * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

/* ------------------------------------------------------------------ */
/* Tiny DOM helpers                                                   */
/* ------------------------------------------------------------------ */

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return node;
}

/** Uppercase, spaced-out arcade formatting for trick names. */
function trickCase(text) {
  return String(text).replace(/[_-]+/g, " ").trim().toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Factory                                                            */
/* ------------------------------------------------------------------ */

export async function createUi(ctx) {
  const THREE = ctx.THREE;
  const rng = ctx.rng;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- stylesheet ---------------- */
  const style = el("style", { id: "ts-ui-style", text: CSS });
  document.head.appendChild(style);

  /* ================================================================ */
  /* HUD                                                              */
  /* ================================================================ */

  const calloutLayer = el("div", { class: "ts-callouts" });

  const reticle = el("div", {
    class: "ts-reticle",
    html: `<svg viewBox="0 0 74 74" aria-hidden="true">
      <circle cx="37" cy="37" r="15.5" fill="none" stroke="rgba(233,242,248,0.55)" stroke-width="1" stroke-dasharray="3 5"/>
      <circle cx="37" cy="37" r="1.6" fill="var(--ts-accent)"/>
      <path d="M37 6v12M37 56v12M6 37h12M56 37h12" stroke="rgba(233,242,248,0.7)" stroke-width="1.2"/>
      <path d="M37 24.5v5M37 44.5v5M24.5 37h5M44.5 37h5" stroke="rgba(110,231,168,0.75)" stroke-width="1.2"/>
    </svg>`,
  });

  const frame = el("div", { class: "ts-frame" }, el("i"), el("i"), el("i"), el("i"));

  /* ---- score ---- */
  const scoreValue = el("div", { class: "ts-num ts-score__value", text: "0" });
  const scoreDelta = el("div", { class: "ts-score__delta" });
  const scoreBlock = el("div", { class: "ts-score" },
    el("div", { class: "ts-label ts-score__label", text: "Specimen score" }),
    scoreValue,
    scoreDelta
  );

  /* ---- combo ---- */
  const comboMult = el("div", { class: "ts-combo__mult", html: `<small>&times;</small><span>1.0</span>` });
  const comboMultNum = comboMult.querySelector("span");
  const comboHits = el("span", { class: "ts-combo__hits", text: "0 hits" });
  const comboBest = el("span", { class: "ts-combo__best", text: "BEST 0" });
  const comboBarFill = el("i");
  const comboBlock = el("div", { class: "ts-panel ts-panel--flip ts-combo", "data-on": "0", "data-heat": "0" },
    comboMult,
    el("div", { class: "ts-combo__meta" }, comboHits, comboBest),
    el("div", { class: "ts-combo__bar" }, comboBarFill)
  );

  /* ---- objectives ---- */
  const objCount = el("div", { class: "ts-obj__count", text: "0/5" });
  const objList = el("div", { class: "ts-obj__list" });
  const objBlock = el("div", { class: "ts-panel ts-obj" },
    el("div", { class: "ts-obj__head" },
      el("div", { class: "ts-label", text: "Field log" }),
      objCount
    ),
    objList
  );

  /* ---- perf ---- */
  const perfFps = el("div", { class: "ts-perf__fps", text: "60" });
  const perfCanvas = el("canvas", { width: 224, height: 60 });
  const perfRows = {};
  const perfGrid = el("div", { class: "ts-perf__grid" });
  for (const [key, label] of [
    ["p90", "Frame p90"], ["cpu", "CPU"], ["draw", "Draw calls"],
    ["tri", "Triangles"], ["phys", "Physics"], ["scale", "Render scale"],
  ]) {
    const value = el("div", { class: "ts-perf__v", text: "--" });
    perfRows[key] = value;
    perfGrid.appendChild(el("div", { class: "ts-perf__k", text: label }));
    perfGrid.appendChild(value);
  }
  const perfBlock = el("div", { class: "ts-panel ts-perf", "data-on": "0" },
    el("div", { class: "ts-perf__head" },
      el("div", { class: "ts-label", text: "Instrument" }),
      perfFps
    ),
    perfCanvas,
    perfGrid
  );

  /* ---- speed gauge ---- */
  const GAUGE_PATH = "M 12 62 A 48 48 0 0 1 108 62";
  const gaugeTicks = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    const a = Math.PI - t * Math.PI;
    const cx = 60 + Math.cos(a) * 48;
    const cy = 62 - Math.sin(a) * 48;
    const inner = i % 4 === 0 ? 40 : 43;
    const ix = 60 + Math.cos(a) * inner;
    const iy = 62 - Math.sin(a) * inner;
    gaugeTicks.push(
      `<line class="ts-gauge__tick${i % 4 === 0 ? " is-major" : ""}" x1="${ix.toFixed(2)}" y1="${iy.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${cy.toFixed(2)}"/>`
    );
  }
  const gauge = el("div", {
    class: "ts-gauge",
    html: `<svg viewBox="0 0 120 70" aria-hidden="true">
      <defs>
        <linearGradient id="tsGaugeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#6ee7a8"/>
          <stop offset="55%" stop-color="#ffd166"/>
          <stop offset="100%" stop-color="#ff6b6b"/>
        </linearGradient>
      </defs>
      ${gaugeTicks.join("")}
      <path class="ts-gauge__track" d="${GAUGE_PATH}"/>
      <path class="ts-gauge__fill" d="${GAUGE_PATH}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
    </svg>`,
  });
  const gaugeFill = gauge.querySelector(".ts-gauge__fill");
  const gaugeValue = el("div", { class: "ts-num ts-gauge__val", text: "0.0" });
  gauge.appendChild(el("div", { class: "ts-gauge__read" },
    gaugeValue,
    el("div", { class: "ts-gauge__unit", text: "BL / sec" })
  ));

  const airChip = el("div", { class: "ts-chip", "data-on": "0" }, "Air ", el("b", { text: "0.0s" }));
  const airChipValue = airChip.querySelector("b");
  const magChip = el("div", { class: "ts-chip" }, "Mag ", el("b", { text: "x1200" }));
  const magChipValue = magChip.querySelector("b");
  const speedBlock = el("div", { class: "ts-speed" },
    gauge,
    el("div", { class: "ts-speed__side" },
      airChip,
      magChip,
      el("div", { class: "ts-scalebar" },
        el("div", { class: "ts-scalebar__ruler" }),
        el("div", { class: "ts-scalebar__cap", text: "50 µm" })
      )
    )
  );

  /* ---- trick banners + hints ---- */
  const trickStack = el("div", { class: "ts-tricks" });
  const hintBar = el("div", { class: "ts-hints" });

  const hudRoot = el("div", { class: "ts-hudwrap", "aria-hidden": "true", "data-active": "0" },
    el("div", { class: "ts-hudfx" }, reticle, calloutLayer, trickStack),
    el("div", { class: "ts-hud" },
      frame,
      el("div", { class: "ts-hud__row" },
        el("div", { class: "ts-hud__col" }, perfBlock, objBlock),
        el("div", { class: "ts-hud__col ts-hud__col--r" }, scoreBlock, comboBlock)
      ),
      el("div", { class: "ts-hud__row ts-hud__row--bottom" },
        el("div", { class: "ts-hud__col" }, speedBlock),
        el("div", { class: "ts-hud__col ts-hud__col--r" }, hintBar)
      )
    )
  );

  const liveRegion = el("div", { class: "ts-sr", role: "status", "aria-live": "polite" });
  ctx.dom.hud.append(hudRoot, liveRegion);

  /* ================================================================ */
  /* Touch controls                                                   */
  /* ================================================================ */

  const stickKnob = el("div", { class: "ts-stick__knob" });
  const stickEl = el("div", { class: "ts-stick" }, el("div", { class: "ts-stick__ring" }), stickKnob);
  const lookEl = el("div", { class: "ts-touch__look" });
  const padWrap = el("div", { class: "ts-touch__pads" });
  const touchPause = el("button", {
    class: "ts-touch__pause", type: "button", "aria-label": "Pause",
    onclick: () => setPhase("paused"),
  }, "❚❚");
  const touchRoot = el("div", { class: "ts-touch", "data-on": "0" }, lookEl, stickEl, padWrap, touchPause);

  for (const spec of TOUCH_BUTTONS) {
    const button = el("div", {
      class: `ts-tbtn ${spec.cls}`, role: "button", tabindex: "0",
      "aria-label": spec.label, text: spec.label,
    });
    padWrap.appendChild(button);
  }
  ctx.dom.touch.appendChild(touchRoot);

  const touchEnabled = Boolean(ctx.settings.isTouch);
  if (touchEnabled) {
    touchRoot.setAttribute("data-on", "1");
    ctx.input.bindTouchStick(stickEl, 62);
    ctx.input.bindTouchLook(lookEl);
    for (let i = 0; i < TOUCH_BUTTONS.length; i += 1) {
      ctx.input.bindTouchButton(padWrap.children[i], TOUCH_BUTTONS[i].action);
    }
    ctx.events.on("input:stick", (v) => {
      stickKnob.style.transform = `translate(${(v.x * 34).toFixed(1)}px, ${(v.y * 34).toFixed(1)}px)`;
    });
  }

  /* ================================================================ */
  /* Overlay screens                                                  */
  /* ================================================================ */

  const screens = {};
  const overlayRoot = el("div", { class: "ts-ov" });
  ctx.dom.overlay.appendChild(overlayRoot);

  function makeScreen(id, ...kids) {
    const node = el("section", { class: "ts-screen", "data-screen": id, "data-on": "0" }, ...kids);
    screens[id] = node;
    overlayRoot.appendChild(node);
    return node;
  }

  /* ---------------- main menu ---------------- */
  const MENU_ITEMS = [
    { id: "play", name: "Play", note: "Free roam the garden. No goals, all chaos.", primary: true },
    { id: "settings", name: "Settings", note: "Quality, controls, audio." },
    { id: "controls", name: "Controls", note: "Every move the water bear has." },
    { id: "credits", name: "Credits", note: "Who built this and out of what." },
  ];

  const menuList = el("div", { class: "ts-mlist", role: "menu", "aria-label": "Main menu" });
  MENU_ITEMS.forEach((item, index) => {
    menuList.appendChild(el("button", {
      class: `ts-mitem${item.primary ? " ts-mitem--primary" : ""}`,
      type: "button", role: "menuitem",
      onclick: () => (item.id === "play" ? startPlay() : showScreen(item.id, "menu")),
    },
      el("span", { class: "ts-mitem__idx", text: String(index + 1).padStart(2, "0") }),
      el("span", { class: "ts-mitem__body" },
        el("span", { class: "ts-mitem__name", text: item.name }),
        el("span", { class: "ts-mitem__note", text: item.note })
      ),
      el("span", { class: "ts-mitem__go", text: "▶" })
    ));
  });

  makeScreen("menu",
    el("div", { class: "ts-menu__bg" }),
    el("div", { class: "ts-screen__grid" }),
    el("div", { class: "ts-menu__inner" },
      el("div", { class: "ts-menu__top" },
        el("a", { class: "ts-back", href: "../games.html" }, "← Rainbot"),
        el("div", { class: "ts-menu__stamp" },
          el("span", { class: "ts-menu__dot" }),
          el("span", { class: "ts-label", text: "Field station 04 · live specimen" })
        )
      ),
      el("div", { class: "ts-menu__body" },
        el("div", { class: "ts-title" },
          el("div", { class: "ts-title__eyebrow" },
            el("span", { class: "ts-rule" }),
            el("span", { class: "ts-label", text: "Micro-scale physics sandbox" })
          ),
          el("h1", { class: "ts-title__main" },
            el("span", { text: "Tardigrade" }),
            el("span", { text: "Simulator" })
          ),
          el("div", { class: "ts-title__meta" },
            el("span", { class: "ts-label", text: "Hypsibius dujardini" }),
            el("span", { class: "ts-label", text: "0.5 mm long" }),
            el("span", { class: "ts-label", text: "Functionally indestructible" })
          )
        ),
        menuList
      ),
      el("div", { class: "ts-menu__foot" },
        el("dl", { class: "ts-panel ts-specimen" },
          el("dt", { text: "Habitat" }), el("dd", { text: "Back garden" }),
          el("dt", { text: "Scale" }), el("dd", { text: "1 unit = 0.3 mm" }),
          el("dt", { text: "Survivability" }), el("dd", { text: "Absolute" })
        ),
        el("div", { class: "ts-label", text: "Rainbot Network · procedural, no downloaded art" })
      )
    )
  );

  /* ---------------- pause ---------------- */
  const pauseScoreValue = el("dd", { text: "0" });
  const pauseComboValue = el("dd", { text: "x1.0" });
  const pauseObjValue = el("dd", { text: "0/5" });

  makeScreen("pause",
    el("div", { class: "ts-sheet" },
      el("div", { class: "ts-screen__grid" }),
      el("div", { class: "ts-panel ts-card", role: "dialog", "aria-modal": "true", "aria-label": "Paused" },
        el("div", { class: "ts-card__head" },
          el("div", { class: "ts-card__titles" },
            el("div", { class: "ts-label", text: "Specimen suspended" }),
            el("h2", { class: "ts-card__title", text: "Paused" })
          ),
          el("div", { class: "ts-menu__stamp" },
            el("span", { class: "ts-menu__dot" }),
            el("span", { class: "ts-label", text: "Cryptobiosis" })
          )
        ),
        el("div", { class: "ts-rule" }),
        el("div", { class: "ts-card__body" },
          el("dl", { class: "ts-specimen", style: "padding:16px 0 6px;grid-template-columns:auto auto;justify-content:start;gap:6px 34px;" },
            el("dt", { text: "Score" }), pauseScoreValue,
            el("dt", { text: "Best combo" }), pauseComboValue,
            el("dt", { text: "Field log" }), pauseObjValue
          )
        ),
        el("div", { class: "ts-card__foot" },
          el("button", { class: "ts-btn ts-btn--primary", type: "button", onclick: () => startPlay() }, "Resume"),
          el("button", { class: "ts-btn", type: "button", onclick: () => showScreen("settings", "pause") }, "Settings"),
          el("button", { class: "ts-btn", type: "button", onclick: () => showScreen("controls", "pause") }, "Controls"),
          el("button", { class: "ts-btn ts-btn--ghost", type: "button", onclick: () => setPhase("menu") }, "Main menu")
        )
      )
    )
  );

  /* ---------------- settings ---------------- */
  function sliderRow(opts) {
    const valueEl = el("span", { class: "ts-slider__val", text: opts.format(opts.get()) });
    const input = el("input", {
      type: "range", min: String(opts.min), max: String(opts.max), step: String(opts.step),
      value: String(opts.get()), "aria-label": opts.label,
      oninput: (event) => {
        const value = Number(event.target.value);
        opts.set(value);
        valueEl.textContent = opts.format(value);
        paintRange(event.target, opts.min, opts.max);
      },
    });
    paintRange(input, opts.min, opts.max);
    settingsControls.push(() => {
      input.value = String(opts.get());
      valueEl.textContent = opts.format(opts.get());
      paintRange(input, opts.min, opts.max);
    });
    return el("div", { class: "ts-row" },
      el("div", null,
        el("div", { class: "ts-row__label", text: opts.label }),
        opts.note ? el("div", { class: "ts-row__note", text: opts.note }) : null
      ),
      el("div", { class: "ts-row__ctl" }, el("div", { class: "ts-slider" }, input, valueEl))
    );
  }

  function paintRange(input, min, max) {
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${pct.toFixed(1)}%`);
  }

  function switchRow(opts) {
    const button = el("button", {
      class: "ts-switch", type: "button", role: "switch",
      "aria-checked": opts.get() ? "true" : "false", "aria-label": opts.label,
      onclick: () => {
        const next = button.getAttribute("aria-checked") !== "true";
        button.setAttribute("aria-checked", next ? "true" : "false");
        opts.set(next);
      },
    });
    settingsControls.push(() => button.setAttribute("aria-checked", opts.get() ? "true" : "false"));
    return el("div", { class: "ts-row" },
      el("div", null,
        el("div", { class: "ts-row__label", text: opts.label }),
        opts.note ? el("div", { class: "ts-row__note", text: opts.note }) : null
      ),
      el("div", { class: "ts-row__ctl" }, button)
    );
  }

  const settingsControls = [];

  const tierButtons = ctx.settings.tiers.map((tier) => el("button", {
    type: "button", role: "radio", "aria-checked": tier === ctx.settings.tierName ? "true" : "false",
    text: tier, onclick: () => {
      ctx.settings.setTier(tier);
      tierButtons.forEach((b, i) => b.setAttribute("aria-checked", ctx.settings.tiers[i] === tier ? "true" : "false"));
    },
  }));
  settingsControls.push(() => {
    tierButtons.forEach((b, i) => b.setAttribute("aria-checked", ctx.settings.tiers[i] === ctx.settings.tierName ? "true" : "false"));
  });

  const settingsBody = el("div", { class: "ts-card__body" },
    el("div", { class: "ts-group" },
      el("div", { class: "ts-group__head" },
        el("div", { class: "ts-label", text: "Display" }), el("div", { class: "ts-rule" })
      ),
      el("div", { class: "ts-row" },
        el("div", null,
          el("div", { class: "ts-row__label", text: "Quality tier" }),
          el("div", { class: "ts-row__note", text: "Shadows, ambient occlusion, scatter density and post-processing all scale from this." })
        ),
        el("div", { class: "ts-row__ctl" },
          el("div", { class: "ts-seg", role: "radiogroup", "aria-label": "Quality tier" }, tierButtons)
        )
      ),
      sliderRow({
        label: "Field of view", note: "Wider reads faster, narrower reads bigger.",
        min: 45, max: 95, step: 1,
        get: () => ctx.settings.fov,
        set: (v) => {
          ctx.settings.set("fov", v);
          if (!(ctx.qa && ctx.qa.cameraLocked)) {
            ctx.camera.fov = v;
            ctx.camera.updateProjectionMatrix();
          }
        },
        format: (v) => `${Math.round(v)}°`,
      }),
      switchRow({
        label: "Adaptive resolution", note: "Drops render scale to protect the frame rate.",
        get: () => ctx.settings.adaptiveResolution,
        set: (v) => ctx.settings.set("adaptiveResolution", v),
      }),
      switchRow({
        label: "Performance overlay", note: "FPS, frame time, draw calls, physics cost.",
        get: () => ctx.settings.showPerf,
        set: (v) => { ctx.settings.set("showPerf", v); applyPerfVisibility(); },
      })
    ),
    el("div", { class: "ts-group" },
      el("div", { class: "ts-group__head" },
        el("div", { class: "ts-label", text: "Controls" }), el("div", { class: "ts-rule" })
      ),
      sliderRow({
        label: "Look sensitivity", min: 0.2, max: 3, step: 0.05,
        get: () => ctx.settings.mouseSensitivity,
        set: (v) => ctx.settings.set("mouseSensitivity", v),
        format: (v) => v.toFixed(2),
      }),
      switchRow({
        label: "Invert vertical look",
        get: () => ctx.settings.invertY,
        set: (v) => ctx.settings.set("invertY", v),
      })
    ),
    el("div", { class: "ts-group" },
      el("div", { class: "ts-group__head" },
        el("div", { class: "ts-label", text: "Audio" }), el("div", { class: "ts-rule" })
      ),
      sliderRow({
        label: "Master volume", min: 0, max: 1, step: 0.01,
        get: () => ctx.settings.masterVolume,
        set: (v) => ctx.settings.set("masterVolume", v),
        format: (v) => `${Math.round(v * 100)}%`,
      }),
      sliderRow({
        label: "Music volume", min: 0, max: 1, step: 0.01,
        get: () => ctx.settings.musicVolume,
        set: (v) => ctx.settings.set("musicVolume", v),
        format: (v) => `${Math.round(v * 100)}%`,
      })
    )
  );

  makeScreen("settings",
    el("div", { class: "ts-sheet" },
      el("div", { class: "ts-screen__grid" }),
      el("div", { class: "ts-panel ts-card ts-card--wide", role: "dialog", "aria-modal": "true", "aria-label": "Settings" },
        el("div", { class: "ts-card__head" },
          el("div", { class: "ts-card__titles" },
            el("div", { class: "ts-label", text: "Instrument configuration" }),
            el("h2", { class: "ts-card__title", text: "Settings" }),
            el("div", { class: "ts-card__sub", text: "Everything applies immediately and is remembered on this device." })
          ),
          el("button", { class: "ts-btn ts-btn--icon ts-btn--ghost", type: "button", onclick: () => closeScreen() }, "Esc ✕")
        ),
        el("div", { class: "ts-rule" }),
        settingsBody,
        el("div", { class: "ts-card__foot" },
          el("button", { class: "ts-btn ts-btn--primary", type: "button", onclick: () => closeScreen() }, "Done")
        )
      )
    )
  );

  /* ---------------- controls ---------------- */
  const deviceChips = [
    { id: "keyboard", label: "Keyboard" },
    { id: "gamepad", label: "Gamepad" },
    { id: "touch", label: "Touch" },
  ].map((d) => el("button", {
    class: "ts-dev__chip", type: "button", role: "radio", "aria-checked": "false",
    "data-device": d.id, text: d.label,
    onclick: () => setControlDevice(d.id, true),
  }));

  const controlRows = [];
  const controlsBody = el("div", { class: "ts-card__body" });
  for (const group of CONTROL_GROUPS) {
    const rows = el("div", { class: "ts-ctrl__rows" });
    for (const row of group.rows) {
      const keys = el("div", { class: "ts-ctrl__keys" });
      controlRows.push({ row, keys });
      rows.appendChild(el("div", { class: "ts-ctrl__row" },
        el("div", null,
          el("div", { class: "ts-ctrl__name", text: row.name }),
          el("div", { class: "ts-ctrl__note", text: row.note })
        ),
        keys
      ));
    }
    controlsBody.appendChild(el("div", { class: "ts-ctrl__group" },
      el("div", { class: "ts-group__head" },
        el("div", { class: "ts-label", text: group.title }),
        el("div", { class: "ts-rule" }),
        group.hint ? el("div", { class: "ts-card__sub", text: group.hint }) : null
      ),
      rows
    ));
  }

  makeScreen("controls",
    el("div", { class: "ts-sheet" },
      el("div", { class: "ts-screen__grid" }),
      el("div", { class: "ts-panel ts-card ts-card--wide", role: "dialog", "aria-modal": "true", "aria-label": "Controls" },
        el("div", { class: "ts-card__head" },
          el("div", { class: "ts-card__titles" },
            el("div", { class: "ts-label", text: "Move set" }),
            el("h2", { class: "ts-card__title", text: "Controls" })
          ),
          el("div", { class: "ts-dev", role: "radiogroup", "aria-label": "Input device" }, deviceChips)
        ),
        el("div", { class: "ts-rule" }),
        controlsBody,
        el("div", { class: "ts-card__foot" },
          el("button", { class: "ts-btn ts-btn--primary", type: "button", onclick: () => closeScreen() }, "Got it")
        )
      )
    )
  );

  /* ---------------- credits ---------------- */
  makeScreen("credits",
    el("div", { class: "ts-sheet" },
      el("div", { class: "ts-screen__grid" }),
      el("div", { class: "ts-panel ts-card", role: "dialog", "aria-modal": "true", "aria-label": "Credits" },
        el("div", { class: "ts-card__head" },
          el("div", { class: "ts-card__titles" },
            el("div", { class: "ts-label", text: "Colophon" }),
            el("h2", { class: "ts-card__title", text: "Credits" })
          ),
          el("button", { class: "ts-btn ts-btn--icon ts-btn--ghost", type: "button", onclick: () => closeScreen() }, "Esc ✕")
        ),
        el("div", { class: "ts-rule" }),
        el("div", { class: "ts-card__body" },
          el("div", { class: "ts-credits", style: "padding-top:16px" },
            el("p", { text: "A back garden, rendered at the scale of a water bear. Every texture, every blade of grass and every sound in this game is generated in code at load time — nothing here was downloaded." }),
            el("dl", { class: "ts-credits__grid" },
              el("div", { class: "ts-credits__item" }, el("dt", { text: "Built by" }), el("dd", { text: "Rainbot Network" })),
              el("div", { class: "ts-credits__item" }, el("dt", { text: "Rendering" }), el("dd", { text: "Three.js · WebGL2" })),
              el("div", { class: "ts-credits__item" }, el("dt", { text: "Physics" }), el("dd", { text: "Rapier" })),
              el("div", { class: "ts-credits__item" }, el("dt", { text: "Type" }), el("dd", { text: "Barlow Condensed · Inter" })),
              el("div", { class: "ts-credits__item" }, el("dt", { text: "Art" }), el("dd", { text: "100% procedural" })),
              el("div", { class: "ts-credits__item" }, el("dt", { text: "Specimen" }), el("dd", { text: "Hypsibius dujardini" }))
            ),
            el("p", { text: "Tardigrades survive vacuum, radiation, boiling and freezing. Being launched off a terracotta plant pot at speed is, comparatively, a pleasant afternoon." })
          )
        ),
        el("div", { class: "ts-card__foot" },
          el("button", { class: "ts-btn ts-btn--primary", type: "button", onclick: () => closeScreen() }, "Back")
        )
      )
    )
  );

  /* ================================================================ */
  /* Device glyphs                                                    */
  /* ================================================================ */

  let controlDevice = "keyboard";
  let controlDevicePinned = false;

  function keyCap(label) {
    const wide = label.length > 2;
    return el("kbd", { class: `ts-key${wide ? " ts-key--wide" : ""}`, text: label });
  }

  function setControlDevice(device, pinned) {
    if (pinned) controlDevicePinned = true;
    if (controlDevice === device && pinned !== undefined) {
      // still refresh chips below
    }
    controlDevice = device;
    for (const chip of deviceChips) {
      chip.setAttribute("aria-checked", chip.getAttribute("data-device") === device ? "true" : "false");
    }
    for (const entry of controlRows) {
      const labels = entry.row[device] || entry.row.keyboard;
      entry.keys.textContent = "";
      labels.forEach((label, index) => {
        if (index > 0) entry.keys.appendChild(el("span", { class: "ts-label", text: "or", style: "letter-spacing:.14em" }));
        entry.keys.appendChild(keyCap(label));
      });
    }
  }

  const HINT_SETS = {
    keyboard: [
      { keys: ["W", "A", "S", "D"], text: "Scuttle" },
      { keys: ["Space"], text: "Jump" },
      { keys: ["E"], text: "Proboscis" },
      { keys: ["Q"], text: "Headbutt" },
      { keys: ["C"], text: "Tun" },
      { keys: ["R"], text: "Ragdoll" },
      { keys: ["Esc"], text: "Pause" },
    ],
    gamepad: [
      { keys: ["L-Stick"], text: "Scuttle" },
      { keys: ["A"], text: "Jump" },
      { keys: ["RB"], text: "Proboscis" },
      { keys: ["X"], text: "Headbutt" },
      { keys: ["B"], text: "Tun" },
      { keys: ["Y"], text: "Ragdoll" },
      { keys: ["Start"], text: "Pause" },
    ],
    touch: [],
  };

  let hintDevice = null;
  function renderHints(device) {
    const key = device === "gamepad" ? "gamepad" : device === "touch" ? "touch" : "keyboard";
    if (hintDevice === key) return;
    hintDevice = key;
    hintBar.textContent = "";
    for (const hint of HINT_SETS[key]) {
      hintBar.appendChild(el("span", { class: "ts-hint" },
        hint.keys.map((k) => keyCap(k)),
        el("span", { text: hint.text })
      ));
    }
  }

  /* ================================================================ */
  /* Objectives                                                       */
  /* ================================================================ */

  let objectives = DEFAULT_OBJECTIVES.map((o) => ({ ...o, value: 0, done: false, el: null, bar: null, valueEl: null, row: null }));

  function buildObjectives() {
    objList.textContent = "";
    for (const objective of objectives) {
      const bar = el("i");
      const valueEl = el("div", { class: "ts-obj__val", text: "0" });
      const row = el("div", { class: "ts-obj__row", "data-done": "0" },
        el("div", { class: "ts-obj__tick" }),
        el("div", { class: "ts-obj__name", text: objective.label, title: objective.label }),
        valueEl,
        el("div", { class: "ts-obj__bar" }, bar)
      );
      objective.row = row;
      objective.bar = bar;
      objective.valueEl = valueEl;
      objList.appendChild(row);
    }
    refreshObjectives(true);
  }

  function formatObjective(objective) {
    if (objective.format === "sec") return `${Math.min(objective.value, objective.goal).toFixed(1)}/${objective.goal}s`;
    return `${fmtInt(Math.min(objective.value, objective.goal))}/${fmtInt(objective.goal)}`;
  }

  let objectivesDone = 0;
  function refreshObjectives(force) {
    let done = 0;
    for (const objective of objectives) {
      const ratio = clamp01(objective.value / objective.goal);
      const wasDone = objective.done;
      objective.done = ratio >= 1;
      if (objective.done) done += 1;
      const text = formatObjective(objective);
      if (force || objective._lastText !== text) {
        objective._lastText = text;
        objective.valueEl.textContent = text;
      }
      const scale = ratio.toFixed(3);
      if (force || objective._lastScale !== scale) {
        objective._lastScale = scale;
        objective.bar.style.transform = `scaleX(${scale})`;
      }
      if (force || wasDone !== objective.done) {
        objective.row.setAttribute("data-done", objective.done ? "1" : "0");
        if (objective.done && !wasDone) announce(`Objective complete: ${objective.label}`);
      }
    }
    if (force || done !== objectivesDone) {
      objectivesDone = done;
      const text = `${done}/${objectives.length}`;
      objCount.textContent = text;
      pauseObjValue.textContent = text;
    }
  }

  function bumpObjective(id, amount, absolute) {
    const objective = objectives.find((o) => o.id === id);
    if (!objective) return;
    objective.value = absolute ? Math.max(objective.value, amount) : objective.value + amount;
    refreshObjectives(false);
  }

  buildObjectives();

  let announceTimer = 0;
  function announce(text) {
    liveRegion.textContent = text;
    announceTimer = 2.5;
  }

  /* ================================================================ */
  /* Score / combo state                                              */
  /* ================================================================ */

  let scoreTarget = ctx.state.score || 0;
  let scoreShown = scoreTarget;
  let lastScoreText = "";
  let lastExternalScore = ctx.state.score || 0;
  let pendingScore = 0;
  let scorePopTimer = 0;
  let deltaTimer = 0;
  let lastObjectiveScore = -1;

  let comboCount = 0;
  let comboMultiplier = 1;
  let comboTimer = 0;
  let comboExternal = false;
  let comboBumpTimer = 0;
  let lastComboText = "";
  let lastComboHits = "";
  let lastComboBestText = "";
  let lastComboOn = "0";
  let lastComboHeat = "0";
  let lastComboScale = "";

  function comboHeat(multiplier) {
    if (multiplier >= 6) return "3";
    if (multiplier >= 4) return "2";
    if (multiplier >= 2.2) return "1";
    return "0";
  }

  function registerCombo(count, multiplier) {
    comboCount = Math.max(0, Math.round(count));
    comboMultiplier = clamp(Number(multiplier) || 1, 1, 99);
    comboTimer = COMBO_WINDOW;
    comboBumpTimer = 0.16;
    ctx.state.combo = comboCount;
    ctx.state.comboBest = Math.max(ctx.state.comboBest || 0, comboCount);
    bumpObjective("combo", comboCount, true);
  }

  /* ================================================================ */
  /* Trick banners                                                    */
  /* ================================================================ */

  const tricks = [];

  function pushTrick(name, points) {
    const node = el("div", { class: `ts-trick${reduceMotion ? "" : " is-in"}` },
      el("div", { class: "ts-trick__name", text: trickCase(name) }),
      points > 0 ? el("div", { class: "ts-trick__pts", text: `+${fmtInt(points)}` }) : null
    );
    trickStack.appendChild(node);
    tricks.push({ node, life: TRICK_LIFE, out: false });
    while (tricks.length > MAX_TRICKS) {
      const oldest = tricks.shift();
      oldest.node.remove();
    }
  }

  function updateTricks(dt) {
    for (let i = tricks.length - 1; i >= 0; i -= 1) {
      const trick = tricks[i];
      trick.life -= dt;
      if (trick.life <= 0.42 && !trick.out) {
        trick.out = true;
        trick.node.classList.remove("is-in");
        trick.node.classList.add("is-out");
      }
      if (trick.life <= 0) {
        trick.node.remove();
        tricks.splice(i, 1);
      }
    }
  }

  /* ================================================================ */
  /* World-space callouts                                             */
  /* ================================================================ */

  const callouts = [];
  for (let i = 0; i < MAX_CALLOUTS; i += 1) {
    const node = el("div", { class: "ts-callout" }, el("b"), el("span"));
    calloutLayer.appendChild(node);
    callouts.push({
      node,
      value: node.querySelector("b"),
      label: node.querySelector("span"),
      active: false,
      life: 0,
      total: CALLOUT_LIFE,
      world: new THREE.Vector3(),
      drift: 0,
      wasVisible: false,
    });
  }
  const projected = new THREE.Vector3();
  let viewWidth = Math.max(1, window.innerWidth);
  let viewHeight = Math.max(1, window.innerHeight);

  function spawnCallout(position, amount, label) {
    if (!position) return;
    let slot = callouts.find((c) => !c.active);
    if (!slot) {
      // Recycle the oldest.
      slot = callouts.reduce((a, b) => (a.life <= b.life ? a : b));
    }
    slot.active = true;
    slot.life = CALLOUT_LIFE;
    slot.drift = (rng() - 0.5) * 34;
    slot.world.set(
      position.x !== undefined ? position.x : position[0] || 0,
      position.y !== undefined ? position.y : position[1] || 0,
      position.z !== undefined ? position.z : position[2] || 0
    );
    slot.value.textContent = `+${fmtInt(amount)}`;
    slot.label.textContent = label ? trickCase(label) : "";
    slot.node.setAttribute("data-kind", amount >= 1500 ? "big" : "std");
    slot.node.classList.add("is-on");
    slot.wasVisible = true;
  }

  function updateCallouts(dt) {
    let any = false;
    for (const slot of callouts) {
      if (!slot.active) continue;
      any = true;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        slot.node.classList.remove("is-on");
        slot.wasVisible = false;
        continue;
      }
      const t = 1 - slot.life / slot.total;
      projected.copy(slot.world).project(ctx.camera);
      const onScreen = projected.z < 1 && projected.x > -1.6 && projected.x < 1.6 && projected.y > -1.6 && projected.y < 1.6;
      if (!onScreen) {
        if (slot.wasVisible) {
          slot.node.classList.remove("is-on");
          slot.wasVisible = false;
        }
        continue;
      }
      if (!slot.wasVisible) {
        slot.node.classList.add("is-on");
        slot.wasVisible = true;
      }
      const x = (projected.x * 0.5 + 0.5) * viewWidth + slot.drift * t;
      const y = (-projected.y * 0.5 + 0.5) * viewHeight - 14 - t * 96;
      const pop = t < 0.16 ? 1 + (0.16 - t) * 2.6 : 1;
      const fade = t > 0.62 ? clamp01((1 - t) / 0.38) : 1;
      slot.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${pop.toFixed(3)})`;
      slot.node.style.opacity = fade.toFixed(3);
    }
    return any;
  }

  /* ================================================================ */
  /* Perf overlay                                                     */
  /* ================================================================ */

  const perfCtx = perfCanvas.getContext("2d");
  const perfHistory = new Float32Array(112);
  let perfHistoryIndex = 0;
  let perfAccum = 0;
  let perfFpsSmoothed = 60;

  function applyPerfVisibility() {
    perfBlock.setAttribute("data-on", ctx.settings.showPerf ? "1" : "0");
  }
  applyPerfVisibility();

  function drawPerfGraph() {
    if (!perfCtx) return;
    const w = perfCanvas.width;
    const h = perfCanvas.height;
    perfCtx.clearRect(0, 0, w, h);

    // 16.7ms budget line
    const budgetY = h - (16.7 / 40) * h;
    perfCtx.strokeStyle = "rgba(255, 209, 102, 0.45)";
    perfCtx.setLineDash([3, 3]);
    perfCtx.beginPath();
    perfCtx.moveTo(0, budgetY);
    perfCtx.lineTo(w, budgetY);
    perfCtx.stroke();
    perfCtx.setLineDash([]);

    perfCtx.beginPath();
    for (let i = 0; i < perfHistory.length; i += 1) {
      const index = (perfHistoryIndex + i) % perfHistory.length;
      const value = perfHistory[index];
      const x = (i / (perfHistory.length - 1)) * w;
      const y = h - clamp01(value / 40) * h;
      if (i === 0) perfCtx.moveTo(x, y);
      else perfCtx.lineTo(x, y);
    }
    perfCtx.strokeStyle = "rgba(110, 231, 168, 0.92)";
    perfCtx.lineWidth = 2;
    perfCtx.stroke();
    perfCtx.lineTo(w, h);
    perfCtx.lineTo(0, h);
    perfCtx.closePath();
    perfCtx.fillStyle = "rgba(110, 231, 168, 0.14)";
    perfCtx.fill();
  }

  function updatePerf(dt) {
    if (!ctx.settings.showPerf) return;
    perfHistory[perfHistoryIndex] = ctx.time.dt * 1000;
    perfHistoryIndex = (perfHistoryIndex + 1) % perfHistory.length;

    perfFpsSmoothed = damp(perfFpsSmoothed, ctx.time.fps || 0, 6, Math.max(dt, 0.0001));
    perfAccum += dt;
    if (perfAccum < 0.2) return;
    perfAccum = 0;

    const fps = Math.round(perfFpsSmoothed);
    perfFps.textContent = String(fps);
    perfFps.setAttribute("data-warn", fps >= 55 ? "0" : fps >= 40 ? "1" : "2");

    const p90 = ctx.perf.frameMs.percentile(0.9);
    perfRows.p90.textContent = `${p90.toFixed(1)} ms`;
    perfRows.cpu.textContent = `${ctx.perf.cpuMs.mean.toFixed(1)} ms`;
    perfRows.draw.textContent = fmtInt(ctx.perf.drawCalls);
    perfRows.tri.textContent = ctx.perf.triangles >= 100000
      ? `${(ctx.perf.triangles / 1000000).toFixed(2)} M`
      : fmtInt(ctx.perf.triangles);

    let physMs = null;
    if (ctx.physics && typeof ctx.physics.report === "function") {
      const info = ctx.physics.report();
      if (info && typeof info.stepMs === "number") physMs = info.stepMs;
    }
    perfRows.phys.textContent = physMs === null ? "—" : `${physMs.toFixed(2)} ms`;
    perfRows.scale.textContent = ctx.engine ? `${(ctx.engine.renderScale * 100).toFixed(0)}%` : "—";

    drawPerfGraph();
  }

  /* ================================================================ */
  /* Phase + screen management                                        */
  /* ================================================================ */

  let currentScreen = null;
  let returnScreen = null;
  let lastFocused = null;
  let lastPhase = null;
  let wasPointerLocked = false;

  function showScreen(id, backTo) {
    if (currentScreen === id) return;
    if (currentScreen && screens[currentScreen]) screens[currentScreen].setAttribute("data-on", "0");
    currentScreen = id;
    returnScreen = backTo === undefined ? returnScreen : backTo;
    if (!id) return;
    const node = screens[id];
    if (!node) return;
    node.setAttribute("data-on", "1");
    if (id === "settings") for (const sync of settingsControls) sync();
    if (id === "controls" && !controlDevicePinned) setControlDevice(preferredDevice());
    if (id === "pause") {
      pauseScoreValue.textContent = fmtInt(ctx.state.score || 0);
      pauseComboValue.textContent = `x${(ctx.state.comboBest || 0).toFixed(0)}`;
    }
    // Move focus into the panel so keyboard users land somewhere sensible.
    const focusable = node.querySelector("button, [href], input, [tabindex]:not([tabindex='-1'])");
    if (focusable && !(ctx.qa && ctx.qa.hudHidden)) {
      lastFocused = document.activeElement;
      window.setTimeout(() => { try { focusable.focus({ preventScroll: true }); } catch (error) { /* ignore */ } }, 30);
    }
  }

  function closeScreen() {
    const back = returnScreen || (ctx.state.phase === "playing" ? null : "menu");
    returnScreen = null;
    if (back === "menu") { setPhase("menu"); return; }
    if (back === "pause") { setPhase("paused"); return; }
    startPlay();
  }

  function preferredDevice() {
    const device = ctx.input.lastDevice;
    if (device === "gamepad") return "gamepad";
    if (device === "touch") return "touch";
    if (touchEnabled && device !== "mouse") return "touch";
    return "keyboard";
  }

  /** input.js ignores key-up while disabled, so drain held actions first
   *  or a key held at the moment of pausing would latch down forever. */
  function clearHeldInput() {
    for (const action of ctx.input.actions) ctx.input.qaSet(action, false);
  }

  function applyPhase(phase) {
    lastPhase = phase;
    const playing = phase === "playing";
    hudRoot.setAttribute("data-active", playing ? "1" : "0");
    reticle.style.opacity = playing && !touchEnabled ? "" : "0";
    if (ctx.input.enabled !== playing) {
      clearHeldInput();
      ctx.input.enabled = playing;
    }

    if (phase === "menu") showScreen("menu", null);
    else if (phase === "paused") showScreen("pause", null);
    else showScreen(null);

    if (!playing) ctx.input.releaseLock();
  }

  function setPhase(phase) {
    ctx.state.phase = phase;
    applyPhase(phase);
  }

  function startPlay() {
    returnScreen = null;
    setPhase("playing");
    if (!touchEnabled) {
      // Must happen inside the click gesture for pointer lock to be granted.
      ctx.input.requestLock();
    }
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }

  /* ---- keyboard: Escape and menu shortcuts ---- */
  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === "Escape") {
      event.preventDefault();
      if (currentScreen === "settings" || currentScreen === "controls" || currentScreen === "credits") closeScreen();
      else if (ctx.state.phase === "playing") setPhase("paused");
      else if (ctx.state.phase === "paused") startPlay();
      return;
    }
    if (ctx.state.phase === "menu" && (event.code === "Enter" || event.code === "NumpadEnter")) {
      if (document.activeElement && document.activeElement.classList.contains("ts-mitem")) return;
      event.preventDefault();
      startPlay();
    }
  }
  window.addEventListener("keydown", onKeyDown);

  /* ---- auto-pause when the player loses pointer lock mid-game ---- */
  const offLock = ctx.events.on("input:pointerlock", (locked) => {
    if (locked) { wasPointerLocked = true; return; }
    if (wasPointerLocked && ctx.state.phase === "playing" && !touchEnabled) setPhase("paused");
    wasPointerLocked = false;
  });

  /* ================================================================ */
  /* Event wiring                                                     */
  /* ================================================================ */

  let wreckCount = 0;
  let grappleCount = 0;
  let airborne = false;
  let airTime = 0;
  let bestAirTime = 0;

  const unsubscribers = [
    ctx.events.on("score", (payload) => {
      if (!payload) return;
      const amount = Number(payload.amount) || 0;
      const reason = payload.reason || GENERIC_TRICKS[Math.floor(rng() * GENERIC_TRICKS.length)];
      pendingScore += amount;
      scorePopTimer = 0.16;
      deltaTimer = 1.1;
      scoreDelta.textContent = `+${fmtInt(amount)}`;
      scoreDelta.classList.add("is-on");
      pushTrick(reason, amount);
      spawnCallout(payload.position, amount, reason);
      if (!comboExternal) {
        const next = comboTimer > 0 ? comboCount + 1 : 1;
        registerCombo(next, Math.min(9.9, 1 + (next - 1) * 0.4));
      } else {
        comboTimer = Math.max(comboTimer, COMBO_WINDOW * 0.72);
      }
    }),

    ctx.events.on("combo", (payload) => {
      if (!payload) return;
      comboExternal = true;
      registerCombo(payload.count, payload.multiplier);
    }),

    ctx.events.on("prop:destroyed", () => {
      wreckCount += 1;
      bumpObjective("wreck", 1, false);
    }),

    ctx.events.on("player:grapple", () => {
      grappleCount += 1;
      bumpObjective("grapple", 1, false);
    }),

    ctx.events.on("player:jump", () => {
      airborne = true;
      airTime = 0;
    }),

    ctx.events.on("player:land", () => {
      if (airborne) {
        bestAirTime = Math.max(bestAirTime, airTime);
        bumpObjective("airtime", bestAirTime, true);
      }
      airborne = false;
      airTime = 0;
    }),

    ctx.events.on("settings:changed", (payload) => {
      if (payload && payload.key === "showPerf") applyPerfVisibility();
    }),

    ctx.events.on("ready", () => {
      applyPhase(ctx.state.phase);
      renderHints(preferredDevice());
      setControlDevice(preferredDevice());
    }),

    offLock,
  ];

  /* ================================================================ */
  /* Per-frame update                                                 */
  /* ================================================================ */

  let gaugeLastValue = -1;
  let gaugeLastOffset = "";
  let airChipLast = "";
  let airChipOnLast = "0";
  let magLast = "";
  let magAccum = 0;
  let deviceAccum = 0;

  function updateScore(dt) {
    // Adopt whoever owns ctx.state.score; otherwise apply our own pending total.
    if (ctx.state.score !== lastExternalScore) {
      lastExternalScore = ctx.state.score;
      pendingScore = 0;
    } else if (pendingScore !== 0) {
      ctx.state.score += pendingScore;
      lastExternalScore = ctx.state.score;
      pendingScore = 0;
    }
    scoreTarget = ctx.state.score || 0;
    if (scoreTarget !== lastObjectiveScore) {
      lastObjectiveScore = scoreTarget;
      bumpObjective("score", scoreTarget, true);
    }

    scoreShown = reduceMotion ? scoreTarget : damp(scoreShown, scoreTarget, 11, dt);
    if (Math.abs(scoreTarget - scoreShown) < 0.6) scoreShown = scoreTarget;
    const text = fmtInt(scoreShown);
    if (text !== lastScoreText) {
      lastScoreText = text;
      scoreValue.textContent = text;
    }

    if (scorePopTimer > 0) {
      scorePopTimer -= dt;
      if (!scoreBlock.classList.contains("is-pop")) scoreBlock.classList.add("is-pop");
      if (scorePopTimer <= 0) scoreBlock.classList.remove("is-pop");
    }
    if (deltaTimer > 0) {
      deltaTimer -= dt;
      if (deltaTimer <= 0) scoreDelta.classList.remove("is-on");
    }
  }

  function updateCombo(dt) {
    if (comboTimer > 0) {
      comboTimer = Math.max(0, comboTimer - dt);
      if (comboTimer === 0) {
        comboCount = 0;
        comboMultiplier = 1;
        ctx.state.combo = 0;
      }
    }

    const on = comboCount > 1 || (comboCount === 1 && comboTimer > 0) ? "1" : "0";
    if (on !== lastComboOn) {
      lastComboOn = on;
      comboBlock.setAttribute("data-on", on);
    }
    if (on === "0") return;

    const multText = comboMultiplier.toFixed(1);
    if (multText !== lastComboText) {
      lastComboText = multText;
      comboMultNum.textContent = multText;
    }
    const heat = comboHeat(comboMultiplier);
    if (heat !== lastComboHeat) {
      lastComboHeat = heat;
      comboBlock.setAttribute("data-heat", heat);
    }
    const hits = `${comboCount} hit${comboCount === 1 ? "" : "s"}`;
    if (hits !== lastComboHits) {
      lastComboHits = hits;
      comboHits.textContent = hits;
    }
    const bestText = `BEST ${fmtInt(ctx.state.comboBest || 0)}`;
    if (bestText !== lastComboBestText) {
      lastComboBestText = bestText;
      comboBest.textContent = bestText;
    }
    const scale = (comboTimer / COMBO_WINDOW).toFixed(3);
    if (scale !== lastComboScale) {
      lastComboScale = scale;
      comboBarFill.style.transform = `scaleX(${scale})`;
    }

    if (comboBumpTimer > 0) {
      comboBumpTimer -= dt;
      if (!comboBlock.classList.contains("is-bump")) comboBlock.classList.add("is-bump");
      if (comboBumpTimer <= 0) comboBlock.classList.remove("is-bump");
    }
  }

  function updateSpeed(dt) {
    let speed = 0;
    if (ctx.player && ctx.player.velocity) {
      const v = ctx.player.velocity;
      speed = Math.hypot(v.x, v.z);
    }
    const shown = gaugeLastValue < 0 ? speed : damp(gaugeLastValue, speed, 9, dt);
    gaugeLastValue = shown;

    const text = shown.toFixed(1);
    if (gaugeValue.textContent !== text) gaugeValue.textContent = text;

    const offset = (100 - clamp01(shown / 26) * 100).toFixed(1);
    if (offset !== gaugeLastOffset) {
      gaugeLastOffset = offset;
      gaugeFill.setAttribute("stroke-dashoffset", offset);
    }

    if (airborne) airTime += dt;
    const airText = `${airTime.toFixed(1)}s`;
    if (airText !== airChipLast) {
      airChipLast = airText;
      airChipValue.textContent = airText;
    }
    const airOn = airborne ? "1" : "0";
    if (airOn !== airChipOnLast) {
      airChipOnLast = airOn;
      airChip.setAttribute("data-on", airOn);
    }

    magAccum += dt;
    if (magAccum > 0.25) {
      magAccum = 0;
      let distance = 8;
      if (ctx.player && ctx.player.position) distance = Math.max(1, ctx.camera.position.distanceTo(ctx.player.position));
      const mag = Math.round(9600 / distance / 25) * 25;
      const text2 = `x${fmtInt(mag)}`;
      if (text2 !== magLast) {
        magLast = text2;
        magChipValue.textContent = text2;
      }
    }
  }

  /* ================================================================ */
  /* Public API                                                       */
  /* ================================================================ */

  const api = {
    /** Other systems may publish their own challenge list. */
    setObjectives(list) {
      if (!Array.isArray(list) || !list.length) return;
      objectives = list.map((o) => ({
        id: o.id, label: o.label, goal: Number(o.goal) || 1,
        format: o.format || "int", value: Number(o.value) || 0, done: false,
      }));
      buildObjectives();
    },
    setObjectiveProgress(id, value) { bumpObjective(id, Number(value) || 0, true); },
    showScreen,
    startPlay,
    setPhase,
    /** Fires a representative burst of HUD juice - used by the visual harness. */
    debugBurst(seed = 0) {
      const spot = ctx.player && ctx.player.position
        ? { x: ctx.player.position.x, y: ctx.player.position.y + 1.6, z: ctx.player.position.z }
        : { x: 0, y: 2, z: 0 };
      const names = ["Proboscis Yank", "Terracotta Demolition", "Backflip Headbutt", "Tun Bowling"];
      ctx.events.emit("score", {
        amount: 480 + seed * 260,
        reason: names[seed % names.length],
        position: spot,
      });
    },

    update(dt) {
      const step = Math.max(0, Math.min(dt, 0.1));

      // Follow phase changes made by other systems.
      if (ctx.state.phase !== lastPhase) applyPhase(ctx.state.phase);

      if (announceTimer > 0) {
        announceTimer -= step;
        if (announceTimer <= 0) liveRegion.textContent = "";
      }

      if (ctx.qa && ctx.qa.hudHidden) return;

      updateScore(step);
      updateCombo(step);
      updateSpeed(step);
      updateTricks(step);
      updatePerf(step);

      deviceAccum += step;
      if (deviceAccum > 0.4) {
        deviceAccum = 0;
        renderHints(preferredDevice());
        if (!controlDevicePinned && currentScreen === "controls") setControlDevice(preferredDevice());
      }
    },

    lateUpdate() {
      if (ctx.qa && ctx.qa.hudHidden) return;
      updateCallouts(Math.max(0, Math.min(ctx.time.dt, 0.1)));
    },

    resize(width, height) {
      viewWidth = Math.max(1, width);
      viewHeight = Math.max(1, height);
    },

    report() {
      return {
        screen: currentScreen,
        phase: ctx.state.phase,
        touch: touchEnabled,
        objectives: `${objectivesDone}/${objectives.length}`,
        activeCallouts: callouts.filter((c) => c.active).length,
        tricks: tricks.length,
        combo: { count: comboCount, multiplier: Number(comboMultiplier.toFixed(2)), external: comboExternal },
        wreckCount,
        grappleCount,
        bestAirTime: Number(bestAirTime.toFixed(2)),
        perfVisible: Boolean(ctx.settings.showPerf),
      };
    },

    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      for (const off of unsubscribers) { if (typeof off === "function") off(); }
      style.remove();
      hudRoot.remove();
      liveRegion.remove();
      touchRoot.remove();
      overlayRoot.remove();
    },
  };

  // Phase may already be settled if `ready` fired before this system loaded.
  applyPhase(ctx.state.phase === "loading" ? "menu" : ctx.state.phase);
  renderHints(preferredDevice());
  setControlDevice(preferredDevice());

  return api;
}
