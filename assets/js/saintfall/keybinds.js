/* ============================================================
   SAINTFALL - keyboard bindings

   ONE TABLE, ONE TRUTH. Every module that used to test a literal
   `e.code === "KeyF"` now asks this file whether a code belongs to an
   ACTION. That indirection is the whole feature: the Controls page
   rewrites the table, and movement, combat, the command wheel, the
   menu and the tutorial all follow without knowing a rebind happened.

   Codes are KeyboardEvent.code, never `key`. `code` is the physical
   position, so a binding survives a layout change and a held modifier
   (Shift+E still reports "KeyE"); `key` would hand back "E" for one
   and "e" for the other and quietly drop half the presses.

   Two slots per action - a primary and an alternate - because the
   shipped scheme already needed them: WASD *and* the arrow cluster,
   either Shift. Slot 1 may be empty. An action may end up with no
   binding at all; that is a legal, visible state (UNBOUND), not an
   error to repair behind the player's back.
   ============================================================ */

const STORAGE_KEY = "saintfall:keybinds:v1";

/* Escape is the way out of every modal state in the game - the menu,
   the wheel, a rebind capture itself. A player who binds it to melee
   has no way back, so it is not on the table. */
export const RESERVED_CODES = Object.freeze(new Set(["Escape"]));

/** The bindable actions, in the order the Controls page draws them. */
export const KEYBIND_ACTIONS = Object.freeze([
  {
    id: "moveForward", group: "MOVEMENT", label: "Move forward", defaults: ["KeyW", "ArrowUp"],
  },
  {
    id: "moveBack", group: "MOVEMENT", label: "Move back", defaults: ["KeyS", "ArrowDown"],
  },
  {
    id: "moveLeft", group: "MOVEMENT", label: "Strafe left", defaults: ["KeyA", "ArrowLeft"],
  },
  {
    id: "moveRight", group: "MOVEMENT", label: "Strafe right", defaults: ["KeyD", "ArrowRight"],
  },
  {
    id: "jump", group: "MOVEMENT", label: "Vault", detail: "Hold with Boost for the reliquary jetpack",
    defaults: ["Space", null],
  },
  {
    id: "boost", group: "MOVEMENT", label: "Boost", detail: "Tap to boost, hold to keep gliding",
    defaults: ["ShiftLeft", "ShiftRight"],
  },
  {
    id: "melee", group: "COMBAT", label: "Censer-lance strike",
    detail: "Hold to charge a jet-propelled piercing thrust; ground slam while airborne",
    defaults: ["KeyF", null],
  },
  {
    id: "furnace", group: "COMBAT", label: "Furnace Lance",
    detail: "Hold to charge, release when ready; middle mouse also works",
    defaults: ["KeyZ", null],
  },
  {
    id: "block", group: "COMBAT", label: "Aegis block", defaults: ["KeyE", null],
  },
  {
    id: "vent", group: "COMBAT", label: "Vent weapon heat", defaults: ["KeyR", null],
  },
  {
    id: "wheel", group: "COMMAND", label: "Command wheel",
    detail: "Hold, hover a sigil, left click to deploy", defaults: ["KeyQ", null],
  },
  {
    id: "stratagems", group: "COMMAND", label: "Field support panel", defaults: ["KeyV", null],
  },
  {
    id: "menu", group: "COMMAND", label: "Field menu", detail: "ESC or TAB opens and resumes",
    defaults: ["Escape", "Tab"],
  },
  {
    id: "map", group: "COMMAND", label: "Tactical map", detail: "Press again to resume",
    defaults: ["KeyM", null],
  },
  {
    id: "hud", group: "COMMAND", label: "Hide HUD", defaults: ["KeyH", null],
  },
]);

const ACTION_BY_ID = new Map(KEYBIND_ACTIONS.map((action) => [action.id, action]));
export const KEYBIND_GROUPS = Object.freeze(
  [...new Set(KEYBIND_ACTIONS.map((action) => action.group))]
);

function defaultTable() {
  const table = Object.create(null);
  for (const action of KEYBIND_ACTIONS) table[action.id] = [action.defaults[0], action.defaults[1] ?? null];
  return table;
}

function sanitizeCode(code, actionId = null) {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 32) return null;
  if (RESERVED_CODES.has(trimmed)) {
    return actionId === "menu" && trimmed === "Escape" ? "Escape" : null;
  }
  return trimmed;
}

/* A stored table is merged onto the defaults rather than trusted
   wholesale: a build that ADDS an action must not leave every player
   who ever opened this page with that action unbound, and a stale key
   for an action that no longer exists must not survive. */
function loadTable() {
  const table = defaultTable();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch (_) { saved = null; }
  if (!saved || typeof saved !== "object") return table;
  for (const action of KEYBIND_ACTIONS) {
    const entry = saved[action.id];
    if (!Array.isArray(entry)) continue;
    let code0 = entry[0];
    let code1 = entry[1];
    if (action.id === "menu" && (!code1 || code1 === "Escape") && code0 === "Escape") {
      code1 = "Tab";
    }
    table[action.id] = [sanitizeCode(code0, action.id), sanitizeCode(code1, action.id)];
  }
  return table;
}

