import React, { useEffect, useRef } from "react";

const CELL_SIZE = 60; // 每格像素
const PERSPECTIVE_SCALE = 0.04; // y 越大，缩小幅度

interface LayoutItem {
  plant_id: string;
  x: number;
  y: number;
}

interface Plant {
  id: string;

}

interface GardenCanvasProps {
  layout: LayoutItem[];
  plants: Record<string, Plant>;
  season: "spring" 
}

export default function GardenCanvas({ layout, plants, season }: GardenCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 先按 y 排序，保证透视前后顺序
    layout
      .sort((a, b) => a.y - b.y)
      .forEach(item => {
        const plant = plants[item.plant_id];
        const img = new Image();
        img.src = `/assets/plants/${plant.id}/${season}.png`;

        const scale = 1 - item.y * PERSPECTIVE_SCALE;
        const size = CELL_SIZE * scale;

        const x = item.x * CELL_SIZE + (CELL_SIZE - size) / 2;
        const y = canvas.height - (item.y + 1) * CELL_SIZE + (CELL_SIZE - size);

        img.onload = () => {
          ctx.drawImage(img, x, y, size, size);
        };
      });
  }, [layout, plants, season]);

  return <canvas ref={canvasRef} width={600} height={400} style={{ border: "1px solid #ccc" }} />;
}