# Home Depot Plant Scraper (Playwright)

## 1) Install deps
```bash
npm install
npx playwright install chromium
```

## 2) Add seed URLs
Edit `scripts/homedepot-seeds.txt` and add category/listing URLs (one per line).

## 3) Run
```bash
npm run scrape:homedepot -- --seed-file scripts/homedepot-seeds.txt --max-products 80 --delay-ms 1200
```

Optional args:
- `--out-dir data/homedepot`
- `--headless false`

## Output
- `data/homedepot/plants_raw.jsonl`: raw records per product page
- `data/homedepot/plants_normalized.json`: mapped to app-friendly variant schema
- `data/homedepot/crawl_meta.json`: run metadata

## Notes
- Scrape only public pages and follow site terms/robots.
- Keep low request rate (`delay-ms >= 1000`) to reduce blocking risk.
