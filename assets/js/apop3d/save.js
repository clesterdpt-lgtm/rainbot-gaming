/* ============================================================
   APOP DEMON MOGGERS 3D - progress and persistence

   localStorage-backed save. Everything a run produces that must
   survive a reload lives here: Platinum Records by course, lifetime
   Clout, best times, Record Deals the player has met, and the Tour
   Pass badges carried over from the 2D original.

   Four rules this file is built around:

   1. A CORRUPT BLOB MUST NOT BRICK THE GAME. Storage is shared with
      browser extensions, other tabs and our own older builds. Every
      read runs through `normalise`, which builds a fresh object from
      defaults and copies across only fields that are the right type.
      A blob that cannot be parsed at all is moved aside to a
      `.corrupt` key rather than deleted, so a player who reports lost
      progress still has something we can look at.

   2. STORAGE ITSELF CAN THROW. Safari private mode and a hard-blocked
      third-party context both throw on getItem/setItem, not just on
      quota. If that happens we fall back to an in-memory store and
      keep playing; a save that fails is a bad session, a save that
      throws is a black screen.

   3. WRITES ARE DEBOUNCED. Clout ticks up several times a second.
      Serialising the whole save on every coin would cost more than
      the collectible system does, so mutations mark the save dirty
      and `update` flushes at most every WRITE_INTERVAL seconds. A
      pagehide/visibilitychange flush catches the tab being closed
      mid-course.

   4. THE KEY IS NAMESPACED. The 2D game owns `rb_apop_tour_pass_v1`
      and we must not tread on it. We read it - the Tour Pass carries
      over - but we never write it.
   ============================================================ */

const STORE_KEY = "rb_apop3d_save_v1";
const CORRUPT_KEY = "rb_apop3d_save_v1.corrupt";

/** The 2D game's Tour Pass. Read-only from here. */
const LEGACY_TOUR_KEY = "rb_apop_tour_pass_v1";

/** Bump when the in-blob shape changes, and add a MIGRATIONS entry.
 *  The `_v1` in STORE_KEY is the storage envelope and only moves if a
 *  break is so total that migrating is worse than starting over. */
const SCHEMA = 1;

const COURSE_IDS = [0, 1, 2, 3, 4, 5];
const RECORDS_PER_COURSE = 7;
const WRITE_INTERVAL = 1.6;   // seconds between debounced flushes

/** Deal ids are shared with the 2D game so a returning player sees the
 *  same six contracts under the same names. */
const DEAL_IDS = [
  "auto-tune-beam", "stan-shield", "main-character-energy",
  "choreo-cancel", "label-advance", "diva-tax",
];

const BADGE_IDS = [
  "first-clear", "algorithm-breaker", "independent-artist",
  "diva-tax-win", "pure-mog", "bad-contract-survivor",
];

const COSMETIC_IDS = ["classic", "gold-fit"];

/* ------------------------- shape helpers ------------------------- */

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const posInt = (v, fallback = 0) => {
  const n = Math.floor(num(v, fallback));
  return n > 0 ? n : 0;
};

/** Unique, order-preserving, membership-checked string list. Used for
 *  every id array in the save so a hand-edited blob full of junk ids
 *  cannot make the collection screens render garbage. */
function idList(value, allowed) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || !item) continue;
    if (allowed && !allowed.includes(item)) continue;
    if (out.indexOf(item) === -1) out.push(item);
  }
  return out;
}

function defaultCourse() {
  return {
    records: [],        // record ids collected in this course
    cleared: false,     // all seven found
    visits: 0,
    clout: 0,           // best single-run Clout for this course
    times: {},          // recordId -> best seconds to reach it
    bestRun: null,      // seconds for the fastest full clear
  };
}

function defaultSave() {
  const courses = {};
  for (const id of COURSE_IDS) courses[String(id)] = defaultCourse();
  return {
    v: SCHEMA,
    build: "",
    created: Date.now(),
    updated: Date.now(),
    clout: { total: 0, spent: 0 },
    courses,
    deals: { seen: [], signed: {} },
    tour: { badges: [], cosmetics: ["classic"], fit: "classic", syncedAt: 0 },
    stats: { records: 0, deaths: 0, playtime: 0, sessions: 0 },
  };
}

/** Rebuild a save from defaults, copying across only what type-checks.
 *  Deliberately never mutates `raw` and never trusts a nested shape. */
