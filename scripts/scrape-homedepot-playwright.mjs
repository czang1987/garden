#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

function parseArgs(argv) {
  const args = {
    seedFile: "scripts/homedepot-seeds.txt",
    outDir: "data/homedepot",
    debugDir: "data/homedepot/debug",
    maxProducts: 60,
    delayMs: 1200,
    headless: true,
    manualWarmup: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--seed-file" && v) args.seedFile = v;
    if (k === "--out-dir" && v) args.outDir = v;
    if (k === "--debug-dir" && v) args.debugDir = v;
    if (k === "--max-products" && v) args.maxProducts = Number(v);
    if (k === "--delay-ms" && v) args.delayMs = Number(v);
    if (k === "--headless" && v) args.headless = v !== "false";
    if (k === "--manual-warmup" && v) args.manualWarmup = v === "true";
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugFromUrl(url) {
  return url
    .toLowerCase()
    .replace(/[#?].*$/, "")
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join("_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function keywordFromSeedUrl(listingUrl) {
  try {
    const u = new URL(listingUrl);
    const pathParts = u.pathname.split("/").filter(Boolean);
    // Prefer explicit taxonomy segment like ".../Chrysanthemum/..."
    const generic = new Set([
      "b",
      "outdoors-garden-center-outdoor-plants-garden-flowers-perennials",
      "outdoors-garden-center",
      "outdoor-plants",
      "garden-flowers",
      "perennials",
    ]);
    const filtered = pathParts.filter((p) => {
      if (!/^[a-z0-9\-_%]+$/i.test(p) || !/[a-z]/i.test(p)) return false;
      if (/^n-/i.test(p)) return false;
      return !generic.has(p.toLowerCase());
    });
    const candidate = filtered[filtered.length - 1] || "";
    const clean = decodeURIComponent(candidate).replace(/[-_]+/g, " ").trim();
    if (clean && clean.length >= 3) return clean;
  } catch {}
  return "";
}

function buildSearchUrl(keyword) {
  return `https://www.homedepot.com/s/${encodeURIComponent(keyword)}?NCNI-5`;
}

function parseNum(str) {
  if (!str) return null;
  const m = String(str).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function mapWater(raw) {
  const t = (raw || "").toLowerCase();
  if (!t) return undefined;
  if (/(drought|dry|low)/.test(t)) return "low";
  if (/(high|wet|moist)/.test(t)) return "high";
  if (/(moderate|medium|average)/.test(t)) return "medium";
  return undefined;
}

function mapSun(raw) {
  const t = (raw || "").toLowerCase();
  if (!t) return undefined;
  if (/(full sun|direct sun)/.test(t)) return "full";
  if (/(part sun|partial sun|part shade|partial shade)/.test(t)) return "partial";
  if (/(shade|low light)/.test(t)) return "shade";
  return undefined;
}

function mapBloomSeasons(specText) {
  const t = (specText || "").toLowerCase();
  const seasons = [];
  if (/\bspring\b/.test(t)) seasons.push("spring");
  if (/\bsummer\b/.test(t)) seasons.push("summer");
  if (/\bautumn\b|\bfall\b/.test(t)) seasons.push("autumn");
  if (/\bwinter\b/.test(t)) seasons.push("winter");
  return seasons;
}

function inferMaintenance(water, sun, specsText) {
  let score = 3;
  if (water === "low") score -= 1;
  if (water === "high") score += 1;
  if (sun === "shade") score += 0;
  if (sun === "full") score += 0;
  if (/disease resistant|easy to grow|low maintenance/i.test(specsText || "")) score -= 1;
  return Math.max(1, Math.min(5, Math.round(score)));
}

async function loadSeedUrls(seedFile) {
  const text = await fs.readFile(seedFile, "utf8");
  return text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#"));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function isHomeDepotUrl(u) {
  try {
    const x = new URL(u);
    return /(^|\.)homedepot\.com$/i.test(x.hostname);
  } catch {
    return false;
  }
}

async function robotsAllows(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    const txt = await fetch(robotsUrl).then((r) => r.text());
    const lines = txt.split(/\r?\n/).map((l) => l.trim());
    let inGlobal = false;
    const disallow = [];
    for (const line of lines) {
      if (/^user-agent:/i.test(line)) {
        const agent = line.split(":")[1]?.trim() || "";
        inGlobal = agent === "*";
      } else if (inGlobal && /^disallow:/i.test(line)) {
        disallow.push(line.split(":")[1]?.trim() || "");
      }
    }
    return { robotsUrl, disallow };
  } catch {
    return null;
  }
}

async function collectProductLinks(page, listingUrl, delayMs) {
  await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  try {
    await page.locator('button:has-text("Accept")').first().click({ timeout: 1200 });
  } catch {}
  try {
    await page.locator('[aria-label*="close" i], button[aria-label*="close" i]').first().click({ timeout: 800 });
  } catch {}
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 3000).catch(() => {});
  await page.waitForTimeout(1200);

  const domLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const out = [];
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!href) continue;
      const abs = new URL(href, location.origin).toString();
      if (/\/p\/.+/i.test(abs) && /homedepot\.com/i.test(abs)) {
        out.push(abs);
      }
    }
    return Array.from(new Set(out));
  });

  const html = await page.content();
  const regexLinks = Array.from(
    html.matchAll(/https?:\/\/www\.homedepot\.com\/p\/[^\s"'<>]+/gi),
    (m) => m[0]
  );

  const ldLinks = await page.evaluate(() => {
    const out = [];
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      const t = s.textContent || "";
      if (!t) continue;
      try {
        const parsed = JSON.parse(t);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const candidates = [];
          if (item?.itemListElement && Array.isArray(item.itemListElement)) {
            for (const el of item.itemListElement) {
              if (typeof el?.url === "string") candidates.push(el.url);
              if (typeof el?.item === "string") candidates.push(el.item);
              if (typeof el?.item?.["@id"] === "string") candidates.push(el.item["@id"]);
              if (typeof el?.item?.url === "string") candidates.push(el.item.url);
            }
          }
          if (typeof item?.url === "string") candidates.push(item.url);
          for (const c of candidates) {
            const abs = new URL(c, location.origin).toString();
            if (/\/p\/.+/i.test(abs) && /homedepot\.com/i.test(abs)) out.push(abs);
          }
        }
      } catch {}
    }
    return Array.from(new Set(out));
  });

  const links = Array.from(new Set([...domLinks, ...regexLinks, ...ldLinks]))
    .map((u) => u.replace(/[?#].*$/, ""))
    .filter((u) => /\/p\/.+/i.test(u));

  const title = await page.title().catch(() => "");
  const currentUrl = page.url();
  if (links.length === 0) {
    console.warn(`[list] no product links extracted. title="${title}" url="${currentUrl}"`);
    if (/access denied|captcha|verify/i.test(html)) {
      console.warn("[list] page seems blocked by bot protection (captcha/verify/access denied).");
    }
    if (/error page/i.test(title)) {
      const kw = keywordFromSeedUrl(listingUrl);
      if (kw) {
        const fallback = buildSearchUrl(kw);
        console.warn(`[list] retry with search fallback: ${fallback}`);
        await page.goto(fallback, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(1500);
        const retry = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll("a[href]"));
          const out = [];
          for (const a of anchors) {
            const href = a.getAttribute("href") || "";
            if (!href) continue;
            const abs = new URL(href, location.origin).toString();
            if (/\/p\/.+/i.test(abs) && /homedepot\.com/i.test(abs)) out.push(abs);
          }
          return Array.from(new Set(out));
        });
        const retryLinks = retry.map((u) => u.replace(/[?#].*$/, ""));
        if (retryLinks.length > 0) {
          await sleep(delayMs);
          return retryLinks;
        }
      }
    }
  }

  await sleep(delayMs);
  return links;
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);

  const data = await page.evaluate(() => {
    const text = (el) => (el?.textContent || "").trim();
    const bySel = (sel) => text(document.querySelector(sel));
    const h1 = bySel("h1");

    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.textContent || "")
      .filter(Boolean);
    const jsonLd = [];
    for (const s of scripts) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) jsonLd.push(...parsed);
        else jsonLd.push(parsed);
      } catch {}
    }

    const productLd =
      jsonLd.find((x) => x?.["@type"] === "Product") ||
      jsonLd.find((x) => Array.isArray(x?.["@type"]) && x["@type"].includes("Product")) ||
      null;

    const price =
      productLd?.offers?.price ||
      productLd?.offers?.[0]?.price ||
      bySel('[itemprop="price"]') ||
      bySel('[data-testid*="price"]');
    const rating =
      productLd?.aggregateRating?.ratingValue ||
      bySel('[data-testid*="rating"]');
    const reviewCount =
      productLd?.aggregateRating?.reviewCount ||
      bySel('[data-testid*="review"]');

    const specs = {};
    const rows = Array.from(
      document.querySelectorAll("tr, dl > div, li, [data-testid*='spec']")
    );
    for (const row of rows) {
      let key = "";
      let value = "";

      const th = row.querySelector("th");
      const td = row.querySelector("td");
      if (th && td) {
        key = text(th);
        value = text(td);
      } else {
        const dt = row.querySelector("dt");
        const dd = row.querySelector("dd");
        if (dt && dd) {
          key = text(dt);
          value = text(dd);
        } else {
          const t = text(row);
          const idx = t.indexOf(":");
          if (idx > 0 && idx < t.length - 1) {
            key = t.slice(0, idx).trim();
            value = t.slice(idx + 1).trim();
          }
        }
      }
      if (!key || !value) continue;
      if (key.length > 100 || value.length > 300) continue;
      specs[key] = value;
    }

    const image =
      productLd?.image?.[0] ||
      productLd?.image ||
      document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
      "";

    return {
      title: productLd?.name || h1 || "",
      sku:
        productLd?.sku ||
        bySel('[data-testid*="model"]') ||
        bySel('[data-testid*="sku"]'),
      brand: productLd?.brand?.name || productLd?.brand || "",
      price,
      rating,
      reviewCount,
      description:
        productLd?.description ||
        bySel('meta[name="description"]') ||
        bySel('[data-testid*="description"]'),
      image,
      specs,
      jsonLd: productLd || null,
    };
  });

  return data;
}

