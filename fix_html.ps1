$ErrorActionPreference = "Stop"
$html = Get-Content -Path "reader.html" -Raw -Encoding UTF8
$jsLines = Get-Content -Path "js\reader.js" -Encoding UTF8
$jsPart = $jsLines[0..557] -join "`r`n"

# Only replace if it currently shows the broken state
$pattern = '(?s)/\*\s*---\s*Inlined:\s*js/reader\.js\s*---\s*\*/\s*}\);'
if ($html -match $pattern) {
    $replacement = "/* --- Inlined: js/reader.js --- */`r`n" + $jsPart + "`r`n        });"
    $newHtml = [regex]::Replace($html, $pattern, $replacement)
    Set-Content -Path "reader.html" -Value $newHtml -Encoding UTF8
    Write-Host "Successfully restored first 558 lines of reader.js into reader.html."
} else {
    Write-Host "Pattern not found or file was already fixed."
}
