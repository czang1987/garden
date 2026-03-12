Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

function New-ColorFromHex([string]$hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-PlantImage {
  param(
    [string]$Path,
    [int]$Size,
    [string]$BgHex,
    [string]$AccentHex,
    [string]$SoilHex,
    [string]$PlantHex,
    [string]$Name,
    [string]$SeasonLabel,
    [string]$PlantType
  )

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  try {
    $bg = New-ColorFromHex $BgHex
    $accent = New-ColorFromHex $AccentHex
    $soil = New-ColorFromHex $SoilHex
    $plant = New-ColorFromHex $PlantHex
    $fg = [System.Drawing.Color]::FromArgb(248, 248, 248)
    $line = [System.Drawing.Color]::FromArgb(65, 65, 65)

    $rectAll = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $gradBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      $rectAll,
      [System.Drawing.Color]::FromArgb(255, $bg.R, $bg.G, $bg.B),
      [System.Drawing.Color]::FromArgb(255, $accent.R, $accent.G, $accent.B),
      [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    )
    $g.FillRectangle($gradBg, $rectAll)
    $gradBg.Dispose()

    $penLine = New-Object System.Drawing.Pen($line, [Math]::Max(2, [int]($Size * 0.008)))
    $brushFg = New-Object System.Drawing.SolidBrush($fg)
    $soilBrush = New-Object System.Drawing.SolidBrush($soil)
    $plantBrush = New-Object System.Drawing.SolidBrush($plant)
    $highlightBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 255, 255, 255))
    $darkLeafBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, [Math]::Max(0, $plant.R - 30), [Math]::Max(0, $plant.G - 30), [Math]::Max(0, $plant.B - 30)))
    $stemPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(95, 78, 58), [Math]::Max(4, [int]($Size * 0.02)))

    try {
      # Soft vignette
      $g.FillEllipse($highlightBrush, [int]($Size * 0.05), [int]($Size * 0.04), [int]($Size * 0.9), [int]($Size * 0.64))

      # Soil strip
      $soilY = [int]($Size * 0.76)
      $g.FillRectangle($soilBrush, 0, $soilY, $Size, [int]($Size * 0.24))
      for ($i = 0; $i -lt 18; $i++) {
        $x = [int](($Size / 18) * $i + (($i % 3) * 2))
        $g.DrawLine($penLine, $x, $soilY + [int]($Size * 0.04), $x + 10, $soilY + [int]($Size * 0.08))
      }

      # Plant motif
      switch ($PlantType) {
        "shrub" {
          $g.FillEllipse($darkLeafBrush, [int]($Size * 0.2), [int]($Size * 0.28), [int]($Size * 0.6), [int]($Size * 0.38))
          $g.FillEllipse($plantBrush, [int]($Size * 0.15), [int]($Size * 0.34), [int]($Size * 0.35), [int]($Size * 0.28))
          $g.FillEllipse($plantBrush, [int]($Size * 0.5), [int]($Size * 0.32), [int]($Size * 0.35), [int]($Size * 0.3))
          $g.FillEllipse($highlightBrush, [int]($Size * 0.33), [int]($Size * 0.25), [int]($Size * 0.34), [int]($Size * 0.18))
        }
        "conifer" {
          $points = @(
            (New-Object System.Drawing.Point([int]($Size * 0.5), [int]($Size * 0.14))),
            (New-Object System.Drawing.Point([int]($Size * 0.26), [int]($Size * 0.64))),
            (New-Object System.Drawing.Point([int]($Size * 0.74), [int]($Size * 0.64)))
          )
          $g.FillPolygon($darkLeafBrush, $points)
          $points2 = @(
            (New-Object System.Drawing.Point([int]($Size * 0.5), [int]($Size * 0.22))),
            (New-Object System.Drawing.Point([int]($Size * 0.3), [int]($Size * 0.63))),
            (New-Object System.Drawing.Point([int]($Size * 0.7), [int]($Size * 0.63)))
          )
          $g.FillPolygon($plantBrush, $points2)
          $g.DrawLine($stemPen, [int]($Size * 0.5), [int]($Size * 0.64), [int]($Size * 0.5), [int]($Size * 0.77))
        }
        "flower" {
          $g.DrawLine($stemPen, [int]($Size * 0.5), [int]($Size * 0.45), [int]($Size * 0.5), [int]($Size * 0.76))
          $g.FillEllipse($darkLeafBrush, [int]($Size * 0.42), [int]($Size * 0.5), [int]($Size * 0.14), [int]($Size * 0.08))
          $petalBrush = New-Object System.Drawing.SolidBrush($accent)
          try {
            for ($k = 0; $k -lt 8; $k++) {
              $angle = [Math]::PI * 2 * $k / 8
              $cx = [int]($Size * 0.5 + [Math]::Cos($angle) * $Size * 0.08)
              $cy = [int]($Size * 0.35 + [Math]::Sin($angle) * $Size * 0.08)
              $g.FillEllipse($petalBrush, $cx - [int]($Size * 0.045), $cy - [int]($Size * 0.03), [int]($Size * 0.09), [int]($Size * 0.06))
            }
            $g.FillEllipse($plantBrush, [int]($Size * 0.45), [int]($Size * 0.31), [int]($Size * 0.1), [int]($Size * 0.09))
          } finally {
            $petalBrush.Dispose()
          }
        }
        "grass" {
          for ($k = 0; $k -lt 9; $k++) {
            $x0 = [int]($Size * (0.32 + $k * 0.04))
            $y0 = [int]($Size * 0.76)
            $x1 = [int]($x0 + (($k % 2) - 0.5) * $Size * 0.08)
            $y1 = [int]($Size * 0.35 - (($k % 3) * 0.04 * $Size))
            $g.DrawLine($stemPen, $x0, $y0, $x1, $y1)
            $g.FillEllipse($plantBrush, $x1 - [int]($Size * 0.02), $y1 - [int]($Size * 0.015), [int]($Size * 0.04), [int]($Size * 0.03))
          }
        }
      }

      $g.DrawEllipse($penLine, [int]($Size * 0.08), [int]($Size * 0.12), [int]($Size * 0.84), [int]($Size * 0.68))

      # Name block
      $labelRect = New-Object System.Drawing.RectangleF([single]($Size * 0.08), [single]($Size * 0.75), [single]($Size * 0.84), [single]($Size * 0.18))
      $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 30, 30, 30))
      $g.FillRectangle($labelBrush, $labelRect)
      $labelBrush.Dispose()

      $fontSizeMain = [Math]::Max(10, [int]($Size * 0.065))
      $fontSizeSub = [Math]::Max(9, [int]($Size * 0.045))
      $fontMain = New-Object System.Drawing.Font("Segoe UI", $fontSizeMain, [System.Drawing.FontStyle]::Bold)
      $fontSub = New-Object System.Drawing.Font("Segoe UI", $fontSizeSub, [System.Drawing.FontStyle]::Regular)

      try {
        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

        $mainRect = New-Object System.Drawing.RectangleF([single]($Size * 0.1), [single]($Size * 0.78), [single]($Size * 0.8), [single]($Size * 0.075))
        $subRect = New-Object System.Drawing.RectangleF([single]($Size * 0.1), [single]($Size * 0.855), [single]($Size * 0.8), [single]($Size * 0.06))
        $g.DrawString($Name, $fontMain, $brushFg, $mainRect, $sf)
        $g.DrawString($SeasonLabel, $fontSub, $brushFg, $subRect, $sf)
        $sf.Dispose()
      } finally {
        $fontMain.Dispose()
        $fontSub.Dispose()
      }
    } finally {
      $penLine.Dispose()
      $brushFg.Dispose()
      $soilBrush.Dispose()
      $plantBrush.Dispose()
      $highlightBrush.Dispose()
      $darkLeafBrush.Dispose()
      $stemPen.Dispose()
    }

    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}

