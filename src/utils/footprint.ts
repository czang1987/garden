import type { GardenState } from "../store/garden";
import type { PlantVariant } from "../type/plants";

export type GridPoint = { r: number; c: number };

export function footprintCells(anchor: GridPoint, fp: [number, number]): GridPoint[] {
  const [h, w] = fp;
  const cells: GridPoint[] = [];
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) {
      cells.push({ r: anchor.r - dr, c: anchor.c + dc });
    }
  }
  return cells;
}

export function footprintBounds(anchor: GridPoint, fp: [number, number]) {
  const [h, w] = fp;
  return {
    top: anchor.r - h + 1,
    bottom: anchor.r,
    left: anchor.c,
    right: anchor.c + w - 1,
  };
}

export function footprintInBounds(rows: number, cols: number, anchor: GridPoint, fp: [number, number]) {
  const { top, bottom, left, right } = footprintBounds(anchor, fp);
  return top >= 0 && bottom < rows && left >= 0 && right < cols;
}

export function canPlaceFootprint(
  occupied: boolean[][],
  rows: number,
  cols: number,
  anchor: GridPoint,
  fp: [number, number]
) {
  if (!footprintInBounds(rows, cols, anchor, fp)) return false;
  for (const cell of footprintCells(anchor, fp)) {
    if (occupied[cell.r]?.[cell.c]) return false;
  }
  return true;
}

export function markFootprint(
  occupied: boolean[][],
  anchor: GridPoint,
  fp: [number, number],
  value = true
) {
  for (const cell of footprintCells(anchor, fp)) {
    if (occupied[cell.r]?.[cell.c] === undefined) continue;
    occupied[cell.r][cell.c] = value;
  }
}

export function buildOccupancyGrid(garden: GardenState, variants: PlantVariant[]) {
  const out = Array.from({ length: garden.rows }, () => Array.from({ length: garden.cols }, () => false));
  const variantMap = new Map(variants.map((v) => [v.id, v] as const));

  for (const cell of garden.cells) {
    if (!cell.plant || cell.plant === "empty") continue;
    const fp = (variantMap.get(cell.plant)?.footprint ?? [1, 1]) as [number, number];
    markFootprint(out, { r: cell.row, c: cell.col }, fp, true);
  }

  return out;
}
