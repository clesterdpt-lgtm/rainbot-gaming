import { register } from "node:module";
import { pathToFileURL } from "node:url";

const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("saintfall/")) {
    const sub = specifier.slice("saintfall/".length);
    return {
      format: "module",
      shortCircuit: true,
      url: new URL("assets/js/saintfall/" + sub, "file:///Volumes/External SSD/Projects/RainbotGaming/").href,
    };
  }
  if (specifier === "three") {
    return {
      format: "module",
      shortCircuit: true,
      url: "data:text/javascript,export default {};",
    };
  }
  return nextResolve(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(loaderCode), pathToFileURL("./"));

// Setup mock browser DOM environment
function createMockClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach((n) => classes.add(n)),
    remove: (...names) => names.forEach((n) => classes.delete(n)),
    toggle: (name, force) => {
      if (force === undefined) force = !classes.has(name);
      if (force) classes.add(name);
      else classes.delete(name);
      return force;
    },
    contains: (name) => classes.has(name),
    delete: (name) => classes.delete(name),
    has: (name) => classes.has(name),
  };
}

class Element {}
class HTMLElement extends Element {}
globalThis.Element = Element;
globalThis.HTMLElement = HTMLElement;

function createMockElement(tagName = "div", id = "") {
  const classList = createMockClassList();
  const attributes = new Map();
  const dataset = {};
  const children = [];
  const listeners = new Map();

  const el = Object.assign(new HTMLElement(), {
    tagName: tagName.toUpperCase(),
    id,
    classList,
    dataset,
    children,
    hidden: false,
    textContent: "",
    style: {},
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, val) { attributes.set(name, String(val)); },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
    querySelector(selector) {
      if (selector === "#sf-command-wheel") return commandWheel;
      if (selector === ".sf-command-wheel__dial") return createMockElement("div");
      if (selector === ".sf-command-wheel__cursor") return createMockElement("div");
      if (selector === "[data-wheel-status]") return createMockElement("div");
      if (selector === "#sf-menu") return menuEl;
      if (selector === "#sf-map-canvas-large") return createMockElement("canvas");
      if (selector === "[data-map-detail-range]") return createMockElement("div");
      if (selector === '[data-menu-action="maximize"]') return maxBtn;
      if (selector === "[data-maximize-label]") return maxLabel;
      if (selector === "[data-autosave-toast]") return createMockElement("div");
      if (selector === "[data-death]") return createMockElement("div");
      if (selector === "[data-ui-live]") return createMockElement("div");
      if (selector === "[data-menu-close]") return resumeBtn;
      if (selector === "#sf-touch") return touchEl;
      if (selector === "#sf-ability-popover.is-visible") return null;
      if (selector === "[data-mission-wrap]") return null;
      if (selector.startsWith("#")) {
        return children.find((c) => c.id === selector.slice(1)) || createMockElement("div", selector.slice(1));
      }
      return createMockElement("div");
    },
    querySelectorAll(selector) {
      if (selector === ".sf-command-wheel__option") return [];
      if (selector.includes("[role='tab']")) return [];
      if (selector === ".is-maxed") return stage.classList.contains("is-maxed") ? [stage] : [];
      return [];
    },
    append(...newChildren) { children.push(...newChildren); },
    appendChild(child) { children.push(child); return child; },
    remove() {},
    closest(selector) {
      if (selector === ".rb-standalone-surface") return surface;
      if (selector === ".sf-stage") return stage;
      return null;
    },
    matches() { return false; },
    focus() { globalThis.document.activeElement = el; },
    blur() {},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
    dispatchEvent(event) {
      const arr = listeners.get(event.type);
      if (arr) arr.forEach((fn) => fn(event));
      return true;
    },
    requestFullscreen: async () => {
      globalThis.document.fullscreenElement = surface;
      globalThis.document.dispatchEvent(new Event("fullscreenchange"));
      return true;
    },
  });
  return el;
}

const windowListeners = new Map();
const docListeners = new Map();

class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.code = init.code || "";
    this.key = init.key || "";
    this.repeat = Boolean(init.repeat);
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopImmediatePropagation() { this.propagationStopped = true; }
}

globalThis.Event = Event;
globalThis.CustomEvent = Event;
globalThis.requestAnimationFrame = (cb) => { cb(0); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
globalThis.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.get(k) ?? null; },
  setItem(k, v) { this.store.set(k, String(v)); },
  removeItem(k) { this.store.delete(k); },
};

