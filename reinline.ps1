$files = @('index.html', 'reader.html')

foreach ($htmlFile in $files) {
    if (Test-Path $htmlFile) {
        $content = Get-Content -Path $htmlFile -Raw -Encoding UTF8
        
        $pattern = '(?i)<script>\s*/\*\s*---\s*Inlined:\s*(js/[a-zA-Z0-9_-]+\.js)\s*---\s*\*/[\s\S]*?</script>'
        
        $newContent = [regex]::Replace($content, $pattern, {
            param($match)
            $jsPath = $match.Groups[1].Value
            if (Test-Path $jsPath) {
                $jsContent = Get-Content -Path $jsPath -Raw -Encoding UTF8
                return "<script>`n        /* --- Inlined: $jsPath --- */`n$jsContent`n    </script>"
            } else {
                return $match.Value
            }
        })

        Set-Content -Path $htmlFile -Value $newContent -Encoding UTF8
        Write-Host "Updated $htmlFile"
    } else {
        Write-Host "Not found $htmlFile"
    }
}
