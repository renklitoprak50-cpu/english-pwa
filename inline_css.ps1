param(
    [string]$htmlFile
)

$content = Get-Content -Path $htmlFile -Raw -Encoding UTF8

$exactMatch = '<link rel="stylesheet" href="css/main.css">'
if ($content -match "css/main.css") {
    if (Test-Path "css/main.css") {
        $cssContent = Get-Content -Path "css/main.css" -Raw -Encoding UTF8
        $replacement = "<style>`n/* --- Inlined: css/main.css --- */`n$cssContent`n</style>"
        $content = $content.Replace($exactMatch, $replacement)
        Write-Host "Inlined css/main.css into $htmlFile"
    }
    else {
        Write-Host "Could not find css/main.css"
    }
}
else {
    Write-Host "No css link tag found"
}

Set-Content -Path $htmlFile -Value $content -Encoding UTF8
Write-Host "Done with $htmlFile"
