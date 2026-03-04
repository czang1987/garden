import { useState } from "react";
import TopView from "./views/TopViews";
import { FrontView } from "./views/FrontView";
import { createGarden } from "./store/garden";
import type { GardenState, Season } from "./store/garden";

export default function App() {
  const [garden, setGarden] = useState<GardenState>(createGarden(5, 5));
  const [rowGapRatio, setRowGapRatio] = useState(0.77);
  const rowGap = Math.round(110 * rowGapRatio);

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <h3 style={{ margin: "0 0 8px 0" }}>Top View (Editor)</h3>
          <TopView garden={garden} onChange={setGarden} />
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px 0" }}>Front View (Preview)</h3>
          <div style={{ marginBottom: 10, display: "flex", gap: 8 }}>
            {(["spring", "summer", "autumn", "winter"] as Season[]).map((s) => (
              <button key={s} onClick={() => setGarden((g) => ({ ...g, season: s }))}>
                {s}
              </button>
            ))}
          </div>
          <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#444", minWidth: 90 }}>View Angle</span>
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
              ROW_GAP: {rowGap} ({rowGapRatio.toFixed(2)}x COL_GAP)
            </span>
          </div>
          <FrontView garden={garden} rowGap={rowGap} />
        </div>
      </div>
    </div>
  );
}
