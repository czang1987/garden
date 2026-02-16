import { useEffect, useRef, useState,useMemo } from "react";
import * as PIXI from "pixi.js";
import type { PlantCatalogData, PlantCategory, PlantVariant } from "../type/plants";

/** 你项目里的 GardenState 只要对齐这些字段即可 */
export type Season = "spring" | "summer" | "autumn" | "winter";
export type Cell = { row: number; col: number; plant: string | null };
export type GardenState = {
  rows: number;
  cols: number;
  season: Season;
  cells: Cell[];
};



const textureCache: Record<string, PIXI.Texture> = {};

/** 你的资源路径规则 */
function plantSeasonPath(plant: string, season: Season) {
  return `/assets/plants/${plant}/${season}.png`;
}
function plantIconPath(plant: string) {
  return `/assets/plants/${plant}/icon.png`;
}
function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return Math.abs(x - Math.floor(x));
}


/** 先尝试 season.png，不存在就 fallback icon.png（并缓存） */
async function loadPlantTexture(plant: string, season: Season) {
  console.log(plant)
  const key = `${plant}__${season}`;
  if (textureCache[key]) return textureCache[key];

  const seasonUrl = plantSeasonPath(plant, season);
  const iconUrl = plantIconPath(plant);

  try {
    const tex = await PIXI.Assets.load(seasonUrl);
    textureCache[key] = tex;
    return tex;
  } catch {
    const iconKey = `${plant}__icon`;
    if (!textureCache[iconKey]) {
      const tex2 = await PIXI.Assets.load(iconUrl);
      textureCache[iconKey] = tex2;
    }
    textureCache[key] = textureCache[iconKey];
    return textureCache[key];
  }
}

/** 保持比例塞进指定框（contain） */
function fitSpriteContain(sprite: PIXI.Sprite, maxW: number, maxH: number) {
  const tw = sprite.texture.width;
  const th = sprite.texture.height;
  if (!tw || !th) return;

  const s = Math.min(maxW / tw, maxH / th);
  sprite.scale.set(s);
}

function fitSpriteByHeight(sprite: PIXI.Sprite, targetH: number) {
  const texH = sprite.texture.height;
  if (!texH) return;
  const scale = targetH / texH*randFloat(0.95, 1.05);
  sprite.scale.set(scale);
}


