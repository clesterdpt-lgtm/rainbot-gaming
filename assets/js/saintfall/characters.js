/* ============================================================
   SAINTFALL - playable operative registry

   The campaign resolves one body before createPlayer() runs. The
   intro owns the choice UI, but this module owns the durable IDs,
   figure factories and player-facing descriptions so the menu,
   URL review surface and runtime can never disagree.
   ============================================================ */

import { buildVesperTrooper } from "saintfall/player.js";
import {
  buildWhiteVigilTrooper,
  buildBastionPenitentTrooper,
} from "saintfall/summit-player.js";

export const SAINTFALL_CHARACTER_STORAGE_KEY = "sf-saintfall-character";
export const DEFAULT_SAINTFALL_CHARACTER_ID = "vesper-reliquary";

const portrait = (file) => new URL(
  `../../img/saintfall/operatives/${file}`,
  import.meta.url,
).href;

export const SAINTFALL_CHARACTERS = Object.freeze([
  Object.freeze({
    id: "vesper-reliquary",
    name: "Saint Aurel",
    role: "Saint Vanguard",
    summary: "Censer-lance volleys, melee procession, Aegis guard, and sustained flight make a flexible all-range vanguard.",
    traits: Object.freeze(["CENSER-LANCE", "AEGIS GUARD", "SUSTAINED FLIGHT"]),
    accent: "gold",
    portrait: portrait("vesper-reliquary-profile-v3.png"),
    factory: buildVesperTrooper,
  }),
  Object.freeze({
    id: "white-vigil",
    name: "Saint Veyra",
    role: "Saint Scout",
    summary: "Twin crescent emitters, Vigil Step, quick blades, and an aimed aerial Stoop reward relentless movement.",
    traits: Object.freeze(["CRESCENT VOLLEY", "VIGIL STEP", "AERIAL STOOP"]),
    accent: "verdigris",
    portrait: portrait("white-vigil-profile-v3.png"),
    factory: buildWhiteVigilTrooper,
  }),
  Object.freeze({
    id: "bastion-penitent",
    name: "Saint Torren",
    role: "Saint Bulwark",
    summary: "Reliquary hammer, unlimited tower guard, Hammer Cast, and a powered leap favor committed advances.",
    traits: Object.freeze(["RELIQUARY HAMMER", "TOWER GUARD", "HAMMER CAST"]),
    accent: "crimson",
    portrait: portrait("bastion-penitent-profile-v3.png"),
    factory: buildBastionPenitentTrooper,
  }),
]);

const byId = new Map(SAINTFALL_CHARACTERS.map((character) => [character.id, character]));
const aliases = new Map([
  ["vesper", "vesper-reliquary"],
  ["reliquary", "vesper-reliquary"],
  ["aurel", "vesper-reliquary"],
  ["saint-aurel", "vesper-reliquary"],
  ["white", "white-vigil"],
  ["vigil", "white-vigil"],
  ["veyra", "white-vigil"],
  ["saint-veyra", "white-vigil"],
  ["bastion", "bastion-penitent"],
  ["penitent", "bastion-penitent"],
  ["red-bastion", "bastion-penitent"],
  ["torren", "bastion-penitent"],
  ["saint-torren", "bastion-penitent"],
]);

export function resolveSaintfallCharacter(id) {
  const key = String(id || "").trim().toLowerCase();
  return byId.get(key) || byId.get(aliases.get(key)) || null;
}

export function storedSaintfallCharacter() {
  try {
    return resolveSaintfallCharacter(localStorage.getItem(SAINTFALL_CHARACTER_STORAGE_KEY));
  } catch (_) {
    return null;
  }
}

export function persistSaintfallCharacter(id) {
  const character = typeof id === "object" ? resolveSaintfallCharacter(id?.id)
    : resolveSaintfallCharacter(id);
  if (!character) return null;
  try { localStorage.setItem(SAINTFALL_CHARACTER_STORAGE_KEY, character.id); } catch (_) {
    // URL selection remains authoritative when storage is unavailable.
  }
  return character;
}

export function chooseSaintfallCharacter({ params, qa = false } = {}) {
  const requested = resolveSaintfallCharacter(params?.get?.("character"));
  if (requested) return requested;
  /* Deterministic review URLs must never inherit a previous manual
     selection. Production does, so Continue builds the same body as
     the field record the player just left. */
  if (!qa) {
    const stored = storedSaintfallCharacter();
    if (stored) return stored;
  }
  return byId.get(DEFAULT_SAINTFALL_CHARACTER_ID);
}
