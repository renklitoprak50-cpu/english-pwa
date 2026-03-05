param(
    [string]$htmlFile
)

$content = Get-Content -Path $htmlFile -Raw -Encoding UTF8

$pattern = '<script src="(js/[^"]+\.js)"></script>'
$matches = [regex]::Matches($content, $pattern)

foreach ($match in $matches) {
    $scriptTag = $match.Groups[0].Value
    $jsPath = $match.Groups[1].Value

    if (Test-Path $jsPath) {
        $jsContent = Get-Content -Path $jsPath -Raw -Encoding UTF8
        $replacement = "<script>`n/* --- Inlined: $jsPath --- */`n$jsContent`n</script>"
        $content = $content.Replace($scriptTag, $replacement)
        Write-Host "Inlined $jsPath"
    } else {
        Write-Host "Could not find $jsPath"
    }
}

Set-Content -Path $htmlFile -Value $content -Encoding UTF8
Write-Host "Done with $htmlFile"
