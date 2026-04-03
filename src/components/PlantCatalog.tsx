import { useEffect, useMemo, useRef, useState } from "react";
import type { PlantCategory, PlantVariant } from "../type/plants";

export default function PlantCatalog({
  categories,
  disabledReason,
  canSelectVariant,
  onSelectVariant,
  onClear,
  hasSelection,
  panelWidth,
}: {
  categories: PlantCategory[];
  disabledReason?: (variant: PlantVariant) => string | null;
  canSelectVariant: (variant: PlantVariant) => boolean;
  onSelectVariant: (variant: PlantVariant) => void;
  onClear: () => void;
  hasSelection: boolean;
  panelWidth?: number;
}) {
  const [activeCat, setActiveCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [activeColor, setActiveColor] = useState<string>("all");
  const [boundaryOnly, setBoundaryOnly] = useState(false);
  const [evergreenOnly, setEvergreenOnly] = useState(false);
  const [lowMaintenanceOnly, setLowMaintenanceOnly] = useState(false);
  const [hovered, setHovered] = useState<{ v: PlantVariant; x: number; y: number } | null>(null);

  const allVariants = useMemo(() => {
    const list: PlantVariant[] = [];
    for (const cat of categories) list.push(...cat.variants);
    return list;
  }, [categories]);

  const availableColors = useMemo(
    () =>
      Array.from(
        new Set(
          allVariants
            .map((variant) => variant.color?.trim().toLowerCase())
            .filter((color): color is string => !!color)
        )
      ).sort(),
    [allVariants]
  );

  const variants = useMemo(() => {
    const source = activeCat === "all" ? allVariants : categories.find((c) => c.id === activeCat)?.variants ?? [];

    const narrowed = source.filter((variant) => {
      if (activeColor !== "all" && (variant.color?.trim().toLowerCase() ?? "") !== activeColor) return false;
      if (boundaryOnly && !variant.boundary) return false;
      if (evergreenOnly && !variant.evergreen) return false;
      if (lowMaintenanceOnly && (variant.maintenance ?? 3) > 1) return false;
      return true;
    });

    const query = q.trim().toLowerCase();
    if (!query) return narrowed;

    return narrowed.filter((v) => {
      const inName = v.name.toLowerCase().includes(query) || v.id.toLowerCase().includes(query);
      const inTags = (v.tags ?? []).some((t) => t.toLowerCase().includes(query));
      const inColor = (v.color ?? "").toLowerCase().includes(query);
      const inCategory = (v.categoryName ?? "").toLowerCase().includes(query);
      return inName || inTags || inColor || inCategory;
    });
  }, [activeCat, activeColor, allVariants, boundaryOnly, categories, evergreenOnly, lowMaintenanceOnly, q]);

  const layout = useMemo(() => {
    const width = Math.max(240, panelWidth ?? 320);
    return {
      panelMaxWidth: width,
      cardMinHeight: Math.max(72, Math.min(88, Math.floor(width * 0.26))),
      iconSize: Math.max(28, Math.min(40, Math.floor(width * 0.11))),
      tooltipWidth: Math.max(220, Math.min(280, Math.floor(width * 0.9))),
    };
  }, [panelWidth]);

  return (
    <div style={{ width: "100%", maxWidth: layout.panelMaxWidth }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          placeholder="搜索植物名、颜色或标签..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: "6px 8px" }}
        />
        <button
          onClick={onClear}
          disabled={!hasSelection}
          style={{
            padding: "6px 10px",
            cursor: hasSelection ? "pointer" : "not-allowed",
            opacity: hasSelection ? 1 : 0.5,
          }}
        >
          清空
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <button onClick={() => setActiveCat("all")} style={tabStyle(activeCat === "all")}>
          全部
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCat(cat.id)}
            style={tabStyle(activeCat === cat.id)}
            title={getCategoryDisplayName(cat.id, cat.name)}
          >
            {getCategoryDisplayName(cat.id, cat.name)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <button onClick={() => setBoundaryOnly((prev) => !prev)} style={filterChipStyle(boundaryOnly)}>
          边界植物
        </button>
        <button onClick={() => setEvergreenOnly((prev) => !prev)} style={filterChipStyle(evergreenOnly)}>
          常绿
        </button>
        <button onClick={() => setLowMaintenanceOnly((prev) => !prev)} style={filterChipStyle(lowMaintenanceOnly)}>
          低维护
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          minWidth: 0,
        }}
      >
        <div style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>颜色</div>
        <ColorDotFilterSelect
          value={activeColor === "all" ? "" : activeColor}
          colors={availableColors}
          onChange={(value) => setActiveColor(value || "all")}
        />
        <div style={{ fontSize: 12, color: "#4f4f4f", minWidth: 0 }}>
          {activeColor === "all" ? "全部颜色" : formatColorLabel(activeColor)}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>{variants.length} 个植物</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
          gap: 10,
          maxHeight: 414,
          overflowY: "auto",
          paddingRight: 6,
        }}
      >
        {variants.map((v) => {
          const ok = canSelectVariant(v);
          const reason = !ok ? disabledReason?.(v) : null;

          return (
            <button
              key={v.id}
              aria-disabled={!ok}
              title={reason ?? undefined}
              onClick={() => ok && onSelectVariant(v)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHovered({ v, x: rect.right + 10, y: rect.top });
              }}
              onMouseMove={(e) => {
                setHovered((prev) => (prev ? { ...prev, x: e.clientX + 12, y: e.clientY + 12 } : prev));
              }}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: layout.cardMinHeight,
                padding: 8,
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                opacity: ok ? 1 : 0.45,
                cursor: ok ? "pointer" : "not-allowed",
                textAlign: "left",
              }}
            >
              <img
                src={v.icon}
                width={layout.iconSize}
                height={layout.iconSize}
                style={{ objectFit: "contain", borderRadius: 6 }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {v.name}
                </div>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {(v.footprint ?? [1, 1]).join("x")} / H{v.baseHeight}
                </div>
                {v.tags?.length ? (
                  <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {v.tags.slice(0, 3).map((t) => (
                      <span key={t} style={tagStyle}>
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {hovered ? (
        <div
          style={{
            position: "fixed",
            left: hovered.x,
            top: hovered.y,
            zIndex: 9999,
            width: layout.tooltipWidth,
            padding: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,0.98)",
            border: "1px solid #ddd",
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{hovered.v.name}</div>
          <div style={{ color: "#666", marginBottom: 8 }}>{hovered.v.id}</div>

          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", rowGap: 4, columnGap: 6 }}>
            <div style={{ color: "#777" }}>占格</div>
            <div>{(hovered.v.footprint ?? [1, 1]).join("x")}</div>

            <div style={{ color: "#777" }}>颜色</div>
            <div>{hovered.v.color ?? "-"}</div>

            <div style={{ color: "#777" }}>高度</div>
            <div>{formatHeightFeet(hovered.v.baseHeight)}</div>

            <div style={{ color: "#777" }}>Zone</div>
            <div>{hovered.v.zone ?? "-"}</div>

            <div style={{ color: "#777" }}>日照</div>
            <div>{formatSun(hovered.v.sun)}</div>

            <div style={{ color: "#777" }}>花期</div>
            <div>{formatSeasons(hovered.v.bloomSeasons)}</div>
          </div>

          {hovered.v.tags?.length ? (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {hovered.v.tags.map((t) => (
                <span key={t} style={tagStyle}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function tabStyle(active: boolean) {
  return {
    padding: "7px 12px",
    borderRadius: 999,
    border: active ? "1px solid #6f8e72" : "1px solid #ddd",
    background: active ? "#eef6ee" : "#fff",
    cursor: "pointer",
    fontSize: 13,
  } as const;
}

function filterChipStyle(active: boolean) {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    border: active ? "1px solid #7a8e66" : "1px solid #ddd",
    background: active ? "#f3f8ec" : "#fff",
    color: active ? "#47553e" : "#5c5c5c",
    cursor: "pointer",
    fontSize: 12,
  } as const;
}

function ColorDotFilterSelect({
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
        aria-label="选择植物颜色筛选"
        title={value ? "按" + formatColorLabel(value) + "筛选" : "全部颜色"}
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
            title="全部颜色"
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
              title={formatColorLabel(color)}
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

const tagStyle = {
  fontSize: 10,
  padding: "2px 6px",
  borderRadius: 999,
  background: "#f3f3f3",
  color: "#555",
} as const;

function formatSun(s?: string) {
  if (s === "full") return "全日照";
  if (s === "partial") return "半阴";
  if (s === "shade") return "阴";
  return "-";
}

function formatSeasons(ss?: string[]) {
  if (!ss || ss.length === 0) return "-";
  const map: Record<string, string> = {
    spring: "春",
    summer: "夏",
    autumn: "秋",
    winter: "冬",
  };
  return ss.map((s) => map[s] ?? s).join(" / ");
}

function formatHeightFeet(cm?: number) {
  if (!cm || cm <= 0) return "-";
  const feet = cm / 30.48;
  return `${feet.toFixed(1)} ft`;
}

function formatColorLabel(color: string) {
  const map: Record<string, string> = {
    red: "红",
    white: "白",
    blue: "蓝",
    purple: "紫",
    pink: "粉",
    yellow: "黄",
    green: "绿",
  };
  return map[color] ?? color;
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