$root = "public/assets/plants"

$plants = @(
  @{ id = "hydrangea_paniculata_limelight"; label = "Limelight"; type = "shrub" },
  @{ id = "boxwood_green_mountain"; label = "Boxwood"; type = "shrub" },
  @{ id = "arborvitae_emerald_green"; label = "Arborvitae"; type = "conifer" },
  @{ id = "echinacea_purple_coneflower"; label = "Echinacea"; type = "flower" },
  @{ id = "rudbeckia_black_eyed_susan"; label = "Rudbeckia"; type = "flower" },
  @{ id = "hosta_frances_williams"; label = "Hosta"; type = "shrub" },
  @{ id = "peony_sarah_bernhardt"; label = "Peony"; type = "flower" },
  @{ id = "panicum_northwind"; label = "Panicum"; type = "grass" },
  @{ id = "schizachyrium_little_bluestem"; label = "Bluestem"; type = "grass" }
)

$seasonStyles = @{
  spring = @{ bg = "#BCDFA5"; accent = "#F2B9C8"; soil = "#8E6A4A"; plant = "#4D8F4C"; label = "Spring" }
  summer = @{ bg = "#7FC5D6"; accent = "#F3CC6A"; soil = "#7E5B3F"; plant = "#3E7D40"; label = "Summer" }
  autumn = @{ bg = "#DDA56F"; accent = "#C75B3C"; soil = "#6F4D36"; plant = "#7B7C35"; label = "Autumn" }
  winter = @{ bg = "#AFC3DB"; accent = "#DDE9F2"; soil = "#7A6352"; plant = "#5C7364"; label = "Winter" }
  icon   = @{ bg = "#96C59D"; accent = "#D9E6C8"; soil = "#816249"; plant = "#4A8650"; label = "Icon" }
}

foreach ($p in $plants) {
  $plantDir = Join-Path $root $p.id
  if (-not (Test-Path $plantDir)) { New-Item -ItemType Directory -Path $plantDir -Force | Out-Null }

  # icon
  $iconPath = Join-Path $plantDir "icon.png"
  New-PlantImage -Path $iconPath -Size 256 -BgHex $seasonStyles.icon.bg -AccentHex $seasonStyles.icon.accent -SoilHex $seasonStyles.icon.soil -PlantHex $seasonStyles.icon.plant -Name $p.label -SeasonLabel $seasonStyles.icon.label -PlantType $p.type

  foreach ($season in @("spring", "summer", "autumn", "winter")) {
    $s = $seasonStyles[$season]
    $imgPath = Join-Path $plantDir "$season.png"
    New-PlantImage -Path $imgPath -Size 640 -BgHex $s.bg -AccentHex $s.accent -SoilHex $s.soil -PlantHex $s.plant -Name $p.label -SeasonLabel $s.label -PlantType $p.type
  }
}

Write-Host "Generated placeholder assets for $($plants.Count) plants under $root"