function normalise(raw) {
  const out = defaultSave();
  if (!isObj(raw)) return out;

  out.build = typeof raw.build === "string" ? raw.build.slice(0, 32) : "";
  out.created = num(raw.created, out.created);
  out.updated = num(raw.updated, out.updated);

  if (isObj(raw.clout)) {
    out.clout.total = posInt(raw.clout.total);
    out.clout.spent = posInt(raw.clout.spent);
  } else if (Number.isFinite(raw.clout)) {
    // Pre-versioned blobs stored clout as a bare number.
    out.clout.total = posInt(raw.clout);
  }

  if (isObj(raw.courses)) {
    for (const id of COURSE_IDS) {
      const key = String(id);
      const src = raw.courses[key];
      if (!isObj(src)) continue;
      const dst = out.courses[key];
      dst.records = idList(src.records).slice(0, RECORDS_PER_COURSE);
      dst.cleared = src.cleared === true || dst.records.length >= RECORDS_PER_COURSE;
      dst.visits = posInt(src.visits);
      dst.clout = posInt(src.clout);
      dst.bestRun = Number.isFinite(src.bestRun) && src.bestRun > 0 ? src.bestRun : null;
      if (isObj(src.times)) {
        for (const recordId of Object.keys(src.times)) {
          const t = src.times[recordId];
          if (typeof recordId === "string" && Number.isFinite(t) && t > 0) {
            dst.times[recordId] = t;
          }
        }
      }
    }
  }

  if (isObj(raw.deals)) {
    out.deals.seen = idList(raw.deals.seen, DEAL_IDS);
    if (isObj(raw.deals.signed)) {
      for (const dealId of DEAL_IDS) {
        const n = posInt(raw.deals.signed[dealId]);
        if (n > 0) out.deals.signed[dealId] = n;
      }
    }
  }

  if (isObj(raw.tour)) {
    out.tour.badges = idList(raw.tour.badges, BADGE_IDS);
    out.tour.cosmetics = idList(raw.tour.cosmetics, COSMETIC_IDS);
    if (out.tour.cosmetics.indexOf("classic") === -1) out.tour.cosmetics.unshift("classic");
    out.tour.fit = out.tour.cosmetics.indexOf(raw.tour.fit) !== -1 ? raw.tour.fit : "classic";
    out.tour.syncedAt = num(raw.tour.syncedAt, 0);
  }

  if (isObj(raw.stats)) {
    out.stats.deaths = posInt(raw.stats.deaths);
    out.stats.playtime = Math.max(0, num(raw.stats.playtime));
    out.stats.sessions = posInt(raw.stats.sessions);
  }

  // Derived rather than trusted: the record total is the one number the
  // hub doors read, and a blob that disagrees with its own course lists
  // would lock or unlock the wrong door.
  out.stats.records = countRecords(out);
  return out;
}

function countRecords(save) {
  let total = 0;
  for (const id of COURSE_IDS) total += save.courses[String(id)].records.length;
  return total;
}

/* --------------------------- migrations --------------------------- */

/** Keyed by the version being migrated FROM. Each step returns a blob
 *  one version newer, and the chain runs until it reaches SCHEMA.
 *
 *  Version 0 is "anything written before the schema field existed" -
 *  early dev builds and any third-party blob that happens to sit on our
 *  key. It is handled by falling through to `normalise`, which is
 *  lossless for the fields that survived and safe for the ones that
 *  did not. */
const MIGRATIONS = {
  0: (raw) => {
    const next = isObj(raw) ? { ...raw } : {};
    next.v = 1;
    return next;
  },
};

function migrate(raw) {
  let blob = isObj(raw) ? raw : {};
  let version = Number.isFinite(blob.v) ? Math.floor(blob.v) : 0;
  let guard = 0;

  while (version < SCHEMA) {
    const step = MIGRATIONS[version];
    if (typeof step !== "function") break;   // gap in the chain: normalise handles it
    blob = step(blob) || {};
    const next = Number.isFinite(blob.v) ? Math.floor(blob.v) : version + 1;
    if (next <= version) break;              // a migration that does not advance is a bug
    version = next;
    if ((guard += 1) > 16) break;
  }

  // A save from the future (player rolled back a build) is normalised
  // rather than discarded. Unknown fields are dropped, known ones keep.
  return blob;
}

/* ---------------------------- storage ---------------------------- */

/** Wraps localStorage so every call site can stay ignorant of the fact
 *  that storage may not exist, may be full, or may throw on read. */
