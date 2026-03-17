import type { GardenState } from "../store/garden";
import type { PlantVariant } from "../type/plants";
import { canPlaceFootprint, footprintBounds, markFootprint } from "./footprint";

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

export function relativeHeightFactor(
  candidate: PlantVariant,
  candidateRow: number,
  candidateCol: number,
  placed: Placed[],
  variantMap: Map<string, PlantVariant>
) {
  let factor = 1;
  const candidateFp = (candidate.footprint ?? [1, 1]) as [number, number];
  const candidate_bounds=footprintBounds({r:candidateRow,c:candidateCol},candidateFp)
  const candidateRowStart = candidate_bounds.top;
  const candidateRowEnd = candidate_bounds.bottom;
  const candidateColStart = candidate_bounds.left;
  const candidateColEnd = candidate_bounds.right;

  for (const existing of placed) {
    const existingVariant = variantMap.get(existing.id);
    if (!existingVariant) continue;

    const existingFp = (existingVariant.footprint ?? [1, 1]) as [number, number];
    const bounds = footprintBounds({ r: existing.r, c: existing.c }, existingFp);
    const existingRowStart = bounds.top;
    const existingRowEnd = bounds.bottom;
    const existingColStart = bounds.left;
    const existingColEnd = bounds.right;

    let deltaRow = 0;
    if (candidateRowEnd < existingRowStart) deltaRow = candidateRowEnd - existingRowStart;
    else if (candidateRowStart > existingRowEnd) deltaRow = candidateRowStart - existingRowEnd;

    let deltaCol = 0;
    if (candidateColEnd < existingColStart) deltaCol = existingColStart - candidateColEnd;
    else if (candidateColStart > existingColEnd) deltaCol = candidateColStart - existingColEnd;

    const rowDistance = Math.abs(deltaRow);
    if (rowDistance === 0 && deltaCol === 0) continue;

    const distanceWeight = 1 / (rowDistance + deltaCol);
    const heightDelta = candidate.baseHeight - existingVariant.baseHeight;
    if(deltaRow*heightDelta>=0){
      const severity = Math.min(1, (Math.abs(heightDelta) / Math.max(existingVariant.baseHeight, 1)) * 1.2);
      const colWeight = deltaCol === 0 ? 1 : 1 / (Math.abs(deltaCol) + 1);
      factor *= Math.max(0.05, 1 - severity * distanceWeight * colWeight * 5);
      console.log("severity",severity,"deltaCol",deltaCol,"deltaHeight",Math.abs(heightDelta))
    }
    
  }

  return factor;
}

function pickWeighted(
  variants: PlantVariant[],
  seed: number,
  candidateRow: number,
  candidateCol: number,
  placed: Placed[],
  variantMap: Map<string, PlantVariant>
) {
  if (variants.length === 0) return null;
  const weightedCandidates = variants.map((v, i) => {
    const placementFactor = relativeHeightFactor(v, candidateRow, candidateCol, placed, variantMap);
    const base = 1 + ((i % 5) * 0.03);
    return {
      variant: v,
      placementFactor,
      weight: base * placementFactor,
    };
  });
  const sum = weightedCandidates.reduce((a, b) => a + b.weight, 0);
  if (sum <= 0) return variants[variants.length - 1] ?? null;
  let p = seededRandom(seed) * sum;
  for (let i = 0; i < weightedCandidates.length; i++) {
    p -= weightedCandidates[i].weight;
    if (p <= 0) {
      const chosen = weightedCandidates[i];
      console.log("[auto-layout] choose", {
        row: candidateRow,
        col: candidateCol,
        plantId: chosen.variant.id,
        placementFactor: Number(chosen.placementFactor.toFixed(4)),
        weight: Number(chosen.weight.toFixed(4)),
      });
      return chosen.variant;
    }
  }
  const fallback = weightedCandidates[weightedCandidates.length - 1];
  console.log("[auto-layout] choose", {
    row: candidateRow,
    col: candidateCol,
    plantId: fallback.variant.id,
    placementFactor: Number(fallback.placementFactor.toFixed(4)),
    weight: Number(fallback.weight.toFixed(4)),
    fallback: true,
  });
  return fallback.variant;
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
    cells: base.cells.map((c) => ({ ...c })),
  };
  const occupied = Array.from({ length: rows }, () => Array(cols).fill(false));
  const variantMap = new Map<string, PlantVariant>();
  for (const variant of variants) variantMap.set(variant.id, variant);

  const positions: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) positions.push({ r, c });
  }
  const shuffled = makeShuffled(positions, seed);

  const placed: Placed[] = [];
  let used = 0;

  for (const cell of next.cells) {
    if (!cell.plant || cell.plant === "empty") continue;
    const fp = (variantMap.get(cell.plant)?.footprint ?? [1, 1]) as [number, number];
    if (!canPlaceFootprint(occupied, rows, cols, { r: cell.row, c: cell.col }, fp)) continue;
    markFootprint(occupied, { r: cell.row, c: cell.col }, fp);
    used += fp[0] * fp[1];
    placed.push({ r: cell.row, c: cell.col, id: cell.plant });
  }

  let idx = 0;
  while (idx < shuffled.length && used < targetOccupiedCells) {
    const { r, c } = shuffled[idx++];
    if (occupied[r][c]) continue;

    const chosen = pickWeighted(variants, seed + r * 131 + c * 17, r, c, placed, variantMap);
    if (!chosen) break;
    const fp = (chosen.footprint ?? [1, 1]) as [number, number];

    if (!canPlaceFootprint(occupied, rows, cols, { r, c }, fp)) continue;
    markFootprint(occupied, { r, c }, fp);
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
    const bounds = footprintBounds({ r: a.row, c: a.col }, fp);
    for (let rr = Math.max(0, bounds.top); rr <= Math.min(garden.rows - 1, bounds.bottom); rr++) {
      for (let cc = Math.max(0, bounds.left); cc <= Math.min(garden.cols - 1, bounds.right); cc++) {
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
