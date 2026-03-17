import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import type { GardenState } from "../store/garden";
import { footprintCells } from "../utils/footprint";

const DEFAULT_ROW_GAP = 85;
const BASE_HEIGHT_UNIT_SCALE = 2;
const SHOW_DEBUG_GRID = false;
const SHOW_DEBUG_PLANT_BOUNDS = false;
const SHOW_DEBUG_OCCUPIED_CELLS = true;
const ENABLE_SWAY = true;
const FRAME = 36;
const DEPTH_K = 0.01;

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

type LayoutMetrics = {
  baseY: number;
  canvasH: number;
};

type HoverPlant = {
  name: string;
  height: number;
  x: number;
  y: number;
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

async function drawBrickFrameEdges(
  layer: PIXI.Container,
  gridW: number,
  gridH: number,
  baseX: number,
  baseY: number,
  rowGap: number,
  colGap: number,
  thickness = 18
) {
  const brickDark = 0x8e4f35;
  const brickFill = 0xb16c4a;
  let tex: PIXI.Texture | null = null;

  try {
    tex = await PIXI.Assets.load("/assets/backgrounds/brick.png");
  } catch {
    try {
      tex = await PIXI.Assets.load("/assets/backgrounds/brick_v.png");
    } catch {
      tex = null;
    }
  }

  if (!tex) {
    const g = new PIXI.Graphics();
    g.rect(baseX - thickness, baseY - thickness, gridW + thickness * 2, thickness).fill({ color: brickFill });
    g.rect(baseX - thickness, baseY + gridH, gridW + thickness * 2, thickness).fill({ color: brickFill });
    g.rect(baseX - thickness, baseY, thickness, gridH).fill({ color: brickFill });
    g.rect(baseX + gridW, baseY, thickness, gridH).fill({ color: brickFill });
    g.rect(baseX - thickness, baseY - thickness, gridW + thickness * 2, gridH + thickness * 2).stroke({
      width: 2,
      color: brickDark,
      alpha: 0.45,
    });
    layer.addChild(g);
    return;
  }

  const top = new PIXI.TilingSprite({
    texture: tex,
    width: gridW + thickness * 2,
    height: thickness,
  });
  top.position.set(baseX - thickness, baseY - thickness);
  top.tileScale.x = colGap / Math.max(tex.width || 1, 1);
  top.tileScale.y = thickness / Math.max(tex.height || 1, 1);

  const bottom = new PIXI.TilingSprite({
    texture: tex,
    width: gridW + thickness * 2,
    height: thickness,
  });
  bottom.position.set(baseX - thickness, baseY + gridH);
  bottom.tileScale.x = colGap / Math.max(tex.width || 1, 1);
  bottom.tileScale.y = thickness / Math.max(tex.height || 1, 1);

  const left = new PIXI.TilingSprite({
    texture: tex,
    width: thickness,
    height: gridH,
  });
  left.position.set(baseX - thickness, baseY);
  left.tileScale.x = thickness / Math.max(tex.width || 1, 1);
  left.tileScale.y = rowGap / Math.max(tex.height || 1, 1);

  const right = new PIXI.TilingSprite({
    texture: tex,
    width: thickness,
    height: gridH,
  });
  right.position.set(baseX + gridW, baseY);
  right.tileScale.x = thickness / Math.max(tex.width || 1, 1);
  right.tileScale.y = rowGap / Math.max(tex.height || 1, 1);

  const outline = new PIXI.Graphics();
  outline.rect(baseX - thickness, baseY - thickness, gridW + thickness * 2, gridH + thickness * 2).stroke({
    width: 2,
    color: brickDark,
    alpha: 0.45,
  });

  layer.addChild(top, bottom, left, right, outline);
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

function drawSkyBackdrop(
  layer: PIXI.Container,
  baseX: number,
  baseY: number,
  gridW: number,
  frame: number
) {
  const skyWidth = gridW + frame * 2;
  const skyHeight = Math.max(60, baseY - frame);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(skyWidth));
  canvas.height = Math.max(1, Math.round(skyHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#d9efff");
  gradient.addColorStop(0.58, "#eef8ff");
  gradient.addColorStop(1, "#fff6ea");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const haze = ctx.createLinearGradient(0, canvas.height * 0.55, 0, canvas.height);
  haze.addColorStop(0, "rgba(255,255,255,0)");
  haze.addColorStop(1, "rgba(255,248,235,0.8)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, canvas.height * 0.45, canvas.width, canvas.height * 0.55);

  const texture = PIXI.Texture.from(canvas);
  const sky = new PIXI.Sprite(texture);
  sky.position.set(baseX - frame, 0);
  sky.width = skyWidth;
  sky.height = skyHeight;
  sky.zIndex = -1;
  layer.addChild(sky);
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

function findPlantAtCell(
  cells: GardenState["cells"],
  variantMap: Map<string, PlantVariant>,
  targetRow: number,
  targetCol: number
) {
  for (const cell of cells) {
    if (!cell.plant || cell.plant === "empty") continue;
    const meta = variantMap.get(cell.plant);
    if (!meta) continue;
    const fp = (meta.footprint ?? [1, 1]) as [number, number];
    for (const occupiedCell of footprintCells({ r: cell.row, c: cell.col }, fp)) {
      if (occupiedCell.r === targetRow && occupiedCell.c === targetCol) {
        return meta;
      }
    }
  }
  return null;
}

function drawOccupiedCells(
  layer: PIXI.Container,
  cells: GardenState["cells"],
  variantMap: Map<string, PlantVariant>,
  rowGap: number,
  colGap: number,
  baseX: number,
  baseY: number,
  rows: number,
  cols: number
) {
  const g = new PIXI.Graphics();
  for (const cell of cells) {
    if (!cell.plant || cell.plant === "empty") continue;
    const fp = (variantMap.get(cell.plant)?.footprint ?? [1, 1]) as [number, number];
    for (let dr = 0; dr < fp[0]; dr++) {
      for (let dc = 0; dc < fp[1]; dc++) {
        const rr = cell.row - dr;
        const cc = cell.col + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        g.rect(baseX + cc * colGap, baseY + rr * rowGap, colGap, rowGap).fill({
          color: 0x9a9a9a,
          alpha: 0.32,
        });
      }
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
  const [hoverPlant, setHoverPlant] = useState<HoverPlant | null>(null);

  const [variantMap, setVariantMap] = useState<Map<string, PlantVariant>>(new Map());
  const defaultBaseY = Math.max(80, Math.round(colGap * 0.9));
  const [layoutMetrics, setLayoutMetrics] = useState<LayoutMetrics>(() => ({
    baseY: defaultBaseY,
    canvasH: defaultBaseY + garden.rows * rowGap + Math.max(140, Math.round(colGap * 1.25)),
  }));

  const gridW = garden.cols * colGap;
  const gridH = garden.rows * rowGap;
  const baseX = Math.max(FRAME + 24, Math.floor((canvasWidth - gridW) / 2));
  const baseY = layoutMetrics.baseY;
  const canvasH = layoutMetrics.canvasH;

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
    let canceled = false;

    (async () => {
      const fallbackBaseY = Math.max(80, Math.round(colGap * 0.9));
      let requiredBaseY = fallbackBaseY;
      const maxRow = Math.max(0, garden.rows - 1);

      for (const cell of garden.cells) {
        if (!cell.plant || cell.plant === "empty") continue;
        const meta = variantMap.get(cell.plant);
        if (!meta) continue;

        const fp = (meta.footprint ?? [1, 1]) as [number, number];
        const tex = await loadPlantTexture(cell.plant, garden.season);
        if (canceled) return;

        const widthScale = (colGap * fp[1]) / Math.max(tex.width || 1, 1);
        const rowDistanceToBack = maxRow - cell.row;
        const depth = Math.max(0.55, 1 - rowDistanceToBack * DEPTH_K);
        const displayedHeight = (tex.height || 1) * widthScale * depth;
        const minBaseYForCell = Math.ceil(displayedHeight - (cell.row + 1) * rowGap + 40);
        requiredBaseY = Math.max(requiredBaseY, minBaseYForCell);
      }

      const nextCanvasH =
        requiredBaseY + garden.rows * rowGap + Math.max(140, Math.round(colGap * 1.25));

      if (!canceled) {
        setLayoutMetrics((prev) => {
          if (prev.baseY === requiredBaseY && prev.canvasH === nextCanvasH) return prev;
          return { baseY: requiredBaseY, canvasH: nextCanvasH };
        });
      }
    })();

    return () => {
      canceled = true;
    };
  }, [colGap, garden, rowGap, variantMap]);

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

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const insideGrid =
        x >= baseX &&
        x < baseX + garden.cols * colGap &&
        y >= baseY &&
        y < baseY + garden.rows * rowGap;

      if (!insideGrid) {
        setHoverPlant(null);
        return;
      }

      const c = Math.floor((x - baseX) / colGap);
      const r = Math.floor((y - baseY) / rowGap);
      const plant = findPlantAtCell(garden.cells, variantMap, r, c);
      if (!plant) {
        setHoverPlant(null);
        return;
      }

      setHoverPlant({
        name: plant.name,
        height: plant.baseHeight,
        x: x + 12,
        y: y - 12,
      });
    };

    const handlePointerLeave = () => {
      setHoverPlant(null);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [appReady, baseX, baseY, colGap, garden.cells, garden.cols, garden.rows, onCanvasBackgroundClick, onCellSelect, rowGap, variantMap]);

  useEffect(() => {
    const app = appRef.current;
    const scene = sceneRef.current;
    if (!appReady || !app || !scene) return;
    if (variantMap.size === 0) return;

    let canceled = false;

    (async () => {
      scene.removeChildren();
      app.renderer.resize(canvasWidth, canvasH);

      const skyLayer = new PIXI.Container();
      const bgLayer = new PIXI.Container();
      const frameLayer = new PIXI.Container();
      const debugGridLayer = new PIXI.Container();
      const plantLayer = new PIXI.Container();
      skyLayer.zIndex = -5;
      bgLayer.zIndex = 0;
      frameLayer.zIndex = 5;
      debugGridLayer.zIndex = 6;
      plantLayer.zIndex = 10;
      scene.addChild(skyLayer, frameLayer, bgLayer, debugGridLayer, plantLayer);

      drawSkyBackdrop(skyLayer, baseX, baseY, gridW, FRAME);
      await drawBrickFrameEdges(frameLayer, gridW, gridH, baseX, baseY, rowGap, colGap, FRAME);
      await drawMulchPerCell(bgLayer, garden, rowGap, colGap, baseX, baseY);

      if (SHOW_DEBUG_OCCUPIED_CELLS) {
        drawOccupiedCells(debugGridLayer, garden.cells, variantMap, rowGap, colGap, baseX, baseY, garden.rows, garden.cols);
      }

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

  return (
    <div ref={mountRef} style={{ width: canvasWidth, minHeight: canvasH, position: "relative" }}>
      {hoverPlant ? (
        <div
          style={{
            position: "absolute",
            left: hoverPlant.x,
            top: hoverPlant.y,
            transform: "translate(0, -100%)",
            pointerEvents: "none",
            background: "rgba(20,20,20,0.82)",
            color: "#fff",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            zIndex: 20,
          }}
        >
          {hoverPlant.name} ({hoverPlant.height})
        </div>
      ) : null}
    </div>
  );
}


