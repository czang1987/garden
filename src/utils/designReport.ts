import type { GardenState, Season } from "../store/garden";
import type { PlantVariant } from "../type/plants";
import { footprintBounds } from "./footprint";

type DesignReportPlantRow = {
  plantId: string;
  plantName: string;
  count: number;
  color: string;
  purchaseUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tickStep(size: number) {
  if (size <= 10) return 1;
  if (size <= 20) return 2;
  if (size <= 40) return 5;
  return 10;
}

function colorValue(color?: string) {
  if (!color) return "#d9d4ca";
  return color === "white" ? "#f8f8f3" : color;
}

export function buildDesignReportPlantRows(garden: GardenState, variants: PlantVariant[]): DesignReportPlantRow[] {
  const variantMap = new Map(variants.map((variant) => [variant.id, variant] as const));
  const counts = new Map<string, number>();

  for (const cell of garden.cells) {
    if (!cell.plant || cell.plant === "empty") continue;
    counts.set(cell.plant, (counts.get(cell.plant) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([plantId, count]) => {
      const variant = variantMap.get(plantId);
      return {
        plantId,
        plantName: variant?.name ?? plantId,
        count,
        color: variant?.color ?? "",
        purchaseUrl: variant?.link ?? "",
      };
    })
    .sort((a, b) => a.plantName.localeCompare(b.plantName));
}

export function buildDesignLayoutSvg(garden: GardenState, variants: PlantVariant[]) {
  const variantMap = new Map(variants.map((variant) => [variant.id, variant] as const));
  const cell = 34;
  const axis = 54;
  const width = axis + garden.cols * cell + 16;
  const height = axis + garden.rows * cell + 16;
  const colTick = tickStep(garden.cols);
  const rowTick = tickStep(garden.rows);

  const pieces: string[] = [];
  pieces.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  pieces.push(`<rect width="${width}" height="${height}" fill="#fcfaf6"/>`);
  pieces.push(`<rect x="${axis}" y="${axis}" width="${garden.cols * cell}" height="${garden.rows * cell}" fill="#f3eee4" stroke="#cabda7" stroke-width="2"/>`);

  for (let c = 0; c <= garden.cols; c++) {
    const x = axis + c * cell;
    pieces.push(`<line x1="${x}" y1="${axis}" x2="${x}" y2="${axis + garden.rows * cell}" stroke="#d9cfbe" stroke-width="1"/>`);
    if (c < garden.cols && c % colTick === 0) {
      pieces.push(
        `<text x="${x + cell / 2}" y="${axis - 14}" text-anchor="middle" font-size="10" fill="#6a6258">${c}ft</text>`
      );
    }
  }

  for (let r = 0; r <= garden.rows; r++) {
    const y = axis + r * cell;
    pieces.push(`<line x1="${axis}" y1="${y}" x2="${axis + garden.cols * cell}" y2="${y}" stroke="#d9cfbe" stroke-width="1"/>`);
    if (r < garden.rows && r % rowTick === 0) {
      pieces.push(
        `<text x="${axis - 14}" y="${y + cell / 2 + 3}" text-anchor="end" font-size="10" fill="#6a6258">${r}ft</text>`
      );
    }
  }

  for (const cellEntry of garden.cells) {
    if (!cellEntry.plant || cellEntry.plant === "empty") continue;
    const variant = variantMap.get(cellEntry.plant);
    const fp = (variant?.footprint ?? [1, 1]) as [number, number];
    const bounds = footprintBounds({ r: cellEntry.row, c: cellEntry.col }, fp);
    const x = axis + bounds.left * cell;
    const y = axis + bounds.top * cell;
    const w = fp[1] * cell;
    const h = fp[0] * cell;
    const fill = colorValue(variant?.color);

    pieces.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" fill="${fill}" fill-opacity="0.55" stroke="#6f6558" stroke-width="1.5"/>`
    );
    if (variant?.color === "white") {
      pieces.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" fill="none" stroke="#b5aa98" stroke-width="1"/>`);
    }
    pieces.push(
      `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#2e2b28">${escapeHtml(
        variant?.name ?? cellEntry.plant
      )}</text>`
    );
  }

  pieces.push(
    `<text x="${axis + (garden.cols * cell) / 2}" y="22" text-anchor="middle" font-size="12" fill="#5d554b">Horizontal Distance (ft)</text>`
  );
  pieces.push(
    `<text x="18" y="${axis + (garden.rows * cell) / 2}" text-anchor="middle" font-size="12" fill="#5d554b" transform="rotate(-90 18 ${axis + (garden.rows * cell) / 2})">Depth (ft)</text>`
  );
  pieces.push(`</svg>`);
  return pieces.join("");
}

export function buildDesignReportHtml(params: {
  title: string;
  garden: GardenState;
  plants: DesignReportPlantRow[];
  layoutSvg: string;
  seasonalViews: Array<{
    season: Season;
    frontalPng: string;
  }>;
}) {
  const { title, garden, plants, layoutSvg, seasonalViews } = params;
  const plantRows = plants
    .map(
      (plant) => `
        <tr>
          <td>${escapeHtml(plant.plantName)}</td>
          <td>${escapeHtml(plant.plantId)}</td>
          <td>${plant.count}</td>
          <td><span class="color-chip" style="background:${colorValue(plant.color)}"></span>${escapeHtml(plant.color || "-")}</td>
          <td>${plant.purchaseUrl ? `<a href="${escapeHtml(plant.purchaseUrl)}" target="_blank" rel="noreferrer">Link</a>` : "-"}</td>
        </tr>
      `
    )
    .join("");
  const seasonalRows = seasonalViews
    .map(
      (view) => `
        <div class="season-row">
          <div class="season-label">${escapeHtml(view.season)}</div>
          <div class="mini-view"><img src="${view.frontalPng}" alt="${escapeHtml(view.season)} frontal view" /></div>
        </div>
      `
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 landscape; margin: 14mm; }
      body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; color: #2d2b28; background: #f5f0e7; }
      .page { page-break-after: always; min-height: 100vh; box-sizing: border-box; padding: 18px 20px; background: #fcfaf6; }
      .page:last-child { page-break-after: auto; }
      h1, h2 { margin: 0 0 12px 0; }
      h1 { font-size: 24px; }
      h2 { font-size: 20px; }
      .meta { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; color: #5d554b; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; background: #fff; }
      th, td { border: 1px solid #ddd3c2; padding: 10px 12px; font-size: 13px; text-align: left; vertical-align: middle; }
      th { background: #efe5d5; }
      .color-chip { display: inline-block; width: 14px; height: 14px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.14); margin-right: 8px; vertical-align: middle; }
      .layout-wrap { display: flex; justify-content: center; align-items: center; background: #fff; border: 1px solid #ddd3c2; border-radius: 14px; padding: 14px; }
      .view-wrap { display: flex; justify-content: center; align-items: center; height: calc(100vh - 110px); background: #fff; border: 1px solid #ddd3c2; border-radius: 14px; padding: 14px; }
      .view-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
      .season-grid { display: grid; gap: 12px; }
      .season-row { display: grid; grid-template-columns: 72px 1fr; gap: 12px; align-items: center; }
      .season-label { font-size: 16px; font-weight: 700; color: #4f473d; text-transform: capitalize; }
      .mini-view { display: flex; justify-content: center; align-items: center; min-height: 180px; background: #fff; border: 1px solid #ddd3c2; border-radius: 14px; padding: 10px; }
      .mini-view img { max-width: 100%; max-height: 100%; object-fit: contain; }
      .season-head { display: grid; grid-template-columns: 72px 1fr; gap: 12px; margin-bottom: 8px; font-size: 13px; color: #6a6258; }
      .caption { margin-top: 10px; font-size: 13px; color: #6a6258; }
      a { color: #5e7c58; text-decoration: none; }
    </style>
  </head>
  <body>
    <section class="page">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        <div>Grid: ${garden.rows} x ${garden.cols} ft</div>
        <div>Season: ${escapeHtml(garden.season)}</div>
        <div>Zone: ${garden.zone}</div>
      </div>
      <h2>Plant Schedule</h2>
      <table>
        <thead>
          <tr>
            <th>Plant</th>
            <th>ID</th>
            <th>Qty</th>
            <th>Color</th>
            <th>Purchase</th>
          </tr>
        </thead>
        <tbody>${plantRows}</tbody>
      </table>
    </section>
    <section class="page">
      <h2>Layout Plan</h2>
      <div class="layout-wrap">${layoutSvg}</div>
      <div class="caption">Plant names are placed at the center of each occupied footprint. Axes show distance in feet.</div>
    </section>
    <section class="page">
      <h2>Seasonal Front Views</h2>
      <div class="season-head">
        <div></div>
        <div>Frontal View</div>
      </div>
      <div class="season-grid">
        ${seasonalRows}
      </div>
      <div class="caption">Each row shows one season in the frontal viewing angle.</div>
    </section>
  </body>
</html>`;
}
