import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { GardenState } from "../store/garden";

const DEFAULT_ROW_GAP = 85;
const BASE_HEIGHT_UNIT_SCALE = 2;
const SHOW_DEBUG_GRID = false;
const SHOW_DEBUG_PLANT_BOUNDS = false;
const ENABLE_SWAY = true;
const FRAME = 18;
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
  const bright = 1 + f * 0.06;
  const warm = f * 0.03;
  const r = clamp01(bright + warm);
  const g = clamp01(bright);
  const b = clamp01(bright - warm);
  return (Math.floor(255 * r) << 16) + (Math.floor(255 * g) << 8) + Math.floor(255 * b);
}

function fitSpriteByWidth(sprite: PIXI.Sprite, targetW: number) {
  const width = sprite.texture.width || 1;
  const scale = targetW / width;
  sprite.scale.set(scale);
}

function footprintCenterBottom(
  row: number,
  col: number,
  fp: [number, number],
  rowGap: number,
  colGap: number,
  baseX: number,
  baseY: number
) {
  const [, w] = fp;
  const seed = row * 1009 + col * 9173 + w * 37;
  const jitterX = (seededRandom(seed) - 0.5) * colGap * 0.18;
  const jitterY = (seededRandom(seed + 1) - 0.5) * rowGap * 0.12;
  const x0 = baseX + col * colGap + jitterX;
  const y0 = baseY + (row + 1) * rowGap + jitterY;

  return {
    cx: x0 + (w * colGap) / 2,
    by: y0,
  };
}

async function loadPlantTexture(plantId: string, season: string) {
  return await PIXI.Assets.load(`/assets/plants/${plantId}/${season}.png`);
}

function drawBrickFrameEdges(
  layer: PIXI.Container,
  gridW: number,
  gridH: number,
  baseX: number,
  baseY: number,
  thickness = 18
) {
  const brick = 0xb16c4a;
  const brickDark = 0x8e4f35;
  const g = new PIXI.Graphics();

  g.rect(baseX - thickness, baseY - thickness, gridW + thickness * 2, thickness).fill({ color: brick });
  g.rect(baseX - thickness, baseY + gridH, gridW + thickness * 2, thickness).fill({ color: brick });
  g.rect(baseX - thickness, baseY, thickness, gridH).fill({ color: brick });
  g.rect(baseX + gridW, baseY, thickness, gridH).fill({ color: brick });
  g.stroke({ width: 2, color: brickDark, alpha: 0.6 });

  layer.addChild(g);
}

async function drawMulchPerCell(
  layer: PIXI.Container,
  garden: GardenState,
  rowGap: number,
  colGap: number,
  baseX: number,
  baseY: number
) {
  const tex = await PIXI.Assets.load("/assets/backgrounds/mulch4.png");
  const gridW = garden.cols * colGap;
  const gridH = garden.rows * rowGap;
  const seed = garden.rows * 10007 + garden.cols * 97;
  const inset = 2;

  const safeTexture =
    tex.width > inset * 2 && tex.height > inset * 2
      ? new PIXI.Texture({
          source: tex.source,
          frame: new PIXI.Rectangle(inset, inset, tex.width - inset * 2, tex.height - inset * 2),
        })
      : tex;

  const tile = new PIXI.TilingSprite({
    texture: safeTexture,
    width: gridW + 2,
    height: gridH + 2,
  });
  tile.tileScale.x = colGap / safeTexture.width;
  tile.tileScale.y = rowGap / safeTexture.height;
  tile.position.set(Math.floor(baseX) - 1, Math.floor(baseY) - 1);
  tile.tilePosition.set(
    -Math.floor(seededRandom(seed + 2) * safeTexture.width),
    -Math.floor(seededRandom(seed + 3) * safeTexture.height)
  );
  tile.tint = tintFromFactor((seededRandom(seed + 4) - 0.5) * 2);
  tile.zIndex = 0;
  tile.roundPixels = true;

  const mask = new PIXI.Graphics()
    .rect(Math.floor(baseX), Math.floor(baseY), Math.floor(gridW), Math.floor(gridH))
    .fill({ color: 0xffffff });
  mask.zIndex = 0;
  layer.addChild(mask);
  tile.mask = mask;
  layer.addChild(tile);
}