function makeStore() {
  let backing = null;
  let memory = new Map();
  let warned = false;

  try {
    backing = window.localStorage;
    const probe = "__apop3d_probe";
    backing.setItem(probe, "1");
    backing.removeItem(probe);
  } catch (error) {
    backing = null;
  }

  const warnOnce = (error) => {
    if (warned) return;
    warned = true;
    console.warn("[apop3d] progress will not persist this session", error);
  };

  return {
    get available() { return backing !== null; },
    read(key) {
      if (!backing) return memory.get(key) || null;
      try { return backing.getItem(key); } catch (error) { warnOnce(error); return null; }
    },
    write(key, value) {
      if (!backing) { memory.set(key, value); return false; }
      try { backing.setItem(key, value); return true; }
      catch (error) { warnOnce(error); memory.set(key, value); return false; }
    },
    drop(key) {
      memory.delete(key);
      if (!backing) return;
      try { backing.removeItem(key); } catch (error) { warnOnce(error); }
    },
  };
}

/* ----------------------------- module ----------------------------- */

export function create(ctx) {
  const store = makeStore();
  let data = defaultSave();
  let dirty = false;
  let sinceWrite = 0;
  let loadedFrom = "default";

  function load() {
    const raw = store.read(STORE_KEY);
    if (!raw) {
      data = defaultSave();
      loadedFrom = "new";
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // Keep the evidence, take the fresh save. A player mid-game must
      // not see an exception because a byte flipped.
      console.warn("[apop3d] save was unreadable; starting fresh", error);
      store.write(CORRUPT_KEY, raw.slice(0, 20000));
      data = defaultSave();
      loadedFrom = "corrupt";
      return;
    }
    const before = Number.isFinite(parsed && parsed.v) ? parsed.v : 0;
    data = normalise(migrate(parsed));
    loadedFrom = before === SCHEMA ? "storage" : `migrated:${before}`;
  }

  /** The Tour Pass is earned in the 2D game and displayed in the 3D one.
   *  Merged as a union on every boot rather than imported once, so a
   *  badge earned in the 2D tab later still shows up here. */
  function syncTourPass() {
    const raw = store.read(LEGACY_TOUR_KEY);
    if (!raw) return 0;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (error) { return 0; }
    if (!isObj(parsed)) return 0;

    const badges = idList(parsed.unlocked, BADGE_IDS);
    const cosmetics = idList(parsed.cosmetics, COSMETIC_IDS);
    let added = 0;
    for (const id of badges) {
      if (data.tour.badges.indexOf(id) === -1) { data.tour.badges.push(id); added += 1; }
    }
    for (const id of cosmetics) {
      if (data.tour.cosmetics.indexOf(id) === -1) { data.tour.cosmetics.push(id); added += 1; }
    }
    data.tour.syncedAt = Date.now();
    if (added > 0) dirty = true;
    return added;
  }

  function flush(force = false) {
    if (!dirty && !force) return false;
    data.v = SCHEMA;
    data.build = String(ctx && ctx.build ? ctx.build : "dev").slice(0, 32);
    data.updated = Date.now();
    data.stats.records = countRecords(data);
    const ok = store.write(STORE_KEY, JSON.stringify(data));
    dirty = false;
    sinceWrite = 0;
    if (ctx && ctx.bus) ctx.bus.emit("save:flushed", { ok, records: data.stats.records });
    return ok;
  }

  function touch() { dirty = true; }

  function course(courseId) {
    const key = String(Math.max(0, Math.floor(num(courseId, 0))));
    if (!data.courses[key]) data.courses[key] = defaultCourse();
    return data.courses[key];
  }

  load();
  syncTourPass();
  data.stats.sessions += 1;
  touch();

  // A tab closing mid-course is the common case, not the rare one.
  const onHide = () => { flush(true); };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });

  // Seed the live state so the HUD has real numbers on its first frame
  // rather than counting up from zero after the save arrives.
  if (ctx && ctx.state) {
    ctx.state.records = data.stats.records;
    if (!Number.isFinite(ctx.state.clout)) ctx.state.clout = 0;
  }

  const api = {
    /** Live blob. Read freely; mutate only through the methods below,
     *  which know to mark the save dirty. */
    get data() { return data; },
    get source() { return loadedFrom; },
    get persistent() { return store.available; },

    /* ---- Platinum Records ---- */

    recordsFor(courseId) { return course(courseId).records.slice(); },
    hasRecord(courseId, recordId) {
      return course(courseId).records.indexOf(String(recordId)) !== -1;
    },
    recordCount(courseId) { return course(courseId).records.length; },
    totalRecords() { return countRecords(data); },

    /** Returns false when the record was already held, so the caller can
     *  skip the ceremony on a replayed course. */
    addRecord(courseId, recordId, meta) {
      const id = String(recordId);
      const c = course(courseId);
      if (c.records.indexOf(id) !== -1) return false;
      c.records.push(id);
      if (c.records.length >= RECORDS_PER_COURSE) c.cleared = true;
      if (meta && Number.isFinite(meta.time) && meta.time > 0) {
        const best = c.times[id];
        if (!Number.isFinite(best) || meta.time < best) c.times[id] = meta.time;
      }
      data.stats.records = countRecords(data);
      touch();
      flush(true);   // a Record is the one thing worth an immediate write
      return true;
    },

    /* ---- Clout ---- */

    addClout(n, courseId) {
      const amount = Math.floor(num(n, 0));
      if (amount <= 0) return data.clout.total;
      data.clout.total += amount;
      if (courseId !== undefined && courseId !== null) {
        const c = course(courseId);
        const runTotal = Math.floor(num(ctx && ctx.state ? ctx.state.clout : 0, 0));
        if (runTotal > c.clout) c.clout = runTotal;
      }
      touch();
      return data.clout.total;
    },
    totalClout() { return data.clout.total; },
    courseClout(courseId) { return course(courseId).clout; },
    noteCourseClout(courseId, amount) {
      const c = course(courseId);
      const value = Math.floor(num(amount, 0));
      if (value > c.clout) { c.clout = value; touch(); }
      return c.clout;
    },

    /* ---- times ---- */

    bestTime(courseId, recordId) {
      const t = course(courseId).times[String(recordId)];
      return Number.isFinite(t) ? t : null;
    },
    noteTime(courseId, recordId, seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      const c = course(courseId);
      const id = String(recordId);
      if (!Number.isFinite(c.times[id]) || seconds < c.times[id]) {
        c.times[id] = seconds;
        touch();
      }
      return c.times[id];
    },
    bestRun(courseId) { return course(courseId).bestRun; },
    noteRun(courseId, seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      const c = course(courseId);
      if (!Number.isFinite(c.bestRun) || seconds < c.bestRun) { c.bestRun = seconds; touch(); }
      return c.bestRun;
    },
    noteVisit(courseId) { course(courseId).visits += 1; touch(); },
    noteDeath() { data.stats.deaths += 1; touch(); },

    /* ---- Record Deals ---- */

    seenDeals() { return data.deals.seen.slice(); },
    hasSeenDeal(dealId) { return data.deals.seen.indexOf(String(dealId)) !== -1; },
    /** Returns true the first time a deal is ever picked up, which is
     *  what gates the "new contract" card. */
    markDeal(dealId) {
      const id = String(dealId);
      if (DEAL_IDS.indexOf(id) === -1) return false;
      data.deals.signed[id] = (data.deals.signed[id] || 0) + 1;
      touch();
      if (data.deals.seen.indexOf(id) !== -1) return false;
      data.deals.seen.push(id);
      return true;
    },

    /* ---- Tour Pass ---- */

    badges() { return data.tour.badges.slice(); },
    hasBadge(id) { return data.tour.badges.indexOf(String(id)) !== -1; },
    cosmetics() { return data.tour.cosmetics.slice(); },
    fit() { return data.tour.fit; },
    setFit(id) {
      if (data.tour.cosmetics.indexOf(String(id)) === -1) return false;
      data.tour.fit = String(id);
      touch();
      return true;
    },
    syncTourPass,

    /* ---- lifecycle ---- */

    /** Deep-ish copy for the results screen, which must not be able to
     *  write back into the live save by holding a reference. */
    snapshot() {
      try { return JSON.parse(JSON.stringify(data)); }
      catch (error) { return defaultSave(); }
    },

    flush,
    touch,

    /** Wipes 3D progress only. The 2D Tour Pass is not ours to delete,
     *  so it is re-synced straight back in. */
    reset() {
      data = defaultSave();
      syncTourPass();
      dirty = true;
      flush(true);
      if (ctx && ctx.state) { ctx.state.records = 0; ctx.state.clout = 0; }
      if (ctx && ctx.bus) ctx.bus.emit("save:reset", {});
      return true;
    },

    update() {
      const dt = ctx && ctx.clock ? Math.min(ctx.clock.raw || 0, 0.25) : 0;
      data.stats.playtime += dt;
      if (!dirty) return;
      sinceWrite += dt;
      if (sinceWrite >= WRITE_INTERVAL) flush();
    },

    exit() { flush(true); },

    dispose() {
      flush(true);
      window.removeEventListener("pagehide", onHide);
    },
  };

  return api;
}

export const SAVE_KEY = STORE_KEY;
export const SAVE_SCHEMA = SCHEMA;
export const DEALS = DEAL_IDS;
export const BADGES = BADGE_IDS;
