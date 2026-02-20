import { useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { GardenState } from "../store/garden";

// ===== 你的常量 =====
const BASE_X = 140;
const BASE_Y = 120;
const COL_GAP = 110;
const ROW_GAP = 85;

// 砖圈厚度
const FRAME = 18;

// 轻景深（你可以微调）
const DEPTH_K = 0.1;

type PlantVariant = {
  id: string;
  name: string;
  icon: string;
  baseHeight: number;
  footprint?: [number, number];
};

type PlantCatalogData = {
  categories: { id: string; name: string; variants: PlantVariant[] }[];
};

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function tintFromFactor(f: number) {
  // 写实：亮度±6%，色温±3%（偏暖）
  const bright = 1 + f * 0.06;
  const warm = f * 0.03;
  const r = clamp01(bright + warm);
  const g = clamp01(bright);
  const b = clamp01(bright - warm);
  return (Math.floor(255 * r) << 16) + (Math.floor(255 * g) << 8) + Math.floor(255 * b);
}

function fitSpriteByHeight(sprite: PIXI.Sprite, targetH: number) {
  const h = sprite.texture.height || 1;
  const scale = targetH / h;
  sprite.scale.set(scale);
}

function getPlantAt(garden: GardenState, r: number, c: number) {
  return garden.cells.find((x) => x.row === r && x.col === c)?.plant ?? null;
}

function isAnchorCell(
  garden: GardenState,
  variantMap: Map<string, PlantVariant>,
  r: number,
  c: number,
  plantId: string
) {
  const fp = (variantMap.get(plantId)?.footprint ?? [1, 1]) as [number, number];
  const [h, w] = fp;
  if (h === 1 && w === 1) return true;

  if (w > 1 && c - 1 >= 0 && getPlantAt(garden, r, c - 1) === plantId) return false;
  if (h > 1 && r - 1 >= 0 && getPlantAt(garden, r - 1, c) === plantId) return false;

  return true;
}

function footprintCenterBottom(r: number, c: number, fp: [number, number]) {
  const seed=r * 1000 + c * 13;
  const [h, w] = fp;
  const x0 = BASE_X + (c+seededRandom(seed)/4 )* COL_GAP;
  const y0 = BASE_Y + (r-seededRandom(seed)/4) * ROW_GAP;
  return {
    cx: x0 + (w * COL_GAP) / 2,
    by: y0 + h * ROW_GAP,
  };
}

async function loadPlantTexture(plantId: string, season: string) {
  // 你现在用 season 做文件名：spring/summer/autumn/winter
  return await PIXI.Assets.load(`/assets/plants/${plantId}/${season}.png`);
}
function drawBrickFrameEdges(
  layer: PIXI.Container,   // 建议单独用 frameLayer / midLayer
  gridW: number,
  gridH: number,
  BASE_X: number,
  BASE_Y: number,
  thickness = 18
) {
  const BRICK = 0xb16c4a;
  const BRICK_DARK = 0x8e4f35;

  const g = new PIXI.Graphics();

  // Top
  g.rect(BASE_X - thickness, BASE_Y - thickness, gridW + thickness * 2, thickness)
    .fill({ color: BRICK });

  // Bottom
  g.rect(BASE_X - thickness, BASE_Y + gridH, gridW + thickness * 2, thickness)
    .fill({ color: BRICK });

  // Left
  g.rect(BASE_X - thickness, BASE_Y, thickness, gridH)
    .fill({ color: BRICK });

  // Right
  g.rect(BASE_X + gridW, BASE_Y, thickness, gridH)
    .fill({ color: BRICK });

  // 描边（可选，增强立体感）
  g.stroke({ width: 2, color: BRICK_DARK, alpha: 0.6 });

  layer.addChild(g);
  return g;
}


async function drawMulchPerCell(layer: PIXI.Container, garden: GardenState) {
  const tex = await PIXI.Assets.load("/assets/backgrounds/mulch2.png");

  for (let r = 0; r < garden.rows; r++) {
    for (let c = 0; c < garden.cols; c++) {
      const tile = new PIXI.TilingSprite({
        texture: tex,
        width: COL_GAP,
        height: ROW_GAP,
      });
      tile.tileScale.x = COL_GAP / tex.width;
      tile.tileScale.y = ROW_GAP / tex.height;

      tile.position.set(BASE_X + c * COL_GAP, BASE_Y + r * ROW_GAP);

      const seed = r * 10007 + c * 97;

      // 纹理取样偏移：去重复感最有效
      const offX = Math.floor(seededRandom(seed + 2) * tex.width);
      const offY = Math.floor(seededRandom(seed + 3) * tex.height);
      tile.tilePosition.set(-offX, -offY);

      // 轻微缩放/旋转（非常克制）
      

      // 轻微色差（写实）
      const f = (seededRandom(seed + 4) - 0.5) * 2;
      tile.tint = tintFromFactor(f);

      tile.alpha = 0.92 + seededRandom(seed + 5) * 0.08;

      tile.zIndex = 0;
      layer.addChild(tile);
    }
  }
}

function addPaperOverlay(scene: PIXI.Container, w: number, h: number) {
  const overlay = new PIXI.Graphics()
    .rect(0, 0, w, h)
    .fill({ color: 0xfff7e8, alpha: 0.10 }); // 暖纸感
  overlay.zIndex = 999;
  scene.addChild(overlay);
}

export function FrontView({ garden }: { garden: GardenState }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const sceneRef = useRef<PIXI.Container | null>(null);

  const [variantMap, setVariantMap] = useState<Map<string, PlantVariant>>(new Map());

  // 读取 catalog（含 footprint）
  useEffect(() => {
    fetch("/assets/plants/index.json")
      .then((r) => r.json())
      .then((data: PlantCatalogData) => {
        const map = new Map<string, PlantVariant>();
        for (const cat of data.categories ?? []) {
          for (const v of cat.variants ?? []) map.set(v.id, v);
        }
        setVariantMap(map);
      });
  }, []);

  // init Pixi
  useEffect(() => {
    if (!mountRef.current) return;

    let destroyed = false;

    (async () => {
      const app = new PIXI.Application();
      await app.init({
        width: 980,
        height: 640,
        antialias: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      console.log("destroyed",destroyed)
      if (destroyed) return;
      console.log("destroyed",destroyed)

      appRef.current = app;
      mountRef.current!.appendChild(app.canvas);

      const scene = new PIXI.Container();
      scene.sortableChildren = true;
      app.stage.addChild(scene);
      sceneRef.current = scene;
      console.log("sceneRef",sceneRef.current)
      console.log("appRef",appRef.current)
    })();

    return () => {
      console.log("running destroyed")
      destroyed = true;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      sceneRef.current = null;
    };
  }, []);

  // render
  useEffect(() => {
    const app = appRef.current;
    const scene = sceneRef.current;
    console.log("app|scene",app,scene)
    if (!app || !scene) return;
    if (variantMap.size === 0) return;

    let canceled = false;

    (async () => {
      scene.removeChildren();

      // grid 区域大小（以 row/col 间距定义）
      const gridW = garden.cols * COL_GAP;
      const gridH = garden.rows * ROW_GAP;

      // 画布大小：给一点边距，避免顶到边缘
      const canvasW = BASE_X + gridW + 140;
      const canvasH = BASE_Y + gridH + 140;
      app.renderer.resize(canvasW, canvasH);

      // 分层
      const bgLayer = new PIXI.Container();
      const frameLayer = new PIXI.Container();
      const plantLayer = new PIXI.Container();
      bgLayer.zIndex = 0;
      frameLayer.zIndex=5;
      plantLayer.zIndex = 10;
      scene.addChild(frameLayer,bgLayer, plantLayer);
      

      // 砖圈
     
      drawBrickFrameEdges(frameLayer, gridW, gridH, BASE_X, BASE_Y, 18); 

      // 每格 mulch（写实）
      await drawMulchPerCell(bgLayer, garden);

      // 画植物（含 footprint 去重 + 跨格居中）
      for (const cell of garden.cells) {
        const plantId = cell.plant;
        if (!plantId || plantId=='empty') continue;

        //if (!isAnchorCell(garden, variantMap, cell.row, cell.col, plantId)) continue;

        const meta = variantMap.get(plantId);
        const fp = (meta?.footprint ?? [1, 1]) as [number, number];
        const baseHeight = meta?.baseHeight ?? 70;

        const tex = await loadPlantTexture(plantId, garden.season);
        if (canceled) return;

        const sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5, 1);

        const { cx, by } = footprintCenterBottom(cell.row, cell.col, fp);
        sprite.position.set(cx, by);

        // 阴影（椭圆，写实又轻）
        const shadow = new PIXI.Graphics()
          .ellipse(cx, by - 10, 20 + fp[1] * 6, 6 + fp[0] * 1.5)
          .fill({ color: 0x000000, alpha: 0.12 });

        // size + depth
        fitSpriteByHeight(sprite, baseHeight);
        const depth = 1 + cell.row * DEPTH_K;
        sprite.scale.set(sprite.scale.x * depth, sprite.scale.y * depth);

        // zIndex 用“底边行”更自然遮挡
        const bottomRow = cell.row + fp[0] - 1;
        shadow.zIndex = 20 + bottomRow * 100 + cell.col - 1;
        sprite.zIndex = 20 + bottomRow * 100 + cell.col;

        plantLayer.addChild(shadow);
        plantLayer.addChild(sprite);

        // 轻摆动（治愈感）：非常克制
        const seed = cell.row * 1000 + cell.col * 13;
        const amp = 0.012 + seededRandom(seed) * 0.008; // 小幅度
        const speed = 0.5 + seededRandom(seed + 1) * 0.35;
        const phase = seededRandom(seed + 2) * Math.PI * 2;
        const baseRot = (seededRandom(seed + 3) - 0.5) * 0.01;

        // 以根部附近摆动
        sprite.pivot.y = sprite.height * 0.9;

        // ticker：给每个 sprite 绑定一个轻摆动
        app.ticker.add(() => {
          const t = app.ticker.lastTime / 1000;
          sprite.rotation = baseRot + Math.sin(t * speed + phase) * amp;
        });
      }

      // 暖纸 overlay（整体旅行青蛙氛围）
      addPaperOverlay(scene, canvasW, canvasH);

      scene.sortChildren();
    })();

    return () => {
      canceled = true;
    };
  }, [garden, variantMap]);

  return <div ref={mountRef} />;
}