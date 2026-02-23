import { useMemo, useState } from "react";
import type { PlantCategory, PlantVariant } from "../type/plants";


export default function PlantCatalog({
  categories,
  disabledReason,
  canSelectVariant,
  onSelectVariant,
  onClear,
  hasSelection,
}: {
  categories: PlantCategory[];
  // 可选：用于提示为什么不可选（你不想做也行）
  disabledReason?: (variant: PlantVariant) => string | null;
  // variant 是否可选（比如绣球占两格、边缘格放不下）
  canSelectVariant: (variant: PlantVariant) => boolean;
  // 选择某个变种
  onSelectVariant: (variant: PlantVariant) => void;
  // 清空
  onClear: () => void;
  // 是否有选中格子
  hasSelection: boolean;
}) {
  const [activeCat, setActiveCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [hovered, setHovered] = useState<{
    v: PlantVariant;
    x: number;
    y: number;
  } | null>(null);


  const allVariants = useMemo(() => {
    const list: PlantVariant[] = [];
    for (const cat of categories) list.push(...cat.variants);
    return list;
  }, [categories]);

  const variants = useMemo(() => {
    const src =
      activeCat === "all"
        ? allVariants
        : categories.find((c) => c.id === activeCat)?.variants ?? [];

    const query = q.trim().toLowerCase();
    if (!query) return src;

    return src.filter((v) => {
      const inName = v.name.toLowerCase().includes(query) || v.id.toLowerCase().includes(query);
      const inTags = (v.tags ?? []).some((t) => t.toLowerCase().includes(query));
      return inName || inTags;
    });
  }, [activeCat, q, categories, allVariants]);

  return (
    <div style={{ width: 380 }}>
      {/* 搜索 + 清空 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          placeholder="搜索：rose / 白 / 耐旱 ..."
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

      <div style={{ display: "flex", gap: 12 }}>
        {/* 左侧类目 */}
        <div style={{ width: 110 }}>
          <div
            onClick={() => setActiveCat("all")}
            style={catItemStyle(activeCat === "all")}
          >
            全部
          </div>

          {categories.map((cat) => (
            <div
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              style={catItemStyle(activeCat === cat.id)}
              title={cat.name}
            >
              {cat.name}
            </div>
          ))}
        </div>

        {/* 右侧网格 */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
            {variants.length} 个品种
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
              gap: 10,
            }}
          >
          {variants.map((v) => {
            const ok = canSelectVariant(v);

            return (
              <button
                key={v.id}
                aria-disabled={!ok}
                onClick={() => ok && onSelectVariant(v)} // ✅ 自己拦截点击
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHovered({ v, x: rect.right + 10, y: rect.top });
                }}
                onMouseMove={(e) => {
                  setHovered((prev) =>
                    prev ? { ...prev, x: e.clientX + 12, y: e.clientY + 12 } : prev
                  );
                }}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  opacity: ok ? 1 : 0.45,                 // ✅ 模拟禁用
                  cursor: ok ? "pointer" : "not-allowed",  // ✅ 模拟禁用
                  textAlign: "left",
                }}
              >
                <img
                  src={v.icon}
                  width={44}
                  height={44}
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
                    {(v.footprint ?? [1, 1]).join("×")} · H{v.baseHeight}
                  </div>
                  {v.tags?.length ? (
                    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {v.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "#f3f3f3",
                            color: "#555",
                          }}
                        >
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
        </div>
      </div>
      {hovered && (
          <div
            style={{
              position: "fixed",
              left: hovered.x,
              top: hovered.y,
              zIndex: 9999,
              width: 260,
              padding: 10,
              borderRadius: 12,
              background: "rgba(255,255,255,0.98)",
              border: "1px solid #ddd",
              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
              fontSize: 12,
              pointerEvents: "none", // ✅ 不挡鼠标
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{hovered.v.name}</div>
            <div style={{ color: "#666", marginBottom: 8 }}>{hovered.v.id}</div>

            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", rowGap: 4, columnGap: 6 }}>
              <div style={{ color: "#777" }}>占格</div>
              <div>{(hovered.v.footprint ?? [1, 1]).join("×")}</div>

              <div style={{ color: "#777" }}>高度</div>
              <div>{hovered.v.baseHeight} cm</div>

              <div style={{ color: "#777" }}>日照</div>
              <div>{formatSun(hovered.v.sun)}</div>

              <div style={{ color: "#777" }}>浇水</div>
              <div>{formatWater(hovered.v.water)}</div>

              <div style={{ color: "#777" }}>花期</div>
              <div>{formatSeasons(hovered.v.bloomSeasons)}</div>

              <div style={{ color: "#777" }}>维护</div>
              <div>{hovered.v.maintenance ?? "-"} / 5</div>
            </div>

            {hovered.v.tags?.length ? (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {hovered.v.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "#f2f2f2",
                      color: "#555",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}
    </div>
  );
}

function catItemStyle(active: boolean) {
  return {
    padding: "8px 10px",
    borderRadius: 8,
    marginBottom: 8,
    border: "1px solid #ddd",
    background: active ? "#e8f2ff" : "#fff",
    cursor: "pointer",
    fontSize: 13,
  } as const;
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
function formatWater(w?: string) {
  if (w === "low") return "少";
  if (w === "medium") return "中";
  if (w === "high") return "多";
  return "-";
}
function formatSeasons(ss?: string[]) {
  if (!ss || ss.length === 0) return "-";
  const map: any = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };
  return ss.map((s) => map[s] ?? s).join(" / ");
}