function normalizeProduct(raw, sourceUrl) {
  const specsEntries = Object.entries(raw.specs || {});
  const specsText = specsEntries.map(([k, v]) => `${k}: ${v}`).join(" | ");
  const id = slugFromUrl(sourceUrl);

  let baseHeight = 70;
  for (const [k, v] of specsEntries) {
    if (/height|mature height|plant height/i.test(k)) {
      const n = parseNum(v);
      if (n) {
        baseHeight = n > 200 ? 120 : Math.max(30, Math.min(180, Math.round(n)));
        break;
      }
    }
  }

  let sun;
  let water;
  for (const [k, v] of specsEntries) {
    if (!sun && /sun|light/i.test(k)) sun = mapSun(String(v));
    if (!water && /water|moisture|drought/i.test(k)) water = mapWater(String(v));
  }
  sun ||= mapSun(specsText);
  water ||= mapWater(specsText);

  const bloomSeasons = mapBloomSeasons(specsText);
  const maintenance = inferMaintenance(water, sun, specsText);

  const tags = [];
  if (sun) tags.push(`sun:${sun}`);
  if (water) tags.push(`water:${water}`);
  if (/perennial/i.test(specsText)) tags.push("perennial");
  if (/annual/i.test(specsText)) tags.push("annual");
  if (/fragrant|fragrance/i.test(specsText)) tags.push("fragrant");

  return {
    id,
    name: raw.title || id,
    icon: raw.image || "",
    baseHeight,
    footprint: [1, 1],
    tags,
    sun,
    water,
    bloomSeasons,
    maintenance,
    source: {
      url: sourceUrl,
      sku: raw.sku || "",
      brand: raw.brand || "",
      price: parseNum(raw.price),
      rating: parseNum(raw.rating),
      reviewCount: parseNum(raw.reviewCount),
    },
    rawSpecs: raw.specs || {},
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  await ensureDir(args.outDir);
  await ensureDir(args.debugDir);

  const seedInputs = await loadSeedUrls(args.seedFile);
  const validSeeds = seedInputs
    .map((s) => (looksLikeUrl(s) ? s : buildSearchUrl(s)))
    .filter(isHomeDepotUrl);
  if (validSeeds.length === 0) throw new Error(`No valid seeds in ${args.seedFile}`);

  const robots = await robotsAllows(validSeeds[0]);
  if (robots) {
    console.log(`[robots] ${robots.robotsUrl}`);
    if (robots.disallow.length) {
      console.log(`[robots] disallow rules for *: ${robots.disallow.slice(0, 10).join(", ")}`);
    }
  }

  const browser = await chromium.launch({ headless: args.headless, slowMo: args.headless ? 0 : 80 });
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  if (args.manualWarmup && !args.headless) {
    await page.goto("https://www.homedepot.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("[warmup] browser opened at homedepot.com. Complete cookie/store prompts, then press Enter.");
    const rl = readline.createInterface({ input, output });
    await rl.question("");
    rl.close();
  }

  const allLinks = new Set();
  for (const seed of validSeeds) {
    console.log(`[list] ${seed}`);
    try {
      const links = await collectProductLinks(page, seed, args.delayMs);
      for (const l of links) allLinks.add(l);
      console.log(`[list] +${links.length} products`);
      if (links.length === 0) {
        const ts = Date.now();
        const prefix = path.join(args.debugDir, `list-empty-${ts}`);
        await fs.writeFile(`${prefix}.html`, await page.content(), "utf8");
        await page.screenshot({ path: `${prefix}.png`, fullPage: true });
        console.log(`[debug] wrote ${prefix}.html/.png`);
      }
    } catch (e) {
      console.error(`[list] failed: ${seed}`, e?.message || e);
    }
  }

  const targets = Array.from(allLinks).slice(0, Math.max(1, args.maxProducts));
  console.log(`[crawl] targets=${targets.length}`);

  const rawPath = path.join(args.outDir, "plants_raw.jsonl");
  const normalizedPath = path.join(args.outDir, "plants_normalized.json");
  const metaPath = path.join(args.outDir, "crawl_meta.json");

  const rawLines = [];
  const normalized = [];
  for (let i = 0; i < targets.length; i++) {
    const url = targets[i];
    console.log(`[product ${i + 1}/${targets.length}] ${url}`);
    try {
      const raw = await extractProduct(page, url);
      rawLines.push(
        JSON.stringify({
          sourceUrl: url,
          fetchedAt: new Date().toISOString(),
          ...raw,
        })
      );
      normalized.push(normalizeProduct(raw, url));
    } catch (e) {
      rawLines.push(
        JSON.stringify({
          sourceUrl: url,
          fetchedAt: new Date().toISOString(),
          error: String(e?.message || e),
        })
      );
      console.error(`[product] failed: ${url}`, e?.message || e);
    }
    await sleep(args.delayMs);
  }

  await context.close();
  await browser.close();

  await fs.writeFile(rawPath, rawLines.join("\n"), "utf8");
  await fs.writeFile(
    normalizedPath,
    JSON.stringify(
      {
        categories: [
          {
            id: "homedepot_import",
            name: "Home Depot Import",
            variants: normalized,
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        startedAt,
        endedAt: new Date().toISOString(),
        seedFile: args.seedFile,
        outDir: args.outDir,
        seedCount: validSeeds.length,
        crawledProducts: targets.length,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`[done] raw=${rawPath}`);
  console.log(`[done] normalized=${normalizedPath}`);
  console.log(`[done] meta=${metaPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
