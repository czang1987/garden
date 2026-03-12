import { useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { GardenState } from "../store/garden";

// 核心布局常量
const BASE_X = 140;
const BASE_Y = 120;
const COL_GAP = 110;
const DEFAULT_ROW_GAP = 85;
// index.json 里的 baseHeight 现在是英寸，这里换算到原先的显示尺度（近似厘米视觉）。
const BASE_HEIGHT_UNIT_SCALE = 2;
const SHOW_DEBUG_GRID = false;
const SHOW_DEBUG_PLANT_BOUNDS = false;
const ENABLE_SWAY = true;

// 花坛边框厚度
const FRAME = 18;

// 按行做景深缩放（可调，且 depth 不超过 1）
const DEPTH_K = 0.03;

type PlantVariant = {
  id: string;
  name: string;
  icon: string;
  baseHeight: number;
  footprint?: [number, number];
  renderScale?: number;
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
  // 贴图着色：轻微亮度和暖色偏移
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

function fitSpriteByWidth(sprite: PIXI.Sprite, targetW: number) {
  const h = sprite.texture.width || 1;
  const scale = targetW / h;
  console.log(h,scale)
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

function footprintCenterBottom(r: number, c: number, fp: [number, number], rowGap: number) {
  const [, w] = fp;
  const seed = r * 1009 + c * 9173 + w * 37;
  const jitterX = (seededRandom(seed) - 0.5) * COL_GAP * 0.18;
  const jitterY = (seededRandom(seed + 1) - 0.5) * rowGap * 0.12;
  const x0 = BASE_X + c * COL_GAP + jitterX;
  const y0 = BASE_Y + (r + 1) * rowGap + jitterY;

  return {
    cx: x0 + (w * COL_GAP) / 2,
    by: y0,
  };
}

async function loadPlantTexture(plantId: string, season: string) {
  // 季节名直接作为文件名：spring/summer/autumn/winter
  return await PIXI.Assets.load(`/assets/plants/${plantId}/${season}.png`);
}
function drawBrickFrameEdges(
  layer: PIXI.Container,   // 建议传入独立的边框图层
  gridW: number,
  gridH: number,
  BASE_X: number,
  BASE_Y: number,
  thickness = 18
) {
  const BRICK = 0xb16c4a;
  const BRICK_DARK = 0x8e4f35;

  const g = new PIXI.Graphics();

  // 上边
  g.rect(BASE_X - thickness, BASE_Y - thickness, gridW + thickness * 2, thickness)
    .fill({ color: BRICK });

  // 下边
  g.rect(BASE_X - thickness, BASE_Y + gridH, gridW + thickness * 2, thickness)
    .fill({ color: BRICK });

  // 左边
  g.rect(BASE_X - thickness, BASE_Y, thickness, gridH)
    .fill({ color: BRICK });

  // 右边
  g.rect(BASE_X + gridW, BASE_Y, thickness, gridH)
    .fill({ color: BRICK });

  // 可选描边，增强立体感
  g.stroke({ width: 2, color: BRICK_DARK, alpha: 0.6 });

  layer.addChild(g);
  return g;
}


async function drawMulchPerCell(layer: PIXI.Container, garden: GardenState, rowGap: number) {
  const tex = await PIXI.Assets.load("/assets/backgrounds/mulch4.png");
  const gridW = garden.cols * COL_GAP;
  const gridH = garden.rows * rowGap;
  const seed = garden.rows * 10007 + garden.cols * 97;
  const inset = 2;

  // 采样区域内缩，避免取到贴图边缘的白边/透明边
  const safeTexture =
    tex.width > inset * 2 && tex.height > inset * 2
      ? new PIXI.Texture({
          source: tex.source,
          frame: new PIXI.Rectangle(
            inset,
            inset,
            tex.width - inset * 2,
            tex.height - inset * 2
          ),
        })
      : tex;

  // 用单张大平铺，避免每格独立贴图造成的白缝
  const tile = new PIXI.TilingSprite({
    texture: safeTexture,
    width: gridW + 2,
    height: gridH + 2,
  });
  tile.tileScale.x = COL_GAP / safeTexture.width;
  tile.tileScale.y = rowGap / safeTexture.height;
  tile.position.set(Math.floor(BASE_X) - 1, Math.floor(BASE_Y) - 1);
  tile.tilePosition.set(
    -Math.floor(seededRandom(seed + 2) * safeTexture.width),
    -Math.floor(seededRandom(seed + 3) * safeTexture.height)
  );
  tile.tint = tintFromFactor((seededRandom(seed + 4) - 0.5) * 2);
  tile.alpha = 1;
  tile.zIndex = 0;
  tile.roundPixels = true;

  // 硬裁剪到花坛矩形，消除抗锯齿边缘渗色
  const mask = new PIXI.Graphics()
    .rect(Math.floor(BASE_X), Math.floor(BASE_Y), Math.floor(gridW), Math.floor(gridH))
    .fill({ color: 0xffffff });
  mask.zIndex = 0;
  layer.addChild(mask);
  tile.mask = mask;
  layer.addChild(tile);
}
function addPaperOverlay(scene: PIXI.Container, w: number, h: number) {
  const overlay = new PIXI.Graphics()
    .rect(0, 0, w, h)
    .fill({ color: 0xfff7e8, alpha: 0.10 }); // 暖色纸张质感叠加
  overlay.zIndex = 999;
  scene.addChild(overlay);
}

function drawDebugGrid(layer: PIXI.Container, rows: number, cols: number, rowGap: number) {
  const g = new PIXI.Graphics();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.rect(BASE_X + c * COL_GAP, BASE_Y + r * rowGap, COL_GAP, rowGap).stroke({
        color: 0xffffff,
        width: 1,
        alpha: 0.78,
      });
    }
  }
  layer.addChild(g);
}

export function FrontView({
  garden,
  rowGap = DEFAULT_ROW_GAP,
}: {
  garden: GardenState;
  rowGap?: number;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const sceneRef = useRef<PIXI.Container | null>(null);

  const [variantMap, setVariantMap] = useState<Map<string, PlantVariant>>(new Map());

  // 读取植物目录（包含 footprint 元数据）
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

  // 初始化 Pixi
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

  // 渲染
  useEffect(() => {
    const app = appRef.current;
    const scene = sceneRef.current;
    console.log("app|scene",app,scene)
    if (!app || !scene) return;
    if (variantMap.size === 0) return;

    let canceled = false;

    (async () => {
      scene.removeChildren();

      // 网格尺寸
      const gridW = garden.cols * COL_GAP;
      const gridH = garden.rows * rowGap;

      // 画布尺寸（带外边距）
      const canvasW = BASE_X + gridW + 140;
      const canvasH = BASE_Y + gridW + 140;
      app.renderer.resize(canvasW, canvasH);

      // 分层渲染
      const bgLayer = new PIXI.Container();
      const frameLayer = new PIXI.Container();
      const debugGridLayer = new PIXI.Container();
      const plantLayer = new PIXI.Container();
      bgLayer.zIndex = 0;
      frameLayer.zIndex=5;
      debugGridLayer.zIndex = 6;
      plantLayer.zIndex = 10;
      scene.addChild(frameLayer, bgLayer, debugGridLayer, plantLayer);
      

      // 砖框
     
      drawBrickFrameEdges(frameLayer, gridW, gridH, BASE_X, BASE_Y, 18); 

      // 覆盖物底层（mulch）
      await drawMulchPerCell(bgLayer, garden, rowGap);
      if (SHOW_DEBUG_GRID) {
        drawDebugGrid(debugGridLayer, garden.rows, garden.cols, rowGap);
      }

      // 绘制植物
      for (const cell of garden.cells) {
        const plantId = cell.plant;
        if (!plantId || plantId=='empty') continue;

        //if (!isAnchorCell(garden, variantMap, cell.row, cell.col, plantId)) continue;

        const meta = variantMap.get(plantId);
        const fp = (meta?.footprint ?? [1, 1]) as [number, number];
        const baseHeight = meta?.baseHeight ?? 70;
        const renderScale = meta?.renderScale ?? 1;

        const tex = await loadPlantTexture(plantId, garden.season);
        if (canceled) return;

        const sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5, 1);
        const { cx, by } = footprintCenterBottom(cell.row, cell.col, fp, rowGap);
        sprite.position.set(cx, by);

        // 轻量地面阴影
        const shadow = new PIXI.Graphics()
          .ellipse(cx, by - 10, 20 + fp[1] * 6, 6 + fp[0] * 1.5)
          .fill({ color: 0x000000, alpha: 0.12 });

        // 尺寸 + 景深
        fitSpriteByWidth(sprite, COL_GAP * fp[1]);
        //fitSpriteByHeight(sprite, baseHeight * renderScale * BASE_HEIGHT_UNIT_SCALE);
        const maxRow = Math.max(0, garden.rows - 1);
        const rowDistanceToBack = maxRow - cell.row;
        const depth = Math.max(0.55, 1 - rowDistanceToBack * DEPTH_K);
        sprite.scale.set(sprite.scale.x * depth, sprite.scale.y * depth);

        // 按实际落点的 y 排序，和随机偏移后的前后关系保持一致
        const zBase = Math.round(by * 100);
        shadow.zIndex = zBase;
        sprite.zIndex = zBase + 1;

        plantLayer.addChild(shadow);
        plantLayer.addChild(sprite);

        // 可选轻微摇摆参数
        const seed = cell.row * 1000 + cell.col * 13;
        const amp = 0.012 + seededRandom(seed) * 0.008; // 小振幅
        const speed = 0.5 + seededRandom(seed + 1) * 0.35;
        const phase = seededRandom(seed + 2) * Math.PI * 2;
        const baseRot = (seededRandom(seed + 3) - 0.5) * 0.01;

        // 保持 anchor 对齐到底边基线。
        // 后续如果重开摇摆，用 anchor(0.5, 1) 就能实现底部支点感。

        if (SHOW_DEBUG_PLANT_BOUNDS) {
          const localBox = new PIXI.Graphics()
            .rect(-sprite.width / 2, -sprite.height, sprite.width, sprite.height)
            .stroke({ color: 0xffffff, width: 1, alpha: 0.9 });
          sprite.addChild(localBox);
        }

        // ticker：可选轻微摇摆
        if (ENABLE_SWAY) {
          app.ticker.add(() => {
            const t = app.ticker.lastTime / 1000;
            sprite.rotation = baseRot + Math.sin(t * speed + phase) * amp;
          });
        } else {
          sprite.rotation = 0;
        }
      }

      // 全局纸张色调叠加
      addPaperOverlay(scene, canvasW, canvasH);

      scene.sortChildren();
    })();

    return () => {
      canceled = true;
    };
  }, [garden, variantMap, rowGap]);

  return <div ref={mountRef} />;
}

