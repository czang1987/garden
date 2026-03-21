import type { GardenState } from "../store/garden";
import type { DesignIntent } from "../type/designIntent";
import type { PlantVariant } from "../type/plants";
import { buildOccupancyGrid, canPlaceFootprint, footprintBounds, footprintCells, markFootprint } from "./footprint";
import { plantSupportsZone } from "./zone";

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
  designIntent?: DesignIntent;
};

type DensityBand = "front" | "middle" | "back";

type BandCounts = Record<DensityBand, number>;

type Placed = {
  r: number;
  c: number;
  id: string;
};

function isMirrorPosition(
  cols:number,
  candidateRow: number, 
  candidateCol: number,
  candidatefp: [number,number],
  existingRow: number,
  existingCol: number,
  existingfp: [number,number],
  rowTolerence: number,
  colTolerence: number

){
  
  let mc=cols-candidateCol+1;
  let overlap_col=!(existingCol>mc || existingCol+(existingfp[1]+colTolerence)<mc-(candidatefp[1]+colTolerence));
  let overlap_row=!(existingRow-(existingfp[0]+rowTolerence)>candidateRow || existingRow<candidateRow-(candidatefp[0]+rowTolerence));
  return overlap_col&&overlap_row;

}

function symmetryFactor(
  candidate: PlantVariant,
  candidateRow: number,
  candidateCol: number,
  cols: number,
  rows: number,
  placed: Placed[],
  symmetryStrength: number,
  variantMap: Map<string, PlantVariant>
) {
  const strength = clamp01(symmetryStrength);
  if (strength <= 0) return 1;

  const fp = (candidate.footprint ?? [1, 1]) as [number, number];
  
  const candidateCenter = candidateCol + fp[1] / 2;
  const gardenCenter = cols / 2;
  const centerDistance = Math.abs(candidateCenter - gardenCenter);
  const centerWeight = cols <= 1 ? 1 : clamp01(centerDistance / (cols / 2));

  if (centerDistance==0) {
    return 1 + strength * 0.15;
  }

  const maxRowDistance = Math.max(1, Math.round(rows * 0.1));
  const maxColDistance = Math.max(1, Math.round(cols * 0.1));
  let bestSamePlantScore = -1;
  let bestAnyPlantScore = -1;

  for (const item of placed) {
    const existingVariant = variantMap.get(item.id);
    if (!existingVariant) continue;

    const existingFp = (existingVariant.footprint ?? [1, 1]) as [number, number];
    if(!isMirrorPosition(cols,candidateRow,candidateCol,fp,item.r,item.c,existingFp,maxRowDistance,maxColDistance)) continue;
    
    if (item.id === candidate.id) {
      bestSamePlantScore = 1;
    } else {
      bestAnyPlantScore = 1;
    }
  }

  if (bestSamePlantScore >= 0) {
    return 1 + strength * (0.45 + 0.75 * bestSamePlantScore) * centerWeight;
  }

  if (bestAnyPlantScore >= 0) {
    return 1 + strength * (0.12 + 0.28 * bestAnyPlantScore) * centerWeight;
  }

  return Math.max(0.72, 1 - strength * 0.2 * centerWeight);
}

