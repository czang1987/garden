import { createGarden, type GardenState, type Season } from "../store/garden";
import type { PlantVariant } from "../type/plants";

export type LayoutPlacement = {
  plantId: string;
  plantName: string;
  row: number;
  col: number;
  purchaseUrl: string;
};

export type LayoutPlantSummary = {
  plantId: string;
  plantName: string;
  count: number;
  purchaseUrl: string;
};

export type LayoutFile = {
  formatVersion: "garden-layout-v1";
  exportedAt: string;
  rows: number;
  cols: number;
  season: Season;
  zone: number;
  plants: LayoutPlantSummary[];
  placements: LayoutPlacement[];
};

function isSeason(v: unknown): v is Season {
  return v === "spring" || v === "summer" || v === "autumn" || v === "winter";
}

function toInt(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function buildLayoutFile(garden: GardenState, variants: PlantVariant[]): LayoutFile {
  const variantMap = new Map(variants.map((v) => [v.id, v] as const));
  const anchors = garden.cells.filter((c) => c.plant && c.plant !== "empty");

  const counts = new Map<string, number>();
  for (const a of anchors) counts.set(a.plant, (counts.get(a.plant) ?? 0) + 1);

  const plants: LayoutPlantSummary[] = Array.from(counts.entries())
    .map(([plantId, count]) => {
      const v = variantMap.get(plantId);
      return {
        plantId,
        plantName: v?.name ?? plantId,
        count,
        purchaseUrl: v?.link ?? "",
      };
    })
    .sort((a, b) => a.plantName.localeCompare(b.plantName));

  const placements: LayoutPlacement[] = anchors
    .map((a) => {
      const v = variantMap.get(a.plant);
      return {
        plantId: a.plant,
        plantName: v?.name ?? a.plant,
        row: a.row,
        col: a.col,
        purchaseUrl: v?.link ?? "",
      };
    })
    .sort((a, b) => a.row - b.row || a.col - b.col || a.plantId.localeCompare(b.plantId));

  return {
    formatVersion: "garden-layout-v1",
    exportedAt: new Date().toISOString(),
    rows: garden.rows,
    cols: garden.cols,
    season: garden.season,
    zone: garden.zone,
    plants,
    placements,
  };
}

export function formatLayoutFileAsReadableText(layout: LayoutFile): string {
  const lines: string[] = [];
  lines.push("Garden Layout Export");
  lines.push("==================");
  lines.push(`Exported At: ${layout.exportedAt}`);
  lines.push(`Grid: ${layout.rows} x ${layout.cols}`);
  lines.push(`Season: ${layout.season}`);
  lines.push(`Zone: ${layout.zone}`);
  lines.push("");
  lines.push("Plant Summary");
  lines.push("-------------");
  for (const p of layout.plants) {
    lines.push(`- ${p.plantName} (${p.plantId})`);
    lines.push(`  Count: ${p.count}`);
    lines.push(`  Purchase URL: ${p.purchaseUrl || "-"}`);
  }
  lines.push("");
  lines.push("Placements");
  lines.push("----------");
  for (const p of layout.placements) {
    lines.push(`- ${p.plantName} (${p.plantId}) @ row=${p.row}, col=${p.col}`);
    lines.push(`  Purchase URL: ${p.purchaseUrl || "-"}`);
  }
  return lines.join("\n");
}

export function parseReadableTextToLayoutFile(text: string): LayoutFile {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const get = (prefix: string) =>
    lines.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()))?.slice(prefix.length).trim() ?? "";

  const exportedAt = get("Exported At:") || new Date().toISOString();
  const grid = get("Grid:");
  const seasonRaw = get("Season:");
  const zoneRaw = get("Zone:");
  const gridMatch = grid.match(/(\d+)\s*x\s*(\d+)/i);
  const rows = gridMatch ? Number(gridMatch[1]) : 1;
  const cols = gridMatch ? Number(gridMatch[2]) : 1;
  const season: Season = isSeason(seasonRaw) ? seasonRaw : "spring";
  const zone = toInt(zoneRaw, 6);

  const placements: LayoutPlacement[] = [];
  const placeRegex = /^-\s+(.+?)\s+\(([^)]+)\)\s+@\s+row\s*=\s*(\d+)\s*,\s*col\s*=\s*(\d+)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(placeRegex);
    if (!m) continue;
    const plantName = m[1].trim();
    const plantId = m[2].trim();
    const row = Number(m[3]);
    const col = Number(m[4]);
    let purchaseUrl = "";
    const next = lines[i + 1] ?? "";
    const u = next.match(/^Purchase URL:\s*(.*)$/i);
    if (u) purchaseUrl = u[1].trim();
    placements.push({ plantId, plantName, row, col, purchaseUrl });
  }

  const counts = new Map<string, LayoutPlantSummary>();
  for (const p of placements) {
    const prev = counts.get(p.plantId);
    if (prev) prev.count += 1;
    else {
      counts.set(p.plantId, {
        plantId: p.plantId,
        plantName: p.plantName,
        count: 1,
        purchaseUrl: p.purchaseUrl,
      });
    }
  }

  return {
    formatVersion: "garden-layout-v1",
    exportedAt,
    rows,
    cols,
    season,
    zone,
    plants: Array.from(counts.values()),
    placements,
  };
}

