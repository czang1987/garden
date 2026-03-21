export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Plant = 'empty' | 'hydrangea'

export interface Cell {
  row: number
  col: number
  plant: string
}

export interface GardenState {
  rows: number
  cols: number
  cells: Cell[]
  season: Season
  zone: number
}

export function createGarden(rows = 20, cols = 20, zone = 7): GardenState {
  const cells: Cell[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ row: r, col: c, plant: 'empty' })
    }
  }
  return {
    rows,
    cols,
    cells,
    season: 'summer',
    zone,
  }
}

//鎵撳嵃garden姣忎釜cell鐨勬鐗?
export function printGarden(garden: GardenState): void{
  for(let r=0;r<garden.rows;r++){
    for(let c=0;c<garden.cols;c++){
      console.log(r,c,garden.cells[r*garden.cols+c].plant);

    }

  }

}

export function resizeGarden(prev: GardenState, newRows: number, newCols: number): GardenState {
  // 闃插尽锛氭渶灏?1脳1
  const rows = Math.max(1, Math.floor(newRows));
  const cols = Math.max(1, Math.floor(newCols));

  // 鏃ф暟鎹仛绱㈠紩锛?"r,c" -> plant
  const key = (r: number, c: number) => `${r},${c}`;
  const oldMap = new Map<string, string>();
  for (const cell of prev.cells) {
    oldMap.set(key(cell.row, cell.col), cell.plant);
  }

  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Keep existing plant if present, otherwise initialize new cells as empty.
      const plant = oldMap.get(key(r, c)) ?? 'empty';
      cells.push({ row: r, col: c, plant });
    }
  }

  return {
    rows,
    cols,
    season: prev.season, // 淇濈暀瀛ｈ妭
    zone: prev.zone,
    cells,
  };
}

