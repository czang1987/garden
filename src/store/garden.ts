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
}

export function createGarden(rows = 20, cols = 20): GardenState {
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
    season: 'spring',
  }
}

//打印garden每个cell的植物
export function printGarden(garden: GardenState): void{
  for(let r=0;r<garden.rows;r++){
    for(let c=0;c<garden.cols;c++){
      console.log(r,c,garden.cells[r*garden.cols+c].plant);

    }

  }

}

export function resizeGarden(prev: GardenState, newRows: number, newCols: number): GardenState {
  // 防御：最小 1×1
  const rows = Math.max(1, Math.floor(newRows));
  const cols = Math.max(1, Math.floor(newCols));

  // 旧数据做索引： "r,c" -> plant
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
    season: prev.season, // 保留季节
    cells,
  };
}
