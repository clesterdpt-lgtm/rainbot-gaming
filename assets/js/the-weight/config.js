// =============================================================
// THE WEIGHT — Rainbot After Dark No. 002
// config.js — central tunables shared across modules
// =============================================================

(function () {
window.TW = window.TW || {};
TW.CONFIG = {
  // ---- Renderer ----
  exposure: 1.14,           // ACES tone-mapping exposure (dark but readable)
  pixelRatioCap: 2,
  shadows: true,

  // ---- Room (metres, origin at room centre, floor at y = 0) ----
  room: { w: 4.3, h: 2.7, d: 5.6 },

  // ---- Player camera: lying in bed, head on the pillow ----
  camera: {
    fov: 64,
    near: 0.04,
    far: 60,
    // head rests near the +z wall, propped on a pillow
    pos: { x: 0.05, y: 0.96, z: 2.05 },
    // neutral gaze: slightly down, toward the foot of the bed / room
    basePitch: -0.05,
  },

  // ---- Clamped "stiff neck" look (radians) ----
  look: {
    sensitivity: 0.00072,   // very low → sluggish
    smoothing: 5.5,         // lerp speed of head toward target (low = laggy/stiff)
    yawClamp: 0.66,         // ~38° left / right — cannot look behind
    pitchUp: 0.30,          // ~17° up — cannot sit up
    pitchDown: 0.46,        // ~26° down — can glance at own blanketed body
    edgeResist: 0.7,        // extra stiffness as the head nears the clamp
  },

  // ---- Heavy, slow breathing (shared by camera bob + blanket) ----
  breath: {
    rate: 0.23,             // cycles / second (slow, laboured)
    bobY: 0.013,
    roll: 0.0065,
    pitch: 0.009,
  },
};
})();
