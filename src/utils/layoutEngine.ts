import type { GardenState, Season } from "../store/garden";
import type { PlantVariant } from "../type/plants";

type ScoreBreakdown = {
  coverage: number;
  diversity: number;
  seasonalBloom: number;
  maintenance: number;
  adjacency: number;
};

export type LayoutScore = {
  total: number;
  breakdown: ScoreBreakdown;
};

type EngineOptions = {
  seed?: number;
  targetCoverage?: number;
};

type Placed = {
  r: number;
  c: number;
  id: string;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function makeShuffled<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seed + i * 17) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickWeighted(variants: PlantVariant[], season: Season, seed: number) {
  if (variants.length === 0) return null;
  const weights = variants.map((v, i) => {
    const bloomBoost = v.bloomSeasons?.includes(season) ? 1.25 : 1;
    const m = v.maintenance ?? 3;
    const maintainBoost = 1 + (5 - m) * 0.04;
    const base = 1 + ((i % 5) * 0.03);
    return base * bloomBoost * maintainBoost;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let p = seededRandom(seed) * sum;
  for (let i = 0; i < variants.length; i++) {
    p -= weights[i];
    if (p <= 0) return variants[i];
  }
  return variants[variants.length - 1];
}

function canPlace(
  occupied: boolean[][],
  rows: number,
  cols: number,
  r: number,
  c: number,
  fp: [number, number]
) {
  const [h, w] = fp;
  if (r + h > rows || c + w > cols) return false;
  for (let rr = r; rr < r + h; rr++) {
    for (let cc = c; cc < c + w; cc++) {
      if (occupied[rr][cc]) return false;
    }
  }
  return true;
}

function markOccupied(
  occupied: boolean[][],
  r: number,
  c: number,
  fp: [number, number]
) {
  const [h, w] = fp;
  for (let rr = r; rr < r + h; rr++) {
    for (let cc = c; cc < c + w; cc++) {
      occupied[rr][cc] = true;
    }
  }
}

export function generateAutoLayout(
  base: GardenState,
  variants: PlantVariant[],
  options: EngineOptions = {}
): GardenState {
  const seed = options.seed ?? Date.now();
  const rows = base.rows;
  const cols = base.cols;
  const total = rows * cols;
  const targetCoverage = clamp01(options.targetCoverage ?? 0.62);
  const targetOccupiedCells = Math.max(1, Math.floor(total * targetCoverage));

  const next: GardenState = {
    ...base,
    cells: base.cells.map((c) => ({ ...c, plant: "empty" })),
  };
  const occupied = Array.from({ length: rows }, () => Array(cols).fill(false));

  const positions: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) positions.push({ r, c });
  }
  const shuffled = makeShuffled(positions, seed);

  const placed: Placed[] = [];
  let used = 0;
  let idx = 0;
  while (idx < shuffled.length && used < targetOccupiedCells) {
    const { r, c } = shuffled[idx++];
    if (occupied[r][c]) continue;

    const chosen = pickWeighted(variants, base.season, seed + r * 131 + c * 17);
    if (!chosen) break;
    const fp = (chosen.footprint ?? [1, 1]) as [number, number];

    if (!canPlace(occupied, rows, cols, r, c, fp)) continue;
    markOccupied(occupied, r, c, fp);
    used += fp[0] * fp[1];
    placed.push({ r, c, id: chosen.id });
  }

  for (const p of placed) {
    const cell = next.cells.find((x) => x.row === p.r && x.col === p.c);
    if (cell) cell.plant = p.id;
  }
  return next;
}

export function scoreLayout(
  garden: GardenState,
  variants: PlantVariant[]
): LayoutScore {
  const map = new Map<string, PlantVariant>();
  for (const v of variants) map.set(v.id, v);

  const anchors = garden.cells.filter((c) => c.plant && c.plant !== "empty");
  if (anchors.length === 0) {
    return {
      total: 0,
      breakdown: {
        coverage: 0,
        diversity: 0,
        seasonalBloom: 0,
        maintenance: 0,
        adjacency: 0,
      },
    };
  }

  const occupancy = Array.from({ length: garden.rows }, () =>
    Array(garden.cols).fill(false)
  );
  for (const a of anchors) {
    const fp = (map.get(a.plant)?.footprint ?? [1, 1]) as [number, number];
    for (let rr = a.row; rr < Math.min(garden.rows, a.row + fp[0]); rr++) {
      for (let cc = a.col; cc < Math.min(garden.cols, a.col + fp[1]); cc++) {
        occupancy[rr][cc] = true;
      }
    }
  }

  let occupiedCount = 0;
  for (let r = 0; r < garden.rows; r++) {
    for (let c = 0; c < garden.cols; c++) {
      if (occupancy[r][c]) occupiedCount++;
    }
  }
  const coverageRatio = occupiedCount / (garden.rows * garden.cols);
  const coverage = Math.round(clamp01(1 - Math.abs(coverageRatio - 0.62) / 0.62) * 100);

  const counts = new Map<string, number>();
  for (const a of anchors) counts.set(a.plant, (counts.get(a.plant) ?? 0) + 1);
  const unique = counts.size;
  const diversity = Math.round(
    clamp01(unique / Math.max(3, Math.min(6, anchors.length))) * 100
  );

  let bloomHit = 0;
  for (const a of anchors) {
    const v = map.get(a.plant);
    if (v?.bloomSeasons?.includes(garden.season)) bloomHit++;
  }
  const seasonalBloom = Math.round((bloomHit / anchors.length) * 100);

  const maintAvg =
    anchors.reduce((sum, a) => sum + (map.get(a.plant)?.maintenance ?? 3), 0) /
    anchors.length;
  const maintenance = Math.round(clamp01((5 - maintAvg) / 4) * 100);

  const idAt = (r: number, c: number) =>
    garden.cells.find((x) => x.row === r && x.col === c)?.plant ?? "empty";
  let pairs = 0;
  let same = 0;
  for (const a of anchors) {
    const dirs = [
      [1, 0],
      [0, 1],
    ];
    for (const [dr, dc] of dirs) {
      const rr = a.row + dr;
      const cc = a.col + dc;
      if (rr >= garden.rows || cc >= garden.cols) continue;
      const b = idAt(rr, cc);
      if (!b || b === "empty") continue;
      pairs++;
      if (b === a.plant) same++;
    }
  }
  const adjacency = pairs === 0 ? 100 : Math.round((1 - same / pairs) * 100);

  const total = Math.round(
    coverage * 0.25 +
      diversity * 0.25 +
      seasonalBloom * 0.2 +
      maintenance * 0.15 +
      adjacency * 0.15
  );

  return {
    total,
    breakdown: {
      coverage,
      diversity,
      seasonalBloom,
      maintenance,
      adjacency,
    },
  };
}
