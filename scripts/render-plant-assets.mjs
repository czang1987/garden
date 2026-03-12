#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SEASONS = ["spring", "summer", "autumn", "winter"];

function parseArgs(argv) {
  const args = {
    rawRoot: "scripts/raw-plants",
    outRoot: "public/assets/plants",
    cutout: true,
    bgLow: 24,
    bgHigh: 64,
    targetW: 640,
    targetH: 640,
    iconSize: 256,
    styleRef: "",
    styleStrength: 0.65,
    plants: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--raw-root" && v) args.rawRoot = v;
    if (k === "--out-root" && v) args.outRoot = v;
    if (k === "--cutout" && v) args.cutout = v !== "false";
    if (k === "--bg-low" && v) args.bgLow = Number(v);
    if (k === "--bg-high" && v) args.bgHigh = Number(v);
    if (k === "--target-w" && v) args.targetW = Number(v);
    if (k === "--target-h" && v) args.targetH = Number(v);
    if (k === "--icon-size" && v) args.iconSize = Number(v);
    if (k === "--style-ref" && v) args.styleRef = v;
    if (k === "--style-strength" && v) args.styleStrength = Number(v);
    if (k === "--plants" && v) args.plants = v.split(",").map((s) => s.trim()).filter(Boolean);
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

async function listDirs(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function findSeasonSource(dir, season) {
  const candidates = [
    `${season}.png`,
    `${season}.jpg`,
    `${season}.jpeg`,
    `${season}.webp`,
    `${season}.avif`,
  ];
  for (const c of candidates) {
    const full = path.join(dir, c);
    if (await exists(full)) return full;
  }
  return null;
}

function dist3(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function estimateBgColor(data, width, height, channels) {
  const pts = [];
  const margin = Math.max(2, Math.floor(Math.min(width, height) * 0.04));
  const add = (x, y) => {
    const i = (y * width + x) * channels;
    pts.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = margin; x < width - margin; x += Math.max(1, Math.floor(width / 20))) {
    add(x, margin);
    add(x, height - 1 - margin);
  }
  for (let y = margin; y < height - margin; y += Math.max(1, Math.floor(height / 20))) {
    add(margin, y);
    add(width - 1 - margin, y);
  }
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pts) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = Math.max(1, pts.length);
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

async function knockOutBackground(inputSharp, low, high) {
  const { data, info } = await inputSharp.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);
  const [bgR, bgG, bgB] = estimateBgColor(data, width, height, channels);

  for (let i = 0; i < out.length; i += channels) {
    const d = dist3(out[i], out[i + 1], out[i + 2], bgR, bgG, bgB);
    const keep = smoothstep(low, high, d);
    const a = out[i + 3] ?? 255;
    out[i + 3] = Math.round(a * keep);
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png();
}

async function renderSeason(srcPath, outPath, opts) {
  const base = sharp(srcPath).rotate();
  const cut = opts.cutout ? await knockOutBackground(base, opts.bgLow, opts.bgHigh) : base.ensureAlpha();
  const { data, info } = await cut.raw().toBuffer({ resolveWithObject: true });
  const trimmed = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .trim({ threshold: 8 })
    .png()
    .toBuffer();
  const fitted = await sharp(trimmed)
    .resize({
      width: Math.floor(opts.targetW * 0.86),
      height: Math.floor(opts.targetH * 0.86),
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const meta = await sharp(fitted).metadata();
  const left = Math.floor((opts.targetW - (meta.width || 0)) / 2);
  const top = Math.max(0, opts.targetH - (meta.height || 0) - Math.floor(opts.targetH * 0.03));
  const canvas = sharp({
    create: { width: opts.targetW, height: opts.targetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  const composed = await canvas
    .composite([{ input: fitted, left, top }])
    .png()
    .toBuffer();

  let outBuf = composed;
  if (opts.styleStats) {
    outBuf = await applyColorTransfer(composed, opts.styleStats, opts.styleStrength);
  }
  await sharp(outBuf).png().toFile(outPath);
}

function computeMeanStdRgb(raw, channels, alphaIndex = 3) {
  let n = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sqR = 0;
  let sqG = 0;
  let sqB = 0;
  for (let i = 0; i < raw.length; i += channels) {
    const a = channels > alphaIndex ? raw[i + alphaIndex] : 255;
    if (a < 8) continue;
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    n++;
    sumR += r;
    sumG += g;
    sumB += b;
    sqR += r * r;
    sqG += g * g;
    sqB += b * b;
  }
  if (n === 0) {
    return {
      mean: [127, 127, 127],
      std: [40, 40, 40],
    };
  }
  const meanR = sumR / n;
  const meanG = sumG / n;
  const meanB = sumB / n;
  const stdR = Math.max(1, Math.sqrt(sqR / n - meanR * meanR));
  const stdG = Math.max(1, Math.sqrt(sqG / n - meanG * meanG));
  const stdB = Math.max(1, Math.sqrt(sqB / n - meanB * meanB));
  return {
    mean: [meanR, meanG, meanB],
    std: [stdR, stdG, stdB],
  };
}

function clamp255(x) {
  return Math.max(0, Math.min(255, Math.round(x)));
}

async function buildStyleStats(styleRef, width, height) {
  const { data, info } = await sharp(styleRef)
    .resize({ width, height, fit: "cover" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return computeMeanStdRgb(data, info.channels);
}

async function applyColorTransfer(pngBuffer, styleStats, strength = 0.65) {
  const s = Math.max(0, Math.min(1, strength));
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const srcStats = computeMeanStdRgb(data, info.channels);
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += info.channels) {
    const a = out[i + 3];
    if (a < 8) continue;
    for (let c = 0; c < 3; c++) {
      const x = out[i + c];
      const norm = (x - srcStats.mean[c]) / srcStats.std[c];
      const mapped = norm * styleStats.std[c] + styleStats.mean[c];
      out[i + c] = clamp255(x * (1 - s) + mapped * s);
    }
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}

async function renderIcon(fromSeasonPath, iconPath, iconSize) {
  const src = await sharp(fromSeasonPath).trim({ threshold: 8 }).png().toBuffer();
  await sharp({
    create: { width: iconSize, height: iconSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp(src)
          .resize({
            width: Math.floor(iconSize * 0.82),
            height: Math.floor(iconSize * 0.82),
            fit: "inside",
            withoutEnlargement: true,
          })
          .toBuffer(),
        gravity: "south",
      },
    ])
    .png()
    .toFile(iconPath);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!(await exists(args.rawRoot))) {
    throw new Error(`raw root not found: ${args.rawRoot}`);
  }

  const allPlantDirs = await listDirs(args.rawRoot);
  const plants = args.plants.length > 0 ? allPlantDirs.filter((id) => args.plants.includes(id)) : allPlantDirs;
  if (plants.length === 0) {
    throw new Error("no plants to render. Check --plants or raw root folders.");
  }

  if (args.styleRef) {
    args.styleStats = await buildStyleStats(args.styleRef, args.targetW, args.targetH);
  }

  for (const id of plants) {
    const rawDir = path.join(args.rawRoot, id);
    const outDir = path.join(args.outRoot, id);
    await fs.mkdir(outDir, { recursive: true });

    let springOut = null;
    let anySource = null;
    for (const season of SEASONS) {
      const src = (await findSeasonSource(rawDir, season)) || anySource;
      if (!src) continue;
      anySource ||= src;
      const out = path.join(outDir, `${season}.png`);
      await renderSeason(src, out, args);
      if (season === "spring") springOut = out;
      console.log(`[ok] ${id}/${season}.png <- ${path.basename(src)}`);
    }

    if (!springOut) {
      const s = await findSeasonSource(rawDir, "spring");
      if (s) {
        springOut = path.join(outDir, "spring.png");
        await renderSeason(s, springOut, args);
      }
    }
    if (springOut) {
      await renderIcon(springOut, path.join(outDir, "icon.png"), args.iconSize);
      console.log(`[ok] ${id}/icon.png`);
    } else {
      console.warn(`[skip] ${id} has no source images`);
    }
  }
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
