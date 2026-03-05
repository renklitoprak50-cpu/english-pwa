$htmlFile = ".\index.html"
$content = Get-Content -Path $htmlFile -Raw -Encoding UTF8

$oldCss = ".book-card {
    flex: 0 0 160px;
    width: 160px;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    overflow: visible;
    padding-bottom: 0.5rem;
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    background: transparent;
}"

$newCss = ".book-card {
    flex: 0 0 160px;
    width: 160px;
    height: 280px;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding-bottom: 0;
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    background: transparent;
}"

$content = $content.Replace($oldCss, $newCss)
Set-Content -Path $htmlFile -Value $content -Encoding UTF8
Write-Host "Replaced CSS in index.html"
