/* ============================================================
   SAINTFALL - native field interface

   Owns the hold-to-command wheel and the in-game field menu. The
   simulation reacts only to the body classes this module exposes;
   durable game state remains owned by the save and mission systems.
   ============================================================ */

import { QUALITY_TIERS, DEFAULT_QUALITY, normalizeQuality, qualityLabel } from "saintfall/render.js";
import {
  DIFFICULTY_TIERS, DEFAULT_DIFFICULTY, normalizeDifficulty, difficultyLabel, difficultyBlurb,
} from "saintfall/difficulty.js";
import {
  KEYBIND_ACTIONS, KEYBIND_GROUPS, RESERVED_CODES, actionForCode, keyLabel,
  keybindMatches, keybindSlots, resetKeybinds, setKeybind,
  keybindAction,
} from "saintfall/keybinds.js";

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const SETTINGS_KEY = "saintfall:field-ui:v1";
const PANEL_NAMES = new Set(["operation", "map", "doctrine", "saves", "controls", "settings"]);
function createKenosisOrderSigil(id) {
  const defs = {
    quicksilver: {
      accent: "#9df3e0", bright: "#eafff7", dark: "#0a2e26", spokes: 8,
      emblem: `
        <path d="M190 320 C160 260 210 180 280 160 C350 140 370 200 320 250 C270 300 210 310 190 320 Z" fill="none" stroke="#9df3e0" stroke-width="8" opacity="0.85"/>
        <path d="M322 192 C352 252 302 332 232 352 C162 372 142 312 192 262 C242 212 302 202 322 192 Z" fill="none" stroke="#eafff7" stroke-width="8" opacity="0.95"/>
        <path d="M130 382 L382 130" stroke="#9df3e0" stroke-width="10" stroke-linecap="round"/>
        <polygon points="382,130 340,145 367,172" fill="#eafff7"/>
        <polygon points="130,382 172,367 145,340" fill="#9df3e0"/>
        <circle cx="256" cy="256" r="18" fill="#eafff7"/>
        <circle cx="256" cy="256" r="32" fill="none" stroke="#9df3e0" stroke-width="4" stroke-dasharray="8 6"/>
        <polygon points="256,190 264,204 278,204 266,214 270,228 256,218 242,228 246,214 234,204 248,204" fill="#eafff7"/>
        <polygon points="256,322 264,308 278,308 266,298 270,284 256,294 242,284 246,298 234,308 248,308" fill="#9df3e0"/>
      `,
    },
    crescent: {
      accent: "#ffe6a2", bright: "#fff6dc", dark: "#3d2c05", spokes: 12,
      emblem: `
        <path d="M230 140 A120 120 0 0 0 230 372 A145 145 0 0 1 230 140 Z" fill="none" stroke="#ffe6a2" stroke-width="9" opacity="0.9"/>
        <path d="M282 372 A120 120 0 0 0 282 140 A145 145 0 0 1 282 372 Z" fill="none" stroke="#fff6dc" stroke-width="9" opacity="0.9"/>
        <circle cx="256" cy="256" r="24" fill="#ffe6a2"/>
        <circle cx="256" cy="256" r="42" fill="none" stroke="#fff6dc" stroke-width="4" stroke-dasharray="10 8"/>
        <line x1="256" y1="120" x2="256" y2="392" stroke="#fff6dc" stroke-width="4" stroke-linecap="round" opacity="0.7"/>
        <line x1="120" y1="256" x2="392" y2="256" stroke="#fff6dc" stroke-width="4" stroke-linecap="round" opacity="0.7"/>
        <circle cx="256" cy="120" r="6" fill="#ffe6a2"/>
        <circle cx="256" cy="392" r="6" fill="#ffe6a2"/>
        <circle cx="120" cy="256" r="6" fill="#ffe6a2"/>
        <circle cx="392" cy="256" r="6" fill="#ffe6a2"/>
      `,
    },
    stoop: {
      accent: "#8fd6e6", bright: "#eafcff", dark: "#0b2c34", spokes: 6,
      emblem: `
        <path d="M256 120 L300 230 L390 260 L290 280 L256 400 L222 280 L122 260 L212 230 Z" fill="none" stroke="#8fd6e6" stroke-width="8" stroke-linejoin="round" opacity="0.85"/>
        <path d="M256 150 L280 235 L330 255 L275 270 L256 360 L237 270 L182 255 L232 235 Z" fill="none" stroke="#eafcff" stroke-width="5" stroke-linejoin="round"/>
        <line x1="256" y1="100" x2="256" y2="420" stroke="#eafcff" stroke-width="7" stroke-linecap="round"/>
        <path d="M200 340 L256 395 L312 340" fill="none" stroke="#8fd6e6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M220 370 L256 405 L292 370" fill="none" stroke="#eafcff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="256" cy="256" r="14" fill="#eafcff"/>
      `,
    },
    vigil: {
      accent: "#cfe0f4", bright: "#ffffff", dark: "#13253b", spokes: 6,
      emblem: `
        <polygon points="256,120 360,180 360,332 256,392 152,332 152,180" fill="none" stroke="#cfe0f4" stroke-width="8" stroke-linejoin="round" opacity="0.9"/>
        <polygon points="256,148 334,194 334,318 256,364 178,318 178,194" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" opacity="0.6"/>
        <path d="M168 256 Q256 160 344 256 Q256 352 168 256 Z" fill="none" stroke="#cfe0f4" stroke-width="7" stroke-linejoin="round"/>
        <circle cx="256" cy="256" r="32" fill="none" stroke="#ffffff" stroke-width="6"/>
        <circle cx="256" cy="256" r="16" fill="#ffffff"/>
        <line x1="256" y1="100" x2="256" y2="148" stroke="#ffffff" stroke-width="6"/>
        <line x1="256" y1="364" x2="256" y2="412" stroke="#ffffff" stroke-width="6"/>
      `,
    },
    antiphon: {
      accent: "#c9a8ff", bright: "#f2e9ff", dark: "#281045", spokes: 10,
      emblem: `
        <circle cx="256" cy="256" r="140" fill="none" stroke="#c9a8ff" stroke-width="4" stroke-dasharray="14 10" opacity="0.6"/>
        <circle cx="256" cy="256" r="105" fill="none" stroke="#f2e9ff" stroke-width="6" opacity="0.8"/>
        <circle cx="256" cy="256" r="70" fill="none" stroke="#c9a8ff" stroke-width="7"/>
        <circle cx="256" cy="256" r="35" fill="none" stroke="#f2e9ff" stroke-width="8"/>
        <circle cx="256" cy="256" r="14" fill="#f2e9ff"/>
        <polygon points="256,120 268,156 306,156 276,178 288,214 256,192 224,214 236,178 206,156 244,156" fill="#c9a8ff" opacity="0.9"/>
        <polygon points="256,392 268,356 306,356 276,334 288,298 256,320 224,298 236,334 206,356 244,356" fill="#c9a8ff" opacity="0.9"/>
        <polygon points="120,256 156,244 156,206 178,236 214,224 192,256 214,288 178,276 156,306 156,268" fill="#c9a8ff" opacity="0.9"/>
        <polygon points="392,256 356,244 356,206 334,236 298,224 320,256 298,288 334,276 356,306 356,268" fill="#c9a8ff" opacity="0.9"/>
      `,
    },
    bulwark: {
      accent: "#ff9540", bright: "#ffe0b0", dark: "#3d1a01", spokes: 8,
      emblem: `
        <path d="M160 140 L352 140 L352 280 C352 350 256 392 256 392 C256 392 160 350 160 280 Z" fill="none" stroke="#ff9540" stroke-width="10" stroke-linejoin="round" opacity="0.95"/>
        <path d="M184 164 L328 164 L328 274 C328 328 256 364 256 364 C256 364 184 328 184 274 Z" fill="none" stroke="#ffe0b0" stroke-width="5" stroke-linejoin="round" opacity="0.7"/>
        <line x1="256" y1="140" x2="256" y2="380" stroke="#ffe0b0" stroke-width="8"/>
        <line x1="160" y1="230" x2="352" y2="230" stroke="#ffe0b0" stroke-width="8"/>
        <line x1="160" y1="300" x2="352" y2="300" stroke="#ff9540" stroke-width="6"/>
        <polygon points="256,170 272,200 240,200" fill="#ffe0b0"/>
        <polygon points="256,270 276,270 256,300 236,270" fill="#ffe0b0"/>
        <circle cx="256" cy="230" r="16" fill="#ffe0b0"/>
      `,
    },
    cast: {
      accent: "#ffc453", bright: "#fff4d8", dark: "#3a2702", spokes: 10,
      emblem: `
        <rect x="180" y="160" width="152" height="74" rx="8" fill="none" stroke="#ffc453" stroke-width="9" opacity="0.9"/>
        <rect x="200" y="174" width="112" height="46" rx="4" fill="none" stroke="#fff4d8" stroke-width="4" opacity="0.7"/>
        <line x1="256" y1="234" x2="256" y2="390" stroke="#fff4d8" stroke-width="10" stroke-linecap="round"/>
        <line x1="256" y1="130" x2="256" y2="160" stroke="#ffc453" stroke-width="8" stroke-linecap="round"/>
        <path d="M150 220 C110 270 140 350 200 370 C270 390 380 340 370 260 C360 190 280 130 210 130" fill="none" stroke="#ffc453" stroke-width="5" stroke-dasharray="14 10" stroke-linecap="round" opacity="0.8"/>
        <polygon points="210,130 230,116 230,144" fill="#fff4d8"/>
        <circle cx="256" cy="390" r="14" fill="#fff4d8"/>
        <circle cx="256" cy="197" r="12" fill="#fff4d8"/>
      `,
    },
    forge: {
      accent: "#ff6a2a", bright: "#ffc07a", dark: "#3b1101", spokes: 6,
      emblem: `
        <polygon points="256,120 370,360 142,360" fill="none" stroke="#ff6a2a" stroke-width="9" stroke-linejoin="round" opacity="0.9"/>
        <polygon points="256,160 342,340 170,340" fill="none" stroke="#ffc07a" stroke-width="4" stroke-linejoin="round" opacity="0.6"/>
        <path d="M256 210 C275 250 310 270 300 310 C290 340 265 345 256 345 C247 345 222 340 212 310 C202 270 237 250 256 210 Z" fill="#ff6a2a" opacity="0.85"/>
        <path d="M256 250 C268 275 288 290 280 320 C274 336 262 340 256 340 C250 340 238 336 232 320 C224 290 244 275 256 250 Z" fill="#ffc07a"/>
        <line x1="256" y1="100" x2="256" y2="120" stroke="#ffc07a" stroke-width="6" stroke-linecap="round"/>
        <line x1="142" y1="360" x2="126" y2="380" stroke="#ff6a2a" stroke-width="6" stroke-linecap="round"/>
        <line x1="370" y1="360" x2="386" y2="380" stroke="#ff6a2a" stroke-width="6" stroke-linecap="round"/>
      `,
    },
    anvil: {
      accent: "#e8503a", bright: "#ffd0b0", dark: "#380a04", spokes: 8,
      emblem: `
        <path d="M150 250 L180 200 L340 200 L370 230 L320 250 L300 280 L340 350 L172 350 L212 280 L192 250 Z" fill="none" stroke="#e8503a" stroke-width="9" stroke-linejoin="round" opacity="0.9"/>
        <path d="M200 220 L320 220 L300 250 L230 250 Z" fill="#ffd0b0" opacity="0.75"/>
        <line x1="256" y1="110" x2="256" y2="190" stroke="#ffd0b0" stroke-width="12" stroke-linecap="round"/>
        <polygon points="220,110 292,110 280,145 232,145" fill="#e8503a"/>
        <line x1="180" y1="170" x2="220" y2="190" stroke="#ffd0b0" stroke-width="4" stroke-linecap="round"/>
        <line x1="332" y1="170" x2="292" y2="190" stroke="#ffd0b0" stroke-width="4" stroke-linecap="round"/>
        <circle cx="256" cy="305" r="14" fill="#ffd0b0"/>
      `,
    },
    tocsin: {
      accent: "#6fd3b0", bright: "#dffaf0", dark: "#0a2d21", spokes: 12,
      emblem: `
        <path d="M256 130 C200 130 180 220 160 300 L352 300 C332 220 312 130 256 130 Z" fill="none" stroke="#6fd3b0" stroke-width="9" stroke-linejoin="round" opacity="0.9"/>
        <path d="M144 300 C144 320 368 320 368 300 Z" fill="#6fd3b0" stroke="#dffaf0" stroke-width="5"/>
        <circle cx="256" cy="340" r="22" fill="#dffaf0"/>
        <line x1="256" y1="300" x2="256" y2="340" stroke="#dffaf0" stroke-width="6"/>
        <path d="M236 100 L276 100 L276 130 L236 130 Z" fill="none" stroke="#dffaf0" stroke-width="5" stroke-linejoin="round"/>
        <path d="M110 256 A150 150 0 0 1 130 180" fill="none" stroke="#6fd3b0" stroke-width="5" stroke-linecap="round" opacity="0.7"/>
        <path d="M402 256 A150 150 0 0 0 382 180" fill="none" stroke="#6fd3b0" stroke-width="5" stroke-linecap="round" opacity="0.7"/>
        <path d="M90 280 A180 180 0 0 1 120 160" fill="none" stroke="#dffaf0" stroke-width="4" stroke-linecap="round" opacity="0.5"/>
        <path d="M422 280 A180 180 0 0 0 392 160" fill="none" stroke="#dffaf0" stroke-width="4" stroke-linecap="round" opacity="0.5"/>
      `,
    },
  };

  const c = defs[id] || defs.quicksilver;
  const spokes = [];
  for (let i = 0; i < c.spokes; i += 1) {
    const a = (i / c.spokes) * Math.PI * 2 - Math.PI / 2;
    const x1 = 256 + Math.cos(a) * 80;
    const y1 = 256 + Math.sin(a) * 80;
    const x2 = 256 + Math.cos(a) * 210;
    const y2 = 256 + Math.sin(a) * 210;
    spokes.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
    + `<defs>`
    + `<radialGradient id="sf-sigil-bg-${id}" cx="50%" cy="50%" r="50%">`
    + `<stop offset="0%" stop-color="${c.dark}" stop-opacity="0.92"/>`
    + `<stop offset="65%" stop-color="#070c12" stop-opacity="0.96"/>`
    + `<stop offset="100%" stop-color="#020406"/>`
    + `</radialGradient>`
    + `<radialGradient id="sf-sigil-glow-${id}" cx="50%" cy="50%" r="40%">`
    + `<stop offset="0%" stop-color="${c.bright}" stop-opacity="0.32"/>`
    + `<stop offset="100%" stop-color="${c.accent}" stop-opacity="0"/>`
    + `</radialGradient>`
    + `</defs>`
    + `<rect width="512" height="512" rx="28" fill="url(#sf-sigil-bg-${id})"/>`
    + `<rect x="18" y="18" width="476" height="476" rx="20" fill="none" stroke="${c.accent}" stroke-width="2.5" opacity="0.35"/>`
    + `<rect x="32" y="32" width="448" height="448" rx="14" fill="none" stroke="${c.bright}" stroke-width="1.5" stroke-dasharray="16 12" opacity="0.45"/>`
    + `<circle cx="256" cy="256" r="218" fill="none" stroke="${c.accent}" stroke-width="3" opacity="0.4"/>`
    + `<circle cx="256" cy="256" r="185" fill="none" stroke="${c.bright}" stroke-width="1.8" opacity="0.3"/>`
    + `<g fill="none" stroke="${c.accent}" stroke-width="2" opacity="0.25">${spokes.join("")}</g>`
    + `<circle cx="256" cy="256" r="150" fill="url(#sf-sigil-glow-${id})"/>`
    + `<g>${c.emblem}</g>`
    + `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const DOCTRINE_SIGILS = Object.freeze({
  /* Campaign - Saint Aurel */
  censer: new URL("../../img/saintfall/doctrine/order-censer-sigil-ai-v1.jpg", import.meta.url).href,
  procession: new URL("../../img/saintfall/doctrine/order-procession-sigil-ai-v1.jpg", import.meta.url).href,
  wing: new URL("../../img/saintfall/doctrine/order-wing-sigil-ai-v1.jpg", import.meta.url).href,
  halo: new URL("../../img/saintfall/doctrine/order-halo-sigil-ai-v1.jpg", import.meta.url).href,
  edict: new URL("../../img/saintfall/doctrine/order-edict-sigil-ai-v1.jpg", import.meta.url).href,

  /* Kenosis - Saint Veyra */
  quicksilver: createKenosisOrderSigil("quicksilver"),
  crescent: createKenosisOrderSigil("crescent"),
  stoop: createKenosisOrderSigil("stoop"),
  vigil: createKenosisOrderSigil("vigil"),
  antiphon: createKenosisOrderSigil("antiphon"),

  /* Kenosis - Saint Torren */
  bulwark: createKenosisOrderSigil("bulwark"),
  cast: createKenosisOrderSigil("cast"),
  forge: createKenosisOrderSigil("forge"),
  anvil: createKenosisOrderSigil("anvil"),
  tocsin: createKenosisOrderSigil("tocsin"),
});
const WHEEL_POINTS = Object.freeze([
  { x: 0, y: -1, angle: -90 },
  { x: 0.866, y: 0.5, angle: 30 },
  { x: -0.866, y: 0.5, angle: 150 },
]);

const ICONS = Object.freeze({
  crest: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c6 0 10 5 10 11 0 7-4 11-10 15C10 25 6 21 6 14 6 8 10 3 16 3Z"/><path d="M10 15h12M16 9v13"/></svg>`,
  orbital: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2v8M11 6l5 5 5-5M16 12v17"/><path d="M7 25h18M10 29h12"/></svg>`,
  cluster: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3v9M12 8l4 4 4-4"/><circle cx="8" cy="23" r="3"/><circle cx="16" cy="26" r="3"/><circle cx="24" cy="23" r="3"/></svg>`,
  resupply: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2v8M12 6l4 4 4-4"/><path d="M7 13h18v15H7zM16 16v9M11.5 20.5h9"/></svg>`,
  /* The Kenosis commands. `commandMarkup` resolves a wheel sigil as
     `ICONS[key] || ICONS.crest`, so a command without one is not an
     error - it is three identical crests on a three-sector wheel. */
  mirrorchoir: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4v10M11 9l5-5 5 5"/><path d="M6 18v10M16 20v9M26 18v10"/><path d="M3 16h26"/></svg>`,
  crescentrain: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 5c5 2 8 6 8 11M16 3c5 2 8 6 8 11M26 6c3 2 4 5 4 9"/><path d="M8 22l-2 6M17 23l-2 6M26 22l-2 6"/></svg>`,
  standinggate: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 26V11h22v15"/><path d="M2 26h28M9 26V15M23 26V15M16 11v15"/></svg>`,
  fallinganvil: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2v7M12 6l4 4 4-4"/><path d="M6 14h20l-3 6H9Z"/><path d="M13 20v4h6v-4M9 28h14"/></svg>`,
  operation: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m12 7 3 5-3 5-3-5Z"/></svg>`,
  map: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 5 5-2 6 2 5-2v16l-5 2-6-2-5 2Z"/><path d="M9 3v16M15 5v16"/><circle cx="15" cy="11" r="2"/></svg>`,
  doctrine: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.4"/><path d="M12 3v6M20.6 9.2l-5.7 1.9M17.3 19l-3.5-4.9M6.7 19l3.5-4.9M3.4 9.2l5.7 1.9"/><path d="m12 3 8.6 6.2-3.3 9.8H6.7L3.4 9.2Z"/></svg>`,
  saves: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>`,
  controls: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a5 5 0 0 1 4 7l-1 3a2 2 0 0 1-3 1l-3-2h-4l-3 2a2 2 0 0 1-3-1l-1-3a5 5 0 0 1 4-7Z"/><path d="M7 12h4M9 10v4M16 12h.1M18 14h.1"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>`,
  maximize: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>`,
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

const DOCTRINE_GLOSSARY = Object.freeze({
  "white-vigil": {
    saint: "Saint Veyra · Scout",
    abilities: [
      {
        id: "crescent_volley",
        name: "Crescent Volley",
        keybind: "LMB",
        summary: "Main ranged dual pistol attack (LMB). Rapidly fires alternating crescent energy pulses from twin wrist emitters.",
        patterns: ["paired crescent volley", "crescent volley", "crescents", "crescent"],
      },
      {
        id: "vigil_step",
        name: "Vigil Step",
        keybind: "E",
        summary: "Tactical combat blink (E). Instantly translates 12 metres through combat to reposition or evade. Holds 2 recharging charges.",
        patterns: ["Vigil Steps", "Vigil Step", "the Step"],
      },
      {
        id: "quick_blades",
        name: "Quick Blades",
        keybind: "F / RMB",
        summary: "Rapid melee strikes (F or RMB). Swings dual wrist blades in alternating hands at 1.30x tempo for swift close-quarters cuts.",
        patterns: ["quick blade strikes", "blade strikes", "blade strike", "quick blades"],
      },
      {
        id: "aerial_stoop",
        name: "Aerial Stoop",
        keybind: "Airborne F",
        summary: "Aimed aerial melee thrust and dive (Airborne F). Pierces along the reticle line up to 21 metres, either flying level as a lance or diving to earth.",
        patterns: ["Aerial Stoop", "the Stoop", "Stoop"],
      },
      {
        id: "white_vigil_veil",
        name: "Veil of the Vigil",
        keybind: "Stand Still (1.6s)",
        summary: "Camouflage concealment (Stand still 1.6s). Enemies lose track of Saint Veyra, and the next crescent volley fired from the veil deals +160% bonus damage.",
        patterns: ["veils Saint Veyra", "the veil"],
      },
      {
        id: "verdict",
        name: "Paired Verdict",
        keybind: "Alternating LMB",
        summary: "Combative cadence. Landing alternating left and right pistol pulses builds Verdict stacks; at 6 stacks, triggers an empowered damage pulse.",
        patterns: ["Paired Verdict", "a Verdict", "Verdict"],
      },
      {
        id: "field_command",
        name: "Field Command",
        keybind: "Q",
        summary: "Tactical support strike (Q). Calls precision aerial ordnance and orbital fire missions to suppress and break enemy swarms.",
        patterns: ["field commands", "field command", "command cooldown", "command"],
      },
      {
        id: "augur_flight",
        name: "Augur Flight",
        keybind: "Shift + Space",
        summary: "High-capacity scout jetpack (Shift + Space). Provides sustained vertical lift and rapid aerial mobility with an expanded fuel tank.",
        patterns: ["Augur pack", "jetpack", "flight", "glide"],
      },
    ],
  },
  "bastion-penitent": {
    saint: "Saint Torren · Bulwark",
    abilities: [
      {
        id: "reliquary_hammer",
        name: "Reliquary Hammer",
        keybind: "LMB / F",
        summary: "Main heavy melee attack (LMB or F). Delivers crushing two-handed hammer blows that stagger ordinary foes and break armor.",
        patterns: ["reliquary hammer", "hammer blows", "hammer blow", "hammer chain", "hammer kill", "hammer"],
      },
      {
        id: "hammer_cast",
        name: "Hammer Cast",
        keybind: "RMB",
        summary: "Thrown hammer ability (RMB). Hurls the reliquary hammer forward to pierce enemies, knock flyers out of the sky, and return to hand.",
        patterns: ["Hammer Cast", "returning hammer", "the Cast", "the cast", "Cast"],
      },
      {
        id: "tower_shield",
        name: "Tower Shield",
        keybind: "Hold E",
        summary: "Impassable frontal shield wall (Hold E). Unlimited physical block with zero charge drain. Timed perfect guards stagger nearby foes.",
        patterns: ["tower shield", "raised shield", "perfect guard", "the shield", "shield", "guarding", "guard"],
      },
      {
        id: "powered_leap",
        name: "Powered Leap",
        keybind: "Shift + Space",
        summary: "Rocket-assisted ballistic leap (Shift + Space). Launches Saint Torren up to 58 metres across the field, venting boiler heat on launch and landing.",
        patterns: ["landing a leap", "Landing from a leap", "Leaping vents", "leap's cooldown", "leaping", "leap"],
      },
      {
        id: "penitents_fall",
        name: "Penitent's Fall",
        keybind: "Airborne F",
        summary: "Heavy aerial ground slam (Airborne F). Plummets down to crack the earth with an explosive radial shockwave.",
        patterns: ["Penitent's Fall"],
      },
      {
        id: "censer_boiler",
        name: "Censer Boiler",
        keybind: "R (Vent)",
        summary: "Internal steam boiler (R). Powers leaps and thermal shocks; venting relieves heat pressure and generates thermal bursts.",
        patterns: ["vents the boiler", "boiler", "firebox"],
      },
      {
        id: "field_command",
        name: "Field Command",
        keybind: "Q",
        summary: "Heavy siege ordnance (Q). Calls delayed artillery and aerial strikes; calling from behind a raised shield skips the fuse entirely.",
        patterns: ["field commands land", "field commands hit", "field commands", "field command", "command called", "Calling a command", "command"],
      },
    ],
  },
  "vesper-reliquary": {
    saint: "Saint Aurel · Vanguard",
    abilities: [
      {
        id: "censer_lance",
        name: "Censer-Lance",
        keybind: "LMB",
        summary: "Primary ranged rifle fire (LMB). Fires focused thermal rounds; builds weapon heat that requires venting.",
        patterns: ["censer-lance", "rifle shots", "rifle shot", "rifle kill", "rifle"],
      },
      {
        id: "focused_aim",
        name: "Focused Aim",
        keybind: "RMB",
        summary: "Shoulder aim (RMB). Focuses lance trajectory for precision headshots and enemy weak-point hits.",
        patterns: ["aimed headshot", "aimed"],
      },
      {
        id: "melee_procession",
        name: "Melee Procession",
        keybind: "F",
        summary: "Three-strike polearm combo (F). Sweeps light enemies, staggers on the second blow, and cleaves on the finisher.",
        patterns: ["melee-combo strikes", "melee-combo strike", "melee-combo", "combo strikes", "combo strike", "third strike", "second strike", "first strike", "melee key", "melee hit", "melee"],
      },
      {
        id: "furnace_lance",
        name: "Furnace Lance",
        keybind: "Hold Alt-Fire",
        summary: "Charged thermal beam (Hold Alt-Fire / Middle Click). Consumes Reliquary charge to unleash a high-damage piercing beam.",
        patterns: ["Furnace Lance input", "Furnace Lance"],
      },
      {
        id: "executioners_thrust",
        name: "Executioner's Thrust",
        keybind: "Hold F",
        summary: "Charged jet spear thrust (Hold F). Consumes charge for a high-speed piercing dash that staggers and exposes heavy foes.",
        patterns: ["Executioner's Thrust", "hold melee", "Hold melee", "hold the melee key", "Hold the melee key"],
      },
      {
        id: "aegis_guard",
        name: "Aegis Guard",
        keybind: "Hold E",
        summary: "Frontal energy shield (Hold E). Absorbs incoming fire using Reliquary charge; timed blocks emit a stagger pulse.",
        patterns: ["raising Aegis", "Aegis block", "Aegis guard", "perfect guard", "Aegis", "guard"],
      },
      {
        id: "thruster_boost",
        name: "Thruster Boost",
        keybind: "Shift (Tap)",
        summary: "Directional thruster burst (Tap Shift). Rapid ground dash in your movement direction to evade attacks or close distance.",
        patterns: ["backward boost", "forward boost", "ground boost", "boost"],
      },
      {
        id: "sustained_flight",
        name: "Sustained Flight",
        keybind: "Shift + Space",
        summary: "Jet thruster propulsion (Hold Shift + Space). Sustains vertical climbing and aerial hovering at the cost of charge.",
        patterns: ["jet ignition", "activating the jet", "jet"],
      },
      {
        id: "penitents_fall",
        name: "Penitent's Fall",
        keybind: "Airborne F",
        summary: "Aerial kinetic ground slam (Airborne F). Plummets from the air to strike the earth with a wide staggering shockwave.",
        patterns: ["Penitent's Fall"],
      },
      {
        id: "manual_vent",
        name: "Manual Vent",
        keybind: "R",
        summary: "Heat purge (R). Vents accumulated weapon heat from the censer-lance to avoid overheat lockout and trigger heat rites.",
        patterns: ["manual vent", "venting", "vent"],
      },
      {
        id: "field_command",
        name: "Field Command",
        keybind: "Hold Q + LMB",
        summary: "Orbital tactical command (Hold Q + LMB). Deploys beacons to call Orbital Lances, Cluster Salvos, or Gilding chapels.",
        patterns: ["Orbital Lance", "Cluster Salvo", "Gilding Rite", "field command", "offensive-command", "commands", "command"],
      },
    ],
  },
});

function escapeRegex(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DOCTRINE_COMPILERS = {};
for (const [characterId, data] of Object.entries(DOCTRINE_GLOSSARY)) {
  const patternMap = new Map();
  const allPatterns = [];
  for (const ability of data.abilities) {
    for (const pattern of ability.patterns) {
      patternMap.set(pattern.toLowerCase(), ability);
      allPatterns.push(pattern);
    }
  }
  allPatterns.sort((a, b) => b.length - a.length);
  const regex = new RegExp("\\b(" + allPatterns.map(escapeRegex).join("|") + ")\\b", "gi");
  DOCTRINE_COMPILERS[characterId] = { patternMap, regex, saint: data.saint };
}

function formatDoctrineText(text, characterId = "vesper-reliquary") {
  if (!text) return "";
  const key = String(characterId || "").toLowerCase();
  const compiler = DOCTRINE_COMPILERS[key] || DOCTRINE_COMPILERS["vesper-reliquary"];
  const parts = String(text).split(compiler.regex);
  let html = "";
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i % 2 === 1) {
      const ability = compiler.patternMap.get(part.toLowerCase());
      if (ability) {
        html += `<span class="sf-ability-link" role="button" tabindex="0" data-sf-ability="${escapeHtml(ability.id)}" data-saint="${escapeHtml(key)}" title="${escapeHtml(ability.name)} (${escapeHtml(ability.keybind)}): ${escapeHtml(ability.summary)}" aria-label="${escapeHtml(ability.name)}: ${escapeHtml(ability.keybind)}">${escapeHtml(part)}</span>`;
        continue;
      }
    }
    html += escapeHtml(part);
  }
  return html;
}


function doctrineSigilMarkup(orderId, role, modifier = "") {
  const id = String(orderId || "");
  const source = DOCTRINE_SIGILS[id];
  if (!source) return "";
  const classes = `sf-doctrine__sigil ${modifier}`.trim();
  return `<img class="${classes}" data-doctrine-sigil data-sigil-role="${escapeHtml(role)}" data-order-id="${escapeHtml(id)}" src="${escapeHtml(source)}" width="512" height="512" alt="" aria-hidden="true" draggable="false" decoding="async">`;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatSavedAt(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "No field record";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(Number(timestamp)));
  } catch (_) { return "Recorded"; }
}

function prefersReducedMotion() {
  try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
  catch (_) { return false; }
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const masterVol = Number.isFinite(Number(saved.masterVolume)) ? clamp(Number(saved.masterVolume), 0, 1) : 1.0;
    const musicVol = Number.isFinite(Number(saved.musicVolume)) ? clamp(Number(saved.musicVolume), 0, 1) : 0.8;
    const sfxVol = Number.isFinite(Number(saved.sfxVolume)) ? clamp(Number(saved.sfxVolume), 0, 1) : 1.0;
    return {
      hudScale: saved.hudScale === "large" ? "large" : "standard",
      reducedMotion: Object.prototype.hasOwnProperty.call(saved, "reducedMotion")
        ? !!saved.reducedMotion
        : prefersReducedMotion(),
      highContrast: !!saved.highContrast,
      /* New operations default to the guided field orientation. The entry
         screen owns the visible switch, but the preference lives beside the
         other field settings so changing Saint bodies cannot lose it. */
      tutorialEnabled: saved.tutorialEnabled !== false,
      // Default ON: it only ever acts when the frame is over budget.
      dynamicRes: saved.dynamicRes !== false,
      /* The renderer's tier (render.js QUALITY). Defaults to the tier
         the game shipped at; the switch is for the machine that cannot
         hold it, and it takes effect the moment it is pressed. */
      quality: normalizeQuality(saved.quality),
      /* The road's tier (difficulty.js). Read by main.js BEFORE the menu
         exists, because the garrison's health is scaled at spawn. */
      difficulty: normalizeDifficulty(saved.difficulty),
      masterVolume: masterVol,
      musicVolume: musicVol,
      sfxVolume: sfxVol,
    };
  } catch (_) {
    return {
      hudScale: "standard", reducedMotion: prefersReducedMotion(), highContrast: false,
      tutorialEnabled: true, dynamicRes: true,
      quality: DEFAULT_QUALITY, difficulty: DEFAULT_DIFFICULTY,
      masterVolume: 1.0, musicVolume: 0.8, sfxVolume: 1.0,
    };
  }
}

/** The stored preferences, for the one caller (main.js boot) that needs
 *  a value before buildGameUi has run: the difficulty tier. */
export function readStoredSettings() {
  return readSettings();
}

function difficultySegmentsMarkup(attr, labelledBy) {
  return `<div class="sf-setting__segments" role="group" aria-labelledby="${labelledBy}">${
    DIFFICULTY_TIERS.map((tier) => `<button type="button" ${attr}="${tier}" aria-label="${
      escapeHtml(difficultyLabel(tier).toLowerCase())} difficulty" title="${
      escapeHtml(difficultyBlurb(tier))}">${escapeHtml(difficultyLabel(tier))}</button>`).join("")
  }</div>`;
}

function qualitySegmentsMarkup(attr, labelledBy) {
  return `<div class="sf-setting__segments" role="group" aria-labelledby="${labelledBy}">${
    QUALITY_TIERS.map((tier) => `<button type="button" ${attr}="${tier}" aria-label="${
      escapeHtml(qualityLabel(tier).toLowerCase())} graphics quality">${escapeHtml(qualityLabel(tier))}</button>`).join("")
  }</div>`;
}

function writeSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* optional */ }
}

function commandMarkup(order, mission) {
  return order.map((key, index) => {
    const spec = mission.stratagems?.[key] || { name: key, role: "Field command" };
    const point = WHEEL_POINTS[index] || WHEEL_POINTS[0];
    return `<button class="sf-command-wheel__option" type="button"
      data-command="${escapeHtml(key)}" data-index="${index}" data-state="ready"
      style="--sf-command-angle:${point.angle}deg" aria-pressed="false">
      <span class="sf-command-wheel__sigil">${ICONS[key] || ICONS.crest}</span>
      <span class="sf-command-wheel__copy"><strong>${escapeHtml(spec.name)}</strong>
        <small>${escapeHtml(spec.role || "Field command")}</small></span>
      <b data-command-status>READY</b>
    </button>`;
  }).join("");
}

function slotMarkup(kind, index, title) {
  const manual = kind === "manual";
  return `<article class="sf-save-slot" data-save-kind="${kind}" data-save-index="${index}">
    <header><span>${escapeHtml(title)}</span><b data-slot-state>EMPTY</b></header>
    <div class="sf-save-slot__summary">
      <strong data-slot-district>No field record</strong>
      <span data-slot-progress>Awaiting deployment state</span>
      <small data-slot-time>—</small>
    </div>
    <div class="sf-save-slot__actions">
      ${manual ? `<button type="button" data-save-action="save">SAVE</button>` : ""}
      <button type="button" data-save-action="load" disabled>LOAD</button>
      ${manual ? `<button type="button" data-save-action="clear" disabled>CLEAR</button>` : ""}
    </div>
  </article>`;
}

function controlRow(key, action, detail = "") {
  return `<div class="sf-control-row"><kbd>${key}</kbd><span><strong>${action}</strong>${detail ? `<small>${detail}</small>` : ""}</span></div>`;
}

/** Is this code bound to any field action? Used to swallow gameplay
 *  keys behind an open panel without a frozen literal list. */
function isGameplayBind(code) {
  return !!actionForCode(code);
}

/* The wheel's sectors are ADDRESSED, not cycled: up is the top sigil
   however the player spells "up". Arrows stay wired regardless of the
   movement scheme so the wheel is always reachable one-handed. */
function wheelDirectionFor(code) {
  if (code === "ArrowUp" || keybindMatches("moveForward", code)) return 0;
  if (code === "ArrowRight" || code === "ArrowDown"
    || keybindMatches("moveRight", code) || keybindMatches("moveBack", code)) return 1;
  if (code === "ArrowLeft" || keybindMatches("moveLeft", code)) return 2;
  return undefined;
}

/* THE CONTROLS PAGE IS THE EDITOR.
   `capture` is the slot currently listening for a key, or null. Each
   row draws both slots: the primary, and an alternate that is a real,
   assignable hole when empty rather than a hidden one. */
function keybindSlotMarkup(action, slot, capture) {
  const listening = capture && capture.action === action.id && capture.slot === slot;
  const code = keybindSlots(action.id)[slot];
  /* An empty ALTERNATE is an invitation, not a warning - eight rows
     shouting UNBOUND at a perfectly default scheme reads as breakage.
     An empty PRIMARY is the real thing and keeps the word. */
  const empty = slot === 0 ? "UNBOUND" : "+";
  const face = listening ? "PRESS A KEY" : (code ? keyLabel(code) : empty);
  const name = `${action.label}, ${slot === 0 ? "primary" : "alternate"} binding`;
  const spoken = listening ? "press a key" : (code ? keyLabel(code) : "unbound");
  return `<button type="button" class="sf-bind-key" data-bind-action="${escapeHtml(action.id)}"`
    + ` data-bind-slot="${slot}" data-bind-listening="${listening ? "true" : "false"}"`
    + ` data-bind-empty="${code ? "false" : "true"}"`
    + ` aria-label="${escapeHtml(name)}: ${escapeHtml(spoken)}"`
    + `><kbd>${escapeHtml(face)}</kbd></button>`;
}

function keybindRowMarkup(action, capture) {
  return `<div class="sf-bind-row" data-bind-row="${escapeHtml(action.id)}">`
    + `<span><strong>${escapeHtml(action.label)}</strong>${
      action.detail ? `<small>${escapeHtml(action.detail)}</small>` : ""}</span>`
    + `<span class="sf-bind-keys">${keybindSlotMarkup(action, 0, capture)}${
      keybindSlotMarkup(action, 1, capture)}</span></div>`;
}

function keybindGridMarkup(capture) {
  const groups = KEYBIND_GROUPS.map((group) => {
    const rows = KEYBIND_ACTIONS.filter((action) => action.group === group)
      .map((action) => keybindRowMarkup(action, capture)).join("");
    return `<article><h4>${escapeHtml(group)}</h4>${rows}</article>`;
  }).join("");
  /* The pointer and the universal escape are not on the table - see
     keybinds.js RESERVED_CODES - but a controls page that omits them
     reads as a page that lost them. */
  const fixed = `<article class="sf-bind-fixed"><h4>FIXED</h4>${
    controlRow("MOUSE", "Look / aim")}${controlRow("LMB", "Fire")}${
    controlRow("RMB", "Aim down sights")}${
    controlRow("ESC", "Field menu", "Also resumes")}${
    controlRow("TOUCH", "Hold the command sigil", "Drag and release to confirm")}</article>`;
  return groups + fixed;
}

export function buildGameUi(ctx, { stage, canvas, save, touch, render, setQuality } = {}) {
  if (!stage || !canvas || !ctx?.mission) {
    const closed = () => ({ open: false });
    return {
      update() {}, toggleAudio: () => false, setSetting: () => false, openMenu: () => false,
      openMap: () => false, closeMenu: () => false, cancelWheel: () => false, refresh() {},
      wheelState: closed, menuState: closed,
      settingsState: () => ({ audioEnabled: false, hudScale: "standard", reducedMotion: false, highContrast: false, tutorialEnabled: true, dynamicRes: true, quality: DEFAULT_QUALITY, difficulty: DEFAULT_DIFFICULTY }),
    };
  }

  stage.__saintfallGameUi?.destroy?.();
  stage.querySelector("#sf-native-ui")?.remove();
  const order = Array.from(ctx.mission.wheelOrder || ["orbital", "cluster", "resupply"]);
  const root = document.createElement("div");
  root.id = "sf-native-ui";
  root.className = "sf-native-ui";
  root.innerHTML = `
    <button type="button" class="sf-menu-trigger sf-menu-trigger--mobile" data-menu-open
      aria-label="Open field menu" aria-haspopup="dialog">
      ${ICONS.menu}<span>MENU</span>
    </button>
    <div id="sf-command-wheel" class="sf-command-wheel" role="dialog"
      aria-label="Field command wheel" aria-modal="false" aria-hidden="true" hidden
      data-open="false" data-selection="">
      <div class="sf-command-wheel__veil"></div>
      <div class="sf-command-wheel__dial">
        <div class="sf-command-wheel__ring" aria-hidden="true"></div>
        ${commandMarkup(order, ctx.mission)}
        <button class="sf-command-wheel__core" type="button" data-wheel-cancel>
          ${ICONS.crest}<span data-wheel-status>HOVER TO SELECT</span><small>CLICK TO CONFIRM</small>
        </button>
        <i class="sf-command-wheel__cursor" aria-hidden="true"></i>
      </div>
      <p class="sf-command-wheel__instruction">COMMAND LITURGY · TIME HELD IN STASIS</p>
    </div>
    <div id="sf-menu" class="sf-menu" role="dialog" aria-modal="true" tabindex="-1"
      aria-labelledby="sf-menu-title" aria-describedby="sf-menu-subtitle"
      aria-hidden="true" data-panel="operation" data-phase="districtBosses" hidden>
      <div class="sf-menu__veil"></div>
      <section class="sf-mission-wrap" data-mission-wrap aria-labelledby="sf-mission-wrap-title" hidden>
        <div class="sf-mission-wrap__art" aria-hidden="true"></div>
        <div class="sf-mission-wrap__card">
          <span class="sf-mission-wrap__kicker">THE GILDED SILENCE · CLOSED</span>
          <h2 id="sf-mission-wrap-title">MISSION COMPLETE</h2>
          <p data-mission-wrap-saint>One Saint made saintfall from orbit. Vesper-IX rises from silence.</p>
          <div class="sf-mission-wrap__verdict">
            <strong>THE BLOOM IS BROKEN</strong>
            <span>The Apostate is gone. The ancient Saint remains in ruins, but its basin belongs to the Concord again. Vesper-IX is reclaimed.</span>
          </div>
          <footer>
            <small>FIELD RECORD SEALED · SCORE CALCULATION READY</small>
            <button type="button" data-menu-action="mission-record">VIEW MISSION RECORD</button>
          </footer>
        </div>
      </section>
      <div class="sf-menu__frame">
        <header class="sf-menu__masthead">
          <div class="sf-menu__crest">${ICONS.crest}</div>
          <div><span>SAINTFALL · FIELD COMMAND</span><h2 id="sf-menu-title">OPERATION SAINTFALL</h2>
            <p id="sf-menu-subtitle">THE GILDED SILENCE</p></div>
          <button type="button" class="sf-menu__close" data-menu-close aria-label="Resume operation">×</button>
        </header>
        <div class="sf-menu__body">
          <nav class="sf-menu__rail" aria-label="Field menu">
            <button type="button" class="sf-menu__resume" data-menu-close>${ICONS.operation}<span><strong>RESUME</strong><small>Return to the basin</small></span></button>
            <button type="button" data-menu-panel="operation" aria-label="Operation" aria-current="page">${ICONS.operation}<span data-mobile-label="OPS">OPERATION</span></button>
            <button type="button" data-menu-panel="map" aria-label="Tactical map">${ICONS.map}<span data-mobile-label="MAP">TACTICAL MAP</span></button>
            <button type="button" data-menu-panel="doctrine" aria-label="Field Doctrine">${ICONS.doctrine}<span data-mobile-label="RITES">DOCTRINE</span></button>
            <button type="button" data-menu-panel="saves" aria-label="Save and load">${ICONS.saves}<span data-mobile-label="SAVES">SAVE / LOAD</span><b data-career-recovery-nav hidden>REVIEW</b></button>
            <button type="button" data-menu-panel="controls" aria-label="Controls">${ICONS.controls}<span data-mobile-label="CTRL">CONTROLS</span></button>
            <button type="button" data-menu-panel="settings" aria-label="Settings">${ICONS.settings}<span data-mobile-label="SET">SETTINGS</span></button>
            <div class="sf-menu__rail-spacer"></div>
            <button type="button" class="fullscreen-btn" id="sf-fullscreen"
              data-menu-action="maximize" aria-pressed="false">${ICONS.maximize}<span data-maximize-label>MAXIMIZE GAME</span></button>
            <button type="button" data-menu-action="unstuck"><span>RECOVER POSITION</span></button>
            <button type="button" data-menu-action="restart"><span>RESTART OPERATION</span></button>
            <button type="button" data-menu-action="return"><span>RETURN TO ARCHIVE</span></button>
          </nav>
          <div class="sf-menu__content">
            <section class="sf-menu__page" data-menu-page="operation">
              <div class="sf-menu__pagehead"><span>ACTIVE DIRECTIVE</span><h3 data-operation-heading>THE SEVENFOLD HUNT</h3><p data-operation-copy>Break six district guardians, then face the Coulter beneath the Fallen Saint.</p></div>
              <div class="sf-operation-grid">
                <article class="sf-operation-card sf-operation-card--objective"><small>PRIORITY OBJECTIVE</small><strong data-operation-objective>Reading field order…</strong><span data-operation-distance>—</span></article>
                <article class="sf-operation-card"><small>APEX BOSSES</small><strong data-operation-relays>0 / 7</strong><span>Defeated</span></article>
                <article class="sf-operation-card"><small>DEATHS</small><strong data-operation-deaths>0</strong><span>Recorded</span></article>
                <article class="sf-operation-card"><small>MISSION CLOCK</small><strong data-operation-clock>00:00</strong><span>Elapsed</span></article>
                <article class="sf-operation-card sf-operation-card--breach"><small>BLOOM CONTAINMENT</small><strong data-operation-breach>Signal quiet</strong><span data-operation-breach-detail>No active rupture</span></article>
              </div>
              <section class="sf-campaign-debrief" data-campaign-debrief aria-labelledby="sf-debrief-title" hidden>
                <header class="sf-campaign-debrief__head">
                  <span><small>CAMPAIGN DEBRIEF</small><h4 id="sf-debrief-title" tabindex="-1">THE GILDED SILENCE · CLEARED</h4></span>
                  <b data-debrief-badge>SCORE RECORDED</b>
                </header>
                <div class="sf-campaign-debrief__score">
                  <span><small>FINAL SCORE</small><strong data-debrief-score>0</strong></span>
                  <span><small>HIGH SCORE</small><b data-debrief-best>0</b></span>
                </div>
                <div class="sf-campaign-debrief__factors" aria-label="Campaign score multipliers">
                  <article><small>SCORED DIFFICULTY</small><strong data-debrief-difficulty>PENITENT</strong><span data-debrief-difficulty-multiplier>×1.000</span></article>
                  <article><small>CLEAR TIME</small><strong data-debrief-time>00:00</strong><span data-debrief-time-multiplier>×1.000</span></article>
                  <article><small>FIELD RANK ATTAINED</small><strong data-debrief-rank>1</strong><span data-debrief-rank-multiplier>×1.000</span></article>
                </div>
                <footer><p>Harder roads, faster clears, and higher Field Rank produce a stronger campaign score. The lowest difficulty used during this operation is the scored difficulty.</p><button type="button" data-menu-action="leaderboard">VIEW HIGH SCORES</button></footer>
              </section>
              <div class="sf-menu__callout"><span>FIELD DOCTRINE</span><p>Hold <kbd>Q</kbd>, hover toward a command sigil, and left click to confirm. Releasing <kbd>Q</kbd> cancels.</p></div>
            </section>
            <section class="sf-menu__page sf-menu__page--map" data-menu-page="map" hidden>
              <div class="sf-menu__pagehead"><span>LIVE BASIN OVERVIEW</span><h3>TACTICAL MAP</h3><p>The whole two-kilometre basin, rendered from the authored terrain. North stays fixed.</p></div>
              <div class="sf-map-page">
                <figure class="sf-map-page__surface">
                  <header><span><small>SAINTFALL</small><strong>WHOLE-BASIN SURVEY</strong></span><b data-map-detail-range>—</b></header>
                  <canvas id="sf-map-canvas-large" width="720" height="720" role="img" aria-label="Large tactical map of the basin"></canvas>
                  <figcaption class="sf-map-page__legend"><span data-kind="player">RELIQUARY</span><span data-kind="objective">OBJECTIVE</span><span data-kind="relay">BOSS</span><span data-kind="breach">BLOOM</span></figcaption>
                </figure>
                <aside class="sf-map-page__orders" aria-label="Objective list">
                  <header><span>FIELD ORDERS</span><b data-map-order-count>0 / 3</b></header>
                  <div class="sf-map-page__list" data-map-objectives></div>
                  <p><kbd>M</kbd> CLOSE MAP · <kbd>ESC</kbd> RESUME</p>
                </aside>
              </div>
            </section>
            <section class="sf-menu__page sf-menu__page--doctrine" data-menu-page="doctrine" hidden>
              <div class="sf-menu__pagehead"><span>RELIQUARY FORMATION</span><h3 tabindex="-1" data-doctrine-title>FIELD DOCTRINE</h3><p data-doctrine-subtitle>One T1 path of six points binds the Vow. The other T1 is optional.</p></div>
              <div class="sf-doctrine__summary" aria-label="Field rank and doctrine summary">
                <div class="sf-doctrine__rank"><small>FIELD RANK</small><strong data-doctrine-rank>1</strong></div>
                <div class="sf-doctrine__xp">
                  <span><small>CAREER ASCENSION</small><b data-doctrine-xp-text>0 / 0 XP</b></span>
                  <i data-doctrine-xp role="progressbar" aria-label="Progress to next Field Rank" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><em data-doctrine-xp-fill></em></i>
                </div>
                <div class="sf-doctrine__points"><small>DOCTRINE POINTS</small><strong data-doctrine-points>0</strong><span>AVAILABLE</span></div>
                <div class="sf-doctrine__vow-slots" data-doctrine-vows aria-label="Active capstone Vows"></div>
                <footer class="sf-doctrine__footer">
                  <button type="button" data-doctrine-action="respec" data-talent-respec
                    aria-describedby="sf-doctrine-respec-warn">RESET DOCTRINE</button>
                  <p class="sf-doctrine__respec-warn" id="sf-doctrine-respec-warn"
                    data-doctrine-respec-warn role="alert" hidden></p>
                </footer>
              </div>
              <p class="sf-doctrine__lock" data-doctrine-lock role="status" hidden></p>
              <div class="sf-doctrine__body">
                <nav class="sf-doctrine__orders" data-doctrine-orders role="tablist" aria-label="Doctrine Orders" aria-orientation="horizontal"></nav>
                <section class="sf-doctrine__order" data-doctrine-order-panel role="tabpanel" tabindex="0">
                  <header class="sf-doctrine__order-head">
                    <img class="sf-doctrine__sigil sf-doctrine__sigil--hero" data-doctrine-sigil data-sigil-role="hero" width="512" height="512" alt="" aria-hidden="true" draggable="false" decoding="async" hidden>
                    <span><small data-doctrine-order-kicker>ORDER</small><h4 data-doctrine-order-name>Awaiting doctrine</h4><p data-doctrine-order-focus>Select an Order to inspect its rites.</p></span>
                    <b data-doctrine-invested>0 / 8</b>
                  </header>
                  <div class="sf-doctrine__workspace">
                    <div class="sf-doctrine__tree">
                      <div class="sf-doctrine__rites" data-doctrine-talents></div>
                      <div class="sf-doctrine__crown" data-doctrine-capstone></div>
                    </div>
                    <aside class="sf-doctrine__preview" id="sf-doctrine-preview" data-doctrine-preview
                      tabindex="-1" aria-label="Rite details">
                      <span class="sf-doctrine__preview-empty">SELECT A RITE TO INSPECT</span>
                    </aside>
                  </div>
                </section>
              </div>
            </section>
            <section class="sf-menu__page" data-menu-page="saves" hidden>
              <div class="sf-menu__pagehead"><span>FIELD RECORDS</span><h3>SAVE / LOAD</h3><p>Three manual reliquaries and one automatic field record.</p></div>
              <section class="sf-career-recovery" data-career-recovery aria-labelledby="sf-career-recovery-title" aria-describedby="sf-career-recovery-copy" aria-busy="false" tabindex="-1" hidden>
                <header class="sf-career-recovery__head">
                  <span><small>DOCTRINE CAREER SYNC</small><h4 id="sf-career-recovery-title">Choose the career to preserve</h4></span>
                  <b data-career-recovery-badge>REVIEW REQUIRED</b>
                </header>
                <p id="sf-career-recovery-copy">This device and the synced record changed separately. Both are safe until you review them and confirm one version.</p>
                <div class="sf-career-recovery__branches" data-career-recovery-branches>
                  <article class="sf-career-branch" data-career-branch-card="local">
                    <header><span><small>CURRENT SESSION</small><strong>THIS DEVICE</strong></span><b data-career-branch-revision="local">REV —</b></header>
                    <dl>
                      <div><dt>FIELD RANK</dt><dd data-career-branch-rank="local">—</dd></div>
                      <div><dt>CAREER XP</dt><dd data-career-branch-xp="local">—</dd></div>
                      <div><dt>RITES</dt><dd data-career-branch-points="local">—</dd></div>
                      <div><dt>VOWS</dt><dd data-career-branch-vows="local">—</dd></div>
                    </dl>
                    <p data-career-branch-build="local">No Doctrine inscriptions recorded.</p>
                    <small data-career-branch-time="local">Recovered on this device</small>
                    <button type="button" data-career-recovery-action="choose" data-career-choice="local" aria-describedby="sf-career-recovery-status">KEEP THIS DEVICE</button>
                  </article>
                  <article class="sf-career-branch" data-career-branch-card="synced">
                    <header><span><small>CLOUD RECORD</small><strong>SYNCED CAREER</strong></span><b data-career-branch-revision="synced">REV —</b></header>
                    <dl>
                      <div><dt>FIELD RANK</dt><dd data-career-branch-rank="synced">—</dd></div>
                      <div><dt>CAREER XP</dt><dd data-career-branch-xp="synced">—</dd></div>
                      <div><dt>RITES</dt><dd data-career-branch-points="synced">—</dd></div>
                      <div><dt>VOWS</dt><dd data-career-branch-vows="synced">—</dd></div>
                    </dl>
                    <p data-career-branch-build="synced">No Doctrine inscriptions recorded.</p>
                    <small data-career-branch-time="synced">Recovered from synced storage</small>
                    <button type="button" data-career-recovery-action="choose" data-career-choice="synced" aria-describedby="sf-career-recovery-status">USE SYNCED CAREER</button>
                  </article>
                </div>
                <p class="sf-career-recovery__status" id="sf-career-recovery-status" data-career-recovery-status role="status" aria-live="polite" aria-atomic="true">Compare both records. Your field saves are not affected.</p>
              </section>
              <div class="sf-save-grid">
                ${slotMarkup("autosave", -1, "AUTOSAVE")}
                ${slotMarkup("manual", 0, "FIELD SLOT I")}
                ${slotMarkup("manual", 1, "FIELD SLOT II")}
                ${slotMarkup("manual", 2, "FIELD SLOT III")}
              </div>
              <p class="sf-save-reason" data-save-reason></p>
            </section>
            <section class="sf-menu__page" data-menu-page="controls" hidden>
              <div class="sf-menu__pagehead"><span>TACTICAL CODEX</span><h3>CONTROLS</h3><p>Click a key to rebind it. Every field action takes a primary and an alternate; bindings are saved on this device.</p></div>
              <div class="sf-bind-bar"><p class="sf-bind-status" data-bind-status role="status" aria-live="polite">Click a key, then press the key you want. ESC cancels, BACKSPACE clears.</p><button type="button" data-bind-reset aria-label="Restore default controls">RESTORE DEFAULTS</button></div>
              <div class="sf-controls-grid" data-keybind-grid>${keybindGridMarkup(null)}</div>
            </section>
            <section class="sf-menu__page" data-menu-page="settings" hidden>
              <div class="sf-menu__pagehead"><span>FIELD CONFIGURATION</span><h3>SETTINGS</h3><p>Readability and presentation preferences are saved on this device.</p></div>
              <div class="sf-settings-list">
                <div class="sf-setting"><span><strong>FIELD AUDIO</strong><small>Master audio toggle</small></span><button type="button" role="switch" data-setting="sound" aria-label="Field audio" aria-checked="true">ON</button></div>
                <div class="sf-setting sf-setting--slider"><span><strong id="sf-master-vol-label">MASTER VOLUME</strong><small data-vol-display="masterVolume">100%</small></span><input type="range" min="0" max="100" step="5" value="100" data-setting-range="masterVolume" aria-labelledby="sf-master-vol-label" class="sf-slider" /></div>
                <div class="sf-setting sf-setting--slider"><span><strong id="sf-music-vol-label">MUSIC VOLUME</strong><small data-vol-display="musicVolume">80%</small></span><input type="range" min="0" max="100" step="5" value="80" data-setting-range="musicVolume" aria-labelledby="sf-music-vol-label" class="sf-slider" /></div>
                <div class="sf-setting sf-setting--slider"><span><strong id="sf-sfx-vol-label">SFX VOLUME</strong><small data-vol-display="sfxVolume">100%</small></span><input type="range" min="0" max="100" step="5" value="100" data-setting-range="sfxVolume" aria-labelledby="sf-sfx-vol-label" class="sf-slider" /></div>
                <div class="sf-setting"><span><strong id="sf-hud-scale-label">HUD SCALE</strong><small>Increase tactical instrument size</small></span><div class="sf-setting__segments" role="group" aria-labelledby="sf-hud-scale-label"><button type="button" data-hud-scale="standard" aria-label="Standard HUD scale">STANDARD</button><button type="button" data-hud-scale="large" aria-label="Large HUD scale">LARGE</button></div></div>
                <div class="sf-setting"><span><strong>REDUCED MOTION</strong><small>Calmer interface transitions and pulses</small></span><button type="button" role="switch" data-setting="reduced-motion" aria-label="Reduced motion" aria-checked="false">OFF</button></div>
                <div class="sf-setting"><span><strong>HIGH CONTRAST</strong><small>Stronger text, panel, and instrument separation</small></span><button type="button" role="switch" data-setting="high-contrast" aria-label="High contrast" aria-checked="false">OFF</button></div>
                <div class="sf-setting sf-setting--difficulty"><span><strong id="sf-difficulty-label">DIFFICULTY</strong><small data-difficulty-blurb>Pilgrim, Penitent or Martyr. Applies immediately and travels with the save; Martyr thickens the broods and heats the barrel rather than simply hitting harder.</small></span>${difficultySegmentsMarkup("data-difficulty", "sf-difficulty-label")}</div>
                <div class="sf-setting sf-setting--quality"><span><strong id="sf-quality-label">GRAPHICS QUALITY</strong><small>Lower tiers trade render resolution, anti-aliasing, shadow detail, and occlusion for frame rate on weaker hardware. Applies immediately.</small></span>${qualitySegmentsMarkup("data-quality", "sf-quality-label")}</div>
                <div class="sf-setting"><span><strong>DYNAMIC RESOLUTION</strong><small>Trims render resolution only while the frame rate is suffering, and restores it when it recovers</small></span><button type="button" role="switch" data-setting="dynamic-res" aria-label="Dynamic resolution" aria-checked="true">ON</button></div>
                <div class="sf-setting"><span><strong>RECOVER POSITION</strong><small>Auto-resets if caught in an object, or click to recover now</small></span><button type="button" data-setting-action="unstuck" aria-label="Recover position">UNSTUCK</button></div>
                <div class="sf-setting sf-setting--renderer"><span><strong>RENDERER</strong><small data-gpu-line>Reading the adapter…</small></span></div>
              </div>
            </section>
          </div>
        </div>
        <footer class="sf-menu__footer"><span data-menu-context>FIELD STATE PAUSED</span><span><kbd>ESC</kbd> RESUME · <kbd>TAB</kbd> NAVIGATE</span></footer>
      </div>
    </div>
    <div class="sf-death" data-death role="dialog" aria-modal="false" aria-hidden="true"
      aria-labelledby="sf-death-title" hidden>
      <div class="sf-death__veil"></div>
      <div class="sf-death__frame">
        <small>SAINTFALL · FIELD COMMAND</small>
        <h2 id="sf-death-title">THE RELIQUARY FALLS</h2>
        <p class="sf-death__copy" data-death-copy>Silence on the wire. Restore a field record to continue the operation.</p>
        <div class="sf-death__actions">
          <button type="button" data-death-action="load">
            <strong data-death-load-label>RESTORE LAST RECORD</strong>
            <span data-death-load-meta>No field record</span>
          </button>
          <button type="button" data-death-action="records"><strong>ALL FIELD RECORDS</strong><span>Autosave and manual reliquaries</span></button>
          <button type="button" data-death-action="restart"><strong data-death-restart-label>RESTART OPERATION</strong><span>Begin the drop again</span></button>
        </div>
      </div>
    </div>
    <div class="sf-autosave-toast" data-autosave-toast role="status" aria-live="polite"
      aria-atomic="true" hidden><i aria-hidden="true"></i><span>AUTOSAVED</span><small>FIELD RECORD SECURED</small></div>
    <div class="sf-native-ui__live" data-ui-live aria-live="polite" aria-atomic="true"></div>`;
  stage.append(root);

  /* The adapter line under the quality tiers. A strong machine whose
     browser is secretly on a CPU rasteriser (hardware acceleration
     off, GPU process crashed, driver denylisted) reports as "the game
     runs badly on low" - this is the one place a player can see WHICH
     renderer the game was actually given, and the warning names the
     fix when it is the software one. */
  {
    const gpuLine = root.querySelector("[data-gpu-line]");
    if (gpuLine) {
      const gpu = render?.gpu || "";
      if (render?.softwareRendered) {
        gpuLine.textContent = `${gpu || "Software rasteriser"} — the browser is NOT using `
          + "the graphics card. Enable hardware acceleration in the browser settings, then "
          + "restart the browser.";
        gpuLine.style.color = "#ffb347";
      } else {
        gpuLine.textContent = gpu || "Unknown adapter";
      }
    }
  }

  const wheelEl = root.querySelector("#sf-command-wheel");
  const dialEl = root.querySelector(".sf-command-wheel__dial");
  const cursorEl = root.querySelector(".sf-command-wheel__cursor");
  const wheelStatusEl = root.querySelector("[data-wheel-status]");
  const commandEls = Array.from(root.querySelectorAll(".sf-command-wheel__option"));
  const menuEl = root.querySelector("#sf-menu");
  const largeMapCanvas = root.querySelector("#sf-map-canvas-large");
  const largeMapRange = root.querySelector("[data-map-detail-range]");
  const maximizeButton = root.querySelector('[data-menu-action="maximize"]');
  const maximizeLabel = root.querySelector("[data-maximize-label]");
  const autosaveToast = root.querySelector("[data-autosave-toast]");
  const deathEl = root.querySelector("[data-death]");
  const death = { open: false, restartUntil: 0, latest: null };
  const liveEl = root.querySelector("[data-ui-live]");
  const progression = ctx.progression;
  const surface = stage.closest(".rb-standalone-surface") || stage;
  const settings = readSettings();
  const wheel = {
    open: false, selectedIndex: -1, source: null, x: 0, y: 0,
    deadZone: 42, maxRadius: 132, pointerId: null, touchOrigin: null,
    openedLocked: false, dispatchSeq: 0, lastDispatch: null, cancelReason: null,
  };
  const menu = {
    open: false, panel: "operation", lastFocus: null, restartUntil: 0,
    ariaRestore: null, returnToPointerLock: false, victoryWrapSeen: false,
  };
  const doctrine = {
    orderId: null,
    inspectedTalentId: null,
    previewTalentId: null,
    hoverTalentId: null,
    respecUntil: 0,
    respecWarnUntil: 0,
    latestState: null,
  };
  const careerRecovery = {
    armedChoice: null,
    armedUntil: 0,
    resolving: false,
    resolvedMessage: "",
    errorMessage: "",
  };
  const clearedUntil = new Map();
  const pendingTimers = new Set();
  const touchBindings = new Map();
  const DOUBLE_TAP_WINDOW_MS = 750;
  let lastEscapePressTime = 0;
  let ignoreEscapeMenuToggleUntil = 0;
  let intentionalPointerUnlockUntil = 0;
  let intentionalMaximizeExitUntil = 0;
  let keyboardEscapeLocked = false;
  let wasPointerLocked = false;
  let saveData = { autosave: null, manuals: [null, null, null] };
  let updateClock = 0;
  let announceRaf = 0;
  let focusRaf = 0;
  let autosaveToastTimer = 0;
  let destroyed = false;

  function scheduleUiTimeout(callback, delay) {
    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      if (!destroyed) callback();
    }, delay);
    pendingTimers.add(timer);
    return timer;
  }

  function menuSfx(name) {
    try { void window.RBSfx?.play?.(name, { volume: 0.34, throttleMs: 25 }); } catch (_) { /* optional */ }
  }

  function wheelSfx(kind, index = 0) {
    try {
      if (kind === "open") ctx.audio?.chord?.([196, 294, 392], 0.22, 0.08);
      else if (kind === "select") ctx.audio?.blip?.(520 + index * 170, 0.045, 0.09, "triangle");
      else if (kind === "confirm") ctx.audio?.chord?.([392, 587, 784], 0.24, 0.1);
      else ctx.audio?.chord?.([220, 165], 0.16, 0.07);
    } catch (_) { /* optional */ }
  }

  function announce(message) {
    if (destroyed) return;
    liveEl.textContent = "";
    if (announceRaf) cancelAnimationFrame(announceRaf);
    announceRaf = requestAnimationFrame(() => {
      announceRaf = 0;
      if (!destroyed && liveEl.isConnected) liveEl.textContent = message;
    });
  }

  function respecWarnNode() {
    return root.querySelector("[data-doctrine-respec-warn]");
  }

  function hideRespecWarn() {
    doctrine.respecWarnUntil = 0;
    const warn = respecWarnNode();
    if (!warn) return;
    warn.hidden = true;
    warn.textContent = "";
  }

  function showRespecWarn(reason) {
    const warn = respecWarnNode();
    const copy = String(reason || "Doctrine cannot be revised during this deployment.").trim();
    if (!warn || !copy) return;
    warn.hidden = false;
    warn.textContent = copy;
    doctrine.respecWarnUntil = performance.now() + 4800;
    menuSfx("error");
    announce(copy);
  }

  /* ---------------------- rebindable controls ---------------------- */

  /* The slot currently listening for a key, or null. Capture is a
     MODE, not a modal: the rest of the menu stays usable, so it must
     be cancelled by anything that takes the page away from this row -
     a panel switch, a menu close, a click elsewhere. */
  let capture = null;
  /* Codes whose pending keyup still belongs to the editor. */
  const bindKeyUpGuard = new Set();
  const bindStatusEl = () => root.querySelector("[data-bind-status]");
  const BIND_HINT = "Click a key, then press the key you want. ESC cancels, BACKSPACE clears.";

  function renderKeybinds(message = null) {
    const grid = root.querySelector("[data-keybind-grid]");
    if (!grid) return;
    grid.innerHTML = keybindGridMarkup(capture);
    const status = bindStatusEl();
    if (status) status.textContent = message || (capture
      ? `Press a key for ${keybindAction(capture.action)?.label || "this action"}.`
      : BIND_HINT);
    if (capture) {
      grid.querySelector(`[data-bind-action="${capture.action}"][data-bind-slot="${capture.slot}"]`)
        ?.focus?.({ preventScroll: true });
    }
  }

  function beginCapture(actionId, slot) {
    if (!keybindAction(actionId)) return;
    capture = { action: actionId, slot: slot === 1 ? 1 : 0 };
    menuSfx("switch");
    renderKeybinds();
    announce(`Press a key for ${keybindAction(actionId)?.label}.`);
  }

  function cancelCapture(message = null) {
    if (!capture) return false;
    capture = null;
    renderKeybinds(message);
    return true;
  }

  /** Take the pressed code for the listening slot. Returns true when
   *  the event belonged to the editor and must go no further. */
  function captureKey(event) {
    if (!capture) return false;
    const { action, slot } = capture;
    const definition = keybindAction(action);
    if (event.code === "Escape") {
      capture = null;
      renderKeybinds("Rebind cancelled.");
      menuSfx("close");
      return true;
    }
    if (event.code === "Backspace" || event.code === "Delete") {
      capture = null;
      setKeybind(action, slot, null);
      renderKeybinds(`${definition?.label} ${slot === 0 ? "primary" : "alternate"} cleared.`);
      menuSfx("toggle");
      announce(`${definition?.label} cleared.`);
      return true;
    }
    if (RESERVED_CODES.has(event.code)) {
      renderKeybinds(`${keyLabel(event.code)} is reserved.`);
      menuSfx("error");
      return true;
    }
    capture = null;
    bindKeyUpGuard.add(event.code);
    const result = setKeybind(action, slot, event.code);
    if (!result.ok) {
      renderKeybinds(`${keyLabel(event.code)} cannot be bound.`);
      menuSfx("error");
      return true;
    }
    /* A key drives exactly ONE action. Say out loud what was taken -
       silently unbinding the key a player still thinks is their block
       is how a control scheme becomes a bug report. */
    const displaced = result.displaced.filter((id) => id !== action);
    const note = displaced.length
      ? ` Taken from ${displaced.map((id) => keybindAction(id)?.label || id).join(", ")}.`
      : "";
    renderKeybinds(`${definition?.label} bound to ${keyLabel(event.code)}.${note}`);
    menuSfx(displaced.length ? "question" : "confirm");
    announce(`${definition?.label} bound to ${keyLabel(event.code)}.${note}`);
    return true;
  }

  function audioEnabled() {
    if (window.RBSfx?.isMuted) return !window.RBSfx.isMuted();
    return ctx.audio?.enabled !== false;
  }

  function applySettings() {
    stage.dataset.sfHudScale = settings.hudScale;
    document.body.dataset.sfHudScale = settings.hudScale;
    document.body.classList.toggle("sf-reduced-motion", settings.reducedMotion);
    document.body.classList.toggle("sf-high-contrast", settings.highContrast);
    const sound = root.querySelector('[data-setting="sound"]');
    const enabled = audioEnabled();
    ctx.audio?.setEnabled?.(enabled);
    sound.setAttribute("aria-checked", enabled ? "true" : "false");
    sound.textContent = enabled ? "ON" : "OFF";
    for (const [name, value] of [["reduced-motion", settings.reducedMotion],
      ["high-contrast", settings.highContrast], ["dynamic-res", settings.dynamicRes]]) {
      const button = root.querySelector(`[data-setting="${name}"]`);
      button.setAttribute("aria-checked", value ? "true" : "false");
      button.textContent = value ? "ON" : "OFF";
    }
    root.querySelectorAll("[data-hud-scale]").forEach((button) => {
      const active = button.dataset.hudScale === settings.hudScale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    root.querySelectorAll("[data-setting-range]").forEach((input) => {
      const name = input.dataset.settingRange;
      const vol = settings[name] ?? (name === "musicVolume" ? 0.8 : 1.0);
      input.value = String(Math.round(vol * 100));
      const display = root.querySelector(`[data-vol-display="${name}"]`);
      if (display) display.textContent = `${Math.round(vol * 100)}%`;
    });
    ctx.audio?.setVolumes?.({
      master: settings.masterVolume,
      music: settings.musicVolume,
      sfx: settings.sfxVolume,
    });
    /* Highlight the tier the renderer is ACTUALLY on, not the stored
       one: a `?quality=` URL override runs the session at its tier
       without touching the preference, and a menu that showed HIGH
       while the frame was drawn at LOW would be lying. */
    const liveQuality = activeQuality();
    root.querySelectorAll("[data-quality]").forEach((button) => {
      const active = button.dataset.quality === liveQuality;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    /* Same for the road: the tier in force, which a `?difficulty=`
       override or a loaded save may have set without touching the store. */
    const liveDifficulty = activeDifficulty();
    root.querySelectorAll("[data-difficulty]").forEach((button) => {
      const active = button.dataset.difficulty === liveDifficulty;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const blurb = root.querySelector("[data-difficulty-blurb]");
    if (blurb) blurb.textContent = difficultyBlurb(liveDifficulty);
  }

  function activeQuality() {
    return normalizeQuality(render?.quality || settings.quality);
  }

  function activeDifficulty() {
    return normalizeDifficulty(ctx.difficulty?.tier || settings.difficulty);
  }

  /* One call, three effects, like applyQuality: the live tier changes
     (which rescales live enemy pools and refreshes both menus through
     main.js's listener), the choice is stored, and this menu's controls
     follow. */
  function applyDifficulty(tier) {
    const next = normalizeDifficulty(tier);
    settings.difficulty = next;
    ctx.difficulty?.set?.(next, "menu");
    writeSettings(settings);
    applySettings();
    return next;
  }

  /* One call, three effects: the renderer switches tier, the choice
     is stored, and every quality control (this menu and the entry
     screen's options panel, which reads settingsState()) follows. The
     renderer is reached through the callback main.js hands in rather
     than render.setQuality directly, because the tier also moves the
     sun's shadow map and needs the sky in hand. */
  function applyQuality(tier) {
    const next = normalizeQuality(tier);
    settings.quality = next;
    if (typeof setQuality === "function") setQuality(next);
    else render?.setQuality?.(next, ctx.sky);
    writeSettings(settings);
    applySettings();
    return next;
  }

  function toggleAudio(forced) {
    if (destroyed) return audioEnabled();
    const enabled = typeof forced === "boolean" ? forced : !audioEnabled();
    if (!enabled) menuSfx("toggle");
    window.RBSfx?.setMuted?.(!enabled);
    ctx.audio?.setEnabled?.(enabled);
    applySettings();
    if (enabled) menuSfx("toggle");
    announce(enabled ? "Field audio enabled" : "Field audio muted");
    return enabled;
  }

  function setSetting(name, value) {
    if (destroyed) return false;
    if (name === "sound") return toggleAudio(!!value);
    if (name === "hudScale") settings.hudScale = value === "large" ? "large" : "standard";
    else if (name === "reducedMotion") settings.reducedMotion = !!value;
    else if (name === "highContrast") settings.highContrast = !!value;
    else if (name === "tutorialEnabled") settings.tutorialEnabled = value !== false;
    else if (name === "dynamicRes") {
      settings.dynamicRes = !!value;
      render?.setAutoScale?.(settings.dynamicRes);
    } else if (name === "quality") {
      applyQuality(value);
      menuSfx("toggle");
      return settingsState();
    } else if (name === "difficulty") {
      applyDifficulty(value);
      menuSfx("toggle");
      return settingsState();
    } else if (name === "masterVolume" || name === "musicVolume" || name === "sfxVolume") {
      const vol = clamp(Number(value), 0, 1);
      settings[name] = vol;
      if (name === "masterVolume") ctx.audio?.setMasterVolume?.(vol);
      else if (name === "musicVolume") ctx.audio?.setMusicVolume?.(vol);
      else if (name === "sfxVolume") ctx.audio?.setSfxVolume?.(vol);
    } else return false;
    writeSettings(settings);
    applySettings();
    menuSfx("toggle");
    return settingsState();
  }

  function showAutosaveToast(result) {
    if (!autosaveToast || destroyed) return;
    if (autosaveToastTimer) window.clearTimeout(autosaveToastTimer);
    const deferred = result?.type === "autosave-deferred";
    autosaveToast.dataset.state = deferred ? "deferred" : "saved";
    autosaveToast.querySelector("span").textContent = deferred ? "AUTOSAVE DELAYED" : "AUTOSAVED";
    autosaveToast.querySelector("small").textContent = deferred
      ? `RETRY IN ${Math.max(1, Math.ceil(Number(result?.retryIn) || 1))}S`
      : (result?.reason === "checkpoint" ? "MILESTONE SECURED" : "FIELD RECORD SECURED");
    autosaveToast.hidden = false;
    requestAnimationFrame(() => autosaveToast?.classList.add("is-visible"));
    autosaveToastTimer = window.setTimeout(() => {
      autosaveToastTimer = 0;
      autosaveToast?.classList.remove("is-visible");
      window.setTimeout(() => {
        if (autosaveToast && !autosaveToast.classList.contains("is-visible")) autosaveToast.hidden = true;
      }, 360);
    }, deferred ? 3800 : 2600);
  }

  function progressionDefinitions() {
    let raw = {};
    try {
      raw = typeof progression?.definitions === "function"
        ? progression.definitions() : progression?.definitions || {};
    } catch (_) { raw = {}; }
    const definitions = raw?.doctrine || raw?.progression?.doctrine || raw || {};
    const looseTalents = Array.isArray(definitions.talents) ? definitions.talents : [];
    const looseCapstones = Array.isArray(definitions.capstones) ? definitions.capstones : [];
    const orders = (Array.isArray(definitions.orders) ? definitions.orders : []).map((entry) => ({
      ...entry,
      talents: Array.isArray(entry.talents)
        ? entry.talents : looseTalents.filter((talent) => talent.orderId === entry.id),
      capstone: entry.capstone
        || looseCapstones.find((capstone) => capstone.orderId === entry.id) || null,
    }));
    return {
      ...definitions,
      maxPointsPerOrder: definitions.maxPointsPerOrder
        ?? raw?.maxPointsPerOrder ?? raw?.rules?.maxPointsPerOrder,
      capstoneEligibilityPoints: definitions.capstoneEligibilityPoints
        ?? raw?.capstoneEligibilityPoints ?? raw?.rules?.capstoneEligibilityPoints,
      vowSealRanks: definitions.vowSealRanks
        ?? raw?.vowSealRanks ?? raw?.rules?.vowSealRanks,
      orders,
    };
  }

  function progressionState() {
    try {
      const state = progression?.state?.() || {};
      doctrine.latestState = state;
      return state;
    } catch (_) {
      const state = { editLocked: true, lockReason: "Doctrine state is unavailable." };
      doctrine.latestState = state;
      return state;
    }
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function runtimeOrder(state, orderId) {
    if (Array.isArray(state?.orders)) return state.orders.find((entry) => entry?.id === orderId) || {};
    return state?.orders?.[orderId] || {};
  }

  function runtimeTalent(state, orderState, talentId) {
    const local = Array.isArray(orderState?.talents)
      ? orderState.talents.find((entry) => entry?.id === talentId)
      : orderState?.talents?.[talentId];
    if (local) return local;
    if (Array.isArray(state?.talents)) return state.talents.find((entry) => entry?.id === talentId) || {};
    return state?.talents?.[talentId] || {};
  }

  function editState(state) {
    let raw = null;
    try { raw = progression?.canEdit?.(); } catch (_) { raw = false; }
    const apiAllows = typeof raw === "boolean" ? raw
      : raw && typeof raw === "object" ? !!(raw.ok ?? raw.canEdit ?? raw.allowed) : !state?.editLocked;
    const locked = !!state?.editLocked || !apiAllows || !progression;
    const reason = state?.lockReason || raw?.message || raw?.reason
      || (locked ? "Doctrine cannot be revised during this deployment." : "");
    return { allowed: !locked, reason };
  }

  function orderPoints(orderState) {
    const explicit = Number(orderState?.points ?? orderState?.pointsSpent);
    if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
    return asArray(orderState?.talents).reduce((sum, talent) =>
      sum + Math.max(0, Math.floor(Number(talent?.rank) || 0)), 0);
  }

  function activeCapstones(state) {
    const active = Array.isArray(state?.activeCapstones)
      ? state.activeCapstones.slice(0, 2) : [];
    while (active.length < 2) active.push(null);
    return active;
  }

  function capstoneRecord(state, orderState, definition) {
    if (orderState?.capstone && typeof orderState.capstone === "object") return orderState.capstone;
    const direct = Array.isArray(state?.capstones)
      ? state.capstones.find((entry) => entry?.id === definition.id)
      : state?.capstones?.[definition.id];
    if (direct) return direct;
    return activeCapstones(state).includes(definition.id) ? { id: definition.id, equipped: true } : {};
  }

  function implementationState(definition, runtime = {}) {
    const implemented = definition?.implemented ?? runtime?.implemented;
    return {
      implemented: implemented === true,
      note: runtime?.implementationNote || definition?.implementationNote
        || (implemented === false
          ? "This doctrine mechanic is forthcoming."
          : "This doctrine has not yet been confirmed field-ready."),
    };
  }

  function sealRanks(definitions) {
    const ranks = definitions?.vowSealRanks || definitions?.vowSeals?.ranks;
    return Array.isArray(ranks) && ranks.length ? ranks.slice(0, 2) : [12, 22];
  }

  function earnedSeals(state, definitions) {
    const explicit = Number(state?.vowSealsEarned ?? state?.sealsEarned);
    if (Number.isFinite(explicit)) return clamp(Math.floor(explicit), 0, 2);
    const rank = Math.max(1, Math.floor(Number(state?.rank) || 1));
    return sealRanks(definitions).filter((threshold) => rank >= Number(threshold)).length;
  }

  function safeDomId(value) {
    return String(value || "order").replace(/[^a-z0-9_-]+/gi, "-");
  }

  function rankNumeral(rank) {
    return ["0", "I", "II", "III", "IV"][rank] || String(rank);
  }

  function tierNumeral(tier) {
    return ["0", "I", "II", "III", "IV", "V"][tier] || String(tier);
  }

  function disabledAttributes(disabled, reason) {
    if (!disabled) return "";
    const copy = escapeHtml(reason || "This rite is unavailable.");
    return ` disabled aria-disabled="true" data-disabled-reason="${copy}" title="${copy}"`;
  }

  function talentEligibility(definition, current, state, orderState, edit, definitions) {
    const rank = Math.max(0, Math.floor(Number(current?.rank) || 0));
    const maxRank = Math.max(1, Math.floor(Number(definition?.maxRank) || 1));
    const points = Math.max(0, Math.floor(Number(state?.pointsAvailable) || 0));
    const invested = orderPoints(orderState);
    const required = Math.max(0, Math.floor(Number(definition?.requires?.orderPoints) || 0));
    const orderLimit = Math.max(1, Math.floor(Number(definitions?.maxPointsPerOrder) || 8));
    const runtimeEligible = typeof current?.eligible === "boolean" ? current.eligible : null;
    const implementation = implementationState(definition, current);
    const implemented = implementation.implemented;
    let reason = "";
    if (!implemented) reason = implementation.note;
    else if (!edit.allowed) reason = edit.reason;
    else if (rank >= maxRank) reason = "Maximum rank reached.";
    else if (invested < required) reason = `Requires ${required} points in this Order.`;
    else if (invested >= orderLimit) reason = `This Order is limited to ${orderLimit} Doctrine Points.`;
    else if (points < 1) {
      const fieldRank = Math.max(1, Math.floor(Number(state?.rank) || 1));
      const rankCap = Math.max(fieldRank, Math.floor(Number(definitions?.rankCap) || 25));
      reason = fieldRank < rankCap
        ? "Earn 1 Doctrine Point at the next Field Rank."
        : "No Doctrine Points remain. Refund another rite to revise this Order.";
    }
    else if (runtimeEligible === false) reason = current?.lockReason || current?.reason
      || current?.eligibilityReason || "This rite is not currently available.";
    const canSpend = !reason;

    let refundReason = "";
    const runtimeRefundable = typeof current?.refundable === "boolean" ? current.refundable : null;
    if (!edit.allowed) refundReason = edit.reason;
    else if (rank <= 0) refundReason = "No rank has been inscribed.";
    else if (runtimeRefundable === false) refundReason = current?.refundReason
      || "Refund the dependent rites first.";
    return { rank, maxRank, implemented, canSpend, reason,
      canRefund: !refundReason, refundReason };
  }

  /* A tree may carry its own art. Vesper's 25 rites resolve straight
     from the id to a plate in `img/saintfall/talents/`; a world that
     ships no plates gives each node an `icon` instead (the Kenosis
     trees generate themed SVG sigils). Without this a node with no
     plate renders as an empty black square with the tier chip still
     on it - there is no `onerror` anywhere in this file. */
  function talentIconUrl(talentId, definition = null) {
    const own = definition && definition.icon;
    if (typeof own === "string" && own) return own;
    return `../assets/img/saintfall/talents/${encodeURIComponent(talentId)}.jpg?v=20260829-doctrine-v2`;
  }

  /* One capstone verdict feeds both the crown card and the inspector, so the
     strip and the action panel can never disagree about why a Vow is barred. */
  function capstoneStatus(definition, orderDefinition, orderState, state, edit, definitions) {
    const active = activeCapstones(state);
    const slot = active.indexOf(definition.id);
    const invested = orderPoints(orderState);
    const required = Math.max(1, Math.floor(Number(definition?.requires?.orderPoints
      ?? definitions?.capstoneEligibilityPoints) || 6));
    const seals = earnedSeals(state, definitions);
    const emptySlot = active.findIndex((entry, index) => !entry && index < seals);
    const runtime = capstoneRecord(state, orderState, definition);
    const runtimeEligible = typeof runtime?.eligible === "boolean" ? runtime.eligible : null;
    const implementation = implementationState(definition, runtime);
    const implemented = implementation.implemented;
    const orderName = orderDefinition.shortName || orderDefinition.name;
    let reason = "";
    if (!implemented) reason = implementation.note;
    else if (!edit.allowed) reason = edit.reason;
    else if (slot < 0 && runtimeEligible === false) reason = runtime?.reason
      || runtime?.lockReason || `Invest ${required} points in ${orderName}.`;
    else if (slot < 0 && invested < required) reason = `Invest ${required} points in ${orderName}.`;
    else if (slot < 0 && seals < 1) reason = `The first Vow Seal unlocks at Field Rank ${sealRanks(definitions)[0]}.`;
    else if (slot < 0 && emptySlot < 0) reason = "Both earned Vow Seals are already bound. Unbind one first.";
    const stateName = !implemented ? "forthcoming"
      : slot >= 0 ? "equipped" : reason ? "locked" : "eligible";
    return {
      slot, invested, required, seals, emptySlot, implemented, reason, stateName,
      stateLabel: !implemented ? "FORTHCOMING" : slot >= 0 ? `BOUND · SEAL ${rankNumeral(slot + 1)}`
        : invested >= required ? "ELIGIBLE" : `${invested} / ${required} PTS`,
      action: slot >= 0 ? "unequip" : "equip",
      actionSlot: slot >= 0 ? slot : emptySlot,
      label: slot >= 0 ? `UNBIND VOW ${rankNumeral(slot + 1)}`
        : emptySlot >= 0 ? `BIND VOW ${rankNumeral(emptySlot + 1)}` : "BIND VOW",
      barred: !edit.allowed || (slot < 0 && !!reason),
    };
  }

  function activeOperativeId(definitions = null) {
    if (ctx.playerCharacter?.id && DOCTRINE_GLOSSARY[ctx.playerCharacter.id]) return ctx.playerCharacter.id;
    if (definitions?.id && DOCTRINE_GLOSSARY[definitions.id]) return definitions.id;
    if (doctrine.treeId && DOCTRINE_GLOSSARY[doctrine.treeId]) return doctrine.treeId;
    const orders = definitions?.orders || definitions?.doctrine?.orders || [];
    if (orders.some((o) => o.id === "quicksilver" || o.id === "crescent" || o.id === "stoop")) return "white-vigil";
    if (orders.some((o) => o.id === "bulwark" || o.id === "cast" || o.id === "forge")) return "bastion-penitent";
    return "vesper-reliquary";
  }

  let pinnedAbilityLink = null;

  function ensureAbilityPopover() {
    let popover = root.querySelector("#sf-ability-popover");
    if (!popover) {
      popover = document.createElement("div");
      popover.id = "sf-ability-popover";
      popover.className = "sf-ability-popover";
      popover.setAttribute("role", "tooltip");
      popover.setAttribute("aria-hidden", "true");
      popover.hidden = true;
      const doctrinePage = root.querySelector('[data-menu-page="doctrine"]') || root;
      doctrinePage.appendChild(popover);
    }
    return popover;
  }

  function showAbilityPopover(link, pinned = false) {
    if (!link || !root) return;
    const abilityId = link.dataset.sfAbility;
    const saintId = link.dataset.saint || activeOperativeId();
    const operativeData = DOCTRINE_GLOSSARY[saintId] || DOCTRINE_GLOSSARY["vesper-reliquary"];
    const ability = operativeData?.abilities?.find((entry) => entry.id === abilityId);
    if (!ability) return;

    const popover = ensureAbilityPopover();
    popover.innerHTML = `
      <div class="sf-ability-popover__meta">
        <span class="sf-ability-popover__saint">${escapeHtml(operativeData.saint)}</span>
        <kbd class="sf-ability-popover__kbd">${escapeHtml(ability.keybind)}</kbd>
      </div>
      <h5 class="sf-ability-popover__title">${escapeHtml(ability.name)}</h5>
      <p class="sf-ability-popover__desc">${escapeHtml(ability.summary)}</p>
    `;

    popover.hidden = false;
    popover.classList.add("is-visible");
    popover.setAttribute("aria-hidden", "false");

    const rect = link.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const margin = 8;

    let top = rect.top - popRect.height - margin;
    if (top < margin) {
      top = rect.bottom + margin;
    }
    let left = rect.left + (rect.width - popRect.width) / 2;
    left = Math.max(margin, Math.min(window.innerWidth - popRect.width - margin, left));

    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;

    if (pinned) {
      if (pinnedAbilityLink && pinnedAbilityLink !== link) {
        pinnedAbilityLink.classList.remove("is-pinned");
      }
      pinnedAbilityLink = link;
      link.classList.add("is-pinned");
    }
  }

  function hideAbilityPopover({ force = false } = {}) {
    if (!force && pinnedAbilityLink) return;
    const popover = root?.querySelector("#sf-ability-popover");
    if (!popover) return;
    popover.classList.remove("is-visible");
    popover.setAttribute("aria-hidden", "true");
    popover.hidden = true;
    if (pinnedAbilityLink) {
      pinnedAbilityLink.classList.remove("is-pinned");
      pinnedAbilityLink = null;
    }
  }

  function renderTalent(definition, current, state, orderState, edit, definitions) {
    const eligibility = talentEligibility(definition, current, state, orderState, edit, definitions);
    const operativeId = activeOperativeId(definitions);
    const { rank, maxRank } = eligibility;
    const inspected = doctrine.inspectedTalentId === definition.id;
    const cardState = !eligibility.implemented ? "forthcoming"
      : rank >= maxRank ? "maxed" : rank > 0 ? "owned"
      : eligibility.canSpend ? "available" : "locked";
    const pips = Array.from({ length: maxRank }, (_, index) =>
      `<i data-state="${index < rank ? "owned" : "empty"}" aria-hidden="true"></i>`).join("");
    const ranks = Array.isArray(definition.ranks) ? definition.ranks : [];
    const detailId = `sf-talent-detail-${safeDomId(definition.id)}`;
    const rankDetails = ranks.length ? `<ol>${ranks.map((entry, index) =>
      `<li data-state="${index < rank ? "owned" : index === rank ? "next" : "locked"}"><b>RANK ${rankNumeral(index + 1)}</b><span>${formatDoctrineText(entry?.description || "Rite effect awaiting record.", operativeId)}</span></li>`).join("")}</ol>`
      : `<p>${formatDoctrineText(definition.description || definition.summary || "Rite effect awaiting record.", operativeId)}</p>`;
    const spendLabel = !eligibility.implemented ? "FORTHCOMING"
      : rank >= maxRank ? "MAX RANK" : `INSCRIBE ${rankNumeral(rank + 1)}`;
    const reason = eligibility.reason || (rank > 0 ? `Rank ${rank} of ${maxRank} inscribed.` : "Ready to inscribe.");
    const previewed = doctrine.previewTalentId === definition.id;
    const desktopCardInteraction = stage.classList.contains("sf-touch-enabled")
      ? "" : ' tabindex="0" aria-controls="sf-doctrine-preview"';
    const accessibleName = `${definition.name || "Unnamed Rite"}. Tier ${Math.max(1,
      Number(definition.tier) || 1)}. Rank ${rank} of ${maxRank}. ${definition.summary || ""} ${reason}`;
    const iconSrc = talentIconUrl(definition.id, definition);
    const tier = Math.max(1, Number(definition.tier) || 1);
    const gate = Math.max(0, Math.floor(Number(definition?.requires?.orderPoints) || 0));
    const invested = orderPoints(orderState);
    const gateOpen = invested >= gate;
    const available = Math.max(0, Math.floor(Number(state?.pointsAvailable) || 0));
    /* Name the actual blocker: an unreachable tier and an empty point pool
       are different problems, and "LOCKED" told the player neither. */
    const stateBadgeLabel = !eligibility.implemented ? "FORTHCOMING"
      : rank >= maxRank ? "MASTERED" : rank > 0 ? `RANK ${rank} / ${maxRank}`
      : eligibility.canSpend ? "READY" : !gateOpen ? `NEEDS ${gate} PTS`
      : available <= 0 ? "NO POINTS" : "LOCKED";

    return `<article class="sf-doctrine-talent" data-doctrine-talent data-talent-id="${escapeHtml(definition.id)}" data-state="${cardState}" data-tier="${tier}" data-gate="${gate}" data-gate-open="${gateOpen ? "true" : "false"}" data-inspected="${inspected ? "true" : "false"}" data-previewed="${previewed ? "true" : "false"}"${desktopCardInteraction} aria-label="${escapeHtml(accessibleName)}">
      <div class="sf-doctrine-talent__media">
        <img class="sf-doctrine-talent__thumb" src="${iconSrc}" alt="" decoding="async" />
        <span class="sf-doctrine-talent__tier">${tierNumeral(tier)}</span>
      </div>
      <header><span><small>TIER ${tierNumeral(tier)}${gate > 0 ? ` · ${gate} PTS` : ""}</small><strong>${escapeHtml(definition.name || "Unnamed Rite")}</strong></span><b data-talent-rank="${rank}" aria-label="Rank ${rank} of ${maxRank}">${pips}</b></header>
      <p>${formatDoctrineText(definition.summary || "A Reliquary rite awaiting inscription.", operativeId)}</p>
      <footer class="sf-doctrine-talent__meta-row">
        <span class="sf-doctrine-talent__badge" data-state="${cardState}">${stateBadgeLabel}</span>
      </footer>
      <div class="sf-doctrine-talent__actions">
        <button type="button" data-doctrine-action="inspect" data-talent-action="inspect" data-talent-id="${escapeHtml(definition.id)}" aria-label="${inspected ? "Back to rites" : `Details for ${escapeHtml(definition.name || "Unnamed Rite")}`}" aria-expanded="${inspected ? "true" : "false"}" aria-controls="${detailId}">${inspected ? "BACK TO RITES" : "DETAILS"}</button>
        <button type="button" data-doctrine-action="refund" data-talent-action="refund" data-talent-id="${escapeHtml(definition.id)}"${disabledAttributes(!eligibility.canRefund, eligibility.refundReason)}>REFUND</button>
        <button type="button" data-doctrine-action="spend" data-talent-action="spend" data-talent-id="${escapeHtml(definition.id)}"${disabledAttributes(!eligibility.canSpend, eligibility.reason)}>${spendLabel}</button>
      </div>
      <small class="sf-doctrine-talent__reason" data-talent-reason>${escapeHtml(reason)}</small>
      <div class="sf-doctrine-talent__detail" id="${detailId}" data-talent-detail${inspected ? "" : " hidden"}>${rankDetails}</div>
    </article>`;
  }

  function renderDoctrinePreview(orderDefinition, orderState, state, edit, definitions) {
    const host = root.querySelector("[data-doctrine-preview]");
    if (!host) return false;
    const talents = orderDefinition?.talents || [];
    const capstone = orderDefinition?.capstone || null;
    if (capstone && doctrine.previewTalentId === capstone.id) {
      return renderCapstonePreview(host, capstone, orderDefinition, orderState,
        state, edit, definitions);
    }
    const definition = talents.find((talent) => talent.id === doctrine.previewTalentId)
      || talents[0] || null;
    if (!definition) {
      doctrine.previewTalentId = null;
      host.dataset.state = "empty";
      host.innerHTML = '<span class="sf-doctrine__preview-empty">NO RITES RECOVERED</span>';
      return false;
    }

    doctrine.previewTalentId = definition.id;
    const operativeId = activeOperativeId(definitions);
    const current = runtimeTalent(state, orderState, definition.id);
    const eligibility = talentEligibility(definition, current, state, orderState, edit, definitions);
    const { rank, maxRank } = eligibility;
    const stateName = !eligibility.implemented ? "forthcoming"
      : rank >= maxRank ? "maxed" : rank > 0 ? "owned"
      : eligibility.canSpend ? "available" : "locked";
    const gate = Math.max(0, Math.floor(Number(definition?.requires?.orderPoints) || 0));
    const available = Math.max(0, Math.floor(Number(state?.pointsAvailable) || 0));
    /* Same vocabulary as the card badge, so selecting a rite never appears to
       change its verdict. */
    const stateLabel = !eligibility.implemented ? "FORTHCOMING"
      : rank >= maxRank ? "MASTERED" : rank > 0 ? `RANK ${rank} / ${maxRank}`
      : eligibility.canSpend ? "READY" : orderPoints(orderState) < gate ? `NEEDS ${gate} PTS`
      : available <= 0 ? "NO POINTS" : "LOCKED";
    const reason = eligibility.reason
      || (rank > 0 ? `Rank ${rank} of ${maxRank} inscribed.` : "Ready to inscribe.");
    const ranks = Array.isArray(definition.ranks) ? definition.ranks : [];
    const rankDetails = ranks.length ? ranks.map((entry, index) => {
      const rankState = index < rank ? "owned" : index === rank ? "next" : "locked";
      return `<li data-state="${rankState}"><b>${String(index + 1).padStart(2, "0")}</b><span><small>RANK ${rankNumeral(index + 1)}</small><strong>${formatDoctrineText(entry?.description || "Rite effect awaiting record.", operativeId)}</strong></span></li>`;
    }).join("") : `<li data-state="${rank > 0 ? "owned" : "next"}"><b>01</b><span><small>RITE EFFECT</small><strong>${formatDoctrineText(definition.description || definition.summary || "Rite effect awaiting record.", operativeId)}</strong></span></li>`;
    const spendLabel = !eligibility.implemented ? "FORTHCOMING"
      : rank >= maxRank ? "MAX RANK" : `INSCRIBE RANK ${rankNumeral(rank + 1)}`;
    const actionButtons = `<button type="button" data-doctrine-action="refund" data-talent-action="refund" data-talent-id="${escapeHtml(definition.id)}"${disabledAttributes(!eligibility.canRefund, eligibility.refundReason)}>REFUND RANK</button>
      <button type="button" data-doctrine-action="spend" data-talent-action="spend" data-talent-id="${escapeHtml(definition.id)}"${disabledAttributes(!eligibility.canSpend, eligibility.reason)}>${spendLabel}</button>`;
    const iconSrc = talentIconUrl(definition.id, definition);

    host.dataset.state = stateName;
    host.dataset.talentId = definition.id;
    host.innerHTML = `<header class="sf-doctrine__preview-head">
        <div class="sf-doctrine__preview-art-wrap">
          <img class="sf-doctrine__preview-art" src="${iconSrc}" alt="" decoding="async" />
        </div>
        <div class="sf-doctrine__preview-titles">
          <span><small>${escapeHtml(orderDefinition.shortName || orderDefinition.name || "ORDER")} · TIER ${Math.max(1, Number(definition.tier) || 1)}</small><h5>${escapeHtml(definition.name || "Unnamed Rite")}</h5></span>
          <b data-state="${stateName}">${stateLabel}</b>
        </div>
      </header>
      <p class="sf-doctrine__preview-summary">${formatDoctrineText(definition.summary || "A Reliquary rite awaiting inscription.", operativeId)}</p>
      <div class="sf-doctrine__preview-meta" aria-label="Rite requirements">
        <span><small>CURRENT RANK</small><strong>${rank} / ${maxRank}</strong></span>
        <span><small>ORDER GATE</small><strong>${gate ? `${gate} PTS` : "OPEN"}</strong></span>
      </div>
      <ol class="sf-doctrine__preview-ranks">${rankDetails}</ol>
      <footer class="sf-doctrine__preview-foot">
        <small>${escapeHtml(reason)}</small>
        <div>${actionButtons}</div>
      </footer>`;
    markDoctrinePreviewed(definition.id);
    return true;
  }

  function markDoctrinePreviewed(nodeId) {
    root.querySelectorAll("[data-doctrine-talent]").forEach((card) => {
      card.dataset.previewed = card.dataset.talentId === nodeId ? "true" : "false";
    });
    const vow = root.querySelector("[data-doctrine-vow]");
    if (vow) vow.dataset.previewed = vow.dataset.capstoneId === nodeId ? "true" : "false";
  }

  /* The Vow shares the rite inspector rather than owning a band of its own; a
     full-width capstone panel is exactly what used to paint over the grid. */
  function renderCapstonePreview(host, definition, orderDefinition, orderState,
    state, edit, definitions) {
    const status = capstoneStatus(definition, orderDefinition, orderState, state, edit, definitions);
    const operativeId = activeOperativeId(definitions);
    const iconSrc = talentIconUrl(definition.id, definition);
    const fusions = Array.isArray(definition.fusions) ? definition.fusions : [];
    const body = fusions.length
      ? fusions.map((fusion, index) => `<li data-state="${status.slot >= 0 ? "owned" : "locked"}"><b>${String(index + 1).padStart(2, "0")}</b><span><small>${escapeHtml(fusion.name || "FUSION")}</small><strong>${formatDoctrineText(fusion.description || "Fusion effect awaiting record.", operativeId)}</strong></span></li>`).join("")
      : "";
    const effect = `<li data-state="${status.slot >= 0 ? "owned" : "next"}"><b>00</b><span><small>VOW EFFECT</small><strong>${formatDoctrineText(definition.description || definition.summary || "Capstone effect awaiting record.", operativeId)}</strong></span></li>`;
    host.dataset.state = status.stateName;
    host.dataset.talentId = definition.id;
    host.innerHTML = `<header class="sf-doctrine__preview-head">
        <div class="sf-doctrine__preview-art-wrap">
          <img class="sf-doctrine__preview-art" src="${iconSrc}" alt="" decoding="async" />
        </div>
        <div class="sf-doctrine__preview-titles">
          <span><small>${escapeHtml(orderDefinition.shortName || orderDefinition.name || "ORDER")} · VOW</small><h5>${escapeHtml(definition.name || "Unnamed Vow")}</h5></span>
          <b data-state="${status.stateName}">${status.stateLabel}</b>
        </div>
      </header>
      <p class="sf-doctrine__preview-summary">${formatDoctrineText(definition.summary || "The final expression of this Order.", operativeId)}</p>
      <div class="sf-doctrine__preview-meta" aria-label="Vow requirements">
        <span><small>ORDER GATE</small><strong>${status.invested} / ${status.required} PTS</strong></span>
        <span><small>VOW SEALS</small><strong>${status.seals ? `${status.seals} EARNED` : "NONE YET"}</strong></span>
      </div>
      <ol class="sf-doctrine__preview-ranks">${effect}${body}</ol>
      <footer class="sf-doctrine__preview-foot">
        <small>${escapeHtml(status.reason || (status.slot >= 0
          ? "This Vow occupies one of two active seals." : "An earned Vow Seal is ready."))}</small>
        <div><button type="button" data-doctrine-action="vow" data-capstone-action="${status.action}" data-capstone-id="${escapeHtml(definition.id)}" data-order-id="${escapeHtml(orderDefinition.id)}" data-capstone-slot="${status.actionSlot}"${disabledAttributes(status.barred, status.reason)}>${status.label}</button></div>
      </footer>`;
    markDoctrinePreviewed(definition.id);
    return true;
  }

  /* Rites and the Vow are both inspector nodes; the crown only answers to the
     pointer on desktop, where the inspector is the surface that acts on it. */
  function doctrineNodeFrom(target) {
    if (!(target instanceof Element)) return null;
    const talentCard = target.closest("[data-doctrine-talent]");
    if (talentCard) return talentCard.dataset.talentId || null;
    if (stage.classList.contains("sf-touch-enabled")) return null;
    return target.closest("[data-doctrine-vow]")?.dataset.capstoneId || null;
  }

  function setDoctrinePreview(talentId) {
    const definitions = progressionDefinitions();
    const orderDefinition = definitions.orders.find((entry) => entry.id === doctrine.orderId);
    const known = orderDefinition?.talents?.some((talent) => talent.id === talentId)
      || orderDefinition?.capstone?.id === talentId;
    if (!known) return false;
    const state = doctrine.latestState || progressionState();
    const orderState = runtimeOrder(state, doctrine.orderId);
    doctrine.previewTalentId = talentId;
    return renderDoctrinePreview(orderDefinition, orderState, state, editState(state), definitions);
  }

  function renderCapstone(definition, orderDefinition, orderState, state, edit, definitions) {
    const host = root.querySelector("[data-doctrine-capstone]");
    if (!host) return;
    if (!definition) {
      host.innerHTML = `<article class="sf-doctrine__vow" data-state="locked"><small>CAPSTONE VOW</small><strong>SEALED RECORD</strong><p>This Order's final Vow has not been recovered.</p></article>`;
      return;
    }
    const status = capstoneStatus(definition, orderDefinition, orderState, state, edit, definitions);
    const operativeId = activeOperativeId(definitions);
    const { slot, invested, required, reason, stateName } = status;
    const inspected = doctrine.inspectedTalentId === definition.id;
    const previewed = doctrine.previewTalentId === definition.id;
    const fusions = Array.isArray(definition.fusions) && definition.fusions.length
      ? `<ul class="sf-doctrine__fusions">${definition.fusions.map((fusion) =>
        `<li><b>${escapeHtml(fusion.name)}</b><span>${formatDoctrineText(fusion.description, operativeId)}</span></li>`).join("")}</ul>` : "";
    const iconSrc = talentIconUrl(definition.id, definition);
    const gateFill = clamp(invested / Math.max(1, required), 0, 1);
    const cardInteraction = stage.classList.contains("sf-touch-enabled")
      ? "" : ' tabindex="0" aria-controls="sf-doctrine-preview"';
    const accessibleName = `${definition.name || "Unnamed Vow"}. Capstone Vow. `
      + `${status.stateLabel}. ${definition.summary || ""} ${reason}`;
    host.innerHTML = `<article class="sf-doctrine__vow" data-doctrine-vow data-capstone-id="${escapeHtml(definition.id)}" data-order-id="${escapeHtml(orderDefinition.id)}" data-state="${stateName}" data-equipped="${slot >= 0 ? "true" : "false"}" data-inspected="${inspected ? "true" : "false"}" data-previewed="${previewed ? "true" : "false"}"${cardInteraction} aria-label="${escapeHtml(accessibleName)}">
      ${doctrineSigilMarkup(orderDefinition.id, "capstone", "sf-doctrine__sigil--capstone")}
      <div class="sf-doctrine__vow-media">
        <img class="sf-doctrine__vow-art" src="${iconSrc}" alt="" decoding="async" />
      </div>
      <div class="sf-doctrine__vow-body">
        <header><span><small>CAPSTONE VOW · ${required} PTS</small><strong>${escapeHtml(definition.name || "Unnamed Vow")}</strong></span><b data-state="${stateName}">${status.stateLabel}</b></header>
        <p>${formatDoctrineText(definition.summary || "The final expression of this Order.", operativeId)}</p>
        <i class="sf-doctrine__vow-gate" aria-hidden="true"><em style="width:${(gateFill * 100).toFixed(1)}%"></em></i>
        <div class="sf-doctrine__vow-detail" id="sf-capstone-detail-${safeDomId(definition.id)}" data-talent-detail${inspected ? "" : " hidden"}>${formatDoctrineText(definition.description || "Capstone effect awaiting record.", operativeId)}</div>
        ${fusions}
        <div class="sf-doctrine__vow-action"><small>${escapeHtml(reason || (slot >= 0 ? "This Vow occupies one of two active seals." : "An earned Vow Seal is ready."))}</small><span><button type="button" data-doctrine-action="inspect" data-talent-action="inspect" data-talent-id="${escapeHtml(definition.id)}" aria-expanded="${inspected ? "true" : "false"}" aria-controls="sf-capstone-detail-${safeDomId(definition.id)}">${inspected ? "BACK TO RITES" : "DETAILS"}</button><button type="button" data-doctrine-action="vow" data-capstone-action="${status.action}" data-capstone-id="${escapeHtml(definition.id)}" data-order-id="${escapeHtml(orderDefinition.id)}" data-capstone-slot="${status.actionSlot}"${disabledAttributes(status.barred, reason)}>${status.label}</button></span></div>
      </div>
    </article>`;
  }

  function focusAfterDoctrineRefresh(selector, fallbackSelector = null) {
    if (!selector) return;
    requestAnimationFrame(() => {
      if (!destroyed && menu.open && menu.panel === "doctrine") {
        const target = root.querySelector(selector)
          || (fallbackSelector ? root.querySelector(fallbackSelector) : null);
        target?.focus?.({ preventScroll: true });
        target?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "auto" });
      }
    });
  }

  function selectDoctrineOrder(orderId, { focus = false } = {}) {
    const definitions = progressionDefinitions();
    if (!definitions.orders.some((entry) => entry.id === orderId)) return false;
    doctrine.orderId = orderId;
    doctrine.inspectedTalentId = null;
    doctrine.previewTalentId = null;
    doctrine.hoverTalentId = null;
    hideAbilityPopover({ force: true });
    refreshDoctrine();
    const panel = root.querySelector("[data-doctrine-order-panel]");
    if (panel) panel.scrollTop = 0;
    if (focus) focusAfterDoctrineRefresh(`[data-doctrine-order="${CSS.escape(orderId)}"]`);
    menuSfx("switch");
    return true;
  }

  function refreshDoctrine(stateOverride = null) {
    const definitions = progressionDefinitions();
    const state = stateOverride && typeof stateOverride === "object"
      ? stateOverride : progressionState();
    doctrine.latestState = state;
    const orders = definitions.orders;
    if (!doctrine.orderId || !orders.some((entry) => entry.id === doctrine.orderId)) {
      doctrine.orderId = orders[0]?.id || null;
      doctrine.inspectedTalentId = null;
      doctrine.previewTalentId = null;
    }
    /* A tree may name itself. Vesper's is "FIELD DOCTRINE" and the
       markup's default says so; a world that supplies `title` and
       `subtitle` gets its own heading rather than the campaign's
       (whose copy also quotes Vesper's own capstone threshold). */
    const titleEl = root.querySelector("[data-doctrine-title]");
    if (titleEl && typeof definitions.title === "string" && definitions.title) {
      titleEl.textContent = definitions.title.toUpperCase();
    }
    const subtitleEl = root.querySelector("[data-doctrine-subtitle]");
    if (subtitleEl && typeof definitions.subtitle === "string" && definitions.subtitle) {
      subtitleEl.textContent = definitions.subtitle;
    }
    const rank = Math.max(1, Math.floor(Number(state?.rank) || 1));
    const xpInto = Math.max(0, Math.floor(Number(state?.xpIntoRank) || 0));
    const xpForNext = Math.max(0, Math.floor(Number(state?.xpForNext) || 0));
    const atCap = xpForNext <= 0;
    const xpProgress = atCap ? 1 : clamp(xpInto / Math.max(1, xpForNext), 0, 1);
    root.querySelector("[data-doctrine-rank]").textContent = String(rank);
    const available = Math.max(0, Math.floor(Number(state?.pointsAvailable) || 0));
    root.querySelector("[data-doctrine-points]").textContent = String(available);
    const pointsBox = root.querySelector(".sf-doctrine__points");
    if (pointsBox) pointsBox.dataset.ready = available > 0 ? "true" : "false";
    root.querySelector("[data-doctrine-xp-text]").textContent = atCap
      ? "FIELD RANK CAP" : `${xpInto} / ${xpForNext} XP`;
    const xp = root.querySelector("[data-doctrine-xp]");
    xp.setAttribute("aria-valuemax", String(atCap ? 1 : xpForNext));
    xp.setAttribute("aria-valuenow", String(atCap ? 1 : Math.min(xpInto, xpForNext)));
    root.querySelector("[data-doctrine-xp-fill]").style.width = `${(xpProgress * 100).toFixed(2)}%`;

    const active = activeCapstones(state);
    const seals = earnedSeals(state, definitions);
    const bound = active.filter(Boolean).length;
    const capstoneNames = new Map(orders.filter((entry) => entry.capstone)
      .map((entry) => [entry.capstone.id, entry.capstone.name]));
    root.querySelector("[data-doctrine-vows]").innerHTML = [0, 1].map((index) => {
      const capstoneId = active[index];
      const unlocked = index < seals;
      return `<span data-state="${capstoneId ? "bound" : unlocked ? "empty" : "locked"}"><small>VOW ${rankNumeral(index + 1)}</small><strong>${escapeHtml(capstoneId ? capstoneNames.get(capstoneId) || capstoneId : unlocked ? "UNBOUND" : `RANK ${sealRanks(definitions)[index] || "—"}`)}</strong></span>`;
    }).join("");

    const edit = editState(state);
    const lock = root.querySelector("[data-doctrine-lock]");
    if (lock) {
      lock.hidden = true;
      lock.textContent = "";
    }
    const respec = root.querySelector("[data-talent-respec]");
    const pointsSpent = Math.max(0, Math.floor(Number(state?.pointsSpent) || 0));
    const hasChoices = pointsSpent > 0 || bound > 0;
    const respecReason = !hasChoices ? "No Doctrine choices have been made." : "";
    respec.disabled = !!respecReason;
    respec.setAttribute("aria-disabled", respecReason ? "true" : "false");
    respec.dataset.disabledReason = respecReason;
    respec.title = respecReason;
    respec.textContent = doctrine.respecUntil > performance.now() ? "CONFIRM RESET" : "RESET DOCTRINE";
    if (edit.allowed) hideRespecWarn();

    const tabs = root.querySelector("[data-doctrine-orders]");
    tabs.innerHTML = orders.map((entry) => {
      const selected = entry.id === doctrine.orderId;
      const points = orderPoints(runtimeOrder(state, entry.id));
      const accessibleName = `${entry.name || entry.shortName}, ${points} Doctrine ${points === 1 ? "point" : "points"}`;
      return `<button type="button" id="sf-doctrine-tab-${safeDomId(entry.id)}" role="tab" data-doctrine-order="${escapeHtml(entry.id)}" data-order-id="${escapeHtml(entry.id)}" data-accent="${escapeHtml(entry.accent || "gold")}" aria-label="${escapeHtml(accessibleName)}" aria-selected="${selected ? "true" : "false"}" aria-controls="sf-doctrine-order-panel" tabindex="${selected ? "0" : "-1"}">${doctrineSigilMarkup(entry.id, "tab", "sf-doctrine__sigil--tab")}<span>${escapeHtml(entry.shortName || entry.name)}</span><small>${points} PTS</small></button>`;
    }).join("");

    const panel = root.querySelector("[data-doctrine-order-panel]");
    const heroSigil = root.querySelector("[data-doctrine-sigil][data-sigil-role='hero']");
    panel.id = "sf-doctrine-order-panel";
    if (!doctrine.orderId) {
      if (heroSigil) {
        heroSigil.hidden = true;
        heroSigil.removeAttribute("src");
        delete heroSigil.dataset.orderId;
      }
      panel.removeAttribute("aria-labelledby");
      root.querySelector("[data-doctrine-order-name]").textContent = "Doctrine unavailable";
      root.querySelector("[data-doctrine-order-focus]").textContent = "No Order definitions were provided.";
      root.querySelector("[data-doctrine-talents]").innerHTML = "";
      const preview = root.querySelector("[data-doctrine-preview]");
      if (preview) preview.innerHTML = '<span class="sf-doctrine__preview-empty">NO RITES RECOVERED</span>';
      root.querySelector("[data-doctrine-capstone]").innerHTML = "";
      return state;
    }
    const orderDefinition = orders.find((entry) => entry.id === doctrine.orderId);
    const orderState = runtimeOrder(state, doctrine.orderId);
    const invested = orderPoints(orderState);
    const maxOrder = Math.max(1, Math.floor(Number(definitions?.maxPointsPerOrder) || 8));
    const heroSource = DOCTRINE_SIGILS[doctrine.orderId];
    if (heroSigil) {
      heroSigil.hidden = !heroSource;
      if (heroSource) heroSigil.src = heroSource;
      heroSigil.dataset.orderId = doctrine.orderId;
    }
    panel.dataset.orderId = doctrine.orderId;
    panel.dataset.doctrineOrderPanel = doctrine.orderId;
    panel.dataset.accent = orderDefinition.accent || "gold";
    const talentIds = new Set((orderDefinition.talents || []).map((talent) => talent.id));
    const capstoneId = orderDefinition.capstone?.id || null;
    if (!talentIds.has(doctrine.previewTalentId)
      && doctrine.previewTalentId !== capstoneId) {
      doctrine.previewTalentId = orderDefinition.talents?.[0]?.id || null;
    }
    panel.dataset.view = doctrine.inspectedTalentId === orderDefinition.capstone?.id
      ? "capstone" : talentIds.has(doctrine.inspectedTalentId) ? "talent" : "overview";
    panel.setAttribute("aria-labelledby", `sf-doctrine-tab-${safeDomId(doctrine.orderId)}`);
    root.querySelector("[data-doctrine-order-kicker]").textContent = "RELIQUARY ORDER";
    root.querySelector("[data-doctrine-order-name]").textContent = orderDefinition.name || orderDefinition.shortName;
    root.querySelector("[data-doctrine-order-focus]").textContent = orderDefinition.focus || "A recovered field doctrine.";
    root.querySelector("[data-doctrine-invested]").textContent = `${invested} / ${maxOrder}`;
    root.querySelector("[data-doctrine-talents]").innerHTML = (orderDefinition.talents || [])
      .map((talent) => renderTalent(talent, runtimeTalent(state, orderState, talent.id),
        state, orderState, edit, definitions)).join("");
    renderDoctrinePreview(orderDefinition, orderState, state, edit, definitions);
    renderCapstone(orderDefinition.capstone, orderDefinition, orderState, state, edit, definitions);
    return state;
  }

  function updateCommands() {
    commandEls.forEach((button, index) => {
      const key = order[index];
      const remaining = Math.max(0, Number(ctx.mission.cooldowns?.[key]) || 0);
      const ready = remaining <= 0.001;
      button.dataset.state = ready ? "ready" : "cooldown";
      button.querySelector("[data-command-status]").textContent = ready ? "READY" : `${Math.ceil(remaining)}s`;
      button.setAttribute("aria-label", `${ctx.mission.stratagems?.[key]?.name || key}, ${ready ? "ready" : `${Math.ceil(remaining)} seconds`}`);
    });
  }

  function setWheelSelection(index, { sound = true } = {}) {
    const next = Number.isInteger(index) && index >= 0 && index < order.length ? index : -1;
    if (next === wheel.selectedIndex) return;
    wheel.selectedIndex = next;
    const key = next >= 0 ? order[next] : null;
    wheelEl.dataset.selection = key || "";
    commandEls.forEach((button, i) => {
      const selected = i === next;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    wheelStatusEl.textContent = key ? (ctx.mission.stratagems?.[key]?.short || key).toUpperCase() : "HOVER TO SELECT";
    if (next >= 0 && sound) wheelSfx("select", next);
  }

  function selectFromVector(x, y) {
    const magnitude = Math.hypot(x, y);
    const scale = magnitude > wheel.maxRadius ? wheel.maxRadius / magnitude : 1;
    /* Clamp the logical vector as well as the drawn cursor. Otherwise one
       large mouse flick stores hundreds of invisible pixels and makes the
       player drag that entire distance back before another sector responds. */
    wheel.x = x * scale;
    wheel.y = y * scale;
    cursorEl.style.setProperty("--sf-command-x", `${wheel.x.toFixed(1)}px`);
    cursorEl.style.setProperty("--sf-command-y", `${wheel.y.toFixed(1)}px`);
    if (magnitude < wheel.deadZone) { setWheelSelection(-1); return -1; }
    const ux = x / magnitude;
    const uy = y / magnitude;
    let best = 0;
    let score = -Infinity;
    WHEEL_POINTS.slice(0, order.length).forEach((point, index) => {
      const dot = ux * point.x + uy * point.y;
      if (dot > score) { score = dot; best = index; }
    });
    setWheelSelection(best);
    return best;
  }

  function canOpenWheel() {
    return !menu.open && !ctx.combat?.player?.dead && ctx.runtime?.phase === "playing"
      && !ctx.intro?.isBlocking?.() && !document.hidden;
  }

  function ownsGameKeyboard() {
    const active = document.activeElement;
    if (active && active.closest && active.closest("a, button, input, textarea, select, [contenteditable='true'], [role='button'], [role='tab'], [role='menuitem']") && !active.closest(".sf-stage")) {
      return false;
    }
    return document.pointerLockElement === canvas
      || ctx.player?.input?.state?.locked
      || active === canvas
      || !active
      || active === document.body
      || document.documentElement.classList.contains("sf-maximised")
      || document.body.classList.contains("rb-game-maxed")
      || !!active.closest?.(".sf-stage");
  }

  function isMaximized() {
    return !!document.fullscreenElement
      || !!document.webkitFullscreenElement
      || stage.classList.contains("is-maxed")
      || document.documentElement.classList.contains("sf-maximised")
      || document.body.classList.contains("rb-game-maxed");
  }

  function syncMaximizeButton() {
    const active = isMaximized();
    if (maximizeLabel) maximizeLabel.textContent = active ? "EXIT MAX SCREEN" : "MAXIMIZE GAME";
    if (maximizeButton) {
      maximizeButton.setAttribute("aria-label", active ? "Exit max screen" : "Maximize game");
      maximizeButton.setAttribute("aria-pressed", active ? "true" : "false");
      maximizeButton.dataset.state = active ? "maximized" : "embedded";
    }
    return active;
  }

  async function lockEscapeInFullscreen() {
    const hasFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (!hasFs) return false;
    const keyboard = navigator.keyboard;
    if (!keyboard || typeof keyboard.lock !== "function") return false;
    try {
      await keyboard.lock(["Escape"]);
      keyboardEscapeLocked = true;
      return true;
    } catch (_) {
      keyboardEscapeLocked = false;
      return false;
    }
  }

  function unlockEscapeKeyboard() {
    if (!keyboardEscapeLocked) return;
    try {
      if (navigator.keyboard && typeof navigator.keyboard.unlock === "function") {
        navigator.keyboard.unlock();
      }
    } catch (_) { /* best-effort */ }
    keyboardEscapeLocked = false;
  }

  function setMaximized(active) {
    if (!active) {
      intentionalMaximizeExitUntil = performance.now() + 1000;
      unlockEscapeKeyboard();
    } else {
      intentionalMaximizeExitUntil = 0;
    }
    stage.classList.toggle("is-maxed", active);
    surface?.classList?.toggle?.("is-maxed", active);
    if (!active) {
      document.querySelectorAll(".is-maxed").forEach((el) => {
        el.classList.remove("is-maxed");
      });
    }
    document.documentElement.classList.toggle("sf-maximised", active);
    document.body.classList.toggle("rb-game-maxed", active);
    syncMaximizeButton();
    if (active && !document.fullscreenElement && surface.requestFullscreen) {
      try {
        const fsPromise = surface.requestFullscreen();
        fsPromise?.then?.(() => {
          void lockEscapeInFullscreen();
        })?.catch?.(() => false);
      } catch (_) { /* CSS fallback remains active. */ }
    } else if (!active && (document.fullscreenElement || document.webkitFullscreenElement)) {
      const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
      try { exitFs?.call?.(document)?.catch?.(() => false); } catch (_) { /* CSS state already restored. */ }
    }
    window.dispatchEvent(new Event("resize"));
    return active;
  }

  function toggleMaximized() {
    const active = !isMaximized();
    closeMenu({ requestLock: false });
    setMaximized(active);
    announce(active ? "Max screen enabled" : "Embedded view restored");
    return active;
  }

  function onFullscreenChange() {
    const hasNativeFs = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement
    );
    if (hasNativeFs) {
      syncMaximizeButton();
      void lockEscapeInFullscreen();
      return;
    }
    unlockEscapeKeyboard();

    if (performance.now() < intentionalMaximizeExitUntil) {
      stage.classList.remove("is-maxed");
      surface?.classList?.remove?.("is-maxed");
      document.querySelectorAll(".is-maxed").forEach((el) => {
        el.classList.remove("is-maxed");
      });
      document.documentElement.classList.remove("sf-maximised");
      document.body.classList.remove("rb-game-maxed");
      syncMaximizeButton();
      window.dispatchEvent(new Event("resize"));
      return;
    }

    if (stage.classList.contains("is-maxed") || document.documentElement.classList.contains("sf-maximised") || document.body.classList.contains("rb-game-maxed")) {
      stage.classList.add("is-maxed");
      surface?.classList?.add?.("is-maxed");
      document.documentElement.classList.add("sf-maximised");
      document.body.classList.add("rb-game-maxed");
      syncMaximizeButton();
      if (!menu.open && !destroyed && ctx.runtime?.phase === "playing" && !ctx.intro?.isBlocking?.()) {
        lastEscapePressTime = performance.now();
        ignoreEscapeMenuToggleUntil = performance.now() + 150;
        openMenu("operation", { force: true });
      }
      return;
    }

    syncMaximizeButton();
  }

  function openWheel(source = "keyboard", origin = null) {
    if (destroyed || wheel.open || !canOpenWheel()) return false;
    wheel.open = true;
    wheel.source = source;
    wheel.x = 0;
    wheel.y = 0;
    wheel.pointerId = origin?.pointerId ?? null;
    wheel.touchOrigin = origin ? { x: origin.x, y: origin.y } : null;
    wheel.openedLocked = document.pointerLockElement === canvas;
    wheel.cancelReason = null;
    const coreHintEl = wheelEl.querySelector(".sf-command-wheel__core small");
    if (coreHintEl) {
      coreHintEl.textContent = source === "touch" ? "RELEASE TO CONFIRM" : "CLICK TO CONFIRM";
    }
    setWheelSelection(-1, { sound: false });
    cursorEl.style.setProperty("--sf-command-x", "0px");
    cursorEl.style.setProperty("--sf-command-y", "0px");
    updateCommands();
    wheelEl.hidden = false;
    wheelEl.setAttribute("aria-hidden", "false");
    wheelEl.dataset.open = "true";
    document.body.classList.add("sf-command-open");
    ctx.player?.input?.clearAll?.();
    touch?.releaseAll?.();
    wheelSfx("open");
    announce("Command wheel open. Hover over a command and click to confirm.");
    return true;
  }

  function closeWheel({ confirm = false, reason = "cancelled" } = {}) {
    if (destroyed || !wheel.open) return false;
    const index = wheel.selectedIndex;
    const key = index >= 0 ? order[index] : null;
    wheel.open = false;
    wheel.pointerId = null;
    wheel.touchOrigin = null;
    wheel.cancelReason = confirm ? null : reason;
    wheelEl.hidden = true;
    wheelEl.setAttribute("aria-hidden", "true");
    wheelEl.dataset.open = "false";
    document.body.classList.remove("sf-command-open");
    ctx.player?.input?.clearAll?.();
    setWheelSelection(-1, { sound: false });
    if (confirm && key) {
      const result = ctx.mission.call(key);
      if (result) wheel.dispatchSeq += 1;
      wheel.lastDispatch = {
        seq: wheel.dispatchSeq, key, result, accepted: !!result, at: performance.now(),
      };
      wheelSfx(result ? "confirm" : "cancel");
      announce(result ? `${ctx.mission.stratagems?.[key]?.name || key} inbound` : `${ctx.mission.stratagems?.[key]?.name || key} unavailable`);
      return result || false;
    }
    wheelSfx("cancel");
    announce(key ? "Command cancelled" : "Command wheel closed without selection");
    return false;
  }

  const cancelWheel = (reason = "cancelled") => closeWheel({ confirm: false, reason });

  function setPanel(panel, { focus = false } = {}) {
    const next = PANEL_NAMES.has(panel) ? panel : "operation";
    menu.panel = next;
    menuEl.dataset.panel = next;
    root.querySelectorAll("[data-menu-panel]").forEach((button) => {
      const active = button.dataset.menuPanel === next;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      button.classList.toggle("is-active", active);
    });
    root.querySelectorAll("[data-menu-page]").forEach((page) => {
      page.hidden = page.dataset.menuPage !== next;
    });
    const content = root.querySelector(".sf-menu__content");
    if (content) content.scrollTop = 0;
    capture = null;
    if (next === "controls") renderKeybinds();
    if (next === "saves") refreshSaves();
    if (next === "operation") refreshOperation();
    if (next === "doctrine") refreshDoctrine();
    else {
      doctrine.respecUntil = 0;
      hideRespecWarn();
      hideAbilityPopover({ force: true });
    }
    if (next === "map") {
      refreshMap();
      requestAnimationFrame(() => { if (!destroyed && menu.open && menu.panel === "map") refreshMap(); });
    }
    if (focus) root.querySelector(`[data-menu-page="${next}"] h3`)?.focus?.();
    menuSfx("switch");
  }

  function refreshMap() {
    const state = ctx.mission.state || {};
    const objective = ctx.mission.objective?.();
    const breach = ctx.breaches?.status?.();
    const bossTotal = ctx.mission.bosses?.length || 7;
    const bossDone = Math.max(0, state.bossesDone || 0);
    const objectiveDone = !objective && state.phase === "won";
    const breachDone = !!breach?.complete;
    const bossesDone = bossDone >= bossTotal;
    const completed = [objectiveDone, breachDone, bossesDone].filter(Boolean).length;
    const breachActive = !!breach && ["warning", "active"].includes(breach.phase);
    let breachProgress = breachDone ? 1 : 0;
    if (breach?.boss) breachProgress = 1 - breach.boss.health / Math.max(1, breach.boss.maxHealth);
    else if (breach?.phase === "active" && breach.total) {
      breachProgress = 1 - Math.max(0, breach.remaining || 0) / breach.total;
    } else if (breach?.phase === "warning") {
      breachProgress = 1 - Math.max(0, breach.timer || 0) / Math.max(1, ctx.breaches?.config?.warningSeconds || 1);
    }
    const items = [
      {
        index: "01", kicker: "PRIORITY DIRECTIVE",
        title: objective?.name || (objectiveDone ? "OPERATION COMPLETE" : "AWAITING FIELD ORDER"),
        detail: objective ? `${Math.round(objective.dist || 0)}m from reliquary` : "No active destination",
        progress: objective?.progress || (objectiveDone ? 1 : 0),
        state: objectiveDone ? "complete" : "active",
      },
      {
        index: "02", kicker: "BLOOM CONTAINMENT",
        title: breachDone ? `CYCLE ${breach.cyclesCleared || 1} CLEARED` : breachActive
          ? `CYCLE ${breach?.cycle || 1} · ${breach?.name || "RUPTURE DETECTED"}` : "SIGNAL QUIET",
        detail: breachDone ? `Next pressure cycle in ${formatClock(breach.timer)}` : breach?.phase === "warning"
          ? `Emergence in ${Math.ceil(breach.timer || 0)} seconds` : breach?.phase === "active"
            ? `${Math.max(0, breach.remaining || 0)} hostiles remain` : "Monitoring the basin",
        progress: breachProgress,
        state: breachDone ? "complete" : breachActive ? "threat" : "idle",
      },
      {
        index: "03", kicker: "APEX GUARDIANS",
        title: bossesDone ? "ALL SEVEN SIGNATURES BROKEN" : `${bossDone} OF ${bossTotal} BOSSES DEFEATED`,
        detail: bossesDone ? "The Cathedral confrontation is unlocked"
          : state.phase === "saintBoss" ? "The Coulter is awake beneath the Fallen Saint"
            : "Six district victories awaken the penultimate boss",
        progress: bossDone / Math.max(1, bossTotal),
        state: bossesDone ? "complete" : "active",
      },
    ];
    const list = root.querySelector("[data-map-objectives]");
    if (list) list.innerHTML = items.map((item) => `<article class="sf-map-order" data-state="${item.state}" style="--sf-order-progress:${clamp(item.progress, 0, 1)}">
      <i aria-hidden="true">${item.index}</i><span><small>${item.kicker}</small><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.detail)}</em></span>
      <b aria-label="${Math.round(clamp(item.progress, 0, 1) * 100)} percent complete"></b></article>`).join("");
    const count = root.querySelector("[data-map-order-count]");
    if (count) count.textContent = `${completed} / 3`;
    const semantic = ctx.hud?.redrawTacticalMap?.(largeMapCanvas);
    if (largeMapRange) largeMapRange.textContent = semantic?.range
      ? `${Math.round(semantic.range)}M BASIN` : "FIELD SURVEY";
    return semantic;
  }

  function refreshOperation() {
    const state = ctx.mission.state || {};
    const objective = ctx.mission.objective?.();
    const breach = ctx.breaches?.status?.();
    const phase = state.phase || "districtBosses";
    menuEl.dataset.phase = phase;
    const heading = root.querySelector("[data-operation-heading]");
    const copy = root.querySelector("[data-operation-copy]");
    if (phase === "won") {
      heading.textContent = "CAMPAIGN DEBRIEF";
      copy.textContent = "The standing order and the false saint are broken. Your campaign record is sealed.";
    } else if (phase === "lost") {
      heading.textContent = "OPERATION FAILED";
      copy.textContent = "The reliquary is dark. Restart the operation to return.";
    } else if (phase === "extract") {
      heading.textContent = "REACH EXTRACTION";
      copy.textContent = "Hold the Fallen Saint until the shuttle can lift.";
    } else if (phase === "cathedralBoss") {
      heading.textContent = "RETURN TO THE CATHEDRAL";
      copy.textContent = "The final signal is wearing your reliquary. Destroy the Apostate.";
    } else if (phase === "saintBoss") {
      heading.textContent = "THE FALLEN SAINT STIRS";
      copy.textContent = "Enter the central sand basin and break the colossal Coulter.";
    } else {
      heading.textContent = "THE SEVENFOLD HUNT";
      copy.textContent = "Defeat the six district guardians while intermittent Bloom waves pursue you.";
    }
    root.querySelector("[data-operation-objective]").textContent = phase === "won"
      ? "THE GILDED SILENCE · COMPLETE" : objective?.name || "Awaiting field order";
    root.querySelector("[data-operation-distance]").textContent = phase === "won"
      ? "Campaign record sealed" : objective ? `${Math.round(objective.dist || 0)}m from current position` : "No active directive";
    root.querySelector("[data-operation-relays]").textContent = `${state.bossesDone || 0} / ${ctx.mission.bosses?.length || 7}`;
    root.querySelector("[data-operation-deaths]").textContent = String(Math.max(0, state.deaths ?? 0));
    root.querySelector("[data-operation-clock]").textContent = formatClock(state.elapsed);
    const breachActive = !!breach && ["warning", "active", "intermission"].includes(breach.phase);
    const breachName = breach?.complete ? `CYCLE ${breach.cyclesCleared || 1} CLEARED`
      : breachActive ? (breach.phase === "warning" ? "RUPTURE INCOMING" : `CYCLE ${breach.cycle || 1} · BREACH ${breach.wave || 1}`)
        : "SIGNAL QUIET";
    root.querySelector("[data-operation-breach]").textContent = breachName;
    root.querySelector("[data-operation-breach-detail]").textContent = breachActive
      ? (breach.phase === "warning" ? `${Math.ceil(breach.timer || 0)} seconds to emergence`
        : `${Math.max(0, breach.remaining || 0)} hostiles remain`)
      : breach?.complete ? `Next pressure cycle in ${formatClock(breach.timer)}` : "No active rupture";

    const debrief = root.querySelector("[data-campaign-debrief]");
    const missionWrap = root.querySelector("[data-mission-wrap]");
    const campaign = ctx.campaignScore?.status?.();
    const result = campaign?.result;
    const showDebrief = phase === "won" && !!result;
    const showMissionWrap = showDebrief && !menu.victoryWrapSeen;
    const menuFrame = root.querySelector(".sf-menu__frame");
    if (menuFrame) {
      menuFrame.inert = showMissionWrap;
      menuFrame.hidden = showMissionWrap;
      if (showMissionWrap) menuFrame.setAttribute("aria-hidden", "true");
      else menuFrame.removeAttribute("aria-hidden");
    }
    if (missionWrap) {
      missionWrap.hidden = !showMissionWrap;
      missionWrap.setAttribute("aria-hidden", showMissionWrap ? "false" : "true");
      const saint = missionWrap.querySelector("[data-mission-wrap-saint]");
      if (saint) saint.textContent = `${ctx.playerCharacter?.name || "The Saint"} made saintfall from orbit. Vesper-IX rises from silence.`;
    }
    if (debrief) {
      debrief.hidden = !showDebrief || showMissionWrap;
      debrief.dataset.newHigh = result?.newHighScore ? "true" : "false";
    }
    if (showDebrief) {
      const score = Math.max(0, Math.floor(Number(result.score) || 0));
      const best = Math.max(score, Math.floor(Number(campaign.highScore || result.best) || 0));
      root.querySelector("[data-debrief-score]").textContent = score.toLocaleString();
      root.querySelector("[data-debrief-best]").textContent = best.toLocaleString();
      root.querySelector("[data-debrief-difficulty]").textContent = result.difficulty?.label || "PENITENT";
      root.querySelector("[data-debrief-difficulty-multiplier]").textContent = `×${Number(result.difficulty?.multiplier || 1).toFixed(3)}`;
      root.querySelector("[data-debrief-time]").textContent = formatClock(result.time?.seconds);
      root.querySelector("[data-debrief-time-multiplier]").textContent = `×${Number(result.time?.multiplier || 1).toFixed(3)}`;
      root.querySelector("[data-debrief-rank]").textContent = String(result.doctrine?.rank || 1);
      root.querySelector("[data-debrief-rank-multiplier]").textContent = `×${Number(result.doctrine?.multiplier || 1).toFixed(3)}`;
      const badge = root.querySelector("[data-debrief-badge]");
      if (badge) badge.textContent = result.eligible === false ? "QA SCORE · NOT SUBMITTED"
        : result.newHighScore ? "NEW HIGH SCORE" : score >= best ? "HIGH SCORE MATCHED" : "SCORE RECORDED";
    }
  }

  function readCareerConflict() {
    try {
      const direct = save?.conflictState?.();
      if (direct && typeof direct.then !== "function") return direct;
      return save?.state?.()?.careerConflict || null;
    } catch (_) {
      return null;
    }
  }

  function careerRankAtXp(totalXp, explicitRank) {
    if (Number.isFinite(Number(explicitRank))) return Math.max(1, Math.floor(Number(explicitRank)));
    let raw = {};
    try {
      raw = typeof progression?.definitions === "function"
        ? progression.definitions() : progression?.definitions || {};
    } catch (_) { raw = {}; }
    const thresholds = raw?.fieldRank?.xpThresholds
      || raw?.progression?.fieldRank?.xpThresholds || [];
    const xp = Math.max(0, Number(totalXp) || 0);
    let rank = 1;
    thresholds.forEach((threshold, index) => {
      if (Number.isFinite(Number(threshold)) && xp >= Number(threshold)) rank = index + 1;
    });
    return rank;
  }

  function doctrinePointCount(summary = {}) {
    if (Number.isFinite(Number(summary.pointsSpent))) {
      return Math.max(0, Math.floor(Number(summary.pointsSpent)));
    }
    if (summary.doctrinePoints && typeof summary.doctrinePoints === "object") {
      const value = summary.doctrinePoints.spent ?? summary.doctrinePoints.used;
      if (Number.isFinite(Number(value))) return Math.max(0, Math.floor(Number(value)));
    }
    if (Number.isFinite(Number(summary.doctrinePoints))) {
      return Math.max(0, Math.floor(Number(summary.doctrinePoints)));
    }
    if (summary.allocations && typeof summary.allocations === "object") {
      return Object.values(summary.allocations).reduce((sum, value) =>
        sum + (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0), 0);
    }
    return 0;
  }

  function activeVowCount(summary = {}) {
    if (Array.isArray(summary.activeVows)) return summary.activeVows.filter(Boolean).length;
    if (Array.isArray(summary.activeCapstones)) return summary.activeCapstones.filter(Boolean).length;
    if (Number.isFinite(Number(summary.activeVows))) {
      return Math.max(0, Math.floor(Number(summary.activeVows)));
    }
    return 0;
  }

  function doctrinePointLabel(summary = {}) {
    const spent = doctrinePointCount(summary);
    const source = summary.doctrinePoints && typeof summary.doctrinePoints === "object"
      ? summary.doctrinePoints : summary;
    const earned = source.earned ?? summary.pointsEarned;
    return Number.isFinite(Number(earned))
      ? `${spent} / ${Math.max(spent, Math.floor(Number(earned)))}` : String(spent);
  }

  function doctrineBuildLabel(summary = {}) {
    const authored = summary.buildLabel ?? summary.build ?? summary.doctrineBuild ?? summary.orderPoints;
    if (typeof authored === "string" && authored.trim()) return authored.trim();
    if (Array.isArray(authored)) {
      const labels = authored.map((entry) => typeof entry === "string" ? entry.trim()
        : entry?.name ? `${entry.name}${Number(entry.points) > 0 ? ` ${entry.points}` : ""}` : "").filter(Boolean);
      if (labels.length) {
        const vows = (summary.activeVowNames || summary.activeVows || []).filter?.(Boolean) || [];
        return `${labels.join(" · ")}${vows.length ? ` · Vows: ${vows.join(", ")}` : ""}`;
      }
    }
    const allocations = summary.allocations && typeof summary.allocations === "object"
      ? summary.allocations : null;
    if (allocations) {
      const orders = progressionDefinitions().orders || [];
      const labels = orders.map((order) => {
        const points = (order.talents || []).reduce((sum, talent) =>
          sum + Math.max(0, Math.floor(Number(allocations[talent.id]) || 0)), 0);
        return points > 0 ? `${order.shortName || order.name || order.id} ${points}` : "";
      }).filter(Boolean);
      if (labels.length) return labels.join(" · ");
    }
    const points = doctrinePointCount(summary);
    return points > 0 ? `${points} Doctrine ${points === 1 ? "point" : "points"} inscribed.`
      : "No Doctrine inscriptions recorded.";
  }

  function formatCareerTime(value, fallback) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return formatSavedAt(numeric);
    const parsed = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? formatSavedAt(parsed) : fallback;
  }

  function refreshCareerRecovery() {
    const panel = root.querySelector("[data-career-recovery]");
    if (!panel) return null;
    const conflict = readCareerConflict();
    const active = !!conflict?.active;
    const navBadge = root.querySelector("[data-career-recovery-nav]");
    const navButton = navBadge?.closest("[data-menu-panel='saves']");
    if (navBadge) navBadge.hidden = !active;
    if (navButton) {
      if (active) navButton.setAttribute("aria-label", "Save and load, Doctrine career review required");
      else navButton.removeAttribute("aria-label");
      navButton.classList.toggle("has-career-conflict", active);
    }
    if (!active && !careerRecovery.resolvedMessage) {
      panel.hidden = true;
      panel.dataset.state = "idle";
      careerRecovery.armedChoice = null;
      careerRecovery.armedUntil = 0;
      careerRecovery.errorMessage = "";
      return conflict;
    }

    panel.hidden = false;
    const title = panel.querySelector("#sf-career-recovery-title");
    const copy = panel.querySelector("#sf-career-recovery-copy");
    const badge = panel.querySelector("[data-career-recovery-badge]");
    const status = panel.querySelector("[data-career-recovery-status]");
    if (!active) {
      panel.dataset.state = "resolved";
      panel.setAttribute("aria-busy", "false");
      title.textContent = "Career recovery complete";
      copy.textContent = "The selected Doctrine career is now authoritative.";
      badge.textContent = "SAVING RESUMED";
      status.textContent = careerRecovery.resolvedMessage;
      return conflict;
    }

    if (careerRecovery.armedUntil <= performance.now()) {
      careerRecovery.armedChoice = null;
      careerRecovery.armedUntil = 0;
    }
    panel.dataset.state = careerRecovery.resolving ? "resolving" : "conflict";
    panel.setAttribute("aria-busy", careerRecovery.resolving ? "true" : "false");
    title.textContent = "Choose the career to preserve";
    badge.textContent = careerRecovery.resolving ? "RECOVERING" : "REVIEW REQUIRED";

    const branches = conflict.branches || {};
    const availableChoices = ["local", "synced"].filter((choice) => {
      const branch = branches[choice];
      return branch && branch.available !== false && branch.valid !== false;
    });
    copy.textContent = availableChoices.length < 2
      ? "A stored Doctrine career could not be verified. The verified record remains safe until you review and confirm it. Field saves are unaffected."
      : "This device and the synced record changed separately. Both are safe until you review and confirm one version. Field saves are unaffected.";
    for (const choice of ["local", "synced"]) {
      const branch = branches[choice] || {};
      const summary = branch.summary || {};
      const available = branch.available !== false && branch.valid !== false && !!branches[choice];
      const armed = careerRecovery.armedChoice === choice;
      const card = panel.querySelector(`[data-career-branch-card="${choice}"]`);
      const button = card?.querySelector("[data-career-recovery-action]");
      if (!card || !button) continue;
      card.dataset.state = available ? (armed ? "armed" : "available") : "unavailable";
      card.setAttribute("aria-label", `${choice === "local" ? "This device" : "Synced career"}${available ? "" : ", unavailable"}`);
      panel.querySelector(`[data-career-branch-rank="${choice}"]`).textContent = available
        ? String(careerRankAtXp(summary.totalXp, summary.rank)) : "—";
      panel.querySelector(`[data-career-branch-xp="${choice}"]`).textContent = available
        ? Math.max(0, Math.floor(Number(summary.totalXp) || 0)).toLocaleString() : "—";
      panel.querySelector(`[data-career-branch-points="${choice}"]`).textContent = available
        ? doctrinePointLabel(summary) : "—";
      panel.querySelector(`[data-career-branch-vows="${choice}"]`).textContent = available
        ? String(activeVowCount(summary)) : "—";
      panel.querySelector(`[data-career-branch-revision="${choice}"]`).textContent = available
        ? `REV ${Math.max(0, Math.floor(Number(summary.revision) || 0))}` : "NOT VERIFIED";
      panel.querySelector(`[data-career-branch-build="${choice}"]`).textContent = available
        ? doctrineBuildLabel(summary) : "This career record did not pass validation and cannot be selected.";
      const time = summary.updatedAt ?? branch.updatedAt ?? branch.at ?? conflict.at;
      panel.querySelector(`[data-career-branch-time="${choice}"]`).textContent = `${choice === "local" ? "Device record" : "Synced record"} · ${formatCareerTime(time, "time unavailable")}`;
      button.disabled = careerRecovery.resolving || !available;
      button.textContent = armed
        ? (choice === "local" ? "CONFIRM KEEP THIS DEVICE" : "CONFIRM USE SYNCED CAREER")
        : (choice === "local" ? "KEEP THIS DEVICE" : "USE SYNCED CAREER");
      button.setAttribute("aria-pressed", armed ? "true" : "false");
    }

    if (careerRecovery.resolving) {
      status.textContent = `Recovering the ${careerRecovery.armedChoice === "synced" ? "synced" : "device"} career…`;
    } else if (careerRecovery.errorMessage) {
      status.textContent = careerRecovery.errorMessage;
    } else if (careerRecovery.armedChoice) {
      status.textContent = `${careerRecovery.armedChoice === "local" ? "This device" : "Synced career"} selected. Press its confirm button to make it authoritative.`;
    } else {
      status.textContent = availableChoices.length === 1
        ? `Only the ${availableChoices[0] === "local" ? "device" : "synced"} career passed validation. Confirm it to resume career saving.`
        : "Compare both records. Your field saves are not affected.";
    }
    return conflict;
  }

  /* ------------------------------------------------------------
     THE DEATH SCREEN (m101). There is no reinforcement budget and no
     automatic respawn any more: dying holds the field, and this is
     the conversation that continues it. It offers exactly what the
     save system can honour - the newest record in one press, the
     full slot list, or a fresh drop - and it dismisses ITSELF the
     moment the trooper is alive, however that came about, so every
     load path ends it without knowing it exists.
     ------------------------------------------------------------ */
  function latestFieldRecord() {
    try { saveData = save?.read?.() || saveData; } catch (_) { /* keep cache */ }
    const candidates = [
      { kind: "autosave", index: -1, record: saveData.autosave },
      ...(saveData.manuals || []).map((record, index) => ({ kind: "manual", index, record })),
    ].filter((entry) => entry.record?.snapshot?.timestamp);
    candidates.sort((a, b) => (b.record.snapshot.timestamp || 0) - (a.record.snapshot.timestamp || 0));
    return candidates[0] || null;
  }

  function refreshDeathScreen() {
    death.latest = latestFieldRecord();
    const load = deathEl.querySelector('[data-death-action="load"]');
    const label = deathEl.querySelector("[data-death-load-label]");
    const meta = deathEl.querySelector("[data-death-load-meta]");
    const copy = deathEl.querySelector("[data-death-copy]");
    if (death.latest) {
      const snapshot = death.latest.record.snapshot;
      load.disabled = false;
      label.textContent = death.latest.kind === "autosave"
        ? "RESTORE AUTOSAVE" : `RESTORE FIELD SLOT ${["I", "II", "III"][death.latest.index] || ""}`;
      meta.textContent = `${snapshot.summary?.district || "VESPER-IX"} · ${formatSavedAt(snapshot.timestamp)} · ${formatClock(snapshot.summary?.elapsed)}`;
      copy.textContent = "Silence on the wire. Restore a field record to continue the operation.";
    } else {
      load.disabled = true;
      label.textContent = "RESTORE LAST RECORD";
      meta.textContent = "No field record yet";
      copy.textContent = "Silence on the wire. No field record exists - restart the operation.";
    }
  }

  function showDeathScreen() {
    if (destroyed || death.open) return;
    if (!ctx.combat?.player?.dead) return;
    death.open = true;
    refreshDeathScreen();
    deathEl.hidden = false;
    deathEl.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => { if (death.open) deathEl.classList.add("is-on"); });
    if (document.pointerLockElement) document.exitPointerLock?.();
    ctx.player?.input?.clearAll?.();
    touch?.releaseAll?.();
    announce("The Reliquary has fallen. Restore a field record to continue.");
  }

  function hideDeathScreen() {
    if (!death.open) return;
    death.open = false;
    death.restartUntil = 0;
    const restart = deathEl.querySelector("[data-death-restart-label]");
    if (restart) restart.textContent = "RESTART OPERATION";
    deathEl.classList.remove("is-on");
    deathEl.hidden = true;
    deathEl.setAttribute("aria-hidden", "true");
  }

  function handleDeathAction(target) {
    const action = target.dataset.deathAction;
    if (action === "load") {
      refreshDeathScreen();
      if (!death.latest) { menuSfx("error"); return; }
      const ok = !!save?.load?.(death.latest.kind, death.latest.index);
      menuSfx(ok ? "confirm" : "error");
      if (!ok) announce("Field record failed to restore.");
      // Success needs no handling here: update() sees a living player
      // and takes the screen down.
      return;
    }
    if (action === "records") {
      openMenu("saves", { force: true });
      return;
    }
    if (action === "restart") {
      if (death.restartUntil > performance.now()) { window.location.reload(); return; }
      death.restartUntil = performance.now() + 4500;
      const label = deathEl.querySelector("[data-death-restart-label]");
      if (label) label.textContent = "CONFIRM RESTART";
      menuSfx("question");
      announce("Press restart again to confirm");
      scheduleUiTimeout(() => {
        if (death.restartUntil && death.restartUntil <= performance.now()) {
          death.restartUntil = 0;
          const reset = deathEl.querySelector("[data-death-restart-label]");
          if (reset) reset.textContent = "RESTART OPERATION";
        }
      }, 4600);
    }
  }

  function refreshSaves() {
    try { saveData = save?.read?.() || saveData; } catch (_) { /* keep cache */ }
    refreshCareerRecovery();
    root.querySelectorAll(".sf-save-slot").forEach((slotEl) => {
      const kind = slotEl.dataset.saveKind;
      const index = Number(slotEl.dataset.saveIndex);
      const record = kind === "autosave" ? saveData.autosave : saveData.manuals?.[index];
      const snapshot = record?.snapshot;
      slotEl.classList.toggle("has-save", !!snapshot);
      slotEl.querySelector("[data-slot-state]").textContent = snapshot ? "RECORDED" : "EMPTY";
      slotEl.querySelector("[data-slot-district]").textContent = snapshot?.summary?.district || "No field record";
      slotEl.querySelector("[data-slot-progress]").textContent = snapshot
        ? `${snapshot.summary?.bosses || "0/7"} bosses · ${snapshot.summary?.breach || "Signal quiet"} · Vitality ${snapshot.summary?.vitality || "—"}`
        : "Awaiting deployment state";
      slotEl.querySelector("[data-slot-time]").textContent = snapshot
        ? `${formatSavedAt(snapshot.timestamp)} · ${formatClock(snapshot.summary?.elapsed)}` : "—";
      const load = slotEl.querySelector('[data-save-action="load"]');
      const clear = slotEl.querySelector('[data-save-action="clear"]');
      const write = slotEl.querySelector('[data-save-action="save"]');
      if (load) load.disabled = !snapshot;
      if (clear) {
        clear.disabled = !snapshot;
        clear.textContent = (clearedUntil.get(`clear:${index}`) || 0) > performance.now()
          ? "CONFIRM CLEAR" : "CLEAR";
      }
      if (write) {
        write.disabled = !save?.canSave?.();
        const overwriteArmed = (clearedUntil.get(`overwrite:${index}`) || 0) > performance.now();
        write.textContent = snapshot
          ? (overwriteArmed ? "CONFIRM OVERWRITE" : "OVERWRITE") : "SAVE";
      }
    });
    const reason = root.querySelector("[data-save-reason]");
    if (reason) {
      const ready = !!save?.canSave?.();
      reason.dataset.ready = ready ? "1" : "0";
      reason.textContent = ready
        ? "FIELD STATE STABLE · MANUAL SAVE AVAILABLE"
        : save?.saveReason?.() || "FIELD SAVE CURRENTLY UNAVAILABLE";
    }
  }

  function setMenuInert(value) {
    const touchHost = touch?.host || stage.querySelector("#sf-touch");
    if (value) {
      menu.ariaRestore = {
        canvas: canvas.getAttribute("aria-hidden"),
        touch: touchHost?.getAttribute("aria-hidden") ?? null,
      };
      canvas.inert = true;
      canvas.setAttribute("aria-hidden", "true");
      if (touchHost) {
        touchHost.inert = true;
        touchHost.setAttribute("aria-hidden", "true");
      }
      return;
    }
    canvas.inert = false;
    if (menu.ariaRestore?.canvas === null) canvas.removeAttribute("aria-hidden");
    else canvas.setAttribute("aria-hidden", menu.ariaRestore?.canvas || "false");
    if (touchHost) {
      touchHost.inert = false;
      if (menu.ariaRestore?.touch === null) touchHost.removeAttribute("aria-hidden");
      else touchHost.setAttribute("aria-hidden", menu.ariaRestore?.touch || "false");
    }
    menu.ariaRestore = null;
  }

  function openMenu(panel = "operation", { force = false } = {}) {
    if (destroyed) return false;
    if (menu.open) { setPanel(panel); return true; }
    if (!force && (ctx.runtime?.phase !== "playing" || ctx.intro?.isBlocking?.())) return false;
    cancelWheel("menu");
    menu.open = true;
    menu.lastFocus = document.activeElement;
    const openedFromTouchMenu = menu.lastFocus?.matches?.(".sf-menu-trigger--mobile");
    menu.returnToPointerLock = !openedFromTouchMenu && (document.pointerLockElement === canvas
      || document.activeElement === canvas || document.documentElement.classList.contains("sf-maximised"));
    menuEl.hidden = false;
    menuEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("rb-escape-menu-open");
    ctx.player?.input?.clearAll?.();
    touch?.releaseAll?.();
    setMenuInert(true);
    intentionalPointerUnlockUntil = performance.now() + 500;
    if (document.pointerLockElement) document.exitPointerLock?.();
    refreshOperation();
    refreshSaves();
    applySettings();
    syncMaximizeButton();
    setPanel(panel);
    if (focusRaf) cancelAnimationFrame(focusRaf);
    focusRaf = requestAnimationFrame(() => {
      focusRaf = 0;
      if (!destroyed && menu.open) {
        const focusTarget = !root.querySelector("[data-mission-wrap]")?.hidden
          ? root.querySelector('[data-menu-action="mission-record"]')
          : root.querySelector("[data-menu-close]");
        focusTarget?.focus();
      }
    });
    menuSfx("open");
    announce("Field menu open. Operation paused.");
    return true;
  }

  function closeMenu({ requestLock = false } = {}) {
    if (destroyed || !menu.open) return false;
    menuSfx("close");
    menu.open = false;
    menu.restartUntil = 0;
    hideAbilityPopover({ force: true });
    const restart = root.querySelector('[data-menu-action="restart"]');
    if (restart) restart.textContent = "RESTART OPERATION";
    menuEl.hidden = true;
    menuEl.setAttribute("aria-hidden", "true");
    capture = null;
    bindKeyUpGuard.clear();
    document.body.classList.remove("rb-escape-menu-open");
    setMenuInert(false);
    ctx.player?.input?.clearAll?.();
    announce("Operation resumed");
    const shouldRequestLock = requestLock && menu.returnToPointerLock;
    if (shouldRequestLock && canvas.requestPointerLock) {
      try {
        const lock = canvas.requestPointerLock();
        lock?.catch?.(() => false);
      } catch (_) { /* browser policy */ }
    } else if (menu.lastFocus?.isConnected) {
      menu.lastFocus.focus?.({ preventScroll: true });
    }
    menu.lastFocus = null;
    menu.returnToPointerLock = false;
    careerRecovery.armedChoice = null;
    careerRecovery.armedUntil = 0;
    careerRecovery.errorMessage = "";
    if (!careerRecovery.resolving) careerRecovery.resolvedMessage = "";
    intentionalPointerUnlockUntil = 0;
    if (isMaximized()) {
      void lockEscapeInFullscreen();
    }
    return true;
  }

  function openMap() {
    if (destroyed) return false;
    if (menu.open) {
      if (menu.panel === "map") return closeMenu({ requestLock: true });
      setPanel("map");
      return true;
    }
    return openMenu("map");
  }

  function focusableMenuItems() {
    return Array.from(menuEl.querySelectorAll('button:not([disabled]), [href], select, input, [tabindex]:not([tabindex="-1"])'))
      .filter((element) => {
        if (element.disabled || element.inert || element.closest("[hidden], [inert]")) return false;
        if (!element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden"
          && Number(style.opacity) !== 0;
      });
  }

  function trapFocus(event) {
    const items = focusableMenuItems();
    if (!items.length) { event.preventDefault(); menuEl.focus?.(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    const index = items.indexOf(current);
    if (index < 0) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && index === 0) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && index === items.length - 1) {
      event.preventDefault(); first.focus();
    }
  }

  function handleSaveAction(button) {
    const slotEl = button.closest(".sf-save-slot");
    const kind = slotEl.dataset.saveKind;
    const index = Number(slotEl.dataset.saveIndex);
    const action = button.dataset.saveAction;
    const record = kind === "autosave" ? saveData.autosave : saveData.manuals?.[index];
    let ok = false;
    if (action === "save") {
      const key = `overwrite:${index}`;
      if (record?.snapshot && (clearedUntil.get(key) || 0) < performance.now()) {
        clearedUntil.set(key, performance.now() + 4000);
        button.textContent = "CONFIRM OVERWRITE";
        menuSfx("question");
        announce(`Press overwrite again to replace field slot ${index + 1}`);
        scheduleUiTimeout(() => {
          if ((clearedUntil.get(key) || 0) <= performance.now()) {
            clearedUntil.delete(key);
            if (menu.open && menu.panel === "saves") refreshSaves();
          }
        }, 4100);
        return;
      }
      clearedUntil.delete(key);
      ok = !!save?.saveManual?.(index);
    }
    else if (action === "load") ok = !!save?.load?.(kind, index);
    else if (action === "clear") {
      const key = `clear:${index}`;
      if ((clearedUntil.get(key) || 0) < performance.now()) {
        clearedUntil.set(key, performance.now() + 4000);
        button.textContent = "CONFIRM CLEAR";
        menuSfx("question");
        scheduleUiTimeout(() => {
          if ((clearedUntil.get(key) || 0) <= performance.now()) {
            clearedUntil.delete(key);
            if (menu.open && menu.panel === "saves") refreshSaves();
          }
        }, 4100);
        return;
      }
      ok = !!save?.clearManual?.(index);
      clearedUntil.delete(key);
    }
    refreshSaves();
    menuSfx(ok ? "confirm" : "error");
    announce(ok ? (action === "load" ? "Field state restored" : "Field record updated") : "Field record action unavailable");
    if (ok && action === "load") closeMenu({ requestLock: true });
  }

  async function handleCareerRecovery(button) {
    const choice = button.dataset.careerChoice;
    if (!["local", "synced"].includes(choice) || careerRecovery.resolving) return false;
    const conflict = readCareerConflict();
    const branch = conflict?.branches?.[choice];
    if (!conflict?.active || !branch || branch.available === false || branch.valid === false) {
      careerRecovery.errorMessage = "That career record is unavailable and cannot be selected.";
      refreshCareerRecovery();
      menuSfx("error");
      announce(careerRecovery.errorMessage);
      return false;
    }

    if (careerRecovery.armedChoice !== choice || careerRecovery.armedUntil <= performance.now()) {
      careerRecovery.armedChoice = choice;
      careerRecovery.armedUntil = performance.now() + 8000;
      careerRecovery.errorMessage = "";
      refreshCareerRecovery();
      menuSfx("question");
      const prompt = `${choice === "local" ? "This device" : "Synced career"} selected. Press confirm to make it authoritative.`;
      announce(prompt);
      scheduleUiTimeout(() => {
        if (careerRecovery.armedChoice === choice
          && careerRecovery.armedUntil <= performance.now()) {
          careerRecovery.armedChoice = null;
          careerRecovery.armedUntil = 0;
          refreshCareerRecovery();
        }
      }, 8100);
      return true;
    }

    if (typeof save?.resolveCareerConflict !== "function") {
      careerRecovery.errorMessage = "Career recovery is temporarily unavailable. Both records remain preserved.";
      careerRecovery.armedChoice = null;
      careerRecovery.armedUntil = 0;
      refreshCareerRecovery();
      menuSfx("error");
      announce(careerRecovery.errorMessage);
      return false;
    }

    careerRecovery.resolving = true;
    careerRecovery.errorMessage = "";
    refreshCareerRecovery();
    announce(`Recovering the ${choice === "local" ? "device" : "synced"} career.`);
    let result = null;
    try {
      result = await Promise.resolve(save.resolveCareerConflict(choice));
    } catch (error) {
      result = { ok: false, message: error?.message || "Career recovery failed." };
    }
    careerRecovery.resolving = false;
    careerRecovery.armedChoice = null;
    careerRecovery.armedUntil = 0;
    const resolved = result?.ok === true && !readCareerConflict()?.active;
    if (resolved) {
      careerRecovery.resolvedMessage = result.message
        || `${choice === "local" ? "This device" : "The synced career"} is now authoritative. Automatic career saving resumed.`;
      careerRecovery.errorMessage = "";
      refreshSaves();
      refreshDoctrine();
      menuSfx("confirm");
      announce(careerRecovery.resolvedMessage);
      requestAnimationFrame(() => {
        if (!destroyed && menu.open && menu.panel === "saves") {
          root.querySelector("[data-career-recovery]")?.focus?.({ preventScroll: true });
        }
      });
      return true;
    }

    careerRecovery.resolvedMessage = "";
    careerRecovery.errorMessage = result?.message
      || "Career recovery could not be completed. Both records remain preserved.";
    refreshCareerRecovery();
    menuSfx("error");
    announce(careerRecovery.errorMessage);
    requestAnimationFrame(() => {
      if (!destroyed && menu.open && menu.panel === "saves") {
        root.querySelector(`[data-career-choice="${choice}"]`)?.focus?.({ preventScroll: true });
      }
    });
    return false;
  }

  function finishDoctrineMutation(result, fallbackMessage, focusSelector = null,
    focusFallbackSelector = null) {
    const normalized = result && typeof result === "object"
      ? result : { ok: result !== false, message: fallbackMessage };
    const ok = normalized.ok !== false;
    refreshDoctrine(normalized.state || null);
    focusAfterDoctrineRefresh(focusSelector, focusFallbackSelector);
    menuSfx(ok ? "confirm" : "error");
    announce(normalized.message || fallbackMessage || (ok ? "Doctrine updated." : "Doctrine action unavailable."));
    return ok;
  }

  function callDoctrine(method, args, fallbackMessage, focusSelector,
    focusFallbackSelector = null) {
    if (typeof progression?.[method] !== "function") {
      return finishDoctrineMutation({ ok: false,
        message: "Doctrine service is unavailable." }, fallbackMessage, focusSelector,
      focusFallbackSelector);
    }
    try {
      return finishDoctrineMutation(progression[method](...args), fallbackMessage,
        focusSelector, focusFallbackSelector);
    } catch (error) {
      return finishDoctrineMutation({ ok: false,
        message: error?.message || "Doctrine action failed." }, fallbackMessage,
      focusSelector, focusFallbackSelector);
    }
  }

  function handleDoctrineAction(button) {
    const action = button.dataset.doctrineAction;
    const talentId = button.dataset.talentId;
    const talentFocusSurface = talentId
      ? button.closest("[data-doctrine-preview]")
        ? "[data-doctrine-preview]"
        : `[data-doctrine-talent][data-talent-id="${CSS.escape(talentId)}"]`
      : "";
    const spendFocusTarget = talentId
      ? `${talentFocusSurface} [data-talent-action="spend"]:not(:disabled), `
        + `${talentFocusSurface} [data-talent-action="refund"]:not(:disabled)`
      : "";
    const refundFocusTarget = talentId
      ? `${talentFocusSurface} [data-talent-action="refund"]:not(:disabled), `
        + `${talentFocusSurface} [data-talent-action="spend"]:not(:disabled)`
      : "";
    if (action === "inspect" && talentId) {
      const orderDefinition = progressionDefinitions().orders
        .find((entry) => entry.id === doctrine.orderId);
      const isRankedTalent = !!orderDefinition?.talents?.some((talent) => talent.id === talentId);
      if (!stage.classList.contains("sf-touch-enabled") && isRankedTalent) {
        doctrine.inspectedTalentId = null;
        setDoctrinePreview(talentId);
        menuSfx("switch");
        announce(`${button.closest("[data-doctrine-talent]")?.querySelector("strong")?.textContent || "Rite"} details shown.`);
        return true;
      }
      doctrine.inspectedTalentId = doctrine.inspectedTalentId === talentId ? null : talentId;
      doctrine.previewTalentId = talentId;
      refreshDoctrine();
      const panel = root.querySelector("[data-doctrine-order-panel]");
      if (panel) panel.scrollTop = 0;
      focusAfterDoctrineRefresh(`[data-talent-action="inspect"][data-talent-id="${CSS.escape(talentId)}"]`);
      menuSfx("switch");
      return true;
    }
    if (action === "spend" && talentId) {
      return callDoctrine("spend", [talentId], "Rite inscribed.",
        spendFocusTarget, talentFocusSurface);
    }
    if (action === "refund" && talentId) {
      return callDoctrine("refund", [talentId], "Rite refunded.",
        refundFocusTarget, talentFocusSurface);
    }
    if (action === "vow") {
      const capstoneId = button.dataset.capstoneId;
      const slot = Number(button.dataset.capstoneSlot);
      /* The Vow control lives in the inspector on desktop and inside the crown
         card on touch. Restore focus to the surface the press came from - the
         other copy is display:none there and cannot take focus. */
      const vowSurface = button.closest("[data-doctrine-preview]")
        ? "[data-doctrine-preview]"
        : `[data-capstone-id="${CSS.escape(capstoneId)}"]`;
      const vowFocus = `${vowSurface} [data-doctrine-action="vow"]`;
      if (button.dataset.capstoneAction === "unequip") {
        return callDoctrine("unequipCapstone", [slot], "Capstone Vow unbound.",
          vowFocus, "[data-doctrine-preview]");
      }
      return callDoctrine("equipCapstone", [capstoneId, slot], "Capstone Vow bound.",
        vowFocus, "[data-doctrine-preview]");
    }
    if (action === "respec") {
      const edit = editState(doctrine.latestState);
      if (!edit.allowed) {
        doctrine.respecUntil = 0;
        showRespecWarn(edit.reason);
        focusAfterDoctrineRefresh("[data-talent-respec]");
        return true;
      }
      hideRespecWarn();
      if (doctrine.respecUntil <= performance.now()) {
        doctrine.respecUntil = performance.now() + 4500;
        refreshDoctrine();
        focusAfterDoctrineRefresh("[data-talent-respec]");
        menuSfx("question");
        announce("Press reset doctrine again to confirm.");
        scheduleUiTimeout(() => {
          if (doctrine.respecUntil && doctrine.respecUntil <= performance.now()) {
            doctrine.respecUntil = 0;
            if (menu.open && menu.panel === "doctrine") refreshDoctrine();
          }
        }, 4600);
        return true;
      }
      doctrine.respecUntil = 0;
      return callDoctrine("respec", [], "Doctrine reset.", "[data-talent-respec]");
    }
    return false;
  }

  root.addEventListener("click", (event) => {
    if (menu.panel === "doctrine") {
      const abilityLink = event.target instanceof Element ? event.target.closest(".sf-ability-link") : null;
      if (abilityLink) {
        event.preventDefault();
        event.stopPropagation();
        if (pinnedAbilityLink === abilityLink) {
          hideAbilityPopover({ force: true });
        } else {
          hideAbilityPopover({ force: true });
          showAbilityPopover(abilityLink, true);
        }
        return;
      }
      if (pinnedAbilityLink && !(event.target instanceof Element && event.target.closest("#sf-ability-popover"))) {
        hideAbilityPopover({ force: true });
      }
      const node = doctrineNodeFrom(event.target);
      if (node && !event.target.closest("button, a, .sf-ability-link") && setDoctrinePreview(node)) {
        menuSfx("switch");
        return;
      }
    }
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("[data-menu-open]")) { openMenu("operation"); return; }
    if (target.matches("[data-menu-close]")) { closeMenu({ requestLock: true }); return; }
    if (target.matches("[data-menu-panel]")) { setPanel(target.dataset.menuPanel); return; }
    if (target.matches("[data-doctrine-order]")) {
      selectDoctrineOrder(target.dataset.doctrineOrder, { focus: true }); return;
    }
    if (target.matches("[data-doctrine-action]")) { handleDoctrineAction(target); return; }
    if (target.matches("[data-career-recovery-action]")) { void handleCareerRecovery(target); return; }
    if (target.matches("[data-save-action]")) { handleSaveAction(target); return; }
    if (target.matches("[data-death-action]")) { handleDeathAction(target); return; }
    if (target.matches("[data-wheel-cancel]")) { cancelWheel("center"); return; }
    if (target.matches(".sf-command-wheel__option")) {
      setWheelSelection(Number(target.dataset.index));
      closeWheel({ confirm: true, reason: "pointer" });
      return;
    }
    if (target.matches("[data-bind-key]") || target.matches(".sf-bind-key")) {
      beginCapture(target.dataset.bindAction, Number(target.dataset.bindSlot));
      return;
    }
    if (target.matches("[data-bind-reset]")) {
      capture = null;
      bindKeyUpGuard.clear();
      resetKeybinds();
      renderKeybinds("Default controls restored.");
      menuSfx("confirm");
      announce("Default controls restored");
      return;
    }
    if (capture) cancelCapture("Rebind cancelled.");
    if (target.matches('[data-setting="sound"]')) { toggleAudio(); return; }
    if (target.matches('[data-setting="reduced-motion"]')) {
      settings.reducedMotion = !settings.reducedMotion;
      writeSettings(settings); applySettings(); menuSfx("toggle"); return;
    }
    if (target.matches('[data-setting="high-contrast"]')) {
      settings.highContrast = !settings.highContrast;
      writeSettings(settings); applySettings(); menuSfx("toggle"); return;
    }
    if (target.matches('[data-setting="dynamic-res"]')) {
      settings.dynamicRes = !settings.dynamicRes;
      /* Applied on the CLICK, not in applySettings: applySettings runs
         on every menu refresh, and a `?dynres=0` session override must
         survive those. An explicit press still wins over the URL. */
      render?.setAutoScale?.(settings.dynamicRes);
      writeSettings(settings); applySettings(); menuSfx("toggle"); return;
    }
    if (target.matches("[data-hud-scale]")) {
      settings.hudScale = target.dataset.hudScale === "large" ? "large" : "standard";
      writeSettings(settings); applySettings(); menuSfx("toggle"); return;
    }
    if (target.matches("[data-quality]")) {
      const before = activeQuality();
      const next = applyQuality(target.dataset.quality);
      menuSfx("toggle");
      if (next !== before) announce(`Graphics quality ${qualityLabel(next).toLowerCase()}`);
      return;
    }
    if (target.matches("[data-difficulty]")) {
      const before = activeDifficulty();
      const next = applyDifficulty(target.dataset.difficulty);
      menuSfx("toggle");
      if (next !== before) announce(`Difficulty ${difficultyLabel(next).toLowerCase()}`);
      return;
    }
    if (target.matches('[data-menu-action="maximize"]')) { toggleMaximized(); return; }
    if (target.matches('[data-menu-action="leaderboard"]')) {
      const leaderboard = document.querySelector("[data-rb-leaderboard]");
      const toggle = document.querySelector(".rb-standalone-leaderboard-btn");
      if (toggle) {
        closeMenu({ requestLock: false });
        toggle.click();
        toggle.focus?.({ preventScroll: true });
      } else if (leaderboard) {
        closeMenu({ requestLock: false });
        if (isMaximized()) setMaximized(false);
        leaderboard.scrollIntoView?.({ behavior: "auto", block: "center" });
        leaderboard.querySelector?.("h2, h3")?.focus?.({ preventScroll: true });
      } else {
        announce("High scores are unavailable in this view");
      }
      return;
    }
    if (target.matches('[data-menu-action="mission-record"]')) {
      menu.victoryWrapSeen = true;
      refreshOperation();
      menuSfx("confirm");
      announce("Mission record opened.");
      requestAnimationFrame(() => {
        if (!destroyed && menu.open) root.querySelector("#sf-debrief-title")?.focus?.({ preventScroll: true });
      });
      return;
    }
    if (target.matches('[data-menu-action="unstuck"]') || target.matches('[data-setting-action="unstuck"]')) {
      ctx.player?.unstuck?.("menu");
      menuSfx("confirm");
      closeMenu({ requestLock: true });
      announce("Position recovered");
      return;
    }
    if (target.matches('[data-menu-action="restart"]')) {
      if (menu.restartUntil > performance.now()) { window.location.reload(); return; }
      menu.restartUntil = performance.now() + 4500;
      target.textContent = "CONFIRM RESTART";
      menuSfx("question");
      announce("Press restart again to confirm");
      scheduleUiTimeout(() => {
        if (menu.restartUntil && menu.restartUntil <= performance.now()) {
          menu.restartUntil = 0;
          const restart = root.querySelector('[data-menu-action="restart"]');
          if (restart) restart.textContent = "RESTART OPERATION";
        }
      }, 4600);
      return;
    }
    if (target.matches('[data-menu-action="return"]')) window.location.assign("../games.html");
  });

  function onSettingRangeInput(event) {
    const target = event.target;
    if (!target || !target.matches("[data-setting-range]")) return;
    const name = target.dataset.settingRange;
    const val = clamp(Number(target.value) / 100, 0, 1);
    if (name === "masterVolume" || name === "musicVolume" || name === "sfxVolume") {
      settings[name] = val;
      writeSettings(settings);
      if (name === "masterVolume") ctx.audio?.setMasterVolume?.(val);
      else if (name === "musicVolume") ctx.audio?.setMusicVolume?.(val);
      else if (name === "sfxVolume") ctx.audio?.setSfxVolume?.(val);
      const display = root.querySelector(`[data-vol-display="${name}"]`);
      if (display) display.textContent = `${Math.round(val * 100)}%`;
    }
  }
  root.addEventListener("input", onSettingRangeInput);
  root.addEventListener("change", onSettingRangeInput);

  root.addEventListener("pointermove", (event) => {
    if (menu.panel !== "doctrine") return;
    const card = event.target instanceof Element
      ? event.target.closest("[data-doctrine-talent]") : null;
    if (!card) {
      doctrine.hoverTalentId = null;
      return;
    }
    if (card.dataset.talentId === doctrine.hoverTalentId) return;
    doctrine.hoverTalentId = card.dataset.talentId;
  });

  root.addEventListener("pointerover", (event) => {
    if (menu.panel !== "doctrine") return;
    const link = event.target instanceof Element ? event.target.closest(".sf-ability-link") : null;
    if (link) {
      showAbilityPopover(link, false);
    }
  });

  root.addEventListener("pointerout", (event) => {
    if (menu.panel !== "doctrine") return;
    const link = event.target instanceof Element ? event.target.closest(".sf-ability-link") : null;
    if (link) {
      const next = event.relatedTarget instanceof Element
        ? event.relatedTarget.closest(".sf-ability-link, #sf-ability-popover") : null;
      if (!next) hideAbilityPopover();
    }
  });

  root.addEventListener("focusin", (event) => {
    if (menu.panel !== "doctrine") return;
    const link = event.target instanceof Element ? event.target.closest(".sf-ability-link") : null;
    if (link) {
      showAbilityPopover(link, false);
      return;
    }
    const node = doctrineNodeFrom(event.target);
    if (node) setDoctrinePreview(node);
  });

  root.addEventListener("focusout", (event) => {
    if (menu.panel !== "doctrine") return;
    const link = event.target instanceof Element ? event.target.closest(".sf-ability-link") : null;
    if (link) {
      hideAbilityPopover();
    }
  });

  root.addEventListener("scroll", () => {
    if (menu.panel === "doctrine") {
      hideAbilityPopover({ force: true });
    }
  }, { capture: true, passive: true });

  commandEls.forEach((button) => {
    button.addEventListener("pointerenter", () => {
      if (wheel.open) setWheelSelection(Number(button.dataset.index));
    });
  });

  function onKeyDown(event) {
    /* FIRST, BEFORE ANYTHING READS THE KEY. This handler is registered
       in the capture phase on window, so stopping propagation here also
       stops player.js's listener - which is the point: the key being
       assigned must not also fire the action it is being assigned to. */
    if (capture && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      captureKey(event);
      return;
    }
    if (capture) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (menu.open) {
      const interactiveTarget = event.target instanceof Element
        && !!event.target.closest("button, a, input, select, textarea, .sf-ability-link,"
          + " [role='button'], [role='switch'], [role='tab']");
      const abilityLink = event.target instanceof Element
        ? event.target.closest(".sf-ability-link") : null;
      if (abilityLink && ["Enter", "Space"].includes(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pinnedAbilityLink === abilityLink) {
          hideAbilityPopover({ force: true });
        } else {
          hideAbilityPopover({ force: true });
          showAbilityPopover(abilityLink, true);
        }
        return;
      }
      const doctrineTab = event.target instanceof Element
        ? event.target.closest("[data-doctrine-order][role='tab']") : null;
      const doctrineCard = event.target instanceof Element
        ? event.target.closest("[data-doctrine-talent],[data-doctrine-vow]") : null;
      if (doctrineCard && event.target === doctrineCard && ["Enter", "Space"].includes(event.code)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat && setDoctrinePreview(doctrineNodeFrom(doctrineCard))) {
          requestAnimationFrame(() => {
            const primary = root.querySelector(
              '[data-doctrine-preview] [data-talent-action="spend"]:not(:disabled),'
              + ' [data-doctrine-preview] [data-talent-action="refund"]:not(:disabled),'
              + " [data-doctrine-preview] button:not(:disabled)"
            );
            (primary || root.querySelector("[data-doctrine-preview]"))
              ?.focus?.({ preventScroll: true });
          });
        }
      } else if (doctrineTab && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.code)) {
        const tabs = Array.from(root.querySelectorAll("[data-doctrine-order][role='tab']"));
        const current = tabs.indexOf(doctrineTab);
        let next = current;
        if (event.code === "Home") next = 0;
        else if (event.code === "End") next = tabs.length - 1;
        else if (["ArrowLeft", "ArrowUp"].includes(event.code)) next = (current - 1 + tabs.length) % tabs.length;
        else next = (current + 1) % tabs.length;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat && tabs[next]) selectDoctrineOrder(tabs[next].dataset.doctrineOrder, { focus: true });
      } else if (keybindMatches("map", event.code)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) openMap();
      } else if (event.code === "Escape" || keybindMatches("menu", event.code)) {
        if (event.code === "Escape") {
          if (event.repeat) {
            event.preventDefault(); event.stopImmediatePropagation();
            return;
          }
          if (performance.now() < ignoreEscapeMenuToggleUntil) {
            event.preventDefault(); event.stopImmediatePropagation();
            return;
          }
          const now = performance.now();
          const elapsed = now - lastEscapePressTime;
          const isDoubleTap = elapsed <= DOUBLE_TAP_WINDOW_MS && elapsed >= 60;
          if (isDoubleTap && isMaximized()) {
            event.preventDefault(); event.stopImmediatePropagation();
            lastEscapePressTime = 0;
            setMaximized(false);
            announce("Embedded view restored");
            return;
          }
          lastEscapePressTime = now;
        }
        if (pinnedAbilityLink || root.querySelector("#sf-ability-popover.is-visible")) {
          event.preventDefault(); event.stopImmediatePropagation();
          hideAbilityPopover({ force: true });
          return;
        }
        event.preventDefault(); event.stopImmediatePropagation();
        closeMenu({ requestLock: true });
      } else if (!interactiveTarget && isGameplayBind(event.code)) {
        /* Anything BOUND to a field action is swallowed while the menu
           is up, so a rebind cannot hand the page a key that walks the
           trooper behind an open panel. */
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (wheel.open) {
      if (event.code === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); cancelWheel("escape"); return;
      }
      if (keybindMatches("wheel", event.code)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (keybindMatches("menu", event.code)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) {
          cancelWheel("menu");
          openMenu("operation", { force: true });
        }
        return;
      }
      /* Keyboard directions address the wheel's visible sectors directly;
         they are not next/previous controls. Down shares the lower-right
         Cluster sector, the deterministic side of the bottom boundary. */
      const directionIndex = wheelDirectionFor(event.code);
      if (Number.isInteger(directionIndex)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) setWheelSelection(Math.min(directionIndex, order.length - 1));
        return;
      }
      if (/^Digit[1-3]$/.test(event.code)) {
        event.preventDefault(); event.stopImmediatePropagation(); setWheelSelection(Number(event.code.slice(-1)) - 1);
      }
      return;
    }
    if (event.code === "Escape") {
      if (event.repeat) {
        event.preventDefault(); event.stopImmediatePropagation();
        return;
      }
      if (performance.now() < ignoreEscapeMenuToggleUntil) {
        event.preventDefault(); event.stopImmediatePropagation();
        return;
      }
      const now = performance.now();
      const elapsed = now - lastEscapePressTime;
      const isDoubleTap = elapsed <= DOUBLE_TAP_WINDOW_MS && elapsed >= 60;
      if (isDoubleTap && isMaximized()) {
        event.preventDefault(); event.stopImmediatePropagation();
        lastEscapePressTime = 0;
        setMaximized(false);
        openMenu("operation", { force: true });
        announce("Embedded view restored");
        return;
      }
      lastEscapePressTime = now;
      if (openMenu("operation", { force: true })) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (keybindMatches("map", event.code)) {
      if (!ownsGameKeyboard()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) openMap();
      return;
    }
    if (keybindMatches("menu", event.code)) {
      if (!ownsGameKeyboard()) return;
      if (openMenu("operation", { force: true })) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (keybindMatches("wheel", event.code)) {
      if (!ownsGameKeyboard()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) openWheel("keyboard");
    }
  }

  function onKeyUp(event) {
    /* The keyup of the key just assigned belongs to the editor too;
       letting it through hands player.js a release for a press it
       never saw, which is how a bound Shift arrives stuck-on. */
    if (capture || bindKeyUpGuard.delete(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
      return;
    }
    if (menu.open) {
      if (event.code === "Escape" || keybindMatches("menu", event.code)
        || keybindMatches("wheel", event.code) || keybindMatches("block", event.code)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      return;
    }
    if (keybindMatches("wheel", event.code) && wheel.open && wheel.source === "keyboard") {
      event.preventDefault(); event.stopImmediatePropagation();
      cancelWheel("hold-release");
    }
  }

  function onMouseMove(event) {
    if (!wheel.open || wheel.source !== "keyboard") return;
    event.stopImmediatePropagation();
    if (document.pointerLockElement === canvas) {
      selectFromVector(wheel.x + event.movementX, wheel.y + event.movementY);
    } else {
      const rect = dialEl.getBoundingClientRect();
      selectFromVector(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
    }
  }

  function onMouseDown(event) {
    if (!wheel.open || wheel.source !== "keyboard") return;
    if (event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
      const cancelTarget = event.target instanceof Element && event.target.closest("[data-wheel-cancel]");
      if (cancelTarget) {
        cancelWheel("center");
        return;
      }
      const optionTarget = event.target instanceof Element && event.target.closest(".sf-command-wheel__option");
      if (optionTarget) {
        setWheelSelection(Number(optionTarget.dataset.index));
        closeWheel({ confirm: true, reason: "pointer-click" });
        return;
      }
      if (wheel.selectedIndex >= 0) {
        closeWheel({ confirm: true, reason: "pointer-click" });
      } else {
        cancelWheel("center");
      }
    }
  }

  function onMouseClick(event) {
    if (wheel.open && wheel.source === "keyboard" && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }

  function onMouseUp(event) {
    if (wheel.open && wheel.source === "keyboard" && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }

  function attachTouchCommand(button) {
    if (destroyed || touchBindings.has(button)) return;
    button.dataset.sfCommandBound = "true";
    const onTouchCommandDown = (event) => {
      if (!openWheel("touch", { pointerId: event.pointerId, x: event.clientX, y: event.clientY })) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { button.setPointerCapture(event.pointerId); } catch (_) { /* best effort */ }
    };
    const onTouchCommandKeyDown = (event) => {
      if (event.repeat || !["Enter", "Space"].includes(event.code)) return;
      event.preventDefault();
      if (openWheel("touch-keyboard")) setWheelSelection(0);
    };
    const onTouchCommandKeyUp = (event) => {
      if (!["Enter", "Space"].includes(event.code) || !wheel.open || wheel.source !== "touch-keyboard") return;
      event.preventDefault(); closeWheel({ confirm: true, reason: "touch-keyboard" });
    };
    touchBindings.set(button, {
      pointerdown: onTouchCommandDown,
      keydown: onTouchCommandKeyDown,
      keyup: onTouchCommandKeyUp,
    });
    button.addEventListener("pointerdown", onTouchCommandDown, { passive: false });
    button.addEventListener("keydown", onTouchCommandKeyDown);
    button.addEventListener("keyup", onTouchCommandKeyUp);
  }

  function detachTouchCommands() {
    for (const [button, binding] of touchBindings) {
      button.removeEventListener("pointerdown", binding.pointerdown);
      button.removeEventListener("keydown", binding.keydown);
      button.removeEventListener("keyup", binding.keyup);
      delete button.dataset.sfCommandBound;
    }
    touchBindings.clear();
  }

  stage.querySelectorAll("[data-touch-command]").forEach(attachTouchCommand);
  const touchObserver = new MutationObserver(() => {
    stage.querySelectorAll("[data-touch-command]").forEach(attachTouchCommand);
  });
  touchObserver.observe(stage, { childList: true, subtree: true });

  function onPointerMove(event) {
    if (!wheel.open || wheel.source !== "touch" || event.pointerId !== wheel.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    selectFromVector(event.clientX - wheel.touchOrigin.x, event.clientY - wheel.touchOrigin.y);
  }

  function onPointerEnd(event) {
    if (!wheel.open || wheel.source !== "touch" || event.pointerId !== wheel.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    closeWheel({ confirm: event.type === "pointerup" && wheel.selectedIndex >= 0, reason: event.type });
  }

  function onWindowBlur() { cancelWheel("blur"); }
  function onVisibilityChange() {
    if (document.hidden) cancelWheel("visibility");
  }
  function onPointerLockChange() {
    const isLocked = document.pointerLockElement === canvas;
    const lostLock = wasPointerLocked && !isLocked;
    wasPointerLocked = isLocked;

    if (wheel.open && wheel.openedLocked && !isLocked) {
      cancelWheel("pointer-lock");
    }

    if (
      lostLock
      && performance.now() >= intentionalPointerUnlockUntil
      && !menu.open
      && !destroyed
      && ctx.runtime?.phase === "playing"
      && !ctx.intro?.isBlocking?.()
    ) {
      lastEscapePressTime = performance.now();
      ignoreEscapeMenuToggleUntil = performance.now() + 150;
      openMenu("operation", { force: true });
    }
  }
  function onSfxMuted() {
    if (destroyed) return;
    ctx.audio?.setEnabled?.(audioEnabled());
    applySettings();
  }

  function canOpenCareerRecovery() {
    if (destroyed || ctx.runtime?.phase !== "playing" || ctx.intro?.isBlocking?.()
      || ctx.combat?.player?.dead) return false;
    const breachPhase = ctx.breaches?.status?.()?.phase;
    if (["warning", "active"].includes(breachPhase)) return false;
    return !ctx.player?.action && !ctx.boost?.state?.active && !ctx.slam?.state?.active
      && !ctx.shield?.state?.active && !ctx.jetpack?.state?.inFlight;
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("click", onMouseClick, true);
  window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  window.addEventListener("pointerup", onPointerEnd, { capture: true, passive: false });
  window.addEventListener("pointercancel", onPointerEnd, { capture: true, passive: false });
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  document.addEventListener("rainbot:sfx-muted", onSfxMuted);

  const stopWon = ctx.mission.bus?.on?.("won", () => {
    menu.victoryWrapSeen = false;
    scheduleUiTimeout(() => openMenu("operation", { force: true }), 900);
  });
  const stopLost = ctx.mission.bus?.on?.("lost", () => {
    scheduleUiTimeout(() => openMenu("operation", { force: true }), 900);
  });

  const stopSave = save?.onChange?.((result) => {
    refreshSaves();
    if (result?.type === "autosaved" || result?.type === "autosave-deferred") {
      showAutosaveToast(result);
    }
    if (result?.type === "career-conflict" && readCareerConflict()?.active) {
      let revealed = false;
      if (menu.open) { setPanel("saves"); revealed = true; }
      else if (canOpenCareerRecovery()) revealed = openMenu("saves");
      else announce("Doctrine career sync needs review. Open Save and Load when the field is quiet.");
      if (revealed) requestAnimationFrame(() => {
        if (!destroyed && menu.open && menu.panel === "saves") {
          root.querySelector("[data-career-recovery]")?.focus?.({ preventScroll: true });
        }
      });
    }
    if (result?.message) announce(result.message);
  });
  const stopProgression = progression?.onChange?.((result) => {
    const state = result?.state || (result?.rank !== undefined ? result : null);
    if (menu.open && menu.panel === "doctrine") refreshDoctrine(state);
    if (result?.message) announce(result.message);
  });
  const stopCampaignScore = ctx.campaignScore?.onChange?.(() => refreshOperation());

  function update(dt = 0) {
    if (destroyed) return;
    updateClock += Math.max(0, Number(dt) || 0);
    if (wheel.open && (ctx.combat?.player?.dead || menu.open || document.hidden)) {
      cancelWheel(ctx.combat?.player?.dead ? "death" : "unavailable");
    }
    /* The death screen rides SIM time, not a wall-clock timer: the
       fall plays first, and combat's respawnIn - which now only runs
       down, never respawns - is the presentation clock it was always
       authored against. 0.8 remaining is 2.6s into the 3.4s fall.
       Sim-time means harnesses that advanceTime() see the screen and
       a paused menu cannot race it; and it dismisses ITSELF the
       moment the trooper lives again, whichever path revived them. */
    if (!death.open && ctx.combat?.player?.dead
      && (ctx.combat.player.respawnIn ?? 0) <= 0.8) showDeathScreen();
    if (death.open && !ctx.combat?.player?.dead) hideDeathScreen();
    if (updateClock < 0.18) return;
    updateClock = 0;
    updateCommands();
    if (menu.open) {
      refreshOperation();
      if (menu.panel === "map") refreshMap();
      root.querySelectorAll('[data-save-action="save"]').forEach((button) => {
        button.disabled = !save?.canSave?.();
      });
      if (menu.restartUntil && menu.restartUntil < performance.now()) {
        menu.restartUntil = 0;
        const restart = root.querySelector('[data-menu-action="restart"]');
        if (restart) restart.textContent = "RESTART OPERATION";
      }
      if (menu.panel === "doctrine" && doctrine.respecUntil
        && doctrine.respecUntil < performance.now()) {
        doctrine.respecUntil = 0;
        refreshDoctrine();
      }
      if (doctrine.respecWarnUntil && doctrine.respecWarnUntil < performance.now()) {
        hideRespecWarn();
      }
    }
  }

  function wheelState() {
    return {
      open: wheel.open,
      selectedKey: wheel.selectedIndex >= 0 ? order[wheel.selectedIndex] : null,
      selectedIndex: wheel.selectedIndex,
      source: wheel.source,
      vector: { x: Number(wheel.x.toFixed(2)), y: Number(wheel.y.toFixed(2)), magnitude: Number(Math.hypot(wheel.x, wheel.y).toFixed(2)) },
      deadZone: wheel.deadZone,
      dispatchSeq: wheel.dispatchSeq,
      lastDispatch: wheel.lastDispatch ? { ...wheel.lastDispatch } : null,
      cancelReason: wheel.cancelReason,
      commands: order.map((key) => ({
        key,
        name: ctx.mission.stratagems?.[key]?.name || key,
        cooldown: Math.max(0, Number(ctx.mission.cooldowns?.[key]) || 0),
        ready: (Number(ctx.mission.cooldowns?.[key]) || 0) <= 0.001,
      })),
    };
  }

  function menuState() {
    const active = document.activeElement;
    const hasAction = active?.dataset && (
      active.dataset.menuAction !== undefined
      || active.dataset.menuPanel !== undefined
      || active.dataset.saveAction !== undefined
      || active.dataset.careerRecoveryAction !== undefined
      || active.dataset.doctrineAction !== undefined
      || active.dataset.doctrineOrder !== undefined
      || active.dataset.menuClose !== undefined
    );
    return {
      open: menu.open,
      panel: menu.panel,
      paused: document.body.classList.contains("rb-escape-menu-open"),
      focusedAction: hasAction ? (active.textContent || "").trim() : null,
      canSave: !!save?.canSave?.(),
      canLoad: !!(saveData.autosave || saveData.manuals?.some(Boolean)),
      phase: ctx.mission.state?.phase || null,
      restartArmed: menu.restartUntil > performance.now(),
      maximized: isMaximized(),
      maximizeLabel: maximizeLabel?.textContent?.trim() || null,
      mapRange: Number(largeMapRange?.textContent?.match(/\d+/)?.[0] || 0),
      mapPixels: largeMapCanvas ? [largeMapCanvas.width, largeMapCanvas.height] : null,
      doctrine: {
        order: doctrine.orderId,
        preview: doctrine.previewTalentId,
        rank: doctrine.latestState?.rank ?? null,
        points: doctrine.latestState?.pointsAvailable ?? null,
        activeVows: activeCapstones(doctrine.latestState || {}).filter(Boolean),
        respecArmed: doctrine.respecUntil > performance.now(),
      },
      debrief: ctx.campaignScore?.status?.() || null,
      missionWrap: {
        visible: !root.querySelector("[data-mission-wrap]")?.hidden,
        acknowledged: menu.victoryWrapSeen,
      },
      careerRecovery: {
        active: !!readCareerConflict()?.active,
        armedChoice: careerRecovery.armedChoice,
        resolving: careerRecovery.resolving,
        visible: !root.querySelector("[data-career-recovery]")?.hidden,
        state: root.querySelector("[data-career-recovery]")?.dataset.state || "idle",
        status: root.querySelector("[data-career-recovery-status]")?.textContent?.trim() || "",
      },
    };
  }

  function settingsState() {
    return {
      audioEnabled: audioEnabled(),
      masterVolume: settings.masterVolume,
      musicVolume: settings.musicVolume,
      sfxVolume: settings.sfxVolume,
      hudScale: settings.hudScale,
      reducedMotion: settings.reducedMotion,
      highContrast: settings.highContrast,
      tutorialEnabled: settings.tutorialEnabled !== false,
      dynamicRes: settings.dynamicRes,
      // Live tier (see applySettings): what the frame is drawn at.
      quality: activeQuality(),
      qualityStored: settings.quality,
      qualityTiers: QUALITY_TIERS,
      // Live tier of the road, and the stored preference behind it.
      difficulty: activeDifficulty(),
      difficultyStored: settings.difficulty,
      difficultyTiers: DIFFICULTY_TIERS,
    };
  }

  function refresh() {
    if (destroyed) return;
    updateCommands();
    refreshOperation();
    refreshMap();
    refreshSaves();
    refreshDoctrine();
    applySettings();
    syncMaximizeButton();
  }

  /* One construction-time sync of the stored preference onto the
     renderer. main.js applies any `?dynres` URL override AFTER this,
     so the param wins for the session without a fight over refresh(). */
  render?.setAutoScale?.(settings.dynamicRes);

  applySettings();
  syncMaximizeButton();
  refresh();

  const publicApi = {
    root,
    wheel: wheelEl,
    menu: menuEl,
    update,
    refresh,
    toggleAudio,
    openMenu,
    openMap,
    closeMenu,
    cancelWheel,
    wheelState,
    menuState,
    settingsState,
    setSetting,
    isMaximized,
    setMaximized,
    toggleMaximized,
    destroy() {
      if (destroyed) return false;
      destroyed = true;

      hideAbilityPopover({ force: true });

      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("click", onMouseClick, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      document.removeEventListener("rainbot:sfx-muted", onSfxMuted);
      unlockEscapeKeyboard();

      touchObserver.disconnect();
      detachTouchCommands();
      stopWon?.(); stopLost?.(); stopSave?.(); stopProgression?.(); stopCampaignScore?.();

      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
      if (autosaveToastTimer) window.clearTimeout(autosaveToastTimer);
      if (announceRaf) cancelAnimationFrame(announceRaf);
      if (focusRaf) cancelAnimationFrame(focusRaf);
      announceRaf = 0;
      focusRaf = 0;

      wheel.open = false;
      wheel.pointerId = null;
      wheel.touchOrigin = null;
      wheelEl.hidden = true;
      wheelEl.setAttribute("aria-hidden", "true");
      wheelEl.dataset.open = "false";
      menu.open = false;
      menuEl.hidden = true;
      menuEl.setAttribute("aria-hidden", "true");
      document.body.classList.remove("sf-command-open", "rb-escape-menu-open");
      if (menu.ariaRestore) setMenuInert(false);
      ctx.player?.input?.clearAll?.();
      touch?.releaseAll?.();
      menu.lastFocus = null;
      doctrine.respecUntil = 0;
      hideRespecWarn();
      clearedUntil.clear();
      root.remove();
      if (stage.__saintfallGameUi === publicApi) delete stage.__saintfallGameUi;
      return true;
    },
  };
  stage.__saintfallGameUi = publicApi;
  return publicApi;
}
