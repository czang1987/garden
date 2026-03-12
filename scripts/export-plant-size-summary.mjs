import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "public", "assets", "plants", "index.json");
const OUT_PATH = path.join(ROOT, "public_plants_assets_size.csv");
const SEASONS = ["spring", "summer", "autumn", "winter"];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, "\"\"")}"`;
  return str;
}

async function imageMetaOrEmpty(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    return { width: meta.width ?? "", height: meta.height ?? "" };
  } catch {
    return { width: "", height: "" };
  }
}

async function main() {
  const raw = await fs.readFile(INDEX_PATH, "utf8");
  const index = JSON.parse(raw);

  const rows = [];
  const headers = [
    "categoryId",
    "categoryName",
    "plantId",
    "plantName",
    "baseHeight",
    "baseWidth",
    "springWidth",
    "springHeight",
    "summerWidth",
    "summerHeight",
    "autumnWidth",
    "autumnHeight",
    "winterWidth",
    "winterHeight",
  ];

  for (const cat of index.categories ?? []) {
    for (const plant of cat.variants ?? []) {
      const plantDir = path.join(ROOT, "public", "assets", "plants", plant.id);
      const seasonMeta = {};

      for (const season of SEASONS) {
        const seasonPath = path.join(plantDir, `${season}.png`);
        seasonMeta[season] = await imageMetaOrEmpty(seasonPath);
      }

      rows.push([
        cat.id ?? "",
        cat.name ?? "",
        plant.id ?? "",
        plant.name ?? "",
        plant.baseHeight ?? "",
        plant.baseWidth ?? "",
        seasonMeta.spring.width,
        seasonMeta.spring.height,
        seasonMeta.summer.width,
        seasonMeta.summer.height,
        seasonMeta.autumn.width,
        seasonMeta.autumn.height,
        seasonMeta.winter.width,
        seasonMeta.winter.height,
      ]);
    }
  }

  const csvLines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  await fs.writeFile(OUT_PATH, `\uFEFF${csvLines.join("\n")}`, "utf8");
  console.log(`wrote ${rows.length} rows to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
