import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "assets", "img", "saintfall", "talents");

const TALENT_SPECS = [
  // Wing remaining:
  {
    id: "wing_rams_halo",
    order: "wing",
    name: "Ram's Halo",
    color: "#00f0ff",
    accent: "#67e8f9",
    iconType: "ram",
  },
  {
    id: "wing_unbroken_circuit",
    order: "wing",
    name: "Unbroken Circuit",
    color: "#00f0ff",
    accent: "#a5f3fc",
    iconType: "circuit",
    isCapstone: true,
  },
  // Halo:
  {
    id: "halo_votive_parry",
    order: "halo",
    name: "Votive Parry",
    color: "#3b82f6",
    accent: "#93c5fd",
    iconType: "parry",
  },
  {
    id: "halo_stored_wrath",
    order: "halo",
    name: "Stored Wrath",
    color: "#3b82f6",
    accent: "#60a5fa",
    iconType: "wrath",
  },
  {
    id: "halo_pilgrims_reversal",
    order: "halo",
    name: "Pilgrim's Reversal",
    color: "#3b82f6",
    accent: "#bfdbfe",
    iconType: "reversal",
  },
  {
    id: "halo_mercy_circuit",
    order: "halo",
    name: "Mercy Circuit",
    color: "#3b82f6",
    accent: "#60a5fa",
    iconType: "mercy",
  },
  {
    id: "halo_seraph_aegis",
    order: "halo",
    name: "Seraph Aegis",
    color: "#3b82f6",
    accent: "#dbeafe",
    iconType: "seraph",
    isCapstone: true,
  },
  // Edict:
  {
    id: "edict_siren_beacon",
    order: "edict",
    name: "Siren Beacon",
    color: "#10b981",
    accent: "#6ee7b7",
    iconType: "beacon",
  },
  {
    id: "edict_live_fuse",
    order: "edict",
    name: "Live Fuse",
    color: "#10b981",
    accent: "#34d399",
    iconType: "fuse",
  },
  {
    id: "edict_recall_rite",
    order: "edict",
    name: "Recall Rite",
    color: "#10b981",
    accent: "#a7f3d0",
    iconType: "recall",
  },
  {
    id: "edict_field_chapel",
    order: "edict",
    name: "Field Chapel",
    color: "#10b981",
    accent: "#6ee7b7",
    iconType: "chapel",
  },
  {
    id: "edict_combined_liturgy",
    order: "edict",
    name: "Combined Liturgy",
    color: "#10b981",
    accent: "#d1fae5",
    iconType: "liturgy",
    isCapstone: true,
  },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

  for (const spec of TALENT_SPECS) {
    const dataUrl = await page.evaluate((s) => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");

      // Dark gothic sci-fi background with vignette and energy aura
      const bg = ctx.createRadialGradient(256, 256, 40, 256, 256, 260);
      bg.addColorStop(0, "#0f1c24");
      bg.addColorStop(0.5, "#060e12");
      bg.addColorStop(1, "#020406");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 512, 512);

      // Radial energy glow
      const glow = ctx.createRadialGradient(256, 256, 20, 256, 256, 180);
      glow.addColorStop(0, s.color + "55");
      glow.addColorStop(0.6, s.color + "18");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 512, 512);

      // Ornate gothic frame border
      ctx.strokeStyle = s.isCapstone ? "#d8a441" : "#4a6375";
      ctx.lineWidth = 14;
      ctx.strokeRect(16, 16, 480, 480);

      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(26, 26, 460, 460);

      // Corner ornaments
      const drawCorner = (x, y, dx, dy) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "#d8a441";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(dx * 40, 0);
        ctx.lineTo(dx * 20, dy * 20);
        ctx.lineTo(0, dy * 40);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      drawCorner(26, 26, 1, 1);
      drawCorner(486, 26, -1, 1);
      drawCorner(26, 486, 1, -1);
      drawCorner(486, 486, -1, -1);

      // Central Emblem / Symbol
      ctx.save();
      ctx.translate(256, 256);
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 24;

      // Outer sacred geometry ring
      ctx.strokeStyle = s.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 130, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = s.color + "88";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 12]);
      ctx.beginPath();
      ctx.arc(0, 0, 150, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Specialized Icon Glyphs
      ctx.fillStyle = s.color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 5;

      if (s.iconType === "ram") {
        // Vaulting ram / horn crescent
        ctx.beginPath();
        ctx.arc(-30, -20, 60, Math.PI * 0.2, Math.PI * 1.6);
        ctx.arc(30, -20, 60, Math.PI * 1.4, Math.PI * 0.8, true);
        ctx.stroke();
        // Central lance
        ctx.beginPath();
        ctx.moveTo(0, -90);
        ctx.lineTo(0, 90);
        ctx.lineTo(-20, 40);
        ctx.moveTo(0, 90);
        ctx.lineTo(20, 40);
        ctx.stroke();
      } else if (s.iconType === "circuit" || s.iconType === "mercy") {
        // Triumvirate circuit / sacred triad
        for (let i = 0; i < 3; i++) {
          const angle = (i * Math.PI * 2) / 3 - Math.PI / 2;
          const cx = Math.cos(angle) * 70;
          const cy = Math.sin(angle) * 70;
          ctx.beginPath();
          ctx.arc(cx, cy, 32, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = s.accent;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      } else if (s.iconType === "parry" || s.iconType === "seraph") {
        // Aegis shield & parry flash
        ctx.beginPath();
        ctx.moveTo(0, -85);
        ctx.lineTo(65, -45);
        ctx.lineTo(55, 35);
        ctx.lineTo(0, 90);
        ctx.lineTo(-55, 35);
        ctx.lineTo(-65, -45);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = s.color + "44";
        ctx.fill();
        // Cross rays
        ctx.beginPath();
        ctx.moveTo(-45, 0); ctx.lineTo(45, 0);
        ctx.moveTo(0, -45); ctx.lineTo(0, 45);
        ctx.stroke();
      } else if (s.iconType === "wrath" || s.iconType === "reversal") {
        // Kinetic shield burst
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI * 2) / 8;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 35, Math.sin(angle) * 35);
          ctx.lineTo(Math.cos(angle) * 95, Math.sin(angle) * 95);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      } else if (s.iconType === "beacon" || s.iconType === "chapel") {
        // Orbital beacon tower & signal waves
        ctx.beginPath();
        ctx.moveTo(0, -100); ctx.lineTo(25, 80); ctx.lineTo(-25, 80);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = s.color + "55";
        ctx.fill();
        // Transmission arcs
        for (let r = 45; r <= 95; r += 25) {
          ctx.beginPath();
          ctx.arc(0, -60, r, -Math.PI * 0.8, -Math.PI * 0.2);
          ctx.stroke();
        }
      } else if (s.iconType === "fuse" || s.iconType === "recall") {
        // Crosshair reticle and laser detonator
        ctx.beginPath();
        ctx.arc(0, 0, 70, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-90, 0); ctx.lineTo(-40, 0);
        ctx.moveTo(40, 0); ctx.lineTo(90, 0);
        ctx.moveTo(0, -90); ctx.lineTo(0, -40);
        ctx.moveTo(0, 40); ctx.lineTo(0, 90);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      } else {
        // Combined liturgy cataclysm
        ctx.beginPath();
        ctx.moveTo(0, -95);
        ctx.lineTo(80, 45);
        ctx.lineTo(-80, 45);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 95);
        ctx.lineTo(80, -45);
        ctx.lineTo(-80, -45);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }

      ctx.restore();
      return canvas.toDataURL("image/jpeg", 0.92);
    }, spec);

    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    await writeFile(path.join(outDir, `${spec.id}.jpg`), Buffer.from(base64Data, "base64"));
    console.log(`Generated ${spec.id}.jpg`);
  }

  await browser.close();
  console.log("All talent icons ready!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
