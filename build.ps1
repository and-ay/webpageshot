# Сборка архивов для магазинов расширений:
#   dist/webpageshot-chrome-<версия>.zip  — Chrome Web Store, Edge Add-ons, Opera;
#   dist/webpageshot-firefox-<версия>.zip — addons.mozilla.org.
# manifest.json в репозитории — для Chromium (его можно загрузить папкой без предупреждений);
# архив для Firefox получает свой вариант манифеста, архив для Chromium — без ключей Firefox.
# Запуск: powershell -ExecutionPolicy Bypass -File build.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$common = @('background.js', '_locales', 'icons', 'lib', 'popup', 'preview', 'save')

$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8
$version = ($manifest | ConvertFrom-Json).version

$targets = @(
  @{
    name = 'chrome'
    files = $common + 'offscreen'
    edit = {
      param($m)
      $m.PSObject.Properties.Remove('browser_specific_settings')
    }
  },
  @{
    name = 'firefox'
    files = $common # offscreen-документов в Firefox нет
    edit = {
      param($m)
      $m.PSObject.Properties.Remove('minimum_chrome_version')
      # Firefox запускает фон как обычную страницу, а не service worker
      $m.background.PSObject.Properties.Remove('service_worker')
      $m.background | Add-Member scripts @('background.js')
      $m.permissions = @($m.permissions | Where-Object { $_ -ne 'offscreen' })
    }
  }
)

New-Item -ItemType Directory -Force $dist | Out-Null
foreach ($target in $targets) {
  $m = $manifest | ConvertFrom-Json
  & $target.edit $m
  $json = $m | ConvertTo-Json -Depth 20

  $zipPath = Join-Path $dist "webpageshot-$($target.name)-$version.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath }
  $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    $entry = $zip.CreateEntry('manifest.json', 'Optimal')
    $writer = New-Object IO.StreamWriter($entry.Open(), (New-Object Text.UTF8Encoding $false))
    $writer.Write($json)
    $writer.Dispose()
    foreach ($item in $target.files) {
      foreach ($file in Get-ChildItem (Join-Path $root $item) -Recurse -File) {
        # пути внутри zip — через «/»: архивы с «\» Firefox и магазины не принимают
        $name = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $name, 'Optimal')
      }
    }
  } finally {
    $zip.Dispose()
  }
  '{0,-34} {1,8:N0} байт' -f (Split-Path $zipPath -Leaf), (Get-Item $zipPath).Length
}
