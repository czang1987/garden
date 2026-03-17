import { useEffect, useMemo, useRef, useState } from "react";
import PlantCatalog from "./components/PlantCatalog";
import { FrontView } from "./views/FrontView";
import { createGarden, resizeGarden } from "./store/garden";
import type { GardenState, Season } from "./store/garden";
import type { PlantCatalogData, PlantCategory, PlantVariant } from "./type/plants";
import {
  generateAutoLayout,
  heightFitsRow,
  maxHeightForRow,
  minHeightForRow,
  prunePlantsByHeightRange,
  relativeHeightFactor,
  scoreLayout,
} from "./utils/layoutEngine";
import { buildOccupancyGrid, footprintCells } from "./utils/footprint";
import { buildLayoutFile, formatLayoutFileAsReadableText, parseLayoutText } from "./utils/layoutIo";

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

export default function App() {
  const [garden, setGarden] = useState<GardenState>(createGarden(20, 20));
  const [rowGapRatio, setRowGapRatio] = useState(0.77);
  const [rowsInput, setRowsInput] = useState(garden.rows);
  const [colsInput, setColsInput] = useState(garden.cols);
  const [categories, setCategories] = useState<PlantCategory[]>([]);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [frontPaneWidth, setFrontPaneWidth] = useState(960);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(320);
  const [frontMinHeight, setFrontMinHeight] = useState(12);
  const [backMinHeight, setBackMinHeight] = useState(36);
  const [frontMaxHeight, setFrontMaxHeight] = useState(36);
  const [backMaxHeight, setBackMaxHeight] = useState(96);
  const [heightGradientStrength, setHeightGradientStrength] = useState(1);
  const [rightPanel, setRightPanel] = useState<"catalog" | "auto">("catalog");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const frontPaneRef = useRef<HTMLDivElement | null>(null);
  const catalogPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/assets/plants/index.json")
      .then((r) => r.json())
      .then((data: PlantCatalogData) => setCategories(data.categories ?? []));
  }, []);

  useEffect(() => {
    setRowsInput(garden.rows);
    setColsInput(garden.cols);
  }, [garden.cols, garden.rows]);

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
    for (const cat of categories) out.push(...cat.variants);
    return out;
  }, [categories]);

  const occupancy = useMemo(() => buildOccupancyGrid(garden, allVariants), [garden, allVariants]);
  const layoutScore = useMemo(() => scoreLayout(garden, allVariants), [garden, allVariants]);

  const canvasWidth = Math.max(520, frontPaneWidth - 4);
  const frameThickness = 36;
  const horizontalPadding = frameThickness * 2 + 48;
  const availableGridWidth = Math.max(160, canvasWidth - horizontalPadding);
  const colGap = Math.max(18, Math.floor(availableGridWidth / Math.max(1, garden.cols)));
  const rowGap = Math.max(4, Math.round(colGap * rowGapRatio));

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
      setEditMode(false);
      setSelectedCell(null);
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
          variantMap
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
    setEditMode(false);
    setSelectedCell(null);
  }

  function applySize() {
    setGarden((prev) => resizeGarden(prev, rowsInput, colsInput));
    setEditMode(false);
    setSelectedCell(null);
  }

  function autoGenerate() {
    setGarden((prev) =>
      generateAutoLayout(prev, allVariants, {
        targetCoverage: 0.62,
        frontMinHeight,
        backMinHeight,
        frontMaxHeight,
        backMaxHeight,
        heightGradientStrength,
      })
    );
    setEditMode(false);
    setSelectedCell(null);
  }

  function clearAllPlants() {
    setGarden((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) => ({ ...cell, plant: "empty" })),
    }));
    setEditMode(false);
    setSelectedCell(null);
  }

  function exportLayout() {
    const doc = buildLayoutFile(garden, allVariants);
    const readable = formatLayoutFileAsReadableText(doc);
    const blob = new Blob([readable], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `garden-layout-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
      const { garden: next, warnings } = parseLayoutText(text, allVariants, garden.season);
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
        frontMinHeight,
        backMinHeight,
        frontMaxHeight,
        backMaxHeight
      )
    );
  }, [allVariants, backMaxHeight, backMinHeight, frontMaxHeight, frontMinHeight]);

  return (
    <div style={{ padding: 16, maxWidth: 1800, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
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
        <button onClick={clearAllPlants}>清空全部植物</button>
        <button onClick={exportLayout}>导出布局文件</button>
        <button onClick={triggerImport}>导入布局文件</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          onChange={onImportFile}
          style={{ display: "none" }}
        />
      </div>

      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {(["spring", "summer", "autumn", "winter"] as Season[]).map((s) => (
          <button key={s} onClick={() => setGarden((g) => ({ ...g, season: s }))}>
            {s}
          </button>
        ))}
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
          {Math.round(minHeightForRow(selectedCell.r, garden.rows, frontMinHeight, backMinHeight))}
          {" - "}
          {Math.round(maxHeightForRow(selectedCell.r, garden.rows, frontMaxHeight, backMaxHeight))}
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
            garden={garden}
            colGap={colGap}
            rowGap={rowGap}
            canvasWidth={canvasWidth}
            showEditGrid={editMode}
            selectedCell={selectedCell}
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
                  disabled={allVariants.length === 0}
                  style={{ width: "100%", padding: "10px 12px", marginBottom: 14, borderRadius: 10 }}
                >
                  自动生成布局
                </button>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Min Height: {frontMinHeight} - {backMinHeight}
                  </div>
                  <DualSlider
                    min={0}
                    max={120}
                    step={1}
                    leftValue={frontMinHeight}
                    rightValue={backMinHeight}
                    onLeftChange={setFrontMinHeight}
                    onRightChange={setBackMinHeight}
                    width={catalogPaneWidth - 32}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Max Height: {frontMaxHeight} - {backMaxHeight}
                  </div>
                  <DualSlider
                    min={0}
                    max={160}
                    step={1}
                    leftValue={frontMaxHeight}
                    rightValue={backMaxHeight}
                    onLeftChange={(value) => setFrontMaxHeight(Math.max(value, frontMinHeight))}
                    onRightChange={(value) => setBackMaxHeight(Math.max(value, backMinHeight))}
                    width={catalogPaneWidth - 32}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Height Gradient: {heightGradientStrength.toFixed(2)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={heightGradientStrength}
                    onChange={(e) => setHeightGradientStrength(Number(e.target.value))}
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
                    {Math.round(minHeightForRow(selectedCell.r, garden.rows, frontMinHeight, backMinHeight))}
                    {" - "}
                    {Math.round(maxHeightForRow(selectedCell.r, garden.rows, frontMaxHeight, backMaxHeight))}
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