function clusterFactor(
  candidate: PlantVariant,
  candidateRow: number,
  candidateCol: number,
  placed: Placed[],
  variantMap: Map<string, PlantVariant>,
  clusteriness: number
) {
  const strength = clamp01(clusteriness);
  if (strength <= 0) return 1;

  let samePlantBoost = 0;
  let sameCategoryBoost = 0;
  let sameColorBoost = 0;
  let otherPlantPenalty = 0;

  for (const item of placed) {
    const existingVariant = variantMap.get(item.id);
    if (!existingVariant) continue;

    const rowDistance = Math.abs(item.r - candidateRow);
    const colDistance = Math.abs(item.c - candidateCol);
    const distance = rowDistance + colDistance;
    if (distance === 0 || distance > 6) continue;

    const closeness = 1 / distance;
    if (item.id === candidate.id) {
      samePlantBoost = Math.max(samePlantBoost, closeness);
    } else if (
      candidate.categoryId &&
      existingVariant.categoryId &&
      candidate.categoryId === existingVariant.categoryId
    ) {
      sameCategoryBoost = Math.max(sameCategoryBoost, closeness);
    } else if (
      candidate.color &&
      existingVariant.color &&
      candidate.color.toLowerCase() === existingVariant.color.toLowerCase()
    ) {
      sameColorBoost = Math.max(sameColorBoost, closeness);
    } else {
      otherPlantPenalty = Math.max(otherPlantPenalty, closeness);
    }
  }

  if (samePlantBoost > 0) {
    return 1 + strength * Math.min(1.25, samePlantBoost * 1.6);
  }

  if (sameCategoryBoost > 0) {
    return 1 + strength * Math.min(0.7, sameCategoryBoost * 0.9);
  }

  if (sameColorBoost > 0) {
    return 1 + strength * Math.min(0.45, sameColorBoost * 0.65);
  }

  if (otherPlantPenalty > 0) {
    return Math.max(0.82, 1 - strength * Math.min(0.35, otherPlantPenalty * 0.22));
  }

  return 1;
}

function symmetryPositionFactor(
  candidateRow: number,
  candidateCol: number,
  cols: number,
  rows: number,
  placed: Placed[],
  symmetryStrength: number,
  variantMap: Map<string, PlantVariant>
) {
  const strength = clamp01(symmetryStrength);
  if (strength <= 0) return 1;

  const candidateFp: [number, number] = [1, 1];
  const candidateCenter = candidateCol + 0.5;
  const gardenCenter = cols / 2;
  const centerDistance = Math.abs(candidateCenter - gardenCenter);
  const centerWeight = cols <= 1 ? 1 : clamp01(centerDistance / (cols / 2));

  if (centerDistance === 0) {
    return 1 + strength * 0.1;
  }

 // const maxRowDistance = Math.max(1, Math.round(rows * 0.1));
 // const maxColDistance = Math.max(1, Math.round(cols * 0.1));
  let hasMirror = false;

  for (const item of placed) {
    const existingVariant = variantMap.get(item.id);
    if (!existingVariant) continue;
    const existingFp = (existingVariant.footprint ?? [1, 1]) as [number, number];
    if (
      isMirrorPosition(
        cols,
        candidateRow,
        candidateCol,
        candidateFp,
        item.r,
        item.c,
        existingFp,
        0,
        0
      )
    ) {
      hasMirror = true;
      break;
    }
  }

  if (hasMirror) {
  //  return 1 + strength * (0.35 + 0.75 * centerWeight);
    return Math.max(1,1*strength)
  }
  return Math.max(1,(1-0.12*centerDistance)*strength)
//  return Math.max(0.78, 1 - strength * 0.12 * centerWeight);
}

export function topSymmetryCandidateCells(
  garden: GardenState,
  variants: PlantVariant[],
  symmetryStrength: number,
  limit: number
) {
  const strength = clamp01(symmetryStrength);
  if (strength <= 0 || limit <= 0) return [];

  const variantMap = new Map(variants.map((variant) => [variant.id, variant] as const));
  const placed: Placed[] = garden.cells
    .filter((cell) => cell.plant && cell.plant !== "empty")
    .map((cell) => ({ r: cell.row, c: cell.col, id: cell.plant }));
  const occupancy = buildOccupancyGrid(garden, variants);

  const candidates: Array<{ r: number; c: number; score: number }> = [];
  for (let r = 0; r < garden.rows; r++) {
    for (let c = 0; c < garden.cols; c++) {
      if (occupancy[r]?.[c]) continue;
      const score = symmetryPositionFactor(r, c, garden.cols, garden.rows, placed, strength, variantMap);
      if (score < 1) continue;
      candidates.push({ r, c, score });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.r !== b.r) return a.r - b.r;
    return a.c - b.c;
  });

  const output = typeof limit === "number" ? candidates.slice(0, limit) : candidates;
  return output.map(({ r, c, score }) => ({ r, c, score }));
}

