import { useEffect, useMemo, useRef, useState } from "react";
import PlantCatalog from "./components/PlantCatalog";
import { FrontView, type FrontViewHandle } from "./views/FrontView";
import { createGarden, resizeGarden } from "./store/garden";
import type { GardenState, Season } from "./store/garden";
import { DEFAULT_DESIGN_INTENT, type DesignIntent } from "./type/designIntent";
import type { PlantCatalogData, PlantCategory, PlantVariant } from "./type/plants";
import {
  generateAutoLayout,
  maxHeightForRow,
  minHeightForRow,
  prunePlantsByDensityTargets,
  prunePlantsByHeightRange,
  prunePlantsByZone,
  relativeHeightFactor,
  scoreLayout,
  topSymmetryCandidateCells,
} from "./utils/layoutEngine";
import { buildDesignLayoutSvg, buildDesignReportHtml, buildDesignReportPlantRows } from "./utils/designReport";
import { buildOccupancyGrid, footprintCells } from "./utils/footprint";
import { parseLayoutText } from "./utils/layoutIo";
import { stylizeFrontViewImage, type FrontViewExportStyle } from "./utils/stylizeApi";
import { plantSupportsZone } from "./utils/zone";

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function DualSlider({
  min,
  max,
  step,
  leftValue,
  rightValue,
  onLeftChange,
  onRightChange,
  width = 260,
}: {
  min: number;
  max: number;
  step: number;
  leftValue: number;
  rightValue: number;
  onLeftChange: (value: number) => void;
  onRightChange: (value: number) => void;
  width?: number;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const range = Math.max(step, max - min);
  const leftPct = ((leftValue - min) / range) * 100;
  const rightPct = ((rightValue - min) / range) * 100;

  useEffect(() => {
    if (!dragging) return;

    const updateFromClientX = (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const raw = min + ((clientX - rect.left) / Math.max(1, rect.width)) * range;
      const snapped = clampValue(Math.round(raw / step) * step, min, max);
      if (dragging === "left") onLeftChange(Math.min(snapped, rightValue));
      else onRightChange(Math.max(snapped, leftValue));
    };

    const onMove = (event: PointerEvent) => updateFromClientX(event.clientX);
    const onUp = () => setDragging(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, leftValue, max, min, onLeftChange, onRightChange, range, rightValue, step]);

  return (
    <div style={{ width, padding: "8px 0" }}>
      <div
        ref={trackRef}
        onPointerDown={(event) => {
          if (!trackRef.current) return;
          const rect = trackRef.current.getBoundingClientRect();
          const pct = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
          setDragging(Math.abs(pct - leftPct) <= Math.abs(pct - rightPct) ? "left" : "right");
        }}
        style={{
          position: "relative",
          height: 6,
          borderRadius: 999,
          background: "#d8d8d8",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${leftPct}%`,
            width: `${Math.max(0, rightPct - leftPct)}%`,
            top: 0,
            bottom: 0,
            background: "#6e8f72",
            borderRadius: 999,
          }}
        />
        {[
          { side: "left" as const, pct: leftPct },
          { side: "right" as const, pct: rightPct },
        ].map((thumb) => (
          <div
            key={thumb.side}
            onPointerDown={(event) => {
              event.stopPropagation();
              setDragging(thumb.side);
            }}
            style={{
              position: "absolute",
              left: `calc(${thumb.pct}% - 9px)`,
              top: -6,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              border: "2px solid #6e8f72",
              boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
              cursor: "grab",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ColorDotSelect({
  value,
  colors,
  onChange,
}: {
  value: string;
  colors: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "0 0 28px" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="selected color preference"
        title={value || "select color"}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: 999,
          border: "1px solid rgba(0,0,0,0.18)",
          background: value || "#ffffff",
          boxShadow: !value || value === "white" ? "inset 0 0 0 1px rgba(0,0,0,0.08)" : undefined,
          cursor: "pointer",
        }}
      />
      {open ? (
        <div
          style={{
            position: "absolute",
            top: 34,
            left: 0,
            zIndex: 30,
            display: "grid",
            gridTemplateColumns: "repeat(4, 18px)",
            gap: 6,
            padding: 8,
            borderRadius: 10,
            border: "1px solid #d8d0c2",
            background: "#fffdf8",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            title="clear"
            style={{
              width: 18,
              height: 18,
              padding: 0,
              borderRadius: 999,
              border: !value ? "2px solid #ffffff" : "1px solid rgba(0,0,0,0.18)",
              outline: !value ? "1px solid #2f3d2f" : "none",
              background: "linear-gradient(135deg, #ffffff 0 45%, #d9d1c2 45% 55%, #ffffff 55% 100%)",
              cursor: "pointer",
            }}
          />
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
              title={color}
              style={{
                width: 18,
                height: 18,
                padding: 0,
                borderRadius: 999,
                border: value === color ? "2px solid #ffffff" : "1px solid rgba(0,0,0,0.18)",
                outline: value === color ? "1px solid #2f3d2f" : "none",
                background: color,
                boxShadow: color === "white" ? "inset 0 0 0 1px rgba(0,0,0,0.08)" : undefined,
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [garden, setGarden] = useState<GardenState>(createGarden(20, 20));
  const [rowGapRatio, setRowGapRatio] = useState(0.28);
  const [rowsInput, setRowsInput] = useState(garden.rows);
  const [colsInput, setColsInput] = useState(garden.cols);
  const [zoneInput, setZoneInput] = useState(garden.zone);
  const [categories, setCategories] = useState<PlantCategory[]>([]);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [frontPaneWidth, setFrontPaneWidth] = useState(960);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(320);
  const [designIntent, setDesignIntent] = useState<DesignIntent>(DEFAULT_DESIGN_INTENT);
  const [lastDensityBand, setLastDensityBand] = useState<"front" | "middle" | "back" | null>(null);
  const [rightPanel, setRightPanel] = useState<"catalog" | "auto">("auto");
  const [selectedColorPreference, setSelectedColorPreference] = useState("");
  const [isGeneratingLayout, setIsGeneratingLayout] = useState(false);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [isStylizingFrontView, setIsStylizingFrontView] = useState(false);
  const [exportProgressText, setExportProgressText] = useState("");
  const [exportProgressValue, setExportProgressValue] = useState<number | null>(null);
  const [frontViewExportStyle, setFrontViewExportStyle] = useState<FrontViewExportStyle>("download");

  const availableColors = useMemo(
    () =>
      Array.from(
        new Set(
          categories.flatMap((cat) =>
            cat.variants
              .map((variant) => variant.color?.trim().toLowerCase())
              .filter((color): color is string => !!color)
          )
        )
      ).sort(),
    [categories]
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const frontPaneRef = useRef<HTMLDivElement | null>(null);
  const frontViewRef = useRef<FrontViewHandle | null>(null);
  const springFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const summerFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const autumnFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const winterFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const catalogPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/assets/plants/index.json")
      .then((r) => r.json())
      .then((data: PlantCatalogData) => setCategories(data.categories ?? []));
  }, []);

  useEffect(() => {
    setRowsInput(garden.rows);
    setColsInput(garden.cols);
    setZoneInput(garden.zone);
  }, [garden.cols, garden.rows, garden.zone]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!editorRef.current) return;
      if (editorRef.current.contains(event.target as Node)) return;
      setEditMode(false);
      setSelectedCell(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!frontPaneRef.current) return;

    const updateWidth = () => {
      const nextWidth = Math.max(520, Math.floor(frontPaneRef.current?.clientWidth ?? 960));
      setFrontPaneWidth(nextWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(frontPaneRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!catalogPaneRef.current) return;

    const updateWidth = () => {
      const nextWidth = Math.max(240, Math.floor(catalogPaneRef.current?.clientWidth ?? 320));
      setCatalogPaneWidth(nextWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(catalogPaneRef.current);
    return () => observer.disconnect();
  }, []);

  const allVariants = useMemo(() => {
    const out: PlantVariant[] = [];
    for (const cat of categories) {
      out.push(
        ...cat.variants.map((variant) => ({
          ...variant,
          categoryId: cat.id,
          categoryName: cat.name,
        }))
      );
    }
    return out;
  }, [categories]);

  const occupancy = useMemo(() => buildOccupancyGrid(garden, allVariants), [garden, allVariants]);
  const layoutScore = useMemo(() => scoreLayout(garden, allVariants), [garden, allVariants]);
  const densityStats = useMemo(() => {
    const counts = {
      front: { used: 0, total: 0 },
      middle: { used: 0, total: 0 },
      back: { used: 0, total: 0 },
    };
    for (let r = 0; r < garden.rows; r++) {
      const t = garden.rows <= 1 ? 1 : r / (garden.rows - 1);
      const band = t < 1 / 3 ? "back" : t < 2 / 3 ? "middle" : "front";
      for (let c = 0; c < garden.cols; c++) {
        counts[band].total += 1;
        if (occupancy[r]?.[c]) counts[band].used += 1;
      }
    }
    return {
      front: counts.front.total ? counts.front.used / counts.front.total : 0,
      middle: counts.middle.total ? counts.middle.used / counts.middle.total : 0,
      back: counts.back.total ? counts.back.used / counts.back.total : 0,
    };
  }, [garden.cols, garden.rows, occupancy]);
  const symmetryHints = useMemo(
    () => topSymmetryCandidateCells(garden, allVariants, designIntent.layout.symmetry),
    [allVariants, designIntent.layout.symmetry, garden]
  );

  const canvasWidth = Math.max(520, frontPaneWidth - 4);
  const frameThickness = 36;
  const horizontalPadding = frameThickness * 2 + 48;
  const availableGridWidth = Math.max(160, canvasWidth - horizontalPadding);
  const colGap = Math.max(18, Math.floor(availableGridWidth / Math.max(1, garden.cols)));
  const rowGap = Math.max(4, Math.round(colGap * rowGapRatio));
  const reportCanvasWidth = 1200;

  function computeViewMetrics(targetCanvasWidth: number, ratio: number) {
    const reportAvailableWidth = Math.max(160, targetCanvasWidth - horizontalPadding);
    const reportColGap = Math.max(18, Math.floor(reportAvailableWidth / Math.max(1, garden.cols)));
    const reportRowGap = Math.max(4, Math.round(reportColGap * ratio));
    return { colGap: reportColGap, rowGap: reportRowGap };
  }

  const frontalMetrics = useMemo(() => computeViewMetrics(reportCanvasWidth, 0.22), [garden.cols]);
  const reportSeasons: Season[] = ["spring", "summer", "autumn", "winter"];

  function getCell(next: GardenState, r: number, c: number) {
    return next.cells.find((x) => x.row === r && x.col === c) ?? null;
  }

  function inBounds(rr: number, cc: number) {
    return rr >= 0 && rr < garden.rows && cc >= 0 && cc < garden.cols;
  }

  function resolveSelectedPlantAnchor(state: GardenState) {
    if (!selectedCell) return null;

    for (const cell of state.cells) {
      if (!cell.plant || cell.plant === "empty") continue;
      const variant = allVariants.find((v) => v.id === cell.plant);
      const fp = (variant?.footprint ?? [1, 1]) as [number, number];
      const covered = footprintCells({ r: cell.row, c: cell.col }, fp);
      if (covered.some((occupiedCell) => occupiedCell.r === selectedCell.r && occupiedCell.c === selectedCell.c)) {
        return {
          anchor: cell,
          footprint: fp,
        };
      }
    }

    return null;
  }

  function selectedPlantFreedCells() {
    const resolved = resolveSelectedPlantAnchor(garden);
    if (!resolved) return new Set<string>();
    return new Set(
      footprintCells({ r: resolved.anchor.row, c: resolved.anchor.col }, resolved.footprint).map(
        (cell) => `${cell.r},${cell.c}`
      )
    );
  }

  function canPlaceAtSelected(v: PlantVariant) {
    if (!selectedCell) return false;
    if (!plantSupportsZone(v, garden.zone)) return false;
    const freed = selectedPlantFreedCells();
    const fp = (v.footprint ?? [1, 1]) as [number, number];

    for (const cell of footprintCells(selectedCell, fp)) {
      if (!inBounds(cell.r, cell.c)) return false;
      if (occupancy[cell.r]?.[cell.c] && !freed.has(`${cell.r},${cell.c}`)) return false;
    }
    return true;
  }

  function disabledReason(v: PlantVariant) {
    if (!selectedCell) return "请先点击一个位置";
    if (!plantSupportsZone(v, garden.zone)) return `当前 Zone ${garden.zone} 不适合该植物`;
    const freed = selectedPlantFreedCells();
    const fp = (v.footprint ?? [1, 1]) as [number, number];

    for (const cell of footprintCells(selectedCell, fp)) {
      if (!inBounds(cell.r, cell.c)) return "超出花坛边界";
      if (occupancy[cell.r]?.[cell.c] && !freed.has(`${cell.r},${cell.c}`)) {
        return "目标位置已被占用";
      }
    }
    return null;
  }

  function choosePlant(plantId: string | null) {
    if (!selectedCell) return;

    const next = structuredClone(garden);
    const resolved = resolveSelectedPlantAnchor(next);
    const target = getCell(next, selectedCell.r, selectedCell.c);

    const nextPlantId = plantId ?? "empty";
    if ((resolved?.anchor.plant ?? target?.plant) === nextPlantId) {
      setEditMode(true);
      return;
    }

    if (resolved?.anchor && resolved.anchor.plant !== "empty") {
      for (const cell of footprintCells({ r: resolved.anchor.row, c: resolved.anchor.col }, resolved.footprint)) {
        const current = getCell(next, cell.r, cell.c);
        if (current) current.plant = "empty";
      }
    }

    if (nextPlantId !== "empty") {
      if (!target) return;
      const placed = next.cells
        .filter((cell) => cell.plant && cell.plant !== "empty")
        .map((cell) => ({ r: cell.row, c: cell.col, id: cell.plant }));
      const variantMap = new Map(allVariants.map((variant) => [variant.id, variant] as const));
      const nextVariant = allVariants.find((variant) => variant.id === nextPlantId);
      if (nextVariant) {
        const placementFactor = relativeHeightFactor(
          nextVariant,
          selectedCell.r,
          selectedCell.c,
          placed,
          variantMap,
          designIntent.height.gradientStrength
        );
        console.log("[manual-select] choose", {
          row: selectedCell.r,
          col: selectedCell.c,
          plantId: nextPlantId,
          placementFactor: Number(placementFactor.toFixed(4)),
        });
      }
      target.plant = nextPlantId;
    }

    setGarden(next);
    setEditMode(true);
  }

  function applySize() {
    setGarden((prev) => ({
      ...resizeGarden(prev, rowsInput, colsInput),
      zone: Math.max(1, Math.min(13, Math.floor(zoneInput) || 1)),
    }));
    setEditMode(false);
    setSelectedCell(null);
  }

  async function autoGenerate() {
    if (isGeneratingLayout) return;
    setIsGeneratingLayout(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      setGarden((prev) =>
        generateAutoLayout(prev, allVariants, {
          targetCoverage: 0.62,
          designIntent,
        })
      );
      setEditMode(false);
      setSelectedCell(null);
    } finally {
      window.setTimeout(() => setIsGeneratingLayout(false), 0);
    }
  }

  function clearAllPlants() {
    setGarden((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) => ({ ...cell, plant: "empty" })),
    }));
    setEditMode(false);
    setSelectedCell(null);
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function exportFrontViewPng() {
    const url = frontViewRef.current?.exportPng();
    if (!url) {
      alert("当前 FrontView 还没有可导出的画布。");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (frontViewExportStyle === "download") {
      downloadDataUrl(url, `frontview-${stamp}.png`);
      return;
    }

    if (isStylizingFrontView) return;
    setIsStylizingFrontView(true);
    setExportProgressText(
      frontViewExportStyle === "download" ? "正在准备导出当前效果图..." : "正在上传当前效果图并生成风格版本..."
    );
    setExportProgressValue(frontViewExportStyle === "download" ? 30 : 20);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      const result = await stylizeFrontViewImage(url, frontViewExportStyle);
      setExportProgressText("风格图已生成，正在下载...");
      setExportProgressValue(90);
      downloadDataUrl(result.imageDataUrl, `frontview-${frontViewExportStyle}-${stamp}.jpg`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`风格化失败：${message}`);
    } finally {
      setExportProgressText("");
      setExportProgressValue(null);
      window.setTimeout(() => setIsStylizingFrontView(false), 0);
    }
  }

  async function exportDesignReport() {
    if (isExportingReport) return;
    setIsExportingReport(true);
    setExportProgressText("正在准备四季视图并整理设计说明...");
    setExportProgressValue(10);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      const rawSeasonalViews = [
        {
          season: "spring" as Season,
          frontalPng: springFrontalReportFrontViewRef.current?.exportPng() ?? "",
        },
        {
          season: "summer" as Season,
          frontalPng: summerFrontalReportFrontViewRef.current?.exportPng() ?? "",
        },
        {
          season: "autumn" as Season,
          frontalPng: autumnFrontalReportFrontViewRef.current?.exportPng() ?? "",
        },
        {
          season: "winter" as Season,
          frontalPng: winterFrontalReportFrontViewRef.current?.exportPng() ?? "",
        },
      ];
      if (rawSeasonalViews.some((view) => !view.frontalPng)) {
        alert("设计说明里的 FrontView 还没有准备好，请稍等几秒后再试。");
        return;
      }

      let seasonalViews = rawSeasonalViews;
      if (frontViewExportStyle !== "download") {
        seasonalViews = [];
        for (let i = 0; i < rawSeasonalViews.length; i++) {
          const view = rawSeasonalViews[i];
          setExportProgressText(`正在生成 ${view.season} 风格图（${i + 1}/${rawSeasonalViews.length}）...`);
          setExportProgressValue(15 + Math.round(((i + 1) / rawSeasonalViews.length) * 60));
          const stylized = await stylizeFrontViewImage(view.frontalPng, frontViewExportStyle);
          seasonalViews.push({
            ...view,
            frontalPng: stylized.imageDataUrl,
          });
        }
      } else {
        setExportProgressValue(55);
      }

      setExportProgressText("正在生成植物清单和布局说明...");
      setExportProgressValue(80);
      const plants = buildDesignReportPlantRows(garden, allVariants);
      const layoutSvg = buildDesignLayoutSvg(garden, allVariants);
      const html = buildDesignReportHtml({
        title: "Garden Design Report",
        garden,
        plants,
        layoutSvg,
        seasonalViews,
      });

      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `garden-design-report-${stamp}.html`;
      setExportProgressText("设计说明已生成，正在下载...");
      setExportProgressValue(96);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportProgressText("");
      setExportProgressValue(null);
      window.setTimeout(() => setIsExportingReport(false), 0);
    }
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const { garden: next, warnings } = parseLayoutText(text, allVariants, garden.season, garden.zone);
      setGarden(next);
      setEditMode(false);
      setSelectedCell(null);
      if (warnings.length > 0) {
        alert(`Imported with warnings:\n- ${warnings.join("\n- ")}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to import layout file: ${message}`);
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedCell) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (isEditable) return;

      event.preventDefault();
      choosePlant(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCell, garden, allVariants]);

  useEffect(() => {
    setGarden((prev) =>
      prunePlantsByHeightRange(
        prev,
        allVariants,
        designIntent
      )
    );
  }, [allVariants, designIntent]);

  useEffect(() => {
    setGarden((prev) =>
      prunePlantsByDensityTargets(
        prev,
        allVariants,
        designIntent,
        lastDensityBand ?? undefined
      )
    );
  }, [allVariants, designIntent, lastDensityBand]);

  useEffect(() => {
    setGarden((prev) => prunePlantsByZone(prev, allVariants));
  }, [allVariants, garden.zone]);

  return (
    <div style={{ padding: 16, maxWidth: 1800, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div
          style={{
            display: "inline-flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            padding: "8px 10px",
            borderRadius: 12,
            background: "#faf7f1",
            border: "1px solid #e2ddd2",
          }}
        >
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
          <label>
            Zone:
            <input
              type="number"
              min={1}
              max={13}
              value={zoneInput}
              onChange={(e) => setZoneInput(Number(e.target.value))}
              style={{ width: 70, marginLeft: 6 }}
            />
          </label>
          <button onClick={applySize}>应用</button>
          <button onClick={clearAllPlants}>清空全部植物</button>
          <button onClick={triggerImport}>导入布局文件</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            onChange={onImportFile}
            style={{ display: "none" }}
          />
        </div>
        <div
          style={{
            display: "inline-flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            padding: "8px 10px",
            borderRadius: 12,
            background: "#f5f8f2",
            border: "1px solid #d7e2d1",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <select
              value={garden.season}
              onChange={(e) => setGarden((g) => ({ ...g, season: e.target.value as Season }))}
              style={{ height: 30 }}
            >
              <option value="spring">spring</option>
              <option value="summer">summer</option>
              <option value="autumn">autumn</option>
              <option value="winter">winter</option>
            </select>
            <select
              value={frontViewExportStyle}
              onChange={(e) => setFrontViewExportStyle(e.target.value as FrontViewExportStyle)}
              style={{ height: 30 }}
            >
              <option value="download">原图</option>
              <option value="monet">莫奈</option>
              <option value="watercolor">水彩</option>
              <option value="vangogh">梵高</option>
            </select>
          </div>
          <button onClick={exportFrontViewPng} disabled={isStylizingFrontView}>
            {isStylizingFrontView ? "正在生成风格图..." : "导出效果图"}
          </button>
          <button onClick={exportDesignReport} disabled={isExportingReport}>
            {isExportingReport ? "正在导出设计说明..." : "导出设计说明"}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#444", marginLeft: 8 }}>View Angle</span>
        <input
          type="range"
          min={0.15}
          max={1}
          step={0.01}
          value={rowGapRatio}
          onChange={(e) => setRowGapRatio(Number(e.target.value))}
          style={{ width: 260 }}
        />
        <span style={{ fontSize: 12, color: "#666" }}>
          COL_GAP: {colGap} / ROW_GAP: {rowGap}
        </span>
      </div>

      {selectedCell ? (
        <div
          style={{
            marginBottom: 12,
            fontSize: 13,
            color: "#4f5f4f",
            background: "#f5f8f2",
            border: "1px solid #d7e2d1",
            borderRadius: 8,
            padding: "8px 10px",
            display: "inline-block",
          }}
        >
          当前选中行允许高度:{" "}
          {Math.round(
            minHeightForRow(
              selectedCell.r,
              garden.rows,
              designIntent.height.frontMin,
              designIntent.height.backMin
            )
          )}
          {" - "}
          {Math.round(
            maxHeightForRow(
              selectedCell.r,
              garden.rows,
              designIntent.height.frontMax,
              designIntent.height.backMax
            )
          )}
        </div>
      ) : null}

      <div
        style={{
          position: "fixed",
          left: -20000,
          top: 0,
          width: reportCanvasWidth,
          height: 10,
          overflow: "hidden",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        {reportSeasons.map((season) => {
          const seasonalGarden = { ...garden, season };
          const frontalRef =
            season === "spring"
              ? springFrontalReportFrontViewRef
              : season === "summer"
                ? summerFrontalReportFrontViewRef
                : season === "autumn"
                  ? autumnFrontalReportFrontViewRef
                  : winterFrontalReportFrontViewRef;
          return (
            <div key={season}>
              <FrontView
                ref={frontalRef}
                garden={seasonalGarden}
                colGap={frontalMetrics.colGap}
                rowGap={frontalMetrics.rowGap}
                monetMode={false}
                canvasWidth={reportCanvasWidth}
                showEditGrid={false}
              />
            </div>
          );
        })}
      </div>
      {isGeneratingLayout || isExportingReport || isStylizingFrontView ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#f5f8f2",
            border: "1px solid #d7e2d1",
            color: "#4f5f4f",
            fontSize: 13,
          }}
        >
          {exportProgressValue !== null ? (
            <div
              style={{
                height: 6,
                borderRadius: 999,
                background: "#dbe6d5",
                overflow: "hidden",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  width: `${exportProgressValue}%`,
                  height: "100%",
                  background: "#6e8f72",
                  transition: "width 180ms ease",
                }}
              />
            </div>
          ) : null}
          {isGeneratingLayout
            ? "正在生成布局，请稍等..."
            : isExportingReport
              ? exportProgressText || "正在整理并导出设计说明，请稍等..."
              : exportProgressText || "正在调用风格化接口并下载图片，请稍等..."}
        </div>
      ) : null}

      <div
        ref={editorRef}
        style={{
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        <div
          ref={frontPaneRef}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          <div style={{ marginBottom: 8, fontSize: 13, color: "#666" }}>
            点击左侧 front view 进入编辑，点击外部退出编辑。
          </div>
          <FrontView
            ref={frontViewRef}
            garden={garden}
            colGap={colGap}
            rowGap={rowGap}
            monetMode={false}
            canvasWidth={canvasWidth}
            showEditGrid={editMode}
            selectedCell={selectedCell}
            symmetryHints={symmetryHints}
            onCellSelect={(cell) => {
              setEditMode(true);
              setSelectedCell(cell);
            }}
            onCanvasBackgroundClick={() => {
              setEditMode(false);
              setSelectedCell(null);
            }}
          />
        </div>

        <div
          ref={catalogPaneRef}
          style={{
            flex: "0 0 clamp(260px, 18vw, 340px)",
            width: "clamp(260px, 18vw, 340px)",
            position: "sticky",
            top: 16,
            alignSelf: "flex-start",
          }}
        >
          <div style={{ width: "100%" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setRightPanel("catalog")}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: rightPanel === "catalog" ? "1px solid #5f7a61" : "1px solid #d9d9d9",
                  background: rightPanel === "catalog" ? "#eef6ee" : "#fff",
                }}
              >
                选植物
              </button>
              <button
                onClick={() => setRightPanel("auto")}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: rightPanel === "auto" ? "1px solid #5f7a61" : "1px solid #d9d9d9",
                  background: rightPanel === "auto" ? "#eef6ee" : "#fff",
                }}
              >
                自动生成植物
              </button>
            </div>
            {rightPanel === "catalog" ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  {selectedCell ? `选中位置: (${selectedCell.r}, ${selectedCell.c})` : "请选择一个格子"}
                </div>
                {categories.length > 0 ? (
                  <PlantCatalog
                    categories={categories}
                    hasSelection={!!selectedCell}
                    onClear={() => choosePlant(null)}
                    canSelectVariant={canPlaceAtSelected}
                    disabledReason={disabledReason}
                    onSelectVariant={(v) => choosePlant(v.id)}
                    panelWidth={catalogPaneWidth}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      minHeight: 420,
                      border: "1px solid #e2ddd2",
                      borderRadius: 14,
                      background: "#faf7f1",
                      padding: 16,
                      color: "#766a58",
                      fontSize: 13,
                      lineHeight: 1.7,
                    }}
                  >
                    正在加载植物目录。
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  width: "100%",
                  border: "1px solid #e2ddd2",
                  borderRadius: 14,
                  background: "#faf7f1",
                  padding: 16,
                  color: "#766a58",
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "#2f3d2f", marginBottom: 12 }}>
                  自动生成植物
                </div>
                <button
                  onClick={autoGenerate}
                  disabled={allVariants.length === 0 || isGeneratingLayout}
                  style={{ width: "100%", padding: "10px 12px", marginBottom: 14, borderRadius: 10 }}
                >
                  {isGeneratingLayout ? "正在生成布局..." : "自动生成布局"}
                </button>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Min Height: {designIntent.height.frontMin} - {designIntent.height.backMin}
                  </div>
                  <DualSlider
                    min={0}
                    max={120}
                    step={1}
                    leftValue={designIntent.height.frontMin}
                    rightValue={designIntent.height.backMin}
                    onLeftChange={(value) =>
                      setDesignIntent((prev) => ({
                        ...prev,
                        height: { ...prev.height, frontMin: value },
                      }))
                    }
                    onRightChange={(value) =>
                      setDesignIntent((prev) => ({
                        ...prev,
                        height: { ...prev.height, backMin: value },
                      }))
                    }
                    width={catalogPaneWidth - 32}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Max Height: {designIntent.height.frontMax} - {designIntent.height.backMax}
                  </div>
                  <DualSlider
                    min={0}
                    max={160}
                    step={1}
                    leftValue={designIntent.height.frontMax}
                    rightValue={designIntent.height.backMax}
                    onLeftChange={(value) =>
                      setDesignIntent((prev) => ({
                        ...prev,
                        height: { ...prev.height, frontMax: Math.max(value, prev.height.frontMin) },
                      }))
                    }
                    onRightChange={(value) =>
                      setDesignIntent((prev) => ({
                        ...prev,
                        height: { ...prev.height, backMax: Math.max(value, prev.height.backMin) },
                      }))
                    }
                    width={catalogPaneWidth - 32}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Height Gradient: {designIntent.height.gradientStrength.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={designIntent.height.gradientStrength}
                    onChange={(e) =>
                      setDesignIntent((prev) => ({
                        ...prev,
                        height: { ...prev.height, gradientStrength: Number(e.target.value) },
                      }))
                    }
                    style={{ width: Math.max(120, catalogPaneWidth - 32) }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Symmetry: {designIntent.layout.symmetry.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={designIntent.layout.symmetry}
                    onChange={(e) =>
                      setDesignIntent((prev) => ({
                        ...prev,
                        layout: { ...prev.layout, symmetry: Number(e.target.value) },
                      }))
                    }
                    style={{ width: Math.max(120, catalogPaneWidth - 32) }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Clusteriness: {designIntent.layout.clusteriness.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={designIntent.layout.clusteriness}
                    onChange={(e) =>
                      setDesignIntent((prev) => ({
                        ...prev,
                        layout: { ...prev.layout, clusteriness: Number(e.target.value) },
                      }))
                    }
                    style={{ width: Math.max(120, catalogPaneWidth - 32) }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Color Preference</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <ColorDotSelect
                      value={selectedColorPreference}
                      colors={availableColors}
                      onChange={setSelectedColorPreference}
                    />
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={selectedColorPreference ? designIntent.color.preferences[selectedColorPreference] ?? 0 : 0}
                      onChange={(e) => {
                        if (!selectedColorPreference) return;
                        setDesignIntent((prev) => ({
                          ...prev,
                          color: {
                            preferences: {
                              ...prev.color.preferences,
                              [selectedColorPreference]: Number(e.target.value),
                            },
                          },
                        }));
                      }}
                      style={{ flex: "1 1 auto", minWidth: 0 }}
                    />
                    <span style={{ width: 36, textAlign: "right", fontSize: 12, color: "#666" }}>
                      {(selectedColorPreference ? designIntent.color.preferences[selectedColorPreference] ?? 0 : 0).toFixed(2)}
                    </span>
                  </div>
                </div>
                <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: "#2f3d2f" }}>
                  前中后排密度
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    Front Density: {densityStats.front.toFixed(2)} / {designIntent.density.front.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={designIntent.density.front}
                    onChange={(e) => {
                      setLastDensityBand("front");
                      setDesignIntent((prev) => ({
                        ...prev,
                        density: { ...prev.density, front: Number(e.target.value) },
                      }));
                    }}
                    style={{ width: Math.max(120, catalogPaneWidth - 32) }}
                  />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    Middle Density: {densityStats.middle.toFixed(2)} / {designIntent.density.middle.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={designIntent.density.middle}
                    onChange={(e) => {
                      setLastDensityBand("middle");
                      setDesignIntent((prev) => ({
                        ...prev,
                        density: { ...prev.density, middle: Number(e.target.value) },
                      }));
                    }}
                    style={{ width: Math.max(120, catalogPaneWidth - 32) }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>
                    Back Density: {densityStats.back.toFixed(2)} / {designIntent.density.back.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={designIntent.density.back}
                    onChange={(e) => {
                      setLastDensityBand("back");
                      setDesignIntent((prev) => ({
                        ...prev,
                        density: { ...prev.density, back: Number(e.target.value) },
                      }));
                    }}
                    style={{ width: Math.max(120, catalogPaneWidth - 32) }}
                  />
                </div>
                {selectedCell ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: "#4f5f4f",
                      background: "#f5f8f2",
                      border: "1px solid #d7e2d1",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    当前选中行允许高度:{" "}
                    {Math.round(
                      minHeightForRow(
                        selectedCell.r,
                        garden.rows,
                        designIntent.height.frontMin,
                        designIntent.height.backMin
                      )
                    )}
                    {" - "}
                    {Math.round(
                      maxHeightForRow(
                        selectedCell.r,
                        garden.rows,
                        designIntent.height.frontMax,
                        designIntent.height.backMax
                      )
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#666" }}>请选择一个格子查看当前行的允许高度。</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

