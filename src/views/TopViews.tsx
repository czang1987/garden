import { useEffect, useRef, useState, useMemo } from "react";
import * as PIXI from "pixi.js";
import { resizeGarden,GardenState,printGarden } from "../store/garden";
import PlantCatalog from "../components/PlantCatalog";
import type { PlantCatalogData, PlantCategory, PlantVariant } from "../type/plants";
import { generateAutoLayout, scoreLayout } from "../utils/layoutEngine";



const CELL_SIZE = 100;

type Cell = { plant: string | null };

function buildLockGrid(garden: GardenState, variants: PlantVariant[]) {
  const out = Array.from({ length: garden.rows }, () =>
    Array.from({ length: garden.cols }, () => false)
  );
  const variantMap = new Map(variants.map((v) => [v.id, v] as const));

  for (const cell of garden.cells) {
    if (!cell.plant || cell.plant === "empty") continue;
    const fp = (variantMap.get(cell.plant)?.footprint ?? [1, 1]) as [number, number];
    for (let dr = 0; dr < fp[0]; dr++) {
      for (let dc = 0; dc < fp[1]; dc++) {
        const rr = cell.row + dr;
        const cc = cell.col + dc;
        if (rr >= 0 && rr < garden.rows && cc >= 0 && cc < garden.cols) {
          out[rr][cc] = true;
        }
      }
    }
  }

  return out;
}


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
  const drawVersionRef = useRef(0);
  const [rowsInput, setRowsInput] = useState(garden.rows);
  const [colsInput, setColsInput] = useState(garden.cols);  
  type RC = { r: number; c: number };
  //const [selectedCells, setSelectedCells] = useState<RC[]>([]);  
  // ✅ 动态植物列表（来自配置文件）
  
  const [categories, setCategories] = useState<PlantCategory[]>([]);
  

  useEffect(() => {
    fetch("/assets/plants/index.json")
      .then(r => r.json())
      .then((data: PlantCatalogData) => setCategories(data.categories ?? []));
  }, []);
  const allVariants = useMemo(() => {
    const out: PlantVariant[] = [];
      for (const cat of categories) {
        out.push(...cat.variants);
      }
      return out;
    }, [categories]);

  const layoutScore = useMemo(() => scoreLayout(garden, allVariants), [garden, allVariants]);

 // garden 外部变化时同步输入框
  useEffect(() => {
    
    setRowsInput(garden.rows);
    setColsInput(garden.cols);
   
  }, [garden.rows, garden.cols]);
  

  const occupancy = useMemo(() => buildLockGrid(garden, allVariants), [garden, allVariants]);
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

  function inBounds(garden: GardenState, rr:number,cc:number) {
    return rr >= 0 && rr < garden.rows && cc >= 0 && cc < garden.cols;
  }

  // 如果你有 lock[][]，用这个；如果没有，就用 garden.cells 判断是否已占用
  function cellOccupied(r: number, c: number) {
    return !!occupancy[r]?.[c];
  //  return false;
  }

  function canSelectVariant(v: PlantVariant) {
    if (!selectedCell) return false;

    const fp = (v.footprint ?? [1, 1]) as [number, number];
    const [h, w] = fp;
    console.log(h,w);

    // 以 selectedCell 作为 anchor（左上角）
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        const rr = selectedCell.r + dr;
        const cc = selectedCell.c + dc;
        console.log(rr,cc,garden.rows,garden.cols)
        if (!inBounds(garden,rr, cc)){
          console.log("not inBounds");
          return false; 
        }        // ✅ 边缘越界禁用
        if (cellOccupied(rr, cc)) return false;     // ✅ 被占用禁用
      }
    }
    return true;
}