const surface = createMockElement("div", "sf-surface");
const stage = createMockElement("div", "sf-stage");
const canvas = createMockElement("canvas", "sf-canvas");
const commandWheel = createMockElement("div", "sf-command-wheel");
const menuEl = createMockElement("div", "sf-menu");
menuEl.hidden = true;
const maxBtn = createMockElement("button", "sf-fullscreen");
const maxLabel = createMockElement("span");
maxLabel.textContent = "MAXIMIZE GAME";
const resumeBtn = createMockElement("button", "sf-resume");
const touchEl = createMockElement("div", "sf-touch");

globalThis.window = {
  addEventListener(type, fn) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const arr = windowListeners.get(type);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
  },
  dispatchEvent(event) {
    const arr = windowListeners.get(event.type);
    if (arr) arr.forEach((fn) => fn(event));
    return true;
  },
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

let keyboardLockedKeys = null;
Object.defineProperty(globalThis, "navigator", {
  value: {
    keyboard: {
      lock: async (keys) => { keyboardLockedKeys = keys; return true; },
      unlock: () => { keyboardLockedKeys = null; },
    },
  },
  configurable: true,
  writable: true,
});

globalThis.document = {
  documentElement: createMockElement("html"),
  body: createMockElement("body"),
  activeElement: canvas,
  pointerLockElement: null,
  fullscreenElement: null,
  webkitFullscreenElement: null,
  addEventListener(type, fn) {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const arr = docListeners.get(type);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
  },
  dispatchEvent(event) {
    const arr = docListeners.get(event.type);
    if (arr) arr.forEach((fn) => fn(event));
    return true;
  },
  querySelectorAll(sel) {
    if (sel === ".is-maxed") {
      const res = [];
      if (stage.classList.contains("is-maxed")) res.push(stage);
      if (surface.classList.contains("is-maxed")) res.push(surface);
      return res;
    }
    return [];
  },
  createElement(tagName) {
    return createMockElement(tagName);
  },
  exitPointerLock: () => {
    globalThis.document.pointerLockElement = null;
  },
  exitFullscreen: async () => {
    globalThis.document.fullscreenElement = null;
    globalThis.document.dispatchEvent(new Event("fullscreenchange"));
    return true;
  },
};

const { buildGameUi } = await import("saintfall/ui.js");

function triggerKeyDown(code, { repeat = false } = {}) {
  const event = new Event("keydown", { code, repeat });
  const arr = windowListeners.get("keydown") || [];
  for (const fn of arr) {
    fn(event);
    if (event.propagationStopped) break;
  }
  return event;
}

let passes = 0;
let failures = 0;
function assert(name, condition, extra = "") {
  if (condition) {
    console.log(`PASS: ${name}`);
    passes++;
  } else {
    console.error(`FAIL: ${name} ${extra}`);
    failures++;
  }
}

