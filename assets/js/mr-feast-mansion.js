/*
 * MR. FEAST: THE HOLLOW ESTATE
 * Clean-room mansion exploration build — July 2026.
 * This file intentionally shares no implementation with earlier Mr. Feast games.
 */
(function () {
  "use strict";

  const LOCAL_SERVER_URL = "http://127.0.0.1:8000/games/mr-feast-mansion.html";
  const LOCAL_LAUNCHER_NAME = "Open Mr Feast Mansion.command";
  const LOCAL_SERVER_GUIDANCE = `Mr Feast needs the local web server. Double-click “${LOCAL_LAUNCHER_NAME}” in the RainbotGaming folder; the launcher will open the correct page automatically.`;
  const SCRIPT_URL = document.currentScript && document.currentScript.src;
  const THREE = window.THREE;
  const boot = window.__MR_FEAST_BOOT__;

  const $ = (id) => document.getElementById(id);
  const dom = {
    stage: $("mansion-stage"),
    canvas: $("mansion-canvas"),
    loading: $("mansion-loading"),
    intro: $("mansion-intro"),
    introLead: document.querySelector(".mansion-intro__lead"),
    enter: $("mansion-enter"),
    floor: $("mansion-floor"),
    room: $("mansion-room"),
    prompt: $("mansion-prompt"),
    promptKey: $("mansion-prompt-key"),
    promptText: $("mansion-prompt-text"),
    hiddenStatus: $("mansion-hidden"),
    caseFile: $("mansion-casefile"),
    objective: $("mansion-objective"),
    storyProgress: $("mansion-story-progress"),
    inventory: $("mansion-inventory"),
    journalButton: $("mansion-journal-button"),
    journal: $("mansion-journal"),
    journalClose: $("mansion-journal-close"),
    journalEntries: $("mansion-journal-entries"),
    discovery: $("mansion-discovery"),
    discoveryTitle: $("mansion-discovery-title"),
    discoveryBody: $("mansion-discovery-body"),
    action: $("mansion-action"),
    actionText: $("mansion-action-text"),
    actionFill: $("mansion-action-fill"),
    crosshair: $("mansion-crosshair"),
    audio: $("mansion-audio"),
    fullscreen: $("mansion-fullscreen"),
    touch: $("mansion-touch"),
    debug: $("mansion-debug"),
  };
  if (!dom.canvas || !dom.stage) return;
  if (!THREE || !SCRIPT_URL) {
    boot?.settle();
    const directFile = location.protocol === "file:";
    const message = directFile
      ? LOCAL_SERVER_GUIDANCE
      : "The 3D engine did not load. Retry the mansion.";
    dom.stage.setAttribute("aria-busy", "false");
    if (dom.loading) {
      dom.loading.hidden = false;
      dom.loading.setAttribute("role", "alert");
      dom.loading.textContent = message;
    }
    if (dom.introLead) dom.introLead.textContent = message;
    if (dom.enter) {
      dom.enter.disabled = false;
      dom.enter.removeAttribute("aria-disabled");
      dom.enter.textContent = directFile ? "Server running? Open game" : "Retry loading";
      dom.enter.addEventListener("click", () => {
        if (directFile) location.href = LOCAL_SERVER_URL;
        else location.reload();
      });
    }
    return;
  }

  const FLOOR = Object.freeze({ BASEMENT: -3.8, MAIN: 0, UPPER: 4.5 });
  const MOBILE_RENDER_WIDTH = 720;
  const PRE_ENTRY_FRAME_INTERVAL_MS = 250;
  const BALANCED_FRAME_INTERVAL_MS = 1000 / 30;
  const WALL_HEIGHT = 4.15;
  const UPPER_HEIGHT = 3.3;
  const NIGHT_LIGHTING = Object.freeze({
    hemisphereIntensity: 0.085,
    moonIntensity: 0.28,
    exposure: 0.76,
  });
  // These are uniform-only lifts on lights the scene already owns. They do
  // not add a shader light, a shadow map, or a draw call; they simply keep the
  // large open foyer and rain-darkened grounds readable while the compact
  // local-light program remains fixed.
  const OPEN_VOLUME_HEMISPHERE_INTENSITY = 0.18;
  const GROUNDS_HEMISPHERE_INTENSITY = 0.34;
  const GROUNDS_MOON_INTENSITY = 0.52;
  const GROUNDS_EXPOSURE = 0.94;
  // The hedge walls absorb most of the ordinary grounds fill. Reuse the
  // existing hemisphere, moon, and exposure uniforms for a restrained maze
  // lift instead of adding another real-time light or shadow map.
  const MAZE_HEMISPHERE_INTENSITY = 0.41;
  const MAZE_MOON_INTENSITY = 0.60;
  const MAZE_EXPOSURE = 1.0;
  const CONTEXT_LIGHTING_RESPONSE = 4.5;
  const ROOM_LIGHTING = Object.freeze({
    "COAT CLOSET": ["coat closet lights"],
    "LIBRARY": ["library lights"],
    "FRONT FOYER": ["foyer chandelier"],
    "MUSIC ROOM": ["music room lights"],
    "MAIN HALL BATHROOM": ["main hall bathroom lights"],
    "GRAND STAIR HALL": ["grand stair lights"],
    "PAINTING ROOM": ["painting room lights"],
    "DINING ROOM": ["dining room lights"],
    "BALLROOM": ["ballroom lights"],
    "KITCHEN": ["kitchen lights"],
    "UPPER GRAND BATHROOM": ["upper grand bathroom lights"],
    "WEST FRONT SUITE": ["west front suite lights", "west front walk-in closet light"],
    "FOYER BALCONY": ["foyer chandelier"],
    "EAST FRONT SUITE": ["east front suite lights", "east front walk-in closet light"],
    "UPPER LANDING": ["upper landing lights"],
    "READING ROOM": ["reading room lights"],
    "PRIMARY SUITE": ["primary suite lights", "primary walk-in closet light"],
    "REAR LOUNGE": ["rear lounge lights"],
    "EAST REAR SUITE": ["east rear suite lights", "east rear walk-in closet light"],
    "WINE CELLAR": ["wine cellar lights"],
    "ARCHIVE": ["archive lights"],
    "BASEMENT CORRIDOR": ["basement corridor lights"],
    "LAUNDRY & LINEN": ["laundry lights"],
    "PANTRY": ["pantry store lights"],
    "SERVICE STAIR": ["service stair lights"],
    "REAR CROSS-CORRIDOR": ["rear service corridor lights"],
    "BOILER ROOM": ["boiler room lights"],
    "WORKSHOP": ["workshop lights"],
    "COLD ROOM": ["cold room lights"],
    "BULK STORAGE": ["bulk storage lights"],
    "FRONT DRIVE": ["estate exterior lights"],
    "FORMAL GARDEN": ["estate exterior lights"],
    "POOL TERRACE": ["estate exterior lights"],
    "HEDGE MAZE": ["estate exterior lights"],
    "REAR LAWN": ["estate exterior lights"],
    "EAST LAWN": ["estate exterior lights"],
    "WEST LAWN": ["estate exterior lights"],
  });
  const OPEN_VOLUME_BUDGET_CIRCUITS = Object.freeze([
    "foyer chandelier", "grand stair lights", "upper landing lights",
  ]);
  const OPEN_VOLUME_LIGHT_ROOMS = new Set([
    "FRONT FOYER", "GRAND STAIR HALL", "FOYER BALCONY", "UPPER LANDING",
  ]);
  const MOBILE_UPPER_AMBIENT_CIRCUITS = new Set(OPEN_VOLUME_BUDGET_CIRCUITS);
  // Keep one compact light-program shape on every device. The previous
  // desktop path submitted every light on the active floor (up to 39 lights
  // around the open stair), which made the double-height foyer dramatically
  // slower than closed rooms and still minted a new shader at floor changes.
  // Bulbs, halos, and painted response glows remain fully authored; only the
  // redundant real-time emitters are bounded.
  const MOBILE_SHADER_SPOT_BUDGET = 6;
  const MOBILE_SHADER_POINT_BUDGET = 11;
  const GROUND_BUDGETED_SPOT_LIGHTS = 6;
  const GROUND_BUDGETED_POINT_LIGHTS = 4;
  const MOBILE_CIRCUIT_INTENSITY_SCALE = 2;
  const MOBILE_UPPER_AMBIENT_SCALE = 2.2;
  const PORTRAIT_ARTWORKS = Object.freeze({
    "patron-empty-plates": Object.freeze({ title: "The Patron of Empty Plates", file: "portraits/portrait-patron-empty-plates-v1-ai.jpg" }),
    "generosity-engine": Object.freeze({ title: "The Generosity Engine", file: "portraits/portrait-generosity-engine-v1-ai.jpg" }),
    "infinite-giveaway": Object.freeze({ title: "The Infinite Giveaway", file: "portraits/portrait-infinite-giveaway-diptych-v1-ai.jpg" }),
    "feast-of-merit": Object.freeze({ title: "The Feast of Merit", file: "portraits/portrait-feast-of-merit-v1-ai.jpg" }),
    "garden-good-deeds": Object.freeze({ title: "The Garden of Good Deeds", file: "portraits/portrait-garden-good-deeds-v1-ai.jpg" }),
    "audit-of-souls": Object.freeze({ title: "The Audit of Souls", file: "portraits/portrait-audit-of-souls-v1-ai.jpg" }),
    "banquet-forgot-guests": Object.freeze({ title: "The Banquet That Forgot Its Guests", file: "portraits/portrait-banquet-forgot-guests-v1-ai.jpg" }),
    "last-applause": Object.freeze({ title: "The Last Applause", file: "portraits/portrait-last-applause-v1-ai.jpg" }),
    "orchard-porcelain-teeth": Object.freeze({ title: "The Orchard of Porcelain Teeth", file: "portraits/portrait-orchard-porcelain-teeth-v1-ai.jpg" }),
    "house-dreams-back": Object.freeze({ title: "The House That Dreams Back", file: "portraits/portrait-house-dreams-back-v1-ai.jpg" }),
    "work-in-progress-dreaming": Object.freeze({ title: "The Prompt Is Still Dreaming", file: "paintings/painting-work-in-progress-dreaming-v1-ai.jpg" }),
    "choir-floorboards": Object.freeze({ title: "The Choir Beneath the Floorboards", file: "paintings/painting-choir-floorboards-v1-ai.jpg" }),
    "polite-eclipse": Object.freeze({ title: "A Very Polite Eclipse", file: "paintings/painting-polite-eclipse-v1-ai.jpg" }),
    "five-doors": Object.freeze({ title: "Five Doors, No Hallway", file: "paintings/painting-five-doors-v1-ai.jpg" }),
    "garden-knees": Object.freeze({ title: "The Garden Has Too Many Knees", file: "paintings/painting-garden-knees-v1-ai.jpg" }),
    "moths-guests": Object.freeze({ title: "Moths Wearing the Guests", file: "paintings/painting-moths-guests-v1-ai.jpg" }),
    "arrived-early": Object.freeze({ title: "The Portrait That Arrived Early", file: "paintings/painting-arrived-early-v1-ai.jpg" }),
  });
  const PLAYER = Object.freeze({
    radius: 0.32,
    halfHeight: 0.59,
    eye: 1.67,
    speed: 2.2,
    interactionRange: 2.35,
  });
  const MR_FEAST_LEVEL = Object.freeze({
    BASEMENT: "BASEMENT",
    MAIN: "MAIN LEVEL",
    UPPER: "SECOND FLOOR",
    STAIR: "BETWEEN LEVELS",
  });

  function mrFeastPatrolPoint(id, x, y, z, level, zone, options = {}) {
    return Object.freeze({
      id,
      x,
      y,
      z,
      level,
      zone,
      pause: Math.max(0, Number(options.pause) || 0),
      segmentKind: options.segmentKind || "room",
      door: options.door || null,
    });
  }

  // One continuous interior circuit reaches every major mansion room. Tiny
  // walk-in wardrobes remain outside the visual-only patrol because their
  // openings are narrower than the character's full fitted bounds. Door and
  // stair control points keep the route centered on the authored clearances.
  const MR_FEAST_PATROL_ROUTE = Object.freeze([
    mrFeastPatrolPoint("main-ballroom-south", 0, FLOOR.MAIN, -9.8, MR_FEAST_LEVEL.MAIN, "BALLROOM", { pause: 1.2 }),
    mrFeastPatrolPoint("main-ballroom-west", -3.2, FLOOR.MAIN, -9.2, MR_FEAST_LEVEL.MAIN, "BALLROOM"),
    mrFeastPatrolPoint("main-dining-east", -5.8, FLOOR.MAIN, -6, MR_FEAST_LEVEL.MAIN, "DINING ROOM"),
    mrFeastPatrolPoint("main-dining-south", -5.8, FLOOR.MAIN, -10.7, MR_FEAST_LEVEL.MAIN, "DINING ROOM"),
    mrFeastPatrolPoint("main-dining-west", -13.2, FLOOR.MAIN, -10.7, MR_FEAST_LEVEL.MAIN, "DINING ROOM", { pause: 0.8 }),
    mrFeastPatrolPoint("main-dining-north", -13.2, FLOOR.MAIN, -4.05, MR_FEAST_LEVEL.MAIN, "DINING ROOM"),
    mrFeastPatrolPoint("main-bath-gallery-approach", -9.7, FLOOR.MAIN, -3.85, MR_FEAST_LEVEL.MAIN, "DINING ROOM"),
    mrFeastPatrolPoint("main-bath-gallery-door", -9.7, FLOOR.MAIN, -3.2, MR_FEAST_LEVEL.MAIN, "MAIN HALL BATHROOM", { segmentKind: "door", door: "bathroom gallery door" }),
    mrFeastPatrolPoint("main-bath-south", -9.7, FLOOR.MAIN, -2.55, MR_FEAST_LEVEL.MAIN, "MAIN HALL BATHROOM"),
    mrFeastPatrolPoint("main-bath-center", -8.8, FLOOR.MAIN, -1.2, MR_FEAST_LEVEL.MAIN, "MAIN HALL BATHROOM"),
    mrFeastPatrolPoint("main-bath-north", -8.8, FLOOR.MAIN, 1.3, MR_FEAST_LEVEL.MAIN, "MAIN HALL BATHROOM", { pause: 0.7 }),
    mrFeastPatrolPoint("main-library-bath-approach", -9.7, FLOOR.MAIN, 2.55, MR_FEAST_LEVEL.MAIN, "MAIN HALL BATHROOM"),
    mrFeastPatrolPoint("main-library-bath-door", -9.7, FLOOR.MAIN, 3.2, MR_FEAST_LEVEL.MAIN, "LIBRARY", { segmentKind: "door", door: "library bathroom door" }),
    mrFeastPatrolPoint("main-library-south", -9.7, FLOOR.MAIN, 3.85, MR_FEAST_LEVEL.MAIN, "LIBRARY"),
    mrFeastPatrolPoint("main-library-west", -12.6, FLOOR.MAIN, 4.3, MR_FEAST_LEVEL.MAIN, "LIBRARY"),
    mrFeastPatrolPoint("main-library-northwest", -12.6, FLOOR.MAIN, 9.8, MR_FEAST_LEVEL.MAIN, "LIBRARY"),
    mrFeastPatrolPoint("main-library-north", -10, FLOOR.MAIN, 10.7, MR_FEAST_LEVEL.MAIN, "LIBRARY", { pause: 1 }),
    mrFeastPatrolPoint("main-library-east", -6.7, FLOOR.MAIN, 10.6, MR_FEAST_LEVEL.MAIN, "LIBRARY"),
    mrFeastPatrolPoint("main-library-door-inside", -6.2, FLOOR.MAIN, 7.3, MR_FEAST_LEVEL.MAIN, "LIBRARY"),
    mrFeastPatrolPoint("main-library-door", -5, FLOOR.MAIN, 7.3, MR_FEAST_LEVEL.MAIN, "FRONT FOYER", { segmentKind: "door", door: "library door" }),
    mrFeastPatrolPoint("main-foyer-west", -4.3, FLOOR.MAIN, 7.3, MR_FEAST_LEVEL.MAIN, "FRONT FOYER"),
    mrFeastPatrolPoint("main-foyer-northwest", -2.5, FLOOR.MAIN, 9.8, MR_FEAST_LEVEL.MAIN, "FRONT FOYER"),
    mrFeastPatrolPoint("main-foyer-center", 0, FLOOR.MAIN, 10.2, MR_FEAST_LEVEL.MAIN, "FRONT FOYER", { pause: 1.2 }),
    mrFeastPatrolPoint("main-foyer-northeast", 2.5, FLOOR.MAIN, 9.8, MR_FEAST_LEVEL.MAIN, "FRONT FOYER"),
    mrFeastPatrolPoint("main-music-door-outside", 4.3, FLOOR.MAIN, 7.3, MR_FEAST_LEVEL.MAIN, "FRONT FOYER"),
    mrFeastPatrolPoint("main-music-door", 5, FLOOR.MAIN, 7.3, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM", { segmentKind: "door", door: "music room door" }),
    mrFeastPatrolPoint("main-music-entry", 5.8, FLOOR.MAIN, 7.3, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM"),
    mrFeastPatrolPoint("main-music-southwest", 6.5, FLOOR.MAIN, 5, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM"),
    mrFeastPatrolPoint("main-music-south", 8.2, FLOOR.MAIN, 4, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM"),
    mrFeastPatrolPoint("main-music-southeast", 13.2, FLOOR.MAIN, 4, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM"),
    mrFeastPatrolPoint("main-music-northeast", 13.2, FLOOR.MAIN, 9.8, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM"),
    mrFeastPatrolPoint("main-music-north", 11.7, FLOOR.MAIN, 10.7, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM", { pause: 0.8 }),
    mrFeastPatrolPoint("main-music-return", 13.2, FLOOR.MAIN, 4, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM"),
    mrFeastPatrolPoint("main-painting-door-north", 8.2, FLOOR.MAIN, 3.85, MR_FEAST_LEVEL.MAIN, "MUSIC ROOM"),
    mrFeastPatrolPoint("main-painting-door", 8.2, FLOOR.MAIN, 3.2, MR_FEAST_LEVEL.MAIN, "PAINTING ROOM", { segmentKind: "door", door: "music painting door" }),
    mrFeastPatrolPoint("main-painting-north", 8.2, FLOOR.MAIN, 2.55, MR_FEAST_LEVEL.MAIN, "PAINTING ROOM"),
    mrFeastPatrolPoint("main-painting-west-north", 6.2, FLOOR.MAIN, 2.3, MR_FEAST_LEVEL.MAIN, "PAINTING ROOM"),
    mrFeastPatrolPoint("main-painting-west-south", 6.2, FLOOR.MAIN, -2.3, MR_FEAST_LEVEL.MAIN, "PAINTING ROOM", { pause: 0.6 }),
    mrFeastPatrolPoint("main-painting-south", 8.2, FLOOR.MAIN, -2.55, MR_FEAST_LEVEL.MAIN, "PAINTING ROOM"),
    mrFeastPatrolPoint("main-gallery-door", 8.2, FLOOR.MAIN, -3.2, MR_FEAST_LEVEL.MAIN, "KITCHEN", { segmentKind: "door", door: "painting gallery door" }),
    mrFeastPatrolPoint("main-kitchen-north", 8.2, FLOOR.MAIN, -3.85, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-kitchen-west", 8.2, FLOOR.MAIN, -5.8, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-kitchen-center", 10, FLOOR.MAIN, -7.8, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-kitchen-south", 12.6, FLOOR.MAIN, -9.8, MR_FEAST_LEVEL.MAIN, "KITCHEN", { pause: 1 }),
    mrFeastPatrolPoint("main-kitchen-east", 12.8, FLOOR.MAIN, -6, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-kitchen-exit", 6, FLOOR.MAIN, -6, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-rear-east", 4.2, FLOOR.MAIN, -6, MR_FEAST_LEVEL.MAIN, "BALLROOM"),
    mrFeastPatrolPoint("main-stair-south", 3.2, FLOOR.MAIN, -5.6, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL"),
    mrFeastPatrolPoint("main-stair-east", 2.05, FLOOR.MAIN, -4.35, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL"),
    mrFeastPatrolPoint("main-stair-north", 2.05, FLOOR.MAIN, 4.15, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL"),
    mrFeastPatrolPoint("main-stair-center", 0, FLOOR.MAIN, 4.15, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL"),
    mrFeastPatrolPoint("grand-lower-bottom", 0, FLOOR.MAIN, 2.8, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL"),
    mrFeastPatrolPoint("grand-lower-25", 0, 0.625, 1.855, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-lower-50", 0, 1.25, 0.91, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-lower-75", 0, 1.875, -0.035, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-lower-top", 0, 2.5, -0.98, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-mid-depth", 0, 2.5, -1.55, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-mid-west", -2.48, 2.5, -1.55, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-west-foot", -2.48, 2.5, -0.98, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-west-25", -2.48, 3, 0.04, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-west-50", -2.48, 3.5, 1.06, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-west-75", -2.48, 4, 2.08, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-west-top", -2.48, FLOOR.UPPER, 3.1, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("upper-west-top-landing", -2.48, FLOOR.UPPER, 3.75, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY", { segmentKind: "landing" }),
    mrFeastPatrolPoint("upper-landing-west", -4.2, FLOOR.UPPER, 3.75, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-bath-approach", -4.2, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER LANDING"),
    mrFeastPatrolPoint("upper-bath-door", -5, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER GRAND BATHROOM", { segmentKind: "door", door: "upper grand bathroom door" }),
    mrFeastPatrolPoint("upper-bath-entry", -5.8, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER GRAND BATHROOM"),
    mrFeastPatrolPoint("upper-bath-center", -8.7, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER GRAND BATHROOM"),
    mrFeastPatrolPoint("upper-bath-north", -10.8, FLOOR.UPPER, 1.2, MR_FEAST_LEVEL.UPPER, "UPPER GRAND BATHROOM", { pause: 0.8 }),
    mrFeastPatrolPoint("upper-bath-return", -8.7, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER GRAND BATHROOM"),
    mrFeastPatrolPoint("upper-bath-door-out", -5, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER LANDING", { segmentKind: "door", door: "upper grand bathroom door" }),
    mrFeastPatrolPoint("upper-landing-west-return", -4.2, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER LANDING"),
    mrFeastPatrolPoint("upper-rear-west-approach", -4.15, FLOOR.UPPER, -2.15, MR_FEAST_LEVEL.UPPER, "UPPER LANDING"),
    mrFeastPatrolPoint("upper-lounge-west-entry", -4.15, FLOOR.UPPER, -3.75, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-primary-door-outside", -4.2, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-primary-door", -5, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "PRIMARY SUITE", { segmentKind: "door", door: "primary suite lounge door" }),
    mrFeastPatrolPoint("upper-primary-entry", -5.8, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "PRIMARY SUITE"),
    mrFeastPatrolPoint("upper-primary-center", -8, FLOOR.UPPER, -6, MR_FEAST_LEVEL.UPPER, "PRIMARY SUITE"),
    mrFeastPatrolPoint("upper-primary-west", -12, FLOOR.UPPER, -5.5, MR_FEAST_LEVEL.UPPER, "PRIMARY SUITE", { pause: 0.8 }),
    mrFeastPatrolPoint("upper-primary-return", -8, FLOOR.UPPER, -6, MR_FEAST_LEVEL.UPPER, "PRIMARY SUITE"),
    mrFeastPatrolPoint("upper-primary-door-out", -5, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE", { segmentKind: "door", door: "primary suite lounge door" }),
    mrFeastPatrolPoint("upper-lounge-west", -4.2, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-lounge-northwest", -3.5, FLOOR.UPPER, -7.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-lounge-southwest", -3.5, FLOOR.UPPER, -10.8, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-lounge-south", 0, FLOOR.UPPER, -10.8, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE", { pause: 1 }),
    mrFeastPatrolPoint("upper-lounge-southeast", 3.5, FLOOR.UPPER, -10.8, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-lounge-northeast", 3.5, FLOOR.UPPER, -7.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-east-rear-door-outside", 4.2, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-east-rear-door", 5, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "EAST REAR SUITE", { segmentKind: "door", door: "east rear suite lounge door" }),
    mrFeastPatrolPoint("upper-east-rear-entry", 5.8, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "EAST REAR SUITE"),
    mrFeastPatrolPoint("upper-east-rear-center", 8, FLOOR.UPPER, -6, MR_FEAST_LEVEL.UPPER, "EAST REAR SUITE"),
    mrFeastPatrolPoint("upper-east-rear-east", 12, FLOOR.UPPER, -5.5, MR_FEAST_LEVEL.UPPER, "EAST REAR SUITE", { pause: 0.8 }),
    mrFeastPatrolPoint("upper-east-rear-return", 8, FLOOR.UPPER, -6, MR_FEAST_LEVEL.UPPER, "EAST REAR SUITE"),
    mrFeastPatrolPoint("upper-east-rear-door-out", 5, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE", { segmentKind: "door", door: "east rear suite lounge door" }),
    mrFeastPatrolPoint("upper-lounge-east", 4.2, FLOOR.UPPER, -6.4, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-rear-east-guard", 4.15, FLOOR.UPPER, -3.75, MR_FEAST_LEVEL.UPPER, "REAR LOUNGE"),
    mrFeastPatrolPoint("upper-landing-east-rear", 4.15, FLOOR.UPPER, -2.15, MR_FEAST_LEVEL.UPPER, "UPPER LANDING"),
    mrFeastPatrolPoint("upper-reading-outside", 4.2, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER LANDING"),
    mrFeastPatrolPoint("upper-reading-door", 5, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "READING ROOM", { segmentKind: "door", door: "reading room door" }),
    mrFeastPatrolPoint("upper-reading-entry", 5.8, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "READING ROOM"),
    mrFeastPatrolPoint("upper-reading-northwest", 7, FLOOR.UPPER, 2.2, MR_FEAST_LEVEL.UPPER, "READING ROOM"),
    mrFeastPatrolPoint("upper-reading-northeast", 12.5, FLOOR.UPPER, 2.2, MR_FEAST_LEVEL.UPPER, "READING ROOM", { pause: 0.7 }),
    mrFeastPatrolPoint("upper-reading-southeast", 12.5, FLOOR.UPPER, -2.2, MR_FEAST_LEVEL.UPPER, "READING ROOM"),
    mrFeastPatrolPoint("upper-reading-southwest", 7, FLOOR.UPPER, -2.2, MR_FEAST_LEVEL.UPPER, "READING ROOM"),
    mrFeastPatrolPoint("upper-reading-door-out", 5, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER LANDING", { segmentKind: "door", door: "reading room door" }),
    mrFeastPatrolPoint("upper-landing-east", 4.2, FLOOR.UPPER, 0, MR_FEAST_LEVEL.UPPER, "UPPER LANDING"),
    mrFeastPatrolPoint("upper-east-balcony", 4.2, FLOOR.UPPER, 3.75, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-east-front-door-outside", 4.2, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-east-front-door", 5, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "EAST FRONT SUITE", { segmentKind: "door", door: "east front suite door" }),
    mrFeastPatrolPoint("upper-east-front-entry", 5.8, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "EAST FRONT SUITE"),
    mrFeastPatrolPoint("upper-east-front-inner", 7, FLOOR.UPPER, 6, MR_FEAST_LEVEL.UPPER, "EAST FRONT SUITE"),
    mrFeastPatrolPoint("upper-east-front-center", 9.5, FLOOR.UPPER, 6, MR_FEAST_LEVEL.UPPER, "EAST FRONT SUITE", { pause: 0.8 }),
    mrFeastPatrolPoint("upper-east-front-return", 7, FLOOR.UPPER, 6, MR_FEAST_LEVEL.UPPER, "EAST FRONT SUITE"),
    mrFeastPatrolPoint("upper-east-front-door-out", 5, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY", { segmentKind: "door", door: "east front suite door" }),
    mrFeastPatrolPoint("upper-east-rail", 4.2, FLOOR.UPPER, 11.55, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-front-crosswalk", 0, FLOOR.UPPER, 11.55, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY", { pause: 1.3 }),
    mrFeastPatrolPoint("upper-west-rail", -4.2, FLOOR.UPPER, 11.55, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-west-front-door-outside", -4.2, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-west-front-door", -5, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "WEST FRONT SUITE", { segmentKind: "door", door: "west front suite door" }),
    mrFeastPatrolPoint("upper-west-front-entry", -5.8, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "WEST FRONT SUITE"),
    mrFeastPatrolPoint("upper-west-front-inner", -7, FLOOR.UPPER, 6, MR_FEAST_LEVEL.UPPER, "WEST FRONT SUITE"),
    mrFeastPatrolPoint("upper-west-front-center", -9.5, FLOOR.UPPER, 6, MR_FEAST_LEVEL.UPPER, "WEST FRONT SUITE", { pause: 0.8 }),
    mrFeastPatrolPoint("upper-west-front-return", -7, FLOOR.UPPER, 6, MR_FEAST_LEVEL.UPPER, "WEST FRONT SUITE"),
    mrFeastPatrolPoint("upper-west-front-door-out", -5, FLOOR.UPPER, 7.3, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY", { segmentKind: "door", door: "west front suite door" }),
    mrFeastPatrolPoint("upper-west-balcony-return", -4.2, FLOOR.UPPER, 3.75, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-top-center", 0, FLOOR.UPPER, 3.75, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY"),
    mrFeastPatrolPoint("upper-east-top-landing", 2.48, FLOOR.UPPER, 3.75, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-east-top", 2.48, FLOOR.UPPER, 3.1, MR_FEAST_LEVEL.UPPER, "FOYER BALCONY", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-east-75", 2.48, 4, 2.08, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-east-50", 2.48, 3.5, 1.06, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-east-25", 2.48, 3, 0.04, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-east-foot", 2.48, 2.5, -0.98, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-mid-east", 2.48, 2.5, -1.55, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-mid-center-return", 0, 2.5, -1.55, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-lower-top-return", 0, 2.5, -0.98, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "landing" }),
    mrFeastPatrolPoint("grand-lower-return-75", 0, 1.875, -0.035, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-lower-return-50", 0, 1.25, 0.91, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-lower-return-25", 0, 0.625, 1.855, MR_FEAST_LEVEL.STAIR, "GRAND STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("grand-lower-bottom-return", 0, FLOOR.MAIN, 2.8, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("main-service-return-east", 2.05, FLOOR.MAIN, 4.15, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL"),
    mrFeastPatrolPoint("main-service-return-south", 2.05, FLOOR.MAIN, -4.35, MR_FEAST_LEVEL.MAIN, "GRAND STAIR HALL"),
    mrFeastPatrolPoint("main-service-kitchen-entry", 3.2, FLOOR.MAIN, -5.6, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-service-kitchen-west", 6.2, FLOOR.MAIN, -5.8, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-service-kitchen-east", 10.8, FLOOR.MAIN, -5.8, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-service-kitchen-doorline", 12.55, FLOOR.MAIN, -5.4, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-service-door-approach", 12.55, FLOOR.MAIN, -3.85, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-service-door", 12.55, FLOOR.MAIN, -3.2, MR_FEAST_LEVEL.MAIN, "SERVICE STAIR", { segmentKind: "door", door: "basement stair door" }),
    mrFeastPatrolPoint("service-main-top", 12.55, FLOOR.MAIN, -2.7, MR_FEAST_LEVEL.MAIN, "SERVICE STAIR"),
    mrFeastPatrolPoint("service-down-25", 12.55, -0.95, -1.35, MR_FEAST_LEVEL.STAIR, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("service-down-50", 12.55, -1.9, 0, MR_FEAST_LEVEL.STAIR, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("service-down-75", 12.55, -2.85, 1.35, MR_FEAST_LEVEL.STAIR, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("service-basement-bottom", 12.55, FLOOR.BASEMENT, 2.7, MR_FEAST_LEVEL.BASEMENT, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("basement-archive-stair-exit", 12.55, FLOOR.BASEMENT, 3.8, MR_FEAST_LEVEL.BASEMENT, "ARCHIVE"),
    mrFeastPatrolPoint("basement-archive-east-cross", 12.55, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "ARCHIVE"),
    mrFeastPatrolPoint("basement-archive-inner", 2.4, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "ARCHIVE", { pause: 0.7 }),
    mrFeastPatrolPoint("basement-archive-door", 1.3, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR", { segmentKind: "door", door: "archive door" }),
    mrFeastPatrolPoint("basement-corridor-north", 0, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR"),
    mrFeastPatrolPoint("basement-wine-door", -1.3, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "WINE CELLAR", { segmentKind: "door", door: "wine cellar door" }),
    mrFeastPatrolPoint("basement-wine-entry", -2.4, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "WINE CELLAR"),
    mrFeastPatrolPoint("basement-wine-mid", -4.2, FLOOR.BASEMENT, 5.2, MR_FEAST_LEVEL.BASEMENT, "WINE CELLAR"),
    mrFeastPatrolPoint("basement-wine-west", -12.5, FLOOR.BASEMENT, 5.2, MR_FEAST_LEVEL.BASEMENT, "WINE CELLAR"),
    mrFeastPatrolPoint("basement-wine-north", -12.5, FLOOR.BASEMENT, 10.3, MR_FEAST_LEVEL.BASEMENT, "WINE CELLAR", { pause: 0.8 }),
    mrFeastPatrolPoint("basement-wine-return", -4.2, FLOOR.BASEMENT, 5.2, MR_FEAST_LEVEL.BASEMENT, "WINE CELLAR"),
    mrFeastPatrolPoint("basement-wine-door-out", -1.3, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR", { segmentKind: "door", door: "wine cellar door" }),
    mrFeastPatrolPoint("basement-corridor-midnorth", 0, FLOOR.BASEMENT, 2.4, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR"),
    mrFeastPatrolPoint("basement-corridor-laundry", 0, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR"),
    mrFeastPatrolPoint("basement-laundry-door", -1.3, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "LAUNDRY & LINEN", { segmentKind: "door", door: "laundry door" }),
    mrFeastPatrolPoint("basement-laundry-entry", -2.4, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "LAUNDRY & LINEN"),
    mrFeastPatrolPoint("basement-laundry-north", -2.4, FLOOR.BASEMENT, 2.1, MR_FEAST_LEVEL.BASEMENT, "LAUNDRY & LINEN"),
    mrFeastPatrolPoint("basement-laundry-west", -12.5, FLOOR.BASEMENT, 2.1, MR_FEAST_LEVEL.BASEMENT, "LAUNDRY & LINEN", { pause: 0.7 }),
    mrFeastPatrolPoint("basement-laundry-return", -2.4, FLOOR.BASEMENT, 2.1, MR_FEAST_LEVEL.BASEMENT, "LAUNDRY & LINEN"),
    mrFeastPatrolPoint("basement-laundry-door-out", -1.3, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR", { segmentKind: "door", door: "laundry door" }),
    mrFeastPatrolPoint("basement-pantry-door", 1.3, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "PANTRY", { segmentKind: "door", door: "pantry door" }),
    mrFeastPatrolPoint("basement-pantry-entry", 2.4, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "PANTRY"),
    mrFeastPatrolPoint("basement-pantry-east", 9.2, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "PANTRY"),
    mrFeastPatrolPoint("basement-pantry-north", 9.2, FLOOR.BASEMENT, 1.5, MR_FEAST_LEVEL.BASEMENT, "PANTRY", { pause: 0.7 }),
    mrFeastPatrolPoint("basement-pantry-return", 2.4, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "PANTRY"),
    mrFeastPatrolPoint("basement-pantry-door-out", 1.3, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR", { segmentKind: "door", door: "pantry door" }),
    mrFeastPatrolPoint("basement-corridor-rear-arch", 0, FLOOR.BASEMENT, -3.2, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR"),
    mrFeastPatrolPoint("basement-rear-cross-center", 0, FLOOR.BASEMENT, -4.05, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR"),
    mrFeastPatrolPoint("basement-boiler-corridor", -10.2, FLOOR.BASEMENT, -4.05, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR"),
    mrFeastPatrolPoint("basement-boiler-door", -10.2, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "BOILER ROOM", { segmentKind: "door", door: "boiler room door" }),
    mrFeastPatrolPoint("basement-boiler-entry", -10.2, FLOOR.BASEMENT, -5.8, MR_FEAST_LEVEL.BASEMENT, "BOILER ROOM"),
    mrFeastPatrolPoint("basement-boiler-west", -12.8, FLOOR.BASEMENT, -5.8, MR_FEAST_LEVEL.BASEMENT, "BOILER ROOM"),
    mrFeastPatrolPoint("basement-boiler-south", -13.2, FLOOR.BASEMENT, -10.3, MR_FEAST_LEVEL.BASEMENT, "BOILER ROOM", { pause: 0.8 }),
    mrFeastPatrolPoint("basement-boiler-return", -12.8, FLOOR.BASEMENT, -5.8, MR_FEAST_LEVEL.BASEMENT, "BOILER ROOM"),
    mrFeastPatrolPoint("basement-boiler-door-out", -10.2, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR", { segmentKind: "door", door: "boiler room door" }),
    mrFeastPatrolPoint("basement-workshop-corridor", -2.3, FLOOR.BASEMENT, -4.05, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR"),
    mrFeastPatrolPoint("basement-workshop-door", -2.3, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "WORKSHOP", { segmentKind: "door", door: "workshop door" }),
    mrFeastPatrolPoint("basement-workshop-entry", -2.3, FLOOR.BASEMENT, -6.2, MR_FEAST_LEVEL.BASEMENT, "WORKSHOP"),
    mrFeastPatrolPoint("basement-workshop-east", 0.3, FLOOR.BASEMENT, -6.2, MR_FEAST_LEVEL.BASEMENT, "WORKSHOP"),
    mrFeastPatrolPoint("basement-workshop-south", 0.3, FLOOR.BASEMENT, -10.5, MR_FEAST_LEVEL.BASEMENT, "WORKSHOP", { pause: 0.8 }),
    mrFeastPatrolPoint("basement-workshop-return", 0.3, FLOOR.BASEMENT, -6.2, MR_FEAST_LEVEL.BASEMENT, "WORKSHOP"),
    mrFeastPatrolPoint("basement-workshop-door-out", -2.3, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR", { segmentKind: "door", door: "workshop door" }),
    mrFeastPatrolPoint("basement-cold-corridor", 4.5, FLOOR.BASEMENT, -4.05, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR"),
    mrFeastPatrolPoint("basement-cold-door", 4.5, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "COLD ROOM", { segmentKind: "door", door: "cold room door" }),
    mrFeastPatrolPoint("basement-cold-entry", 4.5, FLOOR.BASEMENT, -6.1, MR_FEAST_LEVEL.BASEMENT, "COLD ROOM"),
    mrFeastPatrolPoint("basement-cold-west", 2.2, FLOOR.BASEMENT, -6.1, MR_FEAST_LEVEL.BASEMENT, "COLD ROOM"),
    mrFeastPatrolPoint("basement-cold-southwest", 2.2, FLOOR.BASEMENT, -10.4, MR_FEAST_LEVEL.BASEMENT, "COLD ROOM"),
    mrFeastPatrolPoint("basement-cold-southeast", 6.7, FLOOR.BASEMENT, -10.4, MR_FEAST_LEVEL.BASEMENT, "COLD ROOM", { pause: 0.8 }),
    mrFeastPatrolPoint("basement-cold-return", 2.2, FLOOR.BASEMENT, -6.1, MR_FEAST_LEVEL.BASEMENT, "COLD ROOM"),
    mrFeastPatrolPoint("basement-cold-door-out", 4.5, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR", { segmentKind: "door", door: "cold room door" }),
    mrFeastPatrolPoint("basement-bulk-corridor", 11.2, FLOOR.BASEMENT, -4.05, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR"),
    mrFeastPatrolPoint("basement-bulk-door", 11.2, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "BULK STORAGE", { segmentKind: "door", door: "bulk storage door" }),
    mrFeastPatrolPoint("basement-bulk-front", 11.2, FLOOR.BASEMENT, -6.2, MR_FEAST_LEVEL.BASEMENT, "BULK STORAGE", { pause: 0.7 }),
    mrFeastPatrolPoint("basement-bulk-door-out", 11.2, FLOOR.BASEMENT, -4.9, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR", { segmentKind: "door", door: "bulk storage door" }),
    mrFeastPatrolPoint("basement-rear-cross-return", 0, FLOOR.BASEMENT, -4.05, MR_FEAST_LEVEL.BASEMENT, "REAR CROSS-CORRIDOR"),
    mrFeastPatrolPoint("basement-corridor-return", 0, FLOOR.BASEMENT, 0, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR"),
    mrFeastPatrolPoint("basement-corridor-north-return", 0, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "BASEMENT CORRIDOR"),
    mrFeastPatrolPoint("basement-archive-door-return", 1.3, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "ARCHIVE", { segmentKind: "door", door: "archive door" }),
    mrFeastPatrolPoint("basement-archive-west-return", 2.4, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "ARCHIVE"),
    mrFeastPatrolPoint("basement-archive-east-return", 12.55, FLOOR.BASEMENT, 7.2, MR_FEAST_LEVEL.BASEMENT, "ARCHIVE"),
    mrFeastPatrolPoint("basement-service-approach", 12.55, FLOOR.BASEMENT, 3.8, MR_FEAST_LEVEL.BASEMENT, "ARCHIVE"),
    mrFeastPatrolPoint("service-basement-bottom-return", 12.55, FLOOR.BASEMENT, 2.7, MR_FEAST_LEVEL.BASEMENT, "SERVICE STAIR"),
    mrFeastPatrolPoint("service-up-25", 12.55, -2.85, 1.35, MR_FEAST_LEVEL.STAIR, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("service-up-50", 12.55, -1.9, 0, MR_FEAST_LEVEL.STAIR, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("service-up-75", 12.55, -0.95, -1.35, MR_FEAST_LEVEL.STAIR, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("service-main-top-return", 12.55, FLOOR.MAIN, -2.7, MR_FEAST_LEVEL.MAIN, "SERVICE STAIR", { segmentKind: "stairs" }),
    mrFeastPatrolPoint("main-service-door-return", 12.55, FLOOR.MAIN, -3.2, MR_FEAST_LEVEL.MAIN, "KITCHEN", { segmentKind: "door", door: "basement stair door" }),
    mrFeastPatrolPoint("main-service-exit", 12.55, FLOOR.MAIN, -3.85, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-kitchen-service-return", 12.55, FLOOR.MAIN, -5.4, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-kitchen-east-return", 10.8, FLOOR.MAIN, -5.8, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-kitchen-west-return", 6.2, FLOOR.MAIN, -6, MR_FEAST_LEVEL.MAIN, "KITCHEN"),
    mrFeastPatrolPoint("main-ballroom-east-return", 4.2, FLOOR.MAIN, -6, MR_FEAST_LEVEL.MAIN, "BALLROOM"),
    mrFeastPatrolPoint("main-ballroom-north-return", 3.2, FLOOR.MAIN, -5.6, MR_FEAST_LEVEL.MAIN, "BALLROOM"),
    mrFeastPatrolPoint("main-ballroom-east-south", 3.2, FLOOR.MAIN, -9.2, MR_FEAST_LEVEL.MAIN, "BALLROOM"),
  ]);

  const MR_FEAST_NPC = Object.freeze({
    manifestPath: "../models/mr-feast/mr-feast-asset-manifest.json",
    assetVersion: "20260715-mr-feast-whole-home-patrol-1",
    heightMeters: 2.01,
    speed: 0.62,
    turnSpeed: 4,
    arrivalRadius: 0.06,
    fadeSeconds: 0.24,
    doorOpenDistance: 1.8,
    doorWaitDistance: 0.88,
    doorCloseDistance: 2.5,
    waypoints: MR_FEAST_PATROL_ROUTE,
  });
  const MR_FEAST_ROUTE_DISTANCE_METERS = MR_FEAST_PATROL_ROUTE.reduce((total, target, index) => {
    const source = MR_FEAST_PATROL_ROUTE[(index - 1 + MR_FEAST_PATROL_ROUTE.length) % MR_FEAST_PATROL_ROUTE.length];
    return total + Math.hypot(target.x - source.x, target.y - source.y, target.z - source.z);
  }, 0);
  const MR_FEAST_ROUTE_PAUSE_SECONDS = MR_FEAST_PATROL_ROUTE.reduce((total, point) => total + point.pause, 0);
  const TOILET_FLUSH_DURATION = 2.7;
  const FOOD_STORAGE_KINDS = new Set([
    "food", "refrigerator", "pantry-staples", "preserves", "dry-goods", "baking", "tinned-goods",
  ]);
  const COAT_CLOSET = Object.freeze({
    bounds: Object.freeze({ minX: -15, maxX: -11.5, minZ: -3.2, maxZ: 1.6 }),
    center: Object.freeze({ x: -13.25, z: -0.8 }),
    hidePosition: Object.freeze({ x: -14.36, z: 0.28, yaw: -Math.PI / 2 }),
    exitPosition: Object.freeze({ x: -13.2, z: -1.58, yaw: 0 }),
  });

  const CONTESTANT_13 = Object.freeze({
    title: "Contestant 13",
    objectives: Object.freeze({
      note: "Search the Library for something a previous contestant left behind.",
      shovel: "The note points to a faceless figure among the roses.",
      maze: "Carry the concealed shovel into the hedge maze. Look for XIII in stone.",
      archive: "Use the brass A-3 key on the evidence cage in the basement Archive.",
      recording: "Load Contestant 13's recovered tape into the caged recorder.",
      relay: "Find the Workshop relay and sever the unlabeled patron feed.",
      complete: "The patron feed is blind. Signal loss has been noticed—leave the Workshop.",
    }),
    transcript: "If you found the garden copy, they missed one. The brass-tagged cameras are theatre. The patrons watch through the unlabelled black bank in the Workshop relay. Sever that whole bundle and their private feed goes blind.",
    journal: Object.freeze({
      note: Object.freeze({
        id: "contestant-13-note",
        title: "A note inside the rulebook",
        body: "The angel has no face. Follow the dead roses. I buried what they couldn't edit out. — 13",
      }),
      shovel: Object.freeze({
        id: "faceless-fountain-shovel",
        title: "The faceless fountain",
        body: "A short groundskeeper's shovel was woven beneath the rose stems east of the faceless fountain. XIII is carved into its wet handle.",
      }),
      cache: Object.freeze({
        id: "maze-cache-a3",
        title: "The buried cache",
        body: "Beneath a faint XIII scratched into the soil: an A-3 Archive key, Contestant 13's badge, and a sealed tape reel.",
      }),
      transcript: Object.freeze({
        id: "patron-feed-transcript",
        title: "Recovered recording",
        body: "The public cameras preserve the recruitment show. A separate unlabeled feed carries the real broadcast to the patrons through the Workshop relay.",
      }),
      sabotage: Object.freeze({
        id: "patron-feed-severed",
        title: "Signal lost",
        body: "The private feed is dead. The relay's warning lamp confirms that someone—or something—will come to inspect it.",
      }),
    }),
    itemLabels: Object.freeze({
      "garden-shovel": "Garden shovel",
      "archive-key-a3": "A-3 key",
      "contestant-13-badge": "Badge 13",
      "contestant-13-tape": "Tape reel",
    }),
    world: Object.freeze({
      shovel: Object.freeze({ x: -22.35, z: -5.50, yOffset: 0.16, scale: 0.56 }),
      digSite: Object.freeze({ row: 19, col: 3, pathStepsFromRear: 82, pathStepsFromNorth: 73 }),
    }),
  });

  // Keep the raised mid-landing and both flights on one authored datum. The
  // landing is deliberately above the halfway point so the foyer-to-ballroom
  // route has a generous finished head clearance beneath its fascia.
  const GRAND_STAIR = Object.freeze({
    MID_LANDING_RISE: 2.5,
    LOWER_STEP_COUNT: 14,
    UPPER_STEP_COUNT: 12,
  });

  const YARD_LAYOUT = Object.freeze({
    groundY: -0.205,
    bounds: Object.freeze({ minX: -34, maxX: 34, minZ: -34, maxZ: 34 }),
    driveway: Object.freeze({ centerX: 0, width: 6.6, minZ: 14.8, maxZ: 34 }),
    gate: Object.freeze({ centerX: 0, centerZ: 33.72, width: 6.8 }),
    // Pull the garden behind the facade while keeping its rear axis exactly on
    // the terrace centerline. A separate west-lawn approach reaches the front.
    garden: Object.freeze({ centerX: -25, centerZ: -2.2, width: 15, depth: 23.6, pathWidth: 2.1, frontJunctionZ: 16.3, rearJunctionZ: -14.0 }),
    pool: Object.freeze({ centerX: -9, centerZ: -25.5, width: 10.4, depth: 11.8 }),
    maze: Object.freeze({ centerX: 26.5, centerZ: -9.25 }),
  });

  // A long, narrow maze follows the whole east lawn from the rear grounds to
  // the front facade. # cells are clipped hedges, while S/E and dots are
  // walkable. E is an internal traversal goal rather than a boundary opening.
  // Its west edge leaves a broad house-side promenade.
  const HEDGE_MAZE_LAYOUT = Object.freeze({
    rows: Object.freeze([
      "#########",
      "#.#.....#",
      "#...#...#",
      "#...#...#",
      "#..##.#.#",
      "....#.#.#",
      "#.###.#.#",
      "#.#...#.#",
      "###.###.#",
      "#...#.#.#",
      "#.###.#.#",
      "#.#...#.#",
      "#.#...#.#",
      "#.#.#.#.#",
      "#.#.#.#.#",
      "#.#.#.#.#",
      "#.#.#.#.#",
      "#.#.#.#.#",
      "S.#.#.#.#",
      "#.#.#.#.#",
      "#####.#.#",
      "#.....#.#",
      "#...###.#",
      "#.#.#...#",
      "#.#.#..##",
      "#.#.#...#",
      "#.#.###.#",
      "#.#...#.#",
      "#.###.#.#",
      "#...#E..#",
      "#########",
    ]),
    cellSize: 1.5,
    centerX: 26.5,
    centerZ: -9.25,
  });
  const HEDGE_MAZE_PORTALS = Object.freeze([
    Object.freeze({ id: "rear", row: 18, col: 0 }),
    Object.freeze({ id: "north", row: 5, col: 0 }),
  ]);
  const HEDGE_MAZE_REAR_PORTAL = HEDGE_MAZE_PORTALS.find((portal) => portal.id === "rear");
  const HEDGE_MAZE_REAR_ENTRANCE = Object.freeze(mazeCellCenter(HEDGE_MAZE_REAR_PORTAL.row, HEDGE_MAZE_REAR_PORTAL.col));
  // Six evenly distributed pools replace the facade spots only while the
  // player is in the maze or on its west approach. This preserves the exact
  // fixed shader-light count that the frame-rate pass established.
  const MAZE_LIGHT_BUDGET_FIXTURES = Object.freeze([
    "maze-north-entrance-lamp-north",
    "maze-wayfinding-lamp-11",
    "maze-center-tall-lamp",
    "maze-rear-entrance-lamp-north",
    "maze-wayfinding-lamp-23",
    "maze-wayfinding-lamp-27",
  ]);

  const startupStartedAt = performance.now();
  const startupStageWidth = Math.max(1, Math.floor(dom.stage.getBoundingClientRect().width || window.innerWidth || MOBILE_RENDER_WIDTH));
  const startupCoarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const startupSafeGpuProfile = startupStageWidth < MOBILE_RENDER_WIDTH || (startupCoarsePointer && window.innerWidth < 1180);

  // Curated inspection points: two unobstructed, compositionally different
  // views for every named room/zone. QA uses these both as visual coverage and
  // as a guard against furniture drifting into circulation paths.
  const QA_ROOM_VIEWS = Object.freeze({
    libraryA: [-6.4, FLOOR.MAIN, 5.0, 2.25],
    libraryB: [-11.5, FLOOR.MAIN, 10.6, -0.72],
    libraryFireplace: [-7.45, FLOOR.MAIN, 10.25, -Math.PI / 2, -0.52],
    foyerA: [0, FLOOR.MAIN, 10.4, 0],
    frontThresholdSeam: [0, FLOOR.MAIN, 10.25, Math.PI, -0.58],
    foyerB: [-2.7, FLOOR.MAIN, 4.6, -2.47],
    foyerGrandChandelier: [0, FLOOR.MAIN, 10.45, 0, 0.82],
    musicRoomA: [6.4, FLOOR.MAIN, 5.0, -2.25],
    musicRoomB: [11.5, FLOOR.MAIN, 10.6, 0.72],
    musicRoomPortrait: [12.0, FLOOR.MAIN, 7.8, -Math.PI / 2],
    musicRoomFireplace: [7.45, FLOOR.MAIN, 10.25, Math.PI / 2, -0.52],
    mainHallBathroomA: [-6.5, FLOOR.MAIN, -2.15, 2.2],
    mainHallBathroomB: [-10.2, FLOOR.MAIN, 2.35, -0.72],
    mainHallBathroomShower: [-11.9, FLOOR.MAIN, 1.8, 2.1],
    mainHallBathroomShowerLight: [-11.9, FLOOR.MAIN, 1.8, 2.1, 0.65],
    mainHallSinkInteract: [-7.89, FLOOR.MAIN, -1.25, -0.18, -0.47],
    mainHallToiletInteract: [-9.55, FLOOR.MAIN, 0.25, Math.PI / 2, -0.62],
    mainHallBathroomSouthSwitch: [-8.75, FLOOR.MAIN, -2.0, 0, -0.28],
    mainHallBathroomNorthSwitch: [-8.5, FLOOR.MAIN, 2.0, Math.PI, -0.28],
    coatClosetDoor: [-13.2, FLOOR.MAIN, -4.05, Math.PI],
    coatClosetA: [-13.2, FLOOR.MAIN, -2.42, Math.PI],
    coatClosetB: [-12.1, FLOOR.MAIN, -0.65, Math.PI / 2],
    coatClosetHide: [-13.2, FLOOR.MAIN, -0.15, Math.PI / 2],
    stairHallA: [-4.25, FLOOR.MAIN, 2.4, -1.06],
    stairHallB: [4.25, FLOOR.MAIN, -2.5, 2.1],
    paintingRoomA: [6.0, FLOOR.MAIN, -2.35, -2.44],
    paintingRoomB: [9.8, FLOOR.MAIN, 2.45, 0.8],
    paintingRoomWestWall: [6.05, FLOOR.MAIN, 0, Math.PI / 2],
    paintingRoomEastWall: [9.25, FLOOR.MAIN, 0, -Math.PI / 2],
    paintingRoomOverview: [6.0, FLOOR.MAIN, -2.35, -2.44, -0.08],
    paintingRoomEaselFront: [7.15, FLOOR.MAIN, -1.65, -2.48, -0.06],
    paintingRoomEaselRear: [9.75, FLOOR.MAIN, 2.5, 0.28, -0.08],
    paintingRoomWestArt: [8.35, FLOOR.MAIN, 0, Math.PI / 2, 0],
    paintingRoomEastArt: [6.75, FLOOR.MAIN, -0.5, -Math.PI / 2, 0],
    paintingRoomNorthArt: [6.2, FLOOR.MAIN, 0.6, Math.PI, 0],
    paintingRoomSouthArt: [6.2, FLOOR.MAIN, -0.6, 0, 0],
    rearGalleryA: [-13.2, FLOOR.MAIN, -4.05, -Math.PI / 2],
    rearGalleryB: [13.2, FLOOR.MAIN, -4.05, Math.PI / 2],
    mainGalleryLastApplause: [10.1, FLOOR.MAIN, -5.2, Math.PI],
    diningA: [-13.7, FLOOR.MAIN, -10.7, -2.1],
    diningB: [-6.2, FLOOR.MAIN, -10.7, 2.15],
    ballroomA: [0, FLOOR.MAIN, -5.8, 0],
    ballroomB: [0, FLOOR.MAIN, -10.7, Math.PI],
    ballroomPortraits: [0, FLOOR.MAIN, -8.7, 0],
    mrFeastShowcase: [0, FLOOR.MAIN, -1.4, 0, -0.08],
    mrFeastSideProfile: [-3.2, FLOOR.MAIN, -9.0, -Math.PI / 2, 0],
    openRearFromStair: [0, FLOOR.MAIN, -2.35, 0],
    openRearToDining: [0, FLOOR.MAIN, -6.0, Math.PI / 2],
    openRearToKitchen: [0, FLOOR.MAIN, -6.0, -Math.PI / 2],
    kitchenBallroomReveal: [0, FLOOR.MAIN, -6.0, -Math.PI / 2, -0.06],
    kitchenOverview: [6.45, FLOOR.MAIN, -6.0, -0.83, -0.1],
    kitchenInnerCounter: [7.15, FLOOR.MAIN, -9.9, Math.PI / 2, -0.18],
    kitchenSinkInteract: [9.65, FLOOR.MAIN, -9.95, 0, -0.3],
    kitchenRange: [11.45, FLOOR.MAIN, -8.3, -Math.PI / 2, -0.16],
    kitchenRefrigerator: [10.8, FLOOR.MAIN, -6.6, -2.1, -0.12],
    kitchenExteriorWindows: [18.2, YARD_LAYOUT.groundY, -8.0, Math.PI / 2, -0.08],
    kitchenServiceStairDoor: [12.55, FLOOR.MAIN, -5.75, Math.PI],
    serviceStairTopLight: [14.0, FLOOR.MAIN, -1.2, 0.95, 0.6],
    serviceStairTopSwitch: [14.0, FLOOR.MAIN, -2.2, 0.32, -0.52],

    westFrontSuiteA: [-6.4, FLOOR.UPPER, 4.7, 2.31],
    westFrontSuiteB: [-13.0, FLOOR.UPPER, 10.6, -0.86],
    foyerBalconyA: [-4.3, FLOOR.UPPER, 7.2, -Math.PI / 2],
    foyerBalconyB: [4.3, FLOOR.UPPER, 7.2, Math.PI / 2],
    eastFrontSuiteA: [6.4, FLOOR.UPPER, 4.7, -2.31],
    eastFrontSuiteB: [13.0, FLOOR.UPPER, 10.6, 0.86],
    upperGrandBathroomA: [-6.0, FLOOR.UPPER, -2.35, 2.16],
    upperGrandBathroomB: [-10.6, FLOOR.UPPER, 2.55, -0.69],
    upperGrandBathroomC: [-13.2, FLOOR.UPPER, -2.45, Math.PI],
    upperGrandBathroomD: [-12.3, FLOOR.UPPER, -1.35, 2.2],
    upperGrandNorthSwitch: [-8.7, FLOOR.UPPER, 1.55, Math.PI, -0.24],
    upperGrandBathroomShower: [-12.0, FLOOR.UPPER, 0.2, 2.42],
    upperGrandBathroomShowerLight: [-11.9, FLOOR.UPPER, 1.8, 2.1, 0.65],
    upperGrandSinkInteract: [-8.76, FLOOR.UPPER, -1.25, -0.18, -0.47],
    upperGrandToiletInteract: [-12.65, FLOOR.UPPER, 0.2, Math.PI / 2, -0.61],
    upperLandingA: [-4.25, FLOOR.UPPER, -2.4, -2.08],
    upperLandingB: [4.25, FLOOR.UPPER, -2.4, 2.08],
    upperPortraits: [0, FLOOR.UPPER, -2.35, 0],
    upperRearRailA: [0, FLOOR.UPPER, -3.35, Math.PI],
    upperRearRailB: [-4.2, FLOOR.UPPER, -1.8, -Math.PI / 2],
    readingRoomA: [6.0, FLOOR.UPPER, -2.3, -2.23],
    readingRoomB: [13.0, FLOOR.UPPER, 2.5, 1.01],
    readingRoomSconce: [10.0, FLOOR.UPPER, 1.55, 0, -0.2],
    primarySuiteC: [-13.2, FLOOR.UPPER, -3.75, -Math.PI / 2],
    rearLoungeC: [0, FLOOR.UPPER, -3.75, 0],
    eastRearSuiteC: [13.2, FLOOR.UPPER, -3.75, Math.PI / 2],
    upperArtHouseDreams: [-12.5, FLOOR.UPPER, -5.0, Math.PI],
    upperArtBanquet: [-2.0, FLOOR.UPPER, -9.4, Math.PI / 2],
    upperArtOrchard: [3.7, FLOOR.UPPER, -9.2, -Math.PI / 2],
    upperArtLastApplause: [7.2, FLOOR.UPPER, -5.0, Math.PI],
    primarySuiteA: [-10.8, FLOOR.UPPER, -6.2, -0.91],
    primarySuiteB: [-6.3, FLOOR.UPPER, -10.6, 2.13],
    rearLoungeA: [-3.4, FLOOR.UPPER, -5.75, -0.93],
    rearLoungeB: [3.35, FLOOR.UPPER, -10.8, 2.21],
    rearLoungeFireplace: [-2.4, FLOOR.UPPER, -10.55, Math.PI / 2, -0.48],
    eastRearSuiteA: [10.8, FLOOR.UPPER, -6.2, 0.91],
    eastRearSuiteB: [6.3, FLOOR.UPPER, -10.6, -2.13],
    westFrontClosetRoom: [-12.8, FLOOR.UPPER, 5.8, 0],
    westFrontClosetInside: [-12.8, FLOOR.UPPER, 4.0, Math.PI],
    eastFrontClosetRoom: [12.8, FLOOR.UPPER, 5.8, 0],
    eastFrontClosetInside: [12.8, FLOOR.UPPER, 4.0, Math.PI],
    primaryClosetRoom: [-7.8, FLOOR.UPPER, -9.2, -Math.PI / 2],
    primaryClosetInside: [-6.3, FLOOR.UPPER, -9.2, -Math.PI / 2],
    eastRearClosetRoom: [7.8, FLOOR.UPPER, -9.2, Math.PI / 2],
    eastRearClosetInside: [6.3, FLOOR.UPPER, -9.2, Math.PI / 2],
    rearLoungeEntry: [-4.15, FLOOR.UPPER, -2.15, 0],
    primarySuiteLoungeDoor: [-4.05, FLOOR.UPPER, -6.4, Math.PI / 2],
    eastRearSuiteLoungeDoor: [4.05, FLOOR.UPPER, -6.4, -Math.PI / 2],

    wineCellarA: [-2.3, FLOOR.BASEMENT, 4.2, 2.2],
    wineCellarB: [-12.0, FLOOR.BASEMENT, 10.4, -0.9],
    archiveA: [4.9, FLOOR.BASEMENT, 4.0, Math.PI],
    archiveB: [13.3, FLOOR.BASEMENT, 7.2, Math.PI / 2],
    archiveRows: [3.0, FLOOR.BASEMENT, 7.2, -Math.PI / 2],
    archiveSkull: [9.0, FLOOR.BASEMENT, 9.4, Math.PI / 2],
    basementCorridorA: [0, FLOOR.BASEMENT, 10.8, 0],
    basementCorridorB: [0, FLOOR.BASEMENT, -2.5, Math.PI],
    laundryA: [-2.3, FLOOR.BASEMENT, -2.3, 2.0],
    laundryB: [-13.2, FLOOR.BASEMENT, 2.3, -1.15],
    pantryA: [2.3, FLOOR.BASEMENT, -2.3, -2.12],
    pantryB: [9.2, FLOOR.BASEMENT, 2.2, 0.93],
    pantryStorageNorth: [3.0, FLOOR.BASEMENT, -1.6, Math.PI, -0.08],
    pantryStorageSouth: [9.2, FLOOR.BASEMENT, 2.2, 0.93, -0.08],
    serviceStairA: [12.55, FLOOR.BASEMENT, 2.72, 0, 0.24],
    serviceStairB: [12.55, FLOOR.MAIN, -3.05, Math.PI, -0.45],
    serviceStairTopOblique: [10.95, FLOOR.MAIN, -2.05, -2.55, -0.5],
    serviceStairBottomLight: [12.55, FLOOR.BASEMENT, 2.9, Math.PI, 0.5],
    serviceStairBottomSwitch: [13.1, FLOOR.BASEMENT, 3.6, -0.87, -0.27],
    rearCrossCorridorA: [-13.2, FLOOR.BASEMENT, -4.05, -Math.PI / 2],
    rearCrossCorridorB: [13.2, FLOOR.BASEMENT, -4.05, Math.PI / 2],
    boilerRoomA: [-13.5, FLOOR.BASEMENT, -5.8, -0.9],
    boilerRoomB: [-6.65, FLOOR.BASEMENT, -10.8, 2.15],
    workshopA: [-5.4, FLOOR.BASEMENT, -5.8, -0.88],
    workshopB: [0.5, FLOOR.BASEMENT, -10.8, 2.27],
    coldRoomA: [2.0, FLOOR.BASEMENT, -5.8, -0.7],
    coldRoomB: [6.8, FLOOR.BASEMENT, -10.8, 2.4],
    bulkStorageA: [8.2, FLOOR.BASEMENT, -5.8, -0.86],
    bulkStorageB: [14.2, FLOOR.BASEMENT, -10.8, 2.25],

    yardGateA: [0, YARD_LAYOUT.groundY, 29.0, 0],
    yardGateB: [-8.0, YARD_LAYOUT.groundY, 31.2, -1.87],
    yardGateInteract: [0, YARD_LAYOUT.groundY, 31.2, Math.PI],
    yardGateWestSeam: [-3.52, YARD_LAYOUT.groundY, 31.2, Math.PI],
    yardGateEastSeam: [3.52, YARD_LAYOUT.groundY, 31.2, Math.PI],
    yardGardenA: [-18.2, YARD_LAYOUT.groundY, YARD_LAYOUT.garden.centerZ, Math.PI / 2, -0.13],
    yardGardenB: [-31.7, YARD_LAYOUT.groundY, YARD_LAYOUT.garden.centerZ, -Math.PI / 2, -0.13],
    yardGardenFrontJunction: [-15.2, YARD_LAYOUT.groundY, YARD_LAYOUT.garden.frontJunctionZ, Math.PI / 2, -0.08],
    yardGardenFrontApproach: [YARD_LAYOUT.garden.centerX, YARD_LAYOUT.groundY, 15.15, 0, -0.18],
    yardGardenRearJunction: [-15.2, YARD_LAYOUT.groundY, YARD_LAYOUT.garden.rearJunctionZ, Math.PI / 2, -0.08],
    yardPoolA: [-1.8, YARD_LAYOUT.groundY, -21.8, 1.13, -0.08],
    yardPoolB: [-16.2, YARD_LAYOUT.groundY, -30.4, -2.11, -0.06],
    yardPoolSteps: [-9, YARD_LAYOUT.groundY, -18.25, 0, -0.14],
    yardPoolBottom: [-9, -1.58, -22.35, Math.PI, -0.04],
    // Cross laterally from the west lawn onto the north pool-deck support.
    // This deliberately stays outside the coping; pool entry has its own route.
    yardPoolNorthGuard: [-16, YARD_LAYOUT.groundY, -18.85, -Math.PI / 2, -0.08],
    yardPoolEastEntry: [-1, YARD_LAYOUT.groundY, -25.0, Math.PI / 2, -0.08],
    yardMazeA: [18.45, YARD_LAYOUT.groundY, HEDGE_MAZE_REAR_ENTRANCE.z, -Math.PI / 2, -0.08],
    yardMazeB: [19.15, YARD_LAYOUT.groundY, 14.2, -2.42, -0.09],
    yardMazeEntranceCell: [HEDGE_MAZE_REAR_ENTRANCE.x, YARD_LAYOUT.groundY, HEDGE_MAZE_REAR_ENTRANCE.z, -Math.PI / 2],
    yardMazeNorthEntrance: [18.45, YARD_LAYOUT.groundY, 5.75, -Math.PI / 2],
    yardMazeNorthEntranceCell: [20.5, YARD_LAYOUT.groundY, 5.75, -Math.PI / 2],
    yardEastFrontConnector: [16.8, YARD_LAYOUT.groundY, 13.2, Math.PI, -0.08],
    yardMazeSouthGoal: [28, YARD_LAYOUT.groundY, -30.25, 0],
    yardMazeSouthWallExterior: [26.5, YARD_LAYOUT.groundY, -33.0, Math.PI, -0.18],
    yardRearCirculationA: [0, YARD_LAYOUT.groundY, -15.6, Math.PI],
    yardRearCirculationB: [14.0, YARD_LAYOUT.groundY, HEDGE_MAZE_REAR_ENTRANCE.z, Math.PI],
    yardGardenApproach: [-17.0, YARD_LAYOUT.groundY, YARD_LAYOUT.garden.rearJunctionZ, Math.PI / 2],
    yardExteriorSwitch: [1.72, YARD_LAYOUT.groundY, 13.65, 0, -0.26],
    yardBoundarySouth: [10.0, YARD_LAYOUT.groundY, -31.15, 0],
    yardBoundaryWest: [-31.15, YARD_LAYOUT.groundY, 0, Math.PI / 2],
    yardBoundaryEast: [31.15, YARD_LAYOUT.groundY, 0, -Math.PI / 2],
    yardTerraceDoorInside: [-0.62, FLOOR.MAIN, -10.35, 0],
    yardFacadeFront: [8.0, YARD_LAYOUT.groundY, 17.0, 0, -0.24],
    frontPorticoChandelier: [0, YARD_LAYOUT.groundY, 16.45, 0, 0.42],
    yardFrontReentry: [0, YARD_LAYOUT.groundY, 13.55, 0, -0.08],
    yardRearReentry: [0, YARD_LAYOUT.groundY, -13.55, Math.PI, -0.08],
    yardFrontOuterStep: [0, YARD_LAYOUT.groundY, 16.55, 0, -0.08],
    yardRearOuterStep: [0, YARD_LAYOUT.groundY, -16.55, Math.PI, -0.08],
    yardMazeCenterLamp: [25, YARD_LAYOUT.groundY, -10.8, Math.PI, -0.1],
    contestant13LibraryNote: [-10.5, FLOOR.MAIN, 6.35, 0, -0.5],
    contestant13GardenShovel: [-22.28, YARD_LAYOUT.groundY, -4.05, 0, -0.75],
    contestant13DigSite: [25, YARD_LAYOUT.groundY, -13.90, 0, -0.93],
    contestant13ArchiveCage: [13.15, FLOOR.BASEMENT, 5.25, Math.PI / 2, -0.14],
    contestant13WorkshopRelay: [-2.5, FLOOR.BASEMENT, -10.0, 0, -0.12],
  });

  const state = {
    started: false,
    ready: false,
    loadFailed: false,
    failureAction: null,
    pointerLocked: false,
    reducedFlash: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    audioEnabled: false,
    yaw: 0,
    pitch: 0,
    currentFloor: "MAIN LEVEL",
    currentRoom: "FRONT FOYER",
    mazeLightingContext: false,
    currentInteraction: null,
    isHidden: false,
    activeHideSpot: null,
    journalOpen: false,
    contestant13: {
      noteRead: false,
      shovelTaken: false,
      digSiteExcavated: false,
      archiveKeyFound: false,
      badgeFound: false,
      tapeFound: false,
      archiveCageUnlocked: false,
      recordingPlayed: false,
      relaySabotaged: false,
      threatEscalated: false,
      digging: false,
      actionInProgress: null,
      inventory: [],
      journalEntries: [],
    },
    lastMove: { dx: 0, dz: 0 },
    qaRoute: null,
    frameTime: 0,
    fps: 0,
    renderQuality: "high",
    mobileRenderProfile: startupStageWidth < MOBILE_RENDER_WIDTH,
    startupPhase: "Creating renderer",
    startupReadyMs: null,
    contextLost: false,
    qa: new URLSearchParams(location.search).has("qa"),
  };

  const qaParams = new URLSearchParams(location.search);
  let initWatchdog = null;

  const input = {
    forward: false,
    back: false,
    left: false,
    right: false,
    touchLookId: null,
    touchLookX: 0,
    touchLookY: 0,
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x080b12, 0.015);

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.06, 120);
  camera.rotation.order = "YXZ";
  camera.position.set(0, PLAYER.eye, 10.2);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: dom.canvas,
      antialias: !startupSafeGpuProfile,
      alpha: false,
      preserveDrawingBuffer: state.qa,
      powerPreference: startupSafeGpuProfile ? "default" : "high-performance",
    });
  } catch (error) {
    console.error("The Hollow Estate could not create a WebGL renderer", error);
    const message = "WebGL could not start. Enable hardware acceleration, then retry the mansion.";
    dom.stage.setAttribute("aria-busy", "false");
    if (dom.loading) {
      dom.loading.hidden = false;
      dom.loading.setAttribute("role", "alert");
      dom.loading.textContent = message;
    }
    if (dom.introLead) dom.introLead.textContent = message;
    if (dom.enter) {
      dom.enter.disabled = false;
      dom.enter.removeAttribute("aria-disabled");
      dom.enter.textContent = "Retry loading";
      dom.enter.addEventListener("click", () => location.reload());
    }
    return;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = NIGHT_LIGHTING.exposure;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = !startupSafeGpuProfile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The estate is static between interactions. Cache the expensive moon
  // shadow map and request a refresh only while a door or cabinet is moving.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.setClearColor(0x05070d, 1);
  const rendererContextAttributes = renderer.getContext().getContextAttributes() || {};
  // WebGL1 guarantees only eight fragment samplers. Keep the two optional
  // shared-wall shadow maps for modern contexts, but fall back to their tight
  // bounded cones when material maps and the moon would exceed that floor.
  const supportsFullRoomShadowSet = renderer.shadowMap.enabled && renderer.capabilities.maxTextures >= 16;

  dom.canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    state.contextLost = true;
    state.ready = false;
    clearTimeout(initWatchdog);
    showLoadFailure("The mansion ran out of graphics memory. Retry loading in safe mode.");
  });

  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  raycaster.far = PLAYER.interactionRange;
  const lookCenter = new THREE.Vector2(0, 0);
  const interactableMeshes = [];
  const occluderMeshes = [];
  const animatedObjects = [];
  const circuits = [];
  const waterFixtures = [];
  const toilets = [];
  const fireplaces = [];
  const stockedStorages = [];
  const refrigerators = [];
  const kitchenTaskBulbs = [];
  const hidingSpots = [];
  const roomZones = [];
  const lightningMaterials = [];
  const yardWaterSystems = [];
  const auxiliaryInteriorLights = [];
  const mobileShaderPaddingLights = { spots: [], points: [] };
  const fadingLights = new Set();
  const fadingBulbs = new Set();
  const contestant13Scene = {
    libraryNote: null,
    shovel: null,
    digMound: null,
    digMarker: null,
    digHole: null,
    archiveRecorderRoot: null,
    archiveRecorderDeck: null,
    archiveRecorderIndicator: null,
    archiveRecorderIndicatorMaterial: null,
    archiveCageDoor: null,
    relayBlackCables: null,
    relayOnlineBulb: null,
    relayAlarmBulb: null,
    relayAlarmMaterial: null,
  };
  let contestant13Quest = null;
  let mrFeastNpc = null;
  let hemisphereLight = null;
  let moonLight = null;
  // Every opening in the mansion shell the storm can be heard through:
  // exterior windows (fixed glass attenuation) plus the exterior doors,
  // whose openness follows the actual door swing.
  const rainApertures = [];
  const exteriorRainDoors = [];
  const portraitTextures = new Map();
  const portraitPlacements = [];
  const interiorDetailMeshes = [];
  const facadeSideMeshes = [];
  const outdoorRoomNames = new Set(["FRONT DRIVE", "FORMAL GARDEN", "POOL TERRACE", "HEDGE MAZE", "REAR LAWN", "EAST LAWN", "WEST LAWN"]);
  let interiorDetailsHidden = false;
  let facadeVisibilityKey = "all";
  let exteriorDistanceFromHouse = 0;
  let exteriorNearHouse = true;
  let lightRenderPolicy = "manual-circuits-context-stable:main-interior";
  const yardState = {
    perimeterClosed: false,
    perimeterSegments: null,
    perimeterUncoveredIntervals: [],
    gate: { locked: true, open: false, colliderEnabled: true, deniedAttempts: 0 },
    maze: { rows: 0, columns: 0, entrance: null, southGoal: null, shortestPathLength: 0 },
    featureCounts: {
      perimeterHedgeRuns: 0,
      gardenBeds: 0,
      gardenPlants: 0,
      poolComponents: 0,
      mazeHedges: 0,
      exteriorLamps: 0,
      estateTrees: 0,
    },
    circuit: null,
  };
  let RAPIER = null;
  let physics = null;
  let audioSystem = null;
  let rainSystem = null;
  let stormSystem = null;

  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;
  const ease = (current, target, speed, dt) => lerp(current, target, 1 - Math.exp(-speed * dt));

  function setLoading(message, percent) {
    state.startupPhase = message;
    if (!dom.loading) return;
    dom.loading.textContent = percent == null ? message : `${message} ${Math.round(percent)}%`;
    dom.loading.dataset.progress = percent == null ? "" : String(percent);
  }

  function showLoadFailure(message, action = "retry") {
    boot?.settle();
    state.loadFailed = true;
    state.failureAction = action;
    dom.stage.setAttribute("aria-busy", "false");
    if (dom.loading) {
      dom.loading.hidden = false;
      dom.loading.setAttribute("role", "alert");
      setLoading(message);
    }
    if (dom.introLead) dom.introLead.textContent = message;
    if (dom.enter) {
      dom.enter.disabled = false;
      dom.enter.removeAttribute("aria-disabled");
      dom.enter.textContent = action === "server" ? "Server running? Open game" : "Retry loading";
    }
  }

  function handleEnterClick() {
    if (state.ready) {
      startExploration();
      return;
    }
    if (!state.loadFailed) return;
    if (state.failureAction === "server") {
      location.href = LOCAL_SERVER_URL;
      return;
    }
    location.reload();
  }

  function textureUrl(name) {
    return `../assets/textures/mr-feast/generated/${name}`;
  }

  function makeNoiseTexture(size, colors, seed) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    let s = seed || 1234567;
    const random = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const c = colors[Math.floor(random() * colors.length)];
      image.data[i] = c[0];
      image.data[i + 1] = c[1];
      image.data[i + 2] = c[2];
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    return texture;
  }

  function makeRadialGlowTexture(size) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, "rgba(255,255,255,0.92)");
    gradient.addColorStop(0.42, "rgba(255,255,255,0.38)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    return texture;
  }

  function makeFireFlameTexture(size) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const center = size / 2;
    const flame = ctx.createRadialGradient(center, size * 0.72, size * 0.03, center, size * 0.62, size * 0.48);
    flame.addColorStop(0, "rgba(255,255,230,1)");
    flame.addColorStop(0.2, "rgba(255,214,92,0.98)");
    flame.addColorStop(0.52, "rgba(255,91,16,0.9)");
    flame.addColorStop(1, "rgba(110,8,0,0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(center, size * 0.04);
    ctx.bezierCurveTo(size * 0.77, size * 0.34, size * 0.86, size * 0.67, center, size * 0.96);
    ctx.bezierCurveTo(size * 0.14, size * 0.68, size * 0.26, size * 0.34, center, size * 0.04);
    ctx.closePath();
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeExoticRugTexture(size) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const center = size / 2;

    // A dark garnet field keeps the lounge grounded while the restrained
    // turquoise and antique-gold ornament reads like an imported textile.
    const field = ctx.createRadialGradient(center, center, size * 0.04, center, center, size * 0.72);
    field.addColorStop(0, "#762b32");
    field.addColorStop(0.48, "#4b151f");
    field.addColorStop(1, "#210911");
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, size, size);

    const gold = ctx.createLinearGradient(0, 0, size, size);
    gold.addColorStop(0, "#8d672a");
    gold.addColorStop(0.5, "#e0ba67");
    gold.addColorStop(1, "#72501d");
    for (const [inset, width, color] of [
      [8, 14, "#16070b"],
      [20, 5, gold],
      [31, 12, "#174b49"],
      [46, 4, gold],
      [56, 3, "#c9b77d"],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    }

    const drawDiamond = (x, y, radius, fill, stroke) => {
      ctx.beginPath();
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, radius * 0.14);
      ctx.stroke();
    };
    for (let p = 76; p <= size - 76; p += 42) {
      drawDiamond(p, 32, 10, "#d6b466", "#432014");
      drawDiamond(p, size - 32, 10, "#d6b466", "#432014");
      drawDiamond(32, p, 10, "#d6b466", "#432014");
      drawDiamond(size - 32, p, 10, "#d6b466", "#432014");
    }

    const drawMedallion = (x, y, radius, rotation = 0) => {
      // Alternating long and short points form an eight-lobed arabesque.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      for (let i = 0; i < 32; i += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 32;
        const r = i % 4 === 0 ? radius : i % 2 === 0 ? radius * 0.68 : radius * 0.42;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "#1d6661";
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = Math.max(2, radius * 0.08);
      ctx.stroke();
      drawDiamond(0, 0, radius * 0.32, "#d8bd7a", "#54212a");
      ctx.restore();
    };

    drawMedallion(center, center, size * 0.2, Math.PI / 8);
    for (const [x, y] of [[126, 126], [size - 126, 126], [126, size - 126], [size - 126, size - 126]]) {
      drawMedallion(x, y, size * 0.07, Math.PI / 8);
    }
    for (let y = 104; y <= size - 104; y += 76) {
      for (let x = 104; x <= size - 104; x += 76) {
        if (Math.hypot(x - center, y - center) > size * 0.22) drawDiamond(x, y, 9, "#c8a75d", "#245b56");
      }
    }

    // Fine irregular warp lines soften the procedural geometry and give the
    // surface a woven finish under the lounge's warm ceiling light.
    ctx.globalAlpha = 0.12;
    for (let p = 2; p < size; p += 4) {
      ctx.strokeStyle = p % 12 === 0 ? "#f0d9a0" : "#120508";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p + Math.sin(p * 0.17) * 1.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeFoyerRugTexture(size) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const center = size / 2;

    // The front-door sightline lands on an eccentric mourning carpet: bruised
    // oxblood sinks toward a nearly black center while tarnished gold, bone,
    // and sickly teal ornament suggest a ceremonial textile with a bad history.
    const field = ctx.createRadialGradient(center, center, size * 0.03, center, center, size * 0.72);
    field.addColorStop(0, "#321020");
    field.addColorStop(0.38, "#1d0915");
    field.addColorStop(0.72, "#11070f");
    field.addColorStop(1, "#050307");
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, size, size);

    const gold = ctx.createLinearGradient(0, size, size, 0);
    gold.addColorStop(0, "#4d351c");
    gold.addColorStop(0.46, "#b58b4b");
    gold.addColorStop(0.62, "#d0b16d");
    gold.addColorStop(1, "#5b3b20");
    for (const [inset, width, color] of [
      [7, 13, "#020204"],
      [19, 5, gold],
      [31, 12, "#351333"],
      [44, 4, "#aa8144"],
      [54, 7, "#0a2f31"],
      [64, 2, "#c9b783"],
      [71, 4, "#34101c"],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    }

    const drawInwardTooth = (x, y, rotation, long) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(0, long ? 19 : 13);
      ctx.lineTo(7, 0);
      ctx.closePath();
      ctx.fillStyle = long ? "#c5ad72" : "#6a2330";
      ctx.fill();
      ctx.strokeStyle = "#171014";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    };

    // Uneven inward-pointing teeth break the old polite symmetry and give the
    // border the silhouette of a ceremonial trap closing around the field.
    for (let p = 82, index = 0; p <= size - 82; p += 34, index += 1) {
      const long = index % 3 === 1;
      drawInwardTooth(p, 38, 0, long);
      drawInwardTooth(size - p, size - 38, Math.PI, long);
      drawInwardTooth(38, size - p, Math.PI / 2, !long);
      drawInwardTooth(size - 38, p, -Math.PI / 2, !long);
    }

    const drawEye = (x, y, width, height, rotation, irisColor = "#164f4c") => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(-width / 2, 0);
      ctx.quadraticCurveTo(0, -height, width / 2, 0);
      ctx.quadraticCurveTo(0, height, -width / 2, 0);
      ctx.closePath();
      ctx.fillStyle = "#b9aa82";
      ctx.fill();
      ctx.strokeStyle = "#75502b";
      ctx.lineWidth = Math.max(2, width * 0.045);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, height * 0.62, height * 0.78, 0, 0, Math.PI * 2);
      ctx.fillStyle = irisColor;
      ctx.fill();
      ctx.strokeStyle = "#09070a";
      ctx.lineWidth = Math.max(1.5, width * 0.025);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, height * 0.12, height * 0.58, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#030204";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-height * 0.18, -height * 0.2, Math.max(1.5, height * 0.08), 0, Math.PI * 2);
      ctx.fillStyle = "#ddd1a6";
      ctx.fill();
      ctx.restore();
    };

    const drawEclipsedMedallion = (x, y, radius) => {
      ctx.save();
      ctx.translate(x, y);
      // Seventeen rays refuse perfect bilateral symmetry; alternating dried
      // blood and bone makes the black center feel like an eclipsed eye.
      for (let i = 0; i < 17; i += 1) {
        const angle = -Math.PI / 2 + (i / 17) * Math.PI * 2;
        const outer = radius * (i % 4 === 0 ? 1.18 : i % 2 ? 0.96 : 1.08);
        const inner = radius * 0.62;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle - 0.055) * inner, Math.sin(angle - 0.055) * inner);
        ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
        ctx.lineTo(Math.cos(angle + 0.055) * inner, Math.sin(angle + 0.055) * inner);
        ctx.closePath();
        ctx.fillStyle = i % 3 === 0 ? "#cab77e" : "#5e1c2b";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.69, 0, Math.PI * 2);
      ctx.fillStyle = "#0b3335";
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = Math.max(4, radius * 0.06);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = "#020204";
      ctx.fill();
      ctx.strokeStyle = "#4c1734";
      ctx.lineWidth = Math.max(3, radius * 0.05);
      ctx.stroke();
      ctx.restore();
      // Keep the dominant eye exactly on the medallion and rug centerline;
      // the odd ray count and satellite eyes provide the intended asymmetry.
      drawEye(x, y, radius * 0.92, radius * 0.34, 0, "#235c54");
    };

    // Broken orbital rings and seven watchful satellites make the central
    // eclipsed-eye medallion feel stranger the longer the player looks at it.
    ctx.save();
    ctx.translate(center, center);
    ctx.strokeStyle = "#8b6737";
    ctx.lineWidth = 3;
    ctx.setLineDash([34, 13, 8, 18]);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.305, size * 0.235, -0.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    drawEclipsedMedallion(center, center, size * 0.19);
    for (let i = 0; i < 7; i += 1) {
      const angle = -Math.PI / 2 + (i / 7) * Math.PI * 2 + 0.12;
      drawEye(
        center + Math.cos(angle) * size * 0.305,
        center + Math.sin(angle) * size * 0.235,
        size * 0.067,
        size * 0.022,
        angle + Math.PI / 2,
        i % 2 ? "#4b1c3f" : "#154844",
      );
    }

    // Mirrored thorn filigree grows inward from each corner, but the last curl
    // is deliberately missing from one quadrant to keep the pattern uncanny.
    for (const [x, y, sx, sy] of [
      [94, 94, 1, 1],
      [size - 94, 94, -1, 1],
      [94, size - 94, 1, -1],
      [size - 94, size - 94, -1, -1],
    ]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.strokeStyle = "#9d7841";
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-7, 34);
      ctx.bezierCurveTo(2, 5, 26, -13, 48, -36);
      ctx.bezierCurveTo(61, -49, 57, -63, 44, -68);
      ctx.stroke();
      for (const [tx, ty, rotation] of [[11, 2, 0.7], [29, -18, 0.9], [46, -39, 1.2]]) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(rotation);
        ctx.beginPath();
        ctx.moveTo(0, -15);
        ctx.lineTo(7, 9);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fillStyle = ty === -18 ? "#56202d" : "#103e3d";
        ctx.fill();
        ctx.strokeStyle = "#b18b50";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // A hairline vertical fracture points from the front doors into the pupil.
    ctx.strokeStyle = "rgba(198,171,111,0.38)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center + 3, 76);
    ctx.bezierCurveTo(center - 9, 145, center + 8, 191, center + 4, center - 45);
    ctx.stroke();

    // Fine warp and weft keeps all the ominous geometry tactile under the
    // chandelier without adding geometry, lights, or another draw call.
    ctx.globalAlpha = 0.1;
    for (let p = 2; p < size; p += 4) {
      ctx.strokeStyle = p % 16 === 0 ? "#b9a572" : "#030205";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p + Math.sin(p * 0.19) * 1.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeSalonRugTexture(size, room) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const center = size / 2;
    const library = room === "library";
    const palette = library
      ? { center: "#315a49", mid: "#17372f", edge: "#081b18", accent: "#6d2830", darkAccent: "#321218", jewel: "#244f55", gold: "#d2b16b", pale: "#ead59d" }
      : { center: "#6a2f3b", mid: "#401823", edge: "#180810", accent: "#203d55", darkAccent: "#0c202d", jewel: "#355d62", gold: "#d7b66d", pale: "#edd8a4" };

    // These companion carpets borrow the foyer and lounge's antique-gold
    // borders and dense central ornament, then shift the field color to suit
    // each room: scholarly green for the library and claret for the music room.
    const field = ctx.createRadialGradient(center, center, size * 0.03, center, center, size * 0.72);
    field.addColorStop(0, palette.center);
    field.addColorStop(0.54, palette.mid);
    field.addColorStop(1, palette.edge);
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, size, size);

    const gold = ctx.createLinearGradient(0, size, size, 0);
    gold.addColorStop(0, "#76501f");
    gold.addColorStop(0.5, palette.pale);
    gold.addColorStop(1, "#8d6427");
    for (const [inset, width, color] of [
      [7, 12, palette.edge],
      [19, 5, gold],
      [30, 13, palette.accent],
      [44, 4, gold],
      [54, 3, palette.pale],
      [63, 2, palette.darkAccent],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    }

    const drawDiamond = (x, y, radius, fill, stroke) => {
      ctx.beginPath();
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1.5, radius * 0.14);
      ctx.stroke();
    };

    for (let p = 78; p <= size - 78; p += 40) {
      drawDiamond(p, 36, 9, palette.gold, palette.darkAccent);
      drawDiamond(p, size - 36, 9, palette.gold, palette.darkAccent);
      drawDiamond(36, p, 9, palette.gold, palette.darkAccent);
      drawDiamond(size - 36, p, 9, palette.gold, palette.darkAccent);
    }

    const drawLeaf = (x, y, length, width, rotation, fill) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(0, -length);
      ctx.bezierCurveTo(width, -length * 0.55, width, length * 0.56, 0, length);
      ctx.bezierCurveTo(-width, length * 0.56, -width, -length * 0.55, 0, -length);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = palette.gold;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
    };

    // A sixteen-petal medallion reads clearly under furniture while the four
    // smaller corner ornaments keep the large carpet from feeling empty.
    const drawMedallion = (x, y, radius, rotation = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
      ctx.fillStyle = palette.darkAccent;
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = Math.max(3, radius * 0.06);
      ctx.stroke();
      for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * Math.PI * 2;
        drawLeaf(
          Math.cos(angle) * radius * 0.33,
          Math.sin(angle) * radius * 0.33,
          radius * (i % 2 ? 0.35 : 0.44),
          radius * 0.12,
          angle + Math.PI / 2,
          i % 2 ? palette.jewel : palette.gold,
        );
      }
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = palette.center;
      ctx.fill();
      ctx.strokeStyle = palette.pale;
      ctx.lineWidth = Math.max(2, radius * 0.04);
      ctx.stroke();
      drawDiamond(0, 0, radius * 0.11, palette.pale, palette.darkAccent);
      ctx.restore();
    };

    drawMedallion(center, center, size * 0.19, library ? Math.PI / 16 : 0);
    for (const [x, y, rotation] of [
      [116, 116, Math.PI / 4],
      [size - 116, 116, -Math.PI / 4],
      [116, size - 116, -Math.PI / 4],
      [size - 116, size - 116, Math.PI / 4],
    ]) drawMedallion(x, y, size * 0.055, rotation);

    // Scrolling vines make the music-room version feel lyrical; the library
    // uses the same curves as quieter botanical bookplate ornament.
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.84;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(center, center + side * size * 0.21);
      ctx.bezierCurveTo(center - 70, center + side * size * 0.27, center - 112, center + side * size * 0.18, center - 132, center + side * size * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(center, center + side * size * 0.21);
      ctx.bezierCurveTo(center + 70, center + side * size * 0.27, center + 112, center + side * size * 0.18, center + 132, center + side * size * 0.1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Fine warp lines temper the crisp canvas shapes into a woven surface.
    ctx.globalAlpha = 0.11;
    for (let p = 2; p < size; p += 4) {
      ctx.strokeStyle = p % 12 === 0 ? palette.pale : "#080405";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p + Math.sin(p * 0.18) * 1.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function loadTexture(url, repeatX, repeatY, encoding) {
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(repeatX, repeatY);
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          if (encoding) texture.encoding = encoding;
          resolve(texture);
        },
        undefined,
        () => resolve(null)
      );
    });
  }

  function loadArtworkTexture(url) {
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          // Portrait JPEGs are deliberately NPOT. Clamp and skip mipmaps so
          // the collection remains valid on the WebGL1 fallback path.
          texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.magFilter = THREE.LinearFilter;
          texture.minFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          texture.encoding = THREE.sRGBEncoding;
          resolve(texture);
        },
        undefined,
        () => resolve(null),
      );
    });
  }

  async function createMaterials() {
    setLoading("Preparing the estate", 8);
    const [damask, oak, stone, marble, artworkEntries] = await Promise.all([
      loadTexture(textureUrl("blue-damask-wallpaper-ai.jpg"), 3.2, 2.4, THREE.sRGBEncoding),
      loadTexture(textureUrl("smoked-oak-herringbone-ai.jpg"), 7, 7, THREE.sRGBEncoding),
      loadTexture(textureUrl("damp-limestone-ai.jpg"), 5.5, 3.2, THREE.sRGBEncoding),
      loadTexture(textureUrl("antique-marble-ai.jpg"), 5, 5, THREE.sRGBEncoding),
      Promise.all(Object.entries(PORTRAIT_ARTWORKS).map(async ([artId, artwork]) => [artId, await loadArtworkTexture(textureUrl(artwork.file))])),
    ]);
    for (const [artId, texture] of artworkEntries) {
      if (texture) portraitTextures.set(artId, texture);
    }

    const fallbackDark = makeNoiseTexture(128, [[39, 34, 33], [48, 40, 36], [32, 29, 30]], 91);
    const fallbackStone = makeNoiseTexture(128, [[64, 68, 67], [73, 77, 75], [51, 55, 55]], 712);
    const leafMap = makeNoiseTexture(128, [[17, 42, 31], [23, 55, 39], [11, 33, 26], [31, 64, 42]], 1887);
    const soilMap = makeNoiseTexture(128, [[45, 31, 23], [56, 38, 25], [34, 28, 24], [62, 44, 28]], 9241);
    const paverMap = makeNoiseTexture(128, [[78, 82, 78], [91, 91, 84], [63, 68, 65], [105, 101, 91]], 4771);
    const exoticRugMap = makeExoticRugTexture(512);
    const foyerRugMap = makeFoyerRugTexture(512);
    const libraryRugMap = makeSalonRugTexture(512, "library");
    const musicRugMap = makeSalonRugTexture(512, "music");
    const fireFlameMap = makeFireFlameTexture(128);
    leafMap.repeat.set(5, 5);
    soilMap.repeat.set(7, 7);
    paverMap.repeat.set(8, 12);
    const oakMap = oak || fallbackDark;
    const stoneMap = stone || fallbackStone;
    const damaskMap = damask || fallbackDark;
    const marbleMap = marble || fallbackStone;

    return {
      wallpaper: new THREE.MeshStandardMaterial({ map: damaskMap, roughness: 0.82, metalness: 0, bumpMap: damaskMap, bumpScale: 0.018 }),
      wallpaperFaded: new THREE.MeshStandardMaterial({ map: damaskMap, color: 0x807a72, roughness: 0.9, bumpMap: damaskMap, bumpScale: 0.012 }),
      oakFloor: new THREE.MeshStandardMaterial({ map: oakMap, roughness: 0.5, metalness: 0, bumpMap: oakMap, bumpScale: 0.025 }),
      darkWood: new THREE.MeshStandardMaterial({ map: oakMap, color: 0x5a3525, roughness: 0.46, bumpMap: oakMap, bumpScale: 0.018 }),
      blackWood: new THREE.MeshStandardMaterial({ map: oakMap, color: 0x241a17, roughness: 0.58, bumpMap: oakMap, bumpScale: 0.012 }),
      limestone: new THREE.MeshStandardMaterial({ map: stoneMap, color: 0xa0a5a1, roughness: 0.92, bumpMap: stoneMap, bumpScale: 0.08 }),
      marble: new THREE.MeshPhysicalMaterial({ map: marbleMap, color: 0x7a766f, roughness: 0.38, metalness: 0, clearcoat: 0.16, clearcoatRoughness: 0.42, bumpMap: marbleMap, bumpScale: 0.012 }),
      stairMarble: new THREE.MeshPhysicalMaterial({ map: marbleMap, color: 0x56514b, roughness: 0.5, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.55, bumpMap: marbleMap, bumpScale: 0.0035 }),
      plaster: new THREE.MeshStandardMaterial({ color: 0xaaa49a, roughness: 0.92 }),
      canvasLinen: new THREE.MeshStandardMaterial({ color: 0xb9a483, roughness: 0.98, metalness: 0, emissive: 0x2a1d12, emissiveIntensity: 0.14 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.98 }),
      trim: new THREE.MeshStandardMaterial({ color: 0xb5aa91, roughness: 0.52 }),
      agedTrim: new THREE.MeshStandardMaterial({ color: 0x716d61, roughness: 0.7 }),
      brass: new THREE.MeshStandardMaterial({ color: 0x9b7338, metalness: 0.78, roughness: 0.28 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x14171a, metalness: 0.62, roughness: 0.48 }),
      copper: new THREE.MeshStandardMaterial({ color: 0x6c3927, metalness: 0.67, roughness: 0.42 }),
      velvet: new THREE.MeshStandardMaterial({ color: 0x241017, roughness: 0.94 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x33221a, roughness: 0.78 }),
      fabric: new THREE.MeshStandardMaterial({ color: 0x4a5358, roughness: 0.96 }),
      porcelain: new THREE.MeshPhysicalMaterial({ color: 0xc9c6b9, roughness: 0.18, clearcoat: 0.72 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x6f86a0, transparent: true, opacity: 0.25, roughness: 0.12, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
      frostedShade: new THREE.MeshPhysicalMaterial({ color: 0xffddb2, transparent: true, opacity: 0.58, roughness: 0.62, metalness: 0, transmission: 0.08, side: THREE.DoubleSide, depthWrite: false }),
      water: new THREE.MeshPhysicalMaterial({ color: 0x7fb8cf, transparent: true, opacity: 0, roughness: 0.08, metalness: 0.02, transmission: 0.35, depthWrite: false }),
      mirror: new THREE.MeshPhysicalMaterial({ color: 0x9aa8b3, metalness: 0.82, roughness: 0.12 }),
      enamel: new THREE.MeshPhysicalMaterial({ color: 0xc8c5bc, roughness: 0.28, metalness: 0.14, clearcoat: 0.32 }),
      foodBox: new THREE.MeshStandardMaterial({ color: 0x8e5e35, roughness: 0.76 }),
      foodTin: new THREE.MeshStandardMaterial({ color: 0x9d8b6b, metalness: 0.42, roughness: 0.38 }),
      foodBottle: new THREE.MeshPhysicalMaterial({ color: 0x315b46, roughness: 0.28, metalness: 0.05, transparent: true, opacity: 0.84 }),
      produce: new THREE.MeshStandardMaterial({ color: 0x6d793b, roughness: 0.86 }),
      fireOuter: new THREE.SpriteMaterial({ map: fireFlameMap, color: 0xff6a18, transparent: true, opacity: 0.86, depthWrite: false, blending: THREE.AdditiveBlending }),
      fireInner: new THREE.SpriteMaterial({ map: fireFlameMap, color: 0xffe08a, transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending }),
      fireGlow: new THREE.MeshBasicMaterial({ map: makeRadialGlowTexture(128), color: 0xff5a12, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      fireEmber: new THREE.MeshBasicMaterial({ color: 0xff3b0a, transparent: true, opacity: 0.78, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      dishBlue: new THREE.MeshPhysicalMaterial({ color: 0x73899e, roughness: 0.24, clearcoat: 0.55 }),
      redRug: new THREE.MeshStandardMaterial({ color: 0x290b12, roughness: 0.9 }),
      greenRug: new THREE.MeshStandardMaterial({ color: 0x172f2b, roughness: 0.92 }),
      exoticRug: new THREE.MeshStandardMaterial({ map: exoticRugMap, roughness: 0.88, metalness: 0, bumpMap: exoticRugMap, bumpScale: 0.012 }),
      foyerRug: new THREE.MeshStandardMaterial({ map: foyerRugMap, roughness: 0.88, metalness: 0, bumpMap: foyerRugMap, bumpScale: 0.012 }),
      libraryRug: new THREE.MeshStandardMaterial({ map: libraryRugMap, roughness: 0.9, metalness: 0, bumpMap: libraryRugMap, bumpScale: 0.012 }),
      musicRug: new THREE.MeshStandardMaterial({ map: musicRugMap, roughness: 0.9, metalness: 0, bumpMap: musicRugMap, bumpScale: 0.012 }),
      darkFloor: new THREE.MeshStandardMaterial({ map: stoneMap, color: 0x4a504e, roughness: 0.96, bumpMap: stoneMap, bumpScale: 0.045 }),
      lightGlowMap: makeRadialGlowTexture(128),
      soot: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 1 }),
      bookPalette: [0x40222a, 0x263d39, 0x514127, 0x202b3d, 0x5a3828].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.86 })),
      wineRed: new THREE.MeshStandardMaterial({ color: 0x40151d, roughness: 0.42, metalness: 0.05 }),
      wineGreen: new THREE.MeshStandardMaterial({ color: 0x183b31, roughness: 0.42, metalness: 0.05 }),
      wetGrass: new THREE.MeshPhysicalMaterial({ map: leafMap, color: 0x24382b, roughness: 0.74, metalness: 0.02, clearcoat: 0.18, clearcoatRoughness: 0.48, bumpMap: leafMap, bumpScale: 0.035 }),
      hedge: new THREE.MeshStandardMaterial({ map: leafMap, color: 0x2c5a3b, roughness: 0.82, bumpMap: leafMap, bumpScale: 0.065 }),
      hedgeDark: new THREE.MeshStandardMaterial({ map: leafMap, color: 0x244832, roughness: 0.9, bumpMap: leafMap, bumpScale: 0.055 }),
      gardenSoil: new THREE.MeshStandardMaterial({ map: soilMap, color: 0x4a3324, roughness: 0.97, bumpMap: soilMap, bumpScale: 0.05 }),
      wetPavers: new THREE.MeshPhysicalMaterial({ map: paverMap, color: 0x77766d, roughness: 0.36, metalness: 0.04, clearcoat: 0.34, clearcoatRoughness: 0.28, bumpMap: paverMap, bumpScale: 0.045 }),
      poolTile: new THREE.MeshPhysicalMaterial({ map: marbleMap, color: 0x587f86, roughness: 0.26, clearcoat: 0.42, clearcoatRoughness: 0.25, bumpMap: marbleMap, bumpScale: 0.012 }),
      terracotta: new THREE.MeshStandardMaterial({ color: 0x6f3828, roughness: 0.86 }),
      roseRed: new THREE.MeshStandardMaterial({ color: 0x641b2a, roughness: 0.78 }),
      roseIvory: new THREE.MeshStandardMaterial({ color: 0xb9aa91, roughness: 0.78 }),
      roseMauve: new THREE.MeshStandardMaterial({ color: 0x63405f, roughness: 0.8 }),
      lampGlow: new THREE.MeshStandardMaterial({ color: 0xffd8a4, emissive: 0xff9f45, emissiveIntensity: 1.0, roughness: 0.24 }),
    };
  }

  class PhysicsWorld {
    constructor(rapier) {
      this.R = rapier;
      this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
      this.fixedBodies = 0;
      this.kinematicBodies = 0;
      this.colliderCount = 0;
      this.verticalVelocity = 0;
      this.grounded = false;
      this.lastSafePosition = { x: 0, y: 0.91, z: 10.2 };
      this.fallRecoveries = 0;
      const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.91, 10.2);
      this.playerBody = this.world.createRigidBody(bodyDesc);
      this.playerCollider = this.world.createCollider(
        rapier.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius).setFriction(0),
        this.playerBody
      );
      this.kinematicBodies += 1;
      this.colliderCount += 1;
      this.controller = this.world.createCharacterController(0.015);
      this.controller.enableAutostep(0.35, 0.05, true);
      this.controller.enableSnapToGround(0.36);
      this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(42));
      this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(48));
    }

    addFixedBox(x, y, z, w, h, d, rotationY, rotationX, rotationZ) {
      const desc = this.R.RigidBodyDesc.fixed().setTranslation(x, y, z);
      if (rotationY || rotationX || rotationZ) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotationX || 0, rotationY || 0, rotationZ || 0));
        desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
      const body = this.world.createRigidBody(desc);
      this.world.createCollider(this.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.74), body);
      this.fixedBodies += 1;
      this.colliderCount += 1;
      return body;
    }

    addKinematicBox(x, y, z, w, h, d) {
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
      const collider = this.world.createCollider(this.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.5), body);
      this.kinematicBodies += 1;
      this.colliderCount += 1;
      return { body, collider };
    }

    addFixedRamp(x, centerZ, lowY, highY, run, width, directionZ) {
      const lowZ = centerZ - directionZ * run / 2;
      const highZ = centerZ + directionZ * run / 2;
      const vertices = new Float32Array([
        x - width / 2, lowY, lowZ,
        x + width / 2, lowY, lowZ,
        x - width / 2, highY, highZ,
        x + width / 2, highY, highZ,
      ]);
      const indices = directionZ < 0
        ? new Uint32Array([0, 1, 2, 1, 3, 2])
        : new Uint32Array([0, 2, 1, 1, 2, 3]);
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
      this.world.createCollider(this.R.ColliderDesc.trimesh(vertices, indices).setFriction(0.74), body);
      this.fixedBodies += 1;
      this.colliderCount += 1;
      return body;
    }

    movePlayer(dx, dz) {
      this.verticalVelocity = Math.max(this.verticalVelocity - 9.81 / 60, -18);
      const requested = { x: dx, y: this.verticalVelocity / 60, z: dz };
      this.controller.computeColliderMovement(this.playerCollider, requested);
      const corrected = this.controller.computedMovement();
      this.grounded = this.controller.computedGrounded();
      if (this.grounded && this.verticalVelocity < 0) this.verticalVelocity = 0;
      const p = this.playerBody.translation();
      this.playerBody.setNextKinematicTranslation({ x: p.x + corrected.x, y: p.y + corrected.y, z: p.z + corrected.z });
    }

    step() {
      this.world.timestep = 1 / 60;
      this.world.step();
    }

    updateSafety() {
      const p = this.playerBody.translation();
      if (p.y < -9) {
        this.verticalVelocity = 0;
        this.playerBody.setTranslation(this.lastSafePosition, true);
        this.playerBody.setNextKinematicTranslation(this.lastSafePosition);
        this.fallRecoveries += 1;
        return;
      }
      if (this.grounded && p.y > -6) this.lastSafePosition = { x: p.x, y: p.y, z: p.z };
    }

    playerPosition() {
      return this.playerBody.translation();
    }
  }

  class MrFeastWanderer {
    constructor() {
      this.root = new THREE.Group();
      this.root.name = "mr-feast-wanderer";
      this.root.position.set(
        MR_FEAST_NPC.waypoints[0].x,
        MR_FEAST_NPC.waypoints[0].y,
        MR_FEAST_NPC.waypoints[0].z,
      );
      this.waypointIndex = 1;
      this.pauseRemaining = MR_FEAST_NPC.waypoints[0].pause;
      this.wanderingEnabled = true;
      this.moving = false;
      this.loadStatus = "idle";
      this.loadingProgress = 0;
      this.error = null;
      this.model = null;
      this.meshes = [];
      this.contactShadow = null;
      this.bonesByName = new Map();
      this.hipsBone = null;
      this.headFrontBone = null;
      this.headEndBone = null;
      this.bindHipsScale = null;
      this.animationTrackDiagnostics = {};
      this.qaAnimationFrozen = false;
      this.mixer = null;
      this.actions = {};
      this.activeAction = null;
      this.currentAnimation = null;
      this.manifest = null;
      this.modelSize = new THREE.Vector3();
      this.skinnedMeshes = 0;
      this.bones = 0;
      this.distanceTravelled = 0;
      this.completedRouteLoops = 0;
      this.routeSegmentsTraversed = 0;
      this.currentRouteZone = MR_FEAST_NPC.waypoints[0].zone;
      this.currentRouteLevel = MR_FEAST_NPC.waypoints[0].level;
      this.visitedRouteZones = new Set([this.currentRouteZone]);
      this.visitedRouteFloors = new Set([this.currentRouteLevel]);
      this.visitedRouteDoors = new Set();
      this.routeDoorOpenEvents = 0;
      this.routeDoorCache = new Map();
      this.autoOpenedDoors = new Set();
      this.waitingForDoor = null;
      this.onStairs = false;
      this.qaLastWholeHomeRun = null;
      this.lastDt = 1 / 60;
      this.faceTarget(MR_FEAST_NPC.waypoints[this.waypointIndex], true);
      scene.add(this.root);
      animatedObjects.push(this);
    }

    assetUrl(relativePath, manifestUrl) {
      const url = new URL(relativePath, manifestUrl);
      url.searchParams.set("v", MR_FEAST_NPC.assetVersion);
      return url.href;
    }

    loadGltf(loader, url, trackProgress = false) {
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          resolve,
          trackProgress ? (event) => {
            if (!event.total) return;
            this.loadingProgress = clamp(event.loaded / event.total, 0, 1);
          } : undefined,
          (error) => reject(new Error(error?.message || `Could not load ${url}`)),
        );
      });
    }

    sanitizeAnimationClip(sourceClip, semanticName) {
      if (!sourceClip) return null;
      const tracks = [];
      let removedScaleTracks = 0;
      let removedTranslationTracks = 0;
      for (const sourceTrack of sourceClip.tracks) {
        const splitAt = sourceTrack.name.lastIndexOf(".");
        const targetName = splitAt >= 0 ? sourceTrack.name.slice(0, splitAt) : sourceTrack.name;
        const propertyName = splitAt >= 0 ? sourceTrack.name.slice(splitAt + 1) : "";
        const targetsHips = targetName === "Hips"
          || targetName.endsWith("/Hips")
          || targetName.endsWith("[Hips]");
        if (propertyName === "scale") {
          removedScaleTracks += 1;
          continue;
        }
        if (propertyName === "position" && !targetsHips) {
          removedTranslationTracks += 1;
          continue;
        }
        tracks.push(sourceTrack.clone());
      }
      const clip = new THREE.AnimationClip(semanticName, sourceClip.duration, tracks);
      this.animationTrackDiagnostics[semanticName] = {
        sourceTracks: sourceClip.tracks.length,
        runtimeTracks: tracks.length,
        removedScaleTracks,
        removedTranslationTracks,
        scaleTracks: tracks.filter((track) => track.name.endsWith(".scale")).length,
        translationTracks: tracks.filter((track) => track.name.endsWith(".position")).length,
      };
      return clip;
    }

    async load() {
      if (this.loadStatus === "loading" || this.loadStatus === "ready") return;
      this.loadStatus = "loading";
      this.error = null;
      document.documentElement.dataset.mrFeastNpc = "loading";
      try {
        if (typeof THREE.GLTFLoader !== "function") throw new Error("THREE.GLTFLoader is unavailable");
        if (!THREE.SkeletonUtils || typeof THREE.SkeletonUtils.clone !== "function") {
          throw new Error("THREE.SkeletonUtils.clone is unavailable");
        }

        const manifestUrl = new URL(MR_FEAST_NPC.manifestPath, SCRIPT_URL);
        manifestUrl.searchParams.set("v", MR_FEAST_NPC.assetVersion);
        const response = await fetch(manifestUrl.href, { cache: state.qa ? "no-store" : "default" });
        if (!response.ok) throw new Error(`Character manifest returned HTTP ${response.status}`);
        const manifest = await response.json();
        if (!manifest?.model || !manifest?.animations?.idle || !manifest?.animations?.stalk) {
          throw new Error("Character manifest is missing the base, idle, or stalk asset");
        }
        this.manifest = manifest;

        const loader = new THREE.GLTFLoader();
        const basePromise = this.loadGltf(loader, this.assetUrl(manifest.model, manifestUrl), true);
        const motionEntries = Object.entries(manifest.animations);
        const motionPromises = motionEntries.map(async ([name, spec]) => ({
          name,
          spec,
          gltf: await this.loadGltf(loader, this.assetUrl(spec.file, manifestUrl)),
        }));
        const [base, motionResults] = await Promise.all([
          basePromise,
          Promise.allSettled(motionPromises),
        ]);

        const model = THREE.SkeletonUtils.clone(base.scene);
        model.name = "mr-feast-character-model";
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const initialSize = bounds.getSize(new THREE.Vector3());
        // Runtime art direction owns the final in-world fit. The manifest also
        // records it, but cannot silently override a later eye-line adjustment.
        const targetHeight = MR_FEAST_NPC.heightMeters || Number(manifest.heightMeters);
        if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) throw new Error("Character has invalid bounds");
        const fitScale = targetHeight / initialSize.y;
        model.scale.multiplyScalar(fitScale);
        model.updateMatrixWorld(true);
        bounds.setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.y -= bounds.min.y;
        model.position.z -= center.z;
        model.updateMatrixWorld(true);
        bounds.setFromObject(model);
        bounds.getSize(this.modelSize);

        model.traverse((object) => {
          if (object.isSkinnedMesh) this.skinnedMeshes += 1;
          if (object.isBone) {
            this.bones += 1;
            this.bonesByName.set(object.name, object);
          }
          if (!object.isMesh) return;
          // Shadow maps are cached in this mansion. A moving caster would
          // leave a frozen ghost unless every animation frame rebuilt them.
          object.castShadow = false;
          object.receiveShadow = true;
          object.userData.preExteriorVisibility = true;
          object.visible = !interiorDetailsHidden;
          this.meshes.push(object);
          interiorDetailMeshes.push(object);
        });

        this.model = model;
        this.root.add(model);
        this.hipsBone = this.bonesByName.get("Hips") || null;
        this.headFrontBone = this.bonesByName.get("headfront") || null;
        this.headEndBone = this.bonesByName.get("head_end") || null;
        this.bindHipsScale = this.hipsBone ? this.hipsBone.scale.clone() : null;
        this.contactShadow = new THREE.Mesh(
          new THREE.CircleGeometry(1, 24),
          new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.24,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        this.contactShadow.name = "mr-feast-contact-shadow";
        this.contactShadow.rotation.x = -Math.PI / 2;
        this.contactShadow.position.y = 0.012;
        this.contactShadow.scale.set(0.46, 0.31, 1);
        this.contactShadow.castShadow = false;
        this.contactShadow.receiveShadow = false;
        this.contactShadow.renderOrder = 2;
        this.contactShadow.userData.preExteriorVisibility = true;
        this.contactShadow.visible = !interiorDetailsHidden;
        this.root.add(this.contactShadow);
        this.meshes.push(this.contactShadow);
        interiorDetailMeshes.push(this.contactShadow);
        this.mixer = new THREE.AnimationMixer(model);
        for (const result of motionResults) {
          if (result.status !== "fulfilled") continue;
          const { name, spec, gltf } = result.value;
          const clip = this.sanitizeAnimationClip(gltf.animations?.[0], name);
          if (!clip) continue;
          const action = this.mixer.clipAction(clip);
          action.enabled = true;
          action.clampWhenFinished = !spec.loop;
          action.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, spec.loop ? Infinity : 1);
          action.setEffectiveTimeScale(Number(spec.playbackRate) || 1);
          this.actions[name] = action;
        }
        if (!this.actions.idle || !this.actions.stalk) {
          throw new Error("Idle or stalk animation did not load");
        }

        this.loadStatus = "ready";
        this.loadingProgress = 1;
        document.documentElement.dataset.mrFeastNpc = "ready";
        this.fadeToAction("idle", 0, true);
        console.info(
          `[MrFeast] loaded ${this.modelSize.x.toFixed(2)} × ${this.modelSize.y.toFixed(2)} × ${this.modelSize.z.toFixed(2)}m; `
          + `${this.skinnedMeshes} skinned mesh; ${this.bones} bones; clips ${Object.keys(this.actions).join(", ")}`,
        );
      } catch (error) {
        this.loadStatus = "error";
        this.error = String(error?.message || error);
        this.root.visible = false;
        document.documentElement.dataset.mrFeastNpc = "error";
        console.error("Mr. Feast character could not be loaded", error);
      }
    }

    fadeToAction(name, duration = MR_FEAST_NPC.fadeSeconds, force = false) {
      const nextAction = this.actions[name] || this.actions.idle;
      if (!nextAction) return;
      const spec = this.manifest?.animations?.[name] || this.manifest?.animations?.idle;
      nextAction.setEffectiveTimeScale(Number(spec?.playbackRate) || 1);
      if (!force && this.activeAction === nextAction) return;
      if (this.activeAction) {
        if (duration > 0) this.activeAction.fadeOut(duration);
        else this.activeAction.stop();
      }
      nextAction.reset().setEffectiveWeight(1);
      if (duration > 0) nextAction.fadeIn(duration);
      nextAction.play();
      this.activeAction = nextAction;
      this.currentAnimation = name in this.actions ? name : "idle";
    }

    routeDoor(name) {
      if (!name) return null;
      if (this.routeDoorCache.has(name)) return this.routeDoorCache.get(name);
      const door = animatedObjects.find((object) => object instanceof HingedDoor && object.name === name) || null;
      if (door) this.routeDoorCache.set(name, door);
      return door;
    }

    setSegmentPresentation(target) {
      this.onStairs = target?.segmentKind === "stairs";
      if (!this.contactShadow) return;
      this.contactShadow.userData.preExteriorVisibility = !this.onStairs;
      this.contactShadow.visible = !this.onStairs && !interiorDetailsHidden;
    }

    prepareRouteDoor(target, distance) {
      this.waitingForDoor = null;
      if (!target?.door) return false;
      const door = this.routeDoor(target.door);
      if (!door || door.locked) return false;
      if (distance <= MR_FEAST_NPC.doorOpenDistance && !door.open) {
        door.setOpen(true);
        this.autoOpenedDoors.add(door);
        this.visitedRouteDoors.add(door.name);
        this.routeDoorOpenEvents += 1;
      }
      const swingRemaining = Math.abs(door.target - door.angle);
      if (distance <= MR_FEAST_NPC.doorWaitDistance && swingRemaining > 0.12) {
        this.waitingForDoor = door.name;
        return true;
      }
      return false;
    }

    closeClearedRouteDoors(target) {
      for (const door of [...this.autoOpenedDoors]) {
        if (!door.open) {
          this.autoOpenedDoors.delete(door);
          continue;
        }
        if (target?.door === door.name) continue;
        const distance = Math.hypot(
          this.root.position.x - door.root.position.x,
          this.root.position.z - door.root.position.z,
        );
        if (distance <= MR_FEAST_NPC.doorCloseDistance || door.playerInSwingPath()) continue;
        door.setOpen(false);
        this.autoOpenedDoors.delete(door);
      }
    }

    floorAtCurrentHeight() {
      const y = this.root.position.y;
      if (Math.abs(y - FLOOR.MAIN) < 0.08) return MR_FEAST_LEVEL.MAIN;
      if (Math.abs(y - FLOOR.UPPER) < 0.08) return MR_FEAST_LEVEL.UPPER;
      if (Math.abs(y - FLOOR.BASEMENT) < 0.08) return MR_FEAST_LEVEL.BASEMENT;
      return MR_FEAST_LEVEL.STAIR;
    }

    arriveAtWaypoint(target) {
      this.root.position.set(target.x, target.y, target.z);
      this.currentRouteZone = target.zone;
      this.currentRouteLevel = target.level;
      this.visitedRouteZones.add(target.zone);
      if (target.level !== MR_FEAST_LEVEL.STAIR) this.visitedRouteFloors.add(target.level);
      this.routeSegmentsTraversed += 1;
      const nextIndex = (this.waypointIndex + 1) % MR_FEAST_NPC.waypoints.length;
      if (nextIndex === 0) this.completedRouteLoops += 1;
      this.waypointIndex = nextIndex;
      this.pauseRemaining = target.pause || 0;
      this.setSegmentPresentation(MR_FEAST_NPC.waypoints[this.waypointIndex]);
    }

    faceTarget(target, snap = false) {
      if (!target) return;
      const horizontalDistance = Math.hypot(target.x - this.root.position.x, target.z - this.root.position.z);
      if (horizontalDistance < 0.0001) return;
      const desiredYaw = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
      if (snap) {
        this.root.rotation.y = desiredYaw;
        return;
      }
      const yawDelta = Math.atan2(
        Math.sin(desiredYaw - this.root.rotation.y),
        Math.cos(desiredYaw - this.root.rotation.y),
      );
      const nextYaw = this.root.rotation.y + clamp(
        yawDelta,
        -MR_FEAST_NPC.turnSpeed * this.lastDt,
        MR_FEAST_NPC.turnSpeed * this.lastDt,
      );
      // Keep the Euler bounded so an hours-long looping playtest cannot lose
      // turning precision after accumulating many complete patrol rotations.
      this.root.rotation.y = Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw));
    }

    update(dt) {
      if (this.loadStatus !== "ready") return;
      this.lastDt = Math.max(0, Number(dt) || 0);
      this.moving = false;
      if (state.qa && this.qaAnimationFrozen) return;
      if (!state.started || !this.wanderingEnabled) {
        this.fadeToAction("idle");
        this.mixer.update(this.lastDt);
        return;
      }

      if (this.pauseRemaining > 0) {
        this.pauseRemaining = Math.max(0, this.pauseRemaining - this.lastDt);
        this.fadeToAction("idle");
        this.closeClearedRouteDoors(MR_FEAST_NPC.waypoints[this.waypointIndex]);
        this.mixer.update(this.lastDt);
        return;
      }

      const target = MR_FEAST_NPC.waypoints[this.waypointIndex];
      const dx = target.x - this.root.position.x;
      const dy = target.y - this.root.position.y;
      const dz = target.z - this.root.position.z;
      const horizontalDistance = Math.hypot(dx, dz);
      const distance = Math.hypot(dx, dy, dz);
      this.setSegmentPresentation(target);
      if (distance <= MR_FEAST_NPC.arrivalRadius) {
        this.arriveAtWaypoint(target);
        if (this.pauseRemaining > 0) this.fadeToAction("idle");
        else this.fadeToAction("stalk");
        this.closeClearedRouteDoors(MR_FEAST_NPC.waypoints[this.waypointIndex]);
        this.mixer.update(this.lastDt);
        return;
      }

      this.faceTarget(target);
      const facingAlignment = horizontalDistance > 0.0001
        ? (
          Math.sin(this.root.rotation.y) * dx
          + Math.cos(this.root.rotation.y) * dz
        ) / horizontalDistance
        : 1;
      const waitingForDoor = this.prepareRouteDoor(target, distance);
      if (waitingForDoor || facingAlignment < 0.92) {
        // Pause translation for a fraction of a second at sharp corners so
        // the character pivots deliberately instead of skating sideways.
        this.fadeToAction("idle");
        this.mixer.update(this.lastDt);
        return;
      }
      const step = Math.min(distance, MR_FEAST_NPC.speed * this.lastDt);
      this.root.position.x += dx / distance * step;
      this.root.position.y += dy / distance * step;
      this.root.position.z += dz / distance * step;
      this.distanceTravelled += step;
      this.moving = step > 0;
      this.closeClearedRouteDoors(target);
      this.fadeToAction("stalk");
      this.mixer.update(this.lastDt);
    }

    resetForQA() {
      if (!state.qa) return this.getDiagnostics();
      const start = MR_FEAST_NPC.waypoints[0];
      for (const door of this.autoOpenedDoors) door.setOpen(false);
      this.autoOpenedDoors.clear();
      this.root.position.set(start.x, start.y, start.z);
      this.waypointIndex = 1;
      this.pauseRemaining = 0;
      this.distanceTravelled = 0;
      this.completedRouteLoops = 0;
      this.routeSegmentsTraversed = 0;
      this.currentRouteZone = start.zone;
      this.currentRouteLevel = start.level;
      this.visitedRouteZones = new Set([start.zone]);
      this.visitedRouteFloors = new Set([start.level]);
      this.visitedRouteDoors = new Set();
      this.routeDoorOpenEvents = 0;
      this.waitingForDoor = null;
      this.onStairs = false;
      this.qaLastWholeHomeRun = null;
      this.wanderingEnabled = true;
      this.qaAnimationFrozen = false;
      this.moving = this.loadStatus === "ready";
      this.faceTarget(MR_FEAST_NPC.waypoints[this.waypointIndex], true);
      this.setSegmentPresentation(MR_FEAST_NPC.waypoints[this.waypointIndex]);
      if (this.mixer) this.mixer.setTime(0);
      if (this.loadStatus === "ready") this.fadeToAction("stalk", 0, true);
      this.root.updateMatrixWorld(true);
      return this.getDiagnostics();
    }

    setPoseForQA(options = {}) {
      if (!state.qa || this.loadStatus !== "ready") return this.getDiagnostics();
      const actionName = options.action in this.actions ? options.action : "idle";
      const action = this.actions[actionName];
      const duration = Math.max(0.0001, action.getClip().duration || 0.0001);
      const requestedTime = Number(options.time) || 0;
      this.qaAnimationFrozen = true;
      this.wanderingEnabled = false;
      this.moving = false;
      this.root.position.set(
        Number.isFinite(Number(options.x)) ? Number(options.x) : 0,
        Number.isFinite(Number(options.y)) ? Number(options.y) : FLOOR.MAIN,
        Number.isFinite(Number(options.z)) ? Number(options.z) : -9,
      );
      this.root.rotation.y = Number.isFinite(Number(options.yaw)) ? Number(options.yaw) : 0;
      this.mixer.stopAllAction();
      this.activeAction = null;
      this.currentAnimation = null;
      this.fadeToAction(actionName, 0, true);
      this.activeAction.time = ((requestedTime % duration) + duration) % duration;
      this.mixer.update(0);
      this.root.updateMatrixWorld(true);
      return this.getDiagnostics();
    }

    transitionForQA(actionName, duration = MR_FEAST_NPC.fadeSeconds) {
      if (!state.qa || this.loadStatus !== "ready" || !(actionName in this.actions)) return this.getDiagnostics();
      this.qaAnimationFrozen = true;
      this.wanderingEnabled = false;
      this.moving = false;
      this.fadeToAction(actionName, Math.max(0, Number(duration) || 0));
      return this.getDiagnostics();
    }

    advanceAnimationForQA(seconds) {
      if (!state.qa || this.loadStatus !== "ready") return this.getDiagnostics();
      this.mixer.update(Math.max(0, Number(seconds) || 0));
      this.root.updateMatrixWorld(true);
      return this.getDiagnostics();
    }

    setRouteSegmentForQA(targetId, progress = 0.5, animationTime = 0.258) {
      if (!state.qa || this.loadStatus !== "ready") return this.getDiagnostics();
      const targetIndex = MR_FEAST_NPC.waypoints.findIndex((point) => point.id === targetId);
      if (targetIndex < 0) return { ...this.getDiagnostics(), qaError: `Unknown route target ${targetId}` };
      const target = MR_FEAST_NPC.waypoints[targetIndex];
      const source = MR_FEAST_NPC.waypoints[(targetIndex - 1 + MR_FEAST_NPC.waypoints.length) % MR_FEAST_NPC.waypoints.length];
      const amount = clamp(Number(progress) || 0, 0, 1);
      const x = THREE.MathUtils.lerp(source.x, target.x, amount);
      const y = THREE.MathUtils.lerp(source.y, target.y, amount);
      const z = THREE.MathUtils.lerp(source.z, target.z, amount);
      const yaw = Math.atan2(target.x - source.x, target.z - source.z);
      this.setPoseForQA({ action: "stalk", time: animationTime, x, y, z, yaw });
      this.waypointIndex = targetIndex;
      this.currentRouteZone = amount >= 1 ? target.zone : source.zone;
      this.currentRouteLevel = amount >= 1 ? target.level : source.level;
      this.setSegmentPresentation(target);
      this.root.updateMatrixWorld(true);
      return this.getDiagnostics();
    }

    runWholeHomeRouteForQA(maxSeconds = 1800) {
      if (!state.qa || this.loadStatus !== "ready") return this.getDiagnostics();
      this.resetForQA();
      state.started = true;
      this.pauseRemaining = 0;
      this.wanderingEnabled = true;
      this.qaAnimationFrozen = false;
      const fixedStep = 1 / 30;
      const limit = clamp(Number(maxSeconds) || 1800, 1, 2400);
      let simulatedSeconds = 0;
      while (this.completedRouteLoops < 1 && simulatedSeconds < limit) {
        for (const object of animatedObjects) {
          if (object instanceof HingedDoor) object.update(fixedStep);
        }
        this.update(fixedStep);
        simulatedSeconds += fixedStep;
      }
      this.qaAnimationFrozen = true;
      this.wanderingEnabled = false;
      this.moving = false;
      this.root.updateMatrixWorld(true);
      this.qaLastWholeHomeRun = {
        completed: this.completedRouteLoops >= 1,
        simulatedSeconds: Number(simulatedSeconds.toFixed(2)),
        loops: this.completedRouteLoops,
        floors: [...this.visitedRouteFloors],
        zones: [...this.visitedRouteZones],
        segments: this.routeSegmentsTraversed,
        doors: [...this.visitedRouteDoors],
        doorOpenEvents: this.routeDoorOpenEvents,
      };
      return this.getDiagnostics();
    }

    getLiveBoneMetrics() {
      if (!this.model) return null;
      this.root.updateMatrixWorld(true);
      const rootPosition = this.root.getWorldPosition(new THREE.Vector3());
      const positionOf = (bone) => bone ? bone.getWorldPosition(new THREE.Vector3()) : null;
      const eyePosition = positionOf(this.headFrontBone);
      const headTopPosition = positionOf(this.headEndBone);
      const leftUpLegPosition = positionOf(this.bonesByName.get("LeftUpLeg"));
      const leftLegPosition = positionOf(this.bonesByName.get("LeftLeg"));
      const hipsWorldScale = this.hipsBone ? this.hipsBone.getWorldScale(new THREE.Vector3()) : null;
      return {
        cameraY: Number(camera.position.y.toFixed(4)),
        eyeHeight: eyePosition ? Number((eyePosition.y - rootPosition.y).toFixed(4)) : null,
        eyeWorldY: eyePosition ? Number(eyePosition.y.toFixed(4)) : null,
        eyeLineError: eyePosition ? Number(Math.abs(camera.position.y - eyePosition.y).toFixed(4)) : null,
        headTopHeight: headTopPosition ? Number((headTopPosition.y - rootPosition.y).toFixed(4)) : null,
        hipsScale: this.hipsBone ? {
          x: Number(this.hipsBone.scale.x.toFixed(6)),
          y: Number(this.hipsBone.scale.y.toFixed(6)),
          z: Number(this.hipsBone.scale.z.toFixed(6)),
        } : null,
        hipsWorldScale: hipsWorldScale ? {
          x: Number(hipsWorldScale.x.toFixed(6)),
          y: Number(hipsWorldScale.y.toFixed(6)),
          z: Number(hipsWorldScale.z.toFixed(6)),
        } : null,
        leftThighLength: leftUpLegPosition && leftLegPosition
          ? Number(leftUpLegPosition.distanceTo(leftLegPosition).toFixed(5))
          : null,
      };
    }

    getDiagnostics() {
      const liveBones = this.getLiveBoneMetrics();
      const target = MR_FEAST_NPC.waypoints[this.waypointIndex] || null;
      const targetDx = target ? target.x - this.root.position.x : 0;
      const targetDy = target ? target.y - this.root.position.y : 0;
      const targetDz = target ? target.z - this.root.position.z : 0;
      const targetHorizontalDistance = Math.hypot(targetDx, targetDz);
      const targetDistance = Math.hypot(targetDx, targetDy, targetDz);
      const facingDot = targetHorizontalDistance > 0.0001
        ? (Math.sin(this.root.rotation.y) * targetDx + Math.cos(this.root.rotation.y) * targetDz) / targetHorizontalDistance
        : 1;
      const status = this.loadStatus === "ready"
        ? (this.waitingForDoor ? "waiting-for-door" : this.moving ? "wandering" : "idle")
        : this.loadStatus;
      const routeFloors = [...new Set(MR_FEAST_NPC.waypoints.map((point) => point.level).filter((level) => level !== MR_FEAST_LEVEL.STAIR))];
      const routeZones = [...new Set(MR_FEAST_NPC.waypoints.map((point) => point.zone))];
      return {
        status,
        loaded: this.loadStatus === "ready",
        loadStatus: this.loadStatus,
        loadingProgress: Number(this.loadingProgress.toFixed(3)),
        modelVisible: Boolean(this.model && this.root.visible && this.meshes.some((mesh) => mesh.visible)),
        error: this.error,
        position: {
          x: Number(this.root.position.x.toFixed(3)),
          y: Number(this.root.position.y.toFixed(3)),
          z: Number(this.root.position.z.toFixed(3)),
        },
        target: target ? {
          id: target.id,
          x: target.x,
          y: target.y,
          z: target.z,
          level: target.level,
          zone: target.zone,
          segmentKind: target.segmentKind,
          door: target.door,
          distance: Number(targetDistance.toFixed(3)),
        } : null,
        yaw: Number(this.root.rotation.y.toFixed(3)),
        facingDot: Number(facingDot.toFixed(3)),
        waypointIndex: this.waypointIndex,
        waypointCount: MR_FEAST_NPC.waypoints.length,
        currentFloor: this.floorAtCurrentHeight(),
        currentRoom: this.currentRouteZone,
        routeZone: target?.zone || this.currentRouteZone,
        routeLevel: target?.level || this.currentRouteLevel,
        onStairs: this.onStairs,
        waitingForDoor: this.waitingForDoor,
        autoOpenedDoors: [...this.autoOpenedDoors].map((door) => door.name),
        completedRouteLoops: this.completedRouteLoops,
        routeSegmentsTraversed: this.routeSegmentsTraversed,
        visitedRouteFloors: [...this.visitedRouteFloors],
        visitedRouteZones: [...this.visitedRouteZones],
        visitedRouteDoors: [...this.visitedRouteDoors],
        routeDoorOpenEvents: this.routeDoorOpenEvents,
        routeSummary: {
          distanceMeters: Number(MR_FEAST_ROUTE_DISTANCE_METERS.toFixed(2)),
          estimatedSeconds: Number((MR_FEAST_ROUTE_DISTANCE_METERS / MR_FEAST_NPC.speed + MR_FEAST_ROUTE_PAUSE_SECONDS).toFixed(1)),
          floors: routeFloors,
          zones: routeZones,
          doors: new Set(MR_FEAST_NPC.waypoints.map((point) => point.door).filter(Boolean)).size,
        },
        moving: this.moving,
        distanceTravelled: Number(this.distanceTravelled.toFixed(3)),
        currentAnimation: this.currentAnimation,
        mixerTime: Number((this.mixer?.time || 0).toFixed(3)),
        clipsLoaded: Object.keys(this.actions),
        clipDurations: Object.fromEntries(
          Object.entries(this.actions).map(([name, action]) => [name, Number(action.getClip().duration.toFixed(3))]),
        ),
        animationTracks: this.animationTrackDiagnostics,
        skinnedMeshes: this.skinnedMeshes,
        bones: this.bones,
        modelHeight: Number(this.modelSize.y.toFixed(3)),
        modelScale: this.model ? Number(this.model.scale.x.toFixed(6)) : null,
        bindHipsScale: this.bindHipsScale ? {
          x: Number(this.bindHipsScale.x.toFixed(6)),
          y: Number(this.bindHipsScale.y.toFixed(6)),
          z: Number(this.bindHipsScale.z.toFixed(6)),
        } : null,
        liveBones,
        qaAnimationFrozen: this.qaAnimationFrozen,
        qaLastWholeHomeRun: this.qaLastWholeHomeRun,
        contactShadowVisible: Boolean(this.contactShadow?.visible),
        castShadowMeshes: this.meshes.filter((mesh) => mesh.castShadow).length,
      };
    }
  }

  window.MrFeastFresh = window.MrFeastFresh || {};
  window.MrFeastFresh.state = state;

  let M = null;
  const reusable = {};

  function geometry(name, factory) {
    if (!reusable[name]) reusable[name] = factory();
    return reusable[name];
  }

  function box(options) {
    const {
      name = "box", w = 1, h = 1, d = 1, x = 0, y = 0, z = 0,
      material = M.plaster, rotationX = 0, rotationY = 0, rotationZ = 0, collider = false,
      cast = true, receive = true, parent = scene, occluder = false,
    } = options || {};
    const mesh = new THREE.Mesh(geometry("unitBox", () => new THREE.BoxGeometry(1, 1, 1)), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    if (collider) physics.addFixedBox(x, y, z, w, h, d, rotationY);
    if (occluder || collider) occluderMeshes.push(mesh);
    return mesh;
  }

  function cylinder(options) {
    const {
      name = "cylinder", radius = 0.5, radiusTop = radius, radiusBottom = radius,
      height = 1, segments = 14, x = 0, y = 0, z = 0, rotationX = 0,
      rotationY = 0, rotationZ = 0, material = M.iron, parent = scene,
      cast = true, receive = true,
    } = options || {};
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  }

  function sphere(options) {
    const {
      name = "sphere", radius = 0.2, widthSegments = 14, heightSegments = 9,
      x = 0, y = 0, z = 0, material = M.brass, parent = scene, cast = true,
    } = options || {};
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    parent.add(mesh);
    return mesh;
  }

  function plane(options) {
    const {
      name = "plane", w = 1, h = 1, x = 0, y = 0, z = 0,
      rotationX = -Math.PI / 2, rotationY = 0, rotationZ = 0,
      material = M.redRug, parent = scene,
    } = options || {};
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function roundedBox(options) {
    const {
      name = "rounded-box", w = 1, h = 1, d = 1, radius = 0.08,
      x = 0, y = 0, z = 0, rotationX = 0, rotationY = 0, rotationZ = 0,
      material = M.velvet, parent = scene, cast = true,
    } = options || {};
    const r = Math.min(radius, w / 3, h / 3);
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: Math.min(r * 0.45, 0.05), bevelThickness: Math.min(r * 0.45, 0.05), bevelSegments: 2, curveSegments: 4 });
    geometry.translate(0, 0, -d / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addInteractionTarget(mesh, interaction) {
    mesh.userData.interaction = interaction;
    interactableMeshes.push(mesh);
    return mesh;
  }

  function removeInteractionTarget(mesh) {
    if (!mesh) return;
    const index = interactableMeshes.indexOf(mesh);
    if (index >= 0) interactableMeshes.splice(index, 1);
    if (mesh.userData) delete mesh.userData.interaction;
  }

  class HingedDoor {
    constructor(options) {
      const {
        name, axis, fixed, center, width = 1.15, height = 2.55, floorY,
        direction = 1, hingeSide = -1, material = M.darkWood, locked = false,
      } = options;
      this.name = name;
      this.axis = axis;
      this.width = width;
      this.height = height;
      this.direction = direction;
      this.hingeSide = hingeSide;
      this.locked = locked;
      this.open = false;
      this.angle = 0;
      this.target = 0;
      this.root = new THREE.Group();
      this.root.name = `${name}-hinge`;
      if (axis === "x") this.root.position.set(center + hingeSide * width / 2, floorY, fixed);
      else this.root.position.set(fixed, floorY, center + hingeSide * width / 2);
      scene.add(this.root);
      // Exterior doors are rain apertures: the storm pours through an open
      // leaf, and still bleeds around a closed one far more than through wall.
      if (/(?:front door|terrace door)/i.test(name)) {
        this.rainAperture = {
          x: axis === "x" ? center : fixed,
          y: floorY + height / 2,
          z: axis === "x" ? fixed : center,
        };
        exteriorRainDoors.push(this);
      }

      const panelOffset = -hingeSide * width / 2;

      this.panel = box({
        name: `${name}-panel`, w: axis === "x" ? width : 0.105,
        h: height, d: axis === "x" ? 0.105 : width,
        x: axis === "x" ? panelOffset : 0,
        y: height / 2,
        z: axis === "x" ? 0 : panelOffset,
        material, parent: this.root, cast: true, receive: true,
      });

      // Every door is finished on both faces so it still reads as a real door
      // after the player walks through it. The previous build only decorated
      // one face, leaving a blank slab on the reverse side.
      for (const face of [-1, 1]) {
        for (const panelY of [height * 0.3, height * 0.69]) {
          const insetH = height * 0.25;
          if (axis === "x") {
            box({ name: `${name}-panel-trim`, w: width * 0.79, h: insetH + 0.12, d: 0.015, x: panelOffset, y: panelY, z: face * 0.079, material: M.brass, parent: this.root, cast: false });
            box({ name: `${name}-panel-core`, w: width * 0.7, h: insetH, d: 0.02, x: panelOffset, y: panelY, z: face * 0.09, material, parent: this.root, cast: false });
          } else {
            box({ name: `${name}-panel-trim`, w: 0.015, h: insetH + 0.12, d: width * 0.79, x: face * 0.079, y: panelY, z: panelOffset, material: M.brass, parent: this.root, cast: false });
            box({ name: `${name}-panel-core`, w: 0.02, h: insetH, d: width * 0.7, x: face * 0.09, y: panelY, z: panelOffset, material, parent: this.root, cast: false });
          }
        }
      }

      const knobs = [-1, 1].map((face) => axis === "x"
        ? sphere({ name: `${name}-knob`, radius: 0.075, x: -hingeSide * width * 0.82, y: 1.02, z: face * 0.12, material: M.brass, parent: this.root })
        : sphere({ name: `${name}-knob`, radius: 0.075, x: face * 0.12, y: 1.02, z: -hingeSide * width * 0.82, material: M.brass, parent: this.root }));

      this.interaction = {
        type: "door",
        getLabel: () => this.locked ? `${name} is sealed` : `${this.open ? "Close" : "Open"} ${name}`,
        activate: () => this.toggle(),
      };
      addInteractionTarget(this.panel, this.interaction);
      for (const knob of knobs) addInteractionTarget(knob, this.interaction);
      const physicsDoor = physics.addKinematicBox(0, floorY + height / 2, 0, axis === "x" ? width : 0.105, height, axis === "x" ? 0.105 : width);
      this.body = physicsDoor.body;
      this.collider = physicsDoor.collider;
      animatedObjects.push(this);
      this.updatePhysics();
    }

    toggle() {
      if (this.locked) return;
      // Only refuse to close when the player is genuinely inside the arc the
      // leaf must sweep — standing beside or behind the door no longer blocks it.
      if (this.open && this.playerInSwingPath()) return;
      this.setOpen(!this.open);
      if (audioSystem) audioSystem.door(this.open);
    }

    playerInSwingPath() {
      const p = physics.playerPosition();
      const hinge = this.root.position;
      const dx = p.x - hinge.x;
      const dz = p.z - hinge.z;
      const dist = Math.hypot(dx, dz);
      // Past the leaf tip (plus the player's body radius) the closing door can
      // never reach the player, so it may always shut from there.
      if (dist > this.width + 0.34) return false;
      if (dist < 0.05) return true;
      // Closed leaf points along the wall from the hinge; the open leaf is that
      // vector turned by the door's current angle. The player blocks the swing
      // only while sitting between those two directions.
      const closed = this.axis === "x" ? { x: -this.hingeSide, z: 0 } : { x: 0, z: -this.hingeSide };
      const cos = Math.cos(this.angle);
      const sin = Math.sin(this.angle);
      const open = { x: closed.x * cos + closed.z * sin, z: -closed.x * sin + closed.z * cos };
      const crossCO = closed.x * open.z - closed.z * open.x;
      const arc = Math.sign(crossCO) || 1;
      const crossCP = closed.x * dz - closed.z * dx;
      const crossPO = dx * open.z - dz * open.x;
      return Math.sign(crossCP) === arc && Math.sign(crossPO) === arc;
    }

    setOpen(open) {
      this.open = Boolean(open);
      this.target = this.open ? this.direction * THREE.MathUtils.degToRad(96) : 0;
      this.collider.setEnabled(!this.open);
      this.updatePhysics();
    }

    update(dt) {
      const before = this.angle;
      this.angle = ease(this.angle, this.target, 5.6, dt);
      if (Math.abs(this.angle - this.target) < 0.002) this.angle = this.target;
      if (before !== this.angle) {
        this.root.rotation.y = this.angle;
        this.root.updateMatrixWorld(true);
        this.updatePhysics();
        // Cached room shadows only need the final door pose. Updating every
        // animation frame made the larger chandelier maps needlessly costly.
        if (this.angle === this.target) renderer.shadowMap.needsUpdate = true;
      }
    }

    updatePhysics() {
      if (this.open) {
        const parked = { x: this.root.position.x, y: -100, z: this.root.position.z };
        this.body.setTranslation(parked, true);
        this.body.setNextKinematicTranslation(parked);
        return;
      }
      const center = new THREE.Vector3();
      this.panel.getWorldPosition(center);
      const q = new THREE.Quaternion();
      this.panel.getWorldQuaternion(q);
      this.body.setTranslation({ x: center.x, y: center.y, z: center.z }, true);
      this.body.setNextKinematicTranslation({ x: center.x, y: center.y, z: center.z });
      this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  class Cabinet {
    constructor(options) {
      const {
        name, x, y, z, width = 1.8, height = 1.9, depth = 0.52,
        rotationY = 0, material = M.darkWood, floorY = y, walkIn = false,
        stockKind = null, openAngle = 102, interiorLight = true,
      } = options;
      this.name = name;
      this.walkIn = walkIn;
      this.stockKind = stockKind;
      this.width = width;
      this.height = height;
      this.depth = depth;
      this.floorY = floorY;
      this.rotationY = rotationY;
      this.openAngle = openAngle;
      this.hasInteriorLight = Boolean(interiorLight);
      this.itemCount = 0;
      this.open = false;
      this.angle = 0;
      this.target = 0;
      this.root = new THREE.Group();
      this.root.name = name;
      this.root.position.set(x, floorY, z);
      this.root.rotation.y = rotationY;
      scene.add(this.root);

      const shell = walkIn ? 0.11 : 0.085;
      box({ name: `${name}-back`, w: width, h: height, d: shell, x: 0, y: height / 2, z: -depth / 2 + shell / 2, material: M.blackWood, parent: this.root, cast: true });
      for (const side of [-1, 1]) box({ name: `${name}-side`, w: shell, h: height, d: depth, x: side * (width / 2 - shell / 2), y: height / 2, z: 0, material, parent: this.root, cast: true });
      box({ name: `${name}-crown`, w: width, h: shell, d: depth, x: 0, y: height - shell / 2, z: 0, material, parent: this.root, cast: true });
      box({ name: `${name}-sill`, w: width, h: 0.075, d: depth, x: 0, y: 0.0375, z: 0, material: M.blackWood, parent: this.root, cast: false });
      if (walkIn) {
        this.walkInInteriorRoot = new THREE.Group();
        this.walkInInteriorRoot.name = `${name}-walk-in-interior`;
        this.walkInInteriorRoot.visible = false;
        this.root.add(this.walkInInteriorRoot);
        this.walkInInteriorMeshes = this.walkInInteriorRoot;
        // Walk-ins are ordinary dark joinery, never self-lit panels. Their
        // rough generated-oak finish receives the tiny pull-chain lamp and
        // naturally falls to near-black again when the leaves close.
        const closetInterior = new THREE.MeshStandardMaterial({
          map: M.blackWood.map,
          bumpMap: M.blackWood.bumpMap,
          bumpScale: 0.014,
          color: 0x211611,
          roughness: 0.9,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        closetInterior.name = `${name}-dark-oak-interior-material`;
        closetInterior.color.setHex(0x211611);
        closetInterior.roughness = 0.9;
        closetInterior.metalness = 0;
        const closetShelfMaterial = M.darkWood.clone();
        closetShelfMaterial.name = `${name}-shelf-material`;
        closetShelfMaterial.color.setHex(0x39251b);
        closetShelfMaterial.roughness = 0.78;
        box({ name: `${name}-interior-back-liner`, w: width - shell * 2.15, h: height - 0.18, d: 0.028, x: 0, y: height / 2 - 0.02, z: -depth / 2 + shell + 0.017, material: closetInterior, parent: this.walkInInteriorRoot, cast: true, receive: true });
        box({ name: `${name}-interior-ceiling-liner`, w: width - shell * 2.15, h: 0.028, d: depth - shell * 1.4, x: 0, y: height - shell - 0.017, z: 0.02, material: closetInterior, parent: this.walkInInteriorRoot, cast: true, receive: true });
        for (const side of [-1, 1]) {
          box({ name: `${name}-interior-side-liner`, w: 0.028, h: height - 0.22, d: depth - shell * 1.6, x: side * (width / 2 - shell - 0.017), y: height / 2 - 0.03, z: 0.02, material: closetInterior, parent: this.walkInInteriorRoot, cast: true, receive: true });
          for (const sy of [0.62, 1.18]) {
            box({ name: `${name}-side-shelf`, w: width * 0.27, h: 0.055, d: depth * 0.58, x: side * width * 0.34, y: sy, z: -depth * 0.12, material: closetShelfMaterial, parent: this.walkInInteriorRoot, cast: true });
            roundedBox({ name: `${name}-folded-linen`, w: width * 0.18, h: 0.13, d: depth * 0.25, radius: 0.025, x: side * width * 0.34, y: sy + 0.095, z: -depth * 0.15, material: side > 0 ? M.fabric : M.velvet, parent: this.walkInInteriorRoot, cast: false });
          }
        }
        cylinder({ name: `${name}-hanging-rail`, radius: 0.025, height: width * 0.76, segments: 12, x: 0, y: height * 0.72, z: -depth * 0.22, rotationZ: Math.PI / 2, material: M.brass, parent: this.walkInInteriorRoot, cast: false });
        for (let i = -3; i <= 3; i += 1) {
          const garmentMaterial = i % 3 === 0 ? M.velvet : i % 3 === 1 ? M.fabric : M.leather;
          roundedBox({ name: `${name}-hanging-garment`, w: 0.24, h: 0.72 + (Math.abs(i) % 2) * 0.1, d: 0.08, radius: 0.025, x: i * width * 0.095, y: height * 0.52, z: -depth * 0.25, material: garmentMaterial, parent: this.walkInInteriorRoot, cast: false });
        }
        plane({ name: `${name}-interior-runner`, w: width * 0.72, h: depth * 0.62, x: 0, y: 0.02, z: -depth * 0.05, rotationX: -Math.PI / 2, material: M.greenRug, parent: this.walkInInteriorRoot });
        const closetBulb = new THREE.MeshStandardMaterial({ color: 0xffd29b, emissive: 0xff9e54, emissiveIntensity: 1.15 });
        const bulb = sphere({ name: `${name}-interior-bulb`, radius: 0.055, x: 0, y: height - 0.2, z: -depth * 0.2, material: closetBulb, parent: this.walkInInteriorRoot, cast: false });
        bulb.userData.onEmissiveIntensity = 1.15;
        bulb.userData.requiresOpenCabinet = this;
        this.lightCircuit = new LightCircuit(`${name} light`, floorY, 0xffb873, true);
        this.lightCircuit.enclosure = this;
        this.lightCircuit.bulbs.push(bulb);
        const closetLight = new THREE.SpotLight(0xffb873, 58, 2.0, 1.02, 0.68, 2);
        closetLight.name = `${name}-contained-light`;
        closetLight.position.set(0, height - 0.38, -depth * 0.06);
        const closetLightTarget = new THREE.Object3D();
        closetLightTarget.name = `${name}-contained-light-target`;
        closetLightTarget.position.set(0, 0.24, -depth * 0.12);
        this.root.add(closetLightTarget);
        closetLight.target = closetLightTarget;
        closetLight.userData.baseIntensity = 58;
        closetLight.userData.levels = new Set(["SECOND FLOOR"]);
        closetLight.userData.roomBounded = true;
        closetLight.userData.requiresOpenCabinet = this;
        closetLight.userData.visibleFixtureEmitter = true;
        closetLight.castShadow = supportsFullRoomShadowSet;
        if (closetLight.castShadow) {
          closetLight.shadow.mapSize.set(128, 128);
          closetLight.shadow.camera.near = 0.08;
          closetLight.shadow.camera.far = 1.55;
          closetLight.shadow.bias = -0.00035;
          closetLight.shadow.normalBias = 0.02;
        }
        this.root.add(closetLight);
        this.lightCircuit.lights.push(closetLight);

        // The pull-chain is the closet light's only runtime control. Like the
        // rest of the estate it starts on, hangs beside the clear center aisle,
        // and carries no collider, so it cannot obstruct entry.
        const pullX = width * 0.27;
        cylinder({ name: `${name}-pull-chain`, radius: 0.009, height: 0.62, segments: 8, x: pullX, y: height - 0.54, z: -depth * 0.12, material: M.brass, parent: this.walkInInteriorRoot, cast: false });
        const pull = sphere({ name: `${name}-pull`, radius: 0.052, x: pullX, y: height - 0.86, z: -depth * 0.12, material: M.brass, parent: this.walkInInteriorRoot, cast: false });
        this.lightCircuit.addControlTarget(pull, `pull chain for ${name}`);
        const pullHitbox = box({
          name: `${name}-pull-hitbox`,
          w: 0.32, h: 0.92, d: 0.3,
          x: pullX, y: height - 0.58, z: -depth * 0.12,
          material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
          parent: this.walkInInteriorRoot, cast: false, receive: false,
        });
        pullHitbox.visible = false;
        this.lightCircuit.addControlTarget(pullHitbox, `pull chain for ${name}`);
      } else {
        for (const sy of kitchenShelfHeights(height)) {
          box({ name: `${name}-shelf`, w: width * 0.9, h: 0.055, d: depth * 0.78, x: 0, y: sy, z: -depth * 0.04, material, parent: this.root, cast: false });
        }
        if (stockKind) {
          const stock = addStockedStorageContents(this.root, name, stockKind, width, height, depth);
          this.itemCount = stock.count;
          this.stockMeshes = stock.meshes;
          for (const mesh of this.stockMeshes) mesh.visible = false;
          if (this.hasInteriorLight) {
            this.interiorLight = new THREE.SpotLight(0xffc98a, 0, 1.65, 0.5, 0.68, 2);
            this.interiorLight.name = `${name}-door-operated-interior-light`;
            this.interiorLight.position.set(0, height * 0.72, depth * 0.08);
            const interiorLightTarget = new THREE.Object3D();
            interiorLightTarget.name = `${name}-door-operated-light-target`;
            interiorLightTarget.position.set(0, height * 0.44, depth * 0.72);
            this.root.add(interiorLightTarget);
            this.interiorLight.target = interiorLightTarget;
            this.interiorLight.userData.baseIntensity = 11;
            this.interiorLight.userData.interactionVisible = false;
            this.interiorLight.userData.levels = new Set([floorY === FLOOR.UPPER ? "SECOND FLOOR" : floorY === FLOOR.BASEMENT ? "BASEMENT" : "MAIN LEVEL"]);
            this.interiorLight.userData.roomBounded = true;
            this.interiorLight.castShadow = false;
            this.interiorLight.visible = false;
            this.root.add(this.interiorLight);
            auxiliaryInteriorLights.push(this.interiorLight);
          }
          stockedStorages.push(this);
        }
      }
      this.leftPivot = new THREE.Group();
      this.rightPivot = new THREE.Group();
      this.leftPivot.position.set(-width / 2, 0, depth / 2 + 0.025);
      this.rightPivot.position.set(width / 2, 0, depth / 2 + 0.025);
      this.root.add(this.leftPivot, this.rightPivot);
      this.leftDoor = this.makeDoor(width / 2, height, 1, material, this.leftPivot);
      this.rightDoor = this.makeDoor(width / 2, height, -1, material, this.rightPivot);
      if (walkIn) {
        box({ name: `${name}-door-center-astragal`, w: 0.075, h: height * 0.91, d: 0.105, x: width / 2 - 0.028, y: height * 0.52, z: 0.015, material: M.darkWood, parent: this.leftPivot, cast: true });
      }
      const interaction = {
        type: "cabinet",
        getLabel: () => `${this.open ? "Close" : "Open"} ${name}`,
        activate: () => this.setOpen(!this.open),
      };
      addInteractionTarget(this.leftDoor, interaction);
      addInteractionTarget(this.rightDoor, interaction);
      const addLocalCollider = (localX, localY, localZ, w, h, d) => {
        const point = new THREE.Vector3(localX, localY, localZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
        physics.addFixedBox(x + point.x, floorY + point.y, z + point.z, w, h, d, rotationY);
      };
      if (walkIn) {
        // Keep the threshold and center aisle free: only the shell itself is
        // solid, so an opened wardrobe can genuinely be stepped into.
        addLocalCollider(0, height / 2, -depth / 2 + shell / 2, width, height, shell);
        for (const side of [-1, 1]) addLocalCollider(side * (width / 2 - shell / 2), height / 2, 0, shell, height, depth);
        const thresholdPoint = new THREE.Vector3(0, height / 2, depth / 2 + 0.055).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
        const threshold = physics.addKinematicBox(x + thresholdPoint.x, floorY + thresholdPoint.y, z + thresholdPoint.z, width - 0.06, height * 0.91, 0.12);
        this.thresholdBody = threshold.body;
        this.thresholdCollider = threshold.collider;
      } else {
        addLocalCollider(0, height / 2, 0, width, height, depth);
      }
      animatedObjects.push(this);
    }

    setOpen(open, silent) {
      const nextOpen = Boolean(open);
      this.open = nextOpen;
      this.target = this.open ? THREE.MathUtils.degToRad(this.openAngle) : 0;
      // Closing a walk-in from the inside is allowed; the doors just swing shut
      // around you. The threshold only re-seals when nobody is standing in it,
      // so the player is never shoved or trapped and can always step back out.
      const sealThreshold = !this.open && !(this.walkIn && this.isPlayerInside());
      if (this.thresholdCollider) this.thresholdCollider.setEnabled(sealThreshold);
      if (this.walkInInteriorMeshes && this.open) this.walkInInteriorMeshes.visible = true;
      if (this.interiorLight) {
        this.interiorLight.userData.interactionVisible = this.open;
      }
      if (this.walkIn) syncLightRendering();
      else if (this.interiorLight) syncLightRendering();
      if (this.stockMeshes) for (const mesh of this.stockMeshes) mesh.visible = this.open && !interiorDetailsHidden;
      if (!silent && audioSystem) audioSystem.cabinet(this.open);
    }

    isPlayerInside() {
      if (!this.walkIn || !physics) return false;
      this.root.updateMatrixWorld(true);
      const p = physics.playerPosition();
      const local = this.root.worldToLocal(new THREE.Vector3(p.x, p.y, p.z));
      return Math.abs(local.x) < this.width / 2 - 0.05
        && local.z > -this.depth / 2 - 0.12
        && local.z < this.depth / 2 + 0.2;
    }

    makeDoor(width, height, side, material, pivot) {
      const door = box({ name: `${this.name}-door`, w: width - 0.025, h: height * 0.91, d: 0.07, x: side * width / 2, y: height * 0.52, z: 0, material, parent: pivot, cast: true });
      for (const face of [-1, 1]) {
        box({ name: `${this.name}-door-inset`, w: width * 0.68, h: height * 0.68, d: 0.018, x: side * width / 2, y: height * 0.52, z: face * 0.047, material: M.blackWood, parent: pivot, cast: false });
        // Pulls sit just inside the meeting seam and remain attached to their
        // own leaf while it swings; they can no longer drift beyond a door.
        sphere({ name: `${this.name}-pull`, radius: 0.055, x: side * (width - 0.12), y: height * 0.52, z: face * 0.095, material: M.brass, parent: pivot });
      }
      return door;
    }

    update(dt) {
      const before = this.angle;
      this.angle = ease(this.angle, this.target, 6.2, dt);
      if (Math.abs(this.angle - this.target) < 0.002) this.angle = this.target;
      this.leftPivot.rotation.y = -this.angle;
      this.rightPivot.rotation.y = this.angle;
      if (this.walkInInteriorMeshes) this.walkInInteriorMeshes.visible = this.open || this.angle > 0.025;
      if (before !== this.angle && this.angle === this.target) renderer.shadowMap.needsUpdate = true;
    }
  }

  class HidingSpot {
    constructor(options) {
      const { name, targets, floorY, hidePosition, exitPosition } = options;
      this.name = name;
      this.floorY = floorY;
      this.hidePosition = hidePosition;
      this.exitPosition = exitPosition;
      this.interaction = {
        type: "hide",
        getLabel: () => state.activeHideSpot === this ? `Leave ${name}` : `Hide in ${name}`,
        activate: () => state.activeHideSpot === this ? this.exit() : this.enter(),
      };
      for (const target of targets) addInteractionTarget(target, this.interaction);
      hidingSpots.push(this);
    }

    enter() {
      if (state.activeHideSpot) return;
      state.activeHideSpot = this;
      state.isHidden = true;
      input.forward = false;
      input.back = false;
      input.left = false;
      input.right = false;
      teleport(this.hidePosition.x, this.floorY, this.hidePosition.z, this.hidePosition.yaw, 0);
      if (dom.stage) dom.stage.classList.add("is-hiding");
      if (dom.hiddenStatus) {
        dom.hiddenStatus.hidden = false;
        dom.hiddenStatus.textContent = "Hidden among the coats";
      }
      state.currentInteraction = this.interaction;
      updateInteractionPrompt();
    }

    exit() {
      if (state.activeHideSpot !== this) return;
      state.activeHideSpot = null;
      state.isHidden = false;
      teleport(this.exitPosition.x, this.floorY, this.exitPosition.z, this.exitPosition.yaw, 0);
      if (dom.stage) dom.stage.classList.remove("is-hiding");
      if (dom.hiddenStatus) dom.hiddenStatus.hidden = true;
      state.currentInteraction = null;
      updateLocation();
      updateInteractionPrompt();
    }
  }

  class ContestantThirteenQuest {
    constructor() {
      this.story = state.contestant13;
      this.interactions = new Map();
      this.discoveryTimer = null;
      this.actionTimer = null;
      this.journalReturnFocus = null;
    }

    registerInteraction(id, targets, getLabel, activate) {
      const interaction = { type: "story", id, getLabel, activate };
      this.interactions.set(id, interaction);
      for (const target of targets.filter(Boolean)) addInteractionTarget(target, interaction);
      return interaction;
    }

    unregisterTree(root) {
      if (!root) return;
      root.traverse((object) => removeInteractionTarget(object));
    }

    hasItem(id) {
      return this.story.inventory.includes(id);
    }

    addItem(id) {
      if (this.hasItem(id)) return false;
      this.story.inventory.push(id);
      return true;
    }

    addJournalEntry(entry) {
      if (!entry || this.story.journalEntries.some((candidate) => candidate.id === entry.id)) return false;
      this.story.journalEntries.push({ id: entry.id, title: entry.title, body: entry.body });
      return true;
    }

    getPhase() {
      if (this.story.relaySabotaged) return "complete";
      if (!this.story.noteRead) return "find-note";
      if (this.story.recordingPlayed) return "sabotage-relay";
      if (this.story.archiveCageUnlocked) return "play-recording";
      if (this.story.archiveKeyFound) return "unlock-archive";
      if (this.story.shovelTaken) return "dig-maze";
      return "find-shovel";
    }

    getObjective() {
      const phase = this.getPhase();
      if (phase === "complete") return CONTESTANT_13.objectives.complete;
      if (phase === "sabotage-relay") return CONTESTANT_13.objectives.relay;
      if (phase === "play-recording") return CONTESTANT_13.objectives.recording;
      if (phase === "unlock-archive") return CONTESTANT_13.objectives.archive;
      if (phase === "dig-maze") return CONTESTANT_13.objectives.maze;
      if (phase === "find-shovel") return CONTESTANT_13.objectives.shovel;
      return CONTESTANT_13.objectives.note;
    }

    updateUI() {
      if (dom.caseFile) dom.caseFile.hidden = !state.started;
      if (dom.objective) dom.objective.textContent = this.getObjective();
      if (dom.storyProgress) {
        const completed = [
          this.story.noteRead,
          this.story.shovelTaken,
          this.story.digSiteExcavated,
          this.story.archiveCageUnlocked,
          this.story.recordingPlayed,
          this.story.relaySabotaged,
        ].filter(Boolean).length;
        dom.storyProgress.textContent = `Trail ${completed}/6`;
      }
      if (dom.inventory) {
        dom.inventory.replaceChildren();
        if (!this.story.inventory.length) {
          const empty = document.createElement("span");
          empty.className = "mansion-inventory__empty";
          empty.textContent = "Nothing carried";
          dom.inventory.appendChild(empty);
        } else {
          for (const id of this.story.inventory) {
            const item = document.createElement("span");
            item.className = "mansion-inventory__item";
            item.dataset.item = id;
            item.textContent = CONTESTANT_13.itemLabels[id] || id;
            dom.inventory.appendChild(item);
          }
        }
      }
      if (dom.journalEntries) {
        dom.journalEntries.replaceChildren();
        if (!this.story.journalEntries.length) {
          const empty = document.createElement("li");
          empty.className = "mansion-journal__empty";
          empty.textContent = "No entries yet. Search the mansion.";
          dom.journalEntries.appendChild(empty);
        } else {
          for (const entry of this.story.journalEntries) {
            const item = document.createElement("li");
            item.className = "mansion-journal__entry";
            item.dataset.entry = entry.id;
            const title = document.createElement("strong");
            title.textContent = entry.title;
            const body = document.createElement("span");
            body.textContent = entry.body;
            item.append(title, body);
            dom.journalEntries.appendChild(item);
          }
        }
      }
      if (dom.journalButton) dom.journalButton.setAttribute("aria-expanded", String(state.journalOpen));
    }

    showDiscovery(title, body, durationMs = 7600) {
      if (!dom.discovery) return;
      clearTimeout(this.discoveryTimer);
      if (dom.discoveryTitle) dom.discoveryTitle.textContent = title;
      if (dom.discoveryBody) dom.discoveryBody.textContent = body;
      dom.discovery.hidden = false;
      this.discoveryTimer = setTimeout(() => {
        if (dom.discovery) dom.discovery.hidden = true;
      }, durationMs);
    }

    setJournalOpen(open) {
      const nextOpen = Boolean(open);
      if (nextOpen === state.journalOpen) return;
      if (nextOpen) this.journalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : dom.journalButton;
      state.journalOpen = nextOpen;
      input.forward = input.back = input.left = input.right = false;
      if (state.journalOpen && document.pointerLockElement === dom.canvas && document.exitPointerLock) document.exitPointerLock();
      if (dom.journal) dom.journal.hidden = !state.journalOpen;
      if (dom.stage && dom.journal) {
        for (const child of dom.stage.children) {
          if (child !== dom.journal) child.inert = state.journalOpen;
        }
      }
      this.updateUI();
      if (state.journalOpen) {
        requestAnimationFrame(() => dom.journalClose?.focus({ preventScroll: true }));
      } else {
        const returnTarget = this.journalReturnFocus && this.journalReturnFocus.isConnected ? this.journalReturnFocus : dom.canvas;
        this.journalReturnFocus = null;
        returnTarget?.focus({ preventScroll: true });
      }
    }

    toggleJournal() {
      this.setJournalOpen(!state.journalOpen);
    }

    runTimedAction(id, label, durationMs, complete) {
      if (this.story.actionInProgress) return false;
      this.story.actionInProgress = { id, label, durationMs, startedAt: performance.now() };
      input.forward = input.back = input.left = input.right = false;
      if (dom.action) {
        dom.action.hidden = false;
        dom.action.classList.remove("is-running");
        dom.action.style.setProperty("--story-action-duration", `${durationMs}ms`);
        if (dom.actionText) dom.actionText.textContent = label;
        if (dom.actionFill) {
          dom.actionFill.style.animation = "none";
          void dom.actionFill.offsetWidth;
          dom.actionFill.style.animation = "";
        }
        dom.action.classList.add("is-running");
      }
      clearTimeout(this.actionTimer);
      this.actionTimer = setTimeout(() => {
        if (!this.story.actionInProgress || this.story.actionInProgress.id !== id) return;
        this.story.actionInProgress = null;
        if (dom.action) {
          dom.action.classList.remove("is-running");
          dom.action.hidden = true;
        }
        complete();
        this.updateUI();
        updateInteractionPrompt();
      }, durationMs);
      return true;
    }

    readNote() {
      if (this.story.noteRead) {
        this.showDiscovery(CONTESTANT_13.journal.note.title, CONTESTANT_13.journal.note.body);
        return;
      }
      this.story.noteRead = true;
      this.addJournalEntry(CONTESTANT_13.journal.note);
      this.showDiscovery("Message from Contestant 13", CONTESTANT_13.journal.note.body);
      if (audioSystem) audioSystem.ping(392, 0.42, 0.06, "sine");
      this.updateUI();
    }

    takeShovel() {
      if (this.story.shovelTaken) return;
      this.story.shovelTaken = true;
      this.addItem("garden-shovel");
      this.addJournalEntry(CONTESTANT_13.journal.shovel);
      if (contestant13Scene.shovel) {
        this.unregisterTree(contestant13Scene.shovel);
        contestant13Scene.shovel.visible = false;
      }
      this.showDiscovery("Concealed garden shovel", "XIII is cut into the handle. The maze is the only ground soft enough to hide something quickly.");
      if (audioSystem) audioSystem.ping(145, 0.25, 0.08, "triangle");
      this.updateUI();
    }

    digSite() {
      if (this.story.digSiteExcavated || this.story.digging) {
        if (this.story.digSiteExcavated) this.showDiscovery(CONTESTANT_13.journal.cache.title, CONTESTANT_13.journal.cache.body);
        return;
      }
      if (!this.story.noteRead) {
        this.showDiscovery("XIII in stone", "The mark is deliberate, but without Contestant 13's message you do not know what was buried here. Search the Library.");
        return;
      }
      if (!this.hasItem("garden-shovel")) {
        this.showDiscovery("Disturbed earth", "The soil beneath XIII has been packed back by hand. You need something strong enough to dig.");
        return;
      }
      this.story.digging = true;
      const started = this.runTimedAction("contestant-13-dig", "Digging beneath the faint mark", 1800, () => {
        this.story.digging = false;
        this.story.digSiteExcavated = true;
        this.story.archiveKeyFound = true;
        this.story.badgeFound = true;
        this.story.tapeFound = true;
        this.addItem("archive-key-a3");
        this.addItem("contestant-13-badge");
        this.addItem("contestant-13-tape");
        this.addJournalEntry(CONTESTANT_13.journal.cache);
        if (contestant13Scene.digMound) contestant13Scene.digMound.visible = false;
        if (contestant13Scene.digMarker) contestant13Scene.digMarker.visible = false;
        if (contestant13Scene.digHole) contestant13Scene.digHole.visible = true;
        this.showDiscovery("Buried cache A-3", "A brass Archive key, Badge 13, and a wax-sealed tape reel emerge from the rain-black soil.");
        if (audioSystem) {
          audioSystem.ping(118, 0.34, 0.08, "triangle");
          audioSystem.ping(236, 0.4, 0.05, "sine");
        }
      });
      if (!started) this.story.digging = false;
    }

    unlockArchiveCage() {
      if (this.story.archiveCageUnlocked) return;
      if (!this.hasItem("archive-key-a3")) {
        this.showDiscovery("Evidence cage A-3", "The brass lock is stamped with the same A-3 mark as an Archive key.");
        return;
      }
      this.story.archiveCageUnlocked = true;
      if (contestant13Scene.archiveCageDoor) contestant13Scene.archiveCageDoor.rotation.y = -1.25;
      this.showDiscovery("Evidence cage unlocked", "The buried reel fits the recorder inside. A typed routing card mentions two separate camera feeds.");
      if (audioSystem) audioSystem.ping(310, 0.24, 0.07, "square");
      this.updateUI();
    }

    playRecording() {
      if (!this.story.archiveCageUnlocked || !this.story.tapeFound) {
        this.showDiscovery("Silent recorder", "The cage is locked and its tape spindle is empty.");
        return;
      }
      if (!this.story.recordingPlayed) {
        this.story.recordingPlayed = true;
        this.addJournalEntry(CONTESTANT_13.journal.transcript);
      }
      if (contestant13Scene.archiveRecorderIndicator && contestant13Scene.archiveRecorderIndicatorMaterial) {
        contestant13Scene.archiveRecorderIndicator.userData.active = true;
        contestant13Scene.archiveRecorderIndicatorMaterial.color.setHex(0xd2ad5c);
        contestant13Scene.archiveRecorderIndicatorMaterial.emissive.setHex(0xff9d32);
        contestant13Scene.archiveRecorderIndicatorMaterial.emissiveIntensity = 2.2;
      }
      this.showDiscovery("Contestant 13 — recovered recording", `“${CONTESTANT_13.transcript}”`, 13000);
      if (audioSystem) {
        audioSystem.ping(92, 0.8, 0.035, "sawtooth");
        audioSystem.ping(184, 0.5, 0.025, "sine");
      }
      this.updateUI();
    }

    sabotageRelay() {
      if (this.story.relaySabotaged) {
        this.showDiscovery("Private feed offline", "The unlabeled cable bank is dead. A red warning lamp is still calling attention to the loss.");
        return;
      }
      if (!this.story.recordingPlayed) {
        this.showDiscovery("Two camera networks", "Brass tags identify the public feed. The second cable bank is unlabelled. Guessing here could wake every alarm in the house.");
        return;
      }
      this.runTimedAction("contestant-13-relay", "Severing the patron camera feed", 2400, () => {
        this.story.relaySabotaged = true;
        this.story.threatEscalated = true;
        if (contestant13Scene.relayBlackCables) {
          contestant13Scene.relayBlackCables.visible = false;
          contestant13Scene.relayBlackCables.traverse((object) => {
            if (object.isMesh) object.userData.preExteriorVisibility = false;
          });
        }
        if (contestant13Scene.relayOnlineBulb) {
          contestant13Scene.relayOnlineBulb.visible = false;
          contestant13Scene.relayOnlineBulb.userData.preExteriorVisibility = false;
        }
        if (contestant13Scene.relayAlarmBulb) {
          contestant13Scene.relayAlarmBulb.visible = true;
          contestant13Scene.relayAlarmBulb.userData.preExteriorVisibility = true;
        }
        this.addJournalEntry(CONTESTANT_13.journal.sabotage);
        this.showDiscovery("Patron signal lost", "The hidden feed collapses into static. A warning lamp begins to pulse: the house knows the patrons are blind.", 11000);
        if (audioSystem) {
          audioSystem.ping(74, 0.7, 0.09, "sawtooth");
          audioSystem.ping(520, 0.18, 0.08, "square");
        }
      });
    }

    getInventoryDiagnostics() {
      return {
        items: this.story.inventory.slice(),
        bulkyItem: this.hasItem("garden-shovel") ? "garden-shovel" : null,
      };
    }

    getJournalDiagnostics() {
      return {
        entries: this.story.journalEntries.map((entry) => entry.id),
        currentObjective: this.getObjective(),
        open: state.journalOpen,
      };
    }

    getDiagnostics() {
      return {
        noteRead: this.story.noteRead,
        shovelTaken: this.story.shovelTaken,
        digSiteExcavated: this.story.digSiteExcavated,
        archiveKeyFound: this.story.archiveKeyFound,
        badgeFound: this.story.badgeFound,
        tapeFound: this.story.tapeFound,
        archiveCageUnlocked: this.story.archiveCageUnlocked,
        recordingPlayed: this.story.recordingPlayed,
        relaySabotaged: this.story.relaySabotaged,
        threatEscalated: this.story.threatEscalated,
        actionInProgress: this.story.actionInProgress ? { ...this.story.actionInProgress } : null,
        phase: this.getPhase(),
        completed: this.story.relaySabotaged,
        world: {
          shovelVisible: Boolean(contestant13Scene.shovel && contestant13Scene.shovel.visible),
          shovelScale: contestant13Scene.shovel?.scale.x ?? CONTESTANT_13.world.shovel.scale,
          shovelPosition: {
            x: contestant13Scene.shovel?.position.x ?? CONTESTANT_13.world.shovel.x,
            z: contestant13Scene.shovel?.position.z ?? CONTESTANT_13.world.shovel.z,
          },
          digSiteOpen: this.story.digSiteExcavated,
          digSiteCell: {
            row: CONTESTANT_13.world.digSite.row,
            col: CONTESTANT_13.world.digSite.col,
            pathStepsFromRear: CONTESTANT_13.world.digSite.pathStepsFromRear,
            pathStepsFromNorth: CONTESTANT_13.world.digSite.pathStepsFromNorth,
          },
          digMoundVisible: Boolean(contestant13Scene.digMound?.visible),
          digMarkerVisible: Boolean(contestant13Scene.digMarker?.visible),
          digHoleVisible: Boolean(contestant13Scene.digHole?.visible),
          archiveCageOpen: state.contestant13.archiveCageUnlocked,
          recorderIndicatorActive: Boolean(contestant13Scene.archiveRecorderIndicator?.userData.active),
          relayOnline: !state.contestant13.relaySabotaged,
          relayOnlineBulbVisible: Boolean(contestant13Scene.relayOnlineBulb?.visible),
          relayAlarmBulbVisible: Boolean(contestant13Scene.relayAlarmBulb?.visible),
          relayAlarmPulsing: Boolean(state.contestant13.relaySabotaged && contestant13Scene.relayAlarmMaterial),
        },
      };
    }
  }

  function kitchenShelfHeights(height) {
    // Under-counter cabinets need two deliberately separated shelves. Clamping
    // the tall-cabinet elevations used to collapse the upper two shelves onto
    // the same plane, which made open base cabinets flicker and their stock
    // intersect. Tall storage keeps the established three-shelf rhythm.
    if (height < 1.2) return [height * 0.34, height * 0.67];
    return [0.52, 1.02, 1.5].map((value) => Math.min(value, height - 0.18));
  }

  function addLocalInstanceBatch(name, parent, geometryName, geometryFactory, material, transforms) {
    if (!transforms.length) return null;
    const mesh = new THREE.InstancedMesh(geometry(geometryName, geometryFactory), material, transforms.length);
    const dummy = new THREE.Object3D();
    transforms.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(item.rx || 0, item.ry || 0, item.rz || 0);
      dummy.scale.set(item.sx, item.sy, item.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
    return mesh;
  }

  function addStockedStorageContents(parent, name, kind, width, height, depth) {
    const shelfYs = kitchenShelfHeights(height);
    const boxes = [];
    const tins = [];
    const bottles = [];
    const produce = [];
    const sacks = [];
    const jars = [];
    const jarLids = [];
    const plates = [];
    const cups = [];
    const usable = width * 0.78;
    const z = Math.min(depth * 0.06, 0.08);
    const positionX = (index, count) => -usable / 2 + 0.13 + index * (usable - 0.26) / Math.max(1, count - 1);
    if (kind === "dishes") {
      shelfYs.forEach((shelfY, shelfIndex) => {
        for (let i = 0; i < 4; i += 1) {
          plates.push({ x: -usable * 0.29 + i * usable * 0.19, y: shelfY + 0.065 + (i % 2) * 0.022, z, sx: 0.16, sy: 0.022, sz: 0.16 });
        }
        for (let i = 0; i < 3; i += 1) {
          cups.push({ x: usable * 0.16 + i * 0.19, y: shelfY + 0.14, z: z - 0.02, sx: 0.085, sy: 0.15, sz: 0.085 });
        }
      });
    } else if (kind === "preserves") {
      shelfYs.forEach((shelfY, shelfIndex) => {
        const count = 6;
        for (let i = 0; i < count; i += 1) {
          const x = positionX(i, count);
          const jarHeight = 0.22 + ((i + shelfIndex) % 2) * 0.045;
          jars.push({ x, y: shelfY + jarHeight / 2 + 0.035, z, sx: 0.075, sy: jarHeight, sz: 0.075 });
          jarLids.push({ x, y: shelfY + jarHeight + 0.045, z, sx: 0.082, sy: 0.025, sz: 0.082 });
        }
      });
    } else if (kind === "tinned-goods") {
      shelfYs.forEach((shelfY, shelfIndex) => {
        const count = 7;
        for (let i = 0; i < count; i += 1) {
          const x = positionX(i, count);
          if ((i + shelfIndex) % 4 === 0) boxes.push({ x, y: shelfY + 0.17, z, sx: 0.17, sy: 0.32, sz: 0.15 });
          else tins.push({ x, y: shelfY + 0.12, z, sx: 0.085, sy: 0.22, sz: 0.085 });
        }
      });
    } else if (["pantry-staples", "dry-goods", "baking"].includes(kind)) {
      shelfYs.forEach((shelfY, shelfIndex) => {
        const count = 6;
        for (let i = 0; i < count; i += 1) {
          const x = positionX(i, count);
          const selector = (i + shelfIndex * 2 + (kind === "baking" ? 1 : 0)) % 4;
          if (selector === 0) boxes.push({ x, y: shelfY + 0.18, z, sx: 0.18, sy: 0.34, sz: 0.16 });
          else if (selector === 1) sacks.push({ x, y: shelfY + 0.14, z, sx: 0.14, sy: 0.17, sz: 0.09, rz: (i % 2 ? 1 : -1) * 0.04 });
          else if (selector === 2) tins.push({ x, y: shelfY + 0.12, z, sx: 0.085, sy: 0.22, sz: 0.085 });
          else bottles.push({ x, y: shelfY + 0.17, z, sx: 0.07, sy: 0.32, sz: 0.07 });
        }
      });
    } else {
      shelfYs.forEach((shelfY, shelfIndex) => {
        const count = kind === "refrigerator" ? 5 : 6;
        for (let i = 0; i < count; i += 1) {
          const x = positionX(i, count);
          const selector = (i + shelfIndex * 2) % 4;
          if (selector === 0) boxes.push({ x, y: shelfY + 0.18, z, sx: 0.18, sy: 0.34, sz: 0.16 });
          else if (selector === 1) tins.push({ x, y: shelfY + 0.13, z, sx: 0.09, sy: 0.24, sz: 0.09 });
          else if (selector === 2) bottles.push({ x, y: shelfY + 0.18, z, sx: 0.075, sy: 0.34, sz: 0.075 });
          else produce.push({ x, y: shelfY + 0.1, z, sx: 0.095, sy: 0.095, sz: 0.095 });
        }
      });
    }
    const meshes = [
      addLocalInstanceBatch(`${name}-stocked-boxes`, parent, "unitBox", () => new THREE.BoxGeometry(1, 1, 1), M.foodBox, boxes),
      addLocalInstanceBatch(`${name}-stocked-tins`, parent, "unitCylinder", () => new THREE.CylinderGeometry(1, 1, 1, 12), M.foodTin, tins),
      addLocalInstanceBatch(`${name}-stocked-bottles`, parent, "unitBottle", () => new THREE.CylinderGeometry(0.62, 1, 1, 12), M.foodBottle, bottles),
      addLocalInstanceBatch(`${name}-stocked-produce`, parent, "unitSphere", () => new THREE.SphereGeometry(1, 12, 8), M.produce, produce),
      addLocalInstanceBatch(`${name}-pantry-flour-sacks`, parent, "unitSphere", () => new THREE.SphereGeometry(1, 12, 8), M.canvasLinen, sacks),
      addLocalInstanceBatch(`${name}-pantry-preserve-jars`, parent, "unitCylinder", () => new THREE.CylinderGeometry(1, 1, 1, 12), M.foodBottle, jars),
      addLocalInstanceBatch(`${name}-pantry-jar-lids`, parent, "unitCylinder", () => new THREE.CylinderGeometry(1, 1, 1, 12), M.foodTin, jarLids),
      addLocalInstanceBatch(`${name}-stacked-plates`, parent, "unitCylinder", () => new THREE.CylinderGeometry(1, 1, 1, 12), M.dishBlue, plates),
      addLocalInstanceBatch(`${name}-cups`, parent, "unitCylinder", () => new THREE.CylinderGeometry(1, 1, 1, 12), M.porcelain, cups),
    ].filter(Boolean);
    return { count: boxes.length + tins.length + bottles.length + produce.length + sacks.length + jars.length + plates.length + cups.length, meshes };
  }

  class Refrigerator {
    constructor(options) {
      const {
        name = "kitchen refrigerator", x, z, floorY, width = 1.25,
        height = 2.25, depth = 0.82, rotationY = 0,
      } = options;
      this.name = name;
      this.stockKind = "refrigerator";
      this.open = false;
      this.angle = 0;
      this.target = 0;
      this.root = new THREE.Group();
      this.root.name = name;
      this.root.position.set(x, floorY, z);
      this.root.rotation.y = rotationY;
      scene.add(this.root);

      const shell = 0.09;
      const liner = new THREE.MeshStandardMaterial({ color: 0xcfd3cf, emissive: 0xffd6a0, emissiveIntensity: 0.02, roughness: 0.35 });
      this.liner = liner;
      box({ name: `${name}-back`, w: width, h: height, d: shell, x: 0, y: height / 2, z: -depth / 2 + shell / 2, material: liner, parent: this.root });
      for (const side of [-1, 1]) box({ name: `${name}-side`, w: shell, h: height, d: depth, x: side * (width / 2 - shell / 2), y: height / 2, z: 0, material: M.enamel, parent: this.root });
      box({ name: `${name}-top`, w: width, h: shell, d: depth, x: 0, y: height - shell / 2, z: 0, material: M.enamel, parent: this.root });
      box({ name: `${name}-base`, w: width, h: shell, d: depth, x: 0, y: shell / 2, z: 0, material: M.enamel, parent: this.root });
      for (const sy of [0.52, 1.02, 1.5]) box({ name: `${name}-glass-shelf`, w: width * 0.84, h: 0.035, d: depth * 0.67, x: 0, y: sy, z: -0.02, material: M.glass, parent: this.root, cast: false });
      const stock = addStockedStorageContents(this.root, name, "refrigerator", width, height, depth);
      this.itemCount = stock.count;
      this.stockMeshes = stock.meshes;
      for (const mesh of this.stockMeshes) mesh.visible = false;

      this.doorPivot = new THREE.Group();
      this.doorPivot.position.set(-width / 2, 0, depth / 2 + 0.035);
      this.root.add(this.doorPivot);
      this.door = box({ name: `${name}-door`, w: width, h: height * 0.94, d: 0.095, x: width / 2, y: height * 0.52, z: 0, material: M.enamel, parent: this.doorPivot });
      box({ name: `${name}-freezer-panel`, w: width * 0.88, h: height * 0.28, d: 0.018, x: width / 2, y: height * 0.2, z: 0.058, material: M.agedTrim, parent: this.doorPivot, cast: false });
      const handle = cylinder({ name: `${name}-handle`, radius: 0.026, height: height * 0.46, x: width * 0.88, y: height * 0.66, z: 0.095, material: M.brass, parent: this.doorPivot });
      const interaction = {
        type: "refrigerator",
        getLabel: () => `${this.open ? "Close" : "Open"} refrigerator`,
        activate: () => this.setOpen(!this.open),
      };
      addInteractionTarget(this.door, interaction);
      addInteractionTarget(handle, interaction);
      physics.addFixedBox(x, floorY + height / 2, z, width, height, depth, rotationY);
      stockedStorages.push(this);
      refrigerators.push(this);
      animatedObjects.push(this);
    }

    setOpen(open, silent) {
      this.open = Boolean(open);
      this.target = this.open ? -THREE.MathUtils.degToRad(104) : 0;
      for (const mesh of this.stockMeshes) mesh.visible = this.open && !interiorDetailsHidden;
      if (!silent && audioSystem) audioSystem.cabinet(this.open);
    }

    update(dt) {
      const before = this.angle;
      this.angle = ease(this.angle, this.target, 6.2, dt);
      if (Math.abs(this.angle - this.target) < 0.002) this.angle = this.target;
      this.doorPivot.rotation.y = this.angle;
      this.liner.emissiveIntensity = ease(this.liner.emissiveIntensity, this.open ? 0.32 : 0.02, 7, dt);
      if (before !== this.angle && this.angle === this.target) renderer.shadowMap.needsUpdate = true;
    }
  }

  class WaterFixture {
    constructor(options) {
      const {
        name, kind = "sink", x = 0, y = 0, z = 0, rotationY = 0,
        drop = 0.28, parent = scene, handleOffset = null,
      } = options;
      this.name = name;
      this.kind = kind;
      this.on = false;
      this.flow = 0;
      this.targetFlow = 0;
      this.drop = drop;
      this.phase = Math.random() * Math.PI * 2;
      this.root = new THREE.Group();
      this.root.name = name;
      this.root.position.set(x, y, z);
      this.root.rotation.y = rotationY;
      parent.add(this.root);

      this.waterMaterial = M.water.clone();
      this.waterMaterial.opacity = 0;
      const streamGeometry = kind === "shower"
        ? new THREE.CylinderGeometry(0.045, 0.26, drop, 18, 1, true)
        : new THREE.CylinderGeometry(0.022, 0.018, drop, 10, 1, true);
      this.stream = new THREE.Mesh(streamGeometry, this.waterMaterial);
      this.stream.name = `${name}-water-stream`;
      this.stream.position.y = -drop / 2;
      this.stream.visible = false;
      this.stream.castShadow = false;
      this.root.add(this.stream);

      this.rippleMaterial = M.water.clone();
      this.rippleMaterial.opacity = 0;
      this.ripple = new THREE.Mesh(new THREE.TorusGeometry(kind === "shower" ? 0.27 : 0.1, 0.012, 6, 20), this.rippleMaterial);
      this.ripple.name = `${name}-water-ripple`;
      this.ripple.rotation.x = Math.PI / 2;
      this.ripple.position.y = -drop;
      this.ripple.visible = false;
      this.root.add(this.ripple);

      const handleX = handleOffset?.x ?? (kind === "sink" ? 0.2 : kind === "tub" ? 0.3 : 0.23);
      const handleY = handleOffset?.y ?? (kind === "shower" ? -1.02 : kind === "sink" ? -0.08 : -0.05);
      const handleZ = handleOffset?.z ?? (kind === "sink" ? -0.3 : 0);
      let handleTargetX = handleX;
      let handleTargetY = handleY;
      let handleTargetZ = handleZ;
      if (kind === "shower") {
        cylinder({ name: `${name}-water-valve-mount`, radius: 0.11, height: 0.035, segments: 18, x: handleX, y: handleY, z: handleZ + 0.2, rotationX: Math.PI / 2, material: M.brass, parent: this.root, cast: false });
        cylinder({ name: `${name}-valve-stem`, radius: 0.024, height: 0.2, x: handleX, y: handleY, z: handleZ + 0.1, rotationX: Math.PI / 2, material: M.brass, parent: this.root, cast: false });
      } else {
        // Sink and tub valves sit on their decks as compact cross handles.
        // The former 42cm pedestal made each control taller than its faucet.
        cylinder({ name: `${name}-water-valve-collar`, radius: 0.052, height: 0.025, segments: 18, x: handleX, y: handleY - 0.09, z: handleZ, material: M.brass, parent: this.root, cast: false });
        cylinder({ name: `${name}-water-valve-mount`, radius: 0.018, height: 0.13, x: handleX, y: handleY - 0.025, z: handleZ, material: M.brass, parent: this.root, cast: false });
        cylinder({ name: `${name}-valve-stem`, radius: 0.015, height: 0.15, x: handleX, y: handleY + 0.045, z: handleZ, rotationZ: Math.PI / 2, material: M.brass, parent: this.root, cast: false });
        handleTargetX += 0.075;
        handleTargetY += 0.045;
      }
      const handle = sphere({ name: `${name}-water-handle`, radius: kind === "shower" ? 0.065 : 0.038, x: handleTargetX, y: handleTargetY, z: handleTargetZ, material: M.brass, parent: this.root, cast: false });
      const interaction = {
        type: "water",
        getLabel: () => `${this.on ? "Turn off" : "Turn on"} ${name}`,
        activate: () => this.setOn(!this.on),
      };
      addInteractionTarget(handle, interaction);
      const hitbox = box({
        name: `${name}-water-hitbox`, w: kind === "shower" ? 0.38 : 0.3, h: kind === "shower" ? 0.38 : 0.28, d: kind === "shower" ? 0.32 : 0.28,
        x: handleTargetX, y: handleTargetY, z: handleTargetZ, parent: this.root,
        material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        cast: false, receive: false,
      });
      // Raycasters can still hit invisible meshes; keeping helpers out of the
      // render list avoids paying a draw call for every transparent control.
      hitbox.visible = false;
      addInteractionTarget(hitbox, interaction);
      waterFixtures.push(this);
      animatedObjects.push(this);
    }

    setOn(on, silent) {
      this.on = Boolean(on);
      this.targetFlow = this.on ? 1 : 0;
      if (!silent && audioSystem) audioSystem.setWater(this.name, this.on, this.kind);
    }

    update(dt) {
      this.flow = ease(this.flow, this.targetFlow, this.on ? 9 : 12, dt);
      const visible = this.flow > 0.015;
      this.stream.visible = visible;
      this.ripple.visible = visible;
      this.stream.scale.y = Math.max(0.02, this.flow);
      this.stream.position.y = -this.drop * this.flow / 2;
      this.waterMaterial.opacity = this.flow * (this.kind === "shower" ? 0.34 : 0.72);
      this.rippleMaterial.opacity = this.flow * 0.48;
      const pulse = 0.88 + Math.sin(performance.now() * 0.006 + this.phase) * 0.12;
      this.ripple.scale.setScalar(pulse * this.flow);
    }
  }

  class LightCircuit {
    constructor(name, floorY, color, initiallyOn) {
      this.name = name;
      this.floorY = floorY;
      this.color = color || 0xffc57a;
      this.on = initiallyOn !== false;
      this.lights = [];
      this.bulbs = [];
      this.glowMaterials = [];
      this.controls = 0;
      this.distanceSq = Infinity;
      this.levels = new Set([floorY === FLOOR.BASEMENT ? "BASEMENT" : floorY === FLOOR.UPPER ? "SECOND FLOOR" : "MAIN LEVEL"]);
      circuits.push(this);
    }

    addFixture(x, z, style, floorYOverride) {
      const fixtureFloorY = floorYOverride == null ? this.floorY : floorYOverride;
      const ceilingY = fixtureFloorY + (fixtureFloorY === FLOOR.UPPER ? 3.05 : 3.72);
      const isGrand = style === "grand" || style === "atrium";
      const profiles = {
        // Reach scales with the visible fixture: the two-storey chandeliers
        // carry furthest, formal chandeliers follow, and compact ceiling/wall
        // practicals remain local. `distance` orders the fixture scale and
        // bounds the cone styles; `radius` is the omnidirectional clamp for
        // room fixtures — generous enough to wash the room's own walls and
        // ceiling in 360 degrees, but the terminal falloff window still dies
        // just past a shared wall so neighbours read at most an under-door
        // glow. Omni intensities are calibrated against captured luminance
        // targets (~1.5x the cone-era screens): an omni's near field covers
        // the whole room, so its candela sit far below the old cone values —
        // raising them floodlights the mansion within a few dozen candela.
        atrium: {
          intensity: 380,
          distance: 14.5,
          angle: 0.85,
          penumbra: 0.62,
        },
        grand: {
          intensity: 95,
          distance: 12.5,
          angle: 1.04,
          penumbra: 0.54,
          radius: 6.8,
        },
        small: {
          intensity: 48,
          distance: 9.2,
          angle: 1.02,
          penumbra: 0.62,
          radius: 6.2,
        },
        bathroom: {
          intensity: 34,
          distance: 7.4,
          angle: 0.78,
          penumbra: 0.6,
          radius: 4.2,
        },
        closet: {
          intensity: 31,
          distance: 6.8,
          angle: 0.76,
          penumbra: 0.64,
          radius: 3.8,
        },
        basement: { intensity: 46, distance: 9.2, angle: 0.96, penumbra: 0.58, radius: 6.4 },
        corridor: {
          intensity: 225,
          distance: 8.6,
          angle: 0.5,
          penumbra: 0.58,
        },
      };
      const profile = profiles[style] || profiles.small;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      scene.add(group);
      if (style === "basement") {
        box({ name: `${this.name}-cage`, w: 0.42, h: 0.12, d: 0.42, x, y: ceilingY - 0.12, z, material: M.iron, cast: false });
        // Hang the wire entirely below the basement ceiling plane. Centering
        // it above that plane left its top 10cm poking through the main floor
        // as repeated black pegs in the library, foyer, dining room, and halls.
        const wireHeight = 0.32;
        cylinder({ name: `${this.name}-wire`, radius: 0.012, height: wireHeight, x, y: ceilingY - wireHeight / 2, z, material: M.iron, cast: false });
      } else {
        const bulbEmissive = isGrand ? 1.3 : 1.1;
        cylinder({ name: `${this.name}-chain`, radius: 0.018, height: isGrand ? 1.15 : 0.62, x, y: ceilingY - (isGrand ? 0.52 : 0.26), z, material: M.brass, cast: false });
        const ringY = ceilingY - (isGrand ? 1.05 : 0.58);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(isGrand ? 0.72 : 0.42, 0.035, 8, 30), M.brass);
        ring.position.set(x, ringY, z);
        ring.rotation.x = Math.PI / 2;
        // Only the double-height atrium rings cast a geometric shadow. Formal
        // and compact rings remain visible without adding shadow passes.
        ring.castShadow = style === "atrium";
        scene.add(ring);
        const count = isGrand ? 8 : 5;
        for (let i = 0; i < count; i += 1) {
          const a = (i / count) * Math.PI * 2;
          const r = isGrand ? 0.72 : 0.42;
          cylinder({ name: `${this.name}-arm`, radius: 0.018, height: r * 0.95, x: x + Math.cos(a) * r * 0.48, y: ringY, z: z + Math.sin(a) * r * 0.48, rotationZ: Math.PI / 2, rotationY: -a, material: M.brass, cast: false });
          const bulb = sphere({ name: `${this.name}-bulb`, radius: isGrand ? 0.095 : 0.075, x: x + Math.cos(a) * r, y: ringY + 0.13, z: z + Math.sin(a) * r, material: new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: 0xffa84f, emissiveIntensity: this.on ? bulbEmissive : 0 }), cast: false });
          bulb.userData.onEmissiveIntensity = bulbEmissive;
          bulb.userData.levels = new Set(this.levels);
          this.bulbs.push(bulb);
        }
        this.addSourceHalo(x, ringY + 0.13, z, isGrand ? 1.9 : 1.15, isGrand ? 0.24 : 0.2);
      }
      if (style === "basement") {
        const bulb = sphere({ name: `${this.name}-bulb`, radius: 0.1, x, y: ceilingY - 0.28, z, material: new THREE.MeshStandardMaterial({ color: 0xffd6a0, emissive: 0xff9b42, emissiveIntensity: this.on ? 0.9 : 0 }), cast: false });
        bulb.userData.onEmissiveIntensity = 0.9;
        bulb.userData.levels = new Set(this.levels);
        this.bulbs.push(bulb);
        this.addSourceHalo(x, ceilingY - 0.28, z, 0.85, 0.2);
      }
      // Every visible fixture owns exactly one real emitter. Room fixtures
      // are omnidirectional like the physical bulbs they model — a bounded
      // PointLight clamped to the room's own radius, so walls, ceiling, and
      // trim receive light in 360 degrees instead of a downward cone. Their
      // real ceiling wash also replaces the painted response glow those
      // fixtures used to need. Only the two-storey atrium chandeliers keep a
      // shadowed downward cone: a naked omni would flood both storeys of the
      // open void and erase the balustrade shadow play, so they retain the
      // painted ceiling response instead.
      const sourceY = ceilingY - (isGrand ? 1.1 : 0.65);
      let light;
      if (style === "atrium") {
        this.addCeilingResponseGlow(x, ceilingY - 0.02, z, 2.4, 0.27);
        const targetY = FLOOR.MAIN + 0.04;
        const containedDistance = profile.distance;
        light = this.addContainedSpotLight(
          x,
          sourceY,
          z,
          profile.intensity,
          containedDistance,
          profile.angle,
          Array.from(this.levels),
          targetY,
          true,
        );
        light.name = `${this.name}-room-bounded-spotlight`;
        light.userData.authoredReach = containedDistance;
        light.penumbra = profile.penumbra;
      } else if (style === "corridor") {
        // Corridors are too narrow for an omni source — walls a metre from
        // the fixture would read floodlit at any useful intensity — so they
        // keep the authored tight downward cone and their moody pools.
        light = this.addContainedSpotLight(
          x,
          sourceY,
          z,
          profile.intensity,
          profile.distance,
          profile.angle,
          Array.from(this.levels),
          fixtureFloorY + 0.04,
          false,
        );
        light.name = `${this.name}-room-bounded-spotlight`;
        light.userData.authoredReach = profile.distance;
        light.penumbra = profile.penumbra;
      } else {
        // The omni source sits a hand's width below the visible bulbs: the
        // ceiling above still catches a hot amber pool instead of a blown
        // white disc, and the room reads lit by the fixture, not the slab.
        const omniY = ceilingY - (isGrand ? 1.35 : 1.0);
        light = this.addRoomOmniLight(x, omniY, z, profile.intensity, profile.radius, Array.from(this.levels));
      }
      light.userData.roomBounded = true;
      light.userData.fixtureStyle = style;
      light.userData.fixtureRole = "primary";
      light.userData.visibleFixtureEmitter = true;
      return light;
    }

    // The response glows below are decorative surfaces, never emitters: every
    // lumen still comes from the real fixture cones. They restore the light a
    // physical fixture would throw onto its own ceiling, wall, and the dusty
    // air around it, so the visible fixture reads as the source of the room's
    // light instead of a glowing orb floating in the dark.
    addCeilingResponseGlow(x, y, z, radius, opacity) {
      const material = new THREE.MeshBasicMaterial({
        map: M.lightGlowMap,
        color: 0xffb877,
        transparent: true,
        opacity: this.on ? opacity : 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      material.userData.onOpacity = opacity;
      material.userData.offOpacity = 0;
      this.glowMaterials.push(material);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 26), material);
      disc.name = `${this.name}-ceiling-response-glow`;
      disc.position.set(x, y, z);
      disc.rotation.x = Math.PI / 2;
      disc.renderOrder = 3;
      disc.castShadow = false;
      disc.receiveShadow = false;
      scene.add(disc);
      return disc;
    }

    addSourceHalo(x, y, z, scale, opacity) {
      const material = new THREE.SpriteMaterial({
        map: M.lightGlowMap,
        color: 0xffc890,
        transparent: true,
        opacity: this.on ? opacity : 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      material.userData.onOpacity = opacity;
      material.userData.offOpacity = 0;
      this.glowMaterials.push(material);
      const halo = new THREE.Sprite(material);
      halo.name = `${this.name}-source-halo`;
      halo.position.set(x, y, z);
      halo.scale.set(scale, scale, 1);
      halo.renderOrder = 4;
      scene.add(halo);
      return halo;
    }

    addRoomOmniLight(x, y, z, intensity, radius, levels) {
      // A room fixture's single real emitter. Omnidirectional like the bulbs
      // it models, with the cutoff radius authored per room scale: the room's
      // own walls and ceiling catch light from every angle, while the
      // terminal falloff window extinguishes it shortly past a shared wall,
      // so an enclosed neighbour reads at most a faint under-door glow.
      const light = new THREE.PointLight(this.color, this.on ? intensity : 0, radius, 2);
      light.name = `${this.name}-room-bounded-omnilight`;
      light.position.set(x, y, z);
      light.userData.baseIntensity = intensity;
      light.userData.contained = true;
      light.userData.roomBounded = true;
      light.userData.authoredReach = radius;
      if (levels) light.userData.levels = new Set(levels);
      scene.add(light);
      this.lights.push(light);
      return light;
    }

    addContainedSpotLight(x, y, z, intensity, distance, angle, levels, targetY, castsShadow) {
      const light = new THREE.SpotLight(this.color, this.on ? intensity : 0, distance, angle || 0.82, 0.58, 2);
      light.name = `${this.name}-contained-spotlight`;
      light.position.set(x, y, z);
      light.userData.baseIntensity = intensity;
      light.userData.contained = true;
      light.userData.roomBounded = this.name !== "estate exterior lights";
      if (levels) light.userData.levels = new Set(levels);
      const target = new THREE.Object3D();
      target.name = `${this.name}-contained-light-target`;
      target.position.set(x, targetY == null ? this.floorY + 0.04 : targetY, z);
      scene.add(target);
      light.target = target;
      if (castsShadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(256, 256);
        light.shadow.camera.near = 0.12;
        light.shadow.camera.far = distance;
        light.shadow.bias = -0.00035;
        light.shadow.normalBias = 0.025;
      }
      scene.add(light);
      this.lights.push(light);
      return light;
    }

    addAimedSpotLight(x, y, z, targetX, targetY, targetZ, intensity, distance, angle, levels, castsShadow, role) {
      const targetDistance = Math.hypot(targetX - x, targetY - y, targetZ - z);
      // The margin keeps each cone inside its own room, but it also feeds the
      // renderer's terminal cutoff window: too tight and the pool at the aim
      // point is strangled to a faint smudge. 1.35m keeps containment (rooms
      // are 9m+ across) while the aim point receives roughly double the light.
      const boundedDistance = Math.min(distance, targetDistance + 1.35);
      const light = new THREE.SpotLight(this.color, this.on ? intensity : 0, boundedDistance, angle || 0.58, 0.64, 2);
      light.name = `${this.name}-${role || "aimed"}-spotlight`;
      light.position.set(x, y, z);
      light.userData.baseIntensity = intensity;
      light.userData.contained = true;
      light.userData.roomBounded = true;
      light.userData.fixtureRole = role || "aimed";
      light.userData.authoredReach = boundedDistance;
      light.userData.containmentMargin = 1.35;
      if (levels) light.userData.levels = new Set(levels);
      const target = new THREE.Object3D();
      target.name = `${light.name}-target`;
      target.position.set(targetX, targetY, targetZ);
      scene.add(target);
      light.target = target;
      if (castsShadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(128, 128);
        light.shadow.camera.near = 0.12;
        light.shadow.camera.far = boundedDistance;
        light.shadow.bias = -0.00035;
        light.shadow.normalBias = 0.03;
      }
      scene.add(light);
      this.lights.push(light);
      return light;
    }

    addWallSconce(x, y, z, rotationY, intensity, distance, levels, targetX, targetY, targetZ) {
      const normalX = Math.sin(rotationY);
      const normalZ = Math.cos(rotationY);
      const fixtureX = x + normalX * 0.31;
      const fixtureZ = z + normalZ * 0.31;
      box({ name: `${this.name}-wall-sconce-backplate`, w: 0.22, h: 0.38, d: 0.06, x, y, z, rotationY, material: M.brass, cast: false });
      addBeamBetween(`${this.name}-wall-sconce-arm`, [x, y - 0.03, z], [x + normalX * 0.25, y - 0.03, z + normalZ * 0.25], 0.024, M.brass);
      cylinder({ name: `${this.name}-wall-sconce-socket`, radius: 0.052, height: 0.12, x: fixtureX, y: y + 0.015, z: fixtureZ, material: M.brass, cast: false });
      cylinder({ name: `${this.name}-wall-sconce-cup`, radiusTop: 0.1, radiusBottom: 0.065, height: 0.09, segments: 18, x: fixtureX, y: y + 0.07, z: fixtureZ, material: M.brass, cast: false });
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.095, 0.23, 18, 1, true), M.frostedShade);
      shade.name = `${this.name}-wall-sconce-frosted-shade`;
      shade.position.set(fixtureX, y + 0.21, fixtureZ);
      shade.castShadow = false;
      shade.receiveShadow = false;
      scene.add(shade);
      const shadeRim = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.012, 6, 20), M.brass);
      shadeRim.name = `${this.name}-wall-sconce-shade-rim`;
      shadeRim.position.set(fixtureX, y + 0.325, fixtureZ);
      shadeRim.rotation.x = Math.PI / 2;
      shadeRim.castShadow = false;
      scene.add(shadeRim);
      const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffd8a6, emissive: 0xffa34f, emissiveIntensity: this.on ? 1.05 : 0 });
      const bulb = sphere({ name: `${this.name}-wall-sconce-bulb`, radius: 0.045, x: fixtureX, y: y + 0.19, z: fixtureZ, material: bulbMaterial, cast: false });
      bulb.userData.onEmissiveIntensity = 1.05;
      bulb.userData.levels = new Set(levels || this.levels);
      this.bulbs.push(bulb);
      // A sconce's open frosted cup throws most of its light up the wall it
      // hangs on; the real cone is aimed into the room, so paint that updraft
      // on the wall plane and wrap the shade in a faint scattered halo.
      const updraftMaterial = new THREE.MeshBasicMaterial({
        map: M.lightGlowMap,
        color: 0xffbe82,
        transparent: true,
        opacity: this.on ? 0.13 : 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      updraftMaterial.userData.onOpacity = 0.13;
      updraftMaterial.userData.offOpacity = 0;
      this.glowMaterials.push(updraftMaterial);
      const updraft = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.45), updraftMaterial);
      updraft.name = `${this.name}-wall-sconce-updraft-glow`;
      updraft.position.set(x + normalX * 0.05, y + 0.88, z + normalZ * 0.05);
      updraft.rotation.y = rotationY;
      updraft.renderOrder = 3;
      updraft.castShadow = false;
      updraft.receiveShadow = false;
      scene.add(updraft);
      this.addSourceHalo(fixtureX, y + 0.27, fixtureZ, 0.55, 0.2);
      // Sconces stay aimed cones (a shaded sconce genuinely throws forward),
      // but at 1.5x their authored intensity so their pools hold their own
      // against the omnidirectional room fixtures.
      const roomLight = this.addAimedSpotLight(
        x + normalX * 0.36,
        y + 0.18,
        z + normalZ * 0.36,
        targetX,
        targetY,
        targetZ,
        intensity * 1.5,
        distance,
        0.62,
        levels,
        false,
        "wall-sconce",
      );
      roomLight.userData.visibleFixtureEmitter = true;
      return roomLight;
    }

    addFixtureSupportFill(x, z, intensity, distance, angle) {
      const sourceY = this.floorY + (this.floorY === FLOOR.UPPER ? 2.43 : 2.95);
      const light = this.addContainedSpotLight(
        x,
        sourceY,
        z,
        intensity,
        distance,
        angle || 0.8,
        Array.from(this.levels),
        this.floorY + 0.2,
        false,
      );
      light.name = `${this.name}-fixture-support-fill`;
      light.userData.fixtureRole = "fixture-support";
      light.userData.authoredReach = distance;
      return light;
    }

    addShowerDownlight(label, x, z) {
      const ceilingY = this.floorY + (this.floorY === FLOOR.UPPER ? 3.05 : 3.72);
      cylinder({ name: `${label}-shower-downlight-trim`, radius: 0.2, height: 0.055, segments: 24, x, y: ceilingY - 0.035, z, material: M.brass, cast: false });
      const diffuserMaterial = new THREE.MeshStandardMaterial({
        color: 0xffe1b8,
        emissive: 0xffae62,
        emissiveIntensity: this.on ? 0.85 : 0,
        roughness: 0.68,
      });
      diffuserMaterial.userData.onEmissiveIntensity = 0.85;
      diffuserMaterial.userData.offEmissiveIntensity = 0;
      this.glowMaterials.push(diffuserMaterial);
      const diffuser = cylinder({ name: `${label}-shower-downlight-diffuser`, radius: 0.15, height: 0.028, segments: 24, x, y: ceilingY - 0.072, z, material: diffuserMaterial, cast: false });
      diffuser.userData.onEmissiveIntensity = 0.85;
      diffuser.userData.levels = new Set(this.levels);
      this.bulbs.push(diffuser);
      this.addSourceHalo(x, ceilingY - 0.1, z, 0.62, 0.16);
      const light = this.addContainedSpotLight(
        x,
        ceilingY - 0.16,
        z,
        48,
        this.floorY === FLOOR.UPPER ? 3.5 : 4.2,
        0.58,
        Array.from(this.levels),
        this.floorY + 0.04,
        false,
      );
      light.name = `${label}-shower-downlight-spotlight`;
      light.userData.fixtureRole = "shower-downlight";
      light.userData.visibleFixtureEmitter = true;
      return light;
    }

    addPracticalLight(x, y, z, intensity, distance, levels, options) {
      const settings = options || {};
      const contained = settings.contained == null
        ? this.name !== "estate exterior lights"
        : Boolean(settings.contained);
      if (contained) {
        return this.addContainedSpotLight(
          x,
          y,
          z,
          intensity,
          distance,
          settings.angle || (this.name === "estate exterior lights" ? 0.8 : 0.58),
          levels,
          settings.targetY == null ? this.floorY + 0.04 : settings.targetY,
          Boolean(settings.castsShadow),
        );
      }
      const boundedDistance = this.name === "estate exterior lights" ? distance : Math.min(distance, 7.8);
      const light = new THREE.PointLight(this.color, this.on ? intensity : 0, boundedDistance, 2);
      light.name = `${this.name}-practical-light`;
      light.position.set(x, y, z);
      light.userData.baseIntensity = intensity;
      light.userData.roomBounded = this.name !== "estate exterior lights";
      if (levels) light.userData.levels = new Set(levels);
      scene.add(light);
      this.lights.push(light);
      return light;
    }

    addControlTarget(target, label) {
      const interaction = {
        type: "light",
        getLabel: () => `${this.on ? "Turn off" : "Turn on"} ${label || this.name.toLowerCase()}`,
        activate: () => this.toggle(),
      };
      addInteractionTarget(target, interaction);
      this.controls += 1;
      return interaction;
    }

    addLevel(level) {
      this.levels.add(level);
      return this;
    }

    addSwitch(x, y, z, rotationY) {
      const normalX = Math.sin(rotationY);
      const normalZ = Math.cos(rotationY);
      const plate = box({ name: `${this.name}-switch-plate`, w: 0.16, h: 0.25, d: 0.035, x, y, z, rotationY, material: M.porcelain, cast: false, receive: false });
      const toggle = box({ name: `${this.name}-switch-toggle`, w: 0.045, h: 0.11, d: 0.045, x: x + normalX * 0.035, y, z: z + normalZ * 0.035, rotationY, material: M.brass, cast: false, receive: false });
      const interaction = {
        type: "light",
        getLabel: () => `${this.on ? "Turn off" : "Turn on"} ${this.name.toLowerCase()}`,
        activate: () => this.toggle(),
      };
      addInteractionTarget(plate, interaction);
      addInteractionTarget(toggle, interaction);
      const hitbox = box({
        name: `${this.name}-switch-hitbox`, w: 0.46, h: 0.82, d: 0.12,
        x: x + normalX * 0.09, y: y + 0.14, z: z + normalZ * 0.09, rotationY,
        material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        cast: false, receive: false,
      });
      hitbox.visible = false;
      addInteractionTarget(hitbox, interaction);
      this.controls += 1;
    }

    setGlowRenderState(lit) {
      const renderLit = Boolean(lit);
      for (const material of this.glowMaterials) {
        const color = renderLit ? material.userData.onColor : material.userData.offColor;
        if (color != null && material.color) material.color.setHex(color);
        if (material.userData.onOpacity != null) material.opacity = renderLit ? material.userData.onOpacity : material.userData.offOpacity;
        if (material.userData.onEmissiveIntensity != null) {
          material.emissiveIntensity = renderLit ? material.userData.onEmissiveIntensity : (material.userData.offEmissiveIntensity || 0);
        }
        material.userData.renderLit = renderLit;
      }
    }

    setState(on, silent) {
      const next = Boolean(on);
      if (this.on === next) return;
      this.on = next;
      // Light, bulb, and decorative-glow output is owned by the same switch.
      // syncLightRendering adds floor/shell context so exterior halos remain
      // dark indoors and energize only after the player crosses outside.
      // Silent callers batch several circuits and request one sync themselves.
      this.setGlowRenderState(this.on);
      if (!silent && audioSystem) audioSystem.light(this.on);
      if (!silent) syncLightRendering();
    }

    toggle() {
      this.setState(!this.on, false);
    }
  }

  function addFoyerGrandChandelier(circuit, x, z) {
    const ceilingY = FLOOR.UPPER + 3.05;
    const canopyY = ceilingY - 0.12;
    cylinder({ name: "foyer-grand-chandelier-canopy", radius: 0.34, radiusTop: 0.22, radiusBottom: 0.38, height: 0.18, segments: 24, x, y: canopyY, z, material: M.brass, cast: false });
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.055, 10, 36), M.brass);
    crown.name = "foyer-grand-chandelier-crown";
    crown.position.set(x, ceilingY - 0.38, z);
    crown.rotation.x = Math.PI / 2;
    crown.castShadow = true;
    scene.add(crown);
    cylinder({ name: "foyer-grand-chandelier-central-stem", radius: 0.045, height: 2.48, segments: 14, x, y: ceilingY - 1.38, z, material: M.brass, cast: false });

    const tiers = [
      { radius: 1.05, y: ceilingY - 1.28, bulbs: 8 },
      { radius: 1.62, y: ceilingY - 2.08, bulbs: 12 },
    ];
    const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffe0ad, emissive: 0xffa84f, emissiveIntensity: circuit.on ? 1.35 : 0, roughness: 0.24 });
    tiers.forEach((tier, tierIndex) => {
      const innerHubRadius = tier.radius * 0.35;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(tier.radius, tierIndex === 0 ? 0.045 : 0.06, 9, 48), M.brass);
      ring.name = `foyer-grand-chandelier-tier-${tierIndex + 1}`;
      ring.position.set(x, tier.y, z);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = tierIndex === 1;
      scene.add(ring);
      const innerHub = new THREE.Mesh(new THREE.TorusGeometry(innerHubRadius, tierIndex === 0 ? 0.036 : 0.044, 8, 32), M.brass);
      innerHub.name = "foyer-grand-chandelier-tier-inner-hub";
      innerHub.position.set(x, tier.y - 0.04, z);
      innerHub.rotation.x = Math.PI / 2;
      innerHub.castShadow = false;
      scene.add(innerHub);
      cylinder({ name: "foyer-grand-chandelier-tier-collar", radius: tierIndex === 0 ? 0.12 : 0.15, height: 0.13, segments: 18, x, y: tier.y - 0.04, z, material: M.brass, cast: false });
      for (let i = 0; i < tier.bulbs; i += 1) {
        const angle = (i / tier.bulbs) * Math.PI * 2 + (tierIndex ? Math.PI / tier.bulbs : 0);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const cupX = x + cos * tier.radius;
        const cupZ = z + sin * tier.radius;
        addBeamBetween("foyer-grand-chandelier-scroll-arm", [x + cos * innerHubRadius, tier.y - 0.04, z + sin * innerHubRadius], [cupX, tier.y + 0.02, cupZ], 0.024, M.brass);
        cylinder({ name: "foyer-grand-chandelier-candle-cup", radius: tierIndex ? 0.105 : 0.09, radiusTop: tierIndex ? 0.11 : 0.095, radiusBottom: 0.055, height: 0.11, segments: 16, x: cupX, y: tier.y + 0.06, z: cupZ, material: M.brass, cast: false });
        cylinder({ name: "foyer-grand-chandelier-candle", radius: 0.04, height: 0.2, segments: 12, x: cupX, y: tier.y + 0.19, z: cupZ, material: M.porcelain, cast: false });
        const bulb = sphere({ name: "foyer-grand-chandelier-bulb", radius: tierIndex ? 0.085 : 0.075, x: cupX, y: tier.y + 0.34, z: cupZ, material: bulbMaterial, cast: false });
        bulb.userData.onEmissiveIntensity = 1.35;
        bulb.userData.levels = new Set(circuit.levels);
        circuit.bulbs.push(bulb);
        if (tierIndex === 1) {
          const dropX = x + cos * tier.radius * 0.84;
          const dropZ = z + sin * tier.radius * 0.84;
          addBeamBetween("foyer-grand-chandelier-crystal-hanger", [dropX, tier.y - 0.015, dropZ], [dropX, tier.y - 0.11, dropZ], 0.009, M.brass);
          cylinder({ name: "foyer-grand-chandelier-crystal-drop", radiusTop: 0.012, radiusBottom: 0.075, height: 0.26, segments: 10, x: dropX, y: tier.y - 0.24, z: dropZ, material: M.frostedShade, cast: false });
        }
      }
    });
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      addBeamBetween(
        "foyer-grand-chandelier-tier-bridge",
        [x + Math.cos(angle) * tiers[0].radius * 0.35, tiers[0].y - 0.05, z + Math.sin(angle) * tiers[0].radius * 0.35],
        [x + Math.cos(angle) * tiers[1].radius * 0.35, tiers[1].y + 0.05, z + Math.sin(angle) * tiers[1].radius * 0.35],
        0.014,
        M.brass,
      );
    }
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      addBeamBetween(
        "foyer-grand-chandelier-suspension-chain",
        [x + Math.cos(angle) * 0.34, ceilingY - 0.38, z + Math.sin(angle) * 0.34],
        [x + Math.cos(angle) * tiers[0].radius, tiers[0].y, z + Math.sin(angle) * tiers[0].radius],
        0.018,
        M.brass,
      );
    }
    sphere({ name: "foyer-grand-chandelier-central-crystal", radius: 0.19, x, y: ceilingY - 2.35, z, material: M.frostedShade, cast: false });
    cylinder({ name: "foyer-grand-chandelier-central-finial", radiusTop: 0.018, radiusBottom: 0.11, height: 0.38, segments: 12, x, y: ceilingY - 2.65, z, material: M.brass, cast: false });
    circuit.addCeilingResponseGlow(x, ceilingY - 0.02, z, 3.0, 0.3);
    circuit.addSourceHalo(x, tiers[1].y + 0.2, z, 3.1, 0.27);
    const light = circuit.addContainedSpotLight(
      x,
      tiers[1].y - 0.05,
      z,
      380,
      14.5,
      0.85,
      Array.from(circuit.levels),
      FLOOR.MAIN + 0.04,
      true,
    );
    light.name = `${circuit.name}-room-bounded-spotlight`;
    light.userData.authoredReach = 14.5;
    light.penumbra = 0.62;
    light.userData.roomBounded = true;
    light.userData.fixtureStyle = "signature-atrium";
    light.userData.fixtureRole = "primary";
    light.userData.visibleFixtureEmitter = true;
    return light;
  }

  function addFrontPorticoChandelier(circuit) {
    const x = 0;
    const z = 13.35;
    const canopyY = 3.82;
    const crownY = 3.38;
    const ringY = 2.88;
    cylinder({ name: "front-portico-chandelier-canopy", radius: 0.25, radiusTop: 0.17, radiusBottom: 0.29, height: 0.15, segments: 18, x, y: canopyY, z, material: M.iron, cast: false });
    cylinder({ name: "front-portico-chandelier-chain", radius: 0.025, height: 0.48, segments: 10, x, y: 3.57, z, material: M.iron, cast: false });
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 28), M.brass);
    crown.name = "front-portico-chandelier-crown";
    crown.position.set(x, crownY, z);
    crown.rotation.x = Math.PI / 2;
    crown.castShadow = false;
    scene.add(crown);
    const cageRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.035, 8, 36), M.iron);
    cageRing.name = "front-portico-chandelier-cage-ring";
    cageRing.position.set(x, ringY, z);
    cageRing.rotation.x = Math.PI / 2;
    cageRing.castShadow = true;
    scene.add(cageRing);
    const rainGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.58, 0.74, 6, 1, true), M.frostedShade);
    rainGlass.name = "front-portico-chandelier-rain-glass";
    rainGlass.position.set(x, 3.02, z);
    rainGlass.rotation.y = Math.PI / 6;
    rainGlass.castShadow = false;
    rainGlass.receiveShadow = false;
    scene.add(rainGlass);
    const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffd7a0, emissive: 0xff9d42, emissiveIntensity: circuit.on ? 0.85 : 0, roughness: 0.3 });
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const outerX = x + cos * 0.68;
      const outerZ = z + sin * 0.68;
      addBeamBetween("front-portico-chandelier-cage-rib", [x + cos * 0.3, crownY, z + sin * 0.3], [outerX, ringY, outerZ], 0.022, M.iron);
      addBeamBetween("front-portico-chandelier-lower-rib", [outerX, ringY, outerZ], [x + cos * 0.16, 2.52, z + sin * 0.16], 0.022, M.iron);
      const candleX = x + cos * 0.47;
      const candleZ = z + sin * 0.47;
      cylinder({ name: "front-portico-chandelier-candle-cup", radius: 0.085, radiusTop: 0.09, radiusBottom: 0.05, height: 0.1, segments: 14, x: candleX, y: ringY + 0.05, z: candleZ, material: M.brass, cast: false });
      cylinder({ name: "front-portico-chandelier-candle", radius: 0.035, height: 0.17, segments: 10, x: candleX, y: ringY + 0.17, z: candleZ, material: M.porcelain, cast: false });
      const bulb = sphere({ name: "front-portico-chandelier-bulb", radius: 0.065, x: candleX, y: ringY + 0.3, z: candleZ, material: bulbMaterial, cast: false });
      bulb.userData.onEmissiveIntensity = 0.85;
      bulb.userData.levels = new Set(["MAIN LEVEL"]);
      circuit.bulbs.push(bulb);
    }
    sphere({ name: "front-portico-chandelier-bottom-orb", radius: 0.11, x, y: 2.49, z, material: M.brass, cast: false });
    cylinder({ name: "front-portico-chandelier-finial", radiusTop: 0.01, radiusBottom: 0.08, height: 0.24, segments: 10, x, y: 2.31, z, material: M.iron, cast: false });
    circuit.addSourceHalo(x, 3.14, z, 1.55, 0.16);
    const light = circuit.addPracticalLight(0, 3.05, 13.35, 52, 7.5, ["MAIN LEVEL"], { contained: true, angle: 0.62, targetY: YARD_LAYOUT.groundY, castsShadow: false });
    light.name = "front-portico-chandelier-spotlight";
    light.userData.fixtureRole = "front-portico-chandelier";
    light.userData.visibleFixtureEmitter = true;
    light.userData.exteriorBudgetPriority = 4;
    yardState.featureCounts.exteriorLamps += 1;
    return light;
  }

  function wallSegment(axis, fixed, start, end, floorY, height, material, name) {
    const length = end - start;
    if (length <= 0.04) return null;
    const center = (start + end) / 2;
    const mesh = axis === "x"
      ? box({ name, w: length, h: height, d: 0.28, x: center, y: floorY + height / 2, z: fixed, material, collider: true, occluder: true })
      : box({ name, w: 0.28, h: height, d: length, x: fixed, y: floorY + height / 2, z: center, material, collider: true, occluder: true });
    return mesh;
  }

  function wallTrimSpans(start, end, openings) {
    const passages = openings
      .filter((opening) => opening.kind !== "window")
      .map((opening) => ({
        left: Math.max(start, opening.center - opening.width / 2),
        right: Math.min(end, opening.center + opening.width / 2),
      }))
      .filter((opening) => opening.right > start && opening.left < end)
      .sort((a, b) => a.left - b.left);
    const spans = [];
    let cursor = start;
    for (const passage of passages) {
      if (passage.left - cursor > 0.04) spans.push([cursor, passage.left]);
      cursor = Math.max(cursor, passage.right);
    }
    if (end - cursor > 0.04) spans.push([cursor, end]);
    return spans;
  }

  function addWallTrimSpan(axis, fixed, start, end, y, height, depth, faceOffset, name) {
    const insetStart = start + 0.01;
    const insetEnd = end - 0.01;
    const length = insetEnd - insetStart;
    if (length <= 0.04) return;
    const center = (insetStart + insetEnd) / 2;
    if (axis === "x") {
      box({ name: `${name}-a`, w: length, h: height, d: depth, x: center, y, z: fixed + faceOffset, material: M.trim, cast: false });
      box({ name: `${name}-b`, w: length, h: height, d: depth, x: center, y, z: fixed - faceOffset, material: M.trim, cast: false });
    } else {
      box({ name: `${name}-a`, w: depth, h: height, d: length, x: fixed + faceOffset, y, z: center, material: M.trim, cast: false });
      box({ name: `${name}-b`, w: depth, h: height, d: length, x: fixed - faceOffset, y, z: center, material: M.trim, cast: false });
    }
  }

  function addContinuousWallTrim(axis, fixed, start, end, floorY, height, material, openings, name) {
    if (end - start <= 0.04 || floorY < FLOOR.MAIN || material === M.limestone) return;
    addWallTrimSpan(axis, fixed, start, end, floorY + height - 0.08, 0.16, 0.075, 0.17, `${name}-crown`);
    wallTrimSpans(start, end, openings).forEach((span, index) => {
      addWallTrimSpan(axis, fixed, span[0], span[1], floorY + 0.09, 0.18, 0.055, 0.165, `${name}-baseboard-${index}`);
    });
  }

  function addWindow(axis, fixed, center, floorY, opening, exterior) {
    const bottom = opening.bottom == null ? 0.82 : opening.bottom;
    const top = opening.top == null ? 3.05 : opening.top;
    if (exterior) {
      rainApertures.push({
        x: axis === "x" ? center : fixed,
        y: floorY + (bottom + top) / 2,
        z: axis === "x" ? fixed : center,
        // Single-pane storm-lashed glass: clearly audible, far from open air.
        openness: 0.6,
      });
    }
    const width = opening.width;
    const middleY = floorY + (bottom + top) / 2;
    const windowH = top - bottom;
    const depth = 0.08;
    if (axis === "x") {
      box({ name: "rain-darkened-glass", w: width - 0.14, h: windowH - 0.13, d: 0.028, x: center, y: middleY, z: fixed, material: M.glass, cast: false, receive: false });
      for (const sx of [-width / 2, 0, width / 2]) box({ name: "window-mullion", w: 0.075, h: windowH + 0.14, d: depth, x: center + sx, y: middleY, z: fixed, material: M.blackWood, cast: false });
      for (const sy of [bottom, (bottom + top) / 2, top]) box({ name: "window-frame", w: width + 0.12, h: 0.075, d: depth, x: center, y: floorY + sy, z: fixed, material: M.blackWood, cast: false });
      if (exterior) box({ name: "stone-window-sill", w: width + 0.34, h: 0.11, d: 0.42, x: center, y: floorY + bottom - 0.055, z: fixed, material: M.limestone, cast: false });
    } else {
      box({ name: "rain-darkened-glass", w: 0.028, h: windowH - 0.13, d: width - 0.14, x: fixed, y: middleY, z: center, material: M.glass, cast: false, receive: false });
      for (const sz of [-width / 2, 0, width / 2]) box({ name: "window-mullion", w: depth, h: windowH + 0.14, d: 0.075, x: fixed, y: middleY, z: center + sz, material: M.blackWood, cast: false });
      for (const sy of [bottom, (bottom + top) / 2, top]) box({ name: "window-frame", w: depth, h: 0.075, d: width + 0.12, x: fixed, y: floorY + sy, z: center, material: M.blackWood, cast: false });
      if (exterior) box({ name: "stone-window-sill", w: 0.42, h: 0.11, d: width + 0.34, x: fixed, y: floorY + bottom - 0.055, z: center, material: M.limestone, cast: false });
    }
  }

  function addDoorFrame(axis, fixed, center, floorY, width, height) {
    const post = 0.15;
    if (axis === "x") {
      for (const x of [center - width / 2, center + width / 2]) box({ name: "door-jamb", w: post, h: height + 0.12, d: 0.38, x, y: floorY + (height + 0.12) / 2, z: fixed, material: M.trim, cast: false });
      box({ name: "door-lintel-trim", w: width + 0.3, h: post, d: 0.38, x: center, y: floorY + height + 0.055, z: fixed, material: M.trim, cast: false });
      for (const face of [-1, 1]) {
        const z = fixed + face * 0.225;
        for (const x of [center - width / 2 - 0.085, center + width / 2 + 0.085]) box({ name: "door-casing-face", w: 0.12, h: height + 0.28, d: 0.055, x, y: floorY + (height + 0.28) / 2, z, material: M.trim, cast: false });
        box({ name: "door-casing-header", w: width + 0.46, h: 0.12, d: 0.055, x: center, y: floorY + height + 0.17, z, material: M.trim, cast: false });
      }
    } else {
      for (const z of [center - width / 2, center + width / 2]) box({ name: "door-jamb", w: 0.38, h: height + 0.12, d: post, x: fixed, y: floorY + (height + 0.12) / 2, z, material: M.trim, cast: false });
      box({ name: "door-lintel-trim", w: 0.38, h: post, d: width + 0.3, x: fixed, y: floorY + height + 0.055, z: center, material: M.trim, cast: false });
      for (const face of [-1, 1]) {
        const x = fixed + face * 0.225;
        for (const z of [center - width / 2 - 0.085, center + width / 2 + 0.085]) box({ name: "door-casing-face", w: 0.055, h: height + 0.28, d: 0.12, x, y: floorY + (height + 0.28) / 2, z, material: M.trim, cast: false });
        box({ name: "door-casing-header", w: 0.055, h: 0.12, d: width + 0.46, x, y: floorY + height + 0.17, z: center, material: M.trim, cast: false });
      }
    }
  }

  function buildWallRun(options) {
    const {
      axis, fixed, start, end, floorY,
      height = floorY === FLOOR.BASEMENT ? 3.65 : (floorY === FLOOR.UPPER ? UPPER_HEIGHT : WALL_HEIGHT),
      material = floorY === FLOOR.BASEMENT ? M.limestone : M.wallpaper,
      openings = [], name = "wall", exterior = false,
    } = options;
    addContinuousWallTrim(axis, fixed, start, end, floorY, height, material, openings, name);
    const sorted = openings.slice().sort((a, b) => a.center - b.center);
    let cursor = start;
    for (let i = 0; i < sorted.length; i += 1) {
      const opening = sorted[i];
      const left = opening.center - opening.width / 2;
      const right = opening.center + opening.width / 2;
      wallSegment(axis, fixed, cursor, left, floorY, height, material, `${name}-segment-${i}`);
      if (opening.kind === "window") {
        const bottom = opening.bottom == null ? 0.82 : opening.bottom;
        const top = opening.top == null ? 3.05 : opening.top;
        if (bottom > 0.02) {
          const lowerCenter = floorY + bottom / 2;
          if (axis === "x") box({ name: `${name}-window-low`, w: opening.width, h: bottom, d: 0.28, x: opening.center, y: lowerCenter, z: fixed, material, collider: true, occluder: true });
          else box({ name: `${name}-window-low`, w: 0.28, h: bottom, d: opening.width, x: fixed, y: lowerCenter, z: opening.center, material, collider: true, occluder: true });
        }
        if (height - top > 0.02) {
          const upperH = height - top;
          const upperCenter = floorY + top + upperH / 2;
          if (axis === "x") box({ name: `${name}-window-high`, w: opening.width, h: upperH, d: 0.28, x: opening.center, y: upperCenter, z: fixed, material, collider: true, occluder: true });
          else box({ name: `${name}-window-high`, w: 0.28, h: upperH, d: opening.width, x: fixed, y: upperCenter, z: opening.center, material, collider: true, occluder: true });
        }
        addWindow(axis, fixed, opening.center, floorY, opening, exterior);
      } else {
        const doorH = opening.height || 2.55;
        const headerH = height - doorH;
        if (headerH > 0.02) {
          if (axis === "x") box({ name: `${name}-door-header`, w: opening.width, h: headerH, d: 0.28, x: opening.center, y: floorY + doorH + headerH / 2, z: fixed, material, collider: true, occluder: true });
          else box({ name: `${name}-door-header`, w: 0.28, h: headerH, d: opening.width, x: fixed, y: floorY + doorH + headerH / 2, z: opening.center, material, collider: true, occluder: true });
        }
        addDoorFrame(axis, fixed, opening.center, floorY, opening.width, doorH);
        if (opening.kind !== "arch" && opening.kind !== "open") {
          new HingedDoor({
            name: opening.label || "door", axis, fixed, center: opening.center,
            // Match the leaf to the lintel underside. The old 8 cm reduction
            // exposed a bright strip above every closed door; 2 cm preserves
            // swing clearance without leaving a visible gap.
            width: opening.width - 0.12, height: doorH - 0.02, floorY,
            direction: opening.direction || 1,
            hingeSide: opening.hingeSide == null ? -1 : opening.hingeSide,
            material: opening.material || M.darkWood,
          });
        }
      }
      cursor = right;
    }
    wallSegment(axis, fixed, cursor, end, floorY, height, material, `${name}-segment-end`);
  }

  function floorSlab(name, x, z, w, d, floorY, material) {
    return box({ name, w, h: 0.24, d, x, y: floorY - 0.12, z, material, collider: true, cast: true, receive: true });
  }

  function stairStep(name, x, z, w, d, topY, baseY, material, collider) {
    const h = topY - baseY;
    return box({ name, w, h, d, x, y: baseY + h / 2, z, material, collider: collider !== false, cast: true, receive: true });
  }

  function addInvisibleRamp(x, z, lowY, highY, run, width, directionZ) {
    physics.addFixedRamp(x, z, lowY, highY, run, width, directionZ);
  }

  function addRailingRun(axis, start, end, fixed, baseY, height, name) {
    const length = end - start;
    const count = Math.max(2, Math.floor(length / 0.38));
    const balusters = [];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      balusters.push(axis === "x"
        ? { x: lerp(start, end, t), y: baseY + height / 2, z: fixed }
        : { x: fixed, y: baseY + height / 2, z: lerp(start, end, t) });
    }
    addBalusterInstanceBatch(`${name}-balusters`, balusters, height);
    if (axis === "x") box({ name: `${name}-rail`, w: length + 0.08, h: 0.08, d: 0.1, x: (start + end) / 2, y: baseY + height, z: fixed, material: M.darkWood, cast: true });
    else box({ name: `${name}-rail`, w: 0.1, h: 0.08, d: length + 0.08, x: fixed, y: baseY + height, z: (start + end) / 2, material: M.darkWood, cast: true });
  }

  function addBoxBeamBetween(name, from, to, width, depth, material) {
    const start = new THREE.Vector3(from[0], from[1], from[2]);
    const end = new THREE.Vector3(to[0], to[1], to[2]);
    const direction = end.clone().sub(start);
    const length = direction.length();
    const mesh = new THREE.Mesh(geometry("unitBox", () => new THREE.BoxGeometry(1, 1, 1)), material || M.blackWood);
    mesh.name = name;
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.scale.set(width, length, depth);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function addBoxInstanceBatch(name, material, transforms, cast = true, receive = true) {
    if (!transforms.length) return null;
    const mesh = new THREE.InstancedMesh(geometry("unitBox", () => new THREE.BoxGeometry(1, 1, 1)), material, transforms.length);
    const dummy = new THREE.Object3D();
    transforms.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.scale.set(item.w, item.h, item.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  function addOutdoorInstanceBatch(name, geometryKey, geometryFactory, material, transforms, cast = false, receive = true) {
    if (!transforms.length) return null;
    const mesh = new THREE.InstancedMesh(geometry(geometryKey, geometryFactory), material, transforms.length);
    const dummy = new THREE.Object3D();
    transforms.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(item.rx || 0, item.ry || 0, item.rz || 0);
      dummy.scale.set(item.sx == null ? 1 : item.sx, item.sy == null ? 1 : item.sy, item.sz == null ? 1 : item.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    // Three r128 does not compute aggregate instance bounds reliably. Yard
    // batches are deliberately sector-sized and inexpensive enough to remain
    // stable while the player looks through windows from inside the mansion.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  function addOutdoorBeamBatch(name, material, beams, cast = false) {
    if (!beams.length) return null;
    const mesh = new THREE.InstancedMesh(geometry("yardBeamCylinder", () => new THREE.CylinderGeometry(1, 1, 1, 8)), material, beams.length);
    const dummy = new THREE.Object3D();
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    beams.forEach((beam, index) => {
      start.set(beam.from[0], beam.from[1], beam.from[2]);
      end.set(beam.to[0], beam.to[1], beam.to[2]);
      direction.copy(end).sub(start);
      dummy.position.copy(start).add(end).multiplyScalar(0.5);
      dummy.scale.set(beam.radius, direction.length(), beam.radius);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  function addBalusterInstanceBatch(name, positions, height = 0.86) {
    if (!positions.length) return null;
    const geometryKey = `grandBaluster-${height.toFixed(2)}`;
    const mesh = new THREE.InstancedMesh(geometry(geometryKey, () => new THREE.CylinderGeometry(0.018, 0.018, height, 10)), M.iron, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }

  function addGrandStairStep(options) {
    const { name, x, z, width, depth, topY, rise, directionZ, runnerWidth, batches } = options;
    const approachEdgeZ = z - directionZ * (depth / 2);
    box({ name: `${name}-tread`, w: width, h: 0.09, d: depth + 0.018, x, y: topY - 0.045, z, material: M.stairMarble, cast: true, receive: true });
    const riser = { w: width - 0.045, h: rise, d: 0.055, x, y: topY - rise / 2, z: approachEdgeZ };
    const nosing = { w: width + 0.055, h: 0.045, d: 0.075, x, y: topY - 0.018, z: approachEdgeZ - directionZ * 0.018 };
    const runnerTread = { w: runnerWidth, h: 0.018, d: depth * 0.84, x, y: topY + 0.01, z: z + directionZ * depth * 0.03 };
    const runnerRiser = { w: runnerWidth, h: Math.max(0.05, rise - 0.018), d: 0.022, x, y: topY - rise / 2, z: approachEdgeZ - directionZ * 0.031 };
    if (batches) {
      batches.risers.push(riser);
      batches.nosings.push(nosing);
      batches.runners.push(runnerTread, runnerRiser);
    } else {
      box({ name: `${name}-riser`, ...riser, material: M.blackWood, cast: true, receive: true });
      box({ name: `${name}-nosing`, ...nosing, material: M.darkWood, cast: true, receive: true });
      box({ name: `${name}-runner`, ...runnerTread, material: M.redRug, cast: false, receive: true });
      box({ name: `${name}-runner-riser`, ...runnerRiser, material: M.redRug, cast: false, receive: true });
    }
  }

  function addStairNewel(name, x, z, baseY, height = 1.02) {
    box({ name: `${name}-newel-base`, w: 0.23, h: 0.18, d: 0.23, x, y: baseY + 0.09, z, material: M.blackWood, cast: true });
    box({ name: `${name}-newel-post`, w: 0.15, h: height - 0.15, d: 0.15, x, y: baseY + 0.18 + (height - 0.15) / 2, z, material: M.darkWood, cast: true });
    cylinder({ name: `${name}-newel-collar`, radius: 0.105, height: 0.075, segments: 14, x, y: baseY + height, z, material: M.brass, cast: true });
    sphere({ name: `${name}-newel-finial`, radius: 0.105, widthSegments: 16, heightSegments: 10, x, y: baseY + height + 0.105, z, material: M.brass, cast: true });
  }

  function addSlopedRailGuard(x, centerZ, lowY, highY, run, directionZ, name) {
    const rise = highY - lowY;
    const slope = Math.atan2(rise, run);
    const length = Math.hypot(run, rise);
    physics.addFixedBox(x, (lowY + highY) / 2 + 0.46, centerZ, 0.12, 0.9, length, 0, -directionZ * slope, 0);
  }

  function buildGrandStaircase() {
    const run = 4.1;
    const grandRailHeight = 0.97;
    const lowerCount = GRAND_STAIR.LOWER_STEP_COUNT;
    const upperCount = GRAND_STAIR.UPPER_STEP_COUNT;
    const midY = FLOOR.MAIN + GRAND_STAIR.MID_LANDING_RISE;
    const lowerRise = (midY - FLOOR.MAIN) / lowerCount;
    const upperRise = (FLOOR.UPPER - midY) / upperCount;
    const lowerTread = run / lowerCount;
    const upperTread = run / upperCount;
    const lowerWidth = 2.38;
    const lowerRailX = 1.24;
    const lowerStartZ = 2.8;
    const lowerEndZ = -0.98;
    const lowerRampRun = lowerStartZ - lowerEndZ;
    const lowerCenterZ = (lowerStartZ + lowerEndZ) / 2;
    const stairBatches = { risers: [], nosings: [], runners: [], balusters: [] };

    // Thin stone treads, dark oak risers, a fitted runner, and visible
    // stringers replace the former stack of full-height marble boxes.
    for (let i = 0; i < lowerCount; i += 1) {
      const topY = FLOOR.MAIN + lowerRise * (i + 1);
      const z = lowerStartZ - lowerTread * (i + 0.5);
      addGrandStairStep({ name: `grand-lower-step-${i}`, x: 0, z, width: lowerWidth, depth: lowerTread + 0.025, topY, rise: lowerRise, directionZ: -1, runnerWidth: 1.06, batches: stairBatches });
      for (const x of [-lowerRailX, lowerRailX]) {
        stairBatches.balusters.push({ x, y: topY + grandRailHeight / 2, z });
      }
    }
    for (const x of [-1.02, 1.02]) {
      addBoxBeamBetween("grand-lower-stringer", [x, FLOOR.MAIN + 0.08, lowerStartZ], [x, midY + 0.08, lowerEndZ], 0.15, 0.25, M.blackWood);
    }
    // A finished oak soffit hides the raw sawtooth silhouette when the flight
    // is viewed from the surrounding hall.  The offset edge battens make the
    // underside read as fitted millwork without changing the walkable ramp.
    addBoxBeamBetween("grand-lower-soffit", [0, FLOOR.MAIN - 0.055, lowerStartZ], [0, midY - 0.155, lowerEndZ], lowerWidth - 0.2, 0.11, M.darkWood);
    for (const x of [-0.94, 0.94]) {
      addBoxBeamBetween("grand-lower-soffit-batten", [x, FLOOR.MAIN - 0.105, lowerStartZ], [x, midY - 0.205, lowerEndZ], 0.055, 0.055, M.brass);
    }
    addInvisibleRamp(0, lowerCenterZ, FLOOR.MAIN, midY, lowerRampRun, lowerWidth - 0.16, -1);
    for (const x of [-lowerRailX, lowerRailX]) {
      addBeamBetween("grand-lower-handrail", [x, FLOOR.MAIN + 0.97, lowerStartZ], [x, midY + 0.97, lowerEndZ], 0.035, M.darkWood);
      addSlopedRailGuard(x, lowerCenterZ, FLOOR.MAIN, midY, lowerRampRun, -1, "grand-lower-guard");
      addStairNewel("grand-lower-bottom", x, lowerStartZ, FLOOR.MAIN, 0.98);
      addStairNewel("grand-lower-top", x, lowerEndZ, midY, 0.98);
    }

    const midWidth = 6.7;
    const midDepth = 1.3;
    const midCenterZ = -1.625;
    box({ name: "grand-mid-landing", w: midWidth, h: 0.16, d: midDepth, x: 0, y: midY - 0.08, z: midCenterZ, material: M.stairMarble, collider: true, cast: true, receive: true });
    box({ name: "grand-mid-landing-runner", w: 5.92, h: 0.024, d: 0.78, x: 0, y: midY + 0.012, z: midCenterZ + 0.04, material: M.redRug, cast: false });
    box({ name: "grand-mid-landing-coffer", w: 6.38, h: 0.025, d: 1.02, x: 0, y: midY - 0.172, z: midCenterZ, material: M.blackWood, cast: false });
    for (const z of [midCenterZ - 0.48, midCenterZ + 0.48]) box({ name: "grand-mid-coffer-inlay", w: 6.22, h: 0.018, d: 0.035, x: 0, y: midY - 0.188, z, material: M.brass, cast: false });
    for (const x of [-3.08, 3.08]) box({ name: "grand-mid-coffer-inlay", w: 0.035, h: 0.018, d: 0.98, x, y: midY - 0.188, z: midCenterZ, material: M.brass, cast: false });
    for (const z of [midCenterZ - midDepth / 2, midCenterZ + midDepth / 2]) {
      box({ name: "grand-mid-landing-fascia", w: midWidth + 0.06, h: 0.25, d: 0.12, x: 0, y: midY - 0.12, z, material: M.blackWood, cast: true });
      box({ name: "grand-mid-landing-brass-inlay", w: midWidth - 0.35, h: 0.035, d: 0.025, x: 0, y: midY - 0.07, z: z + (z < midCenterZ ? 0.065 : -0.065), material: M.brass, cast: false });
    }
    addRailingRun("x", -3.27, 3.27, -2.22, midY, 0.96, "grand-mid-rear-guard");
    for (const side of [-1, 1]) {
      addRailingRun("z", -2.22, lowerEndZ, side * 3.33, midY, 0.96, `grand-mid-side-guard-${side}`);
      physics.addFixedBox(side * 3.33, midY + 0.48, -1.6, 0.14, 0.96, 1.24, 0);
    }
    physics.addFixedBox(0, midY + 0.48, -2.22, 6.54, 0.96, 0.14, 0);

    const branchCenter = 2.48;
    const branchWidth = 1.7;
    const branchInner = 1.61;
    const branchOuter = 3.35;
    const branchEndZ = 3.1;
    const branchRun = branchEndZ - lowerEndZ;
    const branchCenterZ = (lowerEndZ + branchEndZ) / 2;
    for (const side of [-1, 1]) {
      for (let i = 0; i < upperCount; i += 1) {
        const topY = midY + upperRise * (i + 1);
        const z = lowerEndZ + upperTread * (i + 0.5);
        addGrandStairStep({ name: `grand-upper-${side}-step-${i}`, x: side * branchCenter, z, width: branchWidth, depth: upperTread + 0.025, topY, rise: upperRise, directionZ: 1, runnerWidth: 0.8, batches: stairBatches });
        for (const x of [side * branchInner, side * branchOuter]) {
          stairBatches.balusters.push({ x, y: topY + grandRailHeight / 2, z });
        }
      }
      for (const x of [side * (branchCenter - 0.68), side * (branchCenter + 0.68)]) {
        addBoxBeamBetween(`grand-upper-stringer-${side}`, [x, midY + 0.08, lowerEndZ], [x, FLOOR.UPPER + 0.08, branchEndZ], 0.14, 0.23, M.blackWood);
      }
      addBoxBeamBetween(`grand-upper-soffit-${side}`, [side * branchCenter, midY - 0.055, lowerEndZ], [side * branchCenter, FLOOR.UPPER - 0.155, branchEndZ], branchWidth - 0.18, 0.11, M.darkWood);
      for (const offset of [-0.65, 0.65]) {
        addBoxBeamBetween(`grand-upper-soffit-batten-${side}`, [side * branchCenter + offset, midY - 0.105, lowerEndZ], [side * branchCenter + offset, FLOOR.UPPER - 0.205, branchEndZ], 0.05, 0.055, M.brass);
      }
      for (const x of [side * branchInner, side * branchOuter]) {
        addBeamBetween(`grand-upper-handrail-${side}`, [x, midY + 0.97, lowerEndZ], [x, FLOOR.UPPER + 0.97, branchEndZ], 0.035, M.darkWood);
        addSlopedRailGuard(x, branchCenterZ, midY, FLOOR.UPPER, branchRun, 1, `grand-upper-guard-${side}`);
        addStairNewel(`grand-upper-bottom-${side}`, x, lowerEndZ, midY, 0.98);
        addStairNewel(`grand-upper-top-${side}`, x, branchEndZ, FLOOR.UPPER, 0.98);
      }
      addBeamBetween(`grand-mid-transition-rail-${side}`, [side * lowerRailX, midY + 0.97, lowerEndZ], [side * branchInner, midY + 0.97, lowerEndZ], 0.035, M.darkWood);
      addInvisibleRamp(side * branchCenter, branchCenterZ, midY, FLOOR.UPPER, branchRun, branchWidth - 0.12, 1);
    }

    addBoxInstanceBatch("grand-stair-risers", M.blackWood, stairBatches.risers, true, true);
    addBoxInstanceBatch("grand-stair-nosings", M.darkWood, stairBatches.nosings, true, true);
    addBoxInstanceBatch("grand-stair-runner", M.redRug, stairBatches.runners, false, true);
    addBalusterInstanceBatch("grand-stair-balusters", stairBatches.balusters, grandRailHeight);

    // A trimmed cross-landing completes the split flights and meets the upper
    // balcony at one continuous datum.
    box({ name: "grand-upper-cross-landing", w: 6.9, h: 0.18, d: 1.3, x: 0, y: FLOOR.UPPER - 0.09, z: 3.75, material: M.stairMarble, collider: true, cast: true, receive: true });
    box({ name: "grand-upper-cross-runner", w: 5.95, h: 0.024, d: 0.78, x: 0, y: FLOOR.UPPER + 0.012, z: 3.73, material: M.redRug, cast: false });
    box({ name: "grand-upper-cross-coffer", w: 6.56, h: 0.025, d: 1.04, x: 0, y: FLOOR.UPPER - 0.195, z: 3.75, material: M.blackWood, cast: false });
    for (const z of [3.27, 4.23]) box({ name: "grand-upper-coffer-inlay", w: 6.4, h: 0.018, d: 0.035, x: 0, y: FLOOR.UPPER - 0.21, z, material: M.brass, cast: false });
    for (const x of [-3.18, 3.18]) box({ name: "grand-upper-coffer-inlay", w: 0.035, h: 0.018, d: 1.0, x, y: FLOOR.UPPER - 0.21, z: 3.75, material: M.brass, cast: false });
    box({ name: "grand-upper-cross-fascia", w: 6.94, h: 0.28, d: 0.13, x: 0, y: FLOOR.UPPER - 0.14, z: 3.1, material: M.blackWood, cast: true });
    box({ name: "grand-upper-cross-inlay", w: 3.0, h: 0.04, d: 0.028, x: 0, y: FLOOR.UPPER - 0.08, z: 3.025, material: M.brass, cast: false });
    addRailingRun("x", -3.42, 3.42, 4.4, FLOOR.UPPER, 0.98, "foyer-balcony-front-guard");
    addRailingRun("x", -branchInner, branchInner, 3.1, FLOOR.UPPER, 0.98, "foyer-balcony-center-rear-guard");
    addRailingRun("z", 4.4, 11.1, -3.42, FLOOR.UPPER, 0.98, "foyer-balcony-west");
    addRailingRun("z", 4.4, 11.1, 3.42, FLOOR.UPPER, 0.98, "foyer-balcony-east");
    for (const x of [-3.42, 3.42]) addStairNewel("grand-balcony-corner", x, 4.4, FLOOR.UPPER, 0.98);
    physics.addFixedBox(0, FLOOR.UPPER + 0.5, 4.4, 6.84, 1, 0.16, 0);
    physics.addFixedBox(0, FLOOR.UPPER + 0.5, 3.1, branchInner * 2, 1, 0.16, 0);
    physics.addFixedBox(-3.42, FLOOR.UPPER + 0.5, 7.75, 0.16, 1, 6.7, 0);
    physics.addFixedBox(3.42, FLOOR.UPPER + 0.5, 7.75, 0.16, 1, 6.7, 0);
    buildRearUpperWalkwayGuard();
  }

  function buildRearUpperWalkwayGuard() {
    // The rear upper landing wraps the second stair void. These three joined
    // runs sit exactly on the slab edges and each owns a matching Rapier guard.
    // The repeated ironwork is one static instance batch instead of 28 meshes.
    const balusters = [];
    const addBalusters = (axis, start, end, fixed) => {
      const count = Math.max(2, Math.floor((end - start) / 0.38));
      for (let i = 0; i <= count; i += 1) {
        const value = lerp(start, end, i / count);
        balusters.push({ x: axis === "x" ? value : fixed, y: FLOOR.UPPER + 0.47, z: axis === "x" ? fixed : value });
      }
    };
    addBalusters("x", -3.42, 3.42, -2.5);
    addBalusters("z", -2.5, -0.98, -3.42);
    addBalusters("z", -2.5, -0.98, 3.42);
    addBalusterInstanceBatch("upper-rear-walkway-balusters", balusters, 0.94);
    box({ name: "upper-rear-landing-guard-rail", w: 6.92, h: 0.08, d: 0.1, x: 0, y: FLOOR.UPPER + 0.98, z: -2.5, material: M.darkWood });
    box({ name: "upper-rear-west-guard-rail", w: 0.1, h: 0.08, d: 1.6, x: -3.42, y: FLOOR.UPPER + 0.98, z: -1.74, material: M.darkWood });
    box({ name: "upper-rear-east-guard-rail", w: 0.1, h: 0.08, d: 1.6, x: 3.42, y: FLOOR.UPPER + 0.98, z: -1.74, material: M.darkWood });
    physics.addFixedBox(0, FLOOR.UPPER + 0.5, -2.5, 6.84, 1, 0.16, 0);
    physics.addFixedBox(-3.42, FLOOR.UPPER + 0.5, -1.74, 0.16, 1, 1.52, 0);
    physics.addFixedBox(3.42, FLOOR.UPPER + 0.5, -1.74, 0.16, 1, 1.52, 0);
    for (const x of [-3.42, 3.42]) {
      addStairNewel("upper-rear-walkway-corner", x, -2.5, FLOOR.UPPER, 0.98);
      addStairNewel("upper-rear-walkway-return", x, -0.98, FLOOR.UPPER, 0.98);
    }
  }

  function buildServiceStaircase() {
    const bottomZ = 2.7;
    const topZ = -2.7;
    const run = 5.4;
    const count = 22;
    const depth = run / count;
    const rise = (FLOOR.MAIN - FLOOR.BASEMENT) / count;
    const batches = { risers: [], nosings: [], runners: [], balusters: [] };
    for (let i = 0; i < count; i += 1) {
      const topY = FLOOR.BASEMENT + rise * (i + 1);
      const z = bottomZ - depth * (i + 0.5);
      addGrandStairStep({
        name: `service-stair-tread-${i}`,
        x: 12.55,
        z,
        width: 2.1,
        depth: depth * 0.82,
        topY,
        rise,
        directionZ: -1,
        runnerWidth: 0.84,
        batches,
      });
      for (const x of [11.52, 13.58]) batches.balusters.push({ x, y: topY + 0.43, z });
    }
    addBoxInstanceBatch("service-stair-risers", M.agedTrim, batches.risers, true, true);
    addBoxInstanceBatch("service-stair-nosings", M.brass, batches.nosings, true, true);
    const serviceRunnerTreads = batches.runners.filter((_, index) => index % 2 === 0);
    addBoxInstanceBatch("service-stair-runner", M.redRug, serviceRunnerTreads, false, true);
    addBalusterInstanceBatch("service-stair-balusters", batches.balusters);
    addInvisibleRamp(12.55, 0, FLOOR.BASEMENT, FLOOR.MAIN, run, 2.08, -1);
    for (const x of [11.52, 13.58]) {
      addBoxBeamBetween("service-stair-stringer", [x, FLOOR.BASEMENT + 0.08, bottomZ], [x, FLOOR.MAIN + 0.08, topZ], 0.13, 0.22, M.blackWood);
      addBeamBetween("service-stair-handrail", [x, FLOOR.BASEMENT + 0.96, bottomZ], [x, FLOOR.MAIN + 0.96, topZ], 0.035, M.darkWood);
      addSlopedRailGuard(x, 0, FLOOR.BASEMENT, FLOOR.MAIN, run, -1, "service-stair-guard");
      addStairNewel("service-stair-bottom", x, bottomZ, FLOOR.BASEMENT, 0.98);
      addStairNewel("service-stair-top", x, topZ, FLOOR.MAIN, 0.98);
    }
    addRailingRun("x", 11.42, 13.68, bottomZ, FLOOR.MAIN, 0.98, "service-stair-low-end-guard");
    physics.addFixedBox(12.55, FLOOR.MAIN + 0.5, bottomZ, 2.26, 1, 0.16, 0);
  }

  function addRug(x, z, w, d, floorY, material, rotationY) {
    return plane({ name: "woven-estate-rug", w, h: d, x, y: floorY + 0.018, z, rotationX: -Math.PI / 2, rotationZ: rotationY || 0, material });
  }

  function addTable(x, z, width, depth, floorY, rotationY, material) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    box({ name: "table-top", w: width, h: 0.12, d: depth, x: 0, y: 0.79, z: 0, material: material || M.darkWood, parent: group });
    box({ name: "table-apron-long-a", w: width - 0.22, h: 0.18, d: 0.08, x: 0, y: 0.66, z: depth / 2 - 0.09, material: M.blackWood, parent: group, cast: false });
    box({ name: "table-apron-long-b", w: width - 0.22, h: 0.18, d: 0.08, x: 0, y: 0.66, z: -depth / 2 + 0.09, material: M.blackWood, parent: group, cast: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      cylinder({ name: "turned-table-leg", radius: 0.075, radiusTop: 0.052, radiusBottom: 0.095, height: 0.73, segments: 12, x: sx * (width / 2 - 0.18), y: 0.365, z: sz * (depth / 2 - 0.16), material: material || M.darkWood, parent: group });
      sphere({ name: "table-leg-knee", radius: 0.095, x: sx * (width / 2 - 0.18), y: 0.55, z: sz * (depth / 2 - 0.16), material: material || M.darkWood, parent: group });
    }
    const cw = Math.abs(Math.cos(rotationY || 0)) * width + Math.abs(Math.sin(rotationY || 0)) * depth;
    const cd = Math.abs(Math.sin(rotationY || 0)) * width + Math.abs(Math.cos(rotationY || 0)) * depth;
    physics.addFixedBox(x, floorY + 0.42, z, cw, 0.84, cd, 0);
    return group;
  }

  function addChair(x, z, floorY, rotationY, material) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    box({ name: "chair-seat", w: 0.52, h: 0.1, d: 0.5, x: 0, y: 0.48, z: 0, material: material || M.darkWood, parent: group });
    box({ name: "chair-cushion", w: 0.46, h: 0.09, d: 0.44, x: 0, y: 0.565, z: -0.01, material: M.velvet, parent: group, cast: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder({ name: "chair-leg", radius: 0.035, radiusBottom: 0.045, height: 0.47, segments: 9, x: sx * 0.2, y: 0.235, z: sz * 0.19, material: material || M.darkWood, parent: group });
    for (const sx of [-1, 1]) cylinder({ name: "chair-back-post", radius: 0.038, height: 0.82, segments: 9, x: sx * 0.22, y: 0.89, z: 0.21, material: material || M.darkWood, parent: group });
    box({ name: "chair-back", w: 0.43, h: 0.48, d: 0.065, x: 0, y: 0.9, z: 0.21, material: M.velvet, parent: group });
    physics.addFixedBox(x, floorY + 0.55, z, 0.56, 1.1, 0.56, rotationY || 0);
    return group;
  }

  function addSofa(x, z, floorY, rotationY, width, material) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    const w = width || 2.4;
    box({ name: "sofa-base", w, h: 0.42, d: 0.9, x: 0, y: 0.31, z: 0, material: M.blackWood, parent: group });
    roundedBox({ name: "sofa-seat", w: w - 0.34, h: 0.24, d: 0.7, radius: 0.1, x: 0, y: 0.6, z: -0.04, material: material || M.velvet, parent: group });
    roundedBox({ name: "sofa-back", w: w - 0.2, h: 0.78, d: 0.24, radius: 0.11, x: 0, y: 0.94, z: 0.34, material: material || M.velvet, parent: group });
    for (const sx of [-1, 1]) {
      cylinder({ name: "rolled-sofa-arm", radius: 0.19, height: 0.78, segments: 18, x: sx * (w / 2 - 0.16), y: 0.72, z: 0, rotationX: Math.PI / 2, material: material || M.velvet, parent: group });
      sphere({ name: "sofa-arm-cap", radius: 0.19, x: sx * (w / 2 - 0.16), y: 0.72, z: -0.39, material: material || M.velvet, parent: group, cast: true });
    }
    for (let i = 1; i < 3; i += 1) box({ name: "sofa-cushion-seam", w: 0.018, h: 0.18, d: 0.66, x: -w / 2 + i * w / 3, y: 0.61, z: -0.04, material: M.blackWood, parent: group, cast: false });
    for (let i = 0; i < 5; i += 1) sphere({ name: "sofa-button", radius: 0.028, x: -w * 0.32 + i * w * 0.16, y: 0.99, z: 0.225, material: M.brass, parent: group, cast: false });
    const cw = Math.abs(Math.cos(rotationY || 0)) * w + Math.abs(Math.sin(rotationY || 0)) * 0.9;
    const cd = Math.abs(Math.sin(rotationY || 0)) * w + Math.abs(Math.cos(rotationY || 0)) * 0.9;
    physics.addFixedBox(x, floorY + 0.65, z, cw, 1.3, cd, 0);
    return group;
  }

  function faceTargetYaw(fromX, fromZ, targetX, targetZ) {
    return Math.atan2(fromX - targetX, fromZ - targetZ);
  }

  function addBed(x, z, floorY, rotationY, width, canopy) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    const w = width || 2.0;
    const d = 2.5;
    box({ name: "bed-frame", w, h: 0.34, d, x: 0, y: 0.32, z: 0, material: M.darkWood, parent: group });
    box({ name: "bed-mattress", w: w - 0.16, h: 0.24, d: d - 0.2, x: 0, y: 0.61, z: -0.02, material: M.fabric, parent: group });
    box({ name: "bed-coverlet", w: w - 0.2, h: 0.08, d: 1.5, x: 0, y: 0.77, z: -0.3, material: M.velvet, parent: group, cast: false });
    for (const sx of [-0.22, 0.22]) roundedBox({ name: "bed-pillow", w: w * 0.4, h: 0.16, d: 0.55, radius: 0.07, x: sx * w, y: 0.8, z: 0.75, material: M.porcelain, parent: group, cast: false });
    box({ name: "bed-headboard", w: w + 0.18, h: 1.55, d: 0.18, x: 0, y: 0.9, z: d / 2, material: M.darkWood, parent: group });
    box({ name: "bed-headboard-upholstery", w: w - 0.28, h: 0.92, d: 0.05, x: 0, y: 1.08, z: d / 2 - 0.12, material: M.velvet, parent: group, cast: false });
    if (canopy) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder({ name: "canopy-post", radius: 0.045, height: 2.65, segments: 10, x: sx * (w / 2 + 0.02), y: 1.325, z: sz * (d / 2 + 0.02), material: M.darkWood, parent: group });
      box({ name: "canopy-top-front", w: w + 0.18, h: 0.1, d: 0.1, x: 0, y: 2.62, z: d / 2, material: M.darkWood, parent: group });
      box({ name: "canopy-top-back", w: w + 0.18, h: 0.1, d: 0.1, x: 0, y: 2.62, z: -d / 2, material: M.darkWood, parent: group });
    }
    const cw = Math.abs(Math.cos(rotationY || 0)) * w + Math.abs(Math.sin(rotationY || 0)) * d;
    const cd = Math.abs(Math.sin(rotationY || 0)) * w + Math.abs(Math.cos(rotationY || 0)) * d;
    physics.addFixedBox(x, floorY + 0.7, z, cw, 1.4, cd, 0);
    return group;
  }

  function addWallMirror(axis, fixed, center, floorY, centerY, side, width, height) {
    const offset = 0.19;
    const group = new THREE.Group();
    if (axis === "x") {
      group.position.set(center, floorY + centerY, fixed + side * offset);
      group.rotation.y = side > 0 ? 0 : Math.PI;
    } else {
      group.position.set(fixed + side * offset, floorY + centerY, center);
      group.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    scene.add(group);
    box({ name: "bathroom-mirror-back", w: width + 0.14, h: height + 0.14, d: 0.07, x: 0, y: 0, z: 0, material: M.brass, parent: group, cast: false });
    box({ name: "aged-silver-mirror", w: width, h: height, d: 0.025, x: 0, y: 0, z: 0.052, material: M.mirror, parent: group, cast: false, receive: false });
    return group;
  }

  class FlushableToilet {
    constructor(options) {
      const { name, x, z, floorY, rotationY = 0 } = options;
      this.name = name;
      this.flushing = false;
      this.flushTime = 0;
      this.flushDuration = TOILET_FLUSH_DURATION;
      this.flushCount = 0;
      this.phase = Math.random() * Math.PI * 2;
      this.root = new THREE.Group();
      this.root.name = name;
      this.root.position.set(x, floorY, z);
      this.root.rotation.y = rotationY;
      scene.add(this.root);

      roundedBox({ name: `${name}-porcelain-pedestal`, w: 0.4, h: 0.36, d: 0.58, radius: 0.12, x: 0, y: 0.2, z: -0.04, material: M.porcelain, parent: this.root });
      // A continuous outer-lip-inner profile gives the toilet a genuinely
      // hollow bowl without CSG. Both toilets share this low-cost shell.
      const bowl = new THREE.Mesh(geometry("toiletBowlShell", () => new THREE.LatheGeometry([
        new THREE.Vector2(0.13, 0.02),
        new THREE.Vector2(0.25, 0.08),
        new THREE.Vector2(0.32, 0.2),
        new THREE.Vector2(0.34, 0.31),
        new THREE.Vector2(0.31, 0.35),
        new THREE.Vector2(0.245, 0.34),
        new THREE.Vector2(0.18, 0.27),
        new THREE.Vector2(0.11, 0.12),
      ], 28)), M.porcelain);
      bowl.name = `${name}-hollow-porcelain-bowl`;
      bowl.scale.set(1, 1, 1.28);
      bowl.position.set(0, 0.37, -0.12);
      bowl.castShadow = true;
      this.root.add(bowl);
      const seat = new THREE.Mesh(geometry("toiletSeatRing", () => new THREE.TorusGeometry(0.245, 0.03, 8, 30)), M.porcelain);
      seat.name = `${name}-toilet-seat`;
      seat.scale.set(1, 1.28, 1);
      seat.rotation.x = Math.PI / 2;
      seat.position.set(0, 0.735, -0.12);
      this.root.add(seat);
      roundedBox({ name: `${name}-porcelain-cistern`, w: 0.58, h: 0.68, d: 0.25, radius: 0.06, x: 0, y: 0.67, z: 0.31, material: M.porcelain, parent: this.root });
      cylinder({ name: `${name}-bowl-drain`, radius: 0.05, height: 0.012, segments: 16, x: 0, y: 0.535, z: -0.12, material: M.brass, parent: this.root, cast: false });

      this.waterMaterial = new THREE.MeshBasicMaterial({
        color: 0x67bfe2,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.water = new THREE.Mesh(geometry("toiletBowlWater", () => new THREE.CircleGeometry(0.17, 28)), this.waterMaterial);
      this.water.name = `${name}-bowl-water`;
      this.water.rotation.x = -Math.PI / 2;
      this.water.scale.set(1, 1.25, 1);
      this.waterFullY = 0.565;
      this.water.position.set(0, this.waterFullY, -0.12);
      this.water.castShadow = false;
      this.water.renderOrder = 3;
      this.root.add(this.water);

      this.swirlMaterial = new THREE.MeshBasicMaterial({
        color: 0xb9efff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.swirl = new THREE.Mesh(geometry("toiletFlushSwirl", () => new THREE.TorusGeometry(0.105, 0.011, 6, 28)), this.swirlMaterial);
      this.swirl.name = `${name}-flush-swirl`;
      this.swirl.rotation.x = Math.PI / 2;
      this.swirl.position.set(0, 0.578, -0.12);
      this.swirl.scale.set(1, 1.25, 1);
      this.swirl.visible = false;
      this.swirl.renderOrder = 4;
      this.root.add(this.swirl);

      this.handlePivot = new THREE.Group();
      this.handlePivot.name = `${name}-flush-handle-pivot`;
      // The bowl faces local -z, so the usable face of the cistern is its
      // low-z surface. Keeping the control just proud of that face makes the
      // brass handle visible and raycastable from inside every bathroom.
      this.handlePivot.position.set(0.2, 0.77, 0.15);
      this.root.add(this.handlePivot);
      cylinder({ name: `${name}-flush-handle-mount`, radius: 0.047, height: 0.07, segments: 14, x: 0, y: 0, z: 0, rotationX: Math.PI / 2, material: M.brass, parent: this.handlePivot, cast: false });
      const handle = roundedBox({ name: `${name}-flush-handle`, w: 0.2, h: 0.055, d: 0.055, radius: 0.02, x: -0.1, y: 0, z: -0.04, material: M.brass, parent: this.handlePivot, cast: false });
      const handleKnob = sphere({ name: `${name}-flush-handle-knob`, radius: 0.045, x: -0.205, y: 0, z: -0.04, material: M.brass, parent: this.handlePivot, cast: false });
      const interaction = {
        type: "toilet",
        getLabel: () => this.flushing ? `${name} is flushing` : `Flush ${name}`,
        activate: () => this.flush(),
      };
      addInteractionTarget(handle, interaction);
      addInteractionTarget(handleKnob, interaction);
      const hitbox = box({
        name: `${name}-flush-hitbox`, w: 0.36, h: 0.36, d: 0.34,
        x: 0.2, y: 0.77, z: 0.15, parent: this.root,
        material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        cast: false, receive: false,
      });
      hitbox.visible = false;
      addInteractionTarget(hitbox, interaction);

      physics.addFixedBox(x, floorY + 0.55, z, 0.68, 1.1, 0.92, rotationY);
      toilets.push(this);
      animatedObjects.push(this);
    }

    flush() {
      if (this.flushing) return false;
      this.flushing = true;
      this.flushTime = 0;
      this.flushCount += 1;
      this.swirl.visible = true;
      if (audioSystem) audioSystem.toiletFlush(this.name);
      return true;
    }

    update(dt) {
      if (!this.flushing) return;
      this.flushTime = Math.min(this.flushDuration, this.flushTime + dt);
      const progress = this.flushTime / this.flushDuration;
      const drainEnd = 0.31;
      const level = progress < drainEnd
        ? lerp(1, 0.22, progress / drainEnd)
        : lerp(0.22, 1, clamp((progress - drainEnd) / (1 - drainEnd), 0, 1));
      const handlePress = progress < 0.08
        ? progress / 0.08
        : progress < 0.2 ? 1 - (progress - 0.08) / 0.12 : 0;
      this.handlePivot.rotation.z = -handlePress * 0.72;
      this.water.position.y = this.waterFullY - (1 - level) * 0.075;
      this.water.scale.set(0.82 + level * 0.18, (0.82 + level * 0.18) * 1.25, 1);
      this.waterMaterial.opacity = 0.2 + level * 0.3;
      const swirlStrength = Math.sin(Math.PI * progress);
      this.swirl.rotation.z = this.phase + this.flushTime * 9.5;
      const swirlScale = 0.55 + swirlStrength * 0.85;
      this.swirl.scale.set(swirlScale, swirlScale * 1.25, swirlScale);
      this.swirlMaterial.opacity = swirlStrength * 0.46;
      if (this.flushTime >= this.flushDuration) {
        this.flushing = false;
        this.flushTime = 0;
        this.handlePivot.rotation.z = 0;
        this.water.position.y = this.waterFullY;
        this.water.scale.set(1, 1.25, 1);
        this.waterMaterial.opacity = 0.5;
        this.swirl.visible = false;
        this.swirlMaterial.opacity = 0;
      }
    }
  }

  function addToilet(name, x, z, floorY, rotationY) {
    return new FlushableToilet({ name, x, z, floorY, rotationY }).root;
  }

  function addBathtub(x, z, floorY, rotationY) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    roundedBox({ name: "clawfoot-bath-base", w: 0.58, h: 0.25, d: 1.62, radius: 0.14, x: 0, y: 0.23, z: 0, material: M.porcelain, parent: group });
    for (const side of [-1, 1]) roundedBox({ name: "clawfoot-bath-side", w: 0.14, h: 0.44, d: 1.9, radius: 0.07, x: side * 0.35, y: 0.42, z: 0, material: M.porcelain, parent: group });
    for (const end of [-1, 1]) roundedBox({ name: "clawfoot-bath-end", w: 0.7, h: 0.44, d: 0.14, radius: 0.07, x: 0, y: 0.42, z: end * 0.88, material: M.porcelain, parent: group });
    plane({ name: "still-bath-water", w: 0.54, h: 1.56, x: 0, y: 0.48, z: 0, rotationX: -Math.PI / 2, material: M.glass, parent: group });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sphere({ name: "brass-clawfoot", radius: 0.08, x: sx * 0.27, y: 0.08, z: sz * 0.68, material: M.brass, parent: group });
    cylinder({ name: "bath-faucet-deck-collar", radius: 0.09, height: 0.04, segments: 18, x: 0.25, y: 0.64, z: 0.66, material: M.brass, parent: group, cast: false });
    cylinder({ name: "bath-faucet-riser", radius: 0.035, height: 0.3, x: 0.25, y: 0.79, z: 0.66, material: M.brass, parent: group, cast: false });
    sphere({ name: "bath-faucet-elbow", radius: 0.055, x: 0.25, y: 0.94, z: 0.66, material: M.brass, parent: group, cast: false });
    cylinder({ name: "bath-faucet-spout", radius: 0.03, height: 0.32, x: 0.11, y: 0.94, z: 0.66, rotationZ: Math.PI / 2, material: M.brass, parent: group, cast: false });
    cylinder({ name: "bath-faucet-nozzle", radius: 0.034, height: 0.12, x: -0.05, y: 0.88, z: 0.66, material: M.brass, parent: group, cast: false });
    physics.addFixedBox(x, floorY + 0.34, z, 0.86, 0.68, 2.0, rotationY || 0);
    return group;
  }

  function addBathroomTilework(floorY, label) {
    box({ name: `${label}-marble-floor`, w: 3.1, h: 0.045, d: 4.35, x: -13.25, y: floorY + 0.023, z: -0.8, material: M.marble, cast: false, receive: true });
    const panelY = floorY + 0.61;
    box({ name: `${label}-east-tile`, w: 0.035, h: 1.18, d: 4.32, x: -11.69, y: panelY, z: -0.8, material: M.marble, cast: false });
    box({ name: `${label}-north-tile`, w: 3.1, h: 1.18, d: 0.035, x: -13.25, y: panelY, z: 1.41, material: M.marble, cast: false });
    for (const segment of [[-14.78, -13.75], [-12.65, -11.72]]) {
      box({ name: `${label}-south-tile`, w: segment[1] - segment[0], h: 1.18, d: 0.035, x: (segment[0] + segment[1]) / 2, y: panelY, z: -3.01, material: M.marble, cast: false });
    }
    box({ name: `${label}-north-chair-rail`, w: 3.12, h: 0.055, d: 0.07, x: -13.25, y: floorY + 1.23, z: 1.38, material: M.brass, cast: false });
  }

  function addHangingCoat(name, x, z, frontDirection, material, length = 1.08, angle = 0) {
    const shoulderY = 2.15;
    const coat = new THREE.Group();
    coat.name = `${name}-perpendicular-hanger-group`;
    coat.position.set(x, FLOOR.MAIN, z);
    // The closet rods run north/south. Each hanger and garment spans east/west
    // across the rod, then receives a small yaw so the row feels naturally
    // jostled rather than laid flat along the rail.
    coat.rotation.y = angle;
    scene.add(coat);
    for (const shoulderSide of [-1, 1]) {
      cylinder({
        name: `${name}-hanger-shoulder`,
        radius: 0.012,
        height: 0.32,
        x: shoulderSide * 0.13,
        y: shoulderY + 0.015,
        z: 0,
        rotationZ: shoulderSide * 1.01,
        material: M.brass,
        parent: coat,
        cast: false,
      });
    }
    cylinder({ name: `${name}-hanger-crossbar`, radius: 0.01, height: 0.48, x: 0, y: shoulderY - 0.12, z: 0, rotationZ: Math.PI / 2, material: M.brass, parent: coat, cast: false });
    cylinder({ name: `${name}-hanger-hook`, radius: 0.011, height: 0.18, x: 0, y: shoulderY + 0.2, z: 0, material: M.brass, parent: coat, cast: false });
    const coatX = frontDirection * 0.065;
    const body = roundedBox({
      name: `${name}-hanging-garment`,
      // Five-and-a-half centimetres keeps a coat softly dimensional without
      // reading like a padded slab when the row is viewed down the rod.
      w: 0.54, h: length, d: 0.055, radius: 0.032,
      x: coatX, y: shoulderY - length / 2 - 0.05, z: 0,
      material, parent: coat, cast: false,
    });
    for (const sleeveSide of [-1, 1]) {
      roundedBox({
        name: `${name}-sleeve`,
        w: 0.15, h: length * 0.72, d: 0.05, radius: 0.026,
        x: coatX + sleeveSide * 0.29 + frontDirection * 0.015,
        y: shoulderY - length * 0.43,
        z: 0,
        rotationZ: sleeveSide * 0.055,
        material, parent: coat, cast: false,
      });
    }
    box({ name: `${name}-collar`, w: 0.2, h: 0.13, d: 0.055, x: coatX + frontDirection * 0.02, y: shoulderY - 0.08, z: 0, material: M.darkWood, parent: coat, cast: false });
    return body;
  }

  function furnishCoatCloset() {
    const floorY = FLOOR.MAIN;
    const westRackX = -14.56;
    const eastRackX = -11.94;
    const rackCenterZ = -0.62;
    const rackLength = 3.72;
    const clearAisle = { minX: -13.72, maxX: -12.68, minZ: -2.82, maxZ: 0.62 };

    // The former washroom is already a generous 14.6m2. Warm oak, a long
    // runner, and perimeter storage turn the whole footprint into one closet
    // while this named center aisle stays free from colliders and door swing.
    plane({ name: "coat-closet-floor-runner", w: clearAisle.maxX - clearAisle.minX, h: clearAisle.maxZ - clearAisle.minZ, x: COAT_CLOSET.center.x, y: floorY + 0.026, z: (clearAisle.minZ + clearAisle.maxZ) / 2, material: M.greenRug });
    for (const x of [westRackX, eastRackX]) {
      box({ name: "coat-closet-upper-shelf", w: 0.58, h: 0.075, d: rackLength, x, y: floorY + 2.48, z: rackCenterZ, material: M.darkWood, cast: true });
      box({ name: "coat-closet-shoe-shelf", w: 0.54, h: 0.065, d: rackLength, x, y: floorY + 0.28, z: rackCenterZ, material: M.darkWood, cast: false });
      cylinder({ name: "coat-closet-hanging-rail", radius: 0.026, height: rackLength, x, y: floorY + 2.27, z: rackCenterZ, rotationX: Math.PI / 2, material: M.brass, cast: false });
      for (const supportZ of [-2.42, 1.18]) {
        cylinder({ name: "coat-closet-rail-support", radius: 0.018, height: 0.25, x, y: floorY + 2.39, z: supportZ, material: M.brass, cast: false });
      }
    }

    const coatMaterials = [M.velvet, M.fabric, M.leather, M.redRug, M.greenRug];
    const hangingAngles = [-0.11, -0.055, 0.035, 0.09, -0.075, 0.055, 0.115, -0.025];
    const westCoatPositions = Array.from({ length: 16 }, (_, index) => -2.38 + index * (3.36 / 15));
    const eastCoatPositions = Array.from({ length: 15 }, (_, index) => -2.34 + index * (3.28 / 14));
    const westCoats = [];
    westCoatPositions.forEach((z, index) => {
      westCoats.push(addHangingCoat(`coat-closet-west-coat-${index + 1}`, westRackX, z, 1, coatMaterials[index % coatMaterials.length], 1.0 + (index % 4) * 0.1, hangingAngles[index % hangingAngles.length]));
    });
    eastCoatPositions.forEach((z, index) => {
      addHangingCoat(`coat-closet-east-coat-${index + 1}`, eastRackX, z, -1, coatMaterials[(index + 2) % coatMaterials.length], 0.98 + (index % 3) * 0.12, -hangingAngles[(index + 2) % hangingAngles.length]);
    });
    const garmentBag = roundedBox({ name: "coat-closet-hanging-garment-bag", w: 0.55, h: 1.45, d: 0.05, radius: 0.026, x: eastRackX - 0.08, y: floorY + 1.35, z: 1.04, rotationY: -0.075, material: M.fabric, cast: false });
    cylinder({ name: "coat-closet-garment-bag-hook", radius: 0.012, height: 0.22, x: eastRackX, y: floorY + 2.35, z: 1.0, material: M.brass, cast: false });

    // Stock every storage tier so the closet reads as used rather than as an
    // empty wardrobe shell: hat boxes, luggage, folded scarves, and shoes.
    for (const [index, z] of [-2.2, -1.15, -0.1, 0.92].entries()) {
      cylinder({ name: "coat-closet-hat-box", radius: 0.2 + (index % 2) * 0.035, height: 0.2, segments: 18, x: westRackX, y: floorY + 2.62, z, material: index % 2 ? M.fabric : M.velvet, cast: false });
      roundedBox({ name: "coat-closet-folded-scarf", w: 0.38, h: 0.12, d: 0.42, radius: 0.025, x: eastRackX, y: floorY + 2.58, z, material: index % 2 ? M.greenRug : M.redRug, cast: false });
    }
    for (const [sideIndex, x] of [westRackX + 0.08, eastRackX - 0.08].entries()) {
      for (const [index, z] of [-2.15, -1.25, -0.35, 0.55].entries()) {
        for (const pairSide of [-1, 1]) roundedBox({ name: "coat-closet-shoe", w: 0.3, h: 0.14, d: 0.16, radius: 0.035, x: x + (sideIndex ? -0.04 : 0.04), y: floorY + 0.39, z: z + pairSide * 0.12, material: index % 2 ? M.leather : M.blackWood, cast: false });
      }
    }

    // The north wall holds the larger objects and a useful dressing bench.
    box({ name: "coat-closet-north-storage-back", w: 3.08, h: 2.72, d: 0.08, x: COAT_CLOSET.center.x, y: floorY + 1.36, z: 1.42, material: M.blackWood, cast: true });
    for (const y of [0.55, 1.35, 2.35]) box({ name: "coat-closet-north-storage-shelf", w: 3.02, h: 0.075, d: 0.48, x: COAT_CLOSET.center.x, y: floorY + y, z: 1.2, material: M.darkWood, cast: true });
    for (const x of [-14.25, -13.25, -12.25]) box({ name: "coat-closet-north-cubby-divider", w: 0.06, h: 2.4, d: 0.47, x, y: floorY + 1.52, z: 1.2, material: M.darkWood, cast: true });
    roundedBox({ name: "coat-closet-luggage-large", w: 0.78, h: 0.55, d: 0.38, radius: 0.055, x: -13.76, y: floorY + 0.88, z: 1.14, material: M.leather, cast: true });
    roundedBox({ name: "coat-closet-luggage-small", w: 0.62, h: 0.42, d: 0.36, radius: 0.05, x: -12.7, y: floorY + 0.82, z: 1.14, material: M.velvet, cast: true });
    for (const x of [-13.76, -12.7]) cylinder({ name: "coat-closet-luggage-handle", radius: 0.025, height: 0.32, x, y: floorY + 1.25, z: 1.14, rotationZ: Math.PI / 2, material: M.brass, cast: false });
    box({ name: "coat-closet-dressing-bench", w: 1.22, h: 0.42, d: 0.5, x: -13.25, y: floorY + 0.21, z: 0.89, material: M.darkWood, collider: true, cast: true });
    roundedBox({ name: "coat-closet-bench-cushion", w: 1.12, h: 0.14, d: 0.45, radius: 0.04, x: -13.25, y: floorY + 0.49, z: 0.89, material: M.velvet, cast: false });
    cylinder({ name: "coat-closet-umbrella-stand", radius: 0.21, radiusTop: 0.19, radiusBottom: 0.23, height: 0.58, segments: 18, x: -12.02, y: floorY + 0.29, z: 0.78, material: M.brass, cast: true });
    for (const [index, offset] of [-0.12, 0, 0.12].entries()) {
      cylinder({ name: "coat-closet-umbrella", radius: 0.022, height: 1.22 + index * 0.08, x: -12.02 + offset, y: floorY + 0.86, z: 0.78 + (index - 1) * 0.05, rotationZ: (index - 1) * 0.06, material: index === 1 ? M.darkWood : M.iron, cast: false });
      sphere({ name: "coat-closet-umbrella-handle", radius: 0.06, x: -12.02 + offset + (index - 1) * 0.04, y: floorY + 1.5 + index * 0.04, z: 0.78 + (index - 1) * 0.05, material: M.darkWood, cast: false });
    }

    new HidingSpot({
      name: "coat closet",
      targets: [westCoats[8], westCoats[9], westCoats[10], westCoats[11], garmentBag],
      floorY,
      hidePosition: COAT_CLOSET.hidePosition,
      exitPosition: COAT_CLOSET.exitPosition,
    });
  }

  function addTowelRail(x, y, z, rotationY, floorY) {
    const nx = Math.sin(rotationY);
    const nz = Math.cos(rotationY);
    const rail = new THREE.Group();
    rail.position.set(x, floorY + y, z);
    rail.rotation.y = rotationY;
    scene.add(rail);
    cylinder({ name: "bath-towel-rail", radius: 0.025, height: 0.72, x: 0, y: 0, z: 0.08, rotationZ: Math.PI / 2, material: M.brass, parent: rail, cast: false });
    roundedBox({ name: "folded-bath-towel", w: 0.55, h: 0.58, d: 0.045, radius: 0.025, x: 0, y: -0.27, z: 0.11, material: M.fabric, parent: rail, cast: false });
    return { nx, nz };
  }

  function addDoubleVanityBase(label, x, z, floorY, width) {
    const vanity = new Cabinet({ name: `${label} double vanity`, x, z, floorY, width, height: 0.84, depth: 0.58, rotationY: 0, material: M.darkWood });
    vanity.root.traverse((object) => { if (object.isMesh) object.castShadow = false; });
    roundedBox({ name: `${label}-vanity-marble-countertop`, w: width + 0.12, h: 0.07, d: 0.68, radius: 0.035, x, y: floorY + 0.875, z, material: M.marble, cast: false });
    const sinkXs = [x - width * 0.23, x + width * 0.23];
    for (const sinkX of sinkXs) {
      const basin = new THREE.Mesh(geometry("bathroomVesselBasinShell", () => new THREE.LatheGeometry([
        new THREE.Vector2(0.17, 0),
        new THREE.Vector2(0.27, 0.03),
        new THREE.Vector2(0.32, 0.1),
        new THREE.Vector2(0.33, 0.13),
        new THREE.Vector2(0.28, 0.14),
        new THREE.Vector2(0.22, 0.1),
        new THREE.Vector2(0.11, 0.025),
        new THREE.Vector2(0, 0.025),
      ], 28)), M.porcelain);
      basin.name = `${label}-hollow-porcelain-basin`;
      basin.scale.set(1, 1, 0.8);
      basin.position.set(sinkX, floorY + 0.89, z + 0.03);
      basin.castShadow = false;
      basin.receiveShadow = true;
      scene.add(basin);
      const basinFloor = new THREE.Mesh(geometry("bathroomVesselBasinFloor", () => new THREE.CylinderGeometry(0.115, 0.115, 0.012, 24)), M.porcelain);
      basinFloor.name = `${label}-porcelain-basin-floor`;
      basinFloor.scale.z = 0.8;
      basinFloor.position.set(sinkX, floorY + 0.92, z + 0.03);
      basinFloor.castShadow = false;
      basinFloor.receiveShadow = false;
      scene.add(basinFloor);
      cylinder({ name: `${label}-basin-drain`, radius: 0.045, height: 0.008, segments: 16, x: sinkX, y: floorY + 0.93, z: z + 0.03, material: M.brass, cast: false, receive: false });
      cylinder({ name: `${label}-faucet-deck-collar`, radius: 0.06, height: 0.035, segments: 18, x: sinkX, y: floorY + 0.935, z: z - 0.18, material: M.brass, cast: false });
      cylinder({ name: `${label}-faucet-riser`, radius: 0.024, height: 0.29, x: sinkX, y: floorY + 1.08, z: z - 0.18, material: M.brass, cast: false });
      sphere({ name: `${label}-faucet-elbow`, radius: 0.042, x: sinkX, y: floorY + 1.225, z: z - 0.18, material: M.brass, cast: false });
      cylinder({ name: `${label}-faucet-spout`, radius: 0.021, height: 0.32, x: sinkX, y: floorY + 1.225, z: z - 0.03, rotationX: Math.PI / 2, material: M.brass, cast: false });
      cylinder({ name: `${label}-faucet-nozzle`, radius: 0.026, height: 0.12, x: sinkX, y: floorY + 1.165, z: z + 0.13, material: M.brass, cast: false });
      addWallMirror("x", -3.2, sinkX, floorY, 2.0, 1, 0.92, 1.18);
    }
    return sinkXs;
  }

  function addWalkInShower(label, x, z, floorY) {
    box({ name: `${label}-shower-marble-pan`, w: 1.5, h: 0.08, d: 1.45, x, y: floorY + 0.04, z, material: M.marble, cast: false });
    box({ name: `${label}-shower-glass-west`, w: 0.035, h: 2.25, d: 1.45, x: x - 0.74, y: floorY + 1.13, z, material: M.glass, cast: false });
    box({ name: `${label}-shower-glass-south`, w: 0.92, h: 2.25, d: 0.035, x: x - 0.28, y: floorY + 1.13, z: z - 0.71, material: M.glass, cast: false });
    cylinder({ name: `${label}-shower-wall-backplate`, radius: 0.13, height: 0.04, segments: 20, x, y: floorY + 1.22, z: z + 0.73, rotationX: Math.PI / 2, material: M.brass, cast: false });
    cylinder({ name: `${label}-shower-riser`, radius: 0.028, height: 1.2, x, y: floorY + 1.62, z: z + 0.7, material: M.brass, cast: false });
    sphere({ name: `${label}-shower-elbow`, radius: 0.05, x, y: floorY + 2.22, z: z + 0.7, material: M.brass, cast: false });
    cylinder({ name: `${label}-shower-arm`, radius: 0.028, height: 0.38, x, y: floorY + 2.22, z: z + 0.51, rotationX: Math.PI / 2, material: M.brass, cast: false });
    cylinder({ name: `${label}-shower-head`, radius: 0.19, radiusTop: 0.11, radiusBottom: 0.22, height: 0.08, segments: 20, x, y: floorY + 2.18, z: z + 0.31, material: M.brass, cast: false });
    return { x, y: floorY + 2.12, z: z + 0.31, handleOffset: { x: 0.23, y: -0.9, z: 0.4 } };
  }

  function furnishMainHallBathroom() {
    box({ name: "main-hall-bathroom-marble-floor", w: 6.35, h: 0.045, d: 6.15, x: -8.25, y: FLOOR.MAIN + 0.024, z: 0, material: M.marble, cast: false, receive: true });
    box({ name: "main-hall-bathroom-north-annex-floor", w: 3.35, h: 0.045, d: 1.5, x: -13.25, y: FLOOR.MAIN + 0.024, z: 2.38, material: M.marble, cast: false, receive: true });
    const sinkXs = addDoubleVanityBase("main hall bathroom", -7.3, -2.65, FLOOR.MAIN, 2.55);
    for (const [index, sinkX] of sinkXs.entries()) {
      new WaterFixture({ name: `main hall bathroom sink ${index + 1}`, kind: "sink", x: sinkX, y: FLOOR.MAIN + 1.105, z: -2.52, drop: 0.165 });
    }
    const toilet = addToilet("main hall bathroom toilet", -10.65, 0.05, FLOOR.MAIN, -Math.PI / 2);
    toilet.traverse((object) => { if (object.isMesh) object.castShadow = false; });
    const tub = addBathtub(-6.85, 2.05, FLOOR.MAIN, Math.PI / 2);
    tub.traverse((object) => { if (object.isMesh) object.castShadow = false; });
    new WaterFixture({ name: "main hall bathtub tap", kind: "tub", x: -0.05, y: 0.82, z: 0.66, drop: 0.34, parent: tub });
    const shower = addWalkInShower("main-hall-bathroom", -13.55, 2.28, FLOOR.MAIN);
    new WaterFixture({ name: "main hall shower", kind: "shower", x: shower.x, y: shower.y, z: shower.z, drop: 1.66, handleOffset: shower.handleOffset });
    addTowelRail(-5.2, 1.35, 2.0, -Math.PI / 2, FLOOR.MAIN);
  }

  function furnishUpperGrandBathroom() {
    box({ name: "upper-grand-bathroom-marble-floor", w: 9.7, h: 0.045, d: 6.15, x: -10, y: FLOOR.UPPER + 0.024, z: 0, material: M.marble, cast: false, receive: true });
    const sinkXs = addDoubleVanityBase("upper grand bathroom", -8.15, -2.65, FLOOR.UPPER, 2.65);
    for (const [index, sinkX] of sinkXs.entries()) {
      new WaterFixture({ name: `upper grand bathroom sink ${index + 1}`, kind: "sink", x: sinkX, y: FLOOR.UPPER + 1.105, z: -2.52, drop: 0.165 });
    }
    const toilet = addToilet("upper grand bathroom toilet", -13.8, 0.0, FLOOR.UPPER, -Math.PI / 2);
    toilet.traverse((object) => { if (object.isMesh) object.castShadow = false; });
    const tub = addBathtub(-6.85, 2.05, FLOOR.UPPER, Math.PI / 2);
    tub.traverse((object) => { if (object.isMesh) object.castShadow = false; });
    new WaterFixture({ name: "upper grand bathtub tap", kind: "tub", x: -0.05, y: 0.82, z: 0.66, drop: 0.34, parent: tub });
    const shower = addWalkInShower("upper-grand-bathroom", -13.55, 2.28, FLOOR.UPPER);
    new WaterFixture({ name: "upper grand shower", kind: "shower", x: shower.x, y: shower.y, z: shower.z, drop: 1.66, handleOffset: shower.handleOffset });
    addTowelRail(-5.2, 1.35, 2.0, -Math.PI / 2, FLOOR.UPPER);
  }

  function addBookshelf(x, z, floorY, rotationY, width, height) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    const w = width || 2.3;
    const h = height || 2.75;
    box({ name: "bookcase-back", w, h, d: 0.18, x: 0, y: h / 2, z: 0.18, material: M.blackWood, parent: group });
    for (const sx of [-1, 1]) box({ name: "bookcase-side", w: 0.14, h: h + 0.1, d: 0.44, x: sx * (w / 2 - 0.07), y: h / 2, z: 0, material: M.darkWood, parent: group });
    const bookTransforms = M.bookPalette.map(() => []);
    for (let shelf = 0; shelf < 5; shelf += 1) {
      const sy = 0.14 + shelf * (h - 0.25) / 4;
      box({ name: "bookcase-shelf", w: w - 0.12, h: 0.09, d: 0.46, x: 0, y: sy, z: 0, material: M.darkWood, parent: group });
      if (shelf < 4) {
        const count = Math.floor(w / 0.16);
        for (let i = 0; i < count; i += 1) {
          bookTransforms[(i + shelf * 2) % M.bookPalette.length].push({
            x: -w / 2 + 0.2 + i * (w - 0.36) / count,
            y: sy + 0.245,
            z: -0.02,
            w: 0.105 + (i % 3) * 0.018,
            h: 0.38 + ((i + shelf) % 4) * 0.035,
          });
        }
      }
    }
    const dummy = new THREE.Object3D();
    bookTransforms.forEach((transforms, paletteIndex) => {
      if (!transforms.length) return;
      const books = new THREE.InstancedMesh(geometry("unitBox", () => new THREE.BoxGeometry(1, 1, 1)), M.bookPalette[paletteIndex], transforms.length);
      books.name = "instanced-aged-books";
      books.castShadow = false;
      books.receiveShadow = true;
      transforms.forEach((entry, index) => {
        dummy.position.set(entry.x, entry.y, entry.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(entry.w, entry.h, 0.27);
        dummy.updateMatrix();
        books.setMatrixAt(index, dummy.matrix);
      });
      books.instanceMatrix.needsUpdate = true;
      group.add(books);
    });
    const cw = Math.abs(Math.cos(rotationY || 0)) * w + Math.abs(Math.sin(rotationY || 0)) * 0.52;
    const cd = Math.abs(Math.sin(rotationY || 0)) * w + Math.abs(Math.cos(rotationY || 0)) * 0.52;
    physics.addFixedBox(x, floorY + h / 2, z, cw, h, cd, 0);
    return group;
  }

  function addArchiveCurio(parent, name, kind, shelfY, faceZ) {
    const curio = new THREE.Group();
    curio.name = `${name}-${kind}`;
    curio.position.set(0, shelfY, faceZ);
    parent.add(curio);

    if (kind === "skull") {
      const cranium = sphere({ name: "archive-curio-skull-cranium", radius: 0.18, y: 0.28, z: 0.005, material: M.porcelain, parent: curio });
      cranium.scale.set(0.92, 1.08, 0.82);
      for (const x of [-0.062, 0.062]) {
        const socket = sphere({ name: "archive-curio-skull-eye-socket", radius: 0.052, x, y: 0.29, z: 0.132, material: M.soot, parent: curio, cast: false });
        socket.scale.set(1, 0.82, 0.45);
      }
      const nose = sphere({ name: "archive-curio-skull-nose-cavity", radius: 0.036, y: 0.22, z: 0.151, material: M.soot, parent: curio, cast: false });
      nose.scale.set(0.7, 1.05, 0.42);
      roundedBox({ name: "archive-curio-skull-jaw", w: 0.22, h: 0.12, d: 0.13, radius: 0.035, y: 0.105, z: 0.035, material: M.porcelain, parent: curio });
      for (const x of [-0.066, -0.022, 0.022, 0.066]) {
        box({ name: "archive-curio-skull-tooth", w: 0.031, h: 0.06, d: 0.018, x, y: 0.115, z: 0.108, material: M.canvasLinen, parent: curio, cast: false });
      }
    } else if (kind === "specimen-jar") {
      cylinder({ name: "archive-curio-specimen-jar-glass", radius: 0.14, height: 0.38, segments: 18, y: 0.21, material: M.glass, parent: curio, cast: false });
      sphere({ name: "archive-curio-specimen-jar-object", radius: 0.075, y: 0.2, material: M.porcelain, parent: curio, cast: false });
      cylinder({ name: "archive-curio-specimen-jar-lid", radius: 0.15, height: 0.055, segments: 18, y: 0.425, material: M.brass, parent: curio, cast: false });
    } else if (kind === "reel-to-reel") {
      const deck = box({ name: "archive-curio-reel-to-reel-deck", w: 0.48, h: 0.34, d: 0.12, y: 0.19, material: M.blackWood, parent: curio, cast: false });
      const indicatorMaterial = new THREE.MeshStandardMaterial({ color: 0x352d20, emissive: 0x160c04, emissiveIntensity: 0.15, metalness: 0.3, roughness: 0.46 });
      const indicator = sphere({ name: "archive-curio-reel-to-reel-played-indicator", radius: 0.035, x: 0.19, y: 0.09, z: 0.075, material: indicatorMaterial, parent: curio, cast: false });
      indicator.userData.active = false;
      contestant13Scene.archiveRecorderRoot = curio;
      contestant13Scene.archiveRecorderDeck = deck;
      contestant13Scene.archiveRecorderIndicator = indicator;
      contestant13Scene.archiveRecorderIndicatorMaterial = indicatorMaterial;
      for (const x of [-0.135, 0.135]) {
        cylinder({ name: "archive-curio-reel-to-reel-spool", radius: 0.11, height: 0.03, segments: 20, x, y: 0.23, z: 0.075, rotationX: Math.PI / 2, material: M.brass, parent: curio, cast: false });
        cylinder({ name: "archive-curio-reel-to-reel-hub", radius: 0.035, height: 0.038, segments: 14, x, y: 0.23, z: 0.094, rotationX: Math.PI / 2, material: M.iron, parent: curio, cast: false });
      }
    } else {
      roundedBox({ name: "archive-curio-sealed-ledger", w: 0.5, h: 0.11, d: 0.34, radius: 0.025, y: 0.075, material: M.leather, parent: curio, cast: false });
      box({ name: "archive-curio-sealed-ledger-clasp", w: 0.08, h: 0.125, d: 0.36, y: 0.082, material: M.brass, parent: curio, cast: false });
    }
  }

  function addArchiveShelfBank({ name, x, z, floorY, rotationY = 0, width = 2.3, height = 3.05, depth = 0.72, seed = 0, curio = null }) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY;
    group.userData = { freestanding: true, doubleSided: true, contents: ["documents", "books", "tapes"], curio };
    scene.add(group);

    const shelfYs = Array.from({ length: 5 }, (_, index) => 0.12 + index * (height - 0.24) / 4);
    for (const sideX of [-1, 1]) {
      box({ name: `${name}-upright`, w: 0.13, h: height, d: depth, x: sideX * (width / 2 - 0.065), y: height / 2, material: M.blackWood, parent: group });
      box({ name: `${name}-brass-foot`, w: 0.19, h: 0.08, d: depth + 0.08, x: sideX * (width / 2 - 0.065), y: 0.04, material: M.brass, parent: group, cast: false });
    }
    shelfYs.forEach((y, index) => {
      box({ name: `${name}-shelf-${index + 1}`, w: width, h: 0.085, d: depth, y, material: M.darkWood, parent: group });
    });
    box({ name: `${name}-top-rail`, w: width + 0.08, h: 0.12, d: depth + 0.06, y: height - 0.04, material: M.blackWood, parent: group });

    const bookBatches = M.bookPalette.map(() => []);
    const documentMaterials = [M.canvasLinen, M.agedTrim, M.leather];
    const documentBatches = documentMaterials.map(() => []);
    const documentLabels = [];
    const tapeMaterials = [M.iron, M.copper, M.blackWood];
    const tapeBatches = tapeMaterials.map(() => []);
    const contentWidth = width - 0.32;
    for (const [faceIndex, face] of [-1, 1].entries()) {
      for (let shelfIndex = 0; shelfIndex < 4; shelfIndex += 1) {
        if (curio && face === 1 && shelfIndex === 2) continue;
        const shelfTop = shelfYs[shelfIndex] + 0.045;
        const kind = (seed + shelfIndex + faceIndex) % 3;
        if (kind === 0) {
          const count = Math.max(8, Math.floor(contentWidth / 0.15));
          for (let i = 0; i < count; i += 1) {
            const bookHeight = 0.39 + ((i + seed + shelfIndex) % 4) * 0.035;
            bookBatches[(i + shelfIndex + seed) % bookBatches.length].push({
              x: -contentWidth / 2 + (i + 0.5) * contentWidth / count,
              y: shelfTop + bookHeight / 2,
              z: face * 0.225,
              sx: 0.105 + (i % 3) * 0.012,
              sy: bookHeight,
              sz: 0.245,
              rz: (i % 7 === 0 ? face * 0.045 : 0),
            });
          }
        } else if (kind === 1) {
          const count = Math.max(5, Math.floor(contentWidth / 0.3));
          for (let i = 0; i < count; i += 1) {
            const boxWidth = contentWidth / count - 0.035;
            const documentHeight = 0.42 + ((i + seed) % 2) * 0.055;
            const entryX = -contentWidth / 2 + (i + 0.5) * contentWidth / count;
            documentBatches[(i + shelfIndex + seed) % documentBatches.length].push({ x: entryX, y: shelfTop + documentHeight / 2, z: face * 0.225, sx: boxWidth, sy: documentHeight, sz: 0.22 });
            documentLabels.push({ x: entryX, y: shelfTop + documentHeight * 0.58, z: face * 0.339, sx: Math.min(0.095, boxWidth * 0.55), sy: 0.075, sz: 0.012 });
          }
        } else {
          const count = Math.max(7, Math.floor(contentWidth / 0.19));
          for (let i = 0; i < count; i += 1) {
            const tapeHeight = 0.31 + ((i + shelfIndex) % 3) * 0.025;
            tapeBatches[(i + seed) % tapeBatches.length].push({
              x: -contentWidth / 2 + (i + 0.5) * contentWidth / count,
              y: shelfTop + tapeHeight / 2,
              z: face * 0.245,
              sx: contentWidth / count - 0.035,
              sy: tapeHeight,
              sz: 0.17,
            });
          }
        }
      }
    }

    bookBatches.forEach((transforms, index) => addLocalInstanceBatch(`${name}-archive-books-${index + 1}`, group, "unitBox", () => new THREE.BoxGeometry(1, 1, 1), M.bookPalette[index], transforms));
    documentBatches.forEach((transforms, index) => addLocalInstanceBatch(`${name}-archive-documents-${index + 1}`, group, "unitBox", () => new THREE.BoxGeometry(1, 1, 1), documentMaterials[index], transforms));
    addLocalInstanceBatch(`${name}-archive-document-labels`, group, "unitBox", () => new THREE.BoxGeometry(1, 1, 1), M.brass, documentLabels);
    tapeBatches.forEach((transforms, index) => addLocalInstanceBatch(`${name}-archive-tapes-${index + 1}`, group, "unitBox", () => new THREE.BoxGeometry(1, 1, 1), tapeMaterials[index], transforms));

    if (curio) addArchiveCurio(group, name, curio, shelfYs[2] + 0.045, 0.255);
    const worldWidth = Math.abs(Math.cos(rotationY)) * width + Math.abs(Math.sin(rotationY)) * depth;
    const worldDepth = Math.abs(Math.sin(rotationY)) * width + Math.abs(Math.cos(rotationY)) * depth;
    physics.addFixedBox(x, floorY + height / 2, z, worldWidth, height, worldDepth, 0);
    return group;
  }

  class Fireplace {
    constructor(options) {
      const { name, x, z, floorY, rotationY = 0 } = options;
      this.name = name;
      this.on = true;
      this.level = 1;
      this.phase = Math.random() * Math.PI * 2;
      this.floorLabel = floorY === FLOOR.UPPER ? "SECOND FLOOR" : floorY === FLOOR.BASEMENT ? "BASEMENT" : "MAIN LEVEL";
      this.root = new THREE.Group();
      this.root.name = name;
      this.root.position.set(x, floorY, z);
      this.root.rotation.y = rotationY;
      scene.add(this.root);

      box({ name: `${name}-hearth`, w: 2.3, h: 0.16, d: 0.74, x: 0, y: 0.08, z: -0.16, material: M.marble, parent: this.root });
      box({ name: `${name}-surround`, w: 2.05, h: 2.28, d: 0.38, x: 0, y: 1.15, z: 0.06, material: M.marble, parent: this.root });
      const opening = box({ name: `${name}-opening`, w: 1.18, h: 1.28, d: 0.41, x: 0, y: 0.72, z: -0.17, material: M.soot, parent: this.root, cast: false });
      box({ name: `${name}-mantle`, w: 2.55, h: 0.22, d: 0.63, x: 0, y: 2.19, z: -0.04, material: M.marble, parent: this.root });
      for (const sx of [-0.82, 0.82]) cylinder({ name: `${name}-mantle-column`, radius: 0.15, radiusTop: 0.13, radiusBottom: 0.18, height: 1.8, segments: 14, x: sx, y: 1.05, z: -0.18, material: M.marble, parent: this.root });
      for (const lx of [-0.33, 0, 0.33]) cylinder({ name: `${name}-hearth-log`, radius: 0.075, height: 0.72, segments: 8, x: lx, y: 0.22, z: -0.38, rotationZ: Math.PI / 2, material: M.blackWood, parent: this.root, cast: false });

      this.glowMaterial = M.fireGlow.clone();
      this.glow = plane({ name: `${name}-fire-glow`, w: 1.02, h: 1.05, x: 0, y: 0.66, z: -0.395, rotationX: 0, material: this.glowMaterial, parent: this.root });
      this.glow.userData.fireplaceEffect = true;
      this.emberMaterial = M.fireEmber.clone();
      this.embers = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), this.emberMaterial);
      this.embers.name = `${name}-ember-bed`;
      this.embers.rotation.x = -Math.PI / 2;
      this.embers.scale.set(1, 0.48, 1);
      this.embers.position.set(0, 0.185, -0.39);
      this.embers.castShadow = false;
      this.embers.userData.fireplaceEffect = true;
      this.root.add(this.embers);

      const flameDefinitions = [
        { x: -0.36, y: 0.48, w: 0.34, h: 0.64, phase: 0.2, inner: false },
        { x: -0.14, y: 0.59, w: 0.4, h: 0.88, phase: 1.7, inner: true },
        { x: 0.12, y: 0.55, w: 0.38, h: 0.78, phase: 3.1, inner: false },
        { x: 0.35, y: 0.47, w: 0.31, h: 0.61, phase: 4.4, inner: true },
      ];
      this.flames = flameDefinitions.map((definition, index) => {
        const material = (definition.inner ? M.fireInner : M.fireOuter).clone();
        const sprite = new THREE.Sprite(material);
        sprite.name = `${name}-animated-flame-${index + 1}`;
        sprite.position.set(definition.x, definition.y, -0.43 - index * 0.003);
        sprite.scale.set(definition.w, definition.h, 1);
        sprite.userData.fireplaceEffect = true;
        this.root.add(sprite);
        return { sprite, material, ...definition };
      });

      const interaction = {
        type: "fireplace",
        getLabel: () => `${this.on ? "Extinguish" : "Light"} ${name}`,
        activate: () => this.setOn(!this.on),
      };
      addInteractionTarget(opening, interaction);
      const hitbox = box({
        name: `${name}-fire-interaction-hitbox`, w: 1.16, h: 1.24, d: 0.24,
        x: 0, y: 0.72, z: -0.46, parent: this.root,
        material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        cast: false, receive: false,
      });
      hitbox.visible = false;
      addInteractionTarget(hitbox, interaction);

      physics.addFixedBox(x, floorY + 1.1, z, 2.55, 2.2, 0.75, rotationY);
      fireplaces.push(this);
      animatedObjects.push(this);
    }

    setOn(on, silent) {
      this.on = Boolean(on);
      if (!silent && audioSystem) audioSystem.fireplace(this.on);
      return this.on;
    }

    update(dt) {
      this.phase += dt;
      this.level = ease(this.level, this.on ? 1 : 0, this.on ? 5.8 : 7.5, dt);
      const renderEffects = state.currentFloor === this.floorLabel && !interiorDetailsHidden && this.level > 0.012;
      const motion = state.reducedFlash ? 0.25 : 1;
      for (const flame of this.flames) {
        const wave = Math.sin(this.phase * 7.4 + flame.phase);
        const flutter = Math.sin(this.phase * 12.1 + flame.phase * 1.7);
        flame.sprite.visible = renderEffects;
        flame.sprite.position.y = flame.y + (wave * 0.028 + flutter * 0.012) * motion;
        flame.sprite.scale.set(
          flame.w * (0.92 + wave * 0.08 * motion) * this.level,
          flame.h * (0.88 + flutter * 0.12 * motion) * this.level,
          1,
        );
        flame.material.opacity = this.level * (flame.inner ? 0.88 : 0.72) * (0.9 + wave * 0.1 * motion);
      }
      this.glow.visible = renderEffects;
      this.embers.visible = renderEffects;
      this.glowMaterial.opacity = this.level * (0.28 + Math.sin(this.phase * 5.1) * 0.045 * motion);
      this.emberMaterial.opacity = this.level * (0.66 + Math.sin(this.phase * 8.2) * 0.12 * motion);
      this.embers.scale.x = 0.94 + Math.sin(this.phase * 4.6) * 0.04 * motion;
    }
  }

  function addFireplace(name, x, z, floorY, rotationY) {
    return new Fireplace({ name, x, z, floorY, rotationY });
  }

  function addPiano(x, z, floorY, rotationY) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    const shape = new THREE.Shape();
    shape.moveTo(-1.2, -0.72);
    shape.lineTo(1.15, -0.72);
    shape.bezierCurveTo(1.55, -0.15, 1.22, 0.75, 0.35, 0.9);
    shape.lineTo(-1.2, 0.68);
    shape.closePath();
    const lid = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }), M.blackWood);
    lid.rotation.x = Math.PI / 2;
    lid.position.y = 1.03;
    lid.castShadow = true;
    group.add(lid);
    box({ name: "piano-key-bed", w: 1.7, h: 0.18, d: 0.62, x: -0.35, y: 0.84, z: -0.74, material: M.blackWood, parent: group });
    for (let i = 0; i < 18; i += 1) box({ name: "piano-key", w: 0.078, h: 0.035, d: 0.42, x: -1.13 + i * 0.082, y: 0.95, z: -0.84, material: i % 3 === 1 ? M.iron : M.porcelain, parent: group, cast: false });
    for (const p of [[-0.95, -0.38], [0.78, -0.35], [0.32, 0.6]]) cylinder({ name: "piano-leg", radius: 0.07, radiusBottom: 0.1, height: 0.86, segments: 12, x: p[0], y: 0.43, z: p[1], material: M.blackWood, parent: group });
    physics.addFixedBox(x, floorY + 0.65, z, 2.6, 1.3, 1.8, rotationY || 0);
    group.userData.roomRole = "music-room-piano";
    return group;
  }

  function addPaintingStudio(x, z, floorY) {
    const easel = new THREE.Group();
    easel.name = "painting-room-easel";
    easel.position.set(x, floorY, z);
    const easelYaw = -2.85;
    easel.rotation.y = easelYaw;
    scene.add(easel);

    // A connected A/H-frame: the front legs converge into a central mast,
    // while the rear kickstand opens behind the painted face (local -Z).
    for (const side of [-1, 1]) {
      box({ name: "painting-room-easel-front-leg", w: 0.075, h: 1.78, d: 0.075, x: side * 0.32, y: 0.89, z: 0, rotationZ: side * 0.13, material: M.darkWood, parent: easel });
      box({ name: "painting-room-easel-front-foot", w: 0.19, h: 0.06, d: 0.28, x: side * 0.41, y: 0.03, z: 0.06, material: M.darkWood, parent: easel });
    }
    box({ name: "painting-room-easel-mast", w: 0.085, h: 2.18, d: 0.085, x: 0, y: 1.09, z: -0.05, material: M.darkWood, parent: easel });
    box({ name: "painting-room-easel-rear-leg", w: 0.075, h: 1.83, d: 0.075, x: 0, y: 0.87, z: -0.32, rotationX: 0.32, material: M.darkWood, parent: easel });
    cylinder({ name: "painting-room-easel-hinge", radius: 0.052, height: 0.74, segments: 12, x: 0, y: 1.74, z: -0.04, rotationZ: Math.PI / 2, material: M.brass, parent: easel });
    box({ name: "painting-room-easel-lower-crossbar", w: 0.82, h: 0.085, d: 0.09, x: 0, y: 0.55, z: -0.015, material: M.darkWood, parent: easel });
    box({ name: "painting-room-easel-tray", w: 1.08, h: 0.08, d: 0.25, x: 0, y: 0.75, z: 0.055, material: M.darkWood, parent: easel });
    box({ name: "painting-room-easel-tray-lip", w: 1.08, h: 0.09, d: 0.045, x: 0, y: 0.81, z: 0.16, material: M.darkWood, parent: easel });
    box({ name: "painting-room-easel-upper-clamp", w: 0.36, h: 0.13, d: 0.16, x: 0, y: 2.02, z: 0.015, material: M.darkWood, parent: easel });
    cylinder({ name: "painting-room-easel-clamp-screw", radius: 0.038, height: 0.13, segments: 12, x: 0.25, y: 2.02, z: 0.015, rotationZ: Math.PI / 2, material: M.brass, parent: easel, cast: false });

    const canvasMount = new THREE.Group();
    canvasMount.name = "painting-room-easel-canvas-mount";
    canvasMount.position.set(0, 1.385, 0.015);
    canvasMount.rotation.x = -0.07;
    easel.add(canvasMount);
    box({ name: "painting-room-unfinished-linen", w: 0.96, h: 1.2, d: 0.055, x: 0, y: 0, z: 0, material: M.canvasLinen, parent: canvasMount });
    box({ name: "painting-room-easel-canvas-back", w: 0.9, h: 1.14, d: 0.018, x: 0, y: 0, z: -0.036, material: M.canvasLinen, parent: canvasMount, cast: false });
    for (const yOffset of [-0.42, 0.42]) {
      box({ name: "painting-room-easel-stretcher-horizontal", w: 0.78, h: 0.052, d: 0.055, x: 0, y: yOffset, z: -0.068, material: M.darkWood, parent: canvasMount });
    }
    box({ name: "painting-room-easel-stretcher-vertical", w: 0.052, h: 0.96, d: 0.055, x: 0, y: 0, z: -0.068, material: M.darkWood, parent: canvasMount });
    for (const side of [-1, 1]) {
      box({ name: "painting-room-easel-rear-brace", w: 0.045, h: 0.74, d: 0.045, x: side * 0.22, y: 0, z: -0.101, rotationZ: side * 0.55, material: M.darkWood, parent: canvasMount });
    }

    const artId = "work-in-progress-dreaming";
    const { artTexture, artwork, material: artMaterial } = createArtworkMaterial(artId, 0.9 / 1.14, null, "painting room lights", 0x9f896a);
    const artPanel = box({ name: "painting-room-easel-art", w: 0.9, h: 1.14, d: 0.008, x: 0, y: 0, z: 0.043, material: artMaterial, parent: canvasMount, cast: false });
    artPanel.userData.artId = artId;
    artPanel.userData.title = artwork ? artwork.title : "Unfinished canvas";
    artPanel.userData.generatedArtwork = Boolean(artTexture);
    for (const stroke of [
      [-0.32, 0.3, 0.18, 0.022, -0.22, M.terracotta],
      [0.27, -0.32, 0.24, 0.018, 0.16, M.velvet],
      [0.23, 0.43, 0.15, 0.02, -0.34, M.greenRug],
    ]) {
      box({ name: "painting-room-easel-wet-paint", w: stroke[2], h: stroke[3], d: 0.009, x: stroke[0], y: stroke[1], z: 0.054, rotationZ: stroke[4], material: stroke[5], parent: canvasMount, cast: false });
    }
    physics.addFixedBox(x, floorY + 0.9, z, 0.92, 1.8, 0.9, easelYaw);

    const chairX = x - 0.35;
    const chairZ = z - 1.25;
    const chair = addChair(chairX, chairZ, floorY, faceTargetYaw(chairX, chairZ, x, z), M.darkWood);
    chair.name = "painting-room-chair";
    chair.userData.faces = "painting-room-easel";

    const cart = addTable(x + 0.2, z - 2.85, 1.02, 0.48, floorY, 0, M.darkWood);
    cart.name = "painting-room-paint-cart";
    for (const [index, cx] of [-0.3, -0.08, 0.15, 0.34].entries()) {
      cylinder({ name: "painting-room-paint-pot", radius: 0.07, radiusTop: 0.065, radiusBottom: 0.075, height: 0.16, segments: 12, x: cx, y: 0.94, z: 0, material: [M.velvet, M.greenRug, M.terracotta, M.roseMauve][index], parent: cart, cast: false });
    }
    const palette = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), M.darkWood);
    palette.name = "painting-room-palette";
    palette.scale.set(0.32, 0.055, 0.23);
    palette.position.set(0.05, 0.94, -0.02);
    cart.add(palette);
    for (const bx of [-0.12, 0, 0.12]) cylinder({ name: "painting-room-brush", radius: 0.012, height: 0.55, segments: 8, x: bx, y: 1.05, z: 0.08, rotationZ: 0.28 + bx, material: M.brass, parent: cart, cast: false });
    return { easel, chair, cart };
  }

  function addKitchenRange(x, z, floorY, rotationY) {
    const group = new THREE.Group();
    group.name = "kitchen-oven-range";
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    box({ name: "kitchen-range-body", w: 1.45, h: 0.88, d: 0.72, x: 0, y: 0.44, z: 0, material: M.enamel, parent: group });
    box({ name: "kitchen-range-cooktop", w: 1.48, h: 0.07, d: 0.75, x: 0, y: 0.915, z: 0, material: M.iron, parent: group });
    box({ name: "kitchen-oven-door", w: 1.14, h: 0.52, d: 0.065, x: 0, y: 0.42, z: -0.395, material: M.iron, parent: group });
    box({ name: "kitchen-oven-window", w: 0.88, h: 0.31, d: 0.018, x: 0, y: 0.43, z: -0.435, material: M.glass, parent: group, cast: false });
    cylinder({ name: "kitchen-oven-handle", radius: 0.027, height: 0.92, x: 0, y: 0.7, z: -0.465, rotationZ: Math.PI / 2, material: M.brass, parent: group, cast: false });
    for (const sx of [-0.45, -0.15, 0.15, 0.45]) cylinder({ name: "kitchen-range-knob", radius: 0.055, height: 0.08, segments: 12, x: sx, y: 0.8, z: -0.44, rotationX: Math.PI / 2, material: M.brass, parent: group });
    for (const sx of [-0.4, 0.4]) for (const sz of [-0.2, 0.2]) {
      const burner = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 7, 18), M.iron);
      burner.name = "kitchen-range-burner";
      burner.position.set(sx, 0.965, sz);
      burner.rotation.x = Math.PI / 2;
      group.add(burner);
    }
    // The hood, flue, and splash panel form one connected vertical composition
    // between the shorter east-wall windows.
    box({ name: "kitchen-range-backsplash", w: 1.62, h: 0.74, d: 0.045, x: 0, y: 1.35, z: 0.37, material: M.marble, parent: group, cast: false, receive: true });
    box({ name: "kitchen-range-hood-canopy", w: 1.68, h: 0.2, d: 0.64, x: 0, y: 1.82, z: 0.08, material: M.iron, parent: group });
    box({ name: "kitchen-range-hood-flue", w: 0.62, h: 1.48, d: 0.3, x: 0, y: 2.56, z: 0.24, material: M.iron, parent: group });
    for (const sx of [-0.42, 0.42]) {
      const taskMaterial = new THREE.MeshStandardMaterial({ color: 0xffe1ae, emissive: 0xffa957, emissiveIntensity: 1.15, roughness: 0.28 });
      const taskBulb = box({ name: "kitchen-range-hood-task-light", w: 0.34, h: 0.028, d: 0.16, x: sx, y: 1.705, z: -0.08, material: taskMaterial, parent: group, cast: false, receive: false });
      taskBulb.userData.onEmissiveIntensity = 1.15;
      kitchenTaskBulbs.push(taskBulb);
    }
    physics.addFixedBox(x, floorY + 0.46, z, 1.45, 0.92, 0.75, rotationY || 0);
    return group;
  }

  function addKitchenBaseCabinet(options) {
    const cabinet = new Cabinet({
      ...options,
      material: M.darkWood,
      depth: options.depth || 0.68,
      openAngle: 88,
    });
    const depth = options.depth || 0.68;
    const height = options.height;
    box({ name: `${options.name}-integrated-toe-kick`, w: options.width * 0.9, h: 0.085, d: 0.04, x: 0, y: 0.075, z: depth / 2 + 0.022, material: M.brass, parent: cabinet.root, cast: false });
    box({ name: `${options.name}-counter-shadow-line`, w: options.width * 0.94, h: 0.035, d: 0.035, x: 0, y: height - 0.035, z: depth / 2 + 0.025, material: M.blackWood, parent: cabinet.root, cast: false });
    return cabinet;
  }

  const KITCHEN_LAYOUT = Object.freeze({
    counterCenterY: 0.93,
    counterTop: 0.98,
    counterThickness: 0.1,
    counterDepth: 0.78,
    innerCounterEnd: -9.7,
    sinkX: 9.65,
    sinkZ: -11.43,
    rangeX: 14.48,
    rangeZ: -8.35,
    refrigeratorX: 14.43,
    refrigeratorZ: -4.04,
  });

  function addKitchenLightingFixtures(circuit) {
    const ceilingY = FLOOR.MAIN + 3.72;
    const pendantZ = -7.8;
    for (const [index, x] of [7.9, 12.1].entries()) {
      cylinder({ name: `kitchen-pendant-${index + 1}-canopy`, radius: 0.18, radiusTop: 0.13, radiusBottom: 0.2, height: 0.11, segments: 20, x, y: ceilingY - 0.08, z: pendantZ, material: M.brass, cast: false });
      cylinder({ name: `kitchen-pendant-${index + 1}-chain`, radius: 0.014, height: 0.67, segments: 10, x, y: ceilingY - 0.43, z: pendantZ, material: M.brass, cast: false });
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.34, 0.3, 24, 1, true), M.frostedShade);
      shade.name = `kitchen-pendant-${index + 1}-shade`;
      shade.position.set(x, ceilingY - 0.82, pendantZ);
      shade.castShadow = false;
      scene.add(shade);
      const shadeRim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.018, 7, 28), M.brass);
      shadeRim.name = `kitchen-pendant-${index + 1}-shade-rim`;
      shadeRim.position.set(x, ceilingY - 0.97, pendantZ);
      shadeRim.rotation.x = Math.PI / 2;
      shadeRim.castShadow = false;
      scene.add(shadeRim);
      const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffe1ad, emissive: 0xffa34f, emissiveIntensity: circuit.on ? 1.3 : 0, roughness: 0.25 });
      const bulb = sphere({ name: `kitchen-pendant-${index + 1}-bulb`, radius: 0.085, x, y: ceilingY - 0.91, z: pendantZ, material: bulbMaterial, cast: false });
      bulb.userData.onEmissiveIntensity = 1.3;
      bulb.userData.levels = new Set(circuit.levels);
      circuit.bulbs.push(bulb);
      circuit.addCeilingResponseGlow(x, ceilingY - 0.01, pendantZ, 1.35, 0.16);
      circuit.addSourceHalo(x, ceilingY - 0.91, pendantZ, 0.92, 0.18);
    }
    for (const bulb of kitchenTaskBulbs) {
      bulb.userData.levels = new Set(circuit.levels);
      circuit.bulbs.push(bulb);
    }
    // Both pendants share one stronger bounded emitter. This adds visible
    // lighting and brighter counter coverage without increasing the mansion's
    // fixed eleven-PointLight shader layout.
    const light = circuit.addRoomOmniLight(10, FLOOR.MAIN + 2.72, pendantZ, 76, 7.3, ["MAIN LEVEL"]);
    light.name = "kitchen-pendant-pair-room-bounded-omnilight";
    light.userData.fixtureStyle = "paired-pendants";
    light.userData.fixtureRole = "primary";
    light.userData.visibleFixtureEmitter = true;
    return light;
  }

  function addRemodeledKitchen() {
    const cabinetHeight = 0.88;
    const { counterCenterY, counterThickness, counterDepth, sinkX, sinkZ } = KITCHEN_LAYOUT;

    // Interactive dark-oak bases share one datum under every work surface.
    addKitchenBaseCabinet({ name: "kitchen inner food cabinet", x: 5.52, z: -10.35, floorY: FLOOR.MAIN, width: 1.25, height: cabinetHeight, rotationY: Math.PI / 2, stockKind: "food" });
    addKitchenBaseCabinet({ name: "kitchen rear west cabinet", x: 6.55, z: -11.43, floorY: FLOOR.MAIN, width: 1.2, height: cabinetHeight, rotationY: 0 });
    addKitchenBaseCabinet({ name: "kitchen rear prep cabinet", x: 7.77, z: -11.43, floorY: FLOOR.MAIN, width: 1.18, height: cabinetHeight, rotationY: 0 });
    addKitchenBaseCabinet({ name: "kitchen sink base cabinet", x: sinkX, z: sinkZ, floorY: FLOOR.MAIN, width: 1.7, height: cabinetHeight, rotationY: 0 });
    addKitchenBaseCabinet({ name: "kitchen rear drawer cabinet", x: 11.35, z: -11.43, floorY: FLOOR.MAIN, width: 1.65, height: cabinetHeight, rotationY: 0 });
    addKitchenBaseCabinet({ name: "kitchen rear dish cabinet", x: 13.1, z: -11.43, floorY: FLOOR.MAIN, width: 1.8, height: cabinetHeight, rotationY: 0, stockKind: "dishes" });
    addKitchenBaseCabinet({ name: "kitchen east rear cabinet", x: 14.48, z: -10.05, floorY: FLOOR.MAIN, width: 1.85, height: cabinetHeight, rotationY: -Math.PI / 2 });
    addKitchenBaseCabinet({ name: "kitchen east forward cabinet", x: 14.48, z: -6.42, floorY: FLOOR.MAIN, width: 2.1, height: cabinetHeight, rotationY: -Math.PI / 2 });

    // Butt the three counter runs at their corners. The rear slab is split at
    // the sink and the east slab at the range, eliminating coplanar overlap.
    const innerCounter = new THREE.Group();
    innerCounter.name = "kitchen-countertop-inner";
    scene.add(innerCounter);
    box({ name: "kitchen-countertop-inner-slab", w: counterDepth, h: counterThickness, d: 1.3, x: 5.53, y: FLOOR.MAIN + counterCenterY, z: -10.35, material: M.marble, parent: innerCounter, cast: false, receive: true });

    const rearCounter = new THREE.Group();
    rearCounter.name = "kitchen-countertop-rear";
    scene.add(rearCounter);
    box({ name: "kitchen-countertop-rear-west-slab", w: 2.9, h: counterThickness, d: counterDepth, x: 7.35, y: FLOOR.MAIN + counterCenterY, z: sinkZ, material: M.marble, parent: rearCounter, cast: false, receive: true });
    box({ name: "kitchen-countertop-rear-east-slab", w: 3.55, h: counterThickness, d: counterDepth, x: 12.275, y: FLOOR.MAIN + counterCenterY, z: sinkZ, material: M.marble, parent: rearCounter, cast: false, receive: true });
    box({ name: "kitchen-countertop-rear-back-bridge", w: 8.15, h: 0.035, d: 0.13, x: 9.975, y: FLOOR.MAIN + KITCHEN_LAYOUT.counterTop + 0.017, z: -11.755, material: M.marble, parent: rearCounter, cast: false, receive: true });

    const eastCounter = new THREE.Group();
    eastCounter.name = "kitchen-countertop-east";
    scene.add(eastCounter);
    box({ name: "kitchen-countertop-east-rear-slab", w: counterDepth, h: counterThickness, d: 1.9, x: 14.47, y: FLOOR.MAIN + counterCenterY, z: -10.05, material: M.marble, parent: eastCounter, cast: false, receive: true });
    box({ name: "kitchen-countertop-east-forward-slab", w: counterDepth, h: counterThickness, d: 2.2, x: 14.47, y: FLOOR.MAIN + counterCenterY, z: -6.4, material: M.marble, parent: eastCounter, cast: false, receive: true });

    // Low marble backsplashes terminate below every shortened window, with a
    // fine brass line tying all three elevations together.
    box({ name: "kitchen-rear-marble-backsplash", w: 8.2, h: 0.22, d: 0.045, x: 10, y: FLOOR.MAIN + 1.09, z: -11.805, material: M.marble, cast: false, receive: true });
    box({ name: "kitchen-inner-marble-backsplash", w: 0.045, h: 0.22, d: 1.3, x: 5.185, y: FLOOR.MAIN + 1.09, z: -10.35, material: M.marble, cast: false, receive: true });
    box({ name: "kitchen-east-marble-backsplash-rear", w: 0.045, h: 0.22, d: 1.9, x: 14.815, y: FLOOR.MAIN + 1.09, z: -10.05, material: M.marble, cast: false, receive: true });
    box({ name: "kitchen-east-marble-backsplash-forward", w: 0.045, h: 0.22, d: 2.2, x: 14.815, y: FLOOR.MAIN + 1.09, z: -6.4, material: M.marble, cast: false, receive: true });
    box({ name: "kitchen-rear-backsplash-brass-cap", w: 8.2, h: 0.025, d: 0.055, x: 10, y: FLOOR.MAIN + 1.205, z: -11.8, material: M.brass, cast: false });
    box({ name: "kitchen-inner-backsplash-brass-cap", w: 0.055, h: 0.025, d: 1.3, x: 5.19, y: FLOOR.MAIN + 1.205, z: -10.35, material: M.brass, cast: false });
    box({ name: "kitchen-east-backsplash-brass-cap-rear", w: 0.055, h: 0.025, d: 1.9, x: 14.81, y: FLOOR.MAIN + 1.205, z: -10.05, material: M.brass, cast: false });
    box({ name: "kitchen-east-backsplash-brass-cap-forward", w: 0.055, h: 0.025, d: 2.2, x: 14.81, y: FLOOR.MAIN + 1.205, z: -6.4, material: M.brass, cast: false });

    // A porcelain sink fills the deliberate stone opening; the shared outlet
    // coordinates make the animated stream land inside the dark basin well.
    roundedBox({ name: "kitchen-sink-brass-rim", w: 1.62, h: 0.65, d: 0.11, radius: 0.11, x: sinkX, y: FLOOR.MAIN + 0.94, z: sinkZ, rotationX: -Math.PI / 2, material: M.brass, cast: false });
    roundedBox({ name: "kitchen-sink-basin", w: 1.52, h: 0.58, d: 0.095, radius: 0.1, x: sinkX, y: FLOOR.MAIN + 0.945, z: sinkZ, rotationX: -Math.PI / 2, material: M.porcelain, cast: false });
    roundedBox({ name: "kitchen-sink-basin-well", w: 1.22, h: 0.38, d: 0.024, radius: 0.08, x: sinkX, y: FLOOR.MAIN + 1.004, z: sinkZ + 0.025, rotationX: -Math.PI / 2, material: M.soot, cast: false });
    cylinder({ name: "kitchen-sink-drain", radius: 0.052, height: 0.012, segments: 18, x: sinkX, y: FLOOR.MAIN + 1.019, z: sinkZ + 0.04, material: M.brass, cast: false });
    cylinder({ name: "kitchen-sink-faucet-deck-collar", radius: 0.078, height: 0.035, segments: 18, x: sinkX, y: FLOOR.MAIN + 1.005, z: -11.69, material: M.brass, cast: false });
    cylinder({ name: "kitchen-sink-faucet-riser", radius: 0.03, height: 0.3, segments: 16, x: sinkX, y: FLOOR.MAIN + 1.17, z: -11.69, material: M.brass, cast: false });
    sphere({ name: "kitchen-sink-faucet-elbow", radius: 0.05, x: sinkX, y: FLOOR.MAIN + 1.32, z: -11.69, material: M.brass, cast: false });
    cylinder({ name: "kitchen-sink-faucet-spout", radius: 0.026, height: 0.38, segments: 14, x: sinkX, y: FLOOR.MAIN + 1.32, z: -11.5, rotationX: Math.PI / 2, material: M.brass, cast: false });
    new WaterFixture({ name: "kitchen sink", kind: "sink", x: sinkX, y: FLOOR.MAIN + 1.3, z: -11.31, drop: 0.28, handleOffset: { x: 0.27, y: 0.02, z: -0.32 } });

    const sinkTaskMaterial = new THREE.MeshStandardMaterial({ color: 0xffdfaa, emissive: 0xffa04a, emissiveIntensity: 1.05, roughness: 0.3 });
    const sinkTaskBulb = box({ name: "kitchen-sink-task-light", w: 0.92, h: 0.055, d: 0.1, x: sinkX, y: FLOOR.MAIN + 2.82, z: -11.75, material: sinkTaskMaterial, cast: false, receive: false });
    sinkTaskBulb.userData.onEmissiveIntensity = 1.05;
    kitchenTaskBulbs.push(sinkTaskBulb);
    cylinder({ name: "kitchen-sink-task-light-arm", radius: 0.018, height: 0.22, x: sinkX, y: FLOOR.MAIN + 2.88, z: -11.79, rotationX: Math.PI / 2, material: M.brass, cast: false });

    addKitchenRange(KITCHEN_LAYOUT.rangeX, KITCHEN_LAYOUT.rangeZ, FLOOR.MAIN, Math.PI / 2);
    new Refrigerator({ name: "kitchen refrigerator", x: KITCHEN_LAYOUT.refrigeratorX, z: KITCHEN_LAYOUT.refrigeratorZ, floorY: FLOOR.MAIN, width: 1.25, height: 2.25, depth: 0.82, rotationY: -Math.PI / 2 });
    box({ name: "kitchen-refrigerator-surround-top", w: 0.9, h: 0.11, d: 1.42, x: KITCHEN_LAYOUT.refrigeratorX, y: FLOOR.MAIN + 2.3, z: KITCHEN_LAYOUT.refrigeratorZ, material: M.darkWood, cast: false });
    for (const side of [-1, 1]) box({ name: "kitchen-refrigerator-surround-gable", w: 0.9, h: 2.3, d: 0.075, x: KITCHEN_LAYOUT.refrigeratorX, y: FLOOR.MAIN + 1.15, z: KITCHEN_LAYOUT.refrigeratorZ + side * 0.69, material: M.darkWood, cast: true });
  }

  function addWineRack(x, z, floorY, rotationY, width) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    const w = width || 2.5;
    box({ name: "wine-rack-frame", w, h: 2.25, d: 0.42, x: 0, y: 1.125, z: 0, material: M.darkWood, parent: group });
    box({ name: "wine-rack-void", w: w - 0.18, h: 2.04, d: 0.44, x: 0, y: 1.13, z: -0.03, material: M.soot, parent: group, cast: false });
    const bottleTransforms = [[], []];
    for (let row = 0; row < 5; row += 1) for (let col = 0; col < Math.floor(w / 0.32); col += 1) {
      bottleTransforms[row % 2].push({ x: -w / 2 + 0.22 + col * 0.31, y: 0.28 + row * 0.39, z: -0.2, tilt: (col % 2 ? 1 : -1) * 0.03 });
    }
    const bottleGeometry = geometry("wineBottle", () => new THREE.CylinderGeometry(0.035, 0.06, 0.48, 9));
    bottleTransforms.forEach((transforms, materialIndex) => {
      const bottles = new THREE.InstancedMesh(bottleGeometry, materialIndex ? M.wineGreen : M.wineRed, transforms.length);
      bottles.name = "instanced-dusty-wine-bottles";
      bottles.castShadow = false;
      const dummy = new THREE.Object3D();
      transforms.forEach((entry, index) => {
        dummy.position.set(entry.x, entry.y, entry.z);
        dummy.rotation.set(Math.PI / 2, 0, entry.tilt);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        bottles.setMatrixAt(index, dummy.matrix);
      });
      bottles.instanceMatrix.needsUpdate = true;
      group.add(bottles);
    });
    physics.addFixedBox(x, floorY + 1.125, z, Math.abs(Math.cos(rotationY || 0)) * w + Math.abs(Math.sin(rotationY || 0)) * 0.5, 2.25, Math.abs(Math.sin(rotationY || 0)) * w + Math.abs(Math.cos(rotationY || 0)) * 0.5, 0);
  }

  function addBoiler(x, z, floorY) {
    cylinder({ name: "riveted-boiler", radius: 0.74, height: 2.25, segments: 22, x, y: floorY + 1.12, z, material: M.iron });
    for (const sy of [0.4, 1.12, 1.84]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.045, 8, 28), M.brass);
      ring.position.set(x, floorY + sy, z);
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);
    }
    sphere({ name: "boiler-gauge", radius: 0.18, x: x, y: floorY + 1.48, z: z + 0.74, material: M.porcelain });
    physics.addFixedBox(x, floorY + 1.15, z, 1.5, 2.3, 1.5, 0);
  }

  function addPipeRun(points, radius, material) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 8), radius || 0.07, 8, false), material || M.copper);
    mesh.name = "aged-service-pipe";
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function makeArtworkTexture(source, frameAspect, crop) {
    if (!source) return null;
    const texture = source.clone();
    texture.needsUpdate = true;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    let repeatX = crop && crop.repeatX != null ? crop.repeatX : 1;
    let repeatY = crop && crop.repeatY != null ? crop.repeatY : 1;
    let offsetX = crop && crop.offsetX != null ? crop.offsetX : 0;
    let offsetY = crop && crop.offsetY != null ? crop.offsetY : 0;
    const imageWidth = source.image && (source.image.naturalWidth || source.image.width) || 1;
    const imageHeight = source.image && (source.image.naturalHeight || source.image.height) || 1;
    const regionAspect = (imageWidth * repeatX) / (imageHeight * repeatY);
    if (frameAspect > regionAspect) {
      const nextRepeatY = repeatY * (regionAspect / frameAspect);
      offsetY += (repeatY - nextRepeatY) / 2;
      repeatY = nextRepeatY;
    } else if (frameAspect < regionAspect) {
      const nextRepeatX = repeatX * (frameAspect / regionAspect);
      offsetX += (repeatX - nextRepeatX) / 2;
      repeatX = nextRepeatX;
    }
    texture.repeat.set(repeatX, repeatY);
    texture.offset.set(offsetX, offsetY);
    return texture;
  }

  function createArtworkMaterial(artId, frameAspect, crop, circuitName, fallbackColor) {
    const artTexture = makeArtworkTexture(portraitTextures.get(artId), frameAspect, crop);
    const artwork = PORTRAIT_ARTWORKS[artId];
    const material = new THREE.MeshStandardMaterial({
      map: artTexture,
      color: artTexture ? 0xffffff : fallbackColor || 0x2f262c,
      roughness: 0.84,
      metalness: 0,
      emissive: artTexture ? 0xffffff : 0x000000,
      emissiveMap: artTexture,
      emissiveIntensity: 0,
    });
    portraitPlacements.push({
      artId: artId || null,
      title: artwork ? artwork.title : "Unnamed ancestor",
      loaded: Boolean(artTexture),
      material,
      circuitName,
    });
    return { artTexture, artwork, material };
  }

  function addPortrait(x, y, z, rotationY, width, height, color, artId, crop, circuitName) {
    const group = new THREE.Group();
    group.name = `portrait-${artId || "procedural-fallback"}`;
    group.position.set(x, y, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    const rail = 0.105;
    box({ name: "portrait-frame-top", w: width + rail * 2, h: rail, d: 0.09, x: 0, y: height / 2 + rail / 2, z: 0, material: M.brass, parent: group, cast: false });
    box({ name: "portrait-frame-bottom", w: width + rail * 2, h: rail, d: 0.09, x: 0, y: -height / 2 - rail / 2, z: 0, material: M.brass, parent: group, cast: false });
    for (const side of [-1, 1]) box({ name: "portrait-frame-side", w: rail, h: height, d: 0.09, x: side * (width / 2 + rail / 2), y: 0, z: 0, material: M.brass, parent: group, cast: false });
    const { artTexture, artwork, material: artMat } = createArtworkMaterial(artId, width / height, crop, circuitName, color);
    const artPanelName = artId ? `portrait-art-${artId}` : "portrait-art-fallback";
    const artPanel = box({ name: artPanelName, w: width, h: height, d: 0.035, x: 0, y: 0, z: 0.035, material: artMat, parent: group, cast: false });
    artPanel.userData.artId = artId || null;
    artPanel.userData.title = artwork ? artwork.title : "Unnamed ancestor";
    artPanel.userData.generatedArtwork = Boolean(artTexture);
    if (!artTexture) {
      sphere({ name: "portrait-face-shadow", radius: Math.min(width, height) * 0.16, widthSegments: 12, heightSegments: 8, x: 0, y: height * 0.12, z: 0.065, material: M.soot, parent: group, cast: false });
      box({ name: "portrait-silhouette", w: width * 0.45, h: height * 0.42, d: 0.02, x: 0, y: -height * 0.22, z: 0.066, material: M.blackWood, parent: group, cast: false });
    }
    return group;
  }

  function addWallPortrait(options) {
    const { axis, fixed, center, floorY, centerY = 1.95, side = 1, width = 1, height = 1.4, color, artId, crop, circuitName } = options;
    const offset = 0.19;
    if (axis === "x") {
      return addPortrait(center, floorY + centerY, fixed + side * offset, side > 0 ? 0 : Math.PI, width, height, color, artId, crop, circuitName);
    }
    return addPortrait(fixed + side * offset, floorY + centerY, center, side > 0 ? Math.PI / 2 : -Math.PI / 2, width, height, color, artId, crop, circuitName);
  }

  function bindPortraitMaterialsToLighting() {
    const circuitByName = new Map(circuits.map((circuit) => [circuit.name, circuit]));
    for (const placement of portraitPlacements) {
      if (!placement.loaded || !placement.material || !placement.circuitName) continue;
      const circuit = circuitByName.get(placement.circuitName);
      if (!circuit) continue;
      // Preserve enough painted detail to read under the deliberately dim
      // gallery circuits without letting the canvas become a self-lit screen.
      placement.material.userData.onEmissiveIntensity = 0.48;
      placement.material.userData.offEmissiveIntensity = 0;
      placement.material.emissiveIntensity = circuit.on ? 0.48 : 0;
      circuit.glowMaterials.push(placement.material);
    }
  }

  function addBeamBetween(name, from, to, radius, material) {
    const start = new THREE.Vector3(from[0], from[1], from[2]);
    const end = new THREE.Vector3(to[0], to[1], to[2]);
    const direction = end.clone().sub(start);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material || M.darkWood);
    mesh.name = name;
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function addBust(x, z, floorY, rotationY) {
    const group = new THREE.Group();
    group.position.set(x, floorY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    box({ name: "marble-bust-pedestal", w: 0.58, h: 0.92, d: 0.58, x: 0, y: 0.46, z: 0, material: M.marble, parent: group });
    box({ name: "marble-bust-plinth", w: 0.7, h: 0.12, d: 0.7, x: 0, y: 0.98, z: 0, material: M.marble, parent: group });
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), M.porcelain);
    shoulders.name = "carved-marble-shoulders";
    shoulders.scale.set(0.42, 0.16, 0.25);
    shoulders.position.set(0, 1.22, 0);
    shoulders.castShadow = true;
    group.add(shoulders);
    roundedBox({ name: "carved-marble-torso", w: 0.45, h: 0.42, d: 0.28, radius: 0.08, x: 0, y: 1.15, z: 0, material: M.porcelain, parent: group });
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), M.porcelain);
    head.name = "faceless-marble-bust-head";
    head.scale.set(0.16, 0.22, 0.17);
    head.position.set(0, 1.55, 0);
    head.castShadow = true;
    group.add(head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 8), M.porcelain);
    nose.name = "marble-bust-nose";
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.55, -0.18);
    group.add(nose);
    cylinder({ name: "marble-bust-neck", radius: 0.09, height: 0.2, segments: 14, x: 0, y: 1.36, z: 0, material: M.porcelain, parent: group });
    physics.addFixedBox(x, floorY + 0.85, z, 0.72, 1.7, 0.72, rotationY || 0);
  }

  function addFoyerPanelwork() {
    const lowerRailY = FLOOR.MAIN + 0.34;
    const upperRailY = FLOOR.MAIN + 1.52;
    const panelCenterY = (lowerRailY + upperRailY) / 2;
    const panelHeight = upperRailY - lowerRailY;
    for (const side of [-1, 1]) {
      const x = side * 4.81;
      for (const z of [4.1, 5.6, 9.0, 10.5]) {
        box({ name: "foyer-wainscot-panel", w: 0.035, h: panelHeight - 0.16, d: 1.1, x, y: panelCenterY, z, material: M.blackWood, cast: false });
        for (const zz of [z - 0.57, z + 0.57]) box({ name: "foyer-panel-vertical", w: 0.055, h: panelHeight, d: 0.045, x: x - side * 0.035, y: panelCenterY, z: zz, material: M.brass, cast: false });
        for (const y of [lowerRailY, upperRailY]) box({ name: "foyer-panel-horizontal", w: 0.055, h: 0.045, d: 1.18, x: x - side * 0.035, y, z, material: M.brass, cast: false });
      }
    }
    addBust(-3.85, 5.0, FLOOR.MAIN, Math.PI / 2);
    addBust(3.85, 5.0, FLOOR.MAIN, -Math.PI / 2);
  }

  function addRoomZone(floorMin, floorMax, x1, x2, z1, z2, floorLabel, roomLabel) {
    roomZones.push({ floorMin, floorMax, x1, x2, z1, z2, floorLabel, roomLabel });
  }

  function registerRoomZones() {
    const mainMin = -0.45;
    const mainMax = 2.45;
    const upperMin = 2.45;
    const basementMax = -0.45;
    // Exterior zones stay on the main-level render rig so crossing a threshold
    // never toggles a circuit or makes the mansion/grounds lights pop on.
    addRoomZone(mainMin, mainMax, -33.5, -17.3, YARD_LAYOUT.garden.centerZ - YARD_LAYOUT.garden.depth / 2 - 0.2, YARD_LAYOUT.garden.centerZ + YARD_LAYOUT.garden.depth / 2 + 0.2, "MAIN LEVEL", "FORMAL GARDEN");
    addRoomZone(-2.2, mainMax, -17.0, -1.2, -33.5, -17.8, "MAIN LEVEL", "POOL TERRACE");
    addRoomZone(mainMin, mainMax, 19.5, 33.5, -33.5, 14.35, "MAIN LEVEL", "HEDGE MAZE");
    addRoomZone(mainMin, mainMax, -17.2, 17.2, 12.01, 33.5, "MAIN LEVEL", "FRONT DRIVE");
    addRoomZone(mainMin, mainMax, -33.5, 33.5, -33.5, -12.01, "MAIN LEVEL", "REAR LAWN");
    addRoomZone(mainMin, mainMax, -33.5, -15.01, -12, 33.5, "MAIN LEVEL", "WEST LAWN");
    addRoomZone(mainMin, mainMax, 15.01, 33.5, -12, 33.5, "MAIN LEVEL", "EAST LAWN");
    addRoomZone(mainMin, mainMax, COAT_CLOSET.bounds.minX, COAT_CLOSET.bounds.maxX, COAT_CLOSET.bounds.minZ, COAT_CLOSET.bounds.maxZ, "MAIN LEVEL", "COAT CLOSET");
    addRoomZone(mainMin, mainMax, 10.4, 15, -3.2, 3.2, "MAIN LEVEL", "SERVICE STAIR");
    const wingZones = [
      [-15, -5, 3.2, 12, "LIBRARY"],
      [-5, 5, 3.2, 12, "FRONT FOYER"],
      [5, 15, 3.2, 12, "MUSIC ROOM"],
      [-15, -5, -3.2, 3.2, "MAIN HALL BATHROOM"],
      [-5, 5, -3.2, 3.2, "GRAND STAIR HALL"],
      [5, 15, -3.2, 3.2, "PAINTING ROOM"],
      [-15, -5, -12, -3.2, "DINING ROOM"],
      [-5, 5, -12, -3.2, "BALLROOM"],
      [5, 15, -12, -3.2, "KITCHEN"],
    ];
    wingZones.forEach((r) => addRoomZone(mainMin, mainMax, r[0], r[1], r[2], r[3], "MAIN LEVEL", r[4]));
    addRoomZone(upperMin, 9, -15, -5, -3.2, 3.2, "SECOND FLOOR", "UPPER GRAND BATHROOM");
    const upperZones = [
      [-15, -5, 3.2, 12, "WEST FRONT SUITE"],
      [-5, 5, 3.2, 12, "FOYER BALCONY"],
      [5, 15, 3.2, 12, "EAST FRONT SUITE"],
      [-5, 5, -3.2, 3.2, "UPPER LANDING"],
      [5, 15, -3.2, 3.2, "READING ROOM"],
      [-15, -5, -12, -3.2, "PRIMARY SUITE"],
      [-5, 5, -12, -3.2, "REAR LOUNGE"],
      [5, 15, -12, -3.2, "EAST REAR SUITE"],
    ];
    upperZones.forEach((r) => addRoomZone(upperMin, 9, r[0], r[1], r[2], r[3], "SECOND FLOOR", r[4]));
    const basementZones = [
      [-15, -1.3, 3.2, 12, "WINE CELLAR"],
      [1.3, 15, 3.2, 12, "ARCHIVE"],
      [-1.3, 1.3, -3.2, 12, "BASEMENT CORRIDOR"],
      [-15, -1.3, -3.2, 3.2, "LAUNDRY & LINEN"],
      [1.3, 10.4, -3.2, 3.2, "PANTRY"],
      [10.4, 15, -3.2, 3.2, "SERVICE STAIR"],
      [-15, 15, -4.9, -3.2, "REAR CROSS-CORRIDOR"],
      [-15, -6, -12, -4.9, "BOILER ROOM"],
      [-6, 1.3, -12, -4.9, "WORKSHOP"],
      [1.3, 7.6, -12, -4.9, "COLD ROOM"],
      [7.6, 15, -12, -4.9, "BULK STORAGE"],
    ];
    basementZones.forEach((r) => addRoomZone(-9, basementMax, r[0], r[1], r[2], r[3], "BASEMENT", r[4]));
  }

  function buildSlabsAndCeilings() {
    floorSlab("basement-foundation", 0, 0, 30, 24, FLOOR.BASEMENT, M.darkFloor);

    floorSlab("main-floor-west-wing", -8.15, 0, 13.7, 24, FLOOR.MAIN, M.oakFloor);
    floorSlab("main-floor-east-of-grand-stair", 6.3, 0, 10, 24, FLOOR.MAIN, M.oakFloor);
    box({ name: "main-floor-foyer-center", w: 2.6, h: 0.24, d: 9.2, x: 0, y: FLOOR.MAIN - 0.12, z: 7.4, material: M.oakFloor, collider: false, cast: true, receive: true });
    // One uninterrupted collision deck continues under the front threshold;
    // separate coplanar slab faces can otherwise act like one-way walls to a
    // character controller even when their visible floors line up perfectly.
    physics.addFixedBox(0, FLOOR.MAIN - 0.12, 8.9, 2.6, 0.24, 12.2, 0);
    box({ name: "main-floor-rear-center", w: 2.6, h: 0.24, d: 9.8, x: 0, y: FLOOR.MAIN - 0.12, z: -7.1, material: M.oakFloor, collider: false, cast: true, receive: true });
    physics.addFixedBox(0, FLOOR.MAIN - 0.12, -8.65, 2.6, 0.24, 13.3, 0);
    floorSlab("main-floor-under-grand-stair", 0, 0.3, 2.6, 5.0, FLOOR.MAIN, M.oakFloor);
    floorSlab("main-floor-east-edge", 14.4, 0, 1.2, 24, FLOOR.MAIN, M.oakFloor);
    floorSlab("main-floor-service-front", 12.55, 7.35, 2.5, 9.3, FLOOR.MAIN, M.oakFloor);
    floorSlab("main-floor-service-rear", 12.55, -7.35, 2.5, 9.3, FLOOR.MAIN, M.oakFloor);

    // Bring each wing to the overlook rail so the balusters sit on the floor
    // edge and the balcony corridor remains comfortably walkable.
    floorSlab("upper-floor-west", -9.2, 0, 11.6, 24, FLOOR.UPPER, M.oakFloor);
    floorSlab("upper-floor-east", 9.2, 0, 11.6, 24, FLOOR.UPPER, M.oakFloor);
    floorSlab("upper-floor-rear", 0, -7.25, 7.5, 9.5, FLOOR.UPPER, M.oakFloor);
    floorSlab("upper-floor-front-crosswalk", 0, 11.55, 7.5, 0.9, FLOOR.UPPER, M.marble);

    box({ name: "upper-ceiling", w: 30, h: 0.22, d: 24, x: 0, y: FLOOR.UPPER + UPPER_HEIGHT + 0.11, z: 0, material: M.ceiling, cast: false, receive: true });
    box({ name: "basement-damp-course", w: 30.8, h: 0.24, d: 24.8, x: 0, y: FLOOR.BASEMENT - 0.3, z: 0, material: M.limestone, cast: false });

    addRug(0, 8.0, 4.4, 5.2, FLOOR.MAIN, M.foyerRug, 0);
    addRug(-9.5, 7.6, 6.4, 4.8, FLOOR.MAIN, M.libraryRug, 0);
    addRug(9.4, 7.7, 6.2, 4.6, FLOOR.MAIN, M.musicRug, 0);
    addRug(-9.7, -8.4, 7.2, 3.8, FLOOR.MAIN, M.redRug, 0);
    // A thin, non-colliding ballroom finish reuses the estate's generated
    // antique-marble texture while the oak slab remains the physics surface.
    box({ name: "ballroom-ai-marble-floor", w: 9.6, h: 0.035, d: 6.7, x: 0, y: FLOOR.MAIN + 0.018, z: -8.45, material: M.marble, cast: false, receive: true });
    for (const x of [-4.76, 4.76]) box({ name: "ballroom-marble-brass-inlay", w: 0.035, h: 0.018, d: 6.5, x, y: FLOOR.MAIN + 0.043, z: -8.45, material: M.brass, cast: false });
    for (const z of [-11.71, -5.19]) box({ name: "ballroom-marble-brass-inlay", w: 9.5, h: 0.018, d: 0.035, x: 0, y: FLOOR.MAIN + 0.043, z, material: M.brass, cast: false });
  }

  function buildExteriorWalls() {
    const mainWindows = (centers) => centers.map((center) => ({ kind: "window", center, width: 1.4, bottom: 0.8, top: 3.12 }));
    const kitchenWindows = (centers) => centers.map((center) => ({ kind: "window", center, width: 1.65, bottom: 1.28, top: 2.62 }));
    const upperWindows = (centers) => centers.map((center) => ({ kind: "window", center, width: 1.3, bottom: 0.72, top: 2.66 }));

    buildWallRun({ axis: "x", fixed: 12, start: -15, end: 15, floorY: FLOOR.MAIN, exterior: true, name: "main-front-wall", openings: [
      ...mainWindows([-11.5, -8.2, -5.9]),
      { kind: "door", center: -0.62, width: 1.24, height: 3.12, label: "left front door", direction: -1, hingeSide: -1 },
      { kind: "door", center: 0.62, width: 1.24, height: 3.12, label: "right front door", direction: 1, hingeSide: 1 },
      ...mainWindows([5.9, 8.2, 11.5]),
    ] });
    buildWallRun({ axis: "x", fixed: -12, start: -15, end: 15, floorY: FLOOR.MAIN, exterior: true, name: "main-rear-wall", openings: [
      ...mainWindows([-12.2, -9.3, -6.4, -3.3]),
      { kind: "door", center: -0.66, width: 1.32, height: 2.86, label: "left terrace door", direction: 1, hingeSide: -1 },
      { kind: "door", center: 0.66, width: 1.32, height: 2.86, label: "right terrace door", direction: -1, hingeSide: 1 },
      ...mainWindows([3.3]),
      ...kitchenWindows([6.4, 9.4, 12.4]),
    ] });
    buildWallRun({ axis: "z", fixed: -15, start: -12, end: 12, floorY: FLOOR.MAIN, exterior: true, name: "main-west-wall", openings: mainWindows([-9.4, -6.7, 6.4, 9.4]) });
    buildWallRun({ axis: "z", fixed: 15, start: -12, end: 12, floorY: FLOOR.MAIN, exterior: true, name: "main-east-wall", openings: [
      ...kitchenWindows([-9.4, -6.7]),
      ...mainWindows([0, 6.4, 9.4]),
    ] });

    buildWallRun({ axis: "x", fixed: 12, start: -15, end: 15, floorY: FLOOR.UPPER, exterior: true, name: "upper-front-wall", openings: [
      ...upperWindows([-11.5, -8.2, -5.9]),
      { kind: "window", center: 0, width: 3.2, bottom: 0.35, top: 2.85 },
      ...upperWindows([5.9, 8.2, 11.5]),
    ] });
    const rearLoungeWindows = [
      { kind: "window", center: -2.3, width: 3.7, bottom: 0.38, top: 2.92 },
      { kind: "window", center: 2.3, width: 3.7, bottom: 0.38, top: 2.92 },
    ];
    buildWallRun({ axis: "x", fixed: -12, start: -15, end: 15, floorY: FLOOR.UPPER, exterior: true, name: "upper-rear-wall", openings: [
      ...upperWindows([-12.2, -9.3, -6.4]),
      ...rearLoungeWindows,
      ...upperWindows([6.4, 9.4, 12.2]),
    ] });
    buildWallRun({ axis: "z", fixed: -15, start: -12, end: 12, floorY: FLOOR.UPPER, exterior: true, name: "upper-west-wall", openings: upperWindows([-9.4, -6.7, 0, 6.4, 9.4]) });
    buildWallRun({ axis: "z", fixed: 15, start: -12, end: 12, floorY: FLOOR.UPPER, exterior: true, name: "upper-east-wall", openings: upperWindows([-9.4, -6.7, 0, 6.4, 9.4]) });

    const basementWindows = (centers) => centers.map((center) => ({ kind: "window", center, width: 0.92, bottom: 2.4, top: 3.23 }));
    buildWallRun({ axis: "x", fixed: 12, start: -15, end: 15, floorY: FLOOR.BASEMENT, exterior: true, name: "basement-front-wall", material: M.limestone, openings: basementWindows([-11, -7, -3, 3, 7, 11]) });
    buildWallRun({ axis: "x", fixed: -12, start: -15, end: 15, floorY: FLOOR.BASEMENT, exterior: true, name: "basement-rear-wall", material: M.limestone, openings: basementWindows([-11, -7, -3, 3, 7, 11]) });
    buildWallRun({ axis: "z", fixed: -15, start: -12, end: 12, floorY: FLOOR.BASEMENT, exterior: true, name: "basement-west-wall", material: M.limestone, openings: basementWindows([-8, -2, 5, 9]) });
    buildWallRun({ axis: "z", fixed: 15, start: -12, end: 12, floorY: FLOOR.BASEMENT, exterior: true, name: "basement-east-wall", material: M.limestone, openings: basementWindows([-9, 6, 10]) });

    // The main wall ends at 4.15m while the upper story begins at 4.5m. Wrap
    // that structural transition with continuous masonry so the floor slab can
    // never read as a floating story when viewed from the grounds.
    const interstoryY = (FLOOR.MAIN + WALL_HEIGHT + FLOOR.UPPER) / 2;
    const interstoryHeight = FLOOR.UPPER - (FLOOR.MAIN + WALL_HEIGHT) + 0.08;
    box({ name: "facade-interstory-infill-front", w: 30.34, h: interstoryHeight, d: 0.34, x: 0, y: interstoryY, z: 12.02, material: M.wallpaper, cast: true });
    box({ name: "facade-interstory-infill-rear", w: 30.34, h: interstoryHeight, d: 0.34, x: 0, y: interstoryY, z: -12.02, material: M.wallpaper, cast: true });
    box({ name: "facade-interstory-infill-west", w: 0.34, h: interstoryHeight, d: 24.34, x: -15.02, y: interstoryY, z: 0, material: M.wallpaper, cast: true });
    box({ name: "facade-interstory-infill-east", w: 0.34, h: interstoryHeight, d: 24.34, x: 15.02, y: interstoryY, z: 0, material: M.wallpaper, cast: true });
    for (const [side, axis, fixed] of [
      ["front", "x", 12.22], ["rear", "x", -12.22],
      ["west", "z", -15.22], ["east", "z", 15.22],
    ]) {
      const alongX = axis === "x";
      box({
        name: `facade-interstory-stringcourse-${side}`,
        w: alongX ? 30.55 : 0.18,
        h: 0.13,
        d: alongX ? 0.18 : 24.55,
        x: alongX ? 0 : fixed,
        y: FLOOR.UPPER - 0.1,
        z: alongX ? fixed : 0,
        material: M.limestone,
        cast: false,
      });
    }
  }

  function buildMainPartitions() {
    // Shield the tall pantry from the ballroom with a short rear-anchored
    // partition. Its free end sits about five feet beyond the cabinet while
    // leaving an eleven-foot uncased passage into the kitchen.
    buildWallRun({ axis: "z", fixed: 5, start: -12, end: -8.2, floorY: FLOOR.MAIN, name: "main-kitchen-ballroom-partial-wall", openings: [] });
    buildWallRun({ axis: "z", fixed: -5, start: -4.9, end: 12, floorY: FLOOR.MAIN, name: "main-west-front-spine", openings: [
      { kind: "door", center: 0, width: 1.35, label: "main hall bathroom door", direction: 1 },
      { kind: "door", center: 7.3, width: 1.85, label: "library door", direction: -1 },
    ] });
    buildWallRun({ axis: "z", fixed: 5, start: -4.9, end: 12, floorY: FLOOR.MAIN, name: "main-east-front-spine", openings: [
      // Direct stair-hall entry to the painting room, mirroring the main hall
      // bathroom door opposite it on the west front spine.
      { kind: "door", center: 0, width: 1.35, label: "stair painting door", direction: -1 },
      { kind: "door", center: 7.3, width: 1.85, label: "music room door", direction: 1 },
    ] });
    buildWallRun({ axis: "x", fixed: 3.2, start: -15, end: -5, floorY: FLOOR.MAIN, name: "main-library-divider", openings: [{ kind: "door", center: -9.7, width: 1.38, label: "library bathroom door", direction: 1 }] });
    buildWallRun({ axis: "x", fixed: 3.2, start: -5, end: 5, floorY: FLOOR.MAIN, name: "main-foyer-arch", openings: [{ kind: "arch", center: 0, width: 7.2, height: 3.18 }] });
    buildWallRun({ axis: "x", fixed: 3.2, start: 5, end: 15, floorY: FLOOR.MAIN, name: "main-music-painting-divider", openings: [{ kind: "door", center: 8.2, width: 1.38, label: "music painting door", direction: -1 }] });
    buildWallRun({ axis: "x", fixed: -3.2, start: -15, end: -5, floorY: FLOOR.MAIN, name: "main-bath-gallery", openings: [
      { kind: "door", center: -13.2, width: 1.05, label: "coat closet door", direction: 1, hingeSide: -1 },
      { kind: "door", center: -9.7, width: 1.35, label: "bathroom gallery door", direction: -1 },
    ] });
    buildWallRun({ axis: "x", fixed: -3.2, start: -5, end: 5, floorY: FLOOR.MAIN, name: "main-stair-gallery", openings: [{ kind: "arch", center: 0, width: 5.6, height: 3.1 }] });
    buildWallRun({ axis: "x", fixed: -3.2, start: 5, end: 11.3, floorY: FLOOR.MAIN, name: "main-painting-gallery", openings: [{ kind: "door", center: 8.2, width: 1.35, label: "painting gallery door", direction: 1 }] });
    // Close the kitchen off from the basement stair while keeping the landing
    // safe: the leaf swings south into the kitchen, never over the flight.
    buildWallRun({ axis: "x", fixed: -3.2, start: 11.3, end: 15, floorY: FLOOR.MAIN, name: "main-kitchen-service-stair-wall", openings: [
      { kind: "door", center: 12.55, width: 1.35, label: "basement stair door", direction: 1, hingeSide: -1 },
    ] });
    buildWallRun({ axis: "z", fixed: 10.4, start: -3.2, end: 3.2, floorY: FLOOR.MAIN, name: "main-service-shaft-wall", openings: [] });
    buildWallRun({ axis: "z", fixed: -11.5, start: -3.2, end: 1.6, floorY: FLOOR.MAIN, name: "main-bath-east-wall", openings: [] });
    buildWallRun({ axis: "x", fixed: 1.6, start: -15, end: -11.5, floorY: FLOOR.MAIN, name: "main-bath-north-wall", openings: [] });
  }

  function buildUpperPartitions() {
    buildWallRun({ axis: "z", fixed: -5, start: -12, end: 3.15, floorY: FLOOR.UPPER, name: "upper-west-rear-spine", openings: [
      { kind: "door", center: -6.4, width: 1.35, label: "primary suite lounge door", direction: 1 },
      { kind: "door", center: 0, width: 1.35, label: "upper grand bathroom door", direction: -1 },
    ] });
    buildWallRun({ axis: "z", fixed: -5, start: 3.35, end: 12, floorY: FLOOR.UPPER, name: "upper-west-front-spine", openings: [{ kind: "door", center: 7.3, width: 1.35, label: "west front suite door", direction: 1 }] });
    buildWallRun({ axis: "z", fixed: 5, start: -12, end: 3.15, floorY: FLOOR.UPPER, name: "upper-east-rear-spine", openings: [
      { kind: "door", center: -6.4, width: 1.35, label: "east rear suite lounge door", direction: -1 },
      { kind: "door", center: 0, width: 1.35, label: "reading room door", direction: 1 },
    ] });
    buildWallRun({ axis: "z", fixed: 5, start: 3.35, end: 12, floorY: FLOOR.UPPER, name: "upper-east-front-spine", openings: [{ kind: "door", center: 7.3, width: 1.35, label: "east front suite door", direction: -1 }] });
    // The center rear room is now an open lounge flowing around the stair
    // guard. The side bedrooms stay private and open directly into the lounge.
    buildWallRun({ axis: "x", fixed: -3.2, start: -15, end: -5, floorY: FLOOR.UPPER, name: "upper-primary-front-wall", openings: [
      // En-suite access into the upper grand bathroom, set between the primary
      // portraits and the bathroom vanity so it clears both; swings into the suite.
      { kind: "door", center: -10.85, width: 1.0, label: "primary bathroom door", direction: 1 },
    ] });
    buildWallRun({ axis: "x", fixed: -3.2, start: 5, end: 15, floorY: FLOOR.UPPER, name: "upper-east-rear-front-wall", openings: [] });
    buildWallRun({ axis: "x", fixed: 3.2, start: -15, end: -5, floorY: FLOOR.UPPER, name: "upper-west-front-divider", openings: [{ kind: "door", center: -9.7, width: 0.95, label: "west dressing room", direction: 1 }] });
    buildWallRun({ axis: "x", fixed: 3.2, start: 5, end: 15, floorY: FLOOR.UPPER, name: "upper-east-front-divider", openings: [{ kind: "door", center: 9.7, width: 0.95, label: "east dressing room", direction: -1 }] });
  }

  function buildBasementPartitions() {
    buildWallRun({ axis: "z", fixed: -1.3, start: -3.2, end: 12, floorY: FLOOR.BASEMENT, material: M.limestone, name: "basement-west-corridor-wall", openings: [
      { kind: "door", center: 0, width: 1.35, label: "laundry door", direction: 1 },
      { kind: "door", center: 7.2, width: 1.35, label: "wine cellar door", direction: -1 },
    ] });
    buildWallRun({ axis: "z", fixed: 1.3, start: -3.2, end: 12, floorY: FLOOR.BASEMENT, material: M.limestone, name: "basement-east-corridor-wall", openings: [
      { kind: "door", center: 0, width: 1.35, label: "pantry door", direction: -1 },
      { kind: "door", center: 7.2, width: 1.35, label: "archive door", direction: 1 },
    ] });
    buildWallRun({ axis: "x", fixed: -3.2, start: -15, end: 11.3, floorY: FLOOR.BASEMENT, material: M.limestone, name: "basement-cross-corridor-front", openings: [{ kind: "arch", center: 0, width: 2.2, height: 2.8 }] });
    buildWallRun({ axis: "x", fixed: -4.9, start: -15, end: 15, floorY: FLOOR.BASEMENT, material: M.limestone, name: "basement-rear-rooms", openings: [
      { kind: "door", center: -10.2, width: 1.35, label: "boiler room door", direction: 1 },
      { kind: "door", center: -2.3, width: 1.35, label: "workshop door", direction: -1 },
      { kind: "door", center: 4.5, width: 1.35, label: "cold room door", direction: 1 },
      { kind: "door", center: 11.2, width: 1.35, label: "bulk storage door", direction: -1 },
    ] });
    buildWallRun({ axis: "z", fixed: -6, start: -12, end: -4.9, floorY: FLOOR.BASEMENT, material: M.limestone, name: "basement-boiler-divider", openings: [] });
    buildWallRun({ axis: "z", fixed: 7.6, start: -12, end: -4.9, floorY: FLOOR.BASEMENT, material: M.limestone, name: "basement-storage-divider", openings: [] });
  }

  function furnishMainFloor() {
    addFoyerPanelwork();
    // Library
    for (const z of [4.8, 7.9, 10.95]) addBookshelf(-14.5, z, FLOOR.MAIN, -Math.PI / 2, 1.25, 2.85);
    addFireplace("library fireplace", -5.35, 10.25, FLOOR.MAIN, Math.PI / 2);
    addSofa(-8.2, 8.3, FLOOR.MAIN, Math.PI, 2.45, M.greenRug);
    addTable(-10.5, 5.2, 2.25, 1.05, FLOOR.MAIN, 0, M.darkWood);
    addChair(-10.5, 6.15, FLOOR.MAIN, 0, M.darkWood);
    new Cabinet({ name: "library drinks cabinet", x: -13.9, z: 3.75, floorY: FLOOR.MAIN, width: 1.5, height: 1.72, rotationY: 0 });

    // Music room — the sofa is deliberately aimed at the grand piano.
    addFireplace("music room fireplace", 5.35, 10.25, FLOOR.MAIN, -Math.PI / 2);
    const musicPiano = { x: 11.2, z: 5.4 };
    const musicSofa = { x: 7.4, z: 9.2 };
    const musicRoomSofa = addSofa(musicSofa.x, musicSofa.z, FLOOR.MAIN, faceTargetYaw(musicSofa.x, musicSofa.z, musicPiano.x, musicPiano.z), 2.5, M.velvet);
    musicRoomSofa.name = "music-room-piano-facing-sofa";
    musicRoomSofa.userData.faces = "music-room-grand-piano";
    const musicRoomPiano = addPiano(musicPiano.x, musicPiano.z, FLOOR.MAIN, -0.55);
    musicRoomPiano.name = "music-room-grand-piano";
    addTable(9.2, 7.4, 1.1, 0.65, FLOOR.MAIN, -Math.PI / 4, M.darkWood);
    addWallPortrait({ axis: "z", fixed: 15, center: 7.8, floorY: FLOOR.MAIN, centerY: 2.15, side: -1, width: 1.15, height: 1.7, color: 0x28222b, artId: "patron-empty-plates", circuitName: "music room lights" });

    // Painting room; all three door approaches keep a broad clear aisle.
    addPaintingStudio(9.35, 1.15, FLOOR.MAIN);
    for (const artwork of [
      { axis: "z", fixed: 10.4, center: -1.7, centerY: 2.35, side: -1, width: 1.35, height: 0.9, artId: "five-doors", circuitName: "painting room lights" },
      { axis: "z", fixed: 10.4, center: 0.1, centerY: 2.55, side: -1, width: 0.65, height: 0.95, artId: "arrived-early", circuitName: "painting room lights" },
      { axis: "z", fixed: 5, center: -1.9, centerY: 2.2, side: 1, width: 1.0, height: 1.35, artId: "moths-guests", circuitName: "painting room lights" },
      { axis: "z", fixed: 5, center: 1.9, centerY: 2.15, side: 1, width: 0.95, height: 1.25, artId: "polite-eclipse", circuitName: "painting room lights" },
      { axis: "x", fixed: 3.2, center: 6.15, centerY: 2.2, side: -1, width: 1.0, height: 1.3, artId: "garden-knees", circuitName: "painting room lights" },
      { axis: "x", fixed: -3.2, center: 6.15, centerY: 2.2, side: 1, width: 1.0, height: 1.3, artId: "choir-floorboards", circuitName: "painting room lights" },
    ]) {
      addWallPortrait({ ...artwork, floorY: FLOOR.MAIN, color: 0x242127 });
    }

    // Dining room
    addTable(-9.7, -8.4, 5.6, 1.5, FLOOR.MAIN, 0, M.darkWood);
    addChair(-12.0, -7.25, FLOOR.MAIN, 0, M.darkWood);
    addChair(-12.0, -9.55, FLOOR.MAIN, Math.PI, M.darkWood);
    addChair(-10.45, -7.25, FLOOR.MAIN, 0, M.darkWood);
    addChair(-10.45, -9.55, FLOOR.MAIN, Math.PI, M.darkWood);
    addChair(-8.95, -7.25, FLOOR.MAIN, 0, M.darkWood);
    addChair(-8.95, -9.55, FLOOR.MAIN, Math.PI, M.darkWood);
    addChair(-7.4, -7.25, FLOOR.MAIN, 0, M.darkWood);
    addChair(-7.4, -9.55, FLOOR.MAIN, Math.PI, M.darkWood);
    addChair(-12.7, -8.4, FLOOR.MAIN, -Math.PI / 2, M.darkWood);
    addChair(-6.7, -8.4, FLOOR.MAIN, Math.PI / 2, M.darkWood);
    new Cabinet({ name: "dining sideboard", x: -14.0, z: -11.55, floorY: FLOOR.MAIN, width: 1.6, height: 1.35, rotationY: 0 });
    // Ballroom — open marble dance floor, with no furniture in circulation.
    for (const portrait of [
      { x: -1.95, artId: "infinite-giveaway", crop: { repeatX: 0.5, offsetX: 0 }, circuitName: "ballroom lights" },
      { x: 1.95, artId: "infinite-giveaway", crop: { repeatX: 0.5, offsetX: 0.5 }, circuitName: "ballroom lights" },
    ]) addWallPortrait({ axis: "x", fixed: -12, center: portrait.x, floorY: FLOOR.MAIN, centerY: 2.25, side: 1, width: 0.55, height: 1.05, color: 0x24262d, artId: portrait.artId, crop: portrait.crop, circuitName: portrait.circuitName });

    // Kitchen
    addRemodeledKitchen();

    // Foyer and gallery detail
    for (const x of [-3.9, 3.9]) addTable(x, 9.3, 1.2, 0.55, FLOOR.MAIN, Math.PI / 2, M.marble);
    for (const portrait of [
      { x: -11.5, artId: "audit-of-souls", circuitName: "grand stair lights" },
      { x: -6.5, artId: "generosity-engine", circuitName: "grand stair lights" },
      { x: 6.5, artId: "garden-good-deeds", circuitName: "grand stair lights" },
      { x: 10.1, artId: "last-applause", circuitName: "grand stair lights" },
    ]) addWallPortrait({ axis: "x", fixed: -3.2, center: portrait.x, floorY: FLOOR.MAIN, centerY: 2.15, side: -1, width: 1.0, height: 1.42, color: 0x2b2830, artId: portrait.artId, circuitName: portrait.circuitName });
  }

  function furnishUpperFloor() {
    addBed(-10.5, 10.1, FLOOR.UPPER, 0, 2.05, false);
    new Cabinet({ name: "west front walk-in closet", x: -12.8, z: 3.98, floorY: FLOOR.UPPER, width: 2.6, height: 2.6, depth: 1.55, rotationY: 0, walkIn: true });
    addTable(-7.2, 9.3, 1.25, 0.68, FLOOR.UPPER, Math.PI / 2, M.darkWood);
    addChair(-7.2, 8.45, FLOOR.UPPER, Math.PI, M.darkWood);

    addBed(10.5, 10.1, FLOOR.UPPER, 0, 2.05, false);
    new Cabinet({ name: "east front walk-in closet", x: 12.8, z: 3.98, floorY: FLOOR.UPPER, width: 2.6, height: 2.6, depth: 1.55, rotationY: 0, walkIn: true });
    addTable(5.58, 9.55, 1.25, 0.68, FLOOR.UPPER, -Math.PI / 2, M.darkWood);
    addChair(6.48, 9.55, FLOOR.UPPER, Math.PI / 2, M.darkWood);

    addBookshelf(14.45, -2.0, FLOOR.UPPER, Math.PI / 2, 2.2, 2.45);
    addBookshelf(14.45, 2.0, FLOOR.UPPER, Math.PI / 2, 2.3, 2.45);
    addSofa(9.0, 0.0, FLOOR.UPPER, -Math.PI / 2, 2.25, M.greenRug);

    addBed(-10.5, -10.1, FLOOR.UPPER, Math.PI, 1.9, false);
    new Cabinet({ name: "primary walk-in closet", x: -6.0, z: -9.2, floorY: FLOOR.UPPER, width: 2.6, height: 2.6, depth: 1.55, rotationY: -Math.PI / 2, walkIn: true });
    addRug(0, -8.35, 6.0, 5.6, FLOOR.UPPER, M.exoticRug, 0);
    addSofa(0, -6.45, FLOOR.UPPER, 0, 3.2, M.velvet);
    addTable(0, -8.25, 1.8, 0.78, FLOOR.UPPER, 0, M.marble);
    addChair(-2.35, -9.75, FLOOR.UPPER, Math.PI, M.darkWood);
    addChair(2.35, -9.75, FLOOR.UPPER, Math.PI, M.darkWood);
    addFireplace("rear lounge fireplace", -4.7, -10.55, FLOOR.UPPER, -Math.PI / 2);
    addBed(10.5, -10.1, FLOOR.UPPER, Math.PI, 1.9, false);
    new Cabinet({ name: "east rear walk-in closet", x: 6.0, z: -9.2, floorY: FLOOR.UPPER, width: 2.6, height: 2.6, depth: 1.55, rotationY: Math.PI / 2, walkIn: true });
    for (const portrait of [
      { x: -12.5, artId: "house-dreams-back", circuitName: "primary suite lights" },
      { x: -7.2, artId: "audit-of-souls", circuitName: "primary suite lights" },
      { x: 7.2, artId: "last-applause", circuitName: "east rear suite lights" },
      { x: 12.5, artId: "generosity-engine", circuitName: "east rear suite lights" },
    ]) addWallPortrait({ axis: "x", fixed: -3.2, center: portrait.x, floorY: FLOOR.UPPER, centerY: 1.72, side: -1, width: 0.85, height: 1.24, color: 0x27252d, artId: portrait.artId, circuitName: portrait.circuitName });
    addWallPortrait({ axis: "z", fixed: -5, center: -8.25, floorY: FLOOR.UPPER, centerY: 1.72, side: 1, width: 0.85, height: 1.24, color: 0x27252d, artId: "banquet-forgot-guests", circuitName: "rear lounge lights" });
    addWallPortrait({ axis: "z", fixed: 5, center: -9.2, floorY: FLOOR.UPPER, centerY: 1.72, side: -1, width: 0.85, height: 1.24, color: 0x27252d, artId: "orchard-porcelain-teeth", circuitName: "rear lounge lights" });
  }

  function furnishBasement() {
    for (const z of [5.0, 7.8, 10.5]) addWineRack(-14.35, z, FLOOR.BASEMENT, -Math.PI / 2, 2.25);
    for (const x of [-11.5, -8.8, -6.1, -3.4]) addWineRack(x, 11.55, FLOOR.BASEMENT, 0, 2.35);
    addTable(-8.0, 7.4, 2.6, 1.05, FLOOR.BASEMENT, 0, M.darkWood);
    new Cabinet({ name: "wine cabinet", x: -2.0, z: 9.6, floorY: FLOOR.BASEMENT, width: 1.55, height: 1.9, rotationY: -Math.PI / 2 });

    // Archive — the perimeter is intentionally bare. Three double-sided rows
    // stand well clear of every wall and split at the doorway datum, leaving
    // a continuous cross-aisle plus access around every shelf face and end.
    const archiveRowXs = [3.4, 7.3, 11.2];
    const archiveShelfBanks = [
      { id: "south", z: 5.25, width: 2.1 },
      { id: "north", z: 9.4, width: 2.6 },
    ];
    const archiveCurios = new Map([
      ["1-north", "sealed-ledger"],
      ["2-north", "skull"],
      ["3-south", "reel-to-reel"],
      ["3-north", "specimen-jar"],
    ]);
    archiveRowXs.forEach((x, rowIndex) => archiveShelfBanks.forEach((bank, bankIndex) => {
      const rowNumber = rowIndex + 1;
      addArchiveShelfBank({
        name: `archive-row-${rowNumber}-${bank.id}`,
        x,
        z: bank.z,
        floorY: FLOOR.BASEMENT,
        rotationY: Math.PI / 2,
        width: bank.width,
        height: 3.05,
        depth: 0.72,
        seed: rowIndex * 2 + bankIndex,
        curio: archiveCurios.get(`${rowNumber}-${bank.id}`) || null,
      });
    }));

    // Laundry & linen
    new Cabinet({ name: "linen cupboard", x: -14.2, z: 0.2, floorY: FLOOR.BASEMENT, width: 1.75, height: 2.15, rotationY: Math.PI / 2 });
    addTable(-8.0, -0.1, 2.6, 1.15, FLOOR.BASEMENT, 0, M.darkWood);

    // Pantry storage — five semantic cupboards line the solid walls while the
    // doorway, archive opening, service-stair approach, and broad center aisle
    // stay clear. Pantry stock uses the room ceiling fixture instead of adding
    // five door-operated spots to the estate's fixed shader-light budget.
    new Cabinet({ name: "pantry cupboard", x: 2.1, z: 1.8, floorY: FLOOR.BASEMENT, width: 1.7, height: 2.25, rotationY: Math.PI / 2, stockKind: "pantry-staples", interiorLight: false });
    new Cabinet({ name: "preserves cabinet", x: 6.2, z: 2.65, floorY: FLOOR.BASEMENT, width: 1.8, height: 2.15, rotationY: Math.PI, material: M.darkWood, stockKind: "preserves", interiorLight: false });
    for (const pantryCabinet of [
      { name: "pantry dry-goods cabinet", x: 4.0, stockKind: "dry-goods" },
      { name: "pantry baking cabinet", x: 6.15, stockKind: "baking" },
      { name: "pantry tinned-goods cabinet", x: 8.3, stockKind: "tinned-goods" },
    ]) {
      new Cabinet({
        ...pantryCabinet,
        z: -2.72,
        floorY: FLOOR.BASEMENT,
        width: 1.8,
        height: 2.25,
        depth: 0.56,
        rotationY: 0,
        openAngle: 88,
        material: M.darkWood,
        interiorLight: false,
      });
    }

    addBoiler(-10.2, -8.6, FLOOR.BASEMENT);
    addBoiler(-7.8, -8.8, FLOOR.BASEMENT);
    addPipeRun([[-10.2, -1.35, -8.6], [-10.2, -0.65, -8.6], [-10.2, -0.65, -5.2], [-2.2, -0.65, -5.2]], 0.075, M.copper);
    addPipeRun([[-7.8, -1.3, -8.8], [-7.8, -0.9, -10.7], [4.4, -0.9, -10.7]], 0.065, M.iron);
    addTable(-2.5, -8.2, 3.1, 1.25, FLOOR.BASEMENT, 0, M.darkWood);
    new Cabinet({ name: "workshop tool cabinet", x: -5.3, z: -8.4, floorY: FLOOR.BASEMENT, width: 1.6, height: 1.75, rotationY: Math.PI / 2 });
    for (const x of [9.0, 11.1, 13.2]) box({ name: "storage-crate", w: 1.25, h: 1.0 + ((x * 10) % 2) * 0.35, d: 1.15, x, y: FLOOR.BASEMENT + 0.5, z: -8.2, material: M.darkWood, collider: true });
  }

  function addContestantThirteenLibraryNote() {
    const group = new THREE.Group();
    group.name = "contestant-13-library-rulebook";
    group.position.set(-10.5, FLOOR.MAIN + 0.87, 5.2);
    group.rotation.y = -0.12;
    scene.add(group);
    box({ name: "contestant-13-library-rulebook-bottom-cover", w: 0.62, h: 0.035, d: 0.82, y: 0.018, material: M.leather, parent: group, cast: false });
    box({ name: "contestant-13-library-rulebook-pages", w: 0.56, h: 0.07, d: 0.75, y: 0.066, material: M.canvasLinen, parent: group, cast: false });
    const cover = box({ name: "contestant-13-library-rulebook-cover", w: 0.62, h: 0.035, d: 0.82, y: 0.12, material: M.leather, parent: group, cast: false });
    box({ name: "contestant-13-library-rulebook-brass-13", w: 0.18, h: 0.018, d: 0.28, y: 0.145, z: 0.04, material: M.brass, parent: group, cast: false });
    const note = plane({ name: "contestant-13-library-hidden-note", w: 0.45, h: 0.63, y: 0.146, z: -0.02, rotationX: -Math.PI / 2, rotationZ: 0.06, material: M.canvasLinen, parent: group });
    contestant13Scene.libraryNote = group;
    contestant13Quest.registerInteraction(
      "library-note",
      [cover, note],
      () => state.contestant13.noteRead ? "Reread Contestant 13's note" : "Examine Contestant 13's rulebook",
      () => contestant13Quest.readNote(),
    );
  }

  function addContestantThirteenGardenShovel() {
    const shovelLayout = CONTESTANT_13.world.shovel;
    const group = new THREE.Group();
    group.name = "contestant-13-garden-shovel";
    group.position.set(shovelLayout.x, YARD_LAYOUT.groundY + shovelLayout.yOffset, shovelLayout.z);
    group.scale.setScalar(shovelLayout.scale);
    group.rotation.x = 0.08;
    group.rotation.y = 0.24;
    group.rotation.z = -1.42;
    scene.add(group);
    cylinder({ name: "contestant-13-garden-shovel-shaft", radius: 0.035, height: 1.45, segments: 10, y: 0.79, material: M.darkWood, parent: group });
    roundedBox({ name: "contestant-13-garden-shovel-blade", w: 0.34, h: 0.42, d: 0.075, radius: 0.055, y: 0.08, material: M.iron, parent: group });
    box({ name: "contestant-13-garden-shovel-tread", w: 0.42, h: 0.055, d: 0.11, y: 0.31, material: M.iron, parent: group, cast: false });
    const grip = new THREE.Group();
    grip.position.y = 1.55;
    group.add(grip);
    cylinder({ name: "contestant-13-garden-shovel-grip-left", radius: 0.03, height: 0.32, segments: 9, x: -0.13, rotationZ: -0.75, material: M.darkWood, parent: grip });
    cylinder({ name: "contestant-13-garden-shovel-grip-right", radius: 0.03, height: 0.32, segments: 9, x: 0.13, rotationZ: 0.75, material: M.darkWood, parent: grip });
    box({ name: "contestant-13-garden-shovel-xiii-mark", w: 0.1, h: 0.015, d: 0.045, x: 0.038, y: 1.05, z: 0.04, material: M.brass, parent: group, cast: false });
    const hitMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
    const hitbox = box({ name: "contestant-13-garden-shovel-hitbox", w: 0.7, h: 1.85, d: 0.7, y: 0.82, material: hitMaterial, parent: group, cast: false, receive: false });
    hitbox.visible = false;
    contestant13Scene.shovel = group;
    contestant13Quest.registerInteraction(
      "garden-shovel",
      [hitbox],
      () => "Take concealed garden shovel",
      () => contestant13Quest.takeShovel(),
    );
  }

  function addContestantThirteenDigSite() {
    const goal = mazeCellCenter(19, 3);
    const group = new THREE.Group();
    group.name = "contestant-13-dig-site";
    group.position.set(goal.x, YARD_LAYOUT.groundY, goal.z);
    scene.add(group);
    const mound = cylinder({ name: "contestant-13-dig-site-disturbed-earth", radius: 0.46, radiusTop: 0.42, radiusBottom: 0.48, height: 0.055, segments: 24, y: 0.03, material: M.gardenSoil, parent: group, cast: false });
    const hole = cylinder({ name: "contestant-13-dig-site-open-hole", radius: 0.43, height: 0.02, segments: 24, y: 0.045, material: M.soot, parent: group, cast: false });
    hole.visible = false;
    const marker = new THREE.Group();
    marker.name = "contestant-13-dig-site-marker";
    group.add(marker);
    const markStrokes = [
      [-0.22, 0, 0.72], [-0.22, 0, -0.72],
      [0, 0, 0], [0.12, 0, 0], [0.24, 0, 0],
    ];
    markStrokes.forEach(([x, z, rotationY], index) => {
      roundedBox({ name: `contestant-13-dig-site-mark-${index + 1}`, w: 0.025, h: 0.012, d: 0.18, radius: 0.006, x, y: 0.058, z, rotationY, material: M.darkFloor, parent: marker, cast: false });
    });
    contestant13Scene.digMound = mound;
    contestant13Scene.digMarker = marker;
    contestant13Scene.digHole = hole;
    contestant13Quest.registerInteraction(
      "maze-dig-site",
      [mound, hole],
      () => {
        if (state.contestant13.digSiteExcavated) return "Inspect empty hole";
        if (state.contestant13.digging) return "Digging beneath the faint mark…";
        return contestant13Quest.hasItem("garden-shovel") ? "Dig beneath the faint XIII mark" : "Faintly disturbed earth — need a shovel";
      },
      () => contestant13Quest.digSite(),
    );
  }

  function addContestantThirteenArchiveCage() {
    const recorderRoot = contestant13Scene.archiveRecorderRoot;
    const recorderDeck = contestant13Scene.archiveRecorderDeck;
    if (!recorderRoot || !recorderDeck) return;
    const cage = new THREE.Group();
    cage.name = "contestant-13-archive-cage";
    recorderRoot.add(cage);
    const cageBrass = new THREE.MeshStandardMaterial({ color: 0xd0aa5d, emissive: 0x5c3510, emissiveIntensity: 0.72, metalness: 0.78, roughness: 0.3 });
    roundedBox({ name: "contestant-13-archive-cage-contrast-back", w: 0.72, h: 0.62, d: 0.035, radius: 0.025, y: 0.27, z: -0.08, material: M.leather, parent: cage, cast: false });
    const door = new THREE.Group();
    door.name = "contestant-13-archive-cage-door";
    door.position.set(-0.34, 0, 0.18);
    cage.add(door);
    for (const x of [0.04, 0.18, 0.32, 0.46, 0.6]) {
      box({ name: "contestant-13-archive-cage-vertical-bar", w: 0.04, h: 0.55, d: 0.035, x, y: 0.25, material: cageBrass, parent: door, cast: false });
    }
    for (const y of [0, 0.5]) box({ name: "contestant-13-archive-cage-horizontal-bar", w: 0.66, h: 0.04, d: 0.035, x: 0.32, y, material: cageBrass, parent: door, cast: false });
    const latch = box({ name: "contestant-13-archive-cage-a3-lock", w: 0.15, h: 0.18, d: 0.08, x: 0.66, y: 0.24, z: 0.015, material: M.iron, parent: door, cast: false });
    box({ name: "contestant-13-archive-cage-routing-card", w: 0.4, h: 0.23, d: 0.025, x: 0, y: 0.05, z: 0.11, material: M.canvasLinen, parent: cage, cast: false });
    box({ name: "contestant-13-archive-cage-a3-placard", w: 0.28, h: 0.11, d: 0.025, x: 0, y: 0.57, z: 0.12, material: M.canvasLinen, parent: cage, cast: false });
    for (const x of [-0.075, 0, 0.075]) box({ name: "contestant-13-archive-cage-a3-placard-mark", w: 0.025, h: 0.065, d: 0.012, x, y: 0.57, z: 0.139, material: cageBrass, parent: cage, cast: false });
    contestant13Scene.archiveCageDoor = door;
    contestant13Quest.registerInteraction(
      "archive-cage",
      [latch, recorderDeck],
      () => {
        if (!state.contestant13.archiveCageUnlocked) return contestant13Quest.hasItem("archive-key-a3") ? "Unlock evidence cage A-3" : "Evidence cage A-3 — locked";
        return state.contestant13.recordingPlayed ? "Replay Contestant 13's recording" : "Play Contestant 13's recording";
      },
      () => state.contestant13.archiveCageUnlocked ? contestant13Quest.playRecording() : contestant13Quest.unlockArchiveCage(),
    );
  }

  function addContestantThirteenCameraRelay() {
    const group = new THREE.Group();
    group.name = "contestant-13-camera-relay";
    group.position.set(-2.5, FLOOR.BASEMENT, -11.76);
    scene.add(group);
    const panel = box({ name: "contestant-13-camera-relay-panel", w: 1.34, h: 1.18, d: 0.16, y: 1.55, material: M.iron, parent: group, cast: true });
    box({ name: "contestant-13-camera-relay-inner-board", w: 1.12, h: 0.94, d: 0.045, y: 1.55, z: 0.105, material: M.blackWood, parent: group, cast: false });
    box({ name: "contestant-13-camera-relay-public-label", w: 0.42, h: 0.1, d: 0.025, x: -0.31, y: 1.97, z: 0.14, material: M.brass, parent: group, cast: false });
    const publicCables = new THREE.Group();
    publicCables.name = "contestant-13-camera-relay-public-cables";
    group.add(publicCables);
    for (const x of [-0.46, -0.31, -0.16]) cylinder({ name: "contestant-13-camera-relay-public-cable", radius: 0.025, height: 0.62, segments: 8, x, y: 1.48, z: 0.15, material: M.copper, parent: publicCables, cast: false });
    const privateCables = new THREE.Group();
    privateCables.name = "contestant-13-camera-relay-private-cables";
    group.add(privateCables);
    for (const x of [0.16, 0.31, 0.46]) cylinder({ name: "contestant-13-camera-relay-unlabelled-cable", radius: 0.027, height: 0.62, segments: 8, x, y: 1.48, z: 0.15, material: M.soot, parent: privateCables, cast: false });
    const onlineMaterial = new THREE.MeshStandardMaterial({ color: 0x6aa56c, emissive: 0x3e8e47, emissiveIntensity: 1.4, roughness: 0.38 });
    const alarmMaterial = new THREE.MeshStandardMaterial({ color: 0x8b211d, emissive: 0xff2c20, emissiveIntensity: 2.4, roughness: 0.32 });
    const onlineBulb = sphere({ name: "contestant-13-camera-relay-online-bulb", radius: 0.055, x: -0.48, y: 2.0, z: 0.17, material: onlineMaterial, parent: group, cast: false });
    const alarmBulb = sphere({ name: "contestant-13-camera-relay-alarm-bulb", radius: 0.065, x: 0.48, y: 2.0, z: 0.17, material: alarmMaterial, parent: group, cast: false });
    alarmBulb.visible = false;
    contestant13Scene.relayBlackCables = privateCables;
    contestant13Scene.relayOnlineBulb = onlineBulb;
    contestant13Scene.relayAlarmBulb = alarmBulb;
    contestant13Scene.relayAlarmMaterial = alarmMaterial;
    contestant13Quest.registerInteraction(
      "workshop-relay",
      [panel, ...privateCables.children],
      () => {
        if (state.contestant13.relaySabotaged) return "Private camera feed is dead";
        return state.contestant13.recordingPlayed ? "Sabotage the patron camera relay" : "Inspect camera relay";
      },
      () => contestant13Quest.sabotageRelay(),
    );
  }

  function buildContestantThirteenQuest() {
    contestant13Quest = new ContestantThirteenQuest();
    addContestantThirteenLibraryNote();
    addContestantThirteenGardenShovel();
    addContestantThirteenDigSite();
    addContestantThirteenArchiveCage();
    addContestantThirteenCameraRelay();
    contestant13Quest.updateUI();
  }

  function buildLighting() {
    const foyer = new LightCircuit("foyer chandelier", FLOOR.UPPER, 0xffc47a, true);
    foyer.addLevel("MAIN LEVEL");
    addFoyerGrandChandelier(foyer, 0, 7.7);
    // An omnidirectional fill floating at chandelier height carries light to
    // the balcony rail, the upper walls, and the void — the double-height
    // volume reads lit in every direction, not just in a downward shaft.
    foyer.addPracticalLight(0, FLOOR.UPPER + 1.9, 7.7, 20, 7.8, ["MAIN LEVEL", "SECOND FLOOR"], { contained: false });
    // The foyer is a double-height volume overlooked by the balcony: its
    // sconces are visible from both floors, so they render on both floor
    // contexts and never hand over during a stair transition.
    for (const side of [-1, 1]) for (const z of [5.35, 8.9]) {
      foyer.addWallSconce(side * 4.81, FLOOR.MAIN + 2.23, z, -side * Math.PI / 2, 24, 5.6, ["MAIN LEVEL", "SECOND FLOOR"], side * 0.6, FLOOR.MAIN + 0.75, z);
    }
    foyer.addSwitch(-1.75, 1.15, 11.839, Math.PI);
    foyer.addSwitch(-4.839, FLOOR.UPPER + 1.15, 5.45, Math.PI / 2);

    // The stair hall is double-height; hang its chandelier from the upper ceiling.
    const stair = new LightCircuit("grand stair lights", FLOOR.UPPER, 0xffb65d, true);
    stair.addLevel("MAIN LEVEL");
    stair.addFixture(0, -0.1, "atrium");
    // Everything hanging in the open stair volume stays lit on both floor
    // contexts: the player looks straight at these fixtures mid-climb, so
    // they can never participate in a floor handover.
    for (const side of [-1, 1]) {
      const wallX = side * 4.839;
      // Mount at the same height as the rear pair below so all four stair-hall
      // sconces read as one level line along each wall.
      stair.addWallSconce(wallX, FLOOR.MAIN + 2.0, 0.9, -side * Math.PI / 2, 34, 5.7, ["MAIN LEVEL", "SECOND FLOOR"], side * 0.45, FLOOR.MAIN + 0.75, 0.35);
    }
    // A hidden omnidirectional bounce mid-void keeps the dark-oak stair, the
    // landing edge above, and the surrounding walls readable without adding
    // another low-hanging fixture to the circulation path.
    stair.addPracticalLight(0, FLOOR.MAIN + 4.1, -0.35, 26, 7.2, ["MAIN LEVEL", "SECOND FLOOR"], { contained: false });
    // A restrained under-landing fill gives the finished timber soffits the
    // warm return light that would come from the paired wall sconces. It is
    // owned by this circuit, so it never changes without the stair switch.
    stair.addPracticalLight(0, FLOOR.MAIN + 1.45, -0.45, 24, 5.0, ["MAIN LEVEL"], { contained: true, angle: 0.76 });
    stair.addWallSconce(-4.839, FLOOR.MAIN + 2.0, -1.8, Math.PI / 2, 38, 5.7, ["MAIN LEVEL", "SECOND FLOOR"], -0.45, FLOOR.MAIN + 0.85, -1.05);
    stair.addWallSconce(4.839, FLOOR.MAIN + 2.0, -1.8, -Math.PI / 2, 38, 5.7, ["MAIN LEVEL", "SECOND FLOOR"], 0.45, FLOOR.MAIN + 0.85, -1.05);
    stair.addSwitch(-4.839, 1.15, 2.45, Math.PI / 2);

    const library = new LightCircuit("library lights", FLOOR.MAIN, 0xffb56b, true);
    library.addFixture(-10, 7.7, "small");
    library.addFixtureSupportFill(-10, 7.7, 42, 6.2, 0.82);
    // The west wall is all bookcases and window bays. Mount this sconce on the
    // clear south-wall panel between the bathroom door and the east wall.
    library.addWallSconce(-7.05, FLOOR.MAIN + 2.0, 3.361, 0, 32, 5.8, ["MAIN LEVEL"], -9.45, FLOOR.MAIN + 1.05, 7.55);
    library.addSwitch(-5.161, 1.15, 5.85, -Math.PI / 2);

    const music = new LightCircuit("music room lights", FLOOR.MAIN, 0xffb56b, true);
    music.addFixture(10, 7.7, "small");
    music.addFixtureSupportFill(10, 7.7, 42, 6.2, 0.82);
    music.addWallSconce(14.839, FLOOR.MAIN + 2.0, 10.75, -Math.PI / 2, 34, 5.8, ["MAIN LEVEL"], 10.1, FLOOR.MAIN + 1.05, 9.6);
    music.addSwitch(5.161, 1.15, 5.85, Math.PI / 2);

    const mainHallBathroom = new LightCircuit("main hall bathroom lights", FLOOR.MAIN, 0xffc982, true);
    mainHallBathroom.addFixture(-8.4, 0, "bathroom");
    mainHallBathroom.addShowerDownlight("main-hall-bathroom", -13.55, 2.28);
    mainHallBathroom.addSwitch(-5.161, 1.15, 1.15, -Math.PI / 2);
    // Keep both doorway controls on the bathroom faces of their walls and
    // clear of the vanity and door casing.
    mainHallBathroom.addSwitch(-8.75, 1.15, -3.039, 0);
    mainHallBathroom.addSwitch(-8.5, 1.15, 3.039, Math.PI);

    const painting = new LightCircuit("painting room lights", FLOOR.MAIN, 0xffa95e, true);
    painting.addFixture(8.2, 0, "small");
    painting.addFixtureSupportFill(8.2, 0, 32, 5.6, 0.78);
    // Keep both two-way controls on the painting-room face of their walls and
    // clear of the door casings. Their previous normals pointed out of the
    // room, while the south control crowded the gallery doorway.
    painting.addSwitch(7.25, 1.15, 3.039, Math.PI);
    painting.addSwitch(7.25, 1.15, -3.039, 0);

    const dining = new LightCircuit("dining room lights", FLOOR.MAIN, 0xffa968, true);
    dining.addFixture(-9.7, -8.4, "grand");
    dining.addSwitch(-5.161, 1.15, -4.2, -Math.PI / 2);

    const ballroom = new LightCircuit("ballroom lights", FLOOR.MAIN, 0xffbf79, true);
    ballroom.addFixture(0, -8.3, "grand");
    ballroom.addSwitch(-4.839, 1.15, -4.2, Math.PI / 2);

    const kitchen = new LightCircuit("kitchen lights", FLOOR.MAIN, 0xffd29a, true);
    addKitchenLightingFixtures(kitchen);
    kitchen.addSwitch(5.161, 1.15, -4.2, Math.PI / 2);

    const coatCloset = new LightCircuit("coat closet lights", FLOOR.MAIN, 0xffb66f, true);
    coatCloset.addFixture(COAT_CLOSET.center.x, COAT_CLOSET.center.z, "closet");
    coatCloset.addSwitch(-11.661, 1.15, -2.55, -Math.PI / 2);

    const westFront = new LightCircuit("west front suite lights", FLOOR.UPPER, 0xffb66f, true);
    westFront.addFixture(-9.6, 7.6, "small");
    westFront.addPracticalLight(-9.6, FLOOR.UPPER + 2.43, 7.6, 36, 5.9, ["SECOND FLOOR"], { contained: true, angle: 0.82, targetY: FLOOR.UPPER + 0.2 });
    westFront.addWallSconce(-14.839, FLOOR.UPPER + 1.9, 8.0, Math.PI / 2, 28, 5.6, ["SECOND FLOOR"], -10.2, FLOOR.UPPER + 1.0, 8.0);
    westFront.addSwitch(-5.161, FLOOR.UPPER + 1.15, 6.15, -Math.PI / 2);

    const eastFront = new LightCircuit("east front suite lights", FLOOR.UPPER, 0xffb66f, true);
    eastFront.addFixture(9.6, 7.6, "small");
    eastFront.addPracticalLight(9.6, FLOOR.UPPER + 2.43, 7.6, 36, 5.9, ["SECOND FLOOR"], { contained: true, angle: 0.82, targetY: FLOOR.UPPER + 0.2 });
    eastFront.addWallSconce(14.839, FLOOR.UPPER + 1.9, 8.0, -Math.PI / 2, 28, 5.6, ["SECOND FLOOR"], 10.2, FLOOR.UPPER + 1.0, 8.0);
    eastFront.addSwitch(5.161, FLOOR.UPPER + 1.15, 6.15, Math.PI / 2);

    const upperGrandBathroom = new LightCircuit("upper grand bathroom lights", FLOOR.UPPER, 0xffc982, true);
    upperGrandBathroom.addFixture(-8.8, 0, "bathroom");
    upperGrandBathroom.addShowerDownlight("upper-grand-bathroom", -13.55, 2.28);
    upperGrandBathroom.addSwitch(-5.161, FLOOR.UPPER + 1.15, 1.0, -Math.PI / 2);
    upperGrandBathroom.addSwitch(-9.9, FLOOR.UPPER + 1.15, -3.039, 0);
    // The north-wall control faces south into the bathroom rather than
    // presenting its back plate through the wall toward the front suite.
    upperGrandBathroom.addSwitch(-8.7, FLOOR.UPPER + 1.15, 3.039, Math.PI);

    const readingRoom = new LightCircuit("reading room lights", FLOOR.UPPER, 0xffb975, true);
    readingRoom.addFixture(9, 0, "small");
    // The east wall is a window bay flanked by full-height bookcases. Mount
    // this lamp on the clear south-wall panel so every part reads as a fixture.
    readingRoom.addWallSconce(10.0, FLOOR.UPPER + 1.9, -3.039, 0, 28, 5.4, ["SECOND FLOOR"], 9.0, FLOOR.UPPER + 1.0, 0);
    readingRoom.addSwitch(5.161, FLOOR.UPPER + 1.15, 1.15, Math.PI / 2);

    // The landing overlooks the open stair void, so its lights are readable
    // from the main hall below and stay rendered on both floor contexts.
    const upperLanding = new LightCircuit("upper landing lights", FLOOR.UPPER, 0xffb86c, true);
    upperLanding.addLevel("MAIN LEVEL");
    upperLanding.addWallSconce(-4.839, FLOOR.UPPER + 1.95, -1.15, Math.PI / 2, 44, 5.8, ["SECOND FLOOR", "MAIN LEVEL"], -0.5, FLOOR.UPPER + 0.72, -1.45);
    upperLanding.addWallSconce(4.839, FLOOR.UPPER + 1.95, -1.15, -Math.PI / 2, 44, 5.8, ["SECOND FLOOR", "MAIN LEVEL"], 0.5, FLOOR.UPPER + 0.72, -1.45);
    upperLanding.addPracticalLight(0, FLOOR.UPPER + 2.72, -2.15, 22, 6.5, ["SECOND FLOOR", "MAIN LEVEL"], { contained: false });
    upperLanding.addSwitch(4.839, FLOOR.UPPER + 1.15, 2.4, -Math.PI / 2);

    const primary = new LightCircuit("primary suite lights", FLOOR.UPPER, 0xffb66f, true);
    primary.addFixture(-9.6, -8.2, "small");
    primary.addFixtureSupportFill(-9.6, -8.2, 34, 5.9, 0.82);
    primary.addWallSconce(-8.35, FLOOR.UPPER + 1.9, -3.361, Math.PI, 27, 5.0, ["SECOND FLOOR"], -8.35, FLOOR.UPPER + 0.65, -6.1);
    primary.addSwitch(-5.161, FLOOR.UPPER + 1.15, -5.2, -Math.PI / 2);

    const rearLounge = new LightCircuit("rear lounge lights", FLOOR.UPPER, 0xffb66f, true);
    rearLounge.addFixture(0, -8.2, "small");
    rearLounge.addFixtureSupportFill(0, -8.2, 36, 6.0, 0.82);
    rearLounge.addSwitch(-4.839, FLOOR.UPPER + 1.15, -4.3, Math.PI / 2);

    const eastRear = new LightCircuit("east rear suite lights", FLOOR.UPPER, 0xffb66f, true);
    eastRear.addFixture(9.6, -8.2, "small");
    eastRear.addFixtureSupportFill(9.6, -8.2, 34, 5.9, 0.82);
    eastRear.addWallSconce(8.35, FLOOR.UPPER + 1.9, -3.361, Math.PI, 27, 5.0, ["SECOND FLOOR"], 8.35, FLOOR.UPPER + 0.65, -6.1);
    eastRear.addSwitch(5.161, FLOOR.UPPER + 1.15, -5.2, Math.PI / 2);

    // One two-way circuit owns both visible stair fixtures. Either physical
    // switch therefore changes the top and bottom lights together.
    const serviceStair = new LightCircuit("service stair lights", FLOOR.MAIN, 0xffa75a, true);
    serviceStair.addLevel("BASEMENT");
    serviceStair.addFixture(12.55, -2.25, "corridor", FLOOR.MAIN);
    serviceStair.addFixture(12.55, 4.4, "corridor", FLOOR.BASEMENT);
    serviceStair.addSwitch(13.72, FLOOR.MAIN + 1.15, -3.039, 0);
    serviceStair.addSwitch(14.839, FLOOR.BASEMENT + 1.15, 2.4, -Math.PI / 2);

    const basementHall = new LightCircuit("basement corridor lights", FLOOR.BASEMENT, 0xffa254, true);
    for (const z of [-0.6, 4.45, 9.5]) basementHall.addFixture(0, z, "corridor");
    basementHall.addSwitch(1.139, FLOOR.BASEMENT + 1.15, -2.5, -Math.PI / 2);

    const wine = new LightCircuit("wine cellar lights", FLOOR.BASEMENT, 0xff9d4b, true);
    for (const x of [-11.3, -8.05, -4.8]) wine.addFixture(x, 7.4, "basement");
    wine.addSwitch(-1.461, FLOOR.BASEMENT + 1.15, 6.2, -Math.PI / 2);

    const archive = new LightCircuit("archive lights", FLOOR.BASEMENT, 0xffa864, true);
    for (const x of [4.8, 8.05, 11.3]) archive.addFixture(x, 7.4, "basement");
    archive.addSwitch(1.461, FLOOR.BASEMENT + 1.15, 6.2, Math.PI / 2);

    const boiler = new LightCircuit("boiler room lights", FLOOR.BASEMENT, 0xff7e39, true);
    boiler.addFixture(-10.2, -8.5, "basement");
    boiler.addSwitch(-9.0, FLOOR.BASEMENT + 1.15, -5.061, Math.PI);

    const laundry = new LightCircuit("laundry lights", FLOOR.BASEMENT, 0xffa96b, true);
    for (const x of [-11.3, -8.05, -4.8]) laundry.addFixture(x, 0, "basement");
    laundry.addSwitch(-1.461, FLOOR.BASEMENT + 1.15, -1.7, -Math.PI / 2);

    const pantry = new LightCircuit("pantry store lights", FLOOR.BASEMENT, 0xffa96b, true);
    pantry.addFixture(6.0, 0, "basement");
    pantry.addSwitch(1.461, FLOOR.BASEMENT + 1.15, -1.7, Math.PI / 2);

    const rearService = new LightCircuit("rear service corridor lights", FLOOR.BASEMENT, 0xff9b55, true);
    for (const x of [-9.0, 0, 9.0]) rearService.addFixture(x, -4.05, "corridor");
    rearService.addSwitch(0, FLOOR.BASEMENT + 1.15, -4.739, 0);

    const workshop = new LightCircuit("workshop lights", FLOOR.BASEMENT, 0xff9147, true);
    workshop.addFixture(-2.3, -8.2, "basement");
    workshop.addSwitch(-1.0, FLOOR.BASEMENT + 1.15, -5.061, Math.PI);

    const coldRoom = new LightCircuit("cold room lights", FLOOR.BASEMENT, 0xd7e6ff, true);
    coldRoom.addFixture(4.5, -8.2, "basement");
    coldRoom.addSwitch(6.0, FLOOR.BASEMENT + 1.15, -5.061, Math.PI);

    const bulkStorage = new LightCircuit("bulk storage lights", FLOOR.BASEMENT, 0xff9f5f, true);
    bulkStorage.addFixture(11.2, -8.2, "basement");
    bulkStorage.addSwitch(13.0, FLOOR.BASEMENT + 1.15, -5.061, Math.PI);

    bindPortraitMaterialsToLighting();
  }

  function buildEstateYard() {
    yardState.gate = { locked: true, open: false, colliderEnabled: true, deniedAttempts: 0 };
    yardState.maze = { rows: 0, columns: 0, entrance: null, southGoal: null, shortestPathLength: 0 };
    yardState.featureCounts = {
      perimeterHedgeRuns: 0,
      gardenBeds: 0,
      gardenPlants: 0,
      poolComponents: 0,
      mazeHedges: 0,
      exteriorLamps: 0,
      estateTrees: 0,
    };
    yardState.perimeterClosed = false;
    yardState.perimeterSegments = null;
    yardState.perimeterUncoveredIntervals = [];
    buildPerimeterHedges();
    addLockedDrivewayGate();
    derivePerimeterCoverage();
    buildDrivewayAndEstatePaths();
    buildFormalGarden();
    buildEstatePool();
    buildHedgeMaze();
    buildEstateTrees();
    buildEstateLighting();
  }

  function yardJitter(index, salt) {
    return Math.sin((index + 1) * 12.9898 + (salt || 0) * 78.233) * 0.5;
  }

  function addHedgeWallRun(name, axis, fixed, start, end, clumps) {
    const length = end - start;
    const center = (start + end) / 2;
    const groundY = YARD_LAYOUT.groundY;
    if (axis === "x") {
      box({ name, w: length, h: 2.45, d: 0.96, x: center, y: groundY + 1.33, z: fixed, material: M.hedgeDark, cast: false });
      box({ name: `${name}-stone-plinth`, w: length + 0.16, h: 0.28, d: 1.18, x: center, y: groundY + 0.14, z: fixed, material: M.limestone, cast: false });
      physics.addFixedBox(center, groundY + 1.42, fixed, length, 2.85, 1.05, 0);
    } else {
      box({ name, w: 0.96, h: 2.45, d: length, x: fixed, y: groundY + 1.33, z: center, material: M.hedgeDark, cast: false });
      box({ name: `${name}-stone-plinth`, w: 1.18, h: 0.28, d: length + 0.16, x: fixed, y: groundY + 0.14, z: center, material: M.limestone, cast: false });
      physics.addFixedBox(fixed, groundY + 1.42, center, 1.05, 2.85, length, 0);
    }
    const count = Math.max(2, Math.ceil(length / 0.74));
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      for (let layer = 0; layer < 2; layer += 1) {
        const along = lerp(start, end, t);
        const jitter = yardJitter(i + layer * 97, name.length) * 0.13;
        clumps.push({
          x: axis === "x" ? along : fixed + jitter,
          y: groundY + 0.73 + layer * 1.12 + yardJitter(i, layer) * 0.07,
          z: axis === "x" ? fixed + jitter : along,
          sx: 0.55 + Math.abs(yardJitter(i, 2)) * 0.12,
          sy: 0.58 + Math.abs(yardJitter(i, 3)) * 0.12,
          sz: 0.55 + Math.abs(yardJitter(i, 4)) * 0.12,
          ry: yardJitter(i, 5) * 0.45,
        });
      }
    }
    yardState.featureCounts.perimeterHedgeRuns += 1;
  }

  function buildPerimeterHedges() {
    const bounds = YARD_LAYOUT.bounds;
    const gateHalf = YARD_LAYOUT.gate.width / 2 + 0.18;
    const clumps = [];
    yardState.perimeterSegments = {
      north: [[bounds.minX, -gateHalf], [gateHalf, bounds.maxX]],
      south: [[bounds.minX, bounds.maxX]],
      west: [[bounds.minZ, bounds.maxZ]],
      east: [[bounds.minZ, bounds.maxZ]],
    };
    addHedgeWallRun("estate-perimeter-hedge-north-west", "x", bounds.maxZ, bounds.minX, -gateHalf, clumps);
    addHedgeWallRun("estate-perimeter-hedge-north-east", "x", bounds.maxZ, gateHalf, bounds.maxX, clumps);
    addHedgeWallRun("estate-perimeter-hedge-south", "x", bounds.minZ, bounds.minX, bounds.maxX, clumps);
    addHedgeWallRun("estate-perimeter-hedge-west", "z", bounds.minX, bounds.minZ, bounds.maxZ, clumps);
    addHedgeWallRun("estate-perimeter-hedge-east", "z", bounds.maxX, bounds.minZ, bounds.maxZ, clumps);
    addOutdoorInstanceBatch(
      "estate-perimeter-leaf-clumps",
      "yardHedgeClump",
      () => new THREE.IcosahedronGeometry(1, 1),
      M.hedge,
      clumps,
      false,
      true,
    );
  }

  function addLockedDrivewayGate() {
    const z = YARD_LAYOUT.gate.centerZ;
    const groundY = YARD_LAYOUT.groundY;
    const interaction = {
      type: "door",
      getLabel: () => "Locked driveway gate — the storm has sealed the estate",
      activate: () => {
        yardState.gate.deniedAttempts += 1;
        if (audioSystem) audioSystem.ping(57, 0.34, 0.045, "square");
      },
    };
    for (const side of [-1, 1]) {
      const pierX = side * 3.9;
      box({ name: "driveway-gate-stone-pier", w: 1.05, h: 3.25, d: 1.15, x: pierX, y: groundY + 1.62, z, material: M.limestone, collider: true });
      box({ name: "driveway-gate-pier-cap", w: 1.3, h: 0.22, d: 1.4, x: pierX, y: groundY + 3.28, z, material: M.marble });
      sphere({ name: "driveway-gate-finial", radius: 0.27, x: pierX, y: groundY + 3.65, z, material: M.brass });

      const leafCenter = side * 1.7;
      const leafName = side < 0 ? "locked-driveway-gate-left" : "locked-driveway-gate-right";
      const interactionRail = box({ name: leafName, w: 3.35, h: 0.14, d: 0.18, x: leafCenter, y: groundY + 1.42, z, material: M.iron });
      addInteractionTarget(interactionRail, interaction);
      for (const y of [groundY + 0.22, groundY + 2.5]) {
        const rail = box({ name: `${leafName}-rail`, w: 3.35, h: 0.13, d: 0.18, x: leafCenter, y, z, material: M.iron });
        addInteractionTarget(rail, interaction);
      }
      for (const x of [leafCenter - 1.58, leafCenter + 1.58]) {
        const stile = box({ name: `${leafName}-stile`, w: 0.14, h: 2.45, d: 0.18, x, y: groundY + 1.3, z, material: M.iron });
        addInteractionTarget(stile, interaction);
      }
      for (let i = 0; i < 7; i += 1) {
        const x = leafCenter - 1.35 + i * 0.45;
        const bar = box({ name: `${leafName}-bar`, w: 0.055, h: 2.28, d: 0.085, x, y: groundY + 1.3, z, material: M.iron, cast: false });
        addInteractionTarget(bar, interaction);
      }
      addBeamBetween(`${leafName}-scroll-a`, [leafCenter - 1.42, groundY + 0.42, z - 0.02], [leafCenter + 1.42, groundY + 2.25, z - 0.02], 0.035, M.brass);
      addBeamBetween(`${leafName}-scroll-b`, [leafCenter + 1.42, groundY + 0.42, z + 0.02], [leafCenter - 1.42, groundY + 2.25, z + 0.02], 0.035, M.brass);
    }
    const spikes = [];
    for (let i = 0; i < 15; i += 1) spikes.push({ x: -3.15 + i * 0.45, y: groundY + 2.75, z, sx: 0.09, sy: 0.28, sz: 0.09 });
    addOutdoorInstanceBatch("locked-driveway-gate-spikes", "yardGateSpike", () => new THREE.ConeGeometry(1, 1, 8), M.brass, spikes, true, true);
    box({ name: "driveway-gate-lock-escutcheon", w: 0.46, h: 0.58, d: 0.12, x: 0, y: groundY + 1.22, z: z - 0.13, material: M.brass });
    sphere({ name: "driveway-gate-lock", radius: 0.11, x: 0, y: groundY + 1.25, z: z - 0.22, material: M.iron });
    const hitbox = box({
      name: "locked-driveway-gate-hitbox", w: 6.6, h: 2.8, d: 0.28, x: 0, y: groundY + 1.4, z: z - 0.1,
      material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), cast: false, receive: false,
    });
    hitbox.visible = false;
    addInteractionTarget(hitbox, interaction);
    const gateColliderWidth = 7.2;
    physics.addFixedBox(0, groundY + 1.42, z, gateColliderWidth, 2.85, 0.4, 0);
    if (yardState.perimeterSegments) yardState.perimeterSegments.north.push([-gateColliderWidth / 2, gateColliderWidth / 2]);
    yardState.gate.locked = true;
    yardState.gate.open = false;
    yardState.gate.colliderEnabled = true;
  }

  function derivePerimeterCoverage() {
    const bounds = YARD_LAYOUT.bounds;
    const sideRanges = {
      north: [bounds.minX, bounds.maxX],
      south: [bounds.minX, bounds.maxX],
      west: [bounds.minZ, bounds.maxZ],
      east: [bounds.minZ, bounds.maxZ],
    };
    const gaps = [];
    for (const [side, [minimum, maximum]] of Object.entries(sideRanges)) {
      const intervals = (yardState.perimeterSegments && yardState.perimeterSegments[side] || [])
        .map(([start, end]) => [Math.max(minimum, start), Math.min(maximum, end)])
        .filter(([start, end]) => end > start)
        .sort((a, b) => a[0] - b[0]);
      let cursor = minimum;
      for (const [start, end] of intervals) {
        if (start > cursor + 0.001) gaps.push({ side, start: Number(cursor.toFixed(3)), end: Number(start.toFixed(3)) });
        cursor = Math.max(cursor, end);
      }
      if (cursor < maximum - 0.001) gaps.push({ side, start: Number(cursor.toFixed(3)), end: Number(maximum.toFixed(3)) });
    }
    yardState.perimeterUncoveredIntervals = gaps;
    yardState.perimeterClosed = gaps.length === 0 && yardState.gate.locked && yardState.gate.colliderEnabled;
  }

  function buildDrivewayAndEstatePaths() {
    const y = YARD_LAYOUT.groundY + 0.022;
    const garden = YARD_LAYOUT.garden;
    const gardenFrontEndZ = garden.centerZ + garden.depth / 2;
    const frontApproachCenterZ = (gardenFrontEndZ + garden.frontJunctionZ) / 2;
    const frontApproachDepth = garden.frontJunctionZ - gardenFrontEndZ + 0.4;
    box({ name: "wet-cobblestone-driveway", w: YARD_LAYOUT.driveway.width, h: 0.044, d: 19.2, x: 0, y, z: 24.4, material: M.wetPavers, cast: false });
    for (const x of [-3.14, 3.14]) box({ name: "driveway-limestone-edging", w: 0.2, h: 0.09, d: 19.2, x, y: y + 0.035, z: 24.4, material: M.limestone, cast: false });
    box({ name: "front-carriage-turn", w: 27, h: 0.04, d: 2.4, x: 0, y, z: 16.3, material: M.wetPavers, cast: false });
    box({ name: "rear-terrace-pavers", w: 29, h: 0.04, d: 3.4, x: 0, y, z: -14.0, material: M.wetPavers, cast: false });
    // The front route is a deliberate L: carriage turn to west-lawn spur, then
    // straight back to the garden. The rear connector terminates on the exact
    // terrace and garden-spine centerline, with small slab overlaps at seams.
    box({ name: "west-lawn-front-garden-connector", w: 12.0, h: 0.044, d: garden.pathWidth, x: -19.25, y, z: garden.frontJunctionZ, material: M.wetPavers, cast: false });
    box({ name: "formal-garden-front-approach", w: garden.pathWidth, h: 0.044, d: frontApproachDepth, x: garden.centerX, y, z: frontApproachCenterZ, material: M.wetPavers, cast: false });
    box({ name: "garden-approach-path", w: 11.0, h: 0.044, d: garden.pathWidth, x: -19.75, y, z: garden.rearJunctionZ, material: M.wetPavers, cast: false });
    box({ name: "maze-approach-path", w: 10.4, h: 0.04, d: 1.9, x: 15.0, y, z: HEDGE_MAZE_REAR_ENTRANCE.z, material: M.wetPavers, cast: false });
    // Keep the south end at the rear approach while extending the north end to
    // the front carriage centerline. The connector shares that exact centerline
    // so the two slabs read as one clean right-angle junction.
    box({ name: "east-lawn-house-walkway", w: 2.5, h: 0.04, d: 31.05, x: 17.35, y, z: 0.775, material: M.wetPavers, cast: false });
    box({ name: "east-lawn-front-yard-connector", w: 5.1, h: 0.044, d: 2.4, x: 16.05, y, z: 16.3, material: M.wetPavers, cast: false });
    // A second, clearly paved entrance opens the previously remote north half
    // directly onto the house-side promenade.
    box({ name: "maze-north-access-spur", w: 2.9, h: 0.044, d: 1.6, x: 19.95, y, z: 5.75, material: M.wetPavers, cast: false });
  }

  function addGardenBench(x, z, rotationY) {
    const group = new THREE.Group();
    group.position.set(x, YARD_LAYOUT.groundY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    for (const localZ of [-0.16, 0.02, 0.2]) box({ name: "formal-garden-bench-slat", w: 1.8, h: 0.075, d: 0.13, x: 0, y: 0.52, z: localZ, material: M.darkWood, parent: group });
    for (const localY of [0.78, 1.0]) box({ name: "formal-garden-bench-back", w: 1.8, h: 0.075, d: 0.12, x: 0, y: localY, z: 0.33, material: M.darkWood, parent: group });
    for (const side of [-1, 1]) {
      box({ name: "formal-garden-bench-leg", w: 0.1, h: 0.55, d: 0.58, x: side * 0.72, y: 0.28, z: 0.03, material: M.iron, parent: group });
      cylinder({ name: "formal-garden-bench-arm", radius: 0.035, height: 0.62, segments: 8, x: side * 0.84, y: 0.75, z: 0.04, rotationX: Math.PI / 2, material: M.iron, parent: group });
    }
    physics.addFixedBox(x, YARD_LAYOUT.groundY + 0.58, z, 1.95, 1.16, 0.72, rotationY || 0);
  }

  function buildFormalGarden() {
    const groundY = YARD_LAYOUT.groundY;
    const y = groundY + 0.024;
    const garden = YARD_LAYOUT.garden;
    const gardenX = garden.centerX;
    const gardenZ = garden.centerZ;
    box({ name: "formal-garden-path-long", w: garden.pathWidth, h: 0.048, d: garden.depth, x: gardenX, y, z: gardenZ, material: M.wetPavers, cast: false });
    box({ name: "formal-garden-path-cross", w: 14.6, h: 0.048, d: garden.pathWidth, x: gardenX, y, z: gardenZ, material: M.wetPavers, cast: false });
    const beds = [
      { x: gardenX - 4.2, z: gardenZ - 6.3 }, { x: gardenX + 4.2, z: gardenZ - 6.3 },
      { x: gardenX - 4.2, z: gardenZ + 6.3 }, { x: gardenX + 4.2, z: gardenZ + 6.3 },
    ];
    const stems = [];
    const leaves = [];
    const blooms = [[], [], []];
    beds.forEach((bed, bedIndex) => {
      box({ name: `formal-garden-bed-${bedIndex + 1}`, w: 5.45, h: 0.13, d: 8.3, x: bed.x, y: groundY + 0.065, z: bed.z, material: M.gardenSoil, cast: false });
      for (const side of [-1, 1]) {
        box({ name: "formal-garden-bed-border", w: 0.24, h: 0.34, d: 8.55, x: bed.x + side * 2.83, y: groundY + 0.17, z: bed.z, material: M.hedgeDark, cast: false });
        box({ name: "formal-garden-bed-border", w: 5.45, h: 0.34, d: 0.24, x: bed.x, y: groundY + 0.17, z: bed.z + side * 4.28, material: M.hedgeDark, cast: false });
      }
      for (let row = 0; row < 5; row += 1) for (let col = 0; col < 6; col += 1) {
        const plantIndex = bedIndex * 30 + row * 6 + col;
        const px = bed.x - 2.0 + col * 0.8 + yardJitter(plantIndex, 6) * 0.14;
        const pz = bed.z - 3.0 + row * 1.5 + yardJitter(plantIndex, 7) * 0.16;
        const height = 0.46 + Math.abs(yardJitter(plantIndex, 8)) * 0.2;
        stems.push({ x: px, y: groundY + height / 2 + 0.12, z: pz, sx: 0.024, sy: height, sz: 0.024, ry: yardJitter(plantIndex, 9) });
        leaves.push(
          { x: px - 0.06, y: groundY + height * 0.48, z: pz, sx: 0.12, sy: 0.035, sz: 0.075, ry: yardJitter(plantIndex, 24) },
          { x: px + 0.06, y: groundY + height * 0.68, z: pz, sx: 0.12, sy: 0.035, sz: 0.075, ry: yardJitter(plantIndex, 25) },
        );
        blooms[plantIndex % 3].push({ x: px, y: groundY + height + 0.14, z: pz, sx: 0.105, sy: 0.085, sz: 0.105, ry: yardJitter(plantIndex, 10) });
      }
    });
    addOutdoorInstanceBatch("garden-rose-stems", "gardenRoseStem", () => new THREE.CylinderGeometry(1, 1, 1, 6), M.hedge, stems, false, true);
    addOutdoorInstanceBatch("garden-rose-leaves", "gardenRoseLeaf", () => new THREE.IcosahedronGeometry(1, 0), M.hedge, leaves, false, true);
    addOutdoorInstanceBatch("garden-rose-blooms-red", "gardenRoseBloom", () => new THREE.IcosahedronGeometry(1, 1), M.roseRed, blooms[0], false, true);
    addOutdoorInstanceBatch("garden-rose-blooms-ivory", "gardenRoseBloom", () => new THREE.IcosahedronGeometry(1, 1), M.roseIvory, blooms[1], false, true);
    addOutdoorInstanceBatch("garden-rose-blooms-mauve", "gardenRoseBloom", () => new THREE.IcosahedronGeometry(1, 1), M.roseMauve, blooms[2], false, true);

    cylinder({ name: "garden-fountain-basin", radius: 1.72, height: 0.38, segments: 40, x: gardenX, y: groundY + 0.17, z: gardenZ, material: M.limestone });
    const basinRim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 10, 40), M.marble);
    basinRim.name = "garden-fountain-carved-rim";
    basinRim.position.set(gardenX, groundY + 0.38, gardenZ);
    basinRim.rotation.x = Math.PI / 2;
    basinRim.castShadow = true;
    scene.add(basinRim);
    const fountainWater = new THREE.Mesh(new THREE.CircleGeometry(1.37, 40), new THREE.MeshPhysicalMaterial({ color: 0x547f8d, transparent: true, opacity: 0.72, roughness: 0.08, clearcoat: 0.55, depthWrite: false }));
    fountainWater.name = "garden-fountain-water";
    fountainWater.position.set(gardenX, groundY + 0.39, gardenZ);
    fountainWater.rotation.x = -Math.PI / 2;
    scene.add(fountainWater);
    cylinder({ name: "garden-fountain-pedestal", radius: 0.34, radiusTop: 0.23, radiusBottom: 0.42, height: 1.45, segments: 20, x: gardenX, y: groundY + 0.83, z: gardenZ, material: M.marble });
    cylinder({ name: "garden-fountain-upper-bowl", radius: 0.8, radiusTop: 0.65, radiusBottom: 0.28, height: 0.26, segments: 30, x: gardenX, y: groundY + 1.42, z: gardenZ, material: M.marble });
    sphere({ name: "garden-fountain-faceless-figure", radius: 0.24, x: gardenX, y: groundY + 1.94, z: gardenZ, material: M.porcelain });
    roundedBox({ name: "garden-fountain-carved-torso", w: 0.42, h: 0.68, d: 0.28, radius: 0.08, x: gardenX, y: groundY + 1.63, z: gardenZ, material: M.porcelain });
    // A crown lantern makes the fountain's nighttime glow physically legible:
    // the bulb below is also the exact origin of its practical PointLight.
    cylinder({ name: "garden-fountain-crown-lantern-post", radius: 0.045, height: 0.34, segments: 10, x: gardenX, y: groundY + 2.20, z: gardenZ, material: M.brass, cast: false });
    cylinder({ name: "garden-fountain-crown-lantern-base", radius: 0.16, radiusTop: 0.11, radiusBottom: 0.18, height: 0.10, segments: 16, x: gardenX, y: groundY + 2.36, z: gardenZ, material: M.brass, cast: false });
    const fountainLanternShade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.34, 18, 1, true), M.frostedShade);
    fountainLanternShade.name = "garden-fountain-crown-lantern-frosted-glass";
    fountainLanternShade.position.set(gardenX, groundY + 2.52, gardenZ);
    fountainLanternShade.castShadow = false;
    fountainLanternShade.receiveShadow = false;
    scene.add(fountainLanternShade);
    sphere({ name: "garden-fountain-crown-lantern-bulb", radius: 0.075, x: gardenX, y: groundY + 2.52, z: gardenZ, material: M.lampGlow, cast: false });
    cylinder({ name: "garden-fountain-crown-lantern-cap", radius: 0.19, radiusTop: 0.05, radiusBottom: 0.19, height: 0.16, segments: 16, x: gardenX, y: groundY + 2.75, z: gardenZ, material: M.brass, cast: false });
    sphere({ name: "garden-fountain-crown-lantern-finial", radius: 0.055, x: gardenX, y: groundY + 2.87, z: gardenZ, material: M.brass, cast: false });
    const jetPositions = [];
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const x1 = gardenX + Math.cos(a) * 0.28;
      const z1 = gardenZ + Math.sin(a) * 0.28;
      const x2 = gardenX + Math.cos(a) * 0.85;
      const z2 = gardenZ + Math.sin(a) * 0.85;
      jetPositions.push(x1, groundY + 1.48, z1, x2, groundY + 0.55, z2);
    }
    const jetGeometry = new THREE.BufferGeometry();
    jetGeometry.setAttribute("position", new THREE.Float32BufferAttribute(jetPositions, 3));
    const jets = new THREE.LineSegments(jetGeometry, new THREE.LineBasicMaterial({ color: 0xa7d9e8, transparent: true, opacity: 0.66 }));
    jets.name = "garden-fountain-water-jets";
    scene.add(jets);
    physics.addFixedBox(gardenX, groundY + 0.72, gardenZ, 3.5, 1.45, 3.5, 0);
    addGardenBench(gardenX - 6.5, gardenZ - 5.8, -Math.PI / 2);
    addGardenBench(gardenX - 6.5, gardenZ + 5.8, -Math.PI / 2);
    yardState.featureCounts.gardenBeds = beds.length;
    yardState.featureCounts.gardenPlants = stems.length;
  }

  function makeEstatePoolWater(width, depth, x, z, y) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x173b4b) }, uShallow: { value: new THREE.Color(0x6ba0aa) } },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          vUv = uv;
          vec3 p = position;
          float wave = sin((p.x + uTime * 0.55) * 2.1) * 0.018 + cos((p.y - uTime * 0.42) * 2.7) * 0.014;
          wave += sin((p.x + p.y) * 4.8 - uTime * 1.3) * 0.006;
          p.z += wave;
          vWave = wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          float edge = smoothstep(0.0, 0.16, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
          float glint = smoothstep(0.018, 0.034, vWave);
          vec3 color = mix(uDeep, uShallow, 0.28 + edge * 0.42) + vec3(glint * 0.28);
          gl_FragColor = vec4(color, 0.76);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 34, 42), material);
    mesh.name = "estate-pool-water";
    mesh.position.set(x, y, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    scene.add(mesh);
    const system = { update(dt) { material.uniforms.uTime.value += dt; } };
    yardWaterSystems.push(system);
    return mesh;
  }

  function addPoolLounger(x, z, rotationY) {
    const group = new THREE.Group();
    group.position.set(x, YARD_LAYOUT.groundY, z);
    group.rotation.y = rotationY || 0;
    scene.add(group);
    roundedBox({ name: "pool-lounger-cushion", w: 0.82, h: 0.14, d: 1.9, radius: 0.08, x: 0, y: 0.48, z: 0, material: M.roseIvory, parent: group });
    box({ name: "pool-lounger-frame", w: 0.94, h: 0.1, d: 2.05, x: 0, y: 0.34, z: 0, material: M.brass, parent: group });
    for (const sz of [-0.82, 0.82]) for (const sx of [-0.36, 0.36]) cylinder({ name: "pool-lounger-leg", radius: 0.035, height: 0.34, segments: 8, x: sx, y: 0.17, z: sz, material: M.iron, parent: group });
    physics.addFixedBox(x, YARD_LAYOUT.groundY + 0.35, z, 0.95, 0.7, 2.1, rotationY || 0);
  }

  function buildEstatePool() {
    const groundY = YARD_LAYOUT.groundY;
    const pool = YARD_LAYOUT.pool;
    const terraceY = groundY + 0.022;
    box({ name: "pool-terrace-pavers-north", w: 14.5, h: 0.044, d: 1.7, x: pool.centerX, y: terraceY, z: -18.85, material: M.wetPavers, cast: false });
    box({ name: "pool-terrace-pavers-south", w: 14.5, h: 0.044, d: 1.7, x: pool.centerX, y: terraceY, z: -32.15, material: M.wetPavers, cast: false });
    box({ name: "pool-terrace-pavers-west", w: 1.7, h: 0.044, d: 11.8, x: -15.05, y: terraceY, z: pool.centerZ, material: M.wetPavers, cast: false });
    box({ name: "pool-terrace-pavers-east", w: 1.7, h: 0.044, d: 11.8, x: -2.95, y: terraceY, z: pool.centerZ, material: M.wetPavers, cast: false });
    const poolDeckSupports = [
      { name: "pool-north-terrace-support-left", x: -12.65, z: -18.85, w: 4.7, d: 1.7 },
      { name: "pool-north-terrace-support-right", x: -4.85, z: -18.85, w: 5.7, d: 1.7 },
      { name: "pool-west-terrace-support", x: -14.7, z: -25.5, w: 0.6, d: 12.1 },
      { name: "pool-east-terrace-support", x: -2.8, z: -25.5, w: 1.6, d: 12.1 },
      { name: "pool-south-terrace-support", x: -8.5, z: -31.85, w: 13, d: 0.5 },
    ];
    for (const support of poolDeckSupports) physics.addFixedBox(support.x, -0.38, support.z, support.w, 0.35, support.d, 0);

    box({ name: "estate-pool-bottom", w: 9.9, h: 0.22, d: 11.2, x: pool.centerX, y: -1.69, z: pool.centerZ, material: M.poolTile, collider: true, cast: false });
    for (const x of [-13.99, -4.01]) box({ name: "estate-pool-basin-wall", w: 0.28, h: 1.42, d: 11.7, x, y: -0.95, z: pool.centerZ, material: M.poolTile, collider: true });
    box({ name: "estate-pool-basin-wall", w: 10.25, h: 1.42, d: 0.28, x: pool.centerX, y: -0.95, z: -31.34, material: M.poolTile, collider: true });
    box({ name: "estate-pool-basin-wall", w: 3.7, h: 1.42, d: 0.28, x: -12.15, y: -0.95, z: -19.66, material: M.poolTile, collider: true });
    box({ name: "estate-pool-basin-wall", w: 3.7, h: 1.42, d: 0.28, x: -5.85, y: -0.95, z: -19.66, material: M.poolTile, collider: true });
    for (const x of [-14.15, -3.85]) box({ name: "estate-pool-coping", w: 0.52, h: 0.18, d: 12.0, x, y: groundY + 0.07, z: pool.centerZ, material: M.marble, collider: true });
    box({ name: "estate-pool-coping", w: 10.8, h: 0.18, d: 0.52, x: pool.centerX, y: groundY + 0.07, z: -31.48, material: M.marble, collider: true });
    box({ name: "estate-pool-coping", w: 3.95, h: 0.18, d: 0.52, x: -12.02, y: groundY + 0.07, z: -19.52, material: M.marble, collider: true });
    box({ name: "estate-pool-coping", w: 3.95, h: 0.18, d: 0.52, x: -5.98, y: groundY + 0.07, z: -19.52, material: M.marble, collider: true });

    const stepTops = [-0.42, -0.7, -0.98, -1.26, -1.54];
    stepTops.forEach((top, index) => {
      const h = top + 1.8;
      box({ name: `estate-pool-step-${index + 1}`, w: 2.45, h, d: 0.64, x: pool.centerX, y: -1.8 + h / 2, z: -18.3 - index * 0.58, material: M.poolTile, collider: true, cast: false });
    });
    // A shallow invisible walking plane follows the visible treads. Rapier's
    // stair auto-step is intentionally conservative; the ramp guarantees that
    // entering and leaving the pool remains smooth at every frame rate.
    physics.addFixedRamp(pool.centerX, -19.6, -1.58, groundY, 3.2, 2.25, 1);
    for (const x of [-11.1, -6.9]) box({ name: "estate-pool-bottom-lane-inlay", w: 0.09, h: 0.025, d: 9.6, x, y: -1.565, z: pool.centerZ + 0.2, material: M.brass, cast: false });
    makeEstatePoolWater(9.7, 11.25, pool.centerX, pool.centerZ, -0.39);
    addPoolLounger(-0.95, -23.1, 0);
    addPoolLounger(-0.95, -28.0, 0);
    yardState.featureCounts.poolComponents = 18;
  }

  function mazeCellCenter(row, col) {
    const rows = HEDGE_MAZE_LAYOUT.rows.length;
    const columns = HEDGE_MAZE_LAYOUT.rows[0].length;
    return {
      x: HEDGE_MAZE_LAYOUT.centerX + (col - (columns - 1) / 2) * HEDGE_MAZE_LAYOUT.cellSize,
      z: HEDGE_MAZE_LAYOUT.centerZ - (row - (rows - 1) / 2) * HEDGE_MAZE_LAYOUT.cellSize,
    };
  }

  function solveHedgeMaze() {
    const rows = HEDGE_MAZE_LAYOUT.rows;
    const width = rows[0].length;
    let start = -1;
    let goal = -1;
    rows.forEach((row, rowIndex) => {
      const s = row.indexOf("S");
      const e = row.indexOf("E");
      if (s >= 0) start = rowIndex * width + s;
      if (e >= 0) goal = rowIndex * width + e;
    });
    const queue = start >= 0 ? [start] : [];
    const previous = new Map([[start, null]]);
    while (queue.length) {
      const index = queue.shift();
      if (index === goal) break;
      const row = Math.floor(index / width);
      const col = index % width;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= rows.length || nc < 0 || nc >= width || rows[nr][nc] === "#") continue;
        const next = nr * width + nc;
        if (previous.has(next)) continue;
        previous.set(next, index);
        queue.push(next);
      }
    }
    if (!previous.has(goal)) return [];
    const path = [];
    for (let cursor = goal; cursor != null; cursor = previous.get(cursor)) path.push({ row: Math.floor(cursor / width), col: cursor % width });
    return path.reverse();
  }

  function buildMazeRouteActions() {
    const solution = solveHedgeMaze();
    const actions = [];
    for (let i = 1; i < solution.length; i += 1) {
      const previous = solution[i - 1];
      const current = solution[i];
      const dr = current.row - previous.row;
      const dc = current.col - previous.col;
      const yaw = dr > 0 ? 0 : dr < 0 ? Math.PI : dc > 0 ? -Math.PI / 2 : Math.PI / 2;
      // Browser-timed QA loses a few fixed steps at each timeout boundary.
      // A small measured allowance lands each turn inside its destination cell;
      // terminal hedges absorb any remainder before the next corridor leg.
      const seconds = (HEDGE_MAZE_LAYOUT.cellSize / PLAYER.speed) * 1.06;
      const last = actions[actions.length - 1];
      if (last && Math.abs(last.yaw - yaw) < 0.001) last.seconds += seconds;
      else actions.push({ yaw, seconds });
    }
    return actions;
  }

  function makeClippedHedgeGeometry() {
    // Keep the vertical faces flat so neighbouring instances join into one
    // uninterrupted clipped wall. Only the upper quarter eases inward, with a
    // tiny uneven crown that catches lantern light without reading as spheres.
    const clipped = new THREE.BoxGeometry(1, 1, 1, 2, 3, 2);
    const position = clipped.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      let x = position.getX(index);
      let y = position.getY(index);
      let z = position.getZ(index);
      const crown = Math.max(0, Math.min(1, (y - 0.2) / 0.3));
      const topInset = 1 - crown * 0.006;
      x *= topInset;
      z *= topInset;
      if (y > 0.49) y += (Math.sin(x * 9.7 + z * 5.3) + Math.cos(z * 8.1 - x * 4.7)) * 0.004;
      position.setXYZ(index, x, y, z);
    }
    position.needsUpdate = true;
    clipped.computeVertexNormals();
    clipped.clearGroups();
    if (clipped.index) clipped.addGroup(0, clipped.index.count, 0);
    return clipped;
  }

  function addMazeEntrancePortal(portal, size, groundY) {
    const center = mazeCellCenter(portal.row, portal.col);
    const facadeX = center.x - size * 0.76;
    const prefix = `hedge-maze-${portal.id}`;
    for (const z of [center.z - 1.35, center.z + 1.35]) {
      cylinder({ name: `${prefix}-entrance-urn`, radius: 0.38, radiusTop: 0.3, radiusBottom: 0.46, height: 0.82, segments: 18, x: facadeX, y: groundY + 0.39, z, material: M.marble });
      sphere({ name: `${prefix}-entrance-topiary`, radius: 0.68, x: facadeX, y: groundY + 1.38, z, material: M.hedge });
      physics.addFixedBox(facadeX, groundY + 0.75, z, 0.88, 1.5, 0.88, 0);
    }
    const archNorthZ = center.z - 0.82;
    const archSouthZ = center.z + 0.82;
    for (const z of [archNorthZ, archSouthZ]) cylinder({ name: `${prefix}-entrance-arch-post`, radius: 0.055, height: 2.55, segments: 10, x: facadeX + 0.05, y: groundY + 1.28, z, material: M.brass });
    addBeamBetween(`${prefix}-entrance-arch`, [facadeX + 0.05, groundY + 2.52, archNorthZ], [facadeX + 0.05, groundY + 2.52, archSouthZ], 0.065, M.brass);
    sphere({ name: `${prefix}-entrance-crest`, radius: 0.16, x: facadeX + 0.05, y: groundY + 2.72, z: center.z, material: M.brass });
  }

  function buildHedgeMaze() {
    const rows = HEDGE_MAZE_LAYOUT.rows;
    const columns = rows[0].length;
    const size = HEDGE_MAZE_LAYOUT.cellSize;
    const groundY = YARD_LAYOUT.groundY;
    box({ name: "hedge-maze-paths", w: columns * size + 1.5, h: 0.04, d: rows.length * size + 1.5, x: HEDGE_MAZE_LAYOUT.centerX, y: groundY + 0.02, z: HEDGE_MAZE_LAYOUT.centerZ, material: M.gardenSoil, cast: false });
    const walls = [];
    const foliageShells = [];
    rows.forEach((row, rowIndex) => {
      Array.from(row).forEach((cell, colIndex) => {
        if (cell !== "#") return;
        const center = mazeCellCenter(rowIndex, colIndex);
        const clippedHeight = 2.12 + yardJitter(rowIndex * 17, colIndex * 29) * 0.07;
        walls.push({ x: center.x, y: groundY + clippedHeight / 2, z: center.z, w: size * 1.01, h: clippedHeight - 0.04, d: size * 1.01 });
        foliageShells.push({
          x: center.x,
          y: groundY + clippedHeight / 2,
          z: center.z,
          sx: size * 1.002,
          sy: clippedHeight,
          sz: size * 1.002,
          ry: (rowIndex + colIndex) % 2 ? Math.PI / 2 : 0,
        });
        physics.addFixedBox(center.x, groundY + 1.12, center.z, size, 2.28, size, 0);
      });
    });
    addBoxInstanceBatch("hedge-maze-walls", M.hedgeDark, walls, true, true);
    addOutdoorInstanceBatch("hedge-maze-clipped-foliage", "clippedHedgeFoliage", makeClippedHedgeGeometry, M.hedge, foliageShells, false, true);
    for (const portal of HEDGE_MAZE_PORTALS) addMazeEntrancePortal(portal, size, groundY);
    const solution = solveHedgeMaze();
    const entranceCell = solution[0] || { row: 0, col: 4 };
    const southGoalCell = solution[solution.length - 1] || { row: rows.length - 2, col: 5 };
    yardState.maze = {
      rows: rows.length,
      columns,
      entrance: mazeCellCenter(entranceCell.row, entranceCell.col),
      southGoal: mazeCellCenter(southGoalCell.row, southGoalCell.col),
      shortestPathLength: solution.length,
    };
    yardState.featureCounts.mazeHedges = walls.length;
  }

  function buildEstateTrees() {
    const groundY = YARD_LAYOUT.groundY;
    const positions = [
      [-30.5, -13.5], [-31.0, 28.5], [-17.5, 30.0], [13.0, 29.5], [24.5, 29.0],
      [31.0, 19.0], [18.7, 20.5], [13.5, -31.0], [-24.0, -31.0],
    ];
    const trunks = [];
    const branches = [];
    const canopies = [];
    positions.forEach(([x, z], index) => {
      const height = 4.4 + Math.abs(yardJitter(index, 13)) * 1.3;
      trunks.push({ x, y: groundY + height / 2, z, sx: 0.34, sy: height, sz: 0.34, ry: yardJitter(index, 14) });
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2 + yardJitter(index, 20) * 0.55;
        const length = 1.35 + Math.abs(yardJitter(index * 7 + i, 21)) * 0.85;
        const branchY = groundY + height * (0.63 + (i % 2) * 0.07);
        const endX = x + Math.cos(angle) * length;
        const endY = groundY + height * (0.78 + (i % 3) * 0.07);
        const endZ = z + Math.sin(angle) * length;
        branches.push({ from: [x, branchY, z], to: [endX, endY, endZ], radius: 0.13 - i * 0.008 });
        canopies.push({
          x: endX, y: endY + 0.45, z: endZ,
          sx: 0.9 + Math.abs(yardJitter(index + i, 17)) * 0.35,
          sy: 0.82 + Math.abs(yardJitter(index + i, 18)) * 0.42,
          sz: 0.9 + Math.abs(yardJitter(index + i, 19)) * 0.35,
          ry: yardJitter(index, i),
        });
      }
      canopies.push({ x, y: groundY + height + 0.65, z, sx: 1.12, sy: 1.18, sz: 1.12, ry: yardJitter(index, 23) });
      physics.addFixedBox(x, groundY + height / 2, z, 0.76, height, 0.76, 0);
    });
    addOutdoorInstanceBatch("estate-tree-trunks", "estateTreeTrunk", () => new THREE.CylinderGeometry(0.78, 1, 1, 10), M.blackWood, trunks, true, true);
    addOutdoorBeamBatch("estate-tree-branches", M.blackWood, branches, true);
    addOutdoorInstanceBatch("estate-tree-canopies", "estateTreeCanopy", () => new THREE.IcosahedronGeometry(1, 2), M.hedgeDark, canopies, false, true);
    yardState.featureCounts.estateTrees = positions.length;
  }

  function addEstateLantern(circuit, x, z, lanterns, options = false) {
    const settings = typeof options === "object" ? options : { castsLight: Boolean(options) };
    const height = settings.height || 2.16;
    const name = settings.name || "estate-lantern";
    let sourceLight = null;
    lanterns.push({ x, z, height, name });
    if (settings.castsLight) {
      const sourceY = YARD_LAYOUT.groundY + height + 0.11;
      const aimed = Number.isFinite(settings.targetX) && Number.isFinite(settings.targetZ);
      if (settings.downward) {
        sourceLight = circuit.addContainedSpotLight(
          x,
          sourceY,
          z,
          settings.intensity || 24,
          settings.distance || 6.6,
          settings.angle || 0.82,
          ["MAIN LEVEL"],
          YARD_LAYOUT.groundY + 0.02,
          Boolean(settings.castsShadow),
        );
        sourceLight.name = `${settings.name || settings.role || "estate-lantern"}-downward-spotlight`;
        sourceLight.userData.fixtureRole = settings.role || "estate-lantern";
      } else if (aimed) {
        sourceLight = circuit.addAimedSpotLight(
          x,
          sourceY,
          z,
          settings.targetX,
          settings.targetY == null ? YARD_LAYOUT.groundY + 0.02 : settings.targetY,
          settings.targetZ,
          settings.intensity || 24,
          settings.distance || 6.6,
          settings.angle || 0.82,
          ["MAIN LEVEL"],
          Boolean(settings.castsShadow),
          settings.role || "estate-lantern",
        );
      } else {
        sourceLight = circuit.addPracticalLight(
          x,
          sourceY,
          z,
          settings.intensity || 24,
          settings.distance || 6.6,
          ["MAIN LEVEL"],
          {
            contained: Boolean(settings.contained || settings.castsShadow),
            angle: settings.angle || 0.82,
            targetY: YARD_LAYOUT.groundY + 0.02,
            castsShadow: Boolean(settings.castsShadow),
          },
        );
      }
      if (settings.role) {
        sourceLight.userData.mazeSource = {
          x,
          z,
          role: settings.role,
          fixture: settings.name || `maze-${settings.role}-lamp`,
        };
      }
      if (Number.isFinite(settings.budgetPriority)) sourceLight.userData.exteriorBudgetPriority = settings.budgetPriority;
      if (Number.isFinite(settings.mazeBudgetPriority)) sourceLight.userData.mazeBudgetPriority = settings.mazeBudgetPriority;
    }
    if (settings.name) {
      cylinder({ name: `${name}-pedestal`, radius: 0.23, radiusTop: 0.16, radiusBottom: 0.29, height: 0.38, segments: 14, x, y: YARD_LAYOUT.groundY + 0.19, z, material: M.iron });
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 7, 18), M.brass);
      collar.name = `${name}-collar`;
      collar.position.set(x, YARD_LAYOUT.groundY + height * 0.56, z);
      collar.rotation.x = Math.PI / 2;
      scene.add(collar);
      sphere({ name: `${name}-finial`, radius: 0.11, x, y: YARD_LAYOUT.groundY + height + 0.62, z, material: M.brass, cast: false });
    }
    physics.addFixedBox(x, YARD_LAYOUT.groundY + height / 2, z, 0.22, height, 0.22, 0);
    yardState.featureCounts.exteriorLamps += 1;
    return sourceLight;
  }

  function finalizeEstateLanterns(circuit, lanterns) {
    const groundY = YARD_LAYOUT.groundY;
    const poles = lanterns.map(({ x, z, height }) => ({ x, y: groundY + height / 2, z, sx: 0.085, sy: height, sz: 0.085 }));
    const cages = lanterns.map(({ x, z, height }) => ({ x, y: groundY + height + 0.1, z, sx: 0.38, sy: 0.62, sz: 0.38 }));
    const bulbs = lanterns.map(({ x, z, height }) => ({ x, y: groundY + height + 0.11, z, sx: 0.13, sy: 0.18, sz: 0.13 }));
    const caps = lanterns.map(({ x, z, height }) => ({ x, y: groundY + height + 0.51, z, sx: 0.42, sy: 0.28, sz: 0.42 }));
    addOutdoorInstanceBatch("estate-lantern-poles", "estateLanternPole", () => new THREE.CylinderGeometry(1, 1.15, 1, 10), M.iron, poles, true, true);
    addOutdoorInstanceBatch("estate-lantern-cages", "estateLanternCage", () => new THREE.BoxGeometry(1, 1, 1, 1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x202326, wireframe: true }), cages, false, true);
    const bulbMesh = addOutdoorInstanceBatch("estate-lantern-bulbs", "estateLanternBulb", () => new THREE.SphereGeometry(1, 12, 8), M.lampGlow, bulbs, false, false);
    addOutdoorInstanceBatch("estate-lantern-caps", "estateLanternCap", () => new THREE.ConeGeometry(1, 1, 10), M.iron, caps, true, true);
    if (bulbMesh) {
      M.lampGlow.userData.onEmissiveIntensity = 1.0;
      M.lampGlow.userData.offEmissiveIntensity = 0;
      circuit.glowMaterials.push(M.lampGlow);
    }
  }

  function addRearFacadeWallLantern(circuit, x, side, budgetPriority) {
    const light = circuit.addWallSconce(
      x,
      2.12,
      -12.19,
      Math.PI,
      34,
      6.2,
      ["MAIN LEVEL"],
      x * 0.42,
      YARD_LAYOUT.groundY + 0.04,
      -14.15,
    );
    light.name = `rear-facade-${side}-lantern-spotlight`;
    light.userData.fixtureRole = "rear-facade-lantern";
    light.userData.exteriorBudgetPriority = budgetPriority;
    yardState.featureCounts.exteriorLamps += 1;
    return light;
  }

  function addFrontFacadeWallLantern(circuit, x, side, budgetPriority) {
    const light = circuit.addWallSconce(
      x,
      2.12,
      12.19,
      0,
      40,
      7.5,
      ["MAIN LEVEL"],
      x * 0.72,
      YARD_LAYOUT.groundY + 0.04,
      15.4,
    );
    light.name = `front-facade-${side}-lantern-spotlight`;
    light.userData.fixtureRole = "front-facade-lantern";
    light.userData.exteriorBudgetPriority = budgetPriority;
    yardState.featureCounts.exteriorLamps += 1;
    return light;
  }

  function buildEstateLighting() {
    const estateExteriorLights = new LightCircuit("estate exterior lights", FLOOR.MAIN, 0xffb56b, true);
    const lanterns = [];
    addEstateLantern(estateExteriorLights, -4.5, 32.15, lanterns, true);
    addEstateLantern(estateExteriorLights, 4.5, 32.15, lanterns, true);
    addEstateLantern(estateExteriorLights, -18.0, 3.0, lanterns, { castsLight: true, contained: true, intensity: 26, distance: 6.6, angle: 0.78, budgetPriority: 12 });
    addEstateLantern(estateExteriorLights, -18.0, 17.0, lanterns, { castsLight: true, contained: true, intensity: 26, distance: 6.6, angle: 0.78, budgetPriority: 20 });
    addEstateLantern(estateExteriorLights, -1.8, -20.2, lanterns, { castsLight: true, contained: true, intensity: 26, distance: 6.6, angle: 0.78, budgetPriority: 21 });
    addEstateLantern(estateExteriorLights, -1.8, -30.8, lanterns, { castsLight: true, contained: true, intensity: 26, distance: 6.6, angle: 0.78, budgetPriority: 13 });
    const mazeEntranceLampSources = [];
    for (const portal of HEDGE_MAZE_PORTALS) {
      const center = mazeCellCenter(portal.row, portal.col);
      for (const offsetZ of [-1.3, 1.3]) mazeEntranceLampSources.push({
        x: center.x - 1.0,
        z: center.z + offsetZ,
        height: 3.75,
        intensity: 300,
        distance: 12.8,
        angle: 1.08,
        downward: true,
        contained: true,
        castsLight: true,
        castsShadow: false,
        role: "entrance",
        name: `maze-${portal.id}-entrance-lamp-${offsetZ < 0 ? "north" : "south"}`,
      });
    }
    const mazeOuterPathCells = [
      { row: 11, col: 0, role: "outer-path", name: "maze-outer-path-lamp-north" },
      { row: 15, col: 0, role: "outer-path", name: "maze-outer-path-lamp-south" },
    ].map((source) => {
      const center = mazeCellCenter(source.row, source.col);
      return {
        x: center.x,
        z: center.z,
        height: 3.75,
        intensity: 285,
        distance: 12.5,
        angle: 1.08,
        downward: true,
        contained: true,
        castsLight: true,
        castsShadow: false,
        role: source.role,
        name: source.name,
      };
    });
    const mazeCornerCells = [
      { row: 0, col: 0, role: "corner", name: "maze-north-west-corner-lamp" },
      { row: 0, col: 8, role: "corner", name: "maze-north-east-corner-lamp" },
      { row: 30, col: 0, role: "corner", name: "maze-south-west-corner-lamp" },
      { row: 30, col: 8, role: "corner", name: "maze-south-east-corner-lamp" },
    ];
    const mazeWayfindingCells = [
      { row: 3, col: 4, targetRow: 3, targetCol: 3, role: "wayfinding" },
      { row: 7, col: 6, targetRow: 7, targetCol: 5, role: "wayfinding" },
      { row: 11, col: 6, targetRow: 11, targetCol: 5, role: "wayfinding" },
      { row: 15, col: 4, targetRow: 15, targetCol: 3, role: "center", name: "maze-center-tall-lamp", castsShadow: true },
      { row: 19, col: 4, targetRow: 19, targetCol: 3, role: "wayfinding" },
      { row: 23, col: 4, targetRow: 23, targetCol: 5, role: "wayfinding" },
      { row: 27, col: 6, targetRow: 27, targetCol: 5, role: "wayfinding" },
    ];
    const mazeLampSources = [
      ...mazeEntranceLampSources,
      ...mazeOuterPathCells,
      ...mazeWayfindingCells.map((source) => {
        const center = mazeCellCenter(source.row, source.col);
        const target = mazeCellCenter(source.targetRow, source.targetCol);
        return {
          x: center.x,
          z: center.z,
          targetX: target.x,
          targetZ: target.z,
          height: source.role === "center" ? 4.35 : 3.75,
          intensity: source.role === "center" ? 420 : 300,
          distance: source.role === "center" ? 13.2 : 12.6,
          angle: source.role === "center" ? 1.1 : 1.05,
          downward: true,
          contained: true,
          castsLight: true,
          castsShadow: Boolean(source.castsShadow),
          role: source.role,
          name: source.name || `maze-wayfinding-lamp-${source.row}`,
          budgetPriority: source.role === "center" ? 5 : 50,
        };
      }),
      ...mazeCornerCells.map((source) => {
        const center = mazeCellCenter(source.row, source.col);
        return {
          x: center.x,
          z: center.z,
          height: 4.35,
          intensity: 420,
          distance: 13.2,
          angle: 1.1,
          downward: true,
          contained: true,
          castsLight: true,
          castsShadow: false,
          role: source.role,
          name: source.name,
        };
      }),
    ];
    for (const source of mazeLampSources) {
      const mazeBudgetPriority = MAZE_LIGHT_BUDGET_FIXTURES.indexOf(source.name);
      addEstateLantern(estateExteriorLights, source.x, source.z, lanterns, {
        ...source,
        mazeBudgetPriority: mazeBudgetPriority >= 0 ? mazeBudgetPriority : null,
      });
    }
    finalizeEstateLanterns(estateExteriorLights, lanterns);
    addFrontPorticoChandelier(estateExteriorLights);
    const fountainLight = estateExteriorLights.addPracticalLight(YARD_LAYOUT.garden.centerX, YARD_LAYOUT.groundY + 2.52, YARD_LAYOUT.garden.centerZ, 58, 10.5, ["MAIN LEVEL"]);
    fountainLight.name = "garden-fountain-crown-lantern-light";
    fountainLight.userData.visibleFixtureEmitter = true;
    estateExteriorLights.addPracticalLight(-9, -0.05, -25.5, 48, 10.5, ["MAIN LEVEL"]);
    addFrontFacadeWallLantern(estateExteriorLights, -7.15, "west", 0);
    addFrontFacadeWallLantern(estateExteriorLights, 7.15, "east", 1);
    addRearFacadeWallLantern(estateExteriorLights, -2.05, "west", 2);
    addRearFacadeWallLantern(estateExteriorLights, 2.05, "east", 3);
    estateExteriorLights.addSwitch(1.72, FLOOR.MAIN + 1.15, 12.19, 0);
    estateExteriorLights.addSwitch(2.05, FLOOR.MAIN + 1.15, -12.19, Math.PI);
    yardState.circuit = estateExteriorLights;
    yardState.maze.lightSources = mazeLampSources.map(({ x, z, name, role, castsShadow }) => ({
      x,
      z,
      role,
      fixture: name || `maze-${role}-lamp`,
      castsShadow: Boolean(castsShadow),
    }));
  }

  function getYardDiagnostics(playerPosition) {
    const p = playerPosition || { x: 0, z: 0 };
    const bounds = YARD_LAYOUT.bounds;
    const inBounds = p.x >= bounds.minX - 0.2 && p.x <= bounds.maxX + 0.2 && p.z >= bounds.minZ - 0.2 && p.z <= bounds.maxZ + 0.2;
    const circuit = yardState.circuit;
    const renderedMazeSources = circuit
      ? circuit.lights.filter((light) => light.userData.mazeSource).map((light) => ({
        ...light.userData.mazeSource,
        visible: Boolean(light.visible),
        active: Boolean(light.visible && light.intensity > 0),
        type: light.isSpotLight ? "spot" : light.isPointLight ? "point" : "other",
        castsShadow: Boolean(light.castShadow),
      }))
      : [];
    return {
      zone: state.currentRoom,
      inBounds,
      bounds,
      featureCounts: { ...yardState.featureCounts },
      perimeter: { closed: yardState.perimeterClosed, uncoveredIntervals: yardState.perimeterUncoveredIntervals.map((gap) => ({ ...gap })) },
      gate: { ...yardState.gate },
      maze: { ...yardState.maze, renderedLightSources: renderedMazeSources },
      lighting: {
        total: circuit ? circuit.lights.length : 0,
        active: circuit ? circuit.lights.filter((light) => light.visible && light.intensity > 0).length : 0,
        on: circuit ? circuit.on : false,
      },
    };
  }

  function addExteriorEntryRamp(name, x, z, width, run, directionZ) {
    const lowY = YARD_LAYOUT.groundY;
    const highY = FLOOR.MAIN;
    const rise = highY - lowY;
    const angle = Math.atan2(rise, run);
    const ramp = box({
      name,
      w: width,
      h: 0.06,
      d: Math.hypot(run, rise),
      x,
      y: (lowY + highY) / 2 - 0.035,
      z,
      material: M.limestone,
      cast: false,
      receive: true,
    });
    ramp.rotation.x = -directionZ * angle;
    physics.addFixedRamp(x, z, lowY, highY, run, width, directionZ);
    return ramp;
  }

  function buildExteriorScene() {
    // Keep storm ground outside the foundation footprint. A former single
    // 92m slab passed through the house just below the main floor, visually
    // sealing the service-stair opening even though it had no collider.
    const groundsMaterial = M.wetGrass;
    const groundParts = [
      ["rain-soaked-grounds-front", 0, 23, 68, 22],
      ["rain-soaked-grounds-rear-north", 0, -15, 68, 6],
      ["rain-soaked-grounds-rear-south", 0, -33, 68, 2],
      ["rain-soaked-grounds-rear-west-middle", -24.5, -25, 19, 14],
      ["rain-soaked-grounds-rear-east-middle", 16, -25, 36, 14],
      ["rain-soaked-grounds-west", -24.5, 0, 19, 24],
      ["rain-soaked-grounds-east", 24.5, 0, 19, 24],
    ];
    for (const [name, x, z, w, d] of groundParts) {
      box({ name, w, h: 0.35, d, x, y: -0.38, z, material: groundsMaterial, collider: false, cast: false, receive: true });
      physics.addFixedBox(x, -0.38, z, w, 0.35, d, 0);
    }
    // Rear grade sits 0.205m below the finished main floor. The ballroom is now
    // the sole rear exit, so the former kitchen sill and ramp disappear with
    // the sealed service-door bay.
    const rearThresholds = [
      { name: "ballroom-rear-threshold", x: 0, width: 2.46, ramp: false },
    ];
    box({ name: "ballroom-raised-terrace-landing", w: 2.46, h: 0.2, d: 3.3, x: 0, y: -0.1, z: -13.65, material: M.limestone, cast: false, receive: true });
    addExteriorEntryRamp("ballroom-rear-outer-entry-ramp", 0, -16.1, 2.46, 1.6, 1);
    for (const threshold of rearThresholds) {
      box({ name: threshold.name, w: threshold.width, h: 0.2, d: 1.0, x: threshold.x, y: -0.1, z: -12.15, material: M.limestone, cast: false, receive: true });
    }
    // Meet the foyer oak at the front-wall datum (z=12) without extending a
    // coplanar stone face beneath it. The previous half-meter overlap caused
    // visible z-fighting between the two floor textures at the open doors.
    box({ name: "front-portico-floor", w: 6.6, h: 0.2, d: 2.9, x: 0, y: -0.1, z: 13.45, material: M.limestone, collider: false });
    addExteriorEntryRamp("front-portico-outer-entry-ramp", 0, 15.7, 2.6, 1.6, -1);
    // Extend the matching flat collision plane beneath the foyer. Keeping its
    // leading vertical face away from the threshold prevents the character
    // controller from catching on a coplanar slab seam at z=11.5.
    physics.addFixedBox(0, -0.1, 12.2, 6.6, 0.2, 5.4, 0);
    box({ name: "front-portico-roof", w: 8.8, h: 0.34, d: 3.4, x: 0, y: 4.05, z: 13.3, material: M.limestone, cast: true });
    for (const x of [-3.35, -1.8, 1.8, 3.35]) {
      cylinder({ name: "portico-column", radius: 0.28, radiusTop: 0.24, radiusBottom: 0.34, height: 3.95, segments: 18, x, y: 1.82, z: 14.25, material: M.limestone });
      cylinder({ name: "portico-column-base", radius: 0.42, height: 0.2, segments: 18, x, y: -0.02, z: 14.25, material: M.marble });
      physics.addFixedBox(x, 1.82, 14.25, 0.64, 3.95, 0.64, 0);
    }
    buildEstateYard();
  }

  function buildMansion() {
    buildExteriorScene();
    buildSlabsAndCeilings();
    buildExteriorWalls();
    buildMainPartitions();
    buildUpperPartitions();
    buildBasementPartitions();
    buildGrandStaircase();
    buildServiceStaircase();
    furnishMainFloor();
    furnishUpperFloor();
    furnishCoatCloset();
    furnishMainHallBathroom();
    furnishUpperGrandBathroom();
    furnishBasement();
    buildContestantThirteenQuest();
    buildLighting();
    registerRoomZones();
  }

  class RainSystem {
    constructor() {
      this.count = 1400;
      this.positions = new Float32Array(this.count * 6);
      this.speeds = new Float32Array(this.count);
      for (let i = 0; i < this.count; i += 1) this.reset(i, true);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
      const material = new THREE.LineBasicMaterial({ color: 0x9eb7c9, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending });
      this.lines = new THREE.LineSegments(geometry, material);
      this.lines.name = "exterior-rain-curtain";
      this.lines.frustumCulled = false;
      scene.add(this.lines);
    }

    randomOutside() {
      let x;
      let z;
      do {
        x = (Math.random() - 0.5) * 84;
        z = (Math.random() - 0.5) * 78;
      } while (Math.abs(x) < 16 && Math.abs(z) < 13);
      return [x, z];
    }

    reset(i, initial) {
      const [x, z] = this.randomOutside();
      const y = initial ? Math.random() * 24 : 20 + Math.random() * 7;
      const length = 0.38 + Math.random() * 0.55;
      const k = i * 6;
      this.positions[k] = x;
      this.positions[k + 1] = y;
      this.positions[k + 2] = z;
      this.positions[k + 3] = x - 0.07;
      this.positions[k + 4] = y + length;
      this.positions[k + 5] = z + 0.02;
      this.speeds[i] = 13 + Math.random() * 8;
    }

    update(dt) {
      for (let i = 0; i < this.count; i += 1) {
        const k = i * 6;
        const drop = this.speeds[i] * dt;
        this.positions[k + 1] -= drop;
        this.positions[k + 4] -= drop;
        this.positions[k] -= dt * 1.5;
        this.positions[k + 3] -= dt * 1.5;
        if (this.positions[k + 4] < -0.25) this.reset(i, false);
      }
      this.lines.geometry.attributes.position.needsUpdate = true;
    }
  }

  class StormSystem {
    constructor() {
      this.flash = 0;
      this.timer = state.qa ? 999 : 3.5;
      this.pulses = [];
      this.light = new THREE.DirectionalLight(0xc9e8ff, 0);
      this.light.position.set(-18, 24, 12);
      scene.add(this.light);
    }

    trigger() {
      const strength = state.reducedFlash ? 0.38 : 1;
      this.pulses = [
        { delay: 0, strength },
        { delay: 0.13, strength: strength * 0.42 },
        { delay: 0.34, strength: strength * 0.82 },
      ];
      this.timer = 12 + Math.random() * 23;
      if (audioSystem) audioSystem.thunder(0.55 + Math.random() * 0.8);
    }

    update(dt) {
      this.timer -= dt;
      if (this.timer <= 0) this.trigger();
      for (const pulse of this.pulses) pulse.delay -= dt;
      while (this.pulses.length && this.pulses[0].delay <= 0) {
        this.flash = Math.max(this.flash, this.pulses.shift().strength);
      }
      this.flash = Math.max(0, this.flash - dt * 3.7);
      const lightning = this.flash * this.flash;
      const outdoors = outdoorRoomNames.has(state.currentRoom);
      // The unshadowed storm key exists only over the grounds. Indoors, a
      // restrained exposure/fog pulse reads through the windows without a
      // directional light passing through every wall and closed door.
      this.light.intensity = outdoors ? lightning * 11 : 0;
      const baseExposure = state.mazeLightingContext
        ? MAZE_EXPOSURE
        : outdoors ? GROUNDS_EXPOSURE : NIGHT_LIGHTING.exposure;
      renderer.toneMappingExposure = baseExposure + lightning * (outdoors ? 0.72 : 0.12);
      scene.fog.color.setRGB(0.031 + lightning * 0.16, 0.043 + lightning * 0.19, 0.07 + lightning * 0.24);
    }
  }

  class MansionAudio {
    constructor() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = AudioContext ? new AudioContext() : null;
      this.master = null;
      this.rain = null;
      this.waterLoops = new Map();
      if (!this.ctx) return;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.58;
      this.master.connect(this.ctx.destination);
      this.makeRain();
    }

    async unlock() {
      if (!this.ctx) return;
      if (this.ctx.state !== "running") await this.ctx.resume();
      state.audioEnabled = true;
      this.master.gain.setTargetAtTime(0.58, this.ctx.currentTime, 0.06);
      updateAudioButton();
    }

    makeNoiseBuffer(seconds) {
      const length = Math.floor(this.ctx.sampleRate * seconds);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.965 + white * 0.035;
        data[i] = last * 2.8;
      }
      return buffer;
    }

    makeRain() {
      // Rain bus: exposure gain (how much shell opening is nearby) into a
      // muffle lowpass (walls and glass swallow the hiss first) into master.
      // The bed itself is a real CC0 rain recording; a shaped procedural wash
      // covers the frames before it decodes and any context where the asset
      // cannot be fetched, so the storm never falls silent.
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      const muffle = this.ctx.createBiquadFilter();
      muffle.type = "lowpass";
      muffle.frequency.value = 8200;
      gain.connect(muffle).connect(this.master);
      this.rain = { gain, muffle, source: null, mode: "pending", level: 0.5, exposure: 1 };
      this.startProceduralRain();
      void this.loadRecordedRain();
    }

    startProceduralRain() {
      if (!this.rain || this.rain.mode === "recorded") return;
      // Fallback wash shaped like rain rather than radio static: a dark
      // brown-noise body with a separate droplet-band hiss, instead of one
      // wideband noise loop.
      const body = this.ctx.createBufferSource();
      body.buffer = this.makeNoiseBuffer(4);
      body.loop = true;
      const bodyHigh = this.ctx.createBiquadFilter();
      bodyHigh.type = "highpass";
      bodyHigh.frequency.value = 220;
      const bodyLow = this.ctx.createBiquadFilter();
      bodyLow.type = "lowpass";
      bodyLow.frequency.value = 1500;
      const bodyGain = this.ctx.createGain();
      bodyGain.gain.value = 0.42;
      body.connect(bodyHigh).connect(bodyLow).connect(bodyGain).connect(this.rain.gain);
      const hiss = this.ctx.createBufferSource();
      hiss.buffer = this.makeNoiseBuffer(2.3);
      hiss.loop = true;
      const hissBand = this.ctx.createBiquadFilter();
      hissBand.type = "bandpass";
      hissBand.frequency.value = 4300;
      hissBand.Q.value = 0.65;
      const hissGain = this.ctx.createGain();
      hissGain.gain.value = 0.12;
      hiss.connect(hissBand).connect(hissGain).connect(this.rain.gain);
      body.start();
      hiss.start();
      this.rain.mode = "procedural";
      this.rain.level = 0.5;
      this.rain.source = {
        stop: () => {
          try { body.stop(); } catch (_) { /* Already stopped. */ }
          try { hiss.stop(); } catch (_) { /* Already stopped. */ }
        },
      };
    }

    async loadRecordedRain() {
      if (!this.ctx || !SCRIPT_URL) return;
      try {
        const url = new URL("../Sounds/shared/ambience/rain-heavy-loop.mp3", SCRIPT_URL).href;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`rain loop http ${response.status}`);
        const encoded = await response.arrayBuffer();
        const buffer = await new Promise((resolve, reject) => {
          const result = this.ctx.decodeAudioData(encoded, resolve, reject);
          if (result && typeof result.then === "function") result.then(resolve, reject);
        });
        if (!this.rain) return;
        if (this.rain.source) this.rain.source.stop();
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        // Trim the MP3 encoder padding out of the loop points so the 26s
        // seam stays buried in the rain texture instead of clicking.
        source.loopStart = 0.06;
        source.loopEnd = Math.max(1, buffer.duration - 0.06);
        source.connect(this.rain.gain);
        source.start();
        this.rain.source = source;
        this.rain.mode = "recorded";
        this.rain.level = 0.9;
        this.setRainExposure(this.rain.exposure);
      } catch (_) {
        // Offline or file:// context: the procedural wash keeps storming.
      }
    }

    setRainExposure(exposure) {
      if (!this.ctx || !this.rain) return;
      const clamped = clamp(Number(exposure) || 0, 0, 1);
      this.rain.exposure = clamped;
      const now = this.ctx.currentTime;
      // Perceptual staging: even the deepest interior keeps a faint wash of
      // rain on the roof, and the muffle filter opens with exposure so
      // stepping outside reads as walls falling away, not a volume knob.
      const gainTarget = this.rain.level * (0.05 + 0.95 * Math.pow(clamped, 1.35));
      const cutoffTarget = 420 + 7800 * Math.pow(clamped, 1.6);
      this.rain.gain.gain.setTargetAtTime(gainTarget, now, 0.24);
      this.rain.muffle.frequency.setTargetAtTime(cutoffTarget, now, 0.24);
    }

    rainDiagnostics() {
      if (!this.rain) return { mode: "unavailable", exposure: 0 };
      return {
        mode: this.rain.mode,
        exposure: Number(this.rain.exposure.toFixed(3)),
        gain: Number(this.rain.gain.gain.value.toFixed(4)),
        muffleHz: Math.round(this.rain.muffle.frequency.value),
      };
    }

    setEnabled(enabled) {
      if (!this.ctx) return;
      state.audioEnabled = enabled;
      this.master.gain.setTargetAtTime(enabled ? 0.58 : 0.0001, this.ctx.currentTime, 0.045);
      updateAudioButton();
    }

    ping(frequency, duration, gainValue, type) {
      if (!this.ctx || !state.audioEnabled) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(gainValue, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    door(opening) {
      this.ping(opening ? 92 : 74, 0.48, 0.055, "sawtooth");
      setTimeout(() => this.ping(opening ? 410 : 260, 0.08, 0.025, "triangle"), opening ? 80 : 220);
    }

    cabinet(opening) {
      this.ping(opening ? 165 : 118, 0.24, 0.035, "triangle");
    }

    light(on) {
      this.ping(on ? 820 : 510, 0.06, 0.028, "square");
    }

    fireplace(on) {
      this.ping(on ? 145 : 82, on ? 0.24 : 0.32, 0.034, on ? "triangle" : "sawtooth");
      setTimeout(() => this.ping(on ? 520 : 190, 0.07, 0.018, "triangle"), on ? 70 : 120);
    }

    toiletFlush() {
      if (!this.ctx || !this.master || !state.audioEnabled) return;
      const now = this.ctx.currentTime;
      const source = this.ctx.createBufferSource();
      source.buffer = this.makeNoiseBuffer(2.6);
      const high = this.ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 110;
      const low = this.ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(3400, now);
      low.frequency.exponentialRampToValueAtTime(420, now + 2.45);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.075, now + 0.08);
      gain.gain.setValueAtTime(0.06, now + 0.72);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
      source.connect(high).connect(low).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + 2.55);
      this.ping(58, 1.35, 0.035, "sine");
    }

    setWater(name, on, kind) {
      if (!this.ctx || !this.master) return;
      const now = this.ctx.currentTime;
      let entry = this.waterLoops.get(name);
      const targetGain = kind === "shower" ? 0.035 : kind === "tub" ? 0.028 : 0.018;
      if (on) {
        if (!entry) {
          const source = this.ctx.createBufferSource();
          source.buffer = this.makeNoiseBuffer(1.2);
          source.loop = true;
          const high = this.ctx.createBiquadFilter();
          high.type = "highpass";
          high.frequency.value = kind === "shower" ? 680 : 980;
          const low = this.ctx.createBiquadFilter();
          low.type = "lowpass";
          low.frequency.value = kind === "shower" ? 5200 : 3800;
          const gain = this.ctx.createGain();
          gain.gain.value = 0.0001;
          source.connect(high).connect(low).connect(gain).connect(this.master);
          source.start(now);
          entry = { source, gain, active: true, kind };
          this.waterLoops.set(name, entry);
        }
        entry.active = true;
        entry.gain.gain.cancelScheduledValues(now);
        entry.gain.gain.setTargetAtTime(targetGain, now, 0.035);
        return;
      }
      if (!entry) return;
      entry.active = false;
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setTargetAtTime(0.0001, now, 0.055);
      setTimeout(() => {
        if (this.waterLoops.get(name) !== entry || entry.active) return;
        try { entry.source.stop(); } catch (_) { /* Already stopped. */ }
        this.waterLoops.delete(name);
      }, 240);
    }

    thunder(delay) {
      if (!this.ctx || !state.audioEnabled) return;
      setTimeout(() => {
        if (!this.ctx || !state.audioEnabled) return;
        const now = this.ctx.currentTime;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.makeNoiseBuffer(2.6);
        const low = this.ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.setValueAtTime(580, now);
        low.frequency.exponentialRampToValueAtTime(85, now + 2.5);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.42, now + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
        noise.connect(low).connect(gain).connect(this.master);
        noise.start(now);
        noise.stop(now + 2.55);
        this.ping(46, 2.2, 0.19, "sine");
      }, delay * 1000);
    }
  }

  function updateAudioButton() {
    if (!dom.audio) return;
    dom.audio.setAttribute("aria-pressed", String(state.audioEnabled));
    dom.audio.setAttribute("aria-label", state.audioEnabled ? "Mute storm audio" : "Enable storm audio");
    dom.audio.title = state.audioEnabled ? "Mute storm audio" : "Enable storm audio";
  }

  function resize() {
    const rect = dom.stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const mobile = width < MOBILE_RENDER_WIDTH;
    const mobileProfileChanged = state.mobileRenderProfile !== mobile;
    state.mobileRenderProfile = mobile;
    // A Retina DPR of 1.6 made the stable full-floor light set shade roughly
    // 64% more pixels than 1.25. Keep the CSS canvas crisp while bounding the
    // fragment-light workload on laptops and mobile GPUs.
    const preferredDpr = mobile ? 1.0 : 1.25;
    const reducedDpr = mobile ? 0.8 : 1.0;
    const dprCap = state.renderQuality === "reduced" ? reducedDpr : preferredDpr;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Preserve more of the desktop composition on tall phone canvases. A
    // fixed 70-degree vertical FOV falls to roughly 36 degrees horizontally
    // at 390x844, making rooms look partially missing. Widen portrait views
    // without pushing into an extreme fisheye projection.
    const portraitExpansion = camera.aspect < 1
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(70 / 2)) / Math.max(camera.aspect, 0.5)))
      : 70;
    camera.fov = clamp(portraitExpansion, 70, 96);
    camera.updateProjectionMatrix();
    // Rotating a phone can cross the render-profile boundary without changing
    // floors. Re-apply the bounded light layout once the scene is ready so a
    // landscape-to-portrait resize cannot retain the desktop shader budget.
    if (mobileProfileChanged && state.ready) syncLightRendering();
  }

  function requestPointerLock() {
    if (!state.started || matchMedia("(pointer: coarse)").matches) return;
    if (document.pointerLockElement !== dom.canvas && dom.canvas.requestPointerLock) {
      try {
        const request = dom.canvas.requestPointerLock();
        if (request && typeof request.catch === "function") request.catch(() => {});
      } catch (_) { /* Pointer lock is optional; keyboard/touch exploration still works. */ }
    }
  }

  function startExploration() {
    if (!state.ready || state.started) return;
    state.started = true;
    // Do not let the deliberately low-rate intro preview pollute the live FPS
    // sample or deliver a large accumulated simulation step on entry.
    clock.getDelta();
    lastAnimationFrameAt = performance.now();
    fpsFrames = 0;
    fpsElapsed = 0;
    lowFpsSeconds = 0;
    if (dom.intro) dom.intro.hidden = true;
    if (dom.enter) {
      dom.enter.disabled = true;
      dom.enter.setAttribute("aria-disabled", "true");
    }
    if (dom.canvas) dom.canvas.focus({ preventScroll: true });
    if (contestant13Quest) contestant13Quest.updateUI();
    // Pointer lock must be requested during the trusted click. Audio is optional and must not delay entry.
    requestPointerLock();
    if (audioSystem) void audioSystem.unlock().catch(() => {});
  }

  function mergeStaticDecor() {
    // Roughly 1,400 tiny decorative meshes — wall trim, door casings, window
    // frames, sills, and fixture brass — each cost one draw call while never
    // casting shadows, moving, or taking interactions. Baking them into one
    // merged mesh per material and culling class removes about half of the
    // scene's draw calls. Colliders, occluders, interactive meshes, animated
    // subtrees (only direct scene children merge), and per-circuit emissive
    // bulbs are deliberately excluded.
    const mergeablePatterns = [
      /-baseboard-[ab]$/,
      /-crown-[ab]$/,
      /door-(?:casing-face|casing-header|jamb|lintel-trim)$/,
      /window-(?:mullion|frame)$/,
      /stone-window-sill$/,
    ];
    // Fixture brass stays visible from the grounds (it hangs beside lit
    // bulbs), so it merges into never-culled groups instead of interior ones.
    const fixtureBrassPatterns = [
      /(?:lights?|chandelier)-(?:arm|chain)$/,
      /wall-sconce-(?:backplate|arm|socket|cup|shade-rim)$/,
    ];
    const skip = new Set([...occluderMeshes, ...interactableMeshes]);
    const classify = (point) => {
      if (Math.abs(point.z - 12) < 0.72 && Math.abs(point.x) < 15.8) return "facade:front";
      if (Math.abs(point.z + 12) < 0.72 && Math.abs(point.x) < 15.8) return "facade:rear";
      if (Math.abs(point.x + 15) < 0.72 && Math.abs(point.z) < 12.8) return "facade:west";
      if (Math.abs(point.x - 15) < 0.72 && Math.abs(point.z) < 12.8) return "facade:east";
      if (Math.abs(point.x) > 15.25 || Math.abs(point.z) > 12.25) return "always";
      return "interior";
    };
    scene.updateMatrixWorld(true);
    const groups = new Map();
    const position = new THREE.Vector3();
    for (const object of [...scene.children]) {
      if (!object.isMesh || skip.has(object) || object.userData.interaction) continue;
      const name = object.name || "";
      const isTrim = mergeablePatterns.some((pattern) => pattern.test(name));
      const isBrass = !isTrim && fixtureBrassPatterns.some((pattern) => pattern.test(name));
      if (!isTrim && !isBrass) continue;
      object.getWorldPosition(position);
      const cullClass = isBrass ? "always" : classify(position);
      const key = `${object.material.uuid}|${cullClass}`;
      let group = groups.get(key);
      if (!group) {
        group = { material: object.material, cullClass, geometries: [], count: 0 };
        groups.set(key, group);
      }
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      group.geometries.push(geometry);
      group.count += 1;
      scene.remove(object);
    }
    let mergedMeshes = 0;
    let mergedSources = 0;
    for (const group of groups.values()) {
      if (!group.geometries.length) continue;
      let vertexCount = 0;
      for (const geometry of group.geometries) vertexCount += geometry.attributes.position.count;
      const merged = new THREE.BufferGeometry();
      for (const attributeName of ["position", "normal", "uv"]) {
        const itemSize = attributeName === "uv" ? 2 : 3;
        const array = new Float32Array(vertexCount * itemSize);
        let offset = 0;
        for (const geometry of group.geometries) {
          const attribute = geometry.attributes[attributeName];
          if (attribute) array.set(attribute.array, offset);
          offset += geometry.attributes.position.count * itemSize;
        }
        merged.setAttribute(attributeName, new THREE.BufferAttribute(array, itemSize));
      }
      for (const geometry of group.geometries) geometry.dispose();
      const mesh = new THREE.Mesh(merged, group.material);
      mesh.name = `merged-static-decor-${group.cullClass.replace(":", "-")}-${mergedMeshes}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.exteriorCullingClass = group.cullClass;
      mesh.userData.mergedSourceCount = group.count;
      scene.add(mesh);
      mergedMeshes += 1;
      mergedSources += group.count;
    }
    state.mergedDecor = { meshes: mergedMeshes, sources: mergedSources };
  }

  function registerExteriorDetailCulling() {
    const keepForFacade = /(?:upper-ceiling|basement-damp-course|portico|rain-soaked-grounds|estate-|driveway-|wet-cobblestone|front-carriage|rear-terrace|garden-|formal-garden|pool-|hedge-maze|locked-driveway|maze-approach|sconce|chandelier|bulb|light-fixture|frosted-shade)/i;
    const position = new THREE.Vector3();
    scene.updateMatrixWorld(true);
    scene.traverse((object) => {
      if (!object.isMesh) return;
      if (object.userData.fireplaceEffect) return;
      const preclassified = object.userData.exteriorCullingClass;
      if (preclassified) {
        // Merged decor already carries its culling class from its sources.
        if (preclassified === "interior") {
          object.userData.preExteriorVisibility = object.visible;
          interiorDetailMeshes.push(object);
        } else if (preclassified.startsWith("facade:")) {
          object.userData.preExteriorVisibility = object.visible;
          object.userData.facadeSide = preclassified.slice(7);
          facadeSideMeshes.push(object);
        }
        return;
      }
      object.getWorldPosition(position);
      let side = null;
      if (Math.abs(position.z - 12) < 0.72 && Math.abs(position.x) < 15.8) side = "front";
      else if (Math.abs(position.z + 12) < 0.72 && Math.abs(position.x) < 15.8) side = "rear";
      else if (Math.abs(position.x + 15) < 0.72 && Math.abs(position.z) < 12.8) side = "west";
      else if (Math.abs(position.x - 15) < 0.72 && Math.abs(position.z) < 12.8) side = "east";
      if (side) {
        object.userData.preExteriorVisibility = object.visible;
        object.userData.facadeSide = side;
        facadeSideMeshes.push(object);
        return;
      }
      if (keepForFacade.test(object.name || "")) return;
      if (Math.abs(position.x) > 15.25 || Math.abs(position.z) > 12.25) return;
      object.userData.preExteriorVisibility = object.visible;
      interiorDetailMeshes.push(object);
    });
  }

  function updateExteriorDetailCulling() {
    const p = physics.playerPosition();
    const isOutdoor = outdoorRoomNames.has(state.currentRoom);
    const houseDx = Math.max(Math.abs(p.x) - 15, 0);
    const houseDz = Math.max(Math.abs(p.z) - 12, 0);
    const distanceFromHouse = Math.hypot(houseDx, houseDz);
    const nearHouse = distanceFromHouse <= 3.6;
    exteriorDistanceFromHouse = distanceFromHouse;
    exteriorNearHouse = nearHouse;
    // Keep the complete room shell, doors, and furniture rendered before the
    // player reaches an exterior threshold. Far-yard culling still protects
    // performance, but it can no longer create a black interior with live
    // invisible colliders at the doorway.
    const shouldHide = isOutdoor && !nearHouse;
    const magnitude = Math.max(0.001, Math.hypot(p.x, p.z));
    const nx = p.x / magnitude;
    const nz = p.z / magnitude;
    const visibleSides = isOutdoor ? new Set([
      ...(nz > 0.35 ? ["front"] : []),
      ...(nz < -0.35 ? ["rear"] : []),
      ...(nx < -0.35 ? ["west"] : []),
      ...(nx > 0.35 ? ["east"] : []),
    ]) : new Set(["front", "rear", "west", "east"]);
    const nextFacadeKey = Array.from(visibleSides).sort().join("|");
    if (shouldHide === interiorDetailsHidden && nextFacadeKey === facadeVisibilityKey) {
      return;
    }
    interiorDetailsHidden = shouldHide;
    facadeVisibilityKey = nextFacadeKey;
    for (const mesh of interiorDetailMeshes) {
      mesh.visible = shouldHide ? false : mesh.userData.preExteriorVisibility !== false;
    }
    for (const mesh of facadeSideMeshes) {
      mesh.visible = visibleSides.has(mesh.userData.facadeSide) && mesh.userData.preExteriorVisibility !== false;
    }
    // Cabinet stock is interaction-owned: most contents are intentionally
    // hidden when this registry captures boot visibility. Restore the live
    // door state after exterior culling instead of the stale boot snapshot so
    // an open pantry remains stocked after a trip out to the grounds.
    for (const storage of stockedStorages) {
      if (!storage.stockMeshes) continue;
      for (const mesh of storage.stockMeshes) mesh.visible = !shouldHide && Boolean(storage.open);
    }
    renderer.shadowMap.needsUpdate = true;
  }

  function setMoveIntent(key, value) {
    if (key === "KeyW" || key === "ArrowUp") input.forward = value;
    if (key === "KeyS" || key === "ArrowDown") input.back = value;
    if (key === "KeyA" || key === "ArrowLeft") input.left = value;
    if (key === "KeyD" || key === "ArrowRight") input.right = value;
  }

  function activateCurrentInteraction() {
    if (state.journalOpen || state.contestant13.actionInProgress) return;
    if (!state.currentInteraction) return;
    state.currentInteraction.activate();
    updateInteractionPrompt();
  }

  function bindInput() {
    window.addEventListener("keydown", (event) => {
      if (event.code === "Tab" && state.journalOpen && dom.journal) {
        const focusable = Array.from(dom.journal.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"));
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (focusable.length === 1 || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        }
        return;
      }
      if (event.code === "KeyJ" && !event.repeat && contestant13Quest) {
        event.preventDefault();
        contestant13Quest.toggleJournal();
        return;
      }
      if (event.code === "Escape" && state.journalOpen && contestant13Quest) {
        contestant13Quest.setJournalOpen(false);
        return;
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
        setMoveIntent(event.code, true);
      }
      if (event.code === "KeyE" && !event.repeat) activateCurrentInteraction();
      if (event.code === "KeyM" && !event.repeat && audioSystem) audioSystem.setEnabled(!state.audioEnabled);
    });
    window.addEventListener("keyup", (event) => setMoveIntent(event.code, false));
    window.addEventListener("blur", () => {
      input.forward = input.back = input.left = input.right = false;
    });
    document.addEventListener("pointerlockchange", () => {
      state.pointerLocked = document.pointerLockElement === dom.canvas;
      dom.crosshair.classList.toggle("is-active", state.pointerLocked || matchMedia("(pointer: coarse)").matches);
    });
    document.addEventListener("mousemove", (event) => {
      if (!state.pointerLocked) return;
      state.yaw -= event.movementX * 0.00205;
      state.pitch = clamp(state.pitch - event.movementY * 0.00185, -1.35, 1.35);
    });
    dom.canvas.addEventListener("click", () => {
      if (state.journalOpen) return;
      if (state.pointerLocked) activateCurrentInteraction();
      else requestPointerLock();
    });

    if (dom.audio) dom.audio.addEventListener("click", async () => {
      if (!audioSystem) return;
      if (!state.audioEnabled) await audioSystem.unlock();
      else audioSystem.setEnabled(false);
    });
    if (dom.fullscreen) dom.fullscreen.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await dom.stage.requestFullscreen();
        else await document.exitFullscreen();
      } catch (_) { /* Fullscreen is optional. */ }
    });
    if (dom.journalButton) dom.journalButton.addEventListener("click", () => contestant13Quest && contestant13Quest.toggleJournal());
    if (dom.journalClose) dom.journalClose.addEventListener("click", () => contestant13Quest && contestant13Quest.setJournalOpen(false));
    if (dom.journal) dom.journal.addEventListener("click", (event) => {
      if (event.target === dom.journal && contestant13Quest) contestant13Quest.setJournalOpen(false);
    });

    const touchBindings = [
      ["touch-forward", "forward"], ["touch-back", "back"],
      ["touch-left", "left"], ["touch-right", "right"],
    ];
    for (const [id, property] of touchBindings) {
      const button = $(id);
      if (!button) continue;
      const release = (event) => {
        if (event) event.preventDefault();
        input[property] = false;
        button.classList.remove("is-held");
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        input[property] = true;
        button.classList.add("is-held");
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    }
    const touchInteract = $("touch-interact");
    if (touchInteract) touchInteract.addEventListener("pointerdown", (event) => { event.preventDefault(); activateCurrentInteraction(); });

    dom.canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || event.clientX < innerWidth * 0.38) return;
      input.touchLookId = event.pointerId;
      input.touchLookX = event.clientX;
      input.touchLookY = event.clientY;
      dom.canvas.setPointerCapture(event.pointerId);
    });
    dom.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== input.touchLookId) return;
      state.yaw -= (event.clientX - input.touchLookX) * 0.005;
      state.pitch = clamp(state.pitch - (event.clientY - input.touchLookY) * 0.004, -1.3, 1.3);
      input.touchLookX = event.clientX;
      input.touchLookY = event.clientY;
    });
    const endTouchLook = (event) => { if (event.pointerId === input.touchLookId) input.touchLookId = null; };
    dom.canvas.addEventListener("pointerup", endTouchLook);
    dom.canvas.addEventListener("pointercancel", endTouchLook);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => requestAnimationFrame(resize));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
    if (window.ResizeObserver) {
      const stageResizeObserver = new ResizeObserver(() => resize());
      stageResizeObserver.observe(dom.stage);
    }
    document.addEventListener("fullscreenchange", resize);
  }

  function computeRainExposure() {
    // How much of the storm reaches the player's ears. Outdoors is full
    // exposure; indoors the strongest nearby shell opening wins — an open
    // exterior door is open air, a window is loud but glassed, and away from
    // the shell only a faint roof wash remains (fainter still underground).
    if (outdoorRoomNames.has(state.currentRoom)) return 1;
    const p = physics.playerPosition();
    let strongest = state.currentFloor === "BASEMENT" ? 0.05
      : state.currentFloor === "SECOND FLOOR" ? 0.16
        : 0.12;
    const consider = (x, y, z, openness) => {
      const distance = Math.hypot(p.x - x, p.y - y, p.z - z);
      const falloff = clamp(1 - (distance - 1.1) / 6.4, 0, 1);
      const contribution = openness * falloff;
      if (contribution > strongest) strongest = contribution;
    };
    for (const aperture of rainApertures) consider(aperture.x, aperture.y, aperture.z, aperture.openness);
    for (const door of exteriorRainDoors) {
      const swing = clamp(door.angle / 1.2, 0, 1);
      consider(door.rainAperture.x, door.rainAperture.y, door.rainAperture.z, 0.26 + 0.74 * swing);
    }
    return clamp(strongest, 0, 1);
  }

  function updateLocation() {
    const previousLightContext = getLightRenderContext();
    const previousMazeLightingContext = state.mazeLightingContext;
    const p = physics.playerPosition();
    const feetY = p.y - (PLAYER.halfHeight + PLAYER.radius);
    let match = null;
    for (const zone of roomZones) {
      if (feetY >= zone.floorMin && feetY < zone.floorMax && p.x >= zone.x1 && p.x <= zone.x2 && p.z >= zone.z1 && p.z <= zone.z2) {
        match = zone;
        break;
      }
    }
    if (!match) {
      if (feetY < -0.5) match = { floorLabel: "BASEMENT", roomLabel: "SERVICE PASSAGE" };
      else if (feetY > 2.4) match = { floorLabel: "SECOND FLOOR", roomLabel: "LANDING" };
      else match = { floorLabel: "MAIN LEVEL", roomLabel: "CENTRAL HALL" };
    }
    let floorContextChanged = false;
    if (match.floorLabel !== state.currentFloor) {
      state.currentFloor = match.floorLabel;
      if (dom.floor) dom.floor.textContent = match.floorLabel;
      floorContextChanged = true;
    }
    if (match.roomLabel !== state.currentRoom) {
      state.currentRoom = match.roomLabel;
      if (dom.room) dom.room.textContent = match.roomLabel;
      if (state.qaRoute && state.qaRoute.status === "running" && !state.qaRoute.visitedRooms.includes(match.roomLabel)) {
        state.qaRoute.visitedRooms.push(match.roomLabel);
      }
    }
    state.mazeLightingContext = isMazeLightingContext(state.currentRoom, p);
    updateExteriorDetailCulling();
    if (audioSystem) audioSystem.setRainExposure(computeRainExposure());
    const lightContextChanged = previousLightContext !== getLightRenderContext();
    const mazeLightingContextChanged = previousMazeLightingContext !== state.mazeLightingContext;
    // Interior room labels never influence light state. The only room-level
    // boundary is the mansion shell itself: the grounds own a separate,
    // fixed-budget selection so exterior emitters do not inflate every indoor
    // main-floor fragment shader. Floor and shell handovers snap:
    // the walls hide the retiring set, while a fade would briefly place both
    // floors in the shader and recreate the exact staircase slowdown this
    // compact fixed layout is designed to avoid.
    if (floorContextChanged) syncLightRendering();
    else if (lightContextChanged) syncLightRendering();
    else if (mazeLightingContextChanged) syncLightRendering();
  }

  function findInteraction() {
    if (state.journalOpen || state.contestant13.actionInProgress) return null;
    if (state.activeHideSpot) return state.activeHideSpot.interaction;
    raycaster.setFromCamera(lookCenter, camera);
    const hits = raycaster.intersectObjects(interactableMeshes, true);
    if (!hits.length) return null;
    const hit = hits[0];
    if (hit.distance > PLAYER.interactionRange) return null;
    const blockers = raycaster.intersectObjects(occluderMeshes, false);
    if (blockers.length && blockers[0].distance < hit.distance - 0.075) return null;
    let object = hit.object;
    while (object && !object.userData.interaction) object = object.parent;
    return object ? object.userData.interaction : null;
  }

  function inspectInteractionRay() {
    if (!state.qa) return null;
    const selected = findInteraction();
    raycaster.setFromCamera(lookCenter, camera);
    const hits = raycaster.intersectObjects(interactableMeshes, true);
    const blockers = raycaster.intersectObjects(occluderMeshes, false);
    let interactionObject = hits[0]?.object || null;
    while (interactionObject && !interactionObject.userData.interaction) interactionObject = interactionObject.parent;
    return {
      hit: hits[0] ? {
        name: hits[0].object.name,
        distance: Number(hits[0].distance.toFixed(2)),
        interactionId: interactionObject?.userData?.interaction?.id || interactionObject?.userData?.interaction?.type || null,
      } : null,
      blocker: blockers[0] ? { name: blockers[0].object.name, distance: Number(blockers[0].distance.toFixed(2)) } : null,
      stateBlocked: state.journalOpen ? "journal-open" : state.contestant13.actionInProgress ? "story-action" : null,
      selectableId: selected?.id || selected?.type || null,
    };
  }

  function updateInteractionPrompt() {
    state.currentInteraction = findInteraction();
    if (!dom.prompt) return;
    if (!state.currentInteraction || !state.started) {
      dom.prompt.hidden = true;
      return;
    }
    dom.prompt.hidden = false;
    if (dom.promptKey) dom.promptKey.textContent = matchMedia("(pointer: coarse)").matches ? "TAP E" : "E";
    if (dom.promptText) dom.promptText.textContent = state.currentInteraction.getLabel();
  }

  // Cross-floor light continuity: an authored floor-context change retires
  // and introduces fixtures through a slow, eye-adjustment fade instead of a
  // hard toggle, so climbing a stair never reads as lights reacting to the
  // player. Physical switches, cabinets, and QA stay instant ("snap"): a
  // flipped switch must feel electrical and QA captures stay deterministic.
  const LIGHT_FADE_IN_RATE = 1.6;
  // Fade-out is quick enough to keep the both-floors light union — the most
  // expensive frames the renderer ever draws — under three quarters of a
  // second, while still reading as a fade rather than a switch.
  const LIGHT_FADE_OUT_RATE = 1.35;

  function applyLightRenderState(light, placed, energized, snap) {
    const data = light.userData;
    if (data.renderFactor == null) data.renderFactor = light.intensity > 0 ? 1 : 0;
    data.renderPlaced = placed;
    data.renderTarget = placed && energized ? 1 : 0;
    if (snap || data.renderFactor === data.renderTarget) {
      data.renderFactor = data.renderTarget;
      fadingLights.delete(light);
    } else {
      fadingLights.add(light);
    }
    const wasVisible = light.visible;
    // A placed fixture stays in the render set even while switched off so a
    // wall switch never restructures the shader light loop; a retired fixture
    // leaves the set only once its fade has fully settled.
    light.visible = placed || data.renderFactor > 0.004;
    light.intensity = data.baseIntensity * data.renderFactor * (data.renderIntensityScale || 1);
    return light.visible !== wasVisible && Boolean(light.castShadow);
  }

  function applyBulbRenderState(bulb, lit, snap) {
    const data = bulb.userData;
    if (data.renderFactor == null) data.renderFactor = bulb.material.emissiveIntensity > 0 ? 1 : 0;
    data.renderTarget = lit ? 1 : 0;
    if (snap || data.renderFactor === data.renderTarget) {
      data.renderFactor = data.renderTarget;
      fadingBulbs.delete(bulb);
    } else {
      fadingBulbs.add(bulb);
    }
    bulb.material.emissiveIntensity = (data.onEmissiveIntensity || 1.4) * data.renderFactor;
  }

  function stepRenderFactor(data, dt) {
    const rate = data.renderTarget > data.renderFactor ? LIGHT_FADE_IN_RATE : LIGHT_FADE_OUT_RATE;
    data.renderFactor = data.renderTarget > data.renderFactor
      ? Math.min(data.renderTarget, data.renderFactor + rate * dt)
      : Math.max(data.renderTarget, data.renderFactor - rate * dt);
    return data.renderFactor === data.renderTarget;
  }

  function updateLightTransitions(dt) {
    if (!fadingLights.size && !fadingBulbs.size) return;
    let shadowTopologyChanged = false;
    for (const light of fadingLights) {
      const data = light.userData;
      const settled = stepRenderFactor(data, dt);
      const wasVisible = light.visible;
      light.visible = data.renderPlaced || data.renderFactor > 0.004;
      light.intensity = data.baseIntensity * data.renderFactor * (data.renderIntensityScale || 1);
      if (light.visible !== wasVisible && light.castShadow) shadowTopologyChanged = true;
      if (settled) fadingLights.delete(light);
    }
    for (const bulb of fadingBulbs) {
      const data = bulb.userData;
      const settled = stepRenderFactor(data, dt);
      bulb.material.emissiveIntensity = (data.onEmissiveIntensity || 1.4) * data.renderFactor;
      if (settled) fadingBulbs.delete(bulb);
    }
    if (shadowTopologyChanged) renderer.shadowMap.needsUpdate = true;
  }

  function getLightRenderContext(floorLabel = state.currentFloor, roomLabel = state.currentRoom) {
    if (floorLabel === "MAIN LEVEL") {
      return outdoorRoomNames.has(roomLabel) ? "grounds" : "main-interior";
    }
    return floorLabel.toLowerCase().replaceAll(" ", "-");
  }

  function isMazeLightingContext(roomLabel = state.currentRoom, position = null) {
    if (roomLabel === "HEDGE MAZE") return true;
    if ((roomLabel !== "EAST LAWN" && roomLabel !== "REAR LAWN") || !position) return false;
    const halfWidth = HEDGE_MAZE_LAYOUT.rows[0].length * HEDGE_MAZE_LAYOUT.cellSize / 2;
    const halfDepth = HEDGE_MAZE_LAYOUT.rows.length * HEDGE_MAZE_LAYOUT.cellSize / 2;
    return position.x >= HEDGE_MAZE_LAYOUT.centerX - halfWidth - HEDGE_MAZE_LAYOUT.cellSize * 2
      && position.x <= HEDGE_MAZE_LAYOUT.centerX + halfWidth + HEDGE_MAZE_LAYOUT.cellSize
      && position.z >= HEDGE_MAZE_LAYOUT.centerZ - halfDepth - HEDGE_MAZE_LAYOUT.cellSize
      && position.z <= HEDGE_MAZE_LAYOUT.centerZ + halfDepth + HEDGE_MAZE_LAYOUT.cellSize;
  }

  function circuitRendersInContext(circuit, floors, renderContext) {
    const rendersOnFloor = [...floors].some((floor) => circuit.levels.has(floor));
    const isExteriorCircuit = circuit === yardState.circuit || circuit.name === "estate exterior lights";
    if (!floors.has("MAIN LEVEL")) return rendersOnFloor;
    if (renderContext === "grounds") return isExteriorCircuit;
    return !isExteriorCircuit && rendersOnFloor;
  }

  function getContextLightingTargets() {
    const renderContext = getLightRenderContext();
    const openVolume = OPEN_VOLUME_LIGHT_ROOMS.has(state.currentRoom);
    const mazeContext = state.mazeLightingContext;
    return {
      hemisphere: renderContext === "grounds"
        ? mazeContext ? MAZE_HEMISPHERE_INTENSITY : GROUNDS_HEMISPHERE_INTENSITY
        : openVolume ? OPEN_VOLUME_HEMISPHERE_INTENSITY : NIGHT_LIGHTING.hemisphereIntensity,
      moon: renderContext === "grounds"
        ? mazeContext ? MAZE_MOON_INTENSITY : GROUNDS_MOON_INTENSITY
        : NIGHT_LIGHTING.moonIntensity,
    };
  }

  function updateContextLighting(dt) {
    if (!hemisphereLight || !moonLight) return;
    const targets = getContextLightingTargets();
    const blend = 1 - Math.exp(-CONTEXT_LIGHTING_RESPONSE * dt);
    hemisphereLight.intensity += (targets.hemisphere - hemisphereLight.intensity) * blend;
    moonLight.intensity += (targets.moon - moonLight.intensity) * blend;
  }

  function selectBudgetedCircuitLights(floors, renderContext) {
    const selectedLights = new Set();
    // Cabinet spots are useful indoors, but on the grounds they would reserve
    // two shader entries while contributing no energy. Padding still restores
    // the exact 6/11 program shape after exterior emitters are selected.
    const auxiliarySpotReserve = renderContext === "grounds"
      ? 0
      : auxiliaryInteriorLights.filter((light) => light.isSpotLight).length;
    const spotLimit = Math.max(0, MOBILE_SHADER_SPOT_BUDGET - auxiliarySpotReserve);
    const pointLimit = MOBILE_SHADER_POINT_BUDGET;
    let selectedSpots = 0;
    let selectedPoints = 0;

    const rendersOnLevel = (light) => !light.userData.levels || light.userData.levels.has(state.currentFloor);
    const enclosureAvailable = (light) => {
      const enclosure = light.userData.requiresOpenCabinet;
      return !enclosure || enclosure.open || enclosure.angle > 0.025;
    };
    const trySelect = (light, customSpotLimit = spotLimit, customPointLimit = pointLimit) => {
      if (!light || selectedLights.has(light) || !rendersOnLevel(light) || !enclosureAvailable(light)) return false;
      if (light.isSpotLight) {
        if (selectedSpots >= customSpotLimit) return false;
        selectedSpots += 1;
      } else if (light.isPointLight) {
        if (selectedPoints >= customPointLimit) return false;
        selectedPoints += 1;
      } else {
        return false;
      }
      selectedLights.add(light);
      return true;
    };

    const renderedCircuits = circuits.filter((circuit) => circuitRendersInContext(circuit, floors, renderContext));
    if (renderContext === "grounds") {
      const exteriorCircuit = yardState.circuit || renderedCircuits.find((circuit) => circuit.name === "estate exterior lights");
      const candidates = exteriorCircuit
        ? exteriorCircuit.lights.filter(rendersOnLevel).sort((a, b) => (
          (a.userData.exteriorBudgetPriority ?? 100) - (b.userData.exteriorBudgetPriority ?? 100)
        ))
        : [];
      const groundsSpotLimit = Math.min(spotLimit, GROUND_BUDGETED_SPOT_LIGHTS);
      const groundsPointLimit = Math.min(pointLimit, GROUND_BUDGETED_POINT_LIGHTS);
      if (state.mazeLightingContext) {
        const mazeCandidates = candidates
          .filter((light) => Number.isFinite(light.userData.mazeBudgetPriority))
          .sort((a, b) => a.userData.mazeBudgetPriority - b.userData.mazeBudgetPriority);
        for (const light of mazeCandidates) trySelect(light, groundsSpotLimit, groundsPointLimit);
      }
      for (const light of candidates) trySelect(light, groundsSpotLimit, groundsPointLimit);
      return selectedLights;
    }

    // First preserve one representative from every switch-owned circuit so
    // closed rooms do not lose their authored light. Open-volume circuits use
    // their broad point fill for this representative, matching the previous
    // stable budget's coverage.
    for (const circuit of renderedCircuits) {
      const eligible = circuit.lights.filter((light) => rendersOnLevel(light) && enclosureAvailable(light));
      const preferred = (MOBILE_UPPER_AMBIENT_CIRCUITS.has(circuit.name)
        ? eligible.find((light) => light.isPointLight)
        : null)
        || eligible.find((light) => light.userData.fixtureRole === "primary")
        || eligible.find((light) => light.userData.visibleFixtureEmitter)
        || eligible[0];
      if (trySelect(preferred)) continue;
      trySelect(eligible.find((light) => (
        (light.isSpotLight && selectedSpots < spotLimit)
        || (light.isPointLight && selectedPoints < pointLimit)
      )));
    }

    // Bathroom ceiling fixtures keep their central room omni, then claim one
    // already-paid spot slot for the shower. This displaces only an optional
    // open-volume extra and leaves the fixed 6-spot/11-point shader intact.
    for (const circuit of renderedCircuits) {
      trySelect(circuit.lights.find((light) => light.userData.fixtureRole === "shower-downlight"));
    }

    // Fill the already-paid empty spot slots round-robin across the foyer,
    // grand stair, and upper landing. This restores their downward cones
    // instead of merely making one broad point fill brighter.
    const openVolumeQueues = [];
    for (const circuitName of OPEN_VOLUME_BUDGET_CIRCUITS) {
      const circuit = renderedCircuits.find((candidate) => candidate.name === circuitName);
      if (circuit) openVolumeQueues.push(circuit.lights.filter((light) => rendersOnLevel(light) && enclosureAvailable(light) && !selectedLights.has(light)));
    }
    let filledOpenVolumeSlot = true;
    while (filledOpenVolumeSlot && (selectedSpots < spotLimit || selectedPoints < pointLimit)) {
      filledOpenVolumeSlot = false;
      for (const queue of openVolumeQueues) {
        while (queue.length) {
          const light = queue.shift();
          if (!trySelect(light)) continue;
          filledOpenVolumeSlot = true;
          break;
        }
      }
    }

    // If a future fixture edit leaves another paid slot empty, use a real
    // stable emitter before falling back to a zero-energy padding light.
    for (const circuit of renderedCircuits) {
      for (const light of circuit.lights) trySelect(light);
    }
    return selectedLights;
  }

  function syncLightRendering(transition) {
    const fade = transition === "fade" && !state.qa;
    const floors = new Set([state.currentFloor]);
    const renderContext = getLightRenderContext();
    const budgetedLights = selectBudgetedCircuitLights(floors, renderContext);
    lightRenderPolicy = `manual-circuits-context-stable:${renderContext}`;
    let shadowTopologyChanged = false;
    const boundedCircuitBudget = true;
    for (const circuit of circuits) {
      const rendersOnFloor = circuit.levels.has(state.currentFloor);
      // Indoor main-floor, grounds, upper, and basement layouts are each
      // stable while the player moves inside that authored context. In
      // particular, exterior emitters never occupy indoor shader slots.
      const rendersInContext = circuitRendersInContext(circuit, floors, renderContext);
      circuit.setGlowRenderState(circuit.on && rendersInContext);
      const mobileUpperBudget = state.mobileRenderProfile && floors.has("SECOND FLOOR");
      for (const light of circuit.lights) {
        // The fixed light profile keeps the moon as the single structural
        // shadow source. Floor-local spot shadows changed the shader's shadow
        // count from 0 to 4 at the upper stair, producing a multi-second first
        // frame hitch even after the normal light counts were stabilized.
        // Painted fixture response and the cached moon shadow preserve depth
        // without that floor-dependent program shape.
        if (boundedCircuitBudget && light.castShadow) {
          light.userData.authoredCastShadow = true;
          light.castShadow = false;
        }
        const lightLevels = light.userData.levels;
        const rendersOnLevel = lightLevels ? lightLevels.has(state.currentFloor) : rendersOnFloor;
        const enclosure = light.userData.requiresOpenCabinet;
        const enclosureOpen = !enclosure || enclosure.open || enclosure.angle > 0.025;
        light.userData.renderIntensityScale = state.mobileRenderProfile && budgetedLights.has(light)
          ? (mobileUpperBudget && MOBILE_UPPER_AMBIENT_CIRCUITS.has(circuit.name)
            ? MOBILE_UPPER_AMBIENT_SCALE
            : MOBILE_CIRCUIT_INTENSITY_SCALE)
          : 1;
        // Padding holds the shader type count when a closet is closed. Opening
        // it can replace one zero-energy spot with the real lamp without
        // minting a new program; the enclosure still gates its energy.
        const nextVisible = rendersInContext && rendersOnLevel && budgetedLights.has(light);
        if (applyLightRenderState(light, nextVisible, circuit.on && enclosureOpen, !fade)) shadowTopologyChanged = true;
      }
      for (const bulb of circuit.bulbs) {
        const enclosure = bulb.userData.requiresOpenCabinet;
        const bulbLevels = bulb.userData.levels;
        const bulbRendersOnLevel = !bulbLevels || bulbLevels.has(state.currentFloor);
        const lit = circuit.on && rendersInContext && bulbRendersOnLevel && (!enclosure || enclosure.open || enclosure.angle > 0.025);
        applyBulbRenderState(bulb, lit, !fade);
      }
    }
    const allCircuitsOff = circuits.length > 0 && circuits.every((circuit) => !circuit.on);
    for (const light of auxiliaryInteriorLights) {
      const interactionVisible = Boolean(light.userData.interactionVisible);
      // The two cabinet lamps hold stable indoor shader slots. Grounds reuse
      // those spots for authored exterior pools, while padding keeps the type
      // counts identical; the door and blackout state only gate the energy.
      light.visible = renderContext !== "grounds";
      light.intensity = light.visible && !allCircuitsOff && interactionVisible ? light.userData.baseIntensity : 0;
    }
    syncMobileShaderPadding();
    // Shadow caching is static between interactions. A newly visible upper
    // closet or floor-local chandelier therefore requests exactly one refresh
    // rather than silently using an uninitialized map.
    if (shadowTopologyChanged) renderer.shadowMap.needsUpdate = true;
  }

  function ensureMobileShaderPadding() {
    if (mobileShaderPaddingLights.spots.length || mobileShaderPaddingLights.points.length) return;
    for (let i = 0; i < MOBILE_SHADER_SPOT_BUDGET; i += 1) {
      const light = new THREE.SpotLight(0x000000, 0, 0, Math.PI / 3, 0, 2);
      light.name = `mobile-shader-padding-spot-${i + 1}`;
      light.position.set(0, -100, 0);
      light.target.position.set(0, -101, 0);
      light.castShadow = false;
      light.visible = false;
      scene.add(light, light.target);
      mobileShaderPaddingLights.spots.push(light);
    }
    for (let i = 0; i < MOBILE_SHADER_POINT_BUDGET; i += 1) {
      const light = new THREE.PointLight(0x000000, 0, 0, 2);
      light.name = `mobile-shader-padding-point-${i + 1}`;
      light.position.set(0, -100, 0);
      light.castShadow = false;
      light.visible = false;
      scene.add(light);
      mobileShaderPaddingLights.points.push(light);
    }
  }

  function syncMobileShaderPadding() {
    // Padding is shared by desktop and mobile so room/floor changes retain the
    // exact same shader program instead of compiling at the staircase.
    ensureMobileShaderPadding();
    const visibleSpotLights = circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.isSpotLight).length, 0)
      + auxiliaryInteriorLights.filter((light) => light.visible && light.isSpotLight).length;
    const visiblePointLights = circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.isPointLight).length, 0)
      + auxiliaryInteriorLights.filter((light) => light.visible && light.isPointLight).length;
    const requiredSpots = Math.max(0, MOBILE_SHADER_SPOT_BUDGET - visibleSpotLights);
    const requiredPoints = Math.max(0, MOBILE_SHADER_POINT_BUDGET - visiblePointLights);
    mobileShaderPaddingLights.spots.forEach((light, index) => {
      light.visible = index < requiredSpots;
      light.intensity = 0;
    });
    mobileShaderPaddingLights.points.forEach((light, index) => {
      light.visible = index < requiredPoints;
      light.intensity = 0;
    });
  }

  function updatePlayer(fixedDt) {
    if (!state.started) {
      physics.movePlayer(0, 0);
      physics.step();
      physics.updateSafety();
      return;
    }
    if (state.isHidden) {
      // Looking remains available, but keyboard and touch movement cannot
      // walk the capsule out while the AI-facing state still says hidden.
      physics.movePlayer(0, 0);
      physics.step();
      physics.updateSafety();
      state.lastMove = { dx: 0, dz: 0 };
      return;
    }
    if (state.journalOpen || state.contestant13.actionInProgress) {
      physics.movePlayer(0, 0);
      physics.step();
      physics.updateSafety();
      state.lastMove = { dx: 0, dz: 0 };
      return;
    }
    let forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    let strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const length = Math.hypot(forward, strafe);
    if (length > 1) {
      forward /= length;
      strafe /= length;
    }
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    const dx = (strafe * cos - forward * sin) * PLAYER.speed * fixedDt;
    const dz = (-strafe * sin - forward * cos) * PLAYER.speed * fixedDt;
    if (dx || dz) state.lastMove = { dx, dz };
    physics.movePlayer(dx, dz);
    physics.step();
    physics.updateSafety();
  }

  function syncCamera() {
    const p = physics.playerPosition();
    // Rapier's controller keeps a small skin depth around stepped surfaces; the
    // extra 0.17m preserves the authored 1.67m eye line without changing collision.
    camera.position.set(p.x, p.y + PLAYER.eye - (PLAYER.halfHeight + PLAYER.radius) + 0.17, p.z);
    camera.rotation.y = state.yaw;
    camera.rotation.x = state.pitch;
  }

  let accumulator = 0;
  let diagnosticsTimer = 0;
  let interactionTimer = 0;
  let fpsFrames = 0;
  let fpsElapsed = 0;
  let lowFpsSeconds = 0;
  let lastAnimationFrameAt = 0;

  function getTargetFrameInterval() {
    if (!state.started && !state.qa) return PRE_ENTRY_FRAME_INTERVAL_MS;
    if (state.mobileRenderProfile || state.renderQuality === "reduced") return BALANCED_FRAME_INTERVAL_MS;
    return 0;
  }

  function getFrameSchedule() {
    if (!state.started && !state.qa) return "idle-preview";
    if (state.mobileRenderProfile || state.renderQuality === "reduced") return "balanced-30fps";
    return "full-refresh";
  }

  function animate(frameNow = performance.now()) {
    requestAnimationFrame(animate);
    if (state.contextLost) return;
    // Browsers normally suspend rAF in background tabs, but explicitly
    // draining the clock here prevents a giant catch-up step on engines that
    // still deliver a final callback while the document is hidden.
    if (document.hidden) {
      clock.getDelta();
      lastAnimationFrameAt = frameNow;
      return;
    }
    const targetFrameInterval = getTargetFrameInterval();
    if (targetFrameInterval > 0 && frameNow - lastAnimationFrameAt < targetFrameInterval - 1) return;
    lastAnimationFrameAt = frameNow;
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.075);
    state.frameTime = rawDt * 1000;
    fpsFrames += 1;
    fpsElapsed += rawDt;
    if (fpsElapsed >= 0.5) {
      state.fps = fpsFrames / fpsElapsed;
      if (state.started && !state.qa && state.renderQuality === "high") {
        const lowFpsThreshold = state.mobileRenderProfile ? 24 : 40;
        lowFpsSeconds = state.fps < lowFpsThreshold
          ? lowFpsSeconds + fpsElapsed
          : Math.max(0, lowFpsSeconds - fpsElapsed * 0.5);
        if (lowFpsSeconds >= 2.5) {
          state.renderQuality = "reduced";
          resize();
        }
      }
      fpsFrames = 0;
      fpsElapsed = 0;
    }

    for (const object of animatedObjects) object.update(dt);
    for (const system of yardWaterSystems) system.update(dt);
    updateLightTransitions(dt);
    if (rainSystem) rainSystem.update(dt);
    if (stormSystem) stormSystem.update(dt);
    if (state.contestant13.relaySabotaged && contestant13Scene.relayAlarmMaterial) {
      const warningPulse = 0.5 + Math.sin(frameNow * 0.009) * 0.5;
      contestant13Scene.relayAlarmMaterial.emissiveIntensity = 1.55 + warningPulse * 2.1;
    }

    accumulator += dt;
    while (accumulator >= 1 / 60) {
      updatePlayer(1 / 60);
      accumulator -= 1 / 60;
    }
    syncCamera();

    interactionTimer -= dt;
    diagnosticsTimer -= dt;
    if (interactionTimer <= 0) {
      updateInteractionPrompt();
      updateLocation();
      interactionTimer = 0.08;
    }
    updateContextLighting(dt);
    // The diagnostics object is available on demand through the QA API. Do
    // not stringify its large room/circuit/yard payload into a hidden DOM node
    // twice per second during normal play; those allocations caused periodic
    // garbage-collection hitches that were most noticeable in the grand stair.
    if (diagnosticsTimer <= 0 && dom.debug && !dom.debug.hidden) {
      dom.debug.textContent = JSON.stringify(getDiagnostics(), null, 2);
      diagnosticsTimer = 0.5;
    }
    renderer.render(scene, camera);
  }

  function getDiagnostics() {
    const p = physics ? physics.playerPosition() : { x: 0, y: 0, z: 0 };
    const feetY = p.y - (PLAYER.halfHeight + PLAYER.radius);
    const info = renderer.info;
    const circuitByName = new Map(circuits.map((circuit) => [circuit.name, circuit]));
    const roomsWithoutControlledLight = Object.entries(ROOM_LIGHTING)
      .filter(([, names]) => !names.some((name) => circuitByName.has(name) && circuitByName.get(name).controls > 0))
      .map(([room]) => room);
    const mappedCircuitNames = new Set(Object.values(ROOM_LIGHTING).flat());
    const contextLightingTargets = getContextLightingTargets();
    const foodItems = stockedStorages
      .filter((storage) => FOOD_STORAGE_KINDS.has(storage.stockKind))
      .reduce((total, storage) => total + storage.itemCount, 0);
    const dishItems = stockedStorages
      .filter((storage) => storage.stockKind === "dishes")
      .reduce((total, storage) => total + storage.itemCount, 0);
    return {
      ready: state.ready,
      started: state.started,
      startupPhase: state.startupPhase,
      startupReadyMs: state.startupReadyMs == null ? null : Number(state.startupReadyMs.toFixed(1)),
      startupSafeGpuProfile: startupSafeGpuProfile,
      contextLost: state.contextLost,
      floor: state.currentFloor,
      room: state.currentRoom,
      hidden: state.isHidden,
      hiding: {
        active: state.isHidden,
        spot: state.activeHideSpot ? state.activeHideSpot.name : null,
        movementLocked: state.isHidden,
        availableSpots: hidingSpots.map((spot) => spot.name),
      },
      inventory: contestant13Quest?.getInventoryDiagnostics() || { items: [], bulkyItem: null },
      journal: contestant13Quest?.getJournalDiagnostics() || { entries: [], currentObjective: null, open: false },
      contestant13: contestant13Quest?.getDiagnostics() || null,
      mrFeast: mrFeastNpc?.getDiagnostics() || null,
      player: {
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        feetY: Number(feetY.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        yaw: Number(state.yaw.toFixed(3)),
        pitch: Number(state.pitch.toFixed(3)),
        grounded: Boolean(physics && physics.grounded),
        hidden: state.isHidden,
      },
      lastMove: { dx: Number(state.lastMove.dx.toFixed(4)), dz: Number(state.lastMove.dz.toFixed(4)) },
      qaRoute: state.qaRoute,
      prompt: state.currentInteraction ? state.currentInteraction.getLabel() : null,
      interactionRay: inspectInteractionRay(),
      interactions: {
        doorsOpen: animatedObjects.filter((object) => object instanceof HingedDoor && object.open).length,
        doorsTotal: animatedObjects.filter((object) => object instanceof HingedDoor).length,
        exteriorDoors: animatedObjects
          .filter((object) => object instanceof HingedDoor && /(?:front door|terrace door)/i.test(object.name))
          .map((door) => ({ name: door.name, open: door.open, angle: Number(door.angle.toFixed(3)), colliderEnabled: door.collider.isEnabled() })),
        cabinetsOpen: animatedObjects.filter((object) => object instanceof Cabinet && object.open).length,
        cabinetsTotal: animatedObjects.filter((object) => object instanceof Cabinet).length,
        walkInClosets: animatedObjects
          .filter((object) => object instanceof Cabinet && object.walkIn)
          .map((closet) => ({
            name: closet.name,
            doorOpen: Boolean(closet.open),
            interiorVisible: Boolean(closet.walkInInteriorRoot && closet.walkInInteriorRoot.visible),
            lightOn: Boolean(closet.lightCircuit && closet.lightCircuit.on),
            lightVisible: Boolean(closet.lightCircuit && closet.lightCircuit.lights.some((light) => light.visible && light.intensity > 0)),
            lightIntensity: Number((closet.lightCircuit?.lights[0]?.intensity || 0).toFixed(2)),
            thresholdColliderEnabled: Boolean(closet.thresholdCollider && closet.thresholdCollider.isEnabled && closet.thresholdCollider.isEnabled()),
          })),
        hidingSpots: hidingSpots.map((spot) => ({ name: spot.name, active: state.activeHideSpot === spot })),
        waterFixturesTotal: waterFixtures.length,
        waterRunning: waterFixtures.filter((fixture) => fixture.on).map((fixture) => fixture.name),
        toiletsTotal: toilets.length,
        toilets: toilets.map((toilet) => ({
          name: toilet.name,
          flushing: Boolean(toilet.flushing),
          flushTime: Number(toilet.flushTime.toFixed(2)),
          flushCount: toilet.flushCount,
        })),
        fireplacesTotal: fireplaces.length,
        fireplaces: fireplaces.map((fireplace) => ({
          name: fireplace.name,
          on: Boolean(fireplace.on),
          floor: fireplace.floorLabel,
          effectsVisible: fireplace.flames.some((flame) => flame.sprite.visible),
          flameCount: fireplace.flames.length,
        })),
        refrigerators: refrigerators.length,
        refrigeratorOpen: refrigerators.some((refrigerator) => refrigerator.open),
        foodItems,
        dishItems,
        stockedStorage: stockedStorages.map((storage) => ({
          name: storage.name,
          kind: storage.stockKind,
          itemCount: storage.itemCount,
          open: Boolean(storage.open),
          interiorLight: Boolean(storage.interiorLight),
        })),
      },
      artwork: {
        expectedTextures: Object.keys(PORTRAIT_ARTWORKS).length,
        loadedTextures: portraitTextures.size,
        placedFrames: portraitPlacements.length,
        fallbackFrames: portraitPlacements.filter((placement) => !placement.loaded).length,
        uniqueArtIds: Array.from(new Set(portraitPlacements.map((placement) => placement.artId).filter(Boolean))),
      },
      audio: {
        enabled: state.audioEnabled,
        activeWaterLoops: audioSystem && audioSystem.waterLoops
          ? Array.from(audioSystem.waterLoops.entries()).filter(([, entry]) => entry.active).map(([name]) => name)
          : [],
        rain: audioSystem ? audioSystem.rainDiagnostics() : null,
        rainApertures: rainApertures.length,
        exteriorRainDoors: exteriorRainDoors.length,
      },
      lighting: {
        allOff: circuits.every((circuit) => !circuit.on),
        allOn: circuits.every((circuit) => circuit.on),
        activeLocalLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.intensity > 0).length, 0),
        activeAuxiliaryLights: auxiliaryInteriorLights.filter((light) => light.visible && light.intensity > 0).length,
        activeShadowLights: renderer.shadowMap.enabled ? circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.intensity > 0 && light.castShadow).length, 0) : 0,
        activeSceneShadowLights: renderer.shadowMap.enabled ? 1 + circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.intensity > 0 && light.castShadow).length, 0) : 0,
        activeSpotLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.intensity > 0 && light.isSpotLight).length, 0),
        activePointLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.intensity > 0 && light.isPointLight).length, 0),
        activeFixtureEmitters: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.intensity > 0 && light.userData.visibleFixtureEmitter).length, 0),
        activeLightPools: circuits.reduce((total, circuit) => total + circuit.glowMaterials.filter((material) => material.userData.renderLit).length, 0),
        renderMode: "manual-circuits-context-stable-real-emitters",
        renderPolicy: lightRenderPolicy,
        renderContext: getLightRenderContext(),
        mazeLightingContext: state.mazeLightingContext,
        mobileRenderProfile: state.mobileRenderProfile,
        mobileLightBudgetPerCircuit: null,
        mobileUpperLightBudget: state.mobileRenderProfile && state.currentFloor === "SECOND FLOOR"
          ? { spots: MOBILE_SHADER_SPOT_BUDGET, points: MOBILE_SHADER_POINT_BUDGET }
          : null,
        mobileUpperStableLighting: state.mobileRenderProfile && state.currentFloor === "SECOND FLOOR",
        mobileUpperAmbientScale: state.mobileRenderProfile && state.currentFloor === "SECOND FLOOR" ? MOBILE_UPPER_AMBIENT_SCALE : 1,
        boundedLightProfile: true,
        shaderLocalLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible).length, 0)
          + mobileShaderPaddingLights.spots.filter((light) => light.visible).length
          + mobileShaderPaddingLights.points.filter((light) => light.visible).length,
        shaderAuxiliaryLights: auxiliaryInteriorLights.filter((light) => light.visible).length,
        shaderSpotLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.isSpotLight).length, 0)
          + auxiliaryInteriorLights.filter((light) => light.visible && light.isSpotLight).length
          + mobileShaderPaddingLights.spots.filter((light) => light.visible).length,
        shaderPointLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.isPointLight).length, 0)
          + auxiliaryInteriorLights.filter((light) => light.visible && light.isPointLight).length
          + mobileShaderPaddingLights.points.filter((light) => light.visible).length,
        shaderPaddingLights: mobileShaderPaddingLights.spots.filter((light) => light.visible).length
          + mobileShaderPaddingLights.points.filter((light) => light.visible).length,
        shaderRealSpotLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.isSpotLight).length, 0)
          + auxiliaryInteriorLights.filter((light) => light.visible && light.isSpotLight).length,
        shaderRealPointLights: circuits.reduce((total, circuit) => total + circuit.lights.filter((light) => light.visible && light.isPointLight).length, 0)
          + auxiliaryInteriorLights.filter((light) => light.visible && light.isPointLight).length,
        shaderPaddingSpotLights: mobileShaderPaddingLights.spots.filter((light) => light.visible).length,
        shaderPaddingPointLights: mobileShaderPaddingLights.points.filter((light) => light.visible).length,
        shaderSpotBudget: MOBILE_SHADER_SPOT_BUDGET,
        shaderPointBudget: MOBILE_SHADER_POINT_BUDGET,
        crossFloorFade: {
          fadingLights: fadingLights.size,
          fadingBulbs: fadingBulbs.size,
          fadeInRate: LIGHT_FADE_IN_RATE,
          fadeOutRate: LIGHT_FADE_OUT_RATE,
        },
        pixelRatio: Number(renderer.getPixelRatio().toFixed(2)),
        activeFloor: state.currentFloor,
        hemisphereIntensity: hemisphereLight ? Number(hemisphereLight.intensity.toFixed(3)) : NIGHT_LIGHTING.hemisphereIntensity,
        hemisphereTarget: contextLightingTargets.hemisphere,
        moonIntensity: moonLight ? Number(moonLight.intensity.toFixed(3)) : NIGHT_LIGHTING.moonIntensity,
        moonTarget: contextLightingTargets.moon,
        exposure: Number(renderer.toneMappingExposure.toFixed(3)),
        maxTextureUnits: renderer.capabilities.maxTextures,
        fullRoomShadowSet: supportsFullRoomShadowSet,
        uncontrolledCircuits: circuits.filter((circuit) => circuit.controls < 1).map((circuit) => circuit.name),
        roomsWithoutControlledLight,
        unmappedCircuits: circuits.filter((circuit) => !mappedCircuitNames.has(circuit.name)).map((circuit) => circuit.name),
      },
      rendering: {
        interiorDetailsHidden: Boolean(interiorDetailsHidden),
        facadeVisibilityKey,
        exteriorDistanceFromHouse: Number(exteriorDistanceFromHouse.toFixed(2)),
        exteriorNearHouse: Boolean(exteriorNearHouse),
        mergedDecor: state.mergedDecor || null,
      },
      circuits: circuits.map((c) => ({
        name: c.name,
        on: c.on,
        controls: c.controls,
        levels: Array.from(c.levels),
        lights: c.lights.length,
        activeLights: c.lights.filter((light) => light.visible && light.intensity > 0).length,
        lightPools: c.glowMaterials.length,
        activeLightPools: c.glowMaterials.filter((material) => material.userData.renderLit).length,
      })),
      storm: { rainDrops: rainSystem ? rainSystem.count : 0, lightning: stormSystem ? Number(stormSystem.flash.toFixed(2)) : 0, reducedFlash: state.reducedFlash },
      yard: getYardDiagnostics(p),
      physics: physics ? { engine: `Rapier ${RAPIER.version()}`, timestep: 1 / 60, fixedBodies: physics.fixedBodies, kinematicBodies: physics.kinematicBodies, colliders: physics.colliderCount, ccdBodies: 0, fallRecoveries: physics.fallRecoveries } : null,
      renderer: {
        fps: Number(state.fps.toFixed(1)),
        frameMs: Number(state.frameTime.toFixed(2)),
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        pixelRatio: renderer.getPixelRatio(),
        renderQuality: state.renderQuality,
        frameSchedule: getFrameSchedule(),
        targetFps: getTargetFrameInterval() > 0 ? Math.round(1000 / getTargetFrameInterval()) : null,
        antialias: Boolean(rendererContextAttributes.antialias),
        shadowsEnabled: renderer.shadowMap.enabled,
      },
    };
  }

  function teleport(x, floorY, z, yaw, pitch) {
    if (!physics) return;
    physics.verticalVelocity = 0;
    physics.playerBody.setTranslation({ x, y: floorY + PLAYER.halfHeight + PLAYER.radius + 0.03, z }, true);
    physics.playerBody.setNextKinematicTranslation({ x, y: floorY + PLAYER.halfHeight + PLAYER.radius + 0.03, z });
    state.yaw = yaw == null ? Math.PI : yaw;
    state.pitch = pitch == null ? 0 : pitch;
    syncCamera();
    // QA views and hide-spot transitions may query the look ray before the
    // next render. Keep the camera world matrix in step with the teleport so
    // interaction prompts do not depend on a cold shader-compilation frame.
    camera.updateMatrixWorld(true);
  }

  function installDiagnostics() {
    window.__THREE_GAME_DIAGNOSTICS__ = {
      renderer: renderer.info,
      get state() { return getDiagnostics(); },
    };
    window.render_game_to_text = () => JSON.stringify(getDiagnostics());
    window.advanceTime = (ms) => new Promise((resolve) => {
      const startedAt = performance.now();
      const step = () => {
        if (performance.now() - startedAt >= Math.max(0, Number(ms) || 0)) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    window.MrFeastFresh.getDiagnostics = getDiagnostics;
    window.MrFeastFresh.getContestant13State = () => contestant13Quest ? contestant13Quest.getDiagnostics() : null;
    window.MrFeastFresh.getMrFeastState = () => mrFeastNpc ? mrFeastNpc.getDiagnostics() : null;
    window.MrFeastFresh.resetMrFeastWandererForQA = () => mrFeastNpc ? mrFeastNpc.resetForQA() : null;
    window.MrFeastFresh.setMrFeastPoseForQA = (options) => mrFeastNpc ? mrFeastNpc.setPoseForQA(options) : null;
    window.MrFeastFresh.transitionMrFeastForQA = (actionName, duration) => mrFeastNpc ? mrFeastNpc.transitionForQA(actionName, duration) : null;
    window.MrFeastFresh.advanceMrFeastAnimationForQA = (seconds) => mrFeastNpc ? mrFeastNpc.advanceAnimationForQA(seconds) : null;
    window.MrFeastFresh.setMrFeastRouteSegmentForQA = (targetId, progress, animationTime) => mrFeastNpc ? mrFeastNpc.setRouteSegmentForQA(targetId, progress, animationTime) : null;
    window.MrFeastFresh.runMrFeastWholeHomeRouteForQA = (maxSeconds) => mrFeastNpc ? mrFeastNpc.runWholeHomeRouteForQA(maxSeconds) : null;
    window.MrFeastFresh.isPlayerHidden = () => state.isHidden;
    window.MrFeastFresh.inspectScene = (prefix = "") => {
      const meshes = [];
      const bounds = new THREE.Box3();
      const size = new THREE.Vector3();
      scene.updateMatrixWorld(true);
      scene.traverse((object) => {
        if (!object.isMesh || !object.name.startsWith(prefix)) return;
        bounds.setFromObject(object);
        bounds.getSize(size);
        meshes.push({
          name: object.name,
          size: { x: Number(size.x.toFixed(3)), y: Number(size.y.toFixed(3)), z: Number(size.z.toFixed(3)) },
          position: { x: Number(object.getWorldPosition(new THREE.Vector3()).x.toFixed(3)), y: Number(object.getWorldPosition(new THREE.Vector3()).y.toFixed(3)), z: Number(object.getWorldPosition(new THREE.Vector3()).z.toFixed(3)) },
        });
      });
      return { prefix, count: meshes.length, meshes };
    };
    window.MrFeastFresh.inspectServiceRegion = () => {
      const meshes = [];
      const bounds = new THREE.Box3();
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      scene.updateMatrixWorld(true);
      scene.traverse((object) => {
        if (!object.isMesh) return;
        bounds.setFromObject(object);
        bounds.getSize(size);
        bounds.getCenter(center);
        if (center.x < 11.2 || center.x > 13.9 || size.x < 1.2 || size.z < 2.5) return;
        meshes.push({
          name: object.name,
          size: { x: Number(size.x.toFixed(3)), y: Number(size.y.toFixed(3)), z: Number(size.z.toFixed(3)) },
          center: { x: Number(center.x.toFixed(3)), y: Number(center.y.toFixed(3)), z: Number(center.z.toFixed(3)) },
        });
      });
      return meshes;
    };
    window.MrFeastFresh.inspectLookRay = () => {
      const probe = new THREE.Raycaster();
      probe.far = 80;
      probe.setFromCamera(lookCenter, camera);
      return probe.intersectObjects(scene.children, true).slice(0, 12).map((hit) => ({
        name: hit.object.name,
        distance: Number(hit.distance.toFixed(3)),
        point: {
          x: Number(hit.point.x.toFixed(3)),
          y: Number(hit.point.y.toFixed(3)),
          z: Number(hit.point.z.toFixed(3)),
        },
      }));
    };
    window.MrFeastFresh.triggerLightning = () => stormSystem && stormSystem.trigger();
    window.MrFeastFresh.lightLayout = () => {
      // The renderer keys shader programs on exactly these counts; QA uses
      // this to prove no interaction or transition can mint a novel layout.
      const layout = { directional: 0, spot: 0, point: 0, hemisphere: 0, directionalShadow: 0, spotShadow: 0, pointShadow: 0 };
      scene.traverse((object) => {
        if (!object.isLight || !object.visible) return;
        if (object.isHemisphereLight) layout.hemisphere += 1;
        else if (object.isDirectionalLight) {
          layout.directional += 1;
          if (object.castShadow) layout.directionalShadow += 1;
        } else if (object.isSpotLight) {
          layout.spot += 1;
          if (object.castShadow) layout.spotShadow += 1;
        } else if (object.isPointLight) {
          layout.point += 1;
          if (object.castShadow) layout.pointShadow += 1;
        }
      });
      return layout;
    };
    window.MrFeastFresh.scaleOmniForQA = (factor) => {
      // Calibration-only: uniformly scales the omni room fixtures so QA can
      // sweep brightness against luminance targets without rebuilding. Any
      // light sync (switch, floor change) restores authored intensities.
      if (!state.qa) return null;
      let scaled = 0;
      for (const circuit of circuits) {
        for (const light of circuit.lights) {
          if (light.isPointLight && light.visible && light.userData.baseIntensity) {
            light.intensity = light.userData.baseIntensity * factor;
            scaled += 1;
          }
        }
      }
      return scaled;
    };
    window.MrFeastFresh.advanceLightFade = (seconds) => {
      // Deterministic stepper for the cross-floor light fade so QA can drive
      // and observe transitions even when the tab's animation frames are
      // throttled (headless captures, hidden panes).
      updateLocation();
      updateLightTransitions(Math.max(0, Number(seconds) || 0));
      const lighting = getDiagnostics().lighting;
      return {
        floor: lighting.activeFloor,
        fadingLights: lighting.crossFloorFade.fadingLights,
        fadingBulbs: lighting.crossFloorFade.fadingBulbs,
        activeLocalLights: lighting.activeLocalLights,
      };
    };
    window.MrFeastFresh.inspectYard = () => getYardDiagnostics(physics.playerPosition());
    window.MrFeastFresh.qaViewNames = Object.keys(QA_ROOM_VIEWS);
    window.MrFeastFresh.teleport = (location) => {
      const destinations = {
        ...QA_ROOM_VIEWS,
        foyer: [0, FLOOR.MAIN, 9.8, 0],
        library: [-10.0, FLOOR.MAIN, 7.7, Math.PI / 2],
        music: [10.0, FLOOR.MAIN, 7.7, -Math.PI / 2],
        mainHallBathroom: [-10.0, FLOOR.MAIN, 0, Math.PI / 2],
        coatCloset: [COAT_CLOSET.center.x, FLOOR.MAIN, -2.1, Math.PI],
        painting: [8.2, FLOOR.MAIN, 0, -Math.PI / 2],
        paintingSouthAisle: [8.2, FLOOR.MAIN, -2.45, Math.PI],
        paintingWestDoorOutside: [4.2, FLOOR.MAIN, 0, -Math.PI / 2],
        paintingEaselApproach: [8.0, FLOOR.MAIN, 1.15, -Math.PI / 2],
        dining: [-9.7, FLOOR.MAIN, -8.4, 0],
        kitchen: [6.3, FLOOR.MAIN, -6.1, -0.8],
        ballroom: [0, FLOOR.MAIN, -6.0, 0],
        openRearWest: [-9.7, FLOOR.MAIN, -4.05, Math.PI / 2],
        openRearEast: [8.2, FLOOR.MAIN, -4.05, -Math.PI / 2],
        upper: [0, FLOOR.UPPER, -3.8, Math.PI],
        westSuite: [-7, FLOOR.UPPER, 7, Math.PI / 2],
        eastSuite: [7, FLOOR.UPPER, 7, -Math.PI / 2],
        upperGrandBathroom: [-9.5, FLOOR.UPPER, 0, Math.PI / 2],
        readingRoom: [9.5, FLOOR.UPPER, 0, -Math.PI / 2],
        primary: [-9.5, FLOOR.UPPER, -8.2, 0],
        rearLounge: [0, FLOOR.UPPER, -6.0, 0],
        eastRearSuite: [9.5, FLOOR.UPPER, -8.2, 0],
        basement: [0, FLOOR.BASEMENT, -2.0, Math.PI],
        wine: [-3.0, FLOOR.BASEMENT, 7.2, Math.PI / 2],
        archive: [3.0, FLOOR.BASEMENT, 7.2, -Math.PI / 2],
        archiveDoorOutside: [0, FLOOR.BASEMENT, 7.2, -Math.PI / 2],
        archiveSouthAisle: [8.15, FLOOR.BASEMENT, 4.0, Math.PI],
        archiveWestAisle: [3.0, FLOOR.BASEMENT, 7.2, -Math.PI / 2],
        laundry: [-8.0, FLOOR.BASEMENT, 0, Math.PI / 2],
        pantry: [6.0, FLOOR.BASEMENT, 0, -Math.PI / 2],
        boiler: [-8.0, FLOOR.BASEMENT, -5.3, 0],
        workshop: [-2.3, FLOOR.BASEMENT, -8.0, 0],
        coldRoom: [4.5, FLOOR.BASEMENT, -8.0, 0],
        bulkStorage: [11.2, FLOOR.BASEMENT, -8.0, 0],
        storm: [13.0, FLOOR.MAIN, 5.0, Math.PI],
        frontDoor: [-0.55, FLOOR.MAIN, 10.05, Math.PI],
        librarySwitch: [-6.25, FLOOR.MAIN, 5.85, -Math.PI / 2, -0.28],
        cabinetTest: [7.3, FLOOR.MAIN, -10.0, Math.PI, -0.18],
        refrigeratorTest: [10.8, FLOOR.MAIN, -6.6, -2.1, -0.12],
        stairBottom: [0, FLOOR.MAIN, 3.75, 0],
        upperFlight: [-2.65, FLOOR.MAIN + GRAND_STAIR.MID_LANDING_RISE, -0.72, Math.PI],
        foyerWestDoor: [-3.82, FLOOR.MAIN, 7.3, Math.PI / 2],
        libraryDoorInside: [-6.18, FLOOR.MAIN, 7.3, -Math.PI / 2],
        foyerEastDoor: [3.82, FLOOR.MAIN, 7.3, -Math.PI / 2],
        musicDoorInside: [6.18, FLOOR.MAIN, 7.3, Math.PI / 2],
        libraryStudyDoor: [-9.7, FLOOR.MAIN, 4.45, 0],
        musicPaintingDoor: [8.2, FLOOR.MAIN, 4.45, 0],
        stairWide: [0, FLOOR.MAIN, 4.25, 0],
        midlandingSplit: [0, FLOOR.MAIN + GRAND_STAIR.MID_LANDING_RISE, -1.55, Math.PI],
        westTopExit: [-4.25, FLOOR.UPPER, 3.55, -Math.PI / 2],
        eastTopExit: [4.25, FLOOR.UPPER, 3.55, Math.PI / 2],
        westRampTop: [-2.65, FLOOR.UPPER, 3.55, 0],
        eastRampTop: [2.65, FLOOR.UPPER, 3.55, 0],
        behindStair: [0, FLOOR.MAIN, -2.55, Math.PI],
        rearArch: [0, FLOOR.MAIN, -4.0, Math.PI],
        rearArchWest: [-2.25, FLOOR.MAIN, -4.4, Math.PI],
        rearBypassWest: [-2.25, FLOOR.MAIN, 4.15, 0],
        rearBypassEast: [2.25, FLOOR.MAIN, 4.15, 0],
        openDiningCross: [-6.2, FLOOR.MAIN, -6.0, -Math.PI / 2],
        westRail: [-4.3, FLOOR.UPPER, 7.2, -Math.PI / 2],
        eastRail: [4.3, FLOOR.UPPER, 7.2, Math.PI / 2],
        frontCrosswalk: [0, FLOOR.UPPER, 11.55, 0],
        overlookDown: [0, FLOOR.UPPER, 11.55, 0, -0.32],
        rearLanding: [0, FLOOR.UPPER, -3.1, Math.PI],
        serviceTop: [12.55, FLOOR.MAIN, -3.05, Math.PI],
        serviceBottom: [12.55, FLOOR.BASEMENT, 2.72, 0],
      };
      const d = destinations[location];
      if (!d) return { error: `Unknown QA destination: ${location}` };
      teleport(d[0], d[1], d[2], d[3], d[4]);
      updateLocation();
      updateInteractionPrompt();
      return getDiagnostics();
    };
    window.MrFeastFresh.toggleCircuit = (name) => {
      const circuit = circuits.find((c) => c.name.toLowerCase().includes(String(name).toLowerCase()));
      if (circuit) circuit.toggle();
      return circuit ? circuit.on : null;
    };
    window.MrFeastFresh.openCabinets = () => {
      for (const object of animatedObjects) {
        if (object instanceof Cabinet && !object.open) {
          object.setOpen(true, true);
        }
      }
    };
    window.MrFeastFresh.openRefrigerator = () => {
      for (const refrigerator of refrigerators) refrigerator.setOpen(true, true);
      return refrigerators.length;
    };
    window.MrFeastFresh.setWater = (name, on) => {
      const fixture = waterFixtures.find((candidate) => candidate.name.toLowerCase().includes(String(name).toLowerCase()));
      if (fixture) fixture.setOn(Boolean(on));
      return fixture ? fixture.on : null;
    };
    window.MrFeastFresh.flushToilet = (name) => {
      const toilet = toilets.find((candidate) => candidate.name.toLowerCase().includes(String(name).toLowerCase()));
      return toilet ? toilet.flush() : null;
    };
    window.MrFeastFresh.setFireplace = (name, on) => {
      const fireplace = fireplaces.find((candidate) => candidate.name.toLowerCase().includes(String(name).toLowerCase()));
      return fireplace ? fireplace.setOn(Boolean(on)) : null;
    };
    window.MrFeastFresh.turnOffAllWater = () => {
      for (const fixture of waterFixtures) fixture.setOn(false, true);
      if (audioSystem) {
        for (const fixture of waterFixtures) audioSystem.setWater(fixture.name, false, fixture.kind);
      }
      return waterFixtures.filter((fixture) => fixture.on).length;
    };
    window.MrFeastFresh.openDoors = () => {
      for (const object of animatedObjects) {
        if (object instanceof HingedDoor && !object.locked) object.setOpen(true);
      }
      return animatedObjects.filter((object) => object instanceof HingedDoor && object.open).length;
    };
    window.MrFeastFresh.openExteriorDoors = () => {
      const exteriorDoor = /(?:front door|terrace door)/i;
      for (const object of animatedObjects) {
        if (object instanceof HingedDoor && exteriorDoor.test(object.name) && !object.locked) object.setOpen(true);
      }
      return animatedObjects.filter((object) => object instanceof HingedDoor && exteriorDoor.test(object.name) && object.open).length;
    };
    window.MrFeastFresh.turnOnAllLights = () => {
      for (const circuit of circuits) circuit.setState(true, true);
      syncLightRendering();
      return circuits.filter((circuit) => circuit.on).length;
    };
    window.MrFeastFresh.turnOffAllLights = () => {
      for (const circuit of circuits) circuit.setState(false, true);
      syncLightRendering();
      return circuits.filter((circuit) => circuit.on).length;
    };
    window.MrFeastFresh.setOnlyLightForQA = (name) => {
      if (!state.qa) return null;
      const normalized = String(name || "").trim().toLowerCase();
      let matched = null;
      for (const circuit of circuits) {
        const isMatch = circuit.name.toLowerCase() === normalized || circuit.name.toLowerCase().includes(normalized);
        circuit.setState(isMatch, true);
        if (isMatch) matched = circuit.name;
      }
      syncLightRendering();
      return matched;
    };
    window.MrFeastFresh.runRoute = (name) => {
      const routes = {
        yardGateBlock: {
          start: "yardGateInteract",
          actions: [{ yaw: Math.PI, seconds: 2.2 }],
          expected: { inBounds: true, grounded: true, minZ: 32.6, maxZ: 33.3 },
        },
        yardGateWestSeam: {
          start: "yardGateWestSeam",
          actions: [{ yaw: Math.PI, seconds: 2.2 }],
          expected: { inBounds: true, grounded: true, minZ: 32.6, maxZ: 33.3 },
        },
        yardGateEastSeam: {
          start: "yardGateEastSeam",
          actions: [{ yaw: Math.PI, seconds: 2.2 }],
          expected: { inBounds: true, grounded: true, minZ: 32.6, maxZ: 33.3 },
        },
        yardBoundarySouth: {
          start: "yardBoundarySouth",
          actions: [{ yaw: 0, seconds: 2.4 }],
          expected: { inBounds: true, grounded: true, maxZ: -32.8 },
        },
        yardBoundaryWest: {
          start: "yardBoundaryWest",
          actions: [{ yaw: Math.PI / 2, seconds: 2.4 }],
          expected: { inBounds: true, grounded: true, maxX: -32.8 },
        },
        yardBoundaryEast: {
          start: "yardBoundaryEast",
          actions: [{ yaw: -Math.PI / 2, seconds: 2.4 }],
          expected: { inBounds: true, grounded: true, minX: 32.8 },
        },
        yardMazeSolution: {
          start: "yardMazeEntranceCell",
          actions: buildMazeRouteActions(),
          startDelayMs: 1400,
          expected: { inBounds: true, grounded: true, room: "HEDGE MAZE", near: { x: 28, z: -30.25, radius: 0.9 } },
        },
        yardMazeSouthWallBlock: {
          start: "yardMazeSouthGoal",
          actions: [{ yaw: 0, seconds: 2.0 }],
          expected: { inBounds: true, grounded: true, room: "HEDGE MAZE", minZ: -30.95, maxZ: -30.45 },
        },
        yardMazeNorthAccess: {
          start: "yardMazeNorthEntrance",
          actions: [{ yaw: -Math.PI / 2, seconds: 1.7 }],
          expected: { inBounds: true, grounded: true, room: "HEDGE MAZE", minX: 21.7, maxX: 22.5, minZ: 5.35, maxZ: 6.15 },
        },
        yardEastFrontConnection: {
          start: "yardEastFrontConnector",
          actions: [{ yaw: Math.PI, seconds: 1.7 }],
          expected: { inBounds: true, grounded: true, room: "FRONT DRIVE", minZ: 16.45, maxZ: 17.35 },
        },
        frontDoorOut: {
          start: "frontDoor",
          actions: [{ yaw: Math.PI, seconds: 1.75 }],
          openDoors: true,
          expected: { inBounds: true, grounded: true, room: "FRONT DRIVE", minZ: 12.4 },
        },
        terraceDoorOut: {
          start: "yardTerraceDoorInside",
          actions: [{ yaw: 0, seconds: 1.75 }],
          openDoors: true,
          expected: { inBounds: true, grounded: true, room: "REAR LAWN", maxZ: -12.4 },
        },
        frontDoorRoundTrip: {
          start: "frontDoor",
          actions: [{ yaw: Math.PI, seconds: 1.75 }, { yaw: 0, seconds: 1.75 }],
          openExteriorDoors: true,
          expected: { inBounds: true, grounded: true, room: "FRONT FOYER", minZ: 9.5, maxZ: 10.6, interiorRendered: true, nearExteriorRendered: true, visitedRooms: ["FRONT DRIVE", "FRONT FOYER"] },
        },
        frontStepReentry: {
          start: "yardFrontOuterStep",
          actions: [{ yaw: 0, seconds: 2.7 }],
          openExteriorDoors: true,
          expected: { inBounds: true, grounded: true, room: "FRONT FOYER", minZ: 9.4, maxZ: 10.6, interiorRendered: true, nearExteriorRendered: true },
        },
        terraceDoorRoundTrip: {
          start: "yardTerraceDoorInside",
          actions: [{ yaw: 0, seconds: 1.75 }, { yaw: Math.PI, seconds: 1.75 }],
          openExteriorDoors: true,
          // The wide terrace threshold can settle a few centimeters farther
          // inward depending on the fixed-step phase; the room and render-set
          // assertions are the authoritative re-entry checks.
          expected: { inBounds: true, grounded: true, room: "BALLROOM", minZ: -10.8, maxZ: -9.65, interiorRendered: true, nearExteriorRendered: true, visitedRooms: ["REAR LAWN", "BALLROOM"] },
        },
        rearStepReentry: {
          start: "yardRearOuterStep",
          actions: [{ yaw: Math.PI, seconds: 2.7 }],
          openExteriorDoors: true,
          expected: { inBounds: true, grounded: true, room: "BALLROOM", minZ: -10.8, maxZ: -9.4, interiorRendered: true, nearExteriorRendered: true },
        },
        yardPoolWalk: {
          start: "yardRearCirculationA",
          actions: [{ yaw: Math.PI / 2, seconds: 4.0 }, { yaw: 0, seconds: 3.2 }],
        },
        yardPoolEnter: {
          start: "yardPoolSteps",
          actions: [{ yaw: 0, seconds: 3.0 }],
          expected: { inBounds: true, grounded: true, room: "POOL TERRACE", maxFeetY: -1.4 },
        },
        yardPoolExit: {
          start: "yardPoolBottom",
          actions: [{ yaw: Math.PI, seconds: 3.4 }],
          expected: { inBounds: true, grounded: true, room: "REAR LAWN", minFeetY: -0.4 },
        },
        yardPoolNorthGuard: {
          start: "yardPoolNorthGuard",
          actions: [{ yaw: -Math.PI / 2, seconds: 1.25 }],
          expected: { inBounds: true, grounded: true, minX: -13.65, maxX: -12.85, minZ: -19.2, maxZ: -18.5, minFeetY: -0.4 },
        },
        yardPoolEastEntry: {
          start: "yardPoolEastEntry",
          actions: [{ yaw: Math.PI / 2, seconds: 2.4 }],
          expected: { inBounds: true, grounded: true, room: "POOL TERRACE", maxFeetY: -1.4 },
        },
        yardGardenWalk: {
          start: "yardGardenApproach",
          actions: [{ yaw: Math.PI / 2, seconds: 3.7 }, { yaw: Math.PI, seconds: 2.2 }],
          expected: { inBounds: true, grounded: true, room: "FORMAL GARDEN", visitedRooms: ["REAR LAWN", "FORMAL GARDEN"] },
        },
        yardGardenFrontWalk: {
          start: "yardGardenFrontJunction",
          actions: [{ yaw: Math.PI / 2, seconds: 4.4 }, { yaw: 0, seconds: 3.2 }],
          expected: { inBounds: true, grounded: true, room: "FORMAL GARDEN", visitedRooms: ["FRONT DRIVE", "WEST LAWN", "FORMAL GARDEN"] },
        },
        yardMazeApproach: {
          start: "yardRearCirculationB",
          actions: [{ yaw: -Math.PI / 2, seconds: 5.0 }, { yaw: 0, seconds: 1.5 }],
          expected: { inBounds: true, grounded: true, room: "HEDGE MAZE", minX: 21.8, maxX: 22.8, minZ: -16.2, maxZ: -15.1, visitedRooms: ["REAR LAWN", "HEDGE MAZE"] },
        },
        rearWest: {
          start: "rearBypassWest",
          actions: [{ yaw: 0, seconds: 4.0 }],
        },
        rearEast: {
          start: "rearBypassEast",
          actions: [{ yaw: 0, seconds: 4.0 }],
        },
        grandWest: {
          start: "stairBottom",
          actions: [
            { yaw: 0, seconds: 3.6 },
            { yaw: Math.PI / 2, seconds: 1.2 },
            { yaw: Math.PI, seconds: 3.8 },
            { yaw: Math.PI / 2, seconds: 0.75 },
          ],
        },
        grandEast: {
          start: "stairBottom",
          actions: [
            { yaw: 0, seconds: 3.6 },
            { yaw: -Math.PI / 2, seconds: 1.2 },
            { yaw: Math.PI, seconds: 3.8 },
            { yaw: -Math.PI / 2, seconds: 0.75 },
          ],
        },
        grandWestDown: {
          start: "westTopExit",
          actions: [
            { yaw: -Math.PI / 2, seconds: 0.75 },
            { yaw: 0, seconds: 2.4 },
            { yaw: -Math.PI / 2, seconds: 1.2 },
            { yaw: Math.PI, seconds: 3.2 },
          ],
        },
        grandEastDown: {
          start: "eastTopExit",
          actions: [
            { yaw: Math.PI / 2, seconds: 0.75 },
            { yaw: 0, seconds: 2.4 },
            { yaw: Math.PI / 2, seconds: 1.2 },
            { yaw: Math.PI, seconds: 3.2 },
          ],
        },
        upperBalconyLoop: {
          start: "westTopExit",
          actions: [
            { yaw: Math.PI, seconds: 3.65 },
            { yaw: -Math.PI / 2, seconds: 3.86 },
            { yaw: 0, seconds: 3.65 },
          ],
        },
        upperRearGuard: {
          start: "rearLanding",
          actions: [{ yaw: Math.PI, seconds: 1.4 }],
        },
        underGrandStair: {
          start: "behindStair",
          actions: [{ yaw: Math.PI, seconds: 2.1 }],
        },
        paintingWestWallBlock: {
          start: "paintingRoomWestWall",
          actions: [{ yaw: Math.PI / 2, seconds: 1.4 }],
          expected: { inBounds: true, grounded: true, room: "PAINTING ROOM", minX: 5.35, maxX: 5.7 },
        },
        paintingEastWallBlock: {
          start: "paintingRoomEastWall",
          actions: [{ yaw: -Math.PI / 2, seconds: 1.4 }],
          expected: { inBounds: true, grounded: true, room: "PAINTING ROOM", minX: 9.75, maxX: 10.08 },
        },
        paintingSouthToMusic: {
          start: "paintingSouthAisle",
          actions: [{ yaw: Math.PI, seconds: 3.2 }],
          openDoors: true,
          expected: { inBounds: true, grounded: true, room: "MUSIC ROOM", minZ: 3.5, maxZ: 4.9, visitedRooms: ["PAINTING ROOM", "MUSIC ROOM"] },
        },
        paintingWestEntry: {
          start: "paintingWestDoorOutside",
          actions: [{ yaw: -Math.PI / 2, seconds: 1.4 }],
          openDoors: true,
          expected: { inBounds: true, grounded: true, room: "PAINTING ROOM", minX: 6.3, maxX: 7.6, visitedRooms: ["GRAND STAIR HALL", "PAINTING ROOM"] },
        },
        paintingEaselCollision: {
          start: "paintingEaselApproach",
          actions: [{ yaw: -Math.PI / 2, seconds: 1.4 }],
          expected: { inBounds: true, grounded: true, room: "PAINTING ROOM", minX: 8.5, maxX: 8.95 },
        },
        rearLoungeEntry: {
          start: "rearLoungeEntry",
          actions: [{ yaw: 0, seconds: 1.5 }],
          expected: { inBounds: true, grounded: true, room: "REAR LOUNGE", maxZ: -3.55 },
        },
        primarySuiteLoungeEntry: {
          start: "primarySuiteLoungeDoor",
          actions: [{ yaw: Math.PI / 2, seconds: 1.4 }],
          openDoors: true,
          expected: { inBounds: true, grounded: true, room: "PRIMARY SUITE", maxX: -5.35 },
        },
        eastRearSuiteLoungeEntry: {
          start: "eastRearSuiteLoungeDoor",
          actions: [{ yaw: -Math.PI / 2, seconds: 1.4 }],
          openDoors: true,
          expected: { inBounds: true, grounded: true, room: "EAST REAR SUITE", minX: 5.35 },
        },
        stairToBallroom: {
          start: "behindStair",
          actions: [{ yaw: 0, seconds: 2.4 }],
        },
        openRearTraversal: {
          start: "openDiningCross",
          actions: [{ yaw: -Math.PI / 2, seconds: 5.8 }],
        },
        archiveDoorEntry: {
          start: "archiveDoorOutside",
          actions: [{ yaw: -Math.PI / 2, seconds: 1.8 }],
          openDoors: true,
          expected: { grounded: true, room: "ARCHIVE", minX: 2.7, maxX: 4.25, minZ: 6.75, maxZ: 7.65 },
        },
        coatClosetDoorEntry: {
          start: "coatClosetDoor",
          actions: [{ yaw: Math.PI, seconds: 1.3 }],
          openDoors: true,
          expected: { grounded: true, room: "COAT CLOSET", minX: -13.55, maxX: -12.85, minZ: -1.65, maxZ: -0.75, visitedRooms: ["DINING ROOM", "COAT CLOSET"] },
        },
        archiveCenterAisle: {
          start: "archiveSouthAisle",
          actions: [{ yaw: Math.PI, seconds: 3.0 }],
          expected: { grounded: true, room: "ARCHIVE", minX: 7.75, maxX: 8.55, minZ: 9.9, maxZ: 10.85 },
        },
        archiveCrossAisle: {
          start: "archiveWestAisle",
          actions: [{ yaw: -Math.PI / 2, seconds: 4.4 }],
          expected: { grounded: true, room: "ARCHIVE", minX: 12.1, maxX: 13.2, minZ: 6.75, maxZ: 7.65 },
        },
        kitchenServiceStairDoorEntry: {
          start: "kitchenServiceStairDoor",
          actions: [{ yaw: Math.PI, seconds: 1.9 }],
          openDoors: true,
          expected: { grounded: true, room: "SERVICE STAIR", minZ: -2.5, maxZ: -1.5, visitedRooms: ["KITCHEN", "SERVICE STAIR"] },
        },
        serviceDown: {
          start: "serviceTop",
          actions: [{ yaw: Math.PI, seconds: 3.6 }],
          openDoors: true,
          expected: { grounded: true, room: "ARCHIVE", minZ: 3.8, maxZ: 4.95, visitedRooms: ["SERVICE STAIR", "ARCHIVE"] },
        },
        serviceUp: {
          start: "serviceBottom",
          actions: [{ yaw: 0, seconds: 5.7 }],
          openDoors: true,
          expected: { grounded: true, room: "KITCHEN", minZ: -7.0, maxZ: -5.7, visitedRooms: ["SERVICE STAIR", "KITCHEN"] },
        },
      };
      const route = routes[name];
      if (!route) {
        state.qaRoute = { name, status: "error", reason: "unknown route" };
        return state.qaRoute;
      }
      input.forward = input.back = input.left = input.right = false;
      const fallRecoveriesAtStart = physics.fallRecoveries;
      const circuitStatesAtStart = Object.fromEntries(circuits.map((circuit) => [circuit.name, circuit.on]));
      if (route.openDoors) window.MrFeastFresh.openDoors();
      if (route.openExteriorDoors) window.MrFeastFresh.openExteriorDoors();
      window.MrFeastFresh.teleport(route.start);
      updateLocation();
      state.started = true;
      if (dom.intro) dom.intro.hidden = true;
      const totalMs = route.actions.reduce((sum, action) => sum + action.seconds * 1000, 0);
      state.qaRoute = {
        name,
        status: "running",
        step: 0,
        steps: route.actions.length,
        durationMs: totalMs,
        expected: route.expected || null,
        fallRecoveriesAtStart,
        fallRecoveryDelta: 0,
        visitedRooms: [state.currentRoom],
        circuitStatesAtStart,
        circuitStatesUnchanged: true,
        checkpoints: [],
      };
      if (dom.room) {
        dom.room.dataset.qaRouteName = name;
        dom.room.dataset.qaRouteStatus = "running";
        delete dom.room.dataset.qaRouteX;
        delete dom.room.dataset.qaRouteZ;
      }
      // Door animation refreshes the two cached interior shadow maps. Let the
      // leaves reach their parked state before timed movement so a cold shader
      // compile cannot shorten the first leg of a QA route.
      let atMs = route.startDelayMs == null
        ? (route.openDoors || route.openExteriorDoors ? 2000 : 100)
        : route.startDelayMs;
      route.actions.forEach((action, index) => {
        setTimeout(() => {
          updateLocation();
          const checkpoint = physics.playerPosition();
          state.qaRoute.checkpoints.push({
            step: index + 1,
            x: Number(checkpoint.x.toFixed(2)),
            z: Number(checkpoint.z.toFixed(2)),
            yaw: Number(action.yaw.toFixed(3)),
            room: state.currentRoom,
            exteriorNearHouse: Boolean(exteriorNearHouse),
            interiorDetailsHidden: Boolean(interiorDetailsHidden),
            visibleInteriorMeshes: interiorDetailMeshes.filter((mesh) => mesh.visible).length,
          });
          state.yaw = action.yaw;
          input.forward = true;
          state.qaRoute.step = index + 1;
        }, atMs);
        atMs += action.seconds * 1000;
      });
      setTimeout(() => {
        input.forward = false;
        if (!state.qaRoute || state.qaRoute.name !== name) return;
        updateLocation();
        const p = physics.playerPosition();
        const feetY = p.y - (PLAYER.halfHeight + PLAYER.radius);
        const expected = route.expected;
        const fallRecoveryDelta = physics.fallRecoveries - fallRecoveriesAtStart;
        const circuitStatesUnchanged = circuits.every((circuit) => circuitStatesAtStart[circuit.name] === circuit.on);
        state.qaRoute.checkpoints.push({
          step: "finish",
          x: Number(p.x.toFixed(2)),
          z: Number(p.z.toFixed(2)),
          yaw: Number(state.yaw.toFixed(3)),
          room: state.currentRoom,
          exteriorNearHouse: Boolean(exteriorNearHouse),
          interiorDetailsHidden: Boolean(interiorDetailsHidden),
          visibleInteriorMeshes: interiorDetailMeshes.filter((mesh) => mesh.visible).length,
        });
        let passed = true;
        if (expected) {
          if (expected.inBounds != null) passed = passed && getYardDiagnostics(p).inBounds === expected.inBounds;
          if (expected.grounded != null) passed = passed && Boolean(physics.grounded) === expected.grounded;
          if (expected.room) passed = passed && state.currentRoom === expected.room;
          if (expected.minX != null) passed = passed && p.x >= expected.minX;
          if (expected.maxX != null) passed = passed && p.x <= expected.maxX;
          if (expected.minZ != null) passed = passed && p.z >= expected.minZ;
          if (expected.maxZ != null) passed = passed && p.z <= expected.maxZ;
          if (expected.minFeetY != null) passed = passed && feetY >= expected.minFeetY;
          if (expected.maxFeetY != null) passed = passed && feetY <= expected.maxFeetY;
          if (expected.near) passed = passed && Math.hypot(p.x - expected.near.x, p.z - expected.near.z) <= expected.near.radius;
          if (expected.interiorRendered != null) passed = passed && (!interiorDetailsHidden) === expected.interiorRendered;
          if (expected.nearExteriorRendered) {
            const exteriorCheckpoint = state.qaRoute.checkpoints.find((checkpoint) => outdoorRoomNames.has(checkpoint.room));
            passed = passed && Boolean(
              exteriorCheckpoint
              && exteriorCheckpoint.exteriorNearHouse
              && !exteriorCheckpoint.interiorDetailsHidden
              && exteriorCheckpoint.visibleInteriorMeshes > 0,
            );
          }
          if (expected.visitedRooms) passed = passed && expected.visitedRooms.every((room) => state.qaRoute.visitedRooms.includes(room));
        }
        passed = passed && fallRecoveryDelta === 0 && circuitStatesUnchanged;
        state.qaRoute.fallRecoveryDelta = fallRecoveryDelta;
        state.qaRoute.circuitStatesUnchanged = circuitStatesUnchanged;
        state.qaRoute.status = passed ? "complete" : "failed";
        if (!passed) {
          state.qaRoute.reason = fallRecoveryDelta > 0
            ? "unexpected fall recovery during route"
            : !circuitStatesUnchanged
              ? "light circuit changed without switch interaction"
              : "route expectation not met";
        }
        if (dom.room) {
          dom.room.dataset.qaRouteName = name;
          dom.room.dataset.qaRouteStatus = state.qaRoute.status;
          dom.room.dataset.qaRouteX = p.x.toFixed(2);
          dom.room.dataset.qaRouteZ = p.z.toFixed(2);
        }
      }, atMs);
      return state.qaRoute;
    };
  }

  async function init() {
    const watchdogDelay = state.qa
      ? Math.max(500, Number(qaParams.get("initTimeout")) || 15000)
      : 15000;
    initWatchdog = setTimeout(() => {
      if (!state.ready && !state.loadFailed) {
        showLoadFailure("Loading stalled. Retry the mansion, or open it through the local web server.");
      }
    }, watchdogDelay);

    try {
      resize();
      if (location.protocol === "file:" || (state.qa && qaParams.has("simulateFile"))) {
        clearTimeout(initWatchdog);
        showLoadFailure(LOCAL_SERVER_GUIDANCE, "server");
        return;
      }
      if (state.qa && qaParams.has("simulateHang")) return;
      setLoading("Loading physics", 4);
      RAPIER = await import(new URL("../vendor/rapier/rapier-0.19.3.mjs", SCRIPT_URL).href);
      await RAPIER.init({});
      physics = new PhysicsWorld(RAPIER);
      M = await createMaterials();

      setLoading("Raising the walls", 28);
      hemisphereLight = new THREE.HemisphereLight(0x7589a6, 0x15110f, NIGHT_LIGHTING.hemisphereIntensity);
      scene.add(hemisphereLight);
      moonLight = new THREE.DirectionalLight(0x8fb7dc, NIGHT_LIGHTING.moonIntensity);
      moonLight.position.set(-20, 28, 18);
      moonLight.castShadow = renderer.shadowMap.enabled;
      moonLight.shadow.mapSize.set(1024, 1024);
      moonLight.shadow.camera.left = -25;
      moonLight.shadow.camera.right = 25;
      moonLight.shadow.camera.top = 25;
      moonLight.shadow.camera.bottom = -25;
      moonLight.shadow.camera.near = 1;
      moonLight.shadow.camera.far = 70;
      moonLight.shadow.bias = -0.00035;
      scene.add(moonLight);

      buildMansion();
      mergeStaticDecor();
      registerExteriorDetailCulling();
      mrFeastNpc = new MrFeastWanderer();
      // The character is an optional test layer: it loads after the mansion is
      // usable and a failed GLB never blocks exploration or the boot watchdog.
      void mrFeastNpc.load();
      setLoading("Calling the storm", 82);
      rainSystem = new RainSystem();
      stormSystem = new StormSystem();
      audioSystem = new MansionAudio();
      updateAudioButton();
      bindInput();
      installDiagnostics();
      updateLocation();
      syncLightRendering();
      setLoading("Preparing the first frame", 96);
      state.ready = true;
      state.startupPhase = "Ready";
      state.startupReadyMs = performance.now() - startupStartedAt;
      state.loadFailed = false;
      state.failureAction = null;
      clearTimeout(initWatchdog);
      boot?.ready();
      dom.stage.setAttribute("aria-busy", "false");
      if (state.qa) {
        const qaView = qaParams.get("view");
        const qaRoute = qaParams.get("route");
        const captureDelay = Math.max(350, Number(qaParams.get("captureDelay")) || 2500);
        if (qaView) window.MrFeastFresh.teleport(qaView);
        if (qaParams.has("openCabinets")) window.MrFeastFresh.openCabinets();
        if (qaParams.has("openRefrigerator")) window.MrFeastFresh.openRefrigerator();
        if (qaParams.has("water")) window.MrFeastFresh.setWater(qaParams.get("water"), true);
        if (qaParams.has("flush")) window.MrFeastFresh.flushToilet(qaParams.get("flush"));
        if (qaParams.has("fireplaceOff")) window.MrFeastFresh.setFireplace(qaParams.get("fireplaceOff"), false);
        if (qaParams.has("openDoors")) window.MrFeastFresh.openDoors();
        if (qaParams.has("openExteriorDoors")) window.MrFeastFresh.openExteriorDoors();
        if (qaParams.has("allLights")) window.MrFeastFresh.turnOnAllLights();
        if (qaParams.has("allLightsOff")) window.MrFeastFresh.turnOffAllLights();
        if (qaParams.has("onlyLight")) window.MrFeastFresh.setOnlyLightForQA(qaParams.get("onlyLight"));
        if (qaParams.has("inspect") && dom.debug) {
          dom.debug.setAttribute("data-scene-inspect", JSON.stringify(window.MrFeastFresh.inspectScene(qaParams.get("inspect"))));
        }
        if (qaParams.has("inspectServiceRegion") && dom.debug) {
          dom.debug.setAttribute("data-service-region", JSON.stringify(window.MrFeastFresh.inspectServiceRegion()));
        }
        if (qaParams.has("inspectLookRay") && dom.debug) {
          requestAnimationFrame(() => dom.debug.setAttribute("data-look-ray", JSON.stringify(window.MrFeastFresh.inspectLookRay())));
        }
        if (qaParams.has("hidePrefix")) {
          const prefix = qaParams.get("hidePrefix");
          scene.traverse((object) => { if (object.name && object.name.startsWith(prefix)) object.visible = false; });
        }
        if (qaParams.has("lightning")) setTimeout(() => stormSystem.trigger(), Math.max(0, captureDelay - 150));
        if (qaParams.has("frame")) {
          dom.stage.classList.add("is-maxed");
          Object.assign(dom.stage.style, { position: "fixed", inset: "0", zIndex: "99999", width: "100vw", height: "100vh" });
          document.body.style.overflow = "hidden";
          requestAnimationFrame(resize);
        }
        if (qaParams.has("autostart")) {
          state.started = true;
          if (dom.intro) dom.intro.hidden = true;
          if (contestant13Quest) contestant13Quest.updateUI();
        }
        const walkSeconds = Math.max(0, Math.min(12, Number(qaParams.get("walk")) || 0));
        const walkDelayMs = Math.max(100, Number(qaParams.get("walkDelay")) || 350);
        const interactAfter = Math.max(0, Number(qaParams.get("interactAfter")) || 0);
        const interactAgainAfter = Math.max(0, Number(qaParams.get("interactAgainAfter")) || 0);
        if (qaRoute) {
          // Let the first static shadow/program compile finish before timed
          // movement begins; otherwise a cold-cache frame can shorten the
          // first maze leg even though the physical route is clear.
          setTimeout(() => window.MrFeastFresh.runRoute(qaRoute), 1200);
        } else if (walkSeconds) {
          setTimeout(() => { input.forward = true; }, walkDelayMs);
          setTimeout(() => { input.forward = false; }, walkDelayMs + walkSeconds * 1000);
        }
        if (qaParams.has("interactAfter")) setTimeout(() => activateCurrentInteraction(), interactAfter * 1000);
        if (qaParams.has("interactAgainAfter")) setTimeout(() => activateCurrentInteraction(), interactAgainAfter * 1000);
        setTimeout(() => {
          if (!dom.debug) return;
          try {
            dom.debug.setAttribute("data-canvas-capture", dom.canvas.toDataURL("image/png"));
          } catch (error) {
            dom.debug.setAttribute("data-capture-error", String(error));
          }
        }, captureDelay);
      }
      if (dom.loading) dom.loading.hidden = true;
      if (dom.enter) {
        dom.enter.disabled = false;
        dom.enter.removeAttribute("aria-disabled");
        dom.enter.textContent = "Cross the threshold";
      }
      setLoading("Ready", 100);
      // Give the browser one complete paint with the loading veil removed and
      // the entry button enabled before the first Three.js shader compilation.
      requestAnimationFrame(() => requestAnimationFrame(animate));
    } catch (error) {
      console.error("The Hollow Estate failed to initialize", error);
      clearTimeout(initWatchdog);
      showLoadFailure("The estate could not be opened. Retry loading the mansion.");
      window.MrFeastFresh.error = String(error && error.stack || error);
    }
  }

  if (dom.enter) dom.enter.addEventListener("click", handleEnterClick);
  init();
})();
