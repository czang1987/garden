# Plant Asset Render (Style-Matched + Optional Cutout)

This script renders new plant assets into the existing project format:
- `public/assets/plants/<plantId>/spring.png`
- `public/assets/plants/<plantId>/summer.png`
- `public/assets/plants/<plantId>/autumn.png`
- `public/assets/plants/<plantId>/winter.png`
- `public/assets/plants/<plantId>/icon.png`

## 1) Prepare raw images
Put source files under:
`scripts/raw-plants/<plantId>/`

Preferred file names:
- `spring.jpg|png|webp`
- `summer.jpg|png|webp`
- `autumn.jpg|png|webp`
- `winter.jpg|png|webp`

If some seasons are missing, the script reuses available images.

## 2) Install dependency
```bash
npm install
```

## 3) Run
```bash
npm run plants:render
```

Render specific plants:
```bash
npm run plants:render -- --plants hydrangea_paniculata_limelight,peony_sarah_bernhardt
```

## Optional cutout controls
- Disable cutout:
```bash
npm run plants:render -- --cutout false
```
- Tune background removal:
```bash
npm run plants:render -- --bg-low 20 --bg-high 72
```

## Style reference (color transfer, not background overlay)
Use an existing plant image as style reference:
```bash
npm run plants:render -- --style-ref public/assets/plants/rose/summer.png --style-strength 0.65
```

## Notes
- Cutout is edge-background color based; best with simple backgrounds.
- Output is transparent PNG and bottom-aligned, matching existing front-view style.
