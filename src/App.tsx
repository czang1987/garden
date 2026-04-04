import { useEffect, useMemo, useRef, useState } from "react";
import PlantCatalog from "./components/PlantCatalog";
import { FrontView, type FrontViewHandle } from "./views/FrontView";
import { createGarden, resizeGarden } from "./store/garden";
import type { GardenState, Season } from "./store/garden";
import { DEFAULT_DESIGN_INTENT, applyDesignIntentPatch, type DesignIntent } from "./type/designIntent";
import type { PlantCatalogData, PlantCategory, PlantVariant } from "./type/plants";
import {
  adjustSymmetry,
  generateAutoLayout,
  maxHeightForRow,
  minHeightForRow,
  prunePlantsByColorPreferences,
  prunePlantsByDensityTargets,
  prunePlantsByHeightRange,
  prunePlantsByZone,
  relativeHeightFactor,
  scoreLayout,
  topSymmetryCandidateCells,
} from "./utils/layoutEngine";
import { buildDesignLayoutSvg, buildDesignReportHtml, buildDesignReportPlantRows } from "./utils/designReport";
import { requestDesignIntentPatch } from "./utils/designIntentChatApi";
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
  onInteractionStart,
  width = 260,
}: {
  min: number;
  max: number;
  step: number;
  leftValue: number;
  rightValue: number;
  onLeftChange: (value: number) => void;
  onRightChange: (value: number) => void;
  onInteractionStart?: () => void;
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
          onInteractionStart?.();
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
              onInteractionStart?.();
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

function getCategoryDisplayName(categoryId?: string, fallback?: string) {
  const map: Record<string, string> = {
    shrubs: "灌木",
    perennials: "多年生",
    annuals: "一年生",
    grasses: "观赏草",
  };
  return (categoryId && map[categoryId]) || fallback || categoryId || "";
}

export default function App() {
  type UndoSnapshot = {
    garden: GardenState;
    designIntent: DesignIntent;
    designIntentSummary: string;
    designIntentChanges: string[];
    selectedCell: { r: number; c: number } | null;
    editMode: boolean;
    frontViewMode: "edit" | "preview";
  };

  const apiBase = ((import.meta.env.VITE_STYLIZE_API_BASE as string | undefined)?.trim() || "").replace(/\/+$/, "");
  const apiBaseRemote = ((import.meta.env.VITE_STYLIZE_API_BASE_REMOTE as string | undefined)?.trim() || "").replace(/\/+$/, "");
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === "undefined" ? 1280 : window.innerWidth
  );
  const [editorWidth, setEditorWidth] = useState(1280);
  const [garden, setGarden] = useState<GardenState>(createGarden(20, 20));
  const [rowGapRatio, setRowGapRatio] = useState(0.28);
  const [rowsInput, setRowsInput] = useState(garden.rows);
  const [colsInput, setColsInput] = useState(garden.cols);
  const [zoneInput, setZoneInput] = useState(garden.zone);
  const [categories, setCategories] = useState<PlantCategory[]>([]);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [catalogPaneWidth, setCatalogPaneWidth] = useState(320);
  const [designIntent, setDesignIntent] = useState<DesignIntent>(DEFAULT_DESIGN_INTENT);
  const [lastDensityBand, setLastDensityBand] = useState<"front" | "middle" | "back" | null>(null);
  const [colorPruneQueue, setColorPruneQueue] = useState<string[]>([]);
  const [rightPanel, setRightPanel] = useState<"catalog" | "auto">("auto");
  const [selectedColorPreference, setSelectedColorPreference] = useState("");
  const [isGeneratingLayout, setIsGeneratingLayout] = useState(false);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [isStylizingFrontView, setIsStylizingFrontView] = useState(false);
  const [isExportingTrainingAssets, setIsExportingTrainingAssets] = useState(false);
  const [frontViewMode, setFrontViewMode] = useState<"edit" | "preview">("edit");
  const [isGeneratingFrontViewPreview, setIsGeneratingFrontViewPreview] = useState(false);
  const [frontViewPreviewImage, setFrontViewPreviewImage] = useState("");
  const [frontViewPreviewError, setFrontViewPreviewError] = useState("");
  const [backgroundReferenceImage, setBackgroundReferenceImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [frontViewTextureLoadProgress, setFrontViewTextureLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [exportProgressText, setExportProgressText] = useState("");
  const [exportProgressValue, setExportProgressValue] = useState<number | null>(null);
  const [frontViewExportStyle, setFrontViewExportStyle] = useState<FrontViewExportStyle>("download");
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialTargetRect, setTutorialTargetRect] = useState<DOMRect | null>(null);
  const [reportViewsActive, setReportViewsActive] = useState(false);
  const [designIntentMessage, setDesignIntentMessage] = useState("");
  const [designIntentSummary, setDesignIntentSummary] = useState("");
  const [designIntentChanges, setDesignIntentChanges] = useState<string[]>([]);
  const [showAutoGenerateControls, setShowAutoGenerateControls] = useState(false);
  const [isApplyingAiIntent, setIsApplyingAiIntent] = useState(false);
  const previousSymmetryRef = useRef(designIntent.layout.symmetry);
  const previousHeightRef = useRef(structuredClone(designIntent.height));
  const previousDensityRef = useRef(structuredClone(designIntent.density));
  const designIntentRef = useRef(designIntent);
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const redoStackRef = useRef<UndoSnapshot[]>([]);
  const skipAutoAdjustRef = useRef(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
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
  const isCatalogLoading = categories.length === 0;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const tutorialExportControlsRef = useRef<HTMLDivElement | null>(null);
  const frontEditorRef = useRef<HTMLDivElement | null>(null);
  const autoPanelRef = useRef<HTMLDivElement | null>(null);
  const catalogPanelRef = useRef<HTMLDivElement | null>(null);
  const frontPaneRef = useRef<HTMLDivElement | null>(null);
  const frontViewRef = useRef<FrontViewHandle | null>(null);
  const springFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const summerFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const autumnFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const winterFrontalReportFrontViewRef = useRef<FrontViewHandle | null>(null);
  const backgroundImageInputRef = useRef<HTMLInputElement | null>(null);
  const catalogPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/assets/plants/index.json")
      .then((r) => r.json())
      .then((data: PlantCatalogData) => setCategories(data.categories ?? []));
  }, []);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    designIntentRef.current = designIntent;
  }, [designIntent]);

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
    if (!editorRef.current) return;

    const updateWidth = () => {
      const nextWidth = Math.max(720, Math.floor(editorRef.current?.clientWidth ?? 1280));
      setEditorWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(editorRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!catalogPaneRef.current) return;

    const updateWidth = () => {
      const nextWidth = Math.max(240, Math.floor(catalogPaneRef.current?.clientWidth ?? 320));
      setCatalogPaneWidth((prev) => (prev === nextWidth ? prev : nextWidth));
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
          categoryName: getCategoryDisplayName(cat.id, cat.name),
          boundary:
            variant.boundary ??
            (/\bboxwood\b/i.test(variant.id) ||
              /\bboxwood\b/i.test(cat.id) ||
              /\bboxwood\b/i.test(variant.name)),
        }))
      );
    }
    return out;
  }, [categories]);

  const occupancy = useMemo(() => buildOccupancyGrid(garden, allVariants), [garden, allVariants]);
  const layoutScore = useMemo(() => scoreLayout(garden, allVariants), [garden, allVariants]);
  const selectedPlantAnchor = useMemo(() => resolveSelectedPlantAnchor(garden), [allVariants, garden, selectedCell]);
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

  const isCompactLayout = viewportWidth < 960;
  const isPhoneLayout = viewportWidth < 720;
  useEffect(() => {
    console.log("[layout] viewportWidth =", viewportWidth);
  }, [viewportWidth]);
  const editorGap = isCompactLayout ? 16 : 20;
  const compactViewportWidth = Math.max(320, viewportWidth - 32);
  const desktopSidebarWidth = 430;
  const derivedFrontPaneWidth = isCompactLayout
    ? compactViewportWidth
    : Math.max(420, editorWidth - desktopSidebarWidth - editorGap);
  const canvasWidth = isCompactLayout
    ? Math.max(360, derivedFrontPaneWidth - 4)
    : Math.max(420, Math.min(1380, derivedFrontPaneWidth - 16));
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
  const reportDisplaySeasons: Season[] = ["spring", "summer", "autumn", "winter"];
  const reportLoadSeasons = useMemo(
    () => [garden.season, ...reportDisplaySeasons.filter((season) => season !== garden.season)],
    [garden.season]
  );
  const canUndo = undoDepth > 0;
  const canRedo = redoDepth > 0;

  function buildUndoSnapshot(): UndoSnapshot {
    return {
      garden: structuredClone(garden),
      designIntent: structuredClone(designIntent),
      designIntentSummary,
      designIntentChanges: [...designIntentChanges],
      selectedCell: selectedCell ? { ...selectedCell } : null,
      editMode,
      frontViewMode,
    };
  }

  function isSameSnapshot(a: UndoSnapshot, b: UndoSnapshot) {
    return (
      JSON.stringify(a.garden) === JSON.stringify(b.garden) &&
      JSON.stringify(a.designIntent) === JSON.stringify(b.designIntent) &&
      a.designIntentSummary === b.designIntentSummary &&
      JSON.stringify(a.designIntentChanges) === JSON.stringify(b.designIntentChanges) &&
      JSON.stringify(a.selectedCell) === JSON.stringify(b.selectedCell) &&
      a.editMode === b.editMode &&
      a.frontViewMode === b.frontViewMode
    );
  }

  function summarizeDesignIntentChanges(current: DesignIntent, next: DesignIntent) {
    const changes: string[] = [];
    const pushChange = (label: string, before: number, after: number) => {
      if (before === after) return;
      changes.push(`${label}: ${before.toFixed(2)} -> ${after.toFixed(2)}`);
    };

    pushChange("frontMin", current.height.frontMin, next.height.frontMin);
    pushChange("backMin", current.height.backMin, next.height.backMin);
    pushChange("frontMax", current.height.frontMax, next.height.frontMax);
    pushChange("backMax", current.height.backMax, next.height.backMax);
    pushChange("gradientStrength", current.height.gradientStrength, next.height.gradientStrength);
    pushChange("density.front", current.density.front, next.density.front);
    pushChange("density.middle", current.density.middle, next.density.middle);
    pushChange("density.back", current.density.back, next.density.back);
    pushChange("layout.symmetry", current.layout.symmetry, next.layout.symmetry);
    pushChange("layout.clusteriness", current.layout.clusteriness, next.layout.clusteriness);

    const colorKeys = Array.from(
      new Set([...Object.keys(current.color.preferences), ...Object.keys(next.color.preferences)])
    ).sort();
    for (const color of colorKeys) {
      pushChange(
        `color.${color}`,
        current.color.preferences[color] ?? 0,
        next.color.preferences[color] ?? 0
      );
    }

    const plantKeys = Array.from(
      new Set([...Object.keys(current.plant.preferences), ...Object.keys(next.plant.preferences)])
    ).sort();
    for (const key of plantKeys) {
      pushChange(
        `plant.${key}`,
        current.plant.preferences[key] ?? 0,
        next.plant.preferences[key] ?? 0
      );
    }

    const edgePlantKeys = Array.from(
      new Set([...Object.keys(current.plant.edgePreferences), ...Object.keys(next.plant.edgePreferences)])
    ).sort();
    for (const key of edgePlantKeys) {
      pushChange(
        `plant.edge.${key}`,
        current.plant.edgePreferences[key] ?? 0,
        next.plant.edgePreferences[key] ?? 0
      );
    }

    const centerPlantKeys = Array.from(
      new Set([...Object.keys(current.plant.centerPreferences), ...Object.keys(next.plant.centerPreferences)])
    ).sort();
    for (const key of centerPlantKeys) {
      pushChange(
        `plant.center.${key}`,
        current.plant.centerPreferences[key] ?? 0,
        next.plant.centerPreferences[key] ?? 0
      );
    }

    const cornerPlantKeys = Array.from(
      new Set([...Object.keys(current.plant.cornerPreferences), ...Object.keys(next.plant.cornerPreferences)])
    ).sort();
    for (const key of cornerPlantKeys) {
      pushChange(
        `plant.corner.${key}`,
        current.plant.cornerPreferences[key] ?? 0,
        next.plant.cornerPreferences[key] ?? 0
      );
    }

    const frontPlantKeys = Array.from(
      new Set([...Object.keys(current.plant.frontPreferences), ...Object.keys(next.plant.frontPreferences)])
    ).sort();
    for (const key of frontPlantKeys) {
      pushChange(
        `plant.front.${key}`,
        current.plant.frontPreferences[key] ?? 0,
        next.plant.frontPreferences[key] ?? 0
      );
    }

    const middlePlantKeys = Array.from(
      new Set([...Object.keys(current.plant.middlePreferences), ...Object.keys(next.plant.middlePreferences)])
    ).sort();
    for (const key of middlePlantKeys) {
      pushChange(
        `plant.middle.${key}`,
        current.plant.middlePreferences[key] ?? 0,
        next.plant.middlePreferences[key] ?? 0
      );
    }

    const backPlantKeys = Array.from(
      new Set([...Object.keys(current.plant.backPreferences), ...Object.keys(next.plant.backPreferences)])
    ).sort();
    for (const key of backPlantKeys) {
      pushChange(
        `plant.back.${key}`,
        current.plant.backPreferences[key] ?? 0,
        next.plant.backPreferences[key] ?? 0
      );
    }

    return changes;
  }

  function captureUndoSnapshot() {
    const nextSnapshot = buildUndoSnapshot();
    const lastSnapshot = undoStackRef.current[undoStackRef.current.length - 1];
    if (lastSnapshot && isSameSnapshot(lastSnapshot, nextSnapshot)) return;
    undoStackRef.current = [...undoStackRef.current, nextSnapshot].slice(-30);
    redoStackRef.current = [];
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(0);
  }

  function applySnapshot(snapshot: UndoSnapshot) {
    skipAutoAdjustRef.current = true;
    previousSymmetryRef.current = snapshot.designIntent.layout.symmetry;
    previousHeightRef.current = structuredClone(snapshot.designIntent.height);
    previousDensityRef.current = structuredClone(snapshot.designIntent.density);
    designIntentRef.current = snapshot.designIntent;
    setGarden(structuredClone(snapshot.garden));
    setDesignIntent(structuredClone(snapshot.designIntent));
    setDesignIntentSummary(snapshot.designIntentSummary);
    setDesignIntentChanges([...snapshot.designIntentChanges]);
    setSelectedCell(snapshot.selectedCell ? { ...snapshot.selectedCell } : null);
    setEditMode(snapshot.editMode);
    setFrontViewMode(snapshot.frontViewMode);
    setFrontViewPreviewImage("");
    setFrontViewPreviewError("");
    setColorPruneQueue([]);
    setLastDensityBand(null);
  }

  function restorePreviousStep() {
    const stack = undoStackRef.current;
    const snapshot = stack[stack.length - 1];
    if (!snapshot) return;
    redoStackRef.current = [...redoStackRef.current, buildUndoSnapshot()].slice(-30);
    undoStackRef.current = stack.slice(0, -1);
    applySnapshot(snapshot);
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
  }

  function redoPreviousStep() {
    const stack = redoStackRef.current;
    const snapshot = stack[stack.length - 1];
    if (!snapshot) return;
    undoStackRef.current = [...undoStackRef.current, buildUndoSnapshot()].slice(-30);
    redoStackRef.current = stack.slice(0, -1);
    applySnapshot(snapshot);
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
  }

  function resolveHistoryCommand(message: string): "undo" | "redo" | null {
    const normalized = message.trim().toLowerCase();
    const compact = normalized.replace(/\s+/g, "");
    const undoCommands = new Set([
      "退回上一步",
      "回退上一步",
      "撤回上一步",
      "回到上一步",
      "撤销上一步",
      "undo",
    ]);
    const redoCommands = new Set([
      "重做",
      "恢复上一步",
      "恢复刚才撤回",
      "redo",
    ]);
    if (undoCommands.has(compact)) return "undo";
    if (redoCommands.has(compact)) return "redo";
    return null;
  }

  function resolvePlantEditCommand(message: string) {
    const trimmed = message.trim();
    const normalized = trimmed.toLowerCase();
    const removePatterns = [
      /^(不要|去掉|删掉|删除|移除)(.+)$/,
      /^把(.+?)(去掉|删掉|删除|移除)$/,
      /^不要再用(.+)$/,
    ];
    const reducePatterns = [
      /^(减少|少一点|降低)(.+)$/,
      /^把(.+?)(减少一些|减少一点|少一点|降低一些|降低一点)$/,
      /^(.+?)(少一点|减少一些|减少一点)$/,
    ];
    let rawQuery = "";
    let action: "remove" | "reduce" | null = null;
    for (const pattern of removePatterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      rawQuery = (match[2] ?? match[1] ?? "").trim();
      action = "remove";
      break;
    }
    if (!rawQuery) {
      for (const pattern of reducePatterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        rawQuery = (match[2] ?? match[1] ?? "").trim();
        action = "reduce";
        break;
      }
    }
    if (!rawQuery && !normalized.startsWith("no ")) return null;
    if (!rawQuery && normalized.startsWith("no ")) {
      rawQuery = trimmed.slice(3).trim();
      action = "remove";
    }
    rawQuery = rawQuery.replace(/植物|这种|这些|这个|那种|那类/g, "").trim();
    if (!rawQuery) return null;

    const queries = rawQuery
      .split(/(?:和|以及|及|,|，|\/|、|\+|还有)/)
      .map((part) => part.trim())
      .filter(Boolean);
    const matchedIds = new Set<string>();
    const matchedLabels = new Set<string>();
    const matchedQueries: string[] = [];

    for (const queryText of queries) {
      const query = queryText.toLowerCase();
      const matchedVariants = allVariants.filter((variant) => {
        const haystacks = [
          variant.id,
          variant.name,
          variant.categoryId ?? "",
          variant.categoryName ?? "",
          ...(variant.tags ?? []),
        ]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        return haystacks.some((value) => value.includes(query) || query.includes(value));
      });
      if (matchedVariants.length === 0) continue;
      matchedQueries.push(queryText);
      for (const variant of matchedVariants) {
        matchedIds.add(variant.id);
        matchedLabels.add(variant.categoryName || variant.name);
      }
    }
    if (matchedIds.size === 0 || !action) return null;

    return {
      action,
      query: matchedQueries.join("、") || rawQuery,
      matchedIds,
      matchedLabels: Array.from(matchedLabels),
    };
  }

  function resolveAutoGenerateCommand(message: string) {
    const compact = message.trim().toLowerCase().replace(/\s+/g, "");
    const commands = new Set([
      "生成花园",
      "自动生成花园",
      "生成布局",
      "自动生成布局",
      "重新生成花园",
      "重新生成布局",
      "generate garden",
      "generate layout",
      "auto generate",
      "autogenerate",
    ]);
    return commands.has(compact);
  }

  function resolvePlantPreferenceCommand(message: string) {
    const trimmed = message.trim();
    const shouldGenerate = /生成|花园|布局|重新生成|重新排|为主/.test(trimmed);
    const patterns = [
      /^(?:生成(?:一个)?|做一个)?(.+?)为主的?(?:花园|布局)?$/,
      /^多一点(.+)$/,
      /^增加(.+?)(?:的)?权重$/,
      /^提高(.+?)(?:的)?权重$/,
      /^以(.+)为主$/,
    ];
    let rawQuery = "";
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      rawQuery = (match[1] ?? "").trim();
      break;
    }
    if (!rawQuery) return null;
    rawQuery = rawQuery.replace(/植物|这种|这些|这个|那种|那类/g, "").trim();
    if (!rawQuery) return null;

    const queries = rawQuery
      .split(/(?:和|以及|及|,|，|\/|、|\+|还有)/)
      .map((part) => part.trim())
      .filter(Boolean);
    const matchedIds = new Set<string>();
    const matchedLabels = new Set<string>();

    for (const queryText of queries) {
      const query = queryText.toLowerCase();
      const matchedVariants = allVariants.filter((variant) => {
        const haystacks = [
          variant.id,
          variant.name,
          variant.categoryId ?? "",
          variant.categoryName ?? "",
          ...(variant.tags ?? []),
        ]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        return haystacks.some((value) => value.includes(query) || query.includes(value));
      });
      if (matchedVariants.length === 0) continue;
      for (const variant of matchedVariants) {
        matchedIds.add(variant.id);
        if (variant.categoryId) matchedIds.add(variant.categoryId);
        matchedLabels.add(variant.categoryName || variant.name);
      }
    }
    if (matchedIds.size === 0) return null;

    return {
      query: rawQuery,
      matchedIds: Array.from(matchedIds),
      matchedLabels: Array.from(matchedLabels),
      shouldGenerate,
    };
  }

  function resolveEdgePlantPreferenceCommand(message: string) {
    const trimmed = message.trim();
    const shouldGenerate = true;
    const positivePatterns = [
      { pattern: /^边缘多放些(.+)$/, mode: "increase" as const },
      { pattern: /^边缘多一点(.+)$/, mode: "increase" as const },
      { pattern: /^边缘放(.+)$/, mode: "replace" as const },
      { pattern: /^边缘种(.+)$/, mode: "replace" as const },
      { pattern: /^边缘用(.+)$/, mode: "replace" as const },
      { pattern: /^边缘换成(.+)$/, mode: "replace" as const },
      { pattern: /^让边缘多一些(.+)$/, mode: "increase" as const },
      { pattern: /^让(.+)更靠边$/, mode: "increase" as const },
    ];
    const negativePatterns = [
      /^边缘不要(.+)$/,
      /^边缘别放(.+)$/,
      /^边缘减少(.+)$/,
      /^边缘少一点(.+)$/,
      /^让边缘少一些(.+)$/,
    ];
    let rawQuery = "";
    let action: "increase" | "decrease" | "replace" | null = null;
    for (const { pattern, mode } of positivePatterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      rawQuery = (match[1] ?? "").trim();
      action = mode;
      break;
    }
    if (!rawQuery) {
      for (const pattern of negativePatterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        rawQuery = (match[1] ?? "").trim();
        action = "decrease";
        break;
      }
    }
    rawQuery = rawQuery.replace(/植物|这种|这些|这个|那种|那类/g, "").trim();
    if (!rawQuery || !action) return null;

    const queries = rawQuery
      .split(/(?:和|以及|及|,|，|\/|、|\+|还有)/)
      .map((part) => part.trim())
      .filter(Boolean);
    const matchedIds = new Set<string>();
    const matchedLabels = new Set<string>();

    for (const queryText of queries) {
      const query = queryText.toLowerCase();
      const matchedVariants = allVariants.filter((variant) => {
        const haystacks = [
          variant.id,
          variant.name,
          variant.categoryId ?? "",
          variant.categoryName ?? "",
          ...(variant.tags ?? []),
        ]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        return haystacks.some((value) => value.includes(query) || query.includes(value));
      });
      if (matchedVariants.length === 0) continue;
      for (const variant of matchedVariants) {
        matchedIds.add(variant.id);
        if (variant.categoryId) matchedIds.add(variant.categoryId);
        matchedLabels.add(variant.categoryName || variant.name);
      }
    }
    if (matchedIds.size === 0) return null;

    return {
      action,
      query: rawQuery,
      matchedIds: Array.from(matchedIds),
      matchedLabels: Array.from(matchedLabels),
      shouldGenerate,
    };
  }

  function resolveCenterPlantPreferenceCommand(message: string) {
    const trimmed = message.trim();
    const shouldGenerate = true;
    const positivePatterns = [
      { pattern: /^中间多放些(.+)$/, mode: "increase" as const },
      { pattern: /^中间多一点(.+)$/, mode: "increase" as const },
      { pattern: /^中间放(.+)$/, mode: "replace" as const },
      { pattern: /^中间种(.+)$/, mode: "replace" as const },
      { pattern: /^中间用(.+)$/, mode: "replace" as const },
      { pattern: /^中间换成(.+)$/, mode: "replace" as const },
      { pattern: /^让中间多一些(.+)$/, mode: "increase" as const },
      { pattern: /^让(.+)更靠中间$/, mode: "increase" as const },
      { pattern: /^让(.+)更居中$/, mode: "increase" as const },
      { pattern: /^中央多放些(.+)$/, mode: "increase" as const },
      { pattern: /^中央放(.+)$/, mode: "replace" as const },
      { pattern: /^中心多放些(.+)$/, mode: "increase" as const },
      { pattern: /^中心放(.+)$/, mode: "replace" as const },
    ];
    const negativePatterns = [
      /^中间不要(.+)$/,
      /^中间别放(.+)$/,
      /^中间减少(.+)$/,
      /^中间少一点(.+)$/,
      /^让中间少一些(.+)$/,
      /^中央不要(.+)$/,
      /^中心不要(.+)$/,
    ];
    let rawQuery = "";
    let action: "increase" | "decrease" | "replace" | null = null;
    for (const { pattern, mode } of positivePatterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      rawQuery = (match[1] ?? "").trim();
      action = mode;
      break;
    }
    if (!rawQuery) {
      for (const pattern of negativePatterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        rawQuery = (match[1] ?? "").trim();
        action = "decrease";
        break;
      }
    }
    rawQuery = rawQuery.replace(/植物|这种|这些|这个|那种|那类/g, "").trim();
    if (!rawQuery || !action) return null;

    const queries = rawQuery
      .split(/(?:和|以及|及|,|，|\/|、|\+|还有)/)
      .map((part) => part.trim())
      .filter(Boolean);
    const matchedIds = new Set<string>();
    const matchedLabels = new Set<string>();
    for (const queryText of queries) {
      const query = queryText.toLowerCase();
      const matchedVariants = allVariants.filter((variant) => {
        const haystacks = [variant.id, variant.name, variant.categoryId ?? "", variant.categoryName ?? "", ...(variant.tags ?? [])]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        return haystacks.some((value) => value.includes(query) || query.includes(value));
      });
      if (matchedVariants.length === 0) continue;
      for (const variant of matchedVariants) {
        matchedIds.add(variant.id);
        if (variant.categoryId) matchedIds.add(variant.categoryId);
        matchedLabels.add(variant.categoryName || variant.name);
      }
    }
    if (matchedIds.size === 0) return null;
    return {
      action,
      query: rawQuery,
      matchedIds: Array.from(matchedIds),
      matchedLabels: Array.from(matchedLabels),
      shouldGenerate,
    };
  }

  function resolveCornerPlantPreferenceCommand(message: string) {
    const trimmed = message.trim();
    const shouldGenerate = true;
    const positivePatterns = [
      { pattern: /^角落多放些(.+)$/, mode: "increase" as const },
      { pattern: /^角落多一点(.+)$/, mode: "increase" as const },
      { pattern: /^角落放(.+)$/, mode: "replace" as const },
      { pattern: /^角落种(.+)$/, mode: "replace" as const },
      { pattern: /^角落用(.+)$/, mode: "replace" as const },
      { pattern: /^角落换成(.+)$/, mode: "replace" as const },
      { pattern: /^让角落多一些(.+)$/, mode: "increase" as const },
      { pattern: /^让(.+)更靠角落$/, mode: "increase" as const },
      { pattern: /^四角多放些(.+)$/, mode: "increase" as const },
      { pattern: /^四角放(.+)$/, mode: "replace" as const },
    ];
    const negativePatterns = [
      /^角落不要(.+)$/,
      /^角落别放(.+)$/,
      /^角落减少(.+)$/,
      /^角落少一点(.+)$/,
      /^让角落少一些(.+)$/,
      /^四角不要(.+)$/,
    ];
    let rawQuery = "";
    let action: "increase" | "decrease" | "replace" | null = null;
    for (const { pattern, mode } of positivePatterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      rawQuery = (match[1] ?? "").trim();
      action = mode;
      break;
    }
    if (!rawQuery) {
      for (const pattern of negativePatterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        rawQuery = (match[1] ?? "").trim();
        action = "decrease";
        break;
      }
    }
    rawQuery = rawQuery.replace(/植物|这种|这些|这个|那种|那类/g, "").trim();
    if (!rawQuery || !action) return null;

    const queries = rawQuery
      .split(/(?:和|以及|及|,|，|\/|、|\+|还有)/)
      .map((part) => part.trim())
      .filter(Boolean);
    const matchedIds = new Set<string>();
    const matchedLabels = new Set<string>();
    for (const queryText of queries) {
      const query = queryText.toLowerCase();
      const matchedVariants = allVariants.filter((variant) => {
        const haystacks = [variant.id, variant.name, variant.categoryId ?? "", variant.categoryName ?? "", ...(variant.tags ?? [])]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        return haystacks.some((value) => value.includes(query) || query.includes(value));
      });
      if (matchedVariants.length === 0) continue;
      for (const variant of matchedVariants) {
        matchedIds.add(variant.id);
        if (variant.categoryId) matchedIds.add(variant.categoryId);
        matchedLabels.add(variant.categoryName || variant.name);
      }
    }
    if (matchedIds.size === 0) return null;
    return {
      action,
      query: rawQuery,
      matchedIds: Array.from(matchedIds),
      matchedLabels: Array.from(matchedLabels),
      shouldGenerate,
    };
  }

  function resolveBandPlantPreferenceCommand(message: string) {
    const trimmed = message.trim();
    const shouldGenerate = true;
    const patterns = [
      {
        band: "front" as const,
        positive: [
          { pattern: /^前排多放些(.+)$/, mode: "increase" as const },
          { pattern: /^前排多一点(.+)$/, mode: "increase" as const },
          { pattern: /^前排放(.+)$/, mode: "replace" as const },
          { pattern: /^前排种(.+)$/, mode: "replace" as const },
          { pattern: /^前排用(.+)$/, mode: "replace" as const },
          { pattern: /^前排换成(.+)$/, mode: "replace" as const },
          { pattern: /^让前排多一些(.+)$/, mode: "increase" as const },
          { pattern: /^前面多放些(.+)$/, mode: "increase" as const },
          { pattern: /^前面放(.+)$/, mode: "replace" as const },
          { pattern: /^前面用(.+)$/, mode: "replace" as const },
          { pattern: /^前面换成(.+)$/, mode: "replace" as const },
          { pattern: /^让(.+)更靠前$/, mode: "increase" as const },
        ],
        negative: [/^前排不要放(.+)$/, /^前排不要(.+)$/, /^前排别放(.+)$/, /^前排减少(.+)$/, /^前排少一点(.+)$/, /^前面不要(.+)$/],
      },
      {
        band: "middle" as const,
        positive: [
          { pattern: /^中排多放些(.+)$/, mode: "increase" as const },
          { pattern: /^中排多一点(.+)$/, mode: "increase" as const },
          { pattern: /^中排放(.+)$/, mode: "replace" as const },
          { pattern: /^中排种(.+)$/, mode: "replace" as const },
          { pattern: /^中排用(.+)$/, mode: "replace" as const },
          { pattern: /^中排换成(.+)$/, mode: "replace" as const },
          { pattern: /^让中排多一些(.+)$/, mode: "increase" as const },
        ],
        negative: [/^中排不要放(.+)$/, /^中排不要(.+)$/, /^中排别放(.+)$/, /^中排减少(.+)$/, /^中排少一点(.+)$/],
      },
      {
        band: "back" as const,
        positive: [
          { pattern: /^后排多放些(.+)$/, mode: "increase" as const },
          { pattern: /^后排多一点(.+)$/, mode: "increase" as const },
          { pattern: /^后排放(.+)$/, mode: "replace" as const },
          { pattern: /^后排种(.+)$/, mode: "replace" as const },
          { pattern: /^后排用(.+)$/, mode: "replace" as const },
          { pattern: /^后排换成(.+)$/, mode: "replace" as const },
          { pattern: /^让后排多一些(.+)$/, mode: "increase" as const },
          { pattern: /^后面多放些(.+)$/, mode: "increase" as const },
          { pattern: /^后面放(.+)$/, mode: "replace" as const },
          { pattern: /^后面用(.+)$/, mode: "replace" as const },
          { pattern: /^后面换成(.+)$/, mode: "replace" as const },
          { pattern: /^让(.+)更靠后$/, mode: "increase" as const },
        ],
        negative: [/^后排不要放(.+)$/, /^后排不要(.+)$/, /^后排别放(.+)$/, /^后排减少(.+)$/, /^后排少一点(.+)$/, /^后面不要(.+)$/],
      },
    ];
    for (const { band, positive, negative } of patterns) {
      let rawQuery = "";
      let action: "increase" | "decrease" | "replace" | null = null;
      for (const { pattern, mode } of positive) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        rawQuery = (match[1] ?? "").trim();
        action = mode;
        break;
      }
      if (!rawQuery) {
        for (const pattern of negative) {
          const match = trimmed.match(pattern);
          if (!match) continue;
          rawQuery = (match[1] ?? "").trim();
          action = "decrease";
          break;
        }
      }
      rawQuery = rawQuery.replace(/植物|这种|这些|这个|那种|那类/g, "").trim();
      if (!rawQuery || !action) continue;
      const queries = rawQuery
        .split(/(?:和|以及|及|,|，|\/|、|\+|还有)/)
        .map((part) => part.trim())
        .filter(Boolean);
      const matchedIds = new Set<string>();
      const matchedLabels = new Set<string>();
      for (const queryText of queries) {
        const query = queryText.toLowerCase();
        const matchedVariants = allVariants.filter((variant) => {
          const haystacks = [variant.id, variant.name, variant.categoryId ?? "", variant.categoryName ?? "", ...(variant.tags ?? [])]
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);
          return haystacks.some((value) => value.includes(query) || query.includes(value));
        });
        if (matchedVariants.length === 0) continue;
        for (const variant of matchedVariants) {
          matchedIds.add(variant.id);
          if (variant.categoryId) matchedIds.add(variant.categoryId);
          matchedLabels.add(variant.categoryName || variant.name);
        }
      }
      if (matchedIds.size === 0) continue;
      return {
        band,
        action,
        query: rawQuery,
        matchedIds: Array.from(matchedIds),
        matchedLabels: Array.from(matchedLabels),
        shouldGenerate,
      };
    }
    return null;
  }

  function removePlantsByIds(state: GardenState, plantIds: Set<string>, mode: "remove" | "reduce") {
    const next = structuredClone(state);
    const matchedCells = next.cells.filter((cell) => plantIds.has(cell.plant));
    if (matchedCells.length === 0) {
      return { next, removedCount: 0 };
    }
    const removalTarget = mode === "remove" ? matchedCells.length : Math.max(1, Math.ceil(matchedCells.length * 0.5));
    const removalKeys = new Set(
      matchedCells
        .slice()
        .sort((a, b) => (b.row - a.row) || (b.col - a.col))
        .slice(0, removalTarget)
        .map((cell) => `${cell.row},${cell.col}`)
    );
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!removalKeys.has(`${cell.row},${cell.col}`)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function removeEdgePlantsByIds(state: GardenState, plantIds: Set<string>, mode: "remove" | "reduce") {
    const next = structuredClone(state);
    const maxEdgeDistance = Math.max(1, Math.floor(Math.min(next.rows, next.cols) * 0.25));
    const matchedCells = next.cells.filter((cell) => {
      if (!plantIds.has(cell.plant)) return false;
      const edgeDistance = Math.min(cell.row, cell.col, next.rows - 1 - cell.row, next.cols - 1 - cell.col);
      return edgeDistance <= maxEdgeDistance;
    });
    if (matchedCells.length === 0) {
      return { next, removedCount: 0 };
    }
    const removalTarget = mode === "remove" ? matchedCells.length : Math.max(1, Math.ceil(matchedCells.length * 0.5));
    const removalKeys = new Set(
      matchedCells
        .slice()
        .sort((a, b) => (a.row - b.row) || (a.col - b.col))
        .slice(0, removalTarget)
        .map((cell) => `${cell.row},${cell.col}`)
    );
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!removalKeys.has(`${cell.row},${cell.col}`)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function removeCenterPlantsByIds(state: GardenState, plantIds: Set<string>, mode: "remove" | "reduce") {
    const next = structuredClone(state);
    const rowCenter = next.rows <= 1 ? 0 : (next.rows - 1) / 2;
    const colCenter = next.cols <= 1 ? 0 : (next.cols - 1) / 2;
    const matchedCells = next.cells.filter((cell) => {
      if (!plantIds.has(cell.plant)) return false;
      const rowDistance = Math.abs(cell.row - rowCenter) / Math.max(1, rowCenter);
      const colDistance = Math.abs(cell.col - colCenter) / Math.max(1, colCenter);
      return (rowDistance + colDistance) / 2 <= 0.4;
    });
    if (matchedCells.length === 0) return { next, removedCount: 0 };
    const removalTarget = mode === "remove" ? matchedCells.length : Math.max(1, Math.ceil(matchedCells.length * 0.5));
    const removalKeys = new Set(
      matchedCells
        .slice()
        .sort((a, b) => Math.abs(a.row - rowCenter) + Math.abs(a.col - colCenter) - (Math.abs(b.row - rowCenter) + Math.abs(b.col - colCenter)))
        .slice(0, removalTarget)
        .map((cell) => `${cell.row},${cell.col}`)
    );
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!removalKeys.has(`${cell.row},${cell.col}`)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function removeCornerPlantsByIds(state: GardenState, plantIds: Set<string>, mode: "remove" | "reduce") {
    const next = structuredClone(state);
    const maxCornerDistance = Math.max(1, Math.floor(Math.min(next.rows, next.cols) * 0.22));
    const matchedCells = next.cells.filter((cell) => {
      if (!plantIds.has(cell.plant)) return false;
      const nearestCorner = Math.min(
        Math.hypot(cell.row, cell.col),
        Math.hypot(cell.row, next.cols - 1 - cell.col),
        Math.hypot(next.rows - 1 - cell.row, cell.col),
        Math.hypot(next.rows - 1 - cell.row, next.cols - 1 - cell.col)
      );
      return nearestCorner <= maxCornerDistance;
    });
    if (matchedCells.length === 0) return { next, removedCount: 0 };
    const removalTarget = mode === "remove" ? matchedCells.length : Math.max(1, Math.ceil(matchedCells.length * 0.5));
    const removalKeys = new Set(
      matchedCells
        .slice()
        .sort((a, b) => a.row + a.col - (b.row + b.col))
        .slice(0, removalTarget)
        .map((cell) => `${cell.row},${cell.col}`)
    );
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!removalKeys.has(`${cell.row},${cell.col}`)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function bandForRow(row: number, rows: number): "front" | "middle" | "back" {
    if (rows <= 1) return "front";
    const t = Math.max(0, Math.min(1, row / (rows - 1)));
    if (t < 1 / 3) return "back";
    if (t < 2 / 3) return "middle";
    return "front";
  }

  function removeBandPlantsByIds(
    state: GardenState,
    band: "front" | "middle" | "back",
    plantIds: Set<string>,
    mode: "remove" | "reduce"
  ) {
    const next = structuredClone(state);
    const matchedCells = next.cells.filter((cell) => plantIds.has(cell.plant) && bandForRow(cell.row, next.rows) === band);
    if (matchedCells.length === 0) return { next, removedCount: 0 };
    const removalTarget = mode === "remove" ? matchedCells.length : Math.max(1, Math.ceil(matchedCells.length * 0.5));
    const removalKeys = new Set(
      matchedCells
        .slice()
        .sort((a, b) => (band === "back" ? a.row - b.row : b.row - a.row) || (a.col - b.col))
        .slice(0, removalTarget)
        .map((cell) => `${cell.row},${cell.col}`)
    );
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!removalKeys.has(`${cell.row},${cell.col}`)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function clearBandForReplacement(state: GardenState, band: "front" | "middle" | "back", keepIds: Set<string>) {
    const next = structuredClone(state);
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!cell.plant || cell.plant === "empty") return cell;
      if (bandForRow(cell.row, next.rows) !== band) return cell;
      if (keepIds.has(cell.plant)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function clearEdgeForReplacement(state: GardenState, keepIds: Set<string>) {
    const next = structuredClone(state);
    const maxEdgeDistance = Math.max(1, Math.floor(Math.min(next.rows, next.cols) * 0.25));
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!cell.plant || cell.plant === "empty") return cell;
      const edgeDistance = Math.min(cell.row, cell.col, next.rows - 1 - cell.row, next.cols - 1 - cell.col);
      if (edgeDistance > maxEdgeDistance || keepIds.has(cell.plant)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function clearCenterForReplacement(state: GardenState, keepIds: Set<string>) {
    const next = structuredClone(state);
    const rowCenter = next.rows <= 1 ? 0 : (next.rows - 1) / 2;
    const colCenter = next.cols <= 1 ? 0 : (next.cols - 1) / 2;
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!cell.plant || cell.plant === "empty") return cell;
      const rowDistance = Math.abs(cell.row - rowCenter) / Math.max(1, rowCenter);
      const colDistance = Math.abs(cell.col - colCenter) / Math.max(1, colCenter);
      if ((rowDistance + colDistance) / 2 > 0.4 || keepIds.has(cell.plant)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function clearCornerForReplacement(state: GardenState, keepIds: Set<string>) {
    const next = structuredClone(state);
    const maxCornerDistance = Math.max(1, Math.floor(Math.min(next.rows, next.cols) * 0.22));
    let removedCount = 0;
    next.cells = next.cells.map((cell) => {
      if (!cell.plant || cell.plant === "empty") return cell;
      const nearestCorner = Math.min(
        Math.hypot(cell.row, cell.col),
        Math.hypot(cell.row, next.cols - 1 - cell.col),
        Math.hypot(next.rows - 1 - cell.row, cell.col),
        Math.hypot(next.rows - 1 - cell.row, next.cols - 1 - cell.col)
      );
      if (nearestCorner > maxCornerDistance || keepIds.has(cell.plant)) return cell;
      removedCount += 1;
      return { ...cell, plant: "empty" };
    });
    return { next, removedCount };
  }

  function applyLocalDesignCommandClause(
    clause: string,
    currentGarden: GardenState,
    currentDesignIntent: DesignIntent
  ) {
    const bandPlantPreferenceCommand = resolveBandPlantPreferenceCommand(clause);
    if (bandPlantPreferenceCommand) {
      const preferenceKey =
        bandPlantPreferenceCommand.band === "front"
          ? "frontPreferences"
          : bandPlantPreferenceCommand.band === "middle"
            ? "middlePreferences"
            : "backPreferences";
      const nextDesignIntent = applyDesignIntentPatch(currentDesignIntent, {
        plant: {
          [preferenceKey]: Object.fromEntries(
            bandPlantPreferenceCommand.matchedIds.map((id) => [id, bandPlantPreferenceCommand.action === "increase" ? 1 : -1])
          ),
        },
      });
      let workingGarden = currentGarden;
      let removedCount = 0;
      if (bandPlantPreferenceCommand.action === "decrease") {
        const removal = removeBandPlantsByIds(
          workingGarden,
          bandPlantPreferenceCommand.band,
          new Set(bandPlantPreferenceCommand.matchedIds),
          "remove"
        );
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      } else if (bandPlantPreferenceCommand.action === "replace") {
        const replacement = clearBandForReplacement(
          workingGarden,
          bandPlantPreferenceCommand.band,
          new Set(bandPlantPreferenceCommand.matchedIds)
        );
        workingGarden = replacement.next;
        removedCount = replacement.removedCount;
      }
      const nextGarden = bandPlantPreferenceCommand.shouldGenerate
        ? generateAutoLayout(workingGarden, allVariants, { designIntent: nextDesignIntent })
        : bandPlantPreferenceCommand.action === "decrease"
          ? workingGarden
          : currentGarden;
      const bandLabel =
        bandPlantPreferenceCommand.band === "front"
          ? "前排"
          : bandPlantPreferenceCommand.band === "middle"
            ? "中排"
            : "后排";
      return {
        handled: true,
        garden: nextGarden,
        designIntent: nextDesignIntent,
        summary:
          bandPlantPreferenceCommand.action === "increase"
            ? `已提高 ${bandPlantPreferenceCommand.query} 在${bandLabel}的生成权重，并重新生成布局。`
            : bandPlantPreferenceCommand.action === "replace"
              ? `已将${bandLabel}尽量替换为 ${bandPlantPreferenceCommand.query}，并重新生成布局。`
            : removedCount > 0
              ? `已减少${bandLabel}的 ${bandPlantPreferenceCommand.query}，并按新的${bandLabel}偏好重新生成布局。`
              : `已设置${bandLabel}不要 ${bandPlantPreferenceCommand.query}，并按新的${bandLabel}偏好重新生成布局。`,
      };
    }

    const centerPlantPreferenceCommand = resolveCenterPlantPreferenceCommand(clause);
    if (centerPlantPreferenceCommand) {
      const nextDesignIntent = applyDesignIntentPatch(currentDesignIntent, {
        plant: {
          centerPreferences: Object.fromEntries(
            centerPlantPreferenceCommand.matchedIds.map((id) => [id, centerPlantPreferenceCommand.action === "increase" ? 1 : -1])
          ),
        },
      });
      let workingGarden = currentGarden;
      let removedCount = 0;
      if (centerPlantPreferenceCommand.action === "decrease") {
        const removal = removeCenterPlantsByIds(workingGarden, new Set(centerPlantPreferenceCommand.matchedIds), "remove");
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      } else if (centerPlantPreferenceCommand.action === "replace") {
        const replacement = clearCenterForReplacement(workingGarden, new Set(centerPlantPreferenceCommand.matchedIds));
        workingGarden = replacement.next;
        removedCount = replacement.removedCount;
      }
      const nextGarden = centerPlantPreferenceCommand.shouldGenerate
        ? generateAutoLayout(workingGarden, allVariants, { designIntent: nextDesignIntent })
        : centerPlantPreferenceCommand.action === "decrease"
          ? workingGarden
          : currentGarden;
      return {
        handled: true,
        garden: nextGarden,
        designIntent: nextDesignIntent,
        summary:
          centerPlantPreferenceCommand.action === "increase"
            ? `已提高 ${centerPlantPreferenceCommand.query} 在中间区域的生成权重，并重新生成布局。`
            : centerPlantPreferenceCommand.action === "replace"
              ? `已将中间区域尽量替换为 ${centerPlantPreferenceCommand.query}，并重新生成布局。`
            : removedCount > 0
              ? `已减少中间区域的 ${centerPlantPreferenceCommand.query}，并按新的中间偏好重新生成布局。`
              : `已设置中间不要 ${centerPlantPreferenceCommand.query}，并按新的中间偏好重新生成布局。`,
      };
    }

    const cornerPlantPreferenceCommand = resolveCornerPlantPreferenceCommand(clause);
    if (cornerPlantPreferenceCommand) {
      const nextDesignIntent = applyDesignIntentPatch(currentDesignIntent, {
        plant: {
          cornerPreferences: Object.fromEntries(
            cornerPlantPreferenceCommand.matchedIds.map((id) => [id, cornerPlantPreferenceCommand.action === "increase" ? 1 : -1])
          ),
        },
      });
      let workingGarden = currentGarden;
      let removedCount = 0;
      if (cornerPlantPreferenceCommand.action === "decrease") {
        const removal = removeCornerPlantsByIds(workingGarden, new Set(cornerPlantPreferenceCommand.matchedIds), "remove");
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      } else if (cornerPlantPreferenceCommand.action === "replace") {
        const replacement = clearCornerForReplacement(workingGarden, new Set(cornerPlantPreferenceCommand.matchedIds));
        workingGarden = replacement.next;
        removedCount = replacement.removedCount;
      }
      const nextGarden = cornerPlantPreferenceCommand.shouldGenerate
        ? generateAutoLayout(workingGarden, allVariants, { designIntent: nextDesignIntent })
        : cornerPlantPreferenceCommand.action === "decrease"
          ? workingGarden
          : currentGarden;
      return {
        handled: true,
        garden: nextGarden,
        designIntent: nextDesignIntent,
        summary:
          cornerPlantPreferenceCommand.action === "increase"
            ? `已提高 ${cornerPlantPreferenceCommand.query} 在角落区域的生成权重，并重新生成布局。`
            : cornerPlantPreferenceCommand.action === "replace"
              ? `已将角落区域尽量替换为 ${cornerPlantPreferenceCommand.query}，并重新生成布局。`
            : removedCount > 0
              ? `已减少角落区域的 ${cornerPlantPreferenceCommand.query}，并按新的角落偏好重新生成布局。`
              : `已设置角落不要 ${cornerPlantPreferenceCommand.query}，并按新的角落偏好重新生成布局。`,
      };
    }

    const edgePlantPreferenceCommand = resolveEdgePlantPreferenceCommand(clause);
    if (edgePlantPreferenceCommand) {
      const nextDesignIntent = applyDesignIntentPatch(currentDesignIntent, {
        plant: {
          edgePreferences: Object.fromEntries(
            edgePlantPreferenceCommand.matchedIds.map((id) => [id, edgePlantPreferenceCommand.action === "increase" ? 1 : -1])
          ),
        },
      });
      let workingGarden = currentGarden;
      let removedCount = 0;
      if (edgePlantPreferenceCommand.action === "decrease") {
        const removal = removeEdgePlantsByIds(workingGarden, new Set(edgePlantPreferenceCommand.matchedIds), "remove");
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      } else if (edgePlantPreferenceCommand.action === "replace") {
        const replacement = clearEdgeForReplacement(workingGarden, new Set(edgePlantPreferenceCommand.matchedIds));
        workingGarden = replacement.next;
        removedCount = replacement.removedCount;
      }
      const nextGarden = edgePlantPreferenceCommand.shouldGenerate
        ? generateAutoLayout(workingGarden, allVariants, { designIntent: nextDesignIntent })
        : edgePlantPreferenceCommand.action === "decrease"
          ? workingGarden
          : currentGarden;
      return {
        handled: true,
        garden: nextGarden,
        designIntent: nextDesignIntent,
        summary:
          edgePlantPreferenceCommand.action === "increase"
            ? `已提高 ${edgePlantPreferenceCommand.query} 在边缘位置的生成权重，并重新生成布局。`
            : edgePlantPreferenceCommand.action === "replace"
              ? `已将边缘区域尽量替换为 ${edgePlantPreferenceCommand.query}，并重新生成布局。`
            : removedCount > 0
              ? `已减少边缘的 ${edgePlantPreferenceCommand.query}，并按新的边缘偏好重新生成布局。`
              : `已设置边缘不要 ${edgePlantPreferenceCommand.query}，并按新的边缘偏好重新生成布局。`,
      };
    }

    const plantPreferenceCommand = resolvePlantPreferenceCommand(clause);
    if (plantPreferenceCommand) {
      const nextDesignIntent = applyDesignIntentPatch(currentDesignIntent, {
        plant: {
          preferences: Object.fromEntries(plantPreferenceCommand.matchedIds.map((id) => [id, 1])),
        },
      });
      const nextGarden = plantPreferenceCommand.shouldGenerate
        ? generateAutoLayout(currentGarden, allVariants, { designIntent: nextDesignIntent })
        : currentGarden;
      return {
        handled: true,
        garden: nextGarden,
        designIntent: nextDesignIntent,
        summary: plantPreferenceCommand.shouldGenerate
          ? `已提高 ${plantPreferenceCommand.query} 的生成权重，并按当前参数重新生成花园。`
          : `已提高 ${plantPreferenceCommand.query} 的生成权重。`,
      };
    }

    if (resolveAutoGenerateCommand(clause)) {
      return {
        handled: true,
        garden: generateAutoLayout(currentGarden, allVariants, { designIntent: currentDesignIntent }),
        designIntent: currentDesignIntent,
        summary: "已按当前参数自动生成花园布局。",
      };
    }

    const plantEditCommand = resolvePlantEditCommand(clause);
    if (plantEditCommand) {
      const { next, removedCount } = removePlantsByIds(currentGarden, plantEditCommand.matchedIds, plantEditCommand.action);
      return {
        handled: true,
        garden: next,
        designIntent: currentDesignIntent,
        summary:
          removedCount > 0
            ? plantEditCommand.action === "remove"
              ? `已从当前布局中去除 ${plantEditCommand.query}，共移除 ${removedCount} 株。`
              : `已减少 ${plantEditCommand.query}，共移除 ${removedCount} 株。`
            : `当前布局里没有 ${plantEditCommand.query}。`,
      };
    }

    return { handled: false as const, garden: currentGarden, designIntent: currentDesignIntent, summary: "" };
  }

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

    captureUndoSnapshot();

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
    captureUndoSnapshot();
    setGarden((prev) => ({
      ...resizeGarden(prev, rowsInput, colsInput),
      zone: Math.max(1, Math.min(13, Math.floor(zoneInput) || 1)),
    }));
    setEditMode(false);
    setSelectedCell(null);
  }

  async function autoGenerate() {
    if (isGeneratingLayout) return;
    captureUndoSnapshot();
    setIsGeneratingLayout(true);
    setExportProgressText("正在准备自动生成布局...");
    setExportProgressValue(15);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      setExportProgressText("正在分析当前约束并计算布局...");
      setExportProgressValue(45);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      setGarden((prev) => {
        return generateAutoLayout(prev, allVariants, {
          designIntent,
        });
      });
      setExportProgressText("布局已生成，正在刷新视图...");
      setExportProgressValue(95);
      setEditMode(false);
      setSelectedCell(null);
    } finally {
      setExportProgressText("");
      setExportProgressValue(null);
      window.setTimeout(() => setIsGeneratingLayout(false), 0);
    }
  }

  function clearAllPlants() {
    captureUndoSnapshot();
    setGarden((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) => ({ ...cell, plant: "empty" })),
    }));
    setEditMode(false);
    setSelectedCell(null);
  }

  function confirmClearAllPlants() {
    if (!window.confirm("确定要清除当前花园里的全部植物吗？")) return;
    clearAllPlants();
  }

  async function applyAiDesignIntent() {
    const message = designIntentMessage.trim();
    if (!message || isApplyingAiIntent) return;
    setDesignIntentMessage("");
    const clauses = message
      .split(/[，,。；;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (clauses.length > 1) {
      let workingGarden = garden;
      let workingDesignIntent = designIntent;
      const summaries: string[] = [];
      let allHandled = true;
      for (const clause of clauses) {
        const result = applyLocalDesignCommandClause(clause, workingGarden, workingDesignIntent);
        if (!result.handled) {
          allHandled = false;
          break;
        }
        workingGarden = result.garden;
        workingDesignIntent = result.designIntent;
        if (result.summary) summaries.push(result.summary);
      }
      if (allHandled) {
        captureUndoSnapshot();
        setGarden(workingGarden);
        setDesignIntent(workingDesignIntent);
        setDesignIntentSummary(summaries.join("；"));
        setDesignIntentChanges(summarizeDesignIntentChanges(designIntent, workingDesignIntent));
        setEditMode(false);
        setSelectedCell(null);
        return;
      }
    }
    const bandPlantPreferenceCommand = resolveBandPlantPreferenceCommand(message);
    if (bandPlantPreferenceCommand) {
      captureUndoSnapshot();
      let workingGarden = garden;
      const preferenceKey =
        bandPlantPreferenceCommand.band === "front"
          ? "frontPreferences"
          : bandPlantPreferenceCommand.band === "middle"
            ? "middlePreferences"
            : "backPreferences";
      const nextDesignIntent = applyDesignIntentPatch(designIntent, {
        plant: {
          [preferenceKey]: Object.fromEntries(
            bandPlantPreferenceCommand.matchedIds.map((id) => [id, bandPlantPreferenceCommand.action === "increase" ? 1 : -1])
          ),
        },
      });
      let removedCount = 0;
      if (bandPlantPreferenceCommand.action === "decrease") {
        const removal = removeBandPlantsByIds(
          workingGarden,
          bandPlantPreferenceCommand.band,
          new Set(bandPlantPreferenceCommand.matchedIds),
          "remove"
        );
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      }
      setDesignIntent(nextDesignIntent);
      setDesignIntentChanges(summarizeDesignIntentChanges(designIntent, nextDesignIntent));
      if (bandPlantPreferenceCommand.shouldGenerate) {
        setGarden(() =>
          generateAutoLayout(workingGarden, allVariants, {
            designIntent: nextDesignIntent,
          })
        );
        setEditMode(false);
        setSelectedCell(null);
      } else if (bandPlantPreferenceCommand.action === "decrease") {
        setGarden(workingGarden);
      }
      const bandLabel =
        bandPlantPreferenceCommand.band === "front"
          ? "前排"
          : bandPlantPreferenceCommand.band === "middle"
            ? "中排"
            : "后排";
      setDesignIntentSummary(
        bandPlantPreferenceCommand.action === "increase"
          ? `已提高 ${bandPlantPreferenceCommand.query} 在${bandLabel}的生成权重，并重新生成布局。`
          : removedCount > 0
            ? `已减少${bandLabel}的 ${bandPlantPreferenceCommand.query}，并按新的${bandLabel}偏好重新生成布局。`
            : `已设置${bandLabel}不要 ${bandPlantPreferenceCommand.query}，并按新的${bandLabel}偏好重新生成布局。`
      );
      return;
    }
    const centerPlantPreferenceCommand = resolveCenterPlantPreferenceCommand(message);
    if (centerPlantPreferenceCommand) {
      captureUndoSnapshot();
      let workingGarden = garden;
      const nextDesignIntent = applyDesignIntentPatch(designIntent, {
        plant: {
          centerPreferences: Object.fromEntries(
            centerPlantPreferenceCommand.matchedIds.map((id) => [
              id,
              centerPlantPreferenceCommand.action === "increase" ? 1 : -1,
            ])
          ),
        },
      });
      let removedCount = 0;
      if (centerPlantPreferenceCommand.action === "decrease") {
        const removal = removeCenterPlantsByIds(workingGarden, new Set(centerPlantPreferenceCommand.matchedIds), "remove");
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      }
      setDesignIntent(nextDesignIntent);
      setDesignIntentChanges(summarizeDesignIntentChanges(designIntent, nextDesignIntent));
      if (centerPlantPreferenceCommand.shouldGenerate) {
        setGarden(() =>
          generateAutoLayout(workingGarden, allVariants, {
            designIntent: nextDesignIntent,
          })
        );
        setEditMode(false);
        setSelectedCell(null);
      } else if (centerPlantPreferenceCommand.action === "decrease") {
        setGarden(workingGarden);
      }
      setDesignIntentSummary(
        centerPlantPreferenceCommand.action === "increase"
          ? `已提高 ${centerPlantPreferenceCommand.query} 在中间区域的生成权重，并重新生成布局。`
          : removedCount > 0
            ? `已减少中间区域的 ${centerPlantPreferenceCommand.query}，并按新的中间偏好重新生成布局。`
            : `已设置中间不要 ${centerPlantPreferenceCommand.query}，并按新的中间偏好重新生成布局。`
      );
      return;
    }
    const cornerPlantPreferenceCommand = resolveCornerPlantPreferenceCommand(message);
    if (cornerPlantPreferenceCommand) {
      captureUndoSnapshot();
      let workingGarden = garden;
      const nextDesignIntent = applyDesignIntentPatch(designIntent, {
        plant: {
          cornerPreferences: Object.fromEntries(
            cornerPlantPreferenceCommand.matchedIds.map((id) => [
              id,
              cornerPlantPreferenceCommand.action === "increase" ? 1 : -1,
            ])
          ),
        },
      });
      let removedCount = 0;
      if (cornerPlantPreferenceCommand.action === "decrease") {
        const removal = removeCornerPlantsByIds(workingGarden, new Set(cornerPlantPreferenceCommand.matchedIds), "remove");
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      }
      setDesignIntent(nextDesignIntent);
      setDesignIntentChanges(summarizeDesignIntentChanges(designIntent, nextDesignIntent));
      if (cornerPlantPreferenceCommand.shouldGenerate) {
        setGarden(() =>
          generateAutoLayout(workingGarden, allVariants, {
            designIntent: nextDesignIntent,
          })
        );
        setEditMode(false);
        setSelectedCell(null);
      } else if (cornerPlantPreferenceCommand.action === "decrease") {
        setGarden(workingGarden);
      }
      setDesignIntentSummary(
        cornerPlantPreferenceCommand.action === "increase"
          ? `已提高 ${cornerPlantPreferenceCommand.query} 在角落区域的生成权重，并重新生成布局。`
          : removedCount > 0
            ? `已减少角落区域的 ${cornerPlantPreferenceCommand.query}，并按新的角落偏好重新生成布局。`
            : `已设置角落不要 ${cornerPlantPreferenceCommand.query}，并按新的角落偏好重新生成布局。`
      );
      return;
    }
    const edgePlantPreferenceCommand = resolveEdgePlantPreferenceCommand(message);
    if (edgePlantPreferenceCommand) {
      captureUndoSnapshot();
      let workingGarden = garden;
      const nextDesignIntent = applyDesignIntentPatch(designIntent, {
        plant: {
          edgePreferences: Object.fromEntries(
            edgePlantPreferenceCommand.matchedIds.map((id) => [
              id,
              edgePlantPreferenceCommand.action === "increase" ? 1 : -1,
            ])
          ),
        },
      });
      let removedCount = 0;
      if (edgePlantPreferenceCommand.action === "decrease") {
        const removal = removeEdgePlantsByIds(
          workingGarden,
          new Set(edgePlantPreferenceCommand.matchedIds),
          "remove"
        );
        workingGarden = removal.next;
        removedCount = removal.removedCount;
      }
      setDesignIntent(nextDesignIntent);
      setDesignIntentChanges(summarizeDesignIntentChanges(designIntent, nextDesignIntent));
      if (edgePlantPreferenceCommand.shouldGenerate) {
        setGarden((prev) =>
          generateAutoLayout(edgePlantPreferenceCommand.action === "decrease" ? workingGarden : prev, allVariants, {
            designIntent: nextDesignIntent,
          })
        );
        setEditMode(false);
        setSelectedCell(null);
      } else if (edgePlantPreferenceCommand.action === "decrease") {
        setGarden(workingGarden);
      }
      setDesignIntentSummary(
        edgePlantPreferenceCommand.action === "increase"
          ? `已提高 ${edgePlantPreferenceCommand.query} 在边缘位置的生成权重，并重新生成布局。`
          : removedCount > 0
            ? `已减少边缘的 ${edgePlantPreferenceCommand.query}，并按新的边缘偏好重新生成布局。`
            : `已设置边缘不要 ${edgePlantPreferenceCommand.query}，并按新的边缘偏好重新生成布局。`
      );
      return;
    }
    const plantPreferenceCommand = resolvePlantPreferenceCommand(message);
    if (plantPreferenceCommand) {
      captureUndoSnapshot();
      const nextDesignIntent = applyDesignIntentPatch(designIntent, {
        plant: {
          preferences: Object.fromEntries(plantPreferenceCommand.matchedIds.map((id) => [id, 1])),
        },
      });
      setDesignIntent(nextDesignIntent);
      setDesignIntentSummary(
        plantPreferenceCommand.shouldGenerate
          ? `已提高 ${plantPreferenceCommand.query} 的生成权重，并按当前参数重新生成花园。`
          : `已提高 ${plantPreferenceCommand.query} 的生成权重。`
      );
      setDesignIntentChanges(summarizeDesignIntentChanges(designIntent, nextDesignIntent));
      if (plantPreferenceCommand.shouldGenerate) {
        setGarden((prev) =>
          generateAutoLayout(prev, allVariants, {
            designIntent: nextDesignIntent,
          })
        );
        setEditMode(false);
        setSelectedCell(null);
      }
      return;
    }
    if (resolveAutoGenerateCommand(message)) {
      await autoGenerate();
      setDesignIntentSummary("已按当前参数自动生成花园布局。");
      setDesignIntentChanges([]);
      return;
    }
    const historyCommand = resolveHistoryCommand(message);
    if (historyCommand === "undo") {
      if (canUndo) {
        restorePreviousStep();
        setDesignIntentSummary("已退回上一步。");
        setDesignIntentChanges([]);
      } else {
        setDesignIntentSummary("当前没有可退回的步骤。");
        setDesignIntentChanges([]);
      }
      return;
    }
    if (historyCommand === "redo") {
      if (canRedo) {
        redoPreviousStep();
        setDesignIntentSummary("已重做上一步。");
        setDesignIntentChanges([]);
      } else {
        setDesignIntentSummary("当前没有可重做的步骤。");
        setDesignIntentChanges([]);
      }
      return;
    }
    const plantEditCommand = resolvePlantEditCommand(message);
    if (plantEditCommand) {
      captureUndoSnapshot();
      const { next, removedCount } = removePlantsByIds(
        garden,
        plantEditCommand.matchedIds,
        plantEditCommand.action
      );
      setGarden(next);
      setDesignIntentSummary(
        removedCount > 0
          ? plantEditCommand.action === "remove"
            ? `已从当前布局中去除 ${plantEditCommand.query}，共移除 ${removedCount} 株。`
            : `已减少 ${plantEditCommand.query}，共移除 ${removedCount} 株。`
          : `当前布局里没有 ${plantEditCommand.query}。`
      );
      setDesignIntentChanges(
        removedCount > 0
          ? [
              `${plantEditCommand.action === "remove" ? "removePlant" : "reducePlant"}: ${plantEditCommand.matchedLabels.join(
                " / "
              )} (${removedCount})`,
            ]
          : []
      );
      return;
    }
    captureUndoSnapshot();
    setIsApplyingAiIntent(true);
    try {
      const result = await requestDesignIntentPatch({
        message,
        designIntent,
        zone: garden.zone,
        availableColors,
        availablePlantTargets: categories.map((category) => ({
          key: category.id,
          label: getCategoryDisplayName(category.id, category.name),
        })),
      });
      const loweredColors = Object.entries(result.patch?.color?.preferences ?? {})
        .filter(([color, nextValue]) => {
          const currentValue = designIntent.color.preferences[color] ?? 0;
          return typeof nextValue === "number" && nextValue < currentValue;
        })
        .map(([color]) => color);
      if (loweredColors.length > 0) {
        setColorPruneQueue((prev) => [...prev, ...loweredColors]);
      }
      const nextDesignIntent = applyDesignIntentPatch(designIntent, result.patch);
      setDesignIntent(nextDesignIntent);
      setDesignIntentSummary(result.summary || "");
      setDesignIntentChanges(summarizeDesignIntentChanges(designIntent, nextDesignIntent));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      alert(`AI 建议应用失败：${messageText}`);
    } finally {
      setIsApplyingAiIntent(false);
    }
  }

  function downloadDataUrl(dataUrl: string, filename: string) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function dataUrlToBlob(dataUrl: string) {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  async function fileToDataUrl(file: File) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("读取背景图片失败"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("读取背景图片失败"));
      reader.readAsDataURL(file);
    });
  }

  async function normalizeBackgroundImageDataUrl(dataUrl: string) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("背景图片读取失败"));
      image.src = dataUrl;
    });
    const maxWidth = 1600;
    const maxHeight = 1200;
    const scale = Math.min(1, maxWidth / Math.max(1, img.naturalWidth), maxHeight / Math.max(1, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("浏览器不支持背景图片压缩");
    }
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  function getShareUrl() {
    if (typeof window === "undefined") return "https://plantcanvas.online";
    const { origin, hostname } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "https://plantcanvas.online";
    }
    return origin.replace(/\/+$/, "");
  }

  function loadImageElement(src: string, crossOrigin = false) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      if (crossOrigin) image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`图片加载失败: ${src}`));
      image.src = src;
    });
  }

  function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  async function composeShareImageDataUrl(baseDataUrl: string, shareUrl: string) {
    const baseImage = await loadImageElement(baseDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = baseImage.naturalWidth || baseImage.width;
    canvas.height = baseImage.naturalHeight || baseImage.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("浏览器不支持分享图生成");
    }

    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

    const qrSize = Math.max(58, Math.round(Math.min(canvas.width, canvas.height) * 0.09));
    const padding = Math.max(10, Math.round(canvas.width * 0.01));
    const textWidth = Math.max(112, Math.round(canvas.width * 0.14));
    const cardWidth = Math.max(qrSize, textWidth) + padding * 2;
    const cardHeight = qrSize + padding * 3 + Math.max(16, Math.round(canvas.height * 0.018));
    const cardX = canvas.width - cardWidth - padding;
    const cardY = padding;

    let qrImage: HTMLImageElement | null = null;
    try {
      qrImage = await loadImageElement(
        `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(shareUrl)}`,
        true
      );
    } catch (error) {
      console.warn("[share] QR code image load failed, fallback to URL-only card", error);
    }

    const displayUrl = "plantcanvas.online";
    ctx.fillStyle = "#6f6458";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${Math.max(11, Math.round(canvas.width * 0.01))}px Georgia, serif`;
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.shadowBlur = 8;
    const textY = cardY + padding;
    ctx.fillText(displayUrl, cardX + cardWidth / 2, textY);
    ctx.shadowBlur = 0;

    const qrX = cardX + (cardWidth - qrSize) / 2;
    const qrY = textY + Math.max(16, Math.round(canvas.height * 0.018)) + padding;
    if (qrImage) {
      ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
    } else {
      ctx.strokeStyle = "rgba(94,76,60,0.18)";
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, qrX, qrY, qrSize, qrSize, 12);
      ctx.stroke();
      ctx.fillStyle = "#7b6a58";
      ctx.font = `${Math.max(10, Math.round(qrSize * 0.13))}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("QR", qrX + qrSize / 2, qrY + qrSize / 2);
    }

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  async function handleBackgroundReferenceFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件作为背景参考。");
      return;
    }
    try {
      const rawDataUrl = await fileToDataUrl(file);
      const normalizedDataUrl = await normalizeBackgroundImageDataUrl(rawDataUrl);
      setBackgroundReferenceImage({ name: file.name, dataUrl: normalizedDataUrl });
      setFrontViewPreviewImage("");
      setFrontViewPreviewError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`读取背景图片失败：${message}`);
    }
  }

  function normalizeDatasetStyleName(style: FrontViewExportStyle) {
    return style === "download" ? "raw" : style;
  }

  async function exportTrainingAssets() {
    if (isExportingTrainingAssets || isExportingReport || isStylizingFrontView) return;

    const directoryApi = window as Window & typeof globalThis & {
      showDirectoryPicker?: () => Promise<{
        getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<any>;
      }>;
    };

    if (!directoryApi.showDirectoryPicker) {
      alert("当前浏览器不支持直接写入目录。请使用最新版 Chrome / Edge 再试。");
      return;
    }

    setIsExportingTrainingAssets(true);
    setIsExportingReport(true);
    setReportViewsActive(true);
    setExportProgressText("请选择训练素材输出目录...");
    setExportProgressValue(5);

    try {
      const rootHandle = await directoryApi.showDirectoryPicker();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const styleName = normalizeDatasetStyleName(frontViewExportStyle);
      const datasetRootHandle = await rootHandle.getDirectoryHandle(`training-assets-${styleName}-${stamp}`, { create: true });
      const inputHandle = await datasetRootHandle.getDirectoryHandle("input", { create: true });
      const targetHandle = await datasetRootHandle.getDirectoryHandle("target", { create: true });

      setExportProgressText("正在准备四季 FrontView 原图...");
      setExportProgressValue(12);
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      for (let i = 0; i < reportLoadSeasons.length; i++) {
        const season = reportLoadSeasons[i];
        setExportProgressText(`正在等待 ${season} 季植物加载完成（${i + 1}/${reportLoadSeasons.length}）...`);
        setExportProgressValue(12 + Math.round((i / reportLoadSeasons.length) * 10));
        const view = await waitForReportFrontView(season);
        const seasonBaseName = `${stamp}-${view.season}`;

        setExportProgressText(`正在写入 ${view.season} 原图（${i + 1}/${reportLoadSeasons.length}）...`);
        setExportProgressValue(18 + Math.round(((i + 1) / reportLoadSeasons.length) * 18));
        const inputFileHandle = await inputHandle.getFileHandle(`${seasonBaseName}-input.png`, { create: true });
        const inputWritable = await inputFileHandle.createWritable();
        await inputWritable.write(await dataUrlToBlob(view.frontalPng));
        await inputWritable.close();

        let targetDataUrl = view.frontalPng;
        let targetExt = "png";

        if (frontViewExportStyle !== "download") {
          setExportProgressText(`正在生成 ${view.season} 风格图（${i + 1}/${reportLoadSeasons.length}）...`);
          setExportProgressValue(40 + Math.round(((i + 1) / reportLoadSeasons.length) * 45));
          const stylized = await stylizeFrontViewImage(view.frontalPng, frontViewExportStyle, {
            backgroundImageDataUrl: backgroundReferenceImage?.dataUrl,
          });
          targetDataUrl = stylized.imageDataUrl;
          targetExt = "jpg";
        }

        setExportProgressText(`正在写入 ${view.season} 目标图（${i + 1}/${reportLoadSeasons.length}）...`);
        setExportProgressValue(65 + Math.round(((i + 1) / reportLoadSeasons.length) * 25));
        const targetFileHandle = await targetHandle.getFileHandle(
          `${seasonBaseName}-${styleName}-target.${targetExt}`,
          { create: true }
        );
        const targetWritable = await targetFileHandle.createWritable();
        await targetWritable.write(await dataUrlToBlob(targetDataUrl));
        await targetWritable.close();
      }

      const metaHandle = await datasetRootHandle.getFileHandle("metadata.json", { create: true });
      const metaWritable = await metaHandle.createWritable();
      await metaWritable.write(
        JSON.stringify(
          {
            generatedAt: stamp,
            style: styleName,
            seasons: reportDisplaySeasons,
            garden: {
              rows: garden.rows,
              cols: garden.cols,
              zone: garden.zone,
              season: garden.season,
            },
            designIntent,
            exportContext: {
              frontViewExportStyle,
              rowGapRatio,
              backgroundReferenceImageName: backgroundReferenceImage?.name || "",
            },
            namingRule: {
              input: "{timestamp}-{season}-input.png",
              target: `{timestamp}-{season}-${styleName}-target.${frontViewExportStyle === "download" ? "png" : "jpg"}`,
            },
          },
          null,
          2
        )
      );
      await metaWritable.close();

      setExportProgressText("训练素材已输出到所选目录。");
      setExportProgressValue(100);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setExportProgressText("");
        setExportProgressValue(null);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      alert(`生成训练素材失败：${message}`);
    } finally {
      setReportViewsActive(false);
      window.setTimeout(() => {
        setIsExportingTrainingAssets(false);
        setIsExportingReport(false);
        setExportProgressText("");
        setExportProgressValue(null);
      }, 0);
    }
  }

  async function exportFrontViewPng() {
    const url = frontViewRef.current?.exportPng();
    if (!url) {
      alert("当前 FrontView 还没有可导出的画布。");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (isStylizingFrontView) return;
    setIsStylizingFrontView(true);
    const shareUrl = getShareUrl();
    setExportProgressText(frontViewExportStyle === "download" ? "正在准备导出当前效果图..." : "正在上传当前效果图并生成风格版本...");
    setExportProgressValue(frontViewExportStyle === "download" ? 30 : 20);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      let exportImageDataUrl = url;
      if (frontViewExportStyle !== "download") {
        const result = await stylizeFrontViewImage(url, frontViewExportStyle, {
          backgroundImageDataUrl: backgroundReferenceImage?.dataUrl,
        });
        exportImageDataUrl = result.imageDataUrl;
      }
      setExportProgressText("正在叠加分享信息...");
      setExportProgressValue(88);
      const shareImageDataUrl = await composeShareImageDataUrl(exportImageDataUrl, shareUrl);
      setExportProgressText("效果图已生成，正在下载...");
      setExportProgressValue(96);
      downloadDataUrl(shareImageDataUrl, `frontview-${frontViewExportStyle}-${stamp}.jpg`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`风格化失败：${message}`);
    } finally {
      setExportProgressText("");
      setExportProgressValue(null);
      window.setTimeout(() => setIsStylizingFrontView(false), 0);
    }
  }

  async function showFrontViewPreview() {
    const url = frontViewRef.current?.exportPng();
    if (!url) {
      alert("当前 FrontView 还没有可预览的画布。");
      return;
    }

    setFrontViewMode("preview");
    setFrontViewPreviewError("");

    if (frontViewExportStyle === "download") {
      setFrontViewPreviewImage(url);
      return;
    }

    if (isGeneratingFrontViewPreview) return;
    setIsGeneratingFrontViewPreview(true);
    setFrontViewPreviewImage("");
    try {
      const result = await stylizeFrontViewImage(url, frontViewExportStyle, {
        backgroundImageDataUrl: backgroundReferenceImage?.dataUrl,
      });
      setFrontViewPreviewImage(result.imageDataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFrontViewPreviewError(message);
    } finally {
      setIsGeneratingFrontViewPreview(false);
    }
  }

  function getReportFrontViewRef(season: Season) {
    return season === "spring"
      ? springFrontalReportFrontViewRef
      : season === "summer"
        ? summerFrontalReportFrontViewRef
        : season === "autumn"
          ? autumnFrontalReportFrontViewRef
          : winterFrontalReportFrontViewRef;
  }

  async function waitForReportFrontView(season: Season, timeoutMs = 15000) {
    const startedAt = Date.now();
    let lastLoggedAt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const ref = getReportFrontViewRef(season).current;
      const ready = ref?.isReadyForExport() ?? false;

      if (ready && ref) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        const frontalPng = ref.exportPng() ?? "";
        if (frontalPng) {
          return { season, frontalPng };
        }
      }

      if (!ref) {
        console.log(`[report] waiting for ${season} ref to mount`);
      } else if (!ready) {
        const now = Date.now();
        if (now - lastLoggedAt > 1000) {
          lastLoggedAt = now;
          console.log(`[report] waiting for ${season} render to be ready`, ref.getExportStatus());
        }
      } else {
        console.log(`[report] ${season} ready but export returned empty png, retrying`);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    const fallbackRef = getReportFrontViewRef(season).current;
    const fallbackPng = fallbackRef?.exportPng() ?? "";
    if (fallbackPng) {
      console.warn(`[report] ${season} timed out waiting for full readiness; using fallback export`, fallbackRef?.getExportStatus());
      return { season, frontalPng: fallbackPng };
    }

    throw new Error(`${season} 季 FrontView 还没有准备好，请稍等后再试。`);
  }

  async function exportDesignReport() {
    if (isExportingReport) return;
    setIsExportingReport(true);
    setReportViewsActive(true);
    setExportProgressText("正在准备四季视图并整理设计说明...");
    setExportProgressValue(10);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    try {
      let seasonalViews: Array<{ season: Season; frontalPng: string }> = [];
      for (let i = 0; i < reportLoadSeasons.length; i++) {
        const season = reportLoadSeasons[i];
        setExportProgressText(`正在等待 ${season} 季植物加载完成（${i + 1}/${reportLoadSeasons.length}）...`);
        setExportProgressValue(10 + Math.round((i / reportLoadSeasons.length) * 12));
        const view = await waitForReportFrontView(season);

        if (frontViewExportStyle !== "download") {
          setExportProgressText(`正在生成 ${view.season} 风格图（${i + 1}/${reportLoadSeasons.length}）...`);
          setExportProgressValue(15 + Math.round(((i + 1) / reportLoadSeasons.length) * 60));
          let stylized;
          try {
            stylized = await stylizeFrontViewImage(view.frontalPng, frontViewExportStyle, {
              backgroundImageDataUrl: backgroundReferenceImage?.dataUrl,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${view.season} 季效果图生成失败：${message}`);
          }
          seasonalViews.push({
            ...view,
            frontalPng: stylized.imageDataUrl,
          });
        } else {
          seasonalViews.push(view);
          setExportProgressValue(55);
        }
      }

      const orderedSeasonalViews = reportDisplaySeasons
        .map((season) => seasonalViews.find((view) => view.season === season))
        .filter((view): view is { season: Season; frontalPng: string } => !!view);
      console.log("[report] load season order =", reportLoadSeasons.join(" -> "));
      console.log("[report] display season order =", reportDisplaySeasons.join(" -> "));
      console.log("[report] final seasonalViews order =", orderedSeasonalViews.map((view) => view.season).join(" -> "));

      setExportProgressText("正在生成植物清单和布局说明...");
      setExportProgressValue(80);
      const plants = buildDesignReportPlantRows(garden, allVariants);
      const layoutSvg = buildDesignLayoutSvg(garden, allVariants);
      const html = buildDesignReportHtml({
        title: "Garden Design Report",
        garden,
        variants: allVariants,
        plants,
        layoutSvg,
        seasonalViews: orderedSeasonalViews,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`导出设计说明失败：${message}`);
    } finally {
      setReportViewsActive(false);
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
      captureUndoSnapshot();
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
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
      const isRedo =
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z") ||
        (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "y");

      if (isRedo) {
        if (isEditable) return;
        if (!canRedo) return;
        event.preventDefault();
        redoPreviousStep();
        return;
      }
      if (isUndo) {
        if (isEditable) return;
        if (!canUndo) return;
        event.preventDefault();
        restorePreviousStep();
        return;
      }

      if (!selectedCell) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditable) return;

      event.preventDefault();
      choosePlant(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canRedo, canUndo, selectedCell, garden, allVariants]);

  useEffect(() => {
    if (skipAutoAdjustRef.current) return;
    setGarden((prev) =>
      prunePlantsByHeightRange(
        prev,
        allVariants,
        designIntent
      )
    );
  }, [
    allVariants,
    designIntent.height.frontMin,
    designIntent.height.backMin,
    designIntent.height.frontMax,
    designIntent.height.backMax,
  ]);

  useEffect(() => {
    if (skipAutoAdjustRef.current) return;
    const previousHeight = previousHeightRef.current;
    const nextHeight = designIntent.height;
    previousHeightRef.current = structuredClone(nextHeight);
    if (allVariants.length === 0) return;
    const heightRaised =
      nextHeight.frontMin > previousHeight.frontMin ||
      nextHeight.backMin > previousHeight.backMin ||
      nextHeight.frontMax > previousHeight.frontMax ||
      nextHeight.backMax > previousHeight.backMax;
    if (!heightRaised) return;
    setGarden((prev) =>
      generateAutoLayout(
        prunePlantsByHeightRange(prev, allVariants, designIntentRef.current),
        allVariants,
        {
          designIntent: designIntentRef.current,
        }
      )
    );
  }, [
    allVariants,
    designIntent.height.frontMin,
    designIntent.height.backMin,
    designIntent.height.frontMax,
    designIntent.height.backMax,
  ]);

  useEffect(() => {
    if (skipAutoAdjustRef.current) return;
    setGarden((prev) =>
      prunePlantsByDensityTargets(
        prev,
        allVariants,
        designIntent,
        lastDensityBand ?? undefined
      )
    );
  }, [
    allVariants,
    designIntent.density.front,
    designIntent.density.middle,
    designIntent.density.back,
    lastDensityBand,
  ]);

  useEffect(() => {
    if (skipAutoAdjustRef.current) return;
    const previousDensity = previousDensityRef.current;
    const nextDensity = designIntent.density;
    previousDensityRef.current = structuredClone(nextDensity);
    if (allVariants.length === 0) return;
    if (
      nextDensity.front <= previousDensity.front &&
      nextDensity.middle <= previousDensity.middle &&
      nextDensity.back <= previousDensity.back
    ) {
      return;
    }
    setGarden((prev) =>
      generateAutoLayout(prev, allVariants, {
        designIntent: designIntentRef.current,
      })
    );
  }, [
    allVariants,
    designIntent.density.front,
    designIntent.density.middle,
    designIntent.density.back,
  ]);

  useEffect(() => {
    if (skipAutoAdjustRef.current) return;
    if (colorPruneQueue.length === 0) return;
    const [nextColor, ...rest] = colorPruneQueue;
    setGarden((prev) =>
      prunePlantsByColorPreferences(prev, allVariants, designIntent, nextColor)
    );
    setColorPruneQueue(rest);
  }, [allVariants, colorPruneQueue, designIntent]);

  useEffect(() => {
    if (skipAutoAdjustRef.current) return;
    const previousSymmetry = previousSymmetryRef.current;
    const nextSymmetry = designIntent.layout.symmetry;
    previousSymmetryRef.current = nextSymmetry;
    if (allVariants.length === 0) return;
    if (nextSymmetry <= previousSymmetry) return;
    setGarden((prev) => adjustSymmetry(prev, allVariants, designIntentRef.current));
  }, [allVariants, designIntent.layout.symmetry]);

  useEffect(() => {
    if (skipAutoAdjustRef.current) return;
    setGarden((prev) => prunePlantsByZone(prev, allVariants));
  }, [allVariants, garden.zone]);

  useEffect(() => {
    if (!skipAutoAdjustRef.current) return;
    skipAutoAdjustRef.current = false;
  }, [garden, designIntent]);

  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem("garden-tutorial-dismissed");
      if (!dismissed) {
        setShowTutorial(true);
        setTutorialStep(0);
      }
    } catch {
      setShowTutorial(true);
      setTutorialStep(0);
    }
  }, []);

  useEffect(() => {
    if (!showTutorial) return;
    if (tutorialStep === 1) setRightPanel("auto");
    if (tutorialStep === 3) setRightPanel("catalog");
  }, [showTutorial, tutorialStep]);

  useEffect(() => {
    setFrontViewPreviewImage("");
    setFrontViewPreviewError("");
  }, [garden, rowGap, colGap, canvasWidth, frontViewExportStyle, backgroundReferenceImage?.dataUrl]);

  useEffect(() => {
    if (!showTutorial) {
      setTutorialTargetRect(null);
      return;
    }

    const resolveTarget = () => {
      if (tutorialStep === 0) return tutorialExportControlsRef.current;
      if (tutorialStep === 1) return autoPanelRef.current;
      if (tutorialStep === 2) return frontEditorRef.current;
      if (tutorialStep === 3) return catalogPanelRef.current;
      return null;
    };

    const updateRect = () => {
      const target = resolveTarget();
      if (!target) {
        setTutorialTargetRect(null);
        return;
      }
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      setTutorialTargetRect(target.getBoundingClientRect());
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [showTutorial, tutorialStep, rightPanel]);

  function closeTutorial(remember = true) {
    setShowTutorial(false);
    setTutorialStep(0);
    setRightPanel("auto");
    if (!remember) return;
    try {
      window.localStorage.setItem("garden-tutorial-dismissed", "1");
    } catch {
      // ignore storage failures
    }
  }

  const tutorialSteps = [
    {
      title: "导出与风格区",
      text:
        "先选季节，再选导出风格。这里可以导出当前效果图，也可以导出带植物清单、layout 和四季效果图的设计说明。",
    },
    {
      title: "自动生成植物",
      text:
        "右侧默认打开这个面板。先点 `自动生成布局`，然后再调高度、梯度、对称性、成片感、颜色偏好和前中后排密度。",
    },
    {
      title: "Front View 编辑区",
      text:
        "左侧是主要编辑画面。点击画面进入编辑模式，之后可以选中具体位置，再切到 `选植物` 面板做手动摆放。选中已有植物后，按 `Delete` 或 `Backspace` 可以直接删除。",
    },
    {
      title: "选植物面板",
      text:
        "这里适合做细调。自动生成后，如果你想换掉某几株、补几株，或者按自己的想法手动摆放，就在这个面板完成。",
    },
  ] as const;
  const activeTutorial = tutorialSteps[tutorialStep] ?? tutorialSteps[0];

  return (
    <div style={{ padding: 16, maxWidth: 1800, margin: "0 auto", width: "100%", boxSizing: "border-box", overflowX: "clip" }}>
      <div style={{ marginBottom: 12 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.html,.htm,text/plain,text/html"
          onChange={onImportFile}
          style={{ display: "none" }}
        />
      </div>

      {reportViewsActive ? (
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
          {reportLoadSeasons.map((season) => {
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
      ) : null}
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
            ? exportProgressText || "正在生成布局，请稍等..."
            : isExportingReport
              ? exportProgressText || "正在整理并导出设计说明，请稍等..."
              : exportProgressText || "正在调用风格化接口并下载图片，请稍等..."}
        </div>
      ) : isCatalogLoading ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#faf7f1",
            border: "1px solid #e2ddd2",
            color: "#766a58",
            fontSize: 13,
          }}
        >
          正在加载植物库，请稍等...
        </div>
      ) : null}

      {showTutorial && tutorialTargetRect ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, pointerEvents: "none" }}>
          <div
            style={{
              position: "fixed",
              left: tutorialTargetRect.left - 8,
              top: tutorialTargetRect.top - 8,
              width: tutorialTargetRect.width + 16,
              height: tutorialTargetRect.height + 16,
              borderRadius: 18,
              border: "2px solid #ffffff",
              boxShadow: "0 0 0 9999px rgba(21, 18, 12, 0.42), 0 0 0 1px rgba(47,61,47,0.4), 0 18px 48px rgba(0,0,0,0.18)",
            }}
          />
          <div
            style={{
              position: "fixed",
              top: Math.min(window.innerHeight - 230, tutorialTargetRect.bottom + 16),
              left: Math.min(window.innerWidth - 356, Math.max(16, tutorialTargetRect.left)),
              width: 340,
              background: "#fffdf8",
              border: "1px solid #e2ddd2",
              borderRadius: 18,
              boxShadow: "0 18px 60px rgba(20, 16, 10, 0.22)",
              padding: 18,
              pointerEvents: "auto",
            }}
          >
            <div style={{ fontSize: 12, color: "#8b7e6e", marginBottom: 6 }}>
              新用户教程 {tutorialStep + 1} / {tutorialSteps.length}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#2f3d2f", marginBottom: 8 }}>{activeTutorial.title}</div>
            <div style={{ fontSize: 13, color: "#5c665a", lineHeight: 1.7 }}>{activeTutorial.text}</div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 16 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setTutorialStep((prev) => Math.max(0, prev - 1))}
                  disabled={tutorialStep === 0}
                  style={{ padding: "9px 12px", borderRadius: 10, background: "#fff", border: "1px solid #d9d9d9" }}
                >
                  上一步
                </button>
                <button
                  onClick={() => closeTutorial(false)}
                  style={{ padding: "9px 12px", borderRadius: 10, background: "#fff", border: "1px solid #d9d9d9" }}
                >
                  先关闭
                </button>
              </div>
              {tutorialStep < tutorialSteps.length - 1 ? (
                <button onClick={() => setTutorialStep((prev) => Math.min(tutorialSteps.length - 1, prev + 1))} style={{ padding: "9px 14px", borderRadius: 10 }}>
                  下一步
                </button>
              ) : (
                <button onClick={() => closeTutorial(true)} style={{ padding: "9px 14px", borderRadius: 10 }}>
                  我知道了
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={editorRef}
        style={{
          display: "grid",
          gridTemplateColumns: isCompactLayout ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(340px, 430px)",
          gap: isCompactLayout ? 16 : 20,
          alignItems: "flex-start",
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          overflowX: "clip",
        }}
      >
        <div
          ref={frontEditorRef}
          style={{
            minWidth: 0,
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            overflowX: "clip",
          }}
        >
          <div ref={frontPaneRef} style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", overflowX: "clip" }}>
            <div
              style={{
                marginBottom: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 13, color: "#666" }}>
                {frontViewMode === "edit"
                  ? "点击左侧 front view 进入编辑，点击外部退出编辑。选中已有植物后，可按 Delete / Backspace，或点“删除植物”按钮。"
                  : "效果预览是静态图，不可编辑；切回编辑模式后可继续摆放和删除植物。"}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={restorePreviousStep}
                  disabled={!canUndo}
                  title={canUndo ? `恢复到上一步布局与参数（剩余 ${undoDepth} 步，Ctrl/Cmd + Z）` : "当前没有可撤回的更改"}
                  aria-label="退回上一步"
                  style={{
                    width: 34,
                    height: 34,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    border: "1px solid #cdbdb3",
                    background: canUndo ? "#f6f1e8" : "#f2ede7",
                    color: canUndo ? "#5e4c3c" : "#9b9185",
                    cursor: canUndo ? "pointer" : "not-allowed",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6.5 3.5 2.5 7.5l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 7.5h5.25a4.25 4.25 0 0 1 0 8.5H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={redoPreviousStep}
                  disabled={!canRedo}
                  title={
                    canRedo
                      ? `恢复刚才撤回的步骤（剩余 ${redoDepth} 步，Ctrl+Y / Cmd/Ctrl + Shift + Z）`
                      : "当前没有可重做的更改"
                  }
                  aria-label="重做"
                  style={{
                    width: 34,
                    height: 34,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    border: "1px solid #cdbdb3",
                    background: canRedo ? "#f6f1e8" : "#f2ede7",
                    color: canRedo ? "#5e4c3c" : "#9b9185",
                    cursor: canRedo ? "pointer" : "not-allowed",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="m9.5 3.5 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M13 7.5H7.75a4.25 4.25 0 0 0 0 8.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => choosePlant(null)}
                  disabled={!selectedPlantAnchor}
                  title={selectedPlantAnchor ? "删除当前选中的植物" : "请先选中一个植物再删除"}
                  aria-label="删除植物"
                  style={{
                    width: 34,
                    height: 34,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    border: "1px solid #cdbdb3",
                    background: selectedPlantAnchor ? "#fff7f3" : "#f2ede7",
                    color: selectedPlantAnchor ? "#7f4a36" : "#9b9185",
                    cursor: selectedPlantAnchor ? "pointer" : "not-allowed",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 4.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M6 2.75h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M5 4.5v7.25c0 .41.34.75.75.75h4.5c.41 0 .75-.34.75-.75V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6.75 6.5v4M9.25 6.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <div
                  style={{
                    display: "inline-flex",
                    gap: 6,
                    padding: 4,
                    borderRadius: 999,
                    background: "#f3efe7",
                    border: "1px solid #e0d8cb",
                  }}
                >
                <button
                  type="button"
                  onClick={() => setFrontViewMode("edit")}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: frontViewMode === "edit" ? "1px solid #6e8f72" : "1px solid transparent",
                    background: frontViewMode === "edit" ? "#eef6ee" : "transparent",
                    color: "#2f3d2f",
                  }}
                >
                  编辑模式
                </button>
                <button
                  type="button"
                  onClick={showFrontViewPreview}
                  disabled={isGeneratingFrontViewPreview}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: frontViewMode === "preview" ? "1px solid #6e8f72" : "1px solid transparent",
                    background: frontViewMode === "preview" ? "#eef6ee" : "transparent",
                    color: "#2f3d2f",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isGeneratingFrontViewPreview ? "生成预览中..." : "效果预览"}
                </button>
                </div>
                <div
                  ref={tutorialExportControlsRef}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                    marginLeft: 6,
                  }}
                >
                  <select
                    value={garden.season}
                    onChange={(e) => {
                      captureUndoSnapshot();
                      setGarden((g) => ({ ...g, season: e.target.value as Season }));
                    }}
                    style={{ height: 32 }}
                  >
                    <option value="spring">spring</option>
                    <option value="summer">summer</option>
                    <option value="autumn">autumn</option>
                    <option value="winter">winter</option>
                  </select>
                  <select
                    value={frontViewExportStyle}
                    onChange={(e) => setFrontViewExportStyle(e.target.value as FrontViewExportStyle)}
                    style={{ height: 32 }}
                  >
                    <option value="download">原图</option>
                    <option value="monet">莫奈</option>
                    <option value="impressionist">印象派</option>
                    <option value="watercolor">水彩</option>
                    <option value="vangogh">梵高</option>
                    <option value="ukiyoe">浮世绘</option>
                    <option value="animebg">动画背景</option>
                    <option value="architectural">景观效果图</option>
                    <option value="botanical">植物学插画</option>
                    <option value="pastel">粉彩</option>
                  </select>
                  <input
                    ref={backgroundImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      void handleBackgroundReferenceFile(e.currentTarget.files?.[0] ?? null);
                      e.currentTarget.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => backgroundImageInputRef.current?.click()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid #cdbdb3",
                      background: "#f6f1e8",
                      color: "#5e4c3c",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                    title="上传一张房子或立面背景图，生成效果图时会让 AI 参考这个背景"
                  >
                    {backgroundReferenceImage ? "更换背景" : "上传背景"}
                  </button>
                  {backgroundReferenceImage ? (
                    <>
                      <span
                        title={backgroundReferenceImage.name}
                        style={{
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                          color: "#6f6558",
                          padding: "0 2px",
                        }}
                      >
                        {backgroundReferenceImage.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setBackgroundReferenceImage(null);
                          setFrontViewPreviewImage("");
                          setFrontViewPreviewError("");
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "1px solid #d9d0c4",
                          background: "#fbf7ef",
                          color: "#7a6d5e",
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}
                      >
                        清除背景
                      </button>
                    </>
                  ) : null}
                  <details style={{ position: "relative" }}>
                    <summary
                      style={{
                        listStyle: "none",
                        padding: "6px 12px",
                        borderRadius: 999,
                        border: "1px solid #cdbdb3",
                        background: "#f6f1e8",
                        color: "#5e4c3c",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      导出 ▾
                    </summary>
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        right: 0,
                        minWidth: 188,
                        padding: 8,
                        borderRadius: 12,
                        border: "1px solid #ddd5c8",
                        background: "#fffdf8",
                        boxShadow: "0 10px 28px rgba(56, 47, 39, 0.12)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        zIndex: 20,
                      }}
                    >
                      <button
                        onClick={exportFrontViewPng}
                        disabled={isStylizingFrontView}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #e0d5c8",
                          background: isStylizingFrontView ? "#f2ede7" : "#fff",
                          color: isStylizingFrontView ? "#9b9185" : "#5e4c3c",
                          textAlign: "left",
                          cursor: isStylizingFrontView ? "not-allowed" : "pointer",
                        }}
                      >
                        {isStylizingFrontView ? "正在生成风格图..." : "导出效果图"}
                      </button>
                      <button
                        onClick={exportTrainingAssets}
                        disabled={isExportingTrainingAssets || isExportingReport || isStylizingFrontView}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #e0d5c8",
                          background:
                            isExportingTrainingAssets || isExportingReport || isStylizingFrontView ? "#f2ede7" : "#fff",
                          color:
                            isExportingTrainingAssets || isExportingReport || isStylizingFrontView ? "#9b9185" : "#5e4c3c",
                          textAlign: "left",
                          cursor:
                            isExportingTrainingAssets || isExportingReport || isStylizingFrontView ? "not-allowed" : "pointer",
                        }}
                      >
                        {isExportingTrainingAssets ? "正在生成训练素材..." : "生成训练素材"}
                      </button>
                      <button
                        onClick={exportDesignReport}
                        disabled={isExportingReport}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #e0d5c8",
                          background: isExportingReport ? "#f2ede7" : "#fff",
                          color: isExportingReport ? "#9b9185" : "#5e4c3c",
                          textAlign: "left",
                          cursor: isExportingReport ? "not-allowed" : "pointer",
                        }}
                      >
                        {isExportingReport ? "正在导出设计说明..." : "导出设计说明"}
                      </button>
                    </div>
                  </details>
                  <label>
                    Depth (ft):
                    <input
                      type="number"
                      min={1}
                      value={rowsInput}
                      onChange={(e) => setRowsInput(Number(e.target.value))}
                      style={{ width: 70, marginLeft: 6 }}
                    />
                  </label>
                  <label>
                    Width (ft):
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
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <div style={{ flex: "1 1 auto", minWidth: 0, width: "100%", position: "relative" }}>
                <div style={{ display: frontViewMode === "edit" ? "block" : "none" }}>
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
                    onTextureLoadProgressChange={setFrontViewTextureLoadProgress}
                  />
                </div>
                {!isCompactLayout ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 6,
                      width: 28,
                      height: 420,
                      display: "flex",
                      alignItems: "stretch",
                      justifyContent: "center",
                      pointerEvents: "none",
                    }}
                  >
                    <input
                      type="range"
                      min={0.15}
                      max={1}
                      step={0.01}
                      value={rowGapRatio}
                      onChange={(e) => setRowGapRatio(Number(e.target.value))}
                      style={{
                        width: "100%",
                        height: "100%",
                        margin: 0,
                        writingMode: "vertical-lr",
                        WebkitAppearance: "slider-vertical",
                        appearance: "auto",
                        direction: "rtl",
                        pointerEvents: "auto",
                        opacity: 0.92,
                      }}
                    />
                  </div>
                ) : null}
                {frontViewMode === "preview" ? (
                  <div
                    style={{
                      width: "100%",
                      maxWidth: canvasWidth,
                      minHeight: 420,
                      borderRadius: 16,
                      overflow: "hidden",
                      border: "1px solid #ddd5c8",
                      background: "#f8f4ec",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                    }}
                  >
                    {frontViewPreviewImage ? (
                      <img
                        src={frontViewPreviewImage}
                        alt="front view stylized preview"
                        style={{ display: "block", width: "100%", height: "auto" }}
                      />
                    ) : (
                      <div style={{ padding: 24, textAlign: "center", color: "#6e665b", fontSize: 13 }}>
                        {frontViewPreviewError
                          ? `效果预览生成失败：${frontViewPreviewError}`
                          : isGeneratingFrontViewPreview
                            ? "正在生成当前效果图预览..."
                            : "点击“效果预览”生成当前 FrontView 的静态效果图。"}
                      </div>
                    )}
                    {frontViewPreviewImage && !isGeneratingFrontViewPreview ? (
                      <button
                        type="button"
                        onClick={showFrontViewPreview}
                        style={{
                          position: "absolute",
                          top: 12,
                          right: 12,
                          padding: "7px 10px",
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.92)",
                          border: "1px solid #d9d9d9",
                        }}
                      >
                        刷新预览
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {isCompactLayout ? (
                <div style={{ width: "100%", paddingTop: 4 }}>
                  <input
                    type="range"
                    min={0.15}
                    max={1}
                    step={0.01}
                    value={rowGapRatio}
                    onChange={(e) => setRowGapRatio(Number(e.target.value))}
                    style={{ width: "100%", minWidth: 180 }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          ref={catalogPaneRef}
          style={{
            width: "100%",
            position: isCompactLayout ? "static" : "sticky",
            top: isCompactLayout ? undefined : 16,
            alignSelf: "flex-start",
            minWidth: 0,
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
        >
          <div style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => setRightPanel("catalog")}
                style={{
                  flex: isPhoneLayout ? "1 1 calc(50% - 4px)" : 1,
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
                  flex: isPhoneLayout ? "1 1 calc(50% - 4px)" : 1,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: rightPanel === "auto" ? "1px solid #5f7a61" : "1px solid #d9d9d9",
                  background: rightPanel === "auto" ? "#eef6ee" : "#fff",
                }}
              >
                自动生成植物
              </button>
              <button
                onClick={() => setShowTutorial(true)}
                title="打开新用户教程"
                aria-label="打开新用户教程"
                style={{
                  flex: "0 0 auto",
                  width: 34,
                  height: 34,
                  marginLeft: isPhoneLayout ? "auto" : 0,
                  padding: 0,
                  borderRadius: 999,
                  border: "1px solid #d9d9d9",
                  background: "#fff",
                  color: "#6e665b",
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                ?
              </button>
            </div>
            {rightPanel === "catalog" ? (
              <div ref={catalogPanelRef}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  {selectedCell ? `选中位置: Depth ${selectedCell.r} ft, Width ${selectedCell.c} ft` : "请选择一个格子"}
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
            ) : (
              <div
                ref={autoPanelRef}
                style={{
                  width: "100%",
                  minWidth: 0,
                  border: "1px solid #e2ddd2",
                  borderRadius: 14,
                  background: "#faf7f1",
                  padding: 16,
                  color: "#766a58",
                  fontSize: 13,
                  lineHeight: 1.7,
                  boxSizing: "border-box",
                  overflowX: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#2f3d2f" }}>
                    自动生成植物
                  </div>
                  <button
                    type="button"
                    onClick={triggerImport}
                    style={{
                      flex: "0 0 auto",
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid #d7d7d7",
                      background: "#f6f3ed",
                      color: "#6e665b",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    导入布局
                  </button>
                </div>
                <div
                  style={{
                    marginBottom: 14,
                    padding: 12,
                    borderRadius: 12,
                    background: "#f5f8f2",
                    border: "1px solid #d7e2d1",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#2f3d2f", marginBottom: 8 }}>AI 设计建议</div>
                  <textarea
                    value={designIntentMessage}
                    onChange={(event) => setDesignIntentMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey) return;
                      event.preventDefault();
                      if (!designIntentMessage.trim() || isApplyingAiIntent) return;
                      void applyAiDesignIntent();
                    }}
                    placeholder="例如：后排高一些，多一点白花，整体更对称。"
                    rows={3}
                    style={{
                      width: "100%",
                      resize: "vertical",
                      borderRadius: 10,
                      border: "1px solid #d7d7d7",
                      padding: 10,
                      fontSize: 13,
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                      marginBottom: 8,
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 12, color: "#6e665b", lineHeight: 1.5, flex: "1 1 180px", minWidth: 0 }}>
                      AI 先修改设计参数，你再决定是否自动生成布局。
                    </div>
                    <button
                      onClick={applyAiDesignIntent}
                      disabled={!designIntentMessage.trim() || isApplyingAiIntent}
                      style={{ flex: "0 0 auto", padding: "9px 12px", borderRadius: 10, whiteSpace: "nowrap" }}
                    >
                      {isApplyingAiIntent ? "应用中..." : "应用 AI 建议"}
                    </button>
                  </div>
                  {designIntentSummary ? (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: "#4f5f4f",
                        background: "#fffdf8",
                        border: "1px solid #e2ddd2",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    >
                      {designIntentSummary}
                    </div>
                  ) : null}
                  {designIntentChanges.length > 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: "#4f5f4f",
                        background: "#f8fbf5",
                        border: "1px solid #d7e2d1",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>本次改动</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {designIntentChanges.map((change) => (
                          <div key={change}>{change}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  <button
                    onClick={autoGenerate}
                    disabled={allVariants.length === 0 || isGeneratingLayout}
                    style={{ flex: "1 1 180px", padding: "10px 12px", borderRadius: 10 }}
                  >
                    {isCatalogLoading
                      ? "正在加载植物库..."
                      : isGeneratingLayout
                        ? "正在生成布局..."
                        : "自动生成布局"}
                  </button>
                  <button
                    onClick={confirmClearAllPlants}
                    style={{
                      flex: "1 1 120px",
                      padding: "10px 10px",
                      borderRadius: 10,
                      background: "#6a5a49",
                      border: "1px solid #5b4d3f",
                      color: "#fffdf8",
                      whiteSpace: "nowrap",
                    }}
                  >
                    清空
                  </button>
                </div>
                <div
                  style={{
                    marginBottom: 14,
                    border: "1px solid #e2ddd2",
                    borderRadius: 12,
                    background: "#fffdf8",
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowAutoGenerateControls((prev) => !prev)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 12px",
                      border: "none",
                      background: "transparent",
                      color: "#5c665a",
                      fontSize: 13,
                      fontWeight: 700,
                      textAlign: "left",
                    }}
                  >
                    <span>调整参数</span>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>{showAutoGenerateControls ? "−" : "+"}</span>
                  </button>
                  {showAutoGenerateControls ? (
                    <div style={{ padding: "0 12px 12px" }}>
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
                          onInteractionStart={captureUndoSnapshot}
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
                          width={catalogPaneWidth - 56}
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
                          onInteractionStart={captureUndoSnapshot}
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
                          width={catalogPaneWidth - 56}
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
                          onPointerDown={captureUndoSnapshot}
                          onChange={(e) =>
                            setDesignIntent((prev) => ({
                              ...prev,
                              height: { ...prev.height, gradientStrength: Number(e.target.value) },
                            }))
                          }
                          style={{ width: Math.max(120, catalogPaneWidth - 56) }}
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
                          onPointerDown={captureUndoSnapshot}
                          onChange={(e) =>
                            setDesignIntent((prev) => ({
                              ...prev,
                              layout: { ...prev.layout, symmetry: Number(e.target.value) },
                            }))
                          }
                          style={{ width: Math.max(120, catalogPaneWidth - 56) }}
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
                          onPointerDown={captureUndoSnapshot}
                          onChange={(e) =>
                            setDesignIntent((prev) => ({
                              ...prev,
                              layout: { ...prev.layout, clusteriness: Number(e.target.value) },
                            }))
                          }
                          style={{ width: Math.max(120, catalogPaneWidth - 56) }}
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
                            onPointerDown={captureUndoSnapshot}
                            onChange={(e) => {
                              if (!selectedColorPreference) return;
                              const nextValue = Number(e.target.value);
                              const currentValue = designIntent.color.preferences[selectedColorPreference] ?? 0;
                              if (nextValue < currentValue) {
                                setColorPruneQueue((prev) => [...prev, selectedColorPreference]);
                              }
                              setDesignIntent((prev) => ({
                                ...prev,
                                color: {
                                  preferences: {
                                    ...prev.color.preferences,
                                    [selectedColorPreference]: nextValue,
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
                          onPointerDown={captureUndoSnapshot}
                          onChange={(e) => {
                            setLastDensityBand("front");
                            setDesignIntent((prev) => ({
                              ...prev,
                              density: { ...prev.density, front: Number(e.target.value) },
                            }));
                          }}
                          style={{ width: Math.max(120, catalogPaneWidth - 56) }}
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
                          onPointerDown={captureUndoSnapshot}
                          onChange={(e) => {
                            setLastDensityBand("middle");
                            setDesignIntent((prev) => ({
                              ...prev,
                              density: { ...prev.density, middle: Number(e.target.value) },
                            }));
                          }}
                          style={{ width: Math.max(120, catalogPaneWidth - 56) }}
                        />
                      </div>
                      <div style={{ marginBottom: 2 }}>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          Back Density: {densityStats.back.toFixed(2)} / {designIntent.density.back.toFixed(2)}
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={designIntent.density.back}
                          onPointerDown={captureUndoSnapshot}
                          onChange={(e) => {
                            setLastDensityBand("back");
                            setDesignIntent((prev) => ({
                              ...prev,
                              density: { ...prev.density, back: Number(e.target.value) },
                            }));
                          }}
                          style={{ width: Math.max(120, catalogPaneWidth - 56) }}
                        />
                      </div>
                    </div>
                  ) : null}
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

