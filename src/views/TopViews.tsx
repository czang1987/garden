import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { resizeGarden } from "../store/garden";

const GRID_SIZE = 5;
const CELL_SIZE = 100;

type Cell = { plant: string | null };
type PlantMeta = { name: string; icon: string };

export default function TopView({
  garden,
  onChange,
}: {
  garden: GardenState;
  onChange: (next: GardenState) => void;
}) {

  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const gridLayerRef = useRef<PIXI.Container | null>(null);
  const [rowsInput, setRowsInput] = useState(garden.rows);
  const [colsInput, setColsInput] = useState(garden.cols);  
  type RC = { r: number; c: number };
  //const [selectedCells, setSelectedCells] = useState<RC[]>([]);  
  // ✅ 动态植物列表（来自配置文件）
  const [plants, setPlants] = useState<PlantMeta[]>([]);
 // garden 外部变化时同步输入框
  useEffect(() => {
    
    setRowsInput(garden.rows);
    setColsInput(garden.cols);
   
  }, [garden.rows, garden.cols]);
  

  const [lock, setLock] = useState<boolean[][]>(() =>
    Array.from({ length: garden.rows }, () =>
      Array.from({ length: garden.cols }, () => false)
    )
  );
  function footprintCells(
    anchor: RC,
    fp: [number, number] // [h,w]
  ): RC[] {
    const [h, w] = fp;
    const cells: RC[] = [];
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        cells.push({ r: anchor.r + dr, c: anchor.c + dc });
      }
    }
    return cells;
  }

  function inBounds(garden: GardenState, rc: RC) {
    return rc.r >= 0 && rc.r < garden.rows && rc.c >= 0 && rc.c < garden.cols;
  }

  // 如果你有 lock[][]，用这个；如果没有，就用 garden.cells 判断是否已占用
  function isOccupied( rc: RC) {
    return lock[rc.r][rc.c];
   
  }

  function canPlacePlantAtSelected(plantName: string) {
    if (!selectedCell) return false;

    const meta = plants.find(p => p.name === plantName);
    const fp: [number, number] = (meta?.footprint ?? [1, 1]) as [number, number];

    const targets = footprintCells({ r: selectedCell.r, c: selectedCell.c }, fp);

    // ① 边界检查：任何一个 target 越界就不允许（边缘格会在这里被禁用）
    if (!targets.every(rc => inBounds(garden, rc))) return false;

    // ② 占用检查：任何一个 target 已占用就不允许
      if (!targets.every(rc => !isOccupied(rc))) return false;
    //if (!targets.every(rc => !isOccupied(garden, rc))) return false;

    return true;
  }
  

  
  useEffect(() => {
  const app = appRef.current;
  if (!app) return;

  app.renderer.resize(garden.cols * CELL_SIZE, garden.rows * CELL_SIZE);
  setLock(
    Array.from({ length: garden.rows }, () =>
      Array.from({ length: garden.cols }, () => false)
    )
  );
}, [garden.rows, garden.cols]);

  const applySize = () => {
    const next = resizeGarden(garden, rowsInput, colsInput);
    onChange(next);
  };

  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);

  /* ============ load plants from config ============ */
  useEffect(() => {
    (async () => {
      const res = await fetch("/assets/plants/index.json");
      const data = (await res.json()) as { plants: PlantMeta[] };
      setPlants(data.plants ?? []);
    })();
  }, []);

  /* ================= Pixi init ================= */
  useEffect(() => {
    let alive = true;

    const init = async () => {
      const app = new PIXI.Application();
      await app.init({
        width: garden.cols * CELL_SIZE,
        height: garden.rows * CELL_SIZE,
        background: "#eef3ea",
      });

      if (!alive) return;

      appRef.current = app;

      const gridLayer = new PIXI.Container();
      gridLayerRef.current = gridLayer;
      app.stage.addChild(gridLayer);

      containerRef.current?.appendChild(app.canvas);

      // 第一次画
      await drawGrid();
    };

    init();

    return () => {
      alive = false;
      appRef.current?.destroy(true);
      appRef.current = null;
      gridLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ============ redraw when grid / selected changes ============ */
  useEffect(() => {
    // 只要 grid 或 selectedCell 变，就重画（高亮会同步）
    drawGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garden, selectedCell]);
  
  /* ================= draw grid ================= */
 const drawGrid = async () => {
  const layer = gridLayerRef.current;
  if (!layer) return;

  layer.removeChildren();

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = garden.cells[r*garden.rows+c];
      const isSelected =
        selectedCell?.r === r && selectedCell?.c === c;

      /* ===== 1. 画格子底色 ===== */
      const g = new PIXI.Graphics();
      console.log(cell);



      // 背景色逻辑
      if (cell.plant && cell.plant!='empty') {
        // 已种植物：白底（植物会覆盖）
        g.rect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE)
         .fill({ color: 0xffffff });
      } else if (isSelected) {
        // 选中但没植物：蓝色
        g.rect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE)
         .fill({ color: 0xe6f0ff });
      } else {
        // 普通空格
        g.rect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE)
         .fill({ color: 0xffffff });
      }

      // 边框
      g.stroke({
        color: isSelected ? 0x2b6cff : 0x999999,
        width: isSelected ? 3 : 1,
      });

      /* ===== 2. 交互 ===== */
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointerdown", () => {
        setSelectedCell({ r, c });
      });
      //g.on("pointerdown", () => toggleCell(r, c));

      layer.addChild(g);

      /* ===== 3. 如果有植物，画植物 icon ===== */
      if (cell.plant && cell.plant!='empty') {
        const texture = await PIXI.Assets.load(
          `/assets/plants/${cell.plant}/icon.png`
        );

        const sprite = new PIXI.Sprite(texture);
        sprite.width = 64;
        sprite.height = 64;
        sprite.anchor.set(0.5);
        sprite.x = c * CELL_SIZE + CELL_SIZE / 2;
        sprite.y = r * CELL_SIZE + CELL_SIZE / 2;

        layer.addChild(sprite);
      }
    }
  }
};


  /* ================= select plant ================= */
