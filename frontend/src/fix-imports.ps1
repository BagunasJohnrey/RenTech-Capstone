$M = @('DashboardView','CatalogView','HistoryView','AIInsightsView','InventoryAnalyticsView','ProfileSettingsView','StaffTasksView','StaffNewRental','HelpGuide','LandingPage')
$src = "C:\Users\johnr\RenTech - Capstone\frontend\src"
foreach ($name in $M) {
  Move-Item -Path (Join-Path $src "components\$name.jsx") -Destination (Join-Path $src "pages\$name.jsx") -Force
}
foreach ($name in $M) {
  $f = Join-Path $src "pages\$name.jsx"
  $content = Get-Content $f -Raw
  $pattern = [regex] "('|"")\./([A-Za-z0-9_]+)('|"")"
  $content = $pattern.Replace($content, {
    param($m)
    $q = $m.Groups[1].Value
    $base = $m.Groups[2].Value
    $q2 = $m.Groups[3].Value
    if ($M -notcontains $base) { return "$q../components/$base$q2" }
    return $m.Value
  })
  Set-Content $f $content
}
Write-Host "Moved and rewrote: $($M.Count) files"