function pickWeightedPosition(
  positions: Array<{ r: number; c: number }>,
  seed: number,
  cols: number,
  rows: number,
  placed: Placed[],
  symmetryStrength: number,
  variantMap: Map<string, PlantVariant>
) {
  if (positions.length === 0) return -1;
  const weighted = positions.map((pos, i) => {
    const base = 1 + ((i % 7) * 0.02);
    const mirrorFactor = symmetryPositionFactor(
      pos.r,
      pos.c,
      cols,
      rows,
      placed,
      symmetryStrength,
      variantMap
    );
    return { weight: base * mirrorFactor };
  });
  const sum = weighted.reduce((acc, item) => acc + item.weight, 0);
  if (sum <= 0) return Math.floor(seededRandom(seed) * positions.length);
  let p = seededRandom(seed) * sum;
  for (let i = 0; i < weighted.length; i++) {
    p -= weighted[i].weight;
    if (p <= 0) return i;
  }
  return weighted.length - 1;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function rowRatio(row: number, rows: number) {
  if (rows <= 1) return 0;
  return clamp01(row / (rows - 1));
}

export function minHeightForRow(
  row: number,
  rows: number,
  frontMinHeight: number,
  backMinHeight: number
) {
  return lerp(backMinHeight, frontMinHeight, rowRatio(row, rows));
}

export function maxHeightForRow(
  row: number,
  rows: number,
  frontMaxHeight: number,
  backMaxHeight: number
) {
  return lerp(backMaxHeight, frontMaxHeight, rowRatio(row, rows));
}

export function heightFitsRow(
  height: number,
  row: number,
  rows: number,
  frontMinHeight: number,
  backMinHeight: number,
  frontMaxHeight: number,
  backMaxHeight: number
) {
  const minH = minHeightForRow(row, rows, frontMinHeight, backMinHeight);
  const maxH = maxHeightForRow(row, rows, frontMaxHeight, backMaxHeight);
  return height >= minH && height <= maxH;
}

export function prunePlantsByHeightRange(
  garden: GardenState,
  variants: PlantVariant[],
  designIntent: DesignIntent
) {
  const { frontMin, backMin, frontMax, backMax } = designIntent.height;
  const variantMap = new Map(variants.map((v) => [v.id, v] as const));
  return {
    ...garden,
    cells: garden.cells.map((cell) => {
      if (!cell.plant || cell.plant === "empty") return cell;
      const variant = variantMap.get(cell.plant);
      if (!variant) return { ...cell, plant: "empty" };
      if (
        !heightFitsRow(
          variant.baseHeight,
          cell.row,
          garden.rows,
          frontMin,
          backMin,
          frontMax,
          backMax
        )
      ) {
        return { ...cell, plant: "empty" };
      }
      return cell;
    }),
  };
}

export function prunePlantsByZone(garden: GardenState, variants: PlantVariant[]) {
  const variantMap = new Map(variants.map((v) => [v.id, v] as const));
  return {
    ...garden,
    cells: garden.cells.map((cell) => {
      if (!cell.plant || cell.plant === "empty") return cell;
      const variant = variantMap.get(cell.plant);
      if (!variant) return { ...cell, plant: "empty" };
      return plantSupportsZone(variant, garden.zone) ? cell : { ...cell, plant: "empty" };
    }),
  };
}

export function prunePlantsByDensityTargets(
  garden: GardenState,
  variants: PlantVariant[],
  designIntent: DesignIntent,
  preferredBand?: DensityBand
) {
  const { front, middle, back } = designIntent.density;
  const variantMap = new Map(variants.map((v) => [v.id, v] as const));
  const targetByBand: BandCounts = {
    front: clamp01(front),
    middle: clamp01(middle),
    back: clamp01(back),
  };
  const totalByBand = totalCellsByBand(garden.rows, garden.cols);
  const maxByBand: BandCounts = {
    front: Math.floor(totalByBand.front * targetByBand.front),
    middle: Math.floor(totalByBand.middle * targetByBand.middle),
    back: Math.floor(totalByBand.back * targetByBand.back),
  };

  const anchors = garden.cells
    .filter((cell) => cell.plant && cell.plant !== "empty")
    .map((cell) => {
      const variant = variantMap.get(cell.plant);
      if (!variant) return null;
      const fp = (variant.footprint ?? [1, 1]) as [number, number];
      return {
        row: cell.row,
        col: cell.col,
        id: cell.plant,
        counts: footprintBandCounts({ r: cell.row, c: cell.col }, fp, garden.rows),
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);

  const usedByBand = emptyBandCounts();
  for (const anchor of anchors) addBandCounts(usedByBand, anchor.counts);

  const next: GardenState = {
    ...garden,
    cells: garden.cells.map((cell) => ({ ...cell })),
  };

  while (
    usedByBand.front > maxByBand.front ||
    usedByBand.middle > maxByBand.middle ||
    usedByBand.back > maxByBand.back
  ) {
    const overByBand: BandCounts = {
      front: usedByBand.front - maxByBand.front,
      middle: usedByBand.middle - maxByBand.middle,
      back: usedByBand.back - maxByBand.back,
    };
    const band =
      preferredBand && overByBand[preferredBand] > 0
        ? preferredBand
        : (["front", "middle", "back"] as DensityBand[]).reduce((best, current) =>
            overByBand[current] > overByBand[best] ? current : best
          );
    if (overByBand[band] <= 0) break;

    let chosenIndex = -1;
    let chosenScore = -1;
    for (let i = 0; i < anchors.length; i++) {
      const candidate = anchors[i];
      if (candidate.counts[band] <= 0) continue;
      const score =
        candidate.counts[band] * 1000 +
        candidate.counts.front +
        candidate.counts.middle +
        candidate.counts.back;
      if (score > chosenScore || (score === chosenScore && Math.random() < 0.5)) {
        chosenScore = score;
        chosenIndex = i;
      }
    }
    if (chosenIndex < 0) break;

    const [removed] = anchors.splice(chosenIndex, 1);
    usedByBand.front -= removed.counts.front;
    usedByBand.middle -= removed.counts.middle;
    usedByBand.back -= removed.counts.back;

    const cell = next.cells.find((item) => item.row === removed.row && item.col === removed.col);
    if (cell) cell.plant = "empty";
  }

  return next;
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

function emptyBandCounts(): BandCounts {
  return { front: 0, middle: 0, back: 0 };
}

function rowBand(row: number, rows: number): DensityBand {
  if (rows <= 1) return "front";
  const t = clamp01(row / (rows - 1));
  if (t < 1 / 3) return "back";
  if (t < 2 / 3) return "middle";
  return "front";
}

function totalCellsByBand(rows: number, cols: number): BandCounts {
  const counts = emptyBandCounts();
  for (let r = 0; r < rows; r++) counts[rowBand(r, rows)] += cols;
  return counts;
}

function footprintBandCounts(anchor: { r: number; c: number }, fp: [number, number], rows: number): BandCounts {
  const counts = emptyBandCounts();
  for (const cell of footprintCells(anchor, fp)) {
    if (cell.r < 0 || cell.r >= rows) continue;
    counts[rowBand(cell.r, rows)] += 1;
  }
  return counts;
}

function addBandCounts(target: BandCounts, added: BandCounts) {
  target.front += added.front;
  target.middle += added.middle;
  target.back += added.back;
}

function bandTargetsMet(used: BandCounts, total: BandCounts, target: BandCounts) {
  return (
    used.front >= Math.floor(total.front * target.front) &&
    used.middle >= Math.floor(total.middle * target.middle) &&
    used.back >= Math.floor(total.back * target.back)
  );
}

function densityFactor(
  current: BandCounts,
  added: BandCounts,
  total: BandCounts,
  target: BandCounts
) {
  let factor = 1;
  for (const band of ["front", "middle", "back"] as DensityBand[]) {
    if (added[band] <= 0) continue;
    const totalCells = Math.max(1, total[band]);
    const nextRatio = (current[band] + added[band]) / totalCells;
    const targetRatio = clamp01(target[band]);
    if (nextRatio <= targetRatio) {
      factor *= 1 + (targetRatio - nextRatio) * 0.8;
    } else {
      const overflow = nextRatio - targetRatio;
      factor *= Math.max(0.05, 1 - overflow * 3);
    }
  }
  return factor;
}

export function relativeHeightFactor(
  candidate: PlantVariant,
  candidateRow: number,
  candidateCol: number,
  placed: Placed[],
  variantMap: Map<string, PlantVariant>,
  heightGradientStrength = 1
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
    //console.log("deltaCol",deltaCol,"rowDistance",rowDistance)
    if (rowDistance === 0 && deltaCol === 0) continue;

    const distanceWeight = 1 / (rowDistance +1);
    const heightDeltaRatio = (candidate.baseHeight - existingVariant.baseHeight)*Math.sign(deltaRow)/ Math.max((existingVariant.baseHeight+candidate.baseHeight)/2, 1);
    let severity = Math.min(1, (heightDeltaRatio+0.1) );
    
    const colWeight = 1 / (Math.abs(deltaCol) + 1);
    const strength = 1 + clamp01(heightGradientStrength) * 8;
    factor *= Math.min(1,Math.max(0.05, 1 - severity * distanceWeight * colWeight * strength));
    //console.log("severity",severity,"deltaRow",deltaRow,"deltaCol",deltaCol,"deltaHeight",heightDeltaRatio,"strength",strength,"factor",factor)
/*    if(deltaRow*heightDelta>=0){
      const severity = Math.max(Math.min(1, (Math.abs(heightDelta) / Math.max(existingVariant.baseHeight, 1)) * 1.2),0.1);
      const colWeight = 1 / (Math.abs(deltaCol) + 1);
      const strength = 1 + clamp01(heightGradientStrength) * 8;
      factor *= Math.min(1,Math.max(0.05, 1 - severity * distanceWeight * colWeight * strength));
      console.log("severity",severity,"deltaCol",deltaCol,"deltaHeight",Math.abs(heightDelta),"strength",strength,"factor",factor)
    }
*/    
  }

  return factor;
}

function pickWeighted(
  variants: PlantVariant[],
  seed: number,
  candidateRow: number,
  candidateCol: number,
  placed: Placed[],
  variantMap: Map<string, PlantVariant>,
  rows: number,
  gardenZone: number,
  frontMinHeight: number,
  backMinHeight: number,
  frontMaxHeight: number,
  backMaxHeight: number,
  heightGradientStrength: number,
  symmetryStrength: number,
  clusteriness: number,
  occupiedByBand: BandCounts,
  totalByBand: BandCounts,
  targetByBand: BandCounts,
  cols: number
) {
  if (variants.length === 0) return null;
  const weightedCandidates = variants.map((v, i) => {
    const zoneFactor = plantSupportsZone(v, gardenZone) ? 1 : 0;
    const heightFactor = heightFitsRow(
      v.baseHeight,
      candidateRow,
      rows,
      frontMinHeight,
      backMinHeight,
      frontMaxHeight,
      backMaxHeight
    )
      ? 1
      : 0;
    const fp = (v.footprint ?? [1, 1]) as [number, number];
    const addedByBand = footprintBandCounts({ r: candidateRow, c: candidateCol }, fp, rows);
    const bandDensityFactor = densityFactor(occupiedByBand, addedByBand, totalByBand, targetByBand);
    const placementFactor = relativeHeightFactor(
      v,
      candidateRow,
      candidateCol,
      placed,
      variantMap,
      heightGradientStrength
    );
    const clusterinessFactor = clusterFactor(
      v,
      candidateRow,
      candidateCol,
      placed,
      variantMap,
      clusteriness
    );
    const mirrorFactor = symmetryFactor(v, candidateRow, candidateCol, cols, rows, placed, symmetryStrength,variantMap);
    const base = 1 + ((i % 5) * 0.03);
    return {
      variant: v,
      heightFactor: heightFactor * zoneFactor,
      bandDensityFactor,
      placementFactor,
      clusterinessFactor,
      mirrorFactor,
      weight:
        base *
        placementFactor *
        heightFactor *
        zoneFactor *
        bandDensityFactor *
        clusterinessFactor *
        mirrorFactor,
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
        clusterinessFactor: Number(chosen.clusterinessFactor.toFixed(4)),
        mirrorFactor: Number(chosen.mirrorFactor.toFixed(4)),
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
    clusterinessFactor: Number(fallback.clusterinessFactor.toFixed(4)),
    mirrorFactor: Number(fallback.mirrorFactor.toFixed(4)),
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
  const gardenZone = base.zone;
  const designIntent = options.designIntent;
  const frontMinHeight = designIntent?.height.frontMin ?? 0;
  const backMinHeight = designIntent?.height.backMin ?? 0;
  const frontMaxHeight = designIntent?.height.frontMax ?? 200;
  const backMaxHeight = designIntent?.height.backMax ?? 200;
  const heightGradientStrength = designIntent?.height.gradientStrength ?? 1;
  const symmetryStrength = designIntent?.layout.symmetry ?? 0;
  const clusteriness = designIntent?.layout.clusteriness ?? 0.35;
  const total = rows * cols;
  const targetCoverage = clamp01(options.targetCoverage ?? 0.62);
  const targetOccupiedCells = Math.max(1, Math.floor(total * targetCoverage));
  const targetByBand: BandCounts = {
    front: clamp01(designIntent?.density.front ?? targetCoverage),
    middle: clamp01(designIntent?.density.middle ?? targetCoverage),
    back: clamp01(designIntent?.density.back ?? targetCoverage),
  };
  const totalByBand = totalCellsByBand(rows, cols);

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
  const remainingPositions = makeShuffled(positions, seed);

  const placed: Placed[] = [];
  let used = 0;
  const occupiedByBand = emptyBandCounts();

  for (const cell of next.cells) {
    if (!cell.plant || cell.plant === "empty") continue;
    const existingVariant = variantMap.get(cell.plant);
    if (
      existingVariant &&
      !heightFitsRow(
        existingVariant.baseHeight,
        cell.row,
        rows,
        frontMinHeight,
        backMinHeight,
        frontMaxHeight,
        backMaxHeight
      )
    ) {
      continue;
    }
    const fp = (variantMap.get(cell.plant)?.footprint ?? [1, 1]) as [number, number];
    if (!canPlaceFootprint(occupied, rows, cols, { r: cell.row, c: cell.col }, fp)) continue;
    markFootprint(occupied, { r: cell.row, c: cell.col }, fp);
    used += fp[0] * fp[1];
    addBandCounts(occupiedByBand, footprintBandCounts({ r: cell.row, c: cell.col }, fp, rows));
    placed.push({ r: cell.row, c: cell.col, id: cell.plant });
  }

  let pickCount = 0;
  while (
    remainingPositions.length > 0 &&
    used < targetOccupiedCells &&
    !bandTargetsMet(occupiedByBand, totalByBand, targetByBand)
  ) {
    const positionIndex = pickWeightedPosition(
      remainingPositions,
      seed + pickCount * 97,
      cols,
      rows,
      placed,
      symmetryStrength,
      variantMap
    );
    pickCount += 1;
    if (positionIndex < 0) break;
    const [{ r, c }] = remainingPositions.splice(positionIndex, 1);
    if (occupied[r][c]) continue;

    const chosen = pickWeighted(
      variants,
      seed + r * 131 + c * 17,
      r,
      c,
      placed,
      variantMap,
      rows,
      gardenZone,
      frontMinHeight,
      backMinHeight,
      frontMaxHeight,
      backMaxHeight,
      heightGradientStrength,
      symmetryStrength,
      clusteriness,
      occupiedByBand,
      totalByBand,
      targetByBand,
      cols
    );
    if (!chosen) break;
    const fp = (chosen.footprint ?? [1, 1]) as [number, number];

    if (!canPlaceFootprint(occupied, rows, cols, { r, c }, fp)) continue;
    markFootprint(occupied, { r, c }, fp);
    used += fp[0] * fp[1];
    addBandCounts(occupiedByBand, footprintBandCounts({ r, c }, fp, rows));
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