async function runTests() {
  const mockCtx = {
    render: { gpu: "MockGPU", softwareRendered: false },
    mission: { state: { phase: "drop" }, bus: { on: () => () => {} } },
    progression: { state: () => ({ rank: 1, pointsAvailable: 0 }), onChange: () => () => {} },
    save: { canSave: () => true, saveReason: () => "OK", onChange: () => () => {} },
    runtime: { phase: "playing" },
    intro: { isBlocking: () => false },
    combat: { player: { dead: false } },
    breaches: { status: () => ({ phase: "idle" }) },
    player: { input: { clearAll: () => {}, state: { locked: false } } },
  };

  const ui = buildGameUi(mockCtx, { stage, canvas, save: mockCtx.save, render: mockCtx.render });

  // 1. Initial State
  assert("Initial menu is closed", !ui.menuState().open);
  assert("Initial view is not maximized", !ui.isMaximized());

  // 2. Pressing Escape in gameplay opens the menu
  triggerKeyDown("Escape");
  assert("Pressing Escape opens the menu", ui.menuState().open);

  // 3. Pressing Escape again while in embedded mode closes the menu
  await new Promise((r) => setTimeout(r, 100));
  triggerKeyDown("Escape");
  assert("Escape closes menu in embedded mode", !ui.menuState().open);

  // 4. Pointer lock loss opens menu
  globalThis.document.pointerLockElement = canvas;
  globalThis.document.dispatchEvent(new Event("pointerlockchange"));
  assert("Pointer lock is now active", globalThis.document.pointerLockElement === canvas);

  // User presses Escape -> browser unlocks pointer lock without keydown
  globalThis.document.pointerLockElement = null;
  globalThis.document.dispatchEvent(new Event("pointerlockchange"));
  assert("Unintentional pointer lock exit automatically opens the menu", ui.menuState().open);

  // Close menu to prepare for fullscreen tests
  await new Promise((r) => setTimeout(r, 200));
  triggerKeyDown("Escape");
  assert("Menu closed after pointer-lock test", !ui.menuState().open);

  // 5. Enter Fullscreen
  ui.setMaximized(true);
  assert("Fullscreen is active", ui.isMaximized());
  assert("Stage has is-maxed class", stage.classList.contains("is-maxed"));
  assert("HTML has sf-maximised class", globalThis.document.documentElement.classList.contains("sf-maximised"));
  assert("Body has rb-game-maxed class", globalThis.document.body.classList.contains("rb-game-maxed"));

  // 6. Pressing Escape ONCE while in fullscreen opens the menu AND keeps fullscreen active!
  triggerKeyDown("Escape");
  assert("First Escape opens menu while in fullscreen", ui.menuState().open);
  assert("First Escape DOES NOT minimize screen", ui.isMaximized());
  assert("Screen is still maximized", stage.classList.contains("is-maxed"));

  // 7. Pressing Escape a SECOND time within double-tap window (e.g. 200ms) minimizes screen!
  await new Promise((r) => setTimeout(r, 200));
  triggerKeyDown("Escape");
  assert("Second Escape within double-tap window minimizes the screen", !ui.isMaximized());
  assert("Stage no longer has is-maxed class", !stage.classList.contains("is-maxed"));
  assert("HTML no longer has sf-maximised class", !globalThis.document.documentElement.classList.contains("sf-maximised"));
  assert("Body no longer has rb-game-maxed class", !globalThis.document.body.classList.contains("rb-game-maxed"));
  assert("Menu remains open after minimizing", ui.menuState().open);

  // 8. Pressing Escape a THIRD time closes the menu
  await new Promise((r) => setTimeout(r, 200));
  triggerKeyDown("Escape");
  assert("Third Escape closes the menu", !ui.menuState().open);

  // 9. Fullscreen single Escape followed by long wait (> 750ms) closes menu without minimizing
  ui.setMaximized(true);
  assert("Re-entered fullscreen", ui.isMaximized());
  triggerKeyDown("Escape");
  assert("Escape opens menu", ui.menuState().open);

  // Wait 800ms (> DOUBLE_TAP_WINDOW_MS)
  await new Promise((r) => setTimeout(r, 800));
  triggerKeyDown("Escape");
  assert("Escape after 800ms closes menu (resumes game)", !ui.menuState().open);
  assert("Screen remains maximized after long wait Escape", ui.isMaximized());

  // 10. Rapid double-tap Escape directly from gameplay in fullscreen
  // Tap 1: opens menu
  triggerKeyDown("Escape");
  assert("Gameplay tap 1 opened menu", ui.menuState().open);
  // Tap 2 after 150ms: minimizes screen
  await new Promise((r) => setTimeout(r, 150));
  triggerKeyDown("Escape");
  assert("Rapid double tap from gameplay minimized screen", !ui.isMaximized());
  assert("Menu remains open", ui.menuState().open);

  // Close menu
  await new Promise((r) => setTimeout(r, 100));
  triggerKeyDown("Escape");

  // 11. Key repeat does NOT trigger double tap minimize
  ui.setMaximized(true);
  triggerKeyDown("Escape"); // Tap 1
  assert("Menu opened by Escape", ui.menuState().open);
  // Repeat event
  triggerKeyDown("Escape", { repeat: true });
  assert("Key repeat event did not minimize screen", ui.isMaximized());
  assert("Menu still open during key repeat", ui.menuState().open);

  // 12. Non-Chromium native fullscreen exit unexpectedly (Escape pressed in Safari/Firefox)
  // Re-enter native FS
  globalThis.document.fullscreenElement = surface;
  ui.setMaximized(true);
  // Safari drops native FS on Escape, firing fullscreenchange without intentionalMaximizeExit
  globalThis.document.fullscreenElement = null;
  globalThis.document.dispatchEvent(new Event("fullscreenchange"));
  assert("Unexpected native FS loss keeps pseudo-fullscreen fallback active", ui.isMaximized());
  assert("Unexpected native FS loss pulls up the field menu", ui.menuState().open);

  // Second Escape within double-tap minimizes pseudo-fullscreen as well
  await new Promise((r) => setTimeout(r, 200));
  triggerKeyDown("Escape");
  assert("Second tap minimizes pseudo-fullscreen", !ui.isMaximized());

  ui.destroy();
  console.log(`\nResults: ${passes} passed, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
