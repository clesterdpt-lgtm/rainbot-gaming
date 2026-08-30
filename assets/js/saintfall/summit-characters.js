/* ============================================================
   SAINTFALL - Kenosis operative selection

   Selection happens before the world is constructed so only one
   skinned GLB enters memory. `?character=` is also a stable review
   surface: QA can boot either figure directly without clicking UI.
   ============================================================ */

import {
  buildWhiteVigilTrooper,
  buildBastionPenitentTrooper,
} from "saintfall/summit-player.js";

export const SUMMIT_CHARACTERS = [
  {
    id: "white-vigil",
    name: "Saint Veyra",
    designation: "Saint Scout",
    description: "A lean expedition plate carrying paired crescent melee/ranged hybrid arms.",
    accent: "verdigris",
    factory: buildWhiteVigilTrooper,
  },
  {
    id: "bastion-penitent",
    name: "Saint Torren",
    designation: "Saint Bulwark",
    description: "A heavier crimson plate carrying a reliquary hammer and tower shield.",
    accent: "crimson",
    factory: buildBastionPenitentTrooper,
  },
];

const byId = new Map(SUMMIT_CHARACTERS.map((character) => [character.id, character]));
const aliases = new Map([
  ["white", "white-vigil"],
  ["vigil", "white-vigil"],
  ["veyra", "white-vigil"],
  ["saint-veyra", "white-vigil"],
  ["red", "bastion-penitent"],
  ["bastion", "bastion-penitent"],
  ["red-bastion", "bastion-penitent"],
  ["torren", "bastion-penitent"],
  ["saint-torren", "bastion-penitent"],
]);

function resolveCharacter(id) {
  const key = String(id || "").trim().toLowerCase();
  return byId.get(key) || byId.get(aliases.get(key)) || null;
}

function storedChoice() {
  try {
    return resolveCharacter(localStorage.getItem("sf-white-vigil-character"));
  } catch (error) {
    return null;
  }
}

function persistChoice(character) {
  try {
    localStorage.setItem("sf-white-vigil-character", character.id);
  } catch (error) {
    // Storage is optional; the URL remains the authoritative selection.
  }
}

export async function chooseSummitCharacter({ params, qa = false } = {}) {
  const requested = resolveCharacter(params?.get("character"));
  /* QA remains deterministic and backward compatible: ?qa=1 alone
     means the original White Vigil, while either character can be
     selected explicitly for focused probes. */
  if (requested || qa) return requested || SUMMIT_CHARACTERS[0];

  const overlay = document.getElementById("sf-character-select");
  if (!overlay) return SUMMIT_CHARACTERS[0];

  const cards = [...overlay.querySelectorAll("[data-sf-character]")];
  const deploy = overlay.querySelector("[data-sf-character-deploy]");
  let selected = storedChoice() || SUMMIT_CHARACTERS[0];

  const render = () => {
    for (const card of cards) {
      const active = card.dataset.sfCharacter === selected.id;
      card.classList.toggle("is-selected", active);
      card.setAttribute("aria-pressed", active ? "true" : "false");
      card.tabIndex = active ? 0 : -1;
    }
    if (deploy) deploy.textContent = `Deploy ${selected.name}`;
  };

  overlay.hidden = false;
  overlay.classList.add("is-active");
  overlay.setAttribute("aria-hidden", "false");
  render();
  cards.find((card) => card.dataset.sfCharacter === selected.id)?.focus({ preventScroll: true });

  return new Promise((resolve) => {
    const select = (id) => {
      const next = resolveCharacter(id);
      if (!next) return;
      selected = next;
      render();
    };

    for (const card of cards) {
      card.addEventListener("click", () => select(card.dataset.sfCharacter));
      card.addEventListener("keydown", (event) => {
        const index = cards.indexOf(card);
        const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1 : (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0);
        if (!direction) return;
        event.preventDefault();
        const nextCard = cards[(index + direction + cards.length) % cards.length];
        select(nextCard.dataset.sfCharacter);
        nextCard.focus();
      });
    }

    deploy?.addEventListener("click", () => {
      persistChoice(selected);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("character", selected.id);
      history.replaceState(null, "", nextUrl);
      overlay.classList.remove("is-active");
      overlay.setAttribute("aria-hidden", "true");
      overlay.hidden = true;
      resolve(selected);
    }, { once: true });
  });
}