export function FrontView({ garden }: { garden: GardenState }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const sceneRef = useRef<PIXI.Container | null>(null);

  const [ready, setReady] = useState(false);
  const [variantMap, setVariantMap] = useState<Map<string, PlantVariant>>(new Map());

  useEffect(() => {
    fetch("/assets/plants/index.json")
      .then((r) => r.json())
      .then((data: PlantCatalogData) => {
        const map = new Map<string, PlantVariant>();
        for (const cat of data.categories ?? []) {
          for (const v of cat.variants ?? []) {
            map.set(v.id, v);
          }
        }
        setVariantMap(map);
      });
  }, []);

  /** init Pixi once */
  useEffect(() => {
    let alive = true;

    (async () => {
    
      const app = new PIXI.Application();
      await app.init({
        width: 760,
        height: 520,
        background: 0x9b6a3d, // 天空淡蓝
      });
      if (!alive) return;

      // mount canvas
      mountRef.current?.appendChild(app.canvas);

      // scene
      const scene = new PIXI.Container();
      scene.sortableChildren = true;
      app.stage.addChild(scene);

      // 保险：让交互更稳定（可选）
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      appRef.current = app;
      sceneRef.current = scene;

      setReady(true);
    })();

    return () => {
      alive = false;
      appRef.current?.destroy(true);
      appRef.current = null;
      sceneRef.current = null;
      setReady(false);
    };
  }, []);

  /** re-render when garden changes */
  useEffect(() => {
    console.log("line 142 is working")
    if (!ready) return;
    console.log("line 144 is working")
    const scene = sceneRef.current;
    if (!scene) return;
    console.log("line 147 is working")
    if (variantMap.size === 0) return;
    console.log("line 149 is working")
    // 注意：renderGarden 是 async，但我们不阻塞 UI
    void renderGarden(scene, garden,variantMap);
  }, [ready, garden,variantMap]);
  
  return (
  <div>
    {/* 导出按钮 */}
    <button
      style={{ marginBottom: 8 }}
      onClick={() => {
        const app = appRef.current;
        const scene = sceneRef.current;
        if (!app || !scene) return;

        downloadContainerPNG(app, scene, "frontview.png");
      }}
    >
      导出 FrontView 图片
    </button>

    {/* Pixi canvas 挂载点 */}
    <div ref={mountRef} />
  </div>)
}
function downloadContainerPNG(
  app: PIXI.Application,
  container: PIXI.Container,
  filename: string
) {
  const canvas = app.renderer.extract.canvas(container);
  const url = canvas.toDataURL("image/png");

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/** 正面视角渲染（不画菱形） */
async function renderGarden(scene: PIXI.Container, garden: GardenState, variantMap: Map<string, PlantVariant>) {
  scene.removeChildren();

  // ===== 你可以调的布局参数（决定“正面”构图）=====
  const BASE_X = 140;     // 花园左边距
  const BASE_Y = 120;     // 花园顶部
  const COL_GAP = 110;    // 每列间距（越大越松）
  const ROW_GAP = 85;     // 每行间距（越大越“深”）
  const ICON_MAX_W = 80;  // 植物最大宽
  const ICON_MAX_H = 110; // 植物最大高
  const DEPTH_K = 0.12;   // 前后放大系数（row 越大越靠前）

  
 
  
  // ===== 画 empty 的土壤块（brown）=====
  const SOIL_W = 90;
  const SOIL_H = 30;
  const SOIL_COLOR = 0x9b6a3d; // brown

  for (const cell of garden.cells) {
  //  if (cell.plant !== null ||cell.plant=='empty') continue;

    const soil = new PIXI.Graphics();

    // 正面坐标（和植物用同一套）
    const x = BASE_X + cell.col * COL_GAP;
    const y = BASE_Y + cell.row * ROW_GAP;

    // 土块是一个扁平的矩形
    soil
      .rect(x , y , COL_GAP, ROW_GAP)
      .fill({ color: SOIL_COLOR });

    // 越靠前越“压住”后排
    soil.zIndex = cell.row * 100;

    scene.addChild(soil);
  }


  // 并行预加载纹理（同一种植物会出现多次）
  const plantCells = garden.cells.filter((c) => c.plant);
  const uniqPlants = Array.from(new Set(plantCells.map((c) => c.plant!)));
  await Promise.all(uniqPlants.map((p) => loadPlantTexture(p, garden.season)));

  // 逐格创建 sprite
  for (const cell of plantCells) {
    const plant = cell.plant!;
    if(plant=='empty'){continue;}
    console.log("found plant",cell.plant)
    const tex = await loadPlantTexture(plant, garden.season);

    const sprite = new PIXI.Sprite(tex);

    // 底部对齐：像“站在地面上”
    sprite.anchor.set(0.5, 1);

    // 正面坐标：列决定 x，行决定 y
    const seed=cell.row * 1000 + cell.col * 13;
    const x = BASE_X + (cell.col+seededRandom(seed)-0.5) * COL_GAP;
    const y = BASE_Y + (cell.row+seededRandom(seed+1)) * ROW_GAP;
    console.log(seededRandom(seed))
    sprite.position.set(x, y);

    // 先 fit 到框里（保持比例）
    const meta = variantMap.get(plant);
    const baseHeight = meta?.baseHeight ?? 70;

    fitSpriteByHeight(sprite, baseHeight);

    //fitSpriteContain(sprite, ICON_MAX_W, ICON_MAX_H);

    // 再做前后深度：row 越大越靠前越大
    const depth = 1 + cell.row * DEPTH_K;
    sprite.scale.set(sprite.scale.x * depth, sprite.scale.y * depth);

    // 遮挡顺序：row 大的在前（盖住后排）
    sprite.zIndex = cell.row * 100 + cell.col;

    scene.addChild(sprite);
  }

  scene.sortChildren();
}
