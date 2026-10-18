# Рендер картинок из frames.html: каждый блок .frame снимается в своём точном размере.
# Картинки для магазинов — в store/graphics, PNG без прозрачности (Chrome Web Store не принимает альфа-канал);
# значки расширения — в icons/, с прозрачным фоном.
# Нужен установленный Chrome или Edge. Запуск: powershell -ExecutionPolicy Bypass -File store\graphics\src\render.ps1
param([string] $Browser, [int] $Port = 9360)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = $PSScriptRoot
$root = Split-Path (Split-Path (Split-Path $src))
# id блока → файл относительно корня проекта; alpha — сохранить прозрачность
$frames = [ordered]@{
  'shot-1' = @{ path = 'store\graphics\screenshot-1.png'; opera = 'store\graphics\opera\screenshot-1.png' }
  'shot-2' = @{ path = 'store\graphics\screenshot-2.png'; opera = 'store\graphics\opera\screenshot-2.png' }
  'shot-3' = @{ path = 'store\graphics\screenshot-3.png' }
  'shot-4' = @{ path = 'store\graphics\screenshot-4.png'; opera = 'store\graphics\opera\screenshot-3.png' }
  'shot-5' = @{ path = 'store\graphics\screenshot-5.png' }
  'tile' = @{ path = 'store\graphics\promo-small-440x280.png' }
  'marquee' = @{ path = 'store\graphics\promo-marquee-1400x560.png' }
  'icon-16' = @{ path = 'icons\icon16.png'; alpha = $true }
  'icon-24' = @{ path = 'icons\icon24.png'; alpha = $true }
  'icon-32' = @{ path = 'icons\icon32.png'; alpha = $true }
  'icon-48' = @{ path = 'icons\icon48.png'; alpha = $true }
  'icon-128' = @{ path = 'icons\icon128.png'; alpha = $true }
  'logo-300' = @{ path = 'store\graphics\logo-300.png'; alpha = $true }
  'icon-64' = @{ path = 'store\graphics\opera\icon-64.png'; alpha = $true }
}

# без альфа-канала: перерисовываем в 24-битную картинку
function Save-Rgb([string] $data, [string] $path) {
  $ms = New-Object IO.MemoryStream (, [Convert]::FromBase64String($data))
  $img = [Drawing.Image]::FromStream($ms)
  $rgb = New-Object Drawing.Bitmap $img.Width, $img.Height, ([Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [Drawing.Graphics]::FromImage($rgb)
  $g.DrawImage($img, 0, 0, $img.Width, $img.Height)
  $rgb.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $rgb.Dispose(); $img.Dispose(); $ms.Dispose()
}
New-Item -ItemType Directory (Join-Path $root 'store\graphics\opera') -Force | Out-Null

if (-not $Browser) {
  $Browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  ) + (Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeCore\*\msedge.exe" -ErrorAction SilentlyContinue | ForEach-Object FullName) |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Browser) { throw 'Не найден Chrome или Edge — укажите путь: -Browser <путь к exe>' }
}

$profile = Join-Path $env:TEMP "webpageshot-render-$Port"
$argv = @('--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1400,1000',
  "--remote-debugging-port=$Port", "--user-data-dir=$profile", '--no-first-run', 'about:blank')
Start-Process -FilePath $Browser -ArgumentList $argv | Out-Null

# одно соединение на всю работу: настройки DevTools (прозрачный фон) живут, пока соединение открыто
$script:sock = $null
$script:nextId = 0
$buf = New-Object byte[] 33554432
function Send-Cdp([string] $method, $params = @{}) {
  $id = ++$script:nextId
  $bytes = [Text.Encoding]::UTF8.GetBytes((@{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 10 -Compress))
  $script:sock.SendAsync([ArraySegment[byte]]$bytes, 'Text', $true, [Threading.CancellationToken]::None).Wait()
  $sb = New-Object Text.StringBuilder
  while ($true) {
    $task = $script:sock.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None)
    if (-not $task.Wait(45000)) { throw "$method -> нет ответа" }
    [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $task.Result.Count))
    if ($task.Result.EndOfMessage) {
      $text = $sb.ToString(); [void]$sb.Clear()
      if ($text -match "`"id`":$id[,}]") { return ($text | ConvertFrom-Json).result }
    }
  }
}
try {
  $page = $null
  for ($i = 0; $i -lt 30 -and -not $page; $i++) {
    Start-Sleep -Milliseconds 500
    try { $page = Invoke-RestMethod -Method Put "http://127.0.0.1:$Port/json/new?$([Uri]::new((Join-Path $src 'frames.html')).AbsoluteUri)" } catch {}
  }
  Start-Sleep -Seconds 2
  $script:sock = New-Object System.Net.WebSockets.ClientWebSocket
  $script:sock.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $null = Send-Cdp 'Emulation.setDefaultBackgroundColorOverride' @{ color = @{ r = 0; g = 0; b = 0; a = 0 } }
  $null = Send-Cdp 'Runtime.evaluate' @{ expression = 'document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode())))'; awaitPromise = $true }

  foreach ($id in $frames.Keys) {
    $r = (Send-Cdp 'Runtime.evaluate' @{
      expression = "(() => { const r = document.getElementById('$id').getBoundingClientRect(); return JSON.stringify({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }); })()"
      returnByValue = $true }).result.value | ConvertFrom-Json
    $shot = Send-Cdp 'Page.captureScreenshot' @{ format = 'png'; captureBeyondViewport = $true; clip = @{ x = $r.x; y = $r.y; width = $r.w; height = $r.h; scale = 1 } }

    $path = Join-Path $root $frames[$id].path
    $bytes = [Convert]::FromBase64String($shot.data)
    if ($frames[$id].alpha) {
      [IO.File]::WriteAllBytes($path, $bytes)
      '{0,-36} {1}×{2}' -f $frames[$id].path, [int]$r.w, [int]$r.h
      continue
    }

    Save-Rgb $shot.data $path
    '{0,-36} {1}×{2}' -f $frames[$id].path, [int]$r.w, [int]$r.h

    # Opera принимает скриншоты не больше 800×600: тот же кадр, отрисованный в масштабе 800/1280 (800×500)
    if ($frames[$id].opera) {
      $small = Send-Cdp 'Page.captureScreenshot' @{ format = 'png'; captureBeyondViewport = $true; clip = @{ x = $r.x; y = $r.y; width = $r.w; height = $r.h; scale = 800 / $r.w } }
      Save-Rgb $small.data (Join-Path $root $frames[$id].opera)
      '{0,-36} 800×{1}' -f $frames[$id].opera, [int]($r.h * 800 / $r.w)
    }
  }
}
finally {
  if ($script:sock) { $script:sock.Dispose() }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$profile*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# скриншоты нужны и сайту: GitHub Pages публикует только docs/
Copy-Item (Join-Path $root 'store\graphics\screenshot-*.png') (Join-Path $root 'docs') -Force
