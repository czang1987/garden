$ErrorActionPreference = "Stop"

$sourceRoot = "public/assets/plants"
$rawRoot = "scripts/raw-plants"

$plantIds = @(
  "hydrangea_paniculata_limelight",
  "boxwood_green_mountain",
  "arborvitae_emerald_green",
  "echinacea_purple_coneflower",
  "rudbeckia_black_eyed_susan",
  "hosta_frances_williams",
  "peony_sarah_bernhardt",
  "panicum_northwind",
  "schizachyrium_little_bluestem"
)

if (-not (Test-Path $rawRoot)) {
  New-Item -ItemType Directory -Path $rawRoot -Force | Out-Null
}

foreach ($id in $plantIds) {
  $srcDir = Join-Path $sourceRoot $id
  $dstDir = Join-Path $rawRoot $id
  if (-not (Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  }

  foreach ($season in @("spring", "summer", "autumn", "winter")) {
    $src = Join-Path $srcDir "$season.png"
    $dst = Join-Path $dstDir "$season.png"
    if (Test-Path $src) {
      Copy-Item $src $dst -Force
    }
  }
}

Write-Host "Initialized raw plant inputs under $rawRoot"