const choosePlant = (plant: string | null) => {
  if (!selectedCell) return;

  const next = structuredClone(garden); // ✅ 先复制

  const target = next.cells.find(
    (cell) => cell.row === selectedCell.r && cell.col === selectedCell.c
  );

  if(target.plant==plant){//same plant, do nothing
    setSelectedCell(null);
    return;
  }
  

  
  if(target.plant!='empty'){//remove old plant
    const meta = plants.find(p => p.name === plant);
    const fp: [number, number] = (meta?.footprint ?? [1, 1]) as [number, number];
    const cells = footprintCells({ r: selectedCell.r, c: selectedCell.c }, fp);
    for(const rc of cells){
      const cell = next.cells.find(x => x.row === rc.r && x.col === rc.c);  
      lock[rc.r][rc.c]=false;
      cell.plant='empty';
    }
  } 

  if( plant!=='empty'){//place new plant
    const meta = plants.find(p => p.name === plant);
    const fp: [number, number] = (meta?.footprint ?? [1, 1]) as [number, number];
    const cells = footprintCells({ r: selectedCell.r, c: selectedCell.c }, fp);
    for(const rc of cells){
      const cell = next.cells.find(x => x.row === rc.r && x.col === rc.c);  
      lock[rc.r][rc.c]=true;
      cell.plant="empty";//temporarily set to empty to avoid blocking itself
    }
    target.plant=plant;
  } 


  onChange(next);
  setSelectedCell(null);
};
return (
  <>
    {/* ✅ 花园尺寸编辑条 */}
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
      <label>
        Rows:
        <input
          type="number"
          min={1}
          value={rowsInput}
          onChange={(e) => setRowsInput(Number(e.target.value))}
          style={{ width: 70, marginLeft: 6 }}
        />
      </label>

      <label>
        Cols:
        <input
          type="number"
          min={1}
          value={colsInput}
          onChange={(e) => setColsInput(Number(e.target.value))}
          style={{ width: 70, marginLeft: 6 }}
        />
      </label>

      <button onClick={applySize}>应用</button>
    </div>

    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* Pixi canvas */}
      <div>
        <div ref={containerRef} />
        <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
          点击格子选中（蓝框）→ 右侧选择植物
        </div>
      </div>

      {/* plant selector */}
      <div style={{ minWidth: 180 }}>
        <h4 style={{ margin: "0 0 8px 0" }}>选择植物</h4>

        <button
          onClick={() => choosePlant(null)}
          disabled={!selectedCell}
          style={{
            width: "100%",
            marginBottom: 10,
            padding: "6px 8px",
            cursor: selectedCell ? "pointer" : "not-allowed",
          }}
        >
          清空（empty）
        </button>

        {plants.length === 0 ? (
          <div style={{ fontSize: 12, color: "#999" }}>
            正在加载 plants/index.json...
          </div>
        ) : (
          plants.map((p) => (
            <button
              key={p.name}
              onClick={() => choosePlant(p.name)}
              disabled={!canPlacePlantAtSelected(p.name)}
              style={{
                opacity: canPlacePlantAtSelected(p.name) ? 1 : 0.4,
                cursor: canPlacePlantAtSelected(p.name) ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                width: "100%",
                marginBottom: 8,
                padding: "6px 8px"
               
              }}
            >
              <img
                src={p.icon}
                width={32}
                height={32}
                style={{ marginRight: 8, objectFit: "contain" }}
              />
              {p.name}
            </button>
          ))
        )}
      </div>
    </div>
  </>
);


  
}