type ImportResult = {
  garden: GardenState;
  warnings: string[];
};

export function parseLayoutText(
  text: string,
  variants: PlantVariant[],
  fallbackSeason: Season,
  fallbackZone = 6
): ImportResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = parseReadableTextToLayoutFile(text);
  }
  const placementsRaw = Array.isArray(raw?.placements) ? raw.placements : Array.isArray(raw) ? raw : [];
  const rowsFromFile = toInt(raw?.rows, 0);
  const colsFromFile = toInt(raw?.cols, 0);
  const maxRow = placementsRaw.reduce((m, p) => Math.max(m, toInt(p?.row, 0)), 0);
  const maxCol = placementsRaw.reduce((m, p) => Math.max(m, toInt(p?.col, 0)), 0);
  const rows = Math.max(1, rowsFromFile || maxRow + 1);
  const cols = Math.max(1, colsFromFile || maxCol + 1);
  const season = isSeason(raw?.season) ? raw.season : fallbackSeason;
  const zone = toInt(raw?.zone, fallbackZone);

  const next = createGarden(rows, cols, zone);
  next.season = season;

  const variantMap = new Map(variants.map((v) => [v.id, v] as const));
  const occupied = Array.from({ length: rows }, () => Array(cols).fill(false));
  const warnings: string[] = [];

  for (const item of placementsRaw) {
    const plantId = String(item?.plantId ?? item?.plant ?? "").trim();
    const row = toInt(item?.row, -1);
    const col = toInt(item?.col, -1);
    if (!plantId || row < 0 || col < 0) {
      warnings.push("Skipped one placement with missing plantId/row/col.");
      continue;
    }
    const variant = variantMap.get(plantId);
    if (!variant) {
      warnings.push(`Skipped unknown plant: ${plantId}`);
      continue;
    }
    const fp = (variant.footprint ?? [1, 1]) as [number, number];
    const [h, w] = fp;
    if (row + h > rows || col + w > cols) {
      warnings.push(`Skipped out-of-bounds plant: ${plantId} at (${row}, ${col})`);
      continue;
    }
    let blocked = false;
    for (let rr = row; rr < row + h && !blocked; rr++) {
      for (let cc = col; cc < col + w; cc++) {
        if (occupied[rr][cc]) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) {
      warnings.push(`Skipped overlapping plant: ${plantId} at (${row}, ${col})`);
      continue;
    }

    for (let rr = row; rr < row + h; rr++) {
      for (let cc = col; cc < col + w; cc++) {
        occupied[rr][cc] = true;
      }
    }
    const cell = next.cells.find((c) => c.row === row && c.col === col);
    if (cell) cell.plant = plantId;
  }

  return { garden: next, warnings };
}
