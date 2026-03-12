$ErrorActionPreference = "Stop"

$rawRoot = "scripts/raw-plants"
$srcRoot = "public/assets/plants"

$map = @(
  @{ id = "hydrangea_paniculata_limelight"; src = "hydrangea_blue_bush" },
  @{ id = "boxwood_green_mountain"; src = "hydrangea" },
  @{ id = "arborvitae_emerald_green"; src = "lavender_english" },
  @{ id = "echinacea_purple_coneflower"; src = "rose_knockout_red" },
  @{ id = "rudbeckia_black_eyed_susan"; src = "tulip_red" },
  @{ id = "hosta_frances_williams"; src = "hydrangea" },
  @{ id = "peony_sarah_bernhardt"; src = "rose_iceberg_white" },
  @{ id = "panicum_northwind"; src = "lavender_english" },
  @{ id = "schizachyrium_little_bluestem"; src = "lavender" }
)

if (-not (Test-Path $rawRoot)) {
  New-Item -ItemType Directory -Path $rawRoot -Force | Out-Null
}

foreach ($m in $map) {
  $dstDir = Join-Path $rawRoot $m.id
  $srcDir = Join-Path $srcRoot $m.src
  if (-not (Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  }
  foreach ($season in @("spring", "summer", "autumn", "winter")) {
    $src = Join-Path $srcDir "$season.png"
    if (-not (Test-Path $src)) {
      # fallbacks for folders with non-standard names
      foreach ($ext in @("jpg", "jpeg", "webp", "avif")) {
        $try = Join-Path $srcDir "$season.$ext"
        if (Test-Path $try) { $src = $try; break }
      }
    }
    $dst = Join-Path $dstDir "$season.png"
    if (Test-Path $src) {
      Copy-Item $src $dst -Force
    } elseif ($season -eq "winter") {
      $fallback = Join-Path $srcDir "autumn.png"
      if (Test-Path $fallback) { Copy-Item $fallback $dst -Force }
    }
  }
}

Write-Host "Initialized raw plant inputs from existing library assets under $rawRoot"
