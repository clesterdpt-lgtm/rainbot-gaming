/**
 * Load Rainbot browser agent games headlessly via Node VM.
 * Uses the real assets/js engines so rules stay in lockstep with the site.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSETS_JS = path.resolve(__dirname, "../../assets/js");

function makeEl() {
  return {
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    style: {},
    className: "",
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    blur() {},
    click() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    appendChild() {},
    removeChild() {},
  };
}

/**
 * @param {object} options
 * @param {string} options.file - absolute or relative path to game .js
 * @param {string} options.apiName - window export, e.g. INCIDENT_AGENT_API
 * @param {string} [options.assetsDir]
 */
export function loadBrowserAgentApi(options) {
  const assetsDir = options.assetsDir || DEFAULT_ASSETS_JS;
  const file = path.isAbsolute(options.file) ? options.file : path.join(assetsDir, options.file);
  if (!fs.existsSync(file)) throw new Error(`Agent game file not found: ${file}`);

  const code = fs.readFileSync(file, "utf8");
  const windowObj = {};
  const sandbox = {
    window: windowObj,
    document: {
      getElementById: () => makeEl(),
      querySelector: () => makeEl(),
      querySelectorAll: () => [],
      createElement: () => makeEl(),
    },
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    sessionStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    navigator: {
      clipboard: {
        writeText: async () => {},
        readText: async () => "",
      },
    },
    confirm: () => true,
    alert() {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    JSON,
    Date,
    RegExp,
    Error,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file, timeout: 5000 });

  const api = windowObj[options.apiName];
  if (!api || typeof api.observe !== "function" || typeof api.act !== "function") {
    throw new Error(`window.${options.apiName} was not exported by ${file}`);
  }
  return api;
}

/**
 * Wrap a browser agent API into a common play interface.
 */
export function wrapBrowserEngine(api, helpers) {
  const reset = () => {
    if (typeof helpers.reset === "function") helpers.reset(api);
    else if (typeof api.resetCampaign === "function") api.resetCampaign();
  };

  reset();

  return {
    observe: () => api.observe(),
    act: (input) => {
      const result = api.act(input);
      // Normalize return shape across games
      if (result && typeof result === "object") {
        const observation = result.observation || api.observe();
        const accepted =
          typeof result.accepted === "number"
            ? result.accepted
            : Array.isArray(result.results)
              ? result.results.filter((r) => r && r.ok).length
              : result.ok
                ? 1
                : 0;
        const submitted =
          typeof result.submitted === "number"
            ? result.submitted
            : Array.isArray(result.results)
              ? result.results.length
              : Array.isArray(input)
                ? input.length
                : 1;
        return {
          ok: Boolean(result.ok ?? accepted > 0),
          accepted,
          submitted,
          events: result.events || result.results || [],
          observation,
        };
      }
      return {
        ok: false,
        accepted: 0,
        submitted: 0,
        events: [],
        observation: api.observe(),
      };
    },
    resetCampaign: reset,
    suggest: typeof api.suggest === "function" ? () => api.suggest() : null,
    raw: api,
  };
}