let table = loadTable();
let codeIndex = null;
const listeners = new Set();

function invalidate() {
  codeIndex = null;
  for (const fn of [...listeners]) {
    try { fn(); } catch (_) { /* a listener must not break a rebind */ }
  }
}

function index() {
  if (codeIndex) return codeIndex;
  codeIndex = new Map();
  for (const action of KEYBIND_ACTIONS) {
    for (const code of table[action.id]) {
      if (code && !codeIndex.has(code)) codeIndex.set(code, action.id);
    }
  }
  return codeIndex;
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(table)); }
  catch (_) { /* private browsing: the session still rebinds */ }
}

/** Every code currently bound to something. Callers use it to decide
 *  what to swallow from the page (preventDefault). */
export function keybindCodes() {
  return new Set(index().keys());
}

/** The action a code drives, or null. */
export function actionForCode(code) {
  return index().get(code) || null;
}

/** Both slots verbatim, holes included: the Controls page must draw
 *  an empty alternate as an empty alternate. */
export function keybindSlots(id) {
  const entry = table[id];
  return entry ? [entry[0] ?? null, entry[1] ?? null] : [null, null];
}

/** The codes bound to an action, empty when unbound. */
export function keybindsFor(id) {
  return (table[id] || []).filter(Boolean);
}

/** Does this event code drive this action? */
export function keybindMatches(id, code) {
  const entry = table[id];
  return !!entry && !!code && (entry[0] === code || entry[1] === code);
}

/** Is this action held, given a Set of currently-down codes? */
export function keybindDown(keys, id) {
  const entry = table[id];
  if (!entry) return false;
  return (!!entry[0] && keys.has(entry[0])) || (!!entry[1] && keys.has(entry[1]));
}

/** True when the code drives any action other than the ones named. */
export function isGameplayCode(code, except = []) {
  const id = actionForCode(code);
  return !!id && !except.includes(id);
}

/**
 * Bind `code` to `id`'s slot. A code drives exactly one action, so this
 * TAKES the code from wherever it was - including the other slot of the
 * same action - and reports what it displaced, for the page to say so.
 * Pass a null code to clear the slot.
 */
export function setKeybind(id, slot, code) {
  const entry = table[id];
  const index0 = slot === 1 ? 1 : 0;
  if (!entry) return { ok: false, reason: "unknown-action", displaced: [] };
  const next = sanitizeCode(code);
  if (code && !next) return { ok: false, reason: "reserved", displaced: [] };
  const displaced = [];
  if (next) {
    for (const action of KEYBIND_ACTIONS) {
      const other = table[action.id];
      for (let i = 0; i < 2; i += 1) {
        if (other[i] !== next) continue;
        if (action.id === id && i === index0) continue;
        other[i] = null;
        displaced.push(action.id);
      }
    }
  }
  entry[index0] = next;
  persist();
  invalidate();
  return { ok: true, displaced: [...new Set(displaced)] };
}

/** Restore one action, or the whole scheme, to the shipped bindings. */
export function resetKeybinds(id = null) {
  if (id) {
    const action = ACTION_BY_ID.get(id);
    if (!action) return false;
    /* Reclaiming a default may strip it from wherever the player put
       it, which is the point: "reset this row" must actually restore
       the row, not leave it fighting another action for the key. */
    setKeybind(id, 0, action.defaults[0]);
    setKeybind(id, 1, action.defaults[1] ?? null);
    return true;
  }
  table = defaultTable();
  persist();
  invalidate();
  return true;
}

/** Subscribe to rebinds. Returns the unsubscribe. */
export function onKeybindsChange(fn) {
  if (typeof fn !== "function") return () => false;
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const CODE_LABELS = Object.freeze({
  Escape: "ESC",
  Space: "SPACE",
  Tab: "TAB",
  Enter: "ENTER",
  NumpadEnter: "NUM ENTER",
  Backspace: "BKSP",
  CapsLock: "CAPS",
  ShiftLeft: "L SHIFT",
  ShiftRight: "R SHIFT",
  ControlLeft: "L CTRL",
  ControlRight: "R CTRL",
  AltLeft: "L ALT",
  AltRight: "R ALT",
  MetaLeft: "L META",
  MetaRight: "R META",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  PageUp: "PG UP",
  PageDown: "PG DN",
  Home: "HOME",
  End: "END",
  Insert: "INS",
  Delete: "DEL",
});

/** The short face-legend for a code, for a <kbd>. */
export function keyLabel(code) {
  if (!code) return "UNBOUND";
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `NUM ${code.slice(6).toUpperCase()}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.toUpperCase();
}

/** The whole action as one legend: "W / UP", or "UNBOUND". */
export function keybindLabel(id) {
  const codes = keybindsFor(id);
  if (!codes.length) return "UNBOUND";
  return codes.map(keyLabel).join(" / ");
}

/** Just the primary, for prose and compound legends where the full
 *  "L SHIFT / R SHIFT" would read worse than the one key. */
export function keybindPrimaryLabel(id) {
  return keyLabel(keybindsFor(id)[0] ?? null);
}

export function keybindAction(id) {
  return ACTION_BY_ID.get(id) || null;
}
