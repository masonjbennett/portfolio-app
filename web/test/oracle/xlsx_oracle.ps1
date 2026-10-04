# Has desktop Excel build test/fixtures/xlsx-oracle.xlsx: a workbook of formula cases whose every answer Excel
# computed itself and saved as the cached value. test/t-xlsx.mjs evaluates each case with test/_xlsx.mjs and
# must get Excel's answer, so the evaluator is held to Excel rather than to what its author believed Excel does.
#
# Every function in _xlsx.mjs's KNOWN list has a case here, and a function joins KNOWN only with one. Cases also
# pin the operator precedences (unary minus binds tighter than ^), absolute and cross-sheet references, a quoted
# sheet name, a "<="& criterion (including a value with more digits than the 15 a number keeps when joined to
# text), an interpolated percentile, and SKEW and KURT on a short skewed series.
#
# Run from Windows PowerShell 5.1 (COM argument passing differs in pwsh 7); keep this file ASCII:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File test\oracle\xlsx_oracle.ps1
# It quits only the Excel instance it starts.
$ErrorActionPreference = 'Stop'
$web = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$out = Join-Path $web 'test\fixtures\xlsx-oracle.xlsx'
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$wb = $null
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }
  $cases = $wb.Worksheets.Item(1)
  $cases.Name = 'Cases'
  $data = $wb.Worksheets.Add([System.Reflection.Missing]::Value, $cases)
  $data.Name = 'Data'
  $other = $wb.Worksheets.Add([System.Reflection.Missing]::Value, $data)
  $other.Name = 'Other Data'

  # Data!A1:A8, a short series skewed to the right; Data!B1:B8 a second series against it.
  $a = @(0.012, -0.004, 0.003, 0.051, -0.009, 0.002, 0.006, -0.001)
  $b = @(0.010, -0.006, 0.001, 0.030, -0.012, 0.004, 0.005, 0.000)
  for ($i = 0; $i -lt 8; $i++) {
    $data.Range('A' + ($i + 1)).Value2 = $a[$i]
    $data.Range('B' + ($i + 1)).Value2 = $b[$i]
  }
  # Data!C1:C5: a blank (C2) and a word (C4) among numbers, which range functions skip.
  $data.Range('C1').Value2 = 4; $data.Range('C3').Value2 = -2; $data.Range('C4').Value2 = 'note'; $data.Range('C5').Value2 = 7
  # Data!D1:D4: a value with more significant digits than text keeps, and its neighbours.
  $data.Range('D1').Value2 = -0.012345678901234567
  $data.Range('D2').Value2 = -0.02; $data.Range('D3').Value2 = 0.01; $data.Range('D4').Value2 = -0.012345678901234
  # Data!A10:D11: two rows for SUMPRODUCT across a row.
  $data.Range('A10').Value2 = 0.25; $data.Range('B10').Value2 = 0.25; $data.Range('C10').Value2 = 0.3; $data.Range('D10').Value2 = 0.2
  $data.Range('A11').Value2 = 0.01; $data.Range('B11').Value2 = -0.02; $data.Range('C11').Value2 = 0.005; $data.Range('D11').Value2 = 0.03
  $other.Range('B1').Value2 = 10; $other.Range('B2').Value2 = 20; $other.Range('B3').Value2 = 30
  $other.Range('C1').Formula = '=Data!A4*100'

  $list = @(
    # precedence and operators
    '=-2^2', '=2^3^2', '=-Data!A4^2', '=2^-1', '=1+2*3-4/2', '=(1+2)*3', '=10-2-3', '=2*-3', '=-(2^2)',
    '=1+2&"x"', '="a"&1.5', '="<="&0.25', '=1/3&""', '="<="&Data!D1', '=1+2<4', '=1=1', '="a"="A"', '=2>=3', '=1<>1',
    '=TRUE+1', '=Data!A1>0.01', '=1/0', '=SQRT(-1)',
    # references: absolute, mixed, cross-sheet, quoted sheet name, a formula on another sheet
    '=Data!$A$1+Data!A$2+Data!$A3', '=''Other Data''!B2*2', '=SUM(''Other Data''!B1:B3)', '=''Other Data''!C1+1', '=Data!$B$4*(1+Data!A4)',
    # range functions, blanks and text skipped
    '=SUM(Data!A1:A8)', '=SUM(Data!C1:C5)', '=AVERAGE(Data!A1:A8)', '=AVERAGE(Data!C1:C5)', '=COUNT(Data!C1:C5)', '=COUNT(Data!A1:A8)',
    '=MIN(Data!A1:A8)', '=MAX(Data!A1:A8)', '=MAX(Data!A2,Data!A3)', '=MIN(Data!C2,Data!C3)', '=MAX(Data!E1:E3)', '=SQRT(2)', '=ABS(-3.5)', '=ABS(Data!A2)',
    # SUMPRODUCT: plain, conditions with --, arithmetic on arrays, booleans counting as zero, a row against a row, shapes that differ
    '=SUMPRODUCT(Data!A1:A8,Data!B1:B8)', '=SUMPRODUCT(--(Data!A1:A8<=0.002),Data!A1:A8)', '=SUMPRODUCT(--(Data!A1:A8<=0.002))',
    '=SUMPRODUCT((Data!A1:A8<0.001)*(Data!A1:A8-0.001)^2)', '=SUMPRODUCT(Data!A1:A8<=0.002)', '=SUMPRODUCT(Data!A10:D10,Data!A11:D11)',
    '=SUMPRODUCT(Data!$A$10:$D$10,Data!A11:D11)', '=SUMPRODUCT(Data!C1:C5,Data!C1:C5)', '=SUMPRODUCT(Data!A1:A8,Data!A10:D10)',
    '=-SUMPRODUCT(--(Data!A1:A8<=-Data!A2),Data!A1:A8)/SUMPRODUCT(--(Data!A1:A8<=-Data!A2))',
    # statistics
    '=STDEV.S(Data!A1:A8)', '=STDEV.S(Data!C1:C5)', '=PERCENTILE.INC(Data!A1:A8,0.05)', '=PERCENTILE.INC(Data!A1:A8,0.5)',
    '=PERCENTILE.INC(Data!A1:A8,0)', '=PERCENTILE.INC(Data!A1:A8,1)', '=PERCENTILE.INC(Data!A1:A8,0.4)', '=-PERCENTILE.INC(Data!A1:A8,0.05)',
    '=SKEW(Data!A1:A8)', '=KURT(Data!A1:A8)', '=SKEW(Data!C1:C5)', '=KURT(Data!B1:B8)',
    '=SLOPE(Data!A1:A8,Data!B1:B8)', '=INTERCEPT(Data!A1:A8,Data!B1:B8)', '=CORREL(Data!A1:A8,Data!B1:B8)', '=CORREL(Data!B1:B8,Data!B1:B8)', '=SLOPE(Data!B1:B8,Data!B1:B8)',
    '=CORREL(Data!A1:A8,Data!B1:B8)^2',
    # AVERAGEIF with a criterion joined to a number: plain, on a data point, and on a value longer than 15 digits
    '=AVERAGEIF(Data!A1:A8,"<="&0.002)', '=AVERAGEIF(Data!A1:A8,"<="&Data!A6)', '=AVERAGEIF(Data!D1:D4,"<="&Data!D1)', '=AVERAGEIF(Data!D1:D4,"<="&Data!D4)', '=AVERAGEIF(Data!A1:A8,">0")',
    # how a comparison treats two numbers that agree to 15 significant digits but not to 17
    '=Data!D1<=-0.0123456789012346', '=Data!D1=-0.0123456789012346', '=Data!D1<-0.0123456789012346', '=SUMPRODUCT(--(Data!D1:D4<=-0.0123456789012346))',
    '=SUMPRODUCT(--(Data!D1:D4<-0.0123456789012346))', '=SUMPRODUCT(--(Data!D1:D4<=Data!D1))', '=0.1+0.2=0.3', '=1+1E-15=1', '=1+1E-14=1'
  )
  for ($i = 0; $i -lt $list.Count; $i++) { $cases.Range('A' + ($i + 1)).Formula = $list[$i] }

  $xl.Calculation = -4105   # automatic
  $xl.CalculateFull()
  $cases.Activate()
  if (Test-Path $out) { Remove-Item $out }
  $wb.SaveAs($out, 51)      # .xlsx
  $wb.Close($false)
  $wb = $null
  Write-Output ("wrote {0} ({1} cases)" -f $out, $list.Count)
} finally {
  if ($wb -ne $null) { $wb.Close($false) }
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
