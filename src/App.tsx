import { useEffect, useMemo, useRef, useState } from "react";
import PlantCatalog from "./components/PlantCatalog";
import { FrontView } from "./views/FrontView";
import { createGarden, resizeGarden } from "./store/garden";
import type { GardenState, Season } from "./store/garden";
import type { PlantCatalogData, PlantCategory, PlantVariant } from "./type/plants";
import { generateAutoLayout, relativeHeightFactor, scoreLayout } from "./utils/layoutEngine";
import { buildOccupancyGrid, footprintCells } from "./utils/footprint";
import { buildLayoutFile, formatLayoutFileAsReadableText, parseLayoutText } from "./utils/layoutIo";

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
  const rowGap = Math.max(18, Math.round(colGap * rowGapRatio));

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
          variant,
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
    setGarden((prev) => generateAutoLayout(prev, allVariants, { targetCoverage: 0.62 }));
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
        <button onClick={autoGenerate} disabled={allVariants.length === 0}>
          自动生成布局
        </button>
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
          </div>
        </div>
      </div>
    </div>
  );
}
