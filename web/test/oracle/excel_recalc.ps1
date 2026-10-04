# Has desktop Excel recalculate the scorecard workbook and records what it got, in
# test/fixtures/workbook-excel.json, for test/t-workbook.mjs.
#
#   1. Fetches the SheetJS build the page loads (the SHEETJS_URL in src/download.ts) into a temp folder. It is
#      never committed and never a dependency.
#   2. Builds the book for every set in excel_recalc.mjs through src/download.ts's writeBook, and refuses a
#      file whose XML holds a formula with no cached value.
#   3. Opens each book in Excel, forces a full recalculation, and reads every formula cell back.
#   4. Holds each of Excel's values to the value the book was saved with, and writes the fixture.
#
# Run from Windows PowerShell 5.1 in web\ (keep this file ASCII):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File test\oracle\excel_recalc.ps1 [-Columns id1,id2]
# -Columns names scorecard columns added beyond the five, for the books to carry. It quits only the Excel
# instance it starts, and deletes its temp folder.
param([string]$Columns = '')
$ErrorActionPreference = 'Stop'
$web = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$helper = Join-Path $PSScriptRoot 'excel_recalc.mjs'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('scorecard-book-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Invoke-Helper([string[]]$rest) {
  $all = @('--import', './test/_tsx.mjs', $helper) + $rest
  if ($Columns) { $all += @('--columns', $Columns) }
  Push-Location $web
  try {
    & node @all
    if ($LASTEXITCODE -ne 0) { throw "excel_recalc.mjs $($rest[0]) failed" }
  } finally { Pop-Location }
}

# One value as JSON: a number at full precision, a boolean, text, or an Excel error (which COM hands over as
# an integer code, so it is recorded as an error, never as a number).
function To-Json($v) {
  if ($v -eq $null) { return 'null' }
  if ($v -is [double]) { return $v.ToString('G17', $inv) }
  if ($v -is [bool]) { if ($v) { return 'true' } else { return 'false' } }
  if ($v -is [int]) { return '{"error":' + $v + '}' }
  return '"' + ([string]$v).Replace('\', '\\').Replace('"', '\"') + '"'
}

function Col-Name([int]$i) {
  $s = ''
  for ($n = $i; $n -gt 0; $n = [math]::Floor(($n - 1) / 26)) { $s = [char][int](65 + (($n - 1) % 26)) + $s }
  return $s
}

$xl = $null
try {
  $src = Get-Content -Raw (Join-Path $web 'src\download.ts')
  $m = [regex]::Match($src, 'SHEETJS_URL = "([^"]+)"')
  if (-not $m.Success) { throw 'SHEETJS_URL not found in src/download.ts' }
  $url = $m.Groups[1].Value
  $sheetjs = Join-Path $tmp 'xlsx.mjs'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $sheetjs -UseBasicParsing
  Write-Output "fetched $url"

  Invoke-Helper @('build', '--sheetjs', $sheetjs, '--out', $tmp)

  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $xl.AskToUpdateLinks = $false
  $version = $xl.Version + ' build ' + $xl.Build
  foreach ($file in Get-ChildItem -Path $tmp -Filter '*.xlsx') {
    $wb = $xl.Workbooks.Open($file.FullName, 0, $true)
    $xl.Calculation = -4105   # automatic
    $xl.CalculateFullRebuild()
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{')
    $firstSheet = $true
    foreach ($ws in $wb.Worksheets) {
      $used = $ws.UsedRange
      if ($used.Row -ne 1 -or $used.Column -ne 1) { throw "$($file.Name) $($ws.Name): the used range does not start at A1" }
      $forms = $used.Formula
      $vals = $used.Value2
      $rows = $used.Rows.Count
      $cols = $used.Columns.Count
      if (-not $firstSheet) { [void]$sb.Append(',') }
      $firstSheet = $false
      [void]$sb.Append('"' + $ws.Name + '":{')
      $first = $true
      for ($r = 1; $r -le $rows; $r++) {
        for ($c = 1; $c -le $cols; $c++) {
          $f = if ($rows -eq 1 -and $cols -eq 1) { $forms } else { $forms[$r, $c] }
          if ($f -is [string] -and $f.StartsWith('=')) {
            $v = if ($rows -eq 1 -and $cols -eq 1) { $vals } else { $vals[$r, $c] }
            if (-not $first) { [void]$sb.Append(',') }
            $first = $false
            [void]$sb.Append('"' + (Col-Name $c) + $r + '":' + (To-Json $v))
          }
        }
      }
      [void]$sb.Append('}')
    }
    [void]$sb.Append('}')
    $wb.Close($false)
    $json = Join-Path $tmp ($file.BaseName + '.excel.json')
    [System.IO.File]::WriteAllText($json, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "recalculated $($file.Name) in Excel $version"
  }
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  $xl = $null

  Invoke-Helper @('compare', '--dir', $tmp, '--excel', $version, '--sheetjs-url', $url)
} finally {
  if ($xl -ne $null) {
    $xl.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
