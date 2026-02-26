import { useState } from "react";
import TopView from "./views/TopViews";
import { FrontView } from "./views/FrontView";
import { createGarden } from "./store/garden";
import type { GardenState, Season } from "./store/garden";

export default function App() {
  const [garden, setGarden] = useState<GardenState>(createGarden(5, 5));

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      {/* 顶部：季节切换（FrontView 会跟着变） */}
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        {(["spring", "summer", "autumn", "winter"] as Season[]).map((s) => (
          <button
            key={s}
            onClick={() => setGarden((g) => ({ ...g, season: s }))}
          >
            {s}
          </button>
        ))}
      </div>

      {/* 主体：左右布局 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <h3 style={{ margin: "0 0 8px 0" }}>Top View（编辑）</h3>
          <TopView garden={garden} onChange={setGarden} />
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px 0" }}>Front View（效果）</h3>
          <FrontView garden={garden} />
        </div>
      </div>
    </div>
  );
}