function disabledReason(v: PlantVariant) {
  if (!selectedCell) return "请先选中一个格子";

  const fp = (v.footprint ?? [1, 1]) as [number, number];
  const [h, w] = fp;

  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) {
      const rr = selectedCell.r + dr;
      const cc = selectedCell.c + dc;

      if (!inBounds(garden,rr, cc)) return "边缘位置放不下";
      if (cellOccupied(rr, cc)) return "目标格已被占用";
    }
  }
  return null;
}


  
  useEffect(() => {
  const app = appRef.current;
  if (!app) return;

  app.renderer.resize(garden.cols * CELL_SIZE, garden.rows * CELL_SIZE);
}, [garden.rows, garden.cols]);

  const applySize = () => {
    const next = resizeGarden(garden, rowsInput, colsInput);
    onChange(next);
  };

  const autoGenerate = () => {
    const next = generateAutoLayout(garden, allVariants, { targetCoverage: 0.62 });
    onChange(next);
    setSelectedCell(null);
  };

  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);

 
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
  const drawVersion = ++drawVersionRef.current;

  layer.removeChildren();

  for (let r = 0; r < garden.rows; r++) {
    for (let c = 0; c < garden.cols; c++) {
      const cell = getCell(garden, r, c) ?? { row: r, col: c, plant: "empty" };
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
        if (drawVersion !== drawVersionRef.current) return;

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
function getCell(next: GardenState, r: number, c: number) {
  return next.cells.find((x) => x.row === r && x.col === c) ?? null;
}

  /* ================= select plant ================= */
const choosePlant = (plantId: string | null) => {
  if (!selectedCell) return;
  

  const next = structuredClone(garden); // ✅ 先复制

  const target = getCell(next,selectedCell.r,selectedCell.c);
  if(target==null) return;
  if(plantId==null){
    console.log("plant empty");
    plantId="empty";
  } 
 

  if(target.plant==plantId){//same plant, do nothing
    setSelectedCell(null);
    return;
  }
  
  

  
  if(target.plant!='empty'){//remove old plant
    const variant = allVariants.find((v) => v.id === target.plant);

    const fp: [number, number] = (variant?.footprint ?? [1, 1]) as [number, number];
    
    const cells = footprintCells({ r: selectedCell.r, c: selectedCell.c }, fp);
    for(const rc of cells){
      const cell = getCell(next,rc.r,rc.c); 
      
      if(cell==null) continue;
      cell.plant='empty';
    }
  } 

  if( plantId!=='empty'){//place new plant
    const variant = allVariants.find((v) => v.id === plantId);
    
    const fp: [number, number] = (variant?.footprint ?? [1, 1]) as [number, number];
    const cells = footprintCells({ r: selectedCell.r, c: selectedCell.c }, fp);
    for(const rc of cells){
      const cell = getCell(next,rc.r,rc.c);
      if(cell==null) continue;
      cell.plant="empty";//temporarily set to empty to avoid blocking itself
    }
    
    
    target.plant=plantId;
    printGarden(next);
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
      <button onClick={autoGenerate} disabled={allVariants.length === 0}>
        自动生成布局
      </button>
      <div
        style={{
          marginLeft: 12,
          padding: "6px 10px",
          border: "1px solid #ddd",
          borderRadius: 8,
          background: "#fafafa",
          minWidth: 220,
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 700 }}>布局评分: {layoutScore.total}/100</div>
        <div>覆盖度: {layoutScore.breakdown.coverage}</div>
        <div>多样性: {layoutScore.breakdown.diversity}</div>
        <div>当季花期: {layoutScore.breakdown.seasonalBloom}</div>
        <div>维护成本: {layoutScore.breakdown.maintenance}</div>
        <div>邻接关系: {layoutScore.breakdown.adjacency}</div>
      </div>
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

        {allVariants.length === 0 ? (
          <div style={{ fontSize: 12, color: "#999" }}>
            正在加载 plants/index.json...
          </div>
        ) : (
          <PlantCatalog
            categories={categories}
            hasSelection={!!selectedCell}
            onClear={() => choosePlant(null)}
            canSelectVariant={canSelectVariant}
            disabledReason={disabledReason}
            onSelectVariant={(v) => choosePlant(v.id)} // ✅ 用 variant.id
          />
          )}
      </div>
    </div>
  </>
);


  
}