function addPaperOverlay(scene: PIXI.Container, width: number, height: number) {
  const overlay = new PIXI.Graphics()
    .rect(0, 0, width, height)
    .fill({ color: 0xfff7e8, alpha: 0.1 });
  overlay.zIndex = 999;
  scene.addChild(overlay);
}

function drawDebugGrid(
  layer: PIXI.Container,
  rows: number,
  cols: number,
  rowGap: number,
  colGap: number,
  baseX: number,
  baseY: number
) {
  const g = new PIXI.Graphics();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.rect(baseX + c * colGap, baseY + r * rowGap, colGap, rowGap).stroke({
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
  colGap = 110,
  rowGap = DEFAULT_ROW_GAP,
  showEditGrid = false,
  selectedCell = null,
  onCellSelect,
  onCanvasBackgroundClick,
  canvasWidth = 980,
}: {
  garden: GardenState;
  colGap?: number;
  rowGap?: number;
  showEditGrid?: boolean;
  selectedCell?: { r: number; c: number } | null;
  onCellSelect?: (cell: { r: number; c: number }) => void;
  onCanvasBackgroundClick?: () => void;
  canvasWidth?: number;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const sceneRef = useRef<PIXI.Container | null>(null);
  const [appReady, setAppReady] = useState(false);

  const [variantMap, setVariantMap] = useState<Map<string, PlantVariant>>(new Map());

  const gridW = garden.cols * colGap;
  const gridH = garden.rows * rowGap;
  const baseX = Math.max(FRAME + 24, Math.floor((canvasWidth - gridW) / 2));
  const baseY = Math.max(80, Math.round(colGap * 0.9));
  const canvasH = baseY + gridH + Math.max(140, Math.round(colGap * 1.25));

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

  useEffect(() => {
    if (!mountRef.current) return;

    let destroyed = false;

    (async () => {
      const app = new PIXI.Application();
      await app.init({
        width: canvasWidth,
        height: canvasH,
        antialias: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (destroyed) return;

      appRef.current = app;
      mountRef.current?.appendChild(app.canvas);

      const scene = new PIXI.Container();
      scene.sortableChildren = true;
      app.stage.addChild(scene);
      sceneRef.current = scene;
      setAppReady(true);
    })();

    return () => {
      destroyed = true;
      setAppReady(false);
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!appReady || !app) return;
    const canvas = app.canvas;
    if (!canvas) return;

    const handlePointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const insideGrid =
        x >= baseX &&
        x < baseX + garden.cols * colGap &&
        y >= baseY &&
        y < baseY + garden.rows * rowGap;

      if (!insideGrid) {
        onCanvasBackgroundClick?.();
        return;
      }

      const c = Math.floor((x - baseX) / colGap);
      const r = Math.floor((y - baseY) / rowGap);
      onCellSelect?.({ r, c });
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    return () => canvas.removeEventListener("pointerdown", handlePointerDown);
  }, [appReady, baseX, baseY, colGap, garden.cols, garden.rows, onCanvasBackgroundClick, onCellSelect, rowGap]);

  useEffect(() => {
    const app = appRef.current;
    const scene = sceneRef.current;
    if (!appReady || !app || !scene) return;
    if (variantMap.size === 0) return;

    let canceled = false;

    (async () => {
      scene.removeChildren();
      app.renderer.resize(canvasWidth, canvasH);

      const bgLayer = new PIXI.Container();
      const frameLayer = new PIXI.Container();
      const debugGridLayer = new PIXI.Container();
      const plantLayer = new PIXI.Container();
      bgLayer.zIndex = 0;
      frameLayer.zIndex = 5;
      debugGridLayer.zIndex = 6;
      plantLayer.zIndex = 10;
      scene.addChild(frameLayer, bgLayer, debugGridLayer, plantLayer);

      drawBrickFrameEdges(frameLayer, gridW, gridH, baseX, baseY, FRAME);
      await drawMulchPerCell(bgLayer, garden, rowGap, colGap, baseX, baseY);

      if (SHOW_DEBUG_GRID || showEditGrid) {
        drawDebugGrid(debugGridLayer, garden.rows, garden.cols, rowGap, colGap, baseX, baseY);
        if (showEditGrid && selectedCell) {
          const selectedOutline = new PIXI.Graphics()
            .rect(baseX + selectedCell.c * colGap, baseY + selectedCell.r * rowGap, colGap, rowGap)
            .stroke({ color: 0xffffff, width: 3, alpha: 1 });
          debugGridLayer.addChild(selectedOutline);
        }
      }

      for (const cell of garden.cells) {
        const plantId = cell.plant;
        if (!plantId || plantId === "empty") continue;

        const meta = variantMap.get(plantId);
        const fp = (meta?.footprint ?? [1, 1]) as [number, number];
        const renderScale = meta?.renderScale ?? 1;

        const tex = await loadPlantTexture(plantId, garden.season);
        if (canceled) return;

        const sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5, 1);
        const { cx, by } = footprintCenterBottom(cell.row, cell.col, fp, rowGap, colGap, baseX, baseY);
        sprite.position.set(cx, by);

        const shadow = new PIXI.Graphics()
          .ellipse(cx, by - 10, 20 + fp[1] * 6, 6 + fp[0] * 1.5)
          .fill({ color: 0x000000, alpha: 0.12 });

        fitSpriteByWidth(sprite, colGap * fp[1]);
        sprite.scale.set(sprite.scale.x * renderScale, sprite.scale.y * renderScale);

        const maxRow = Math.max(0, garden.rows - 1);
        const rowDistanceToBack = maxRow - cell.row;
        const depth = Math.max(0.55, 1 - rowDistanceToBack * DEPTH_K);
        sprite.scale.set(sprite.scale.x * depth, sprite.scale.y * depth);

        const zBase = Math.round(by * 100);
        shadow.zIndex = zBase;
        sprite.zIndex = zBase + 1;

        plantLayer.addChild(shadow);
        plantLayer.addChild(sprite);

        const seed = cell.row * 1000 + cell.col * 13;
        const amp = 0.012 + seededRandom(seed) * 0.008;
        const speed = 0.5 + seededRandom(seed + 1) * 0.35;
        const phase = seededRandom(seed + 2) * Math.PI * 2;
        const baseRot = (seededRandom(seed + 3) - 0.5) * 0.01;

        if (SHOW_DEBUG_PLANT_BOUNDS) {
          const localBox = new PIXI.Graphics()
            .rect(-sprite.width / 2, -sprite.height, sprite.width, sprite.height)
            .stroke({ color: 0xffffff, width: 1, alpha: 0.9 });
          sprite.addChild(localBox);
        }

        if (ENABLE_SWAY) {
          app.ticker.add(() => {
            const t = app.ticker.lastTime / 1000;
            sprite.rotation = baseRot + Math.sin(t * speed + phase) * amp;
          });
        } else {
          sprite.rotation = 0;
        }
      }

      addPaperOverlay(scene, canvasWidth, canvasH);
      scene.sortChildren();
    })();

    return () => {
      canceled = true;
    };
  }, [appReady, baseX, baseY, canvasH, canvasWidth, colGap, garden, gridH, gridW, rowGap, selectedCell, showEditGrid, variantMap]);

  return <div ref={mountRef} style={{ width: canvasWidth, minHeight: canvasH }} />;
}
