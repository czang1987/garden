#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SEASONS = ["spring", "summer", "autumn", "winter"];

function parseArgs(argv) {
  const args = {
    root: "public/assets/plants",
    targetWidth: 900,
    inPlace: false,
    outSubdir: "tmp_padded",
    only: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--root" && v) args.root = v;
    if (k === "--target-width" && v) args.targetWidth = Number(v);
    if (k === "--in-place" && v) args.inPlace = v === "true";
    if (k === "--out-subdir" && v) args.outSubdir = v;
    if (k === "--only" && v) args.only = v;
  }
  return args;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function padWidth(src, dst, targetWidth) {
  const img = sharp(src);
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) return { skipped: true, reason: "bad-metadata" };
  if (width >= targetWidth) {
    if (src !== dst) {
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
    }
    return { skipped: true, reason: "already-wide", width, height };
  }
  const left = Math.floor((targetWidth - width) / 2);
  const padded = await sharp({
    create: {
      width: targetWidth,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: await img.png().toBuffer(), left, top: 0 }])
    .png()
    .toBuffer();
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.writeFile(dst, padded);
  return { skipped: false, width, height, newWidth: targetWidth };
}

async function main() {
  const args = parseArgs(process.argv);
  const entries = await fs.readdir(args.root, { withFileTypes: true });
  const plantDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => (args.only ? name === args.only : true));

  let changed = 0;
  let skipped = 0;
  for (const plantId of plantDirs) {
    const plantDir = path.join(args.root, plantId);
    for (const season of SEASONS) {
      const src = path.join(plantDir, `${season}.png`);
      if (!(await exists(src))) continue;
      const dst = args.inPlace
        ? src
        : path.join(plantDir, args.outSubdir, `${season}.png`);
      const res = await padWidth(src, dst, args.targetWidth);
      if (res.skipped) skipped++;
      else changed++;
      console.log(
        `[${plantId}/${season}] ${res.skipped ? "skip" : "ok"} -> ${path.relative(process.cwd(), dst)}`
      );
    }
  }
  console.log(`done: changed=${changed}, skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
