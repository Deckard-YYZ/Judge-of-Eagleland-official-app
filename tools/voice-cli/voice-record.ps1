param(
    [ValidateSet('zh-CN', 'en-US')][string]$Locale = 'zh-CN',
    [ValidateRange(1, 60)][int]$Seconds = 8,
    [switch]$SaluteNear,
    [switch]$Segment
)
$ErrorActionPreference = 'Stop'
$recordings = Join-Path $PSScriptRoot 'recordings'
New-Item -ItemType Directory -Force -Path $recordings | Out-Null
$name = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$wav = Join-Path $recordings ($name + '.wav')
$report = Join-Path $recordings ($name + '.jsonl')
Write-Host "Recording file: $wav"
# Keep stdin attached to the console for explicit start/stop; only stdout is captured.
$utf8 = New-Object System.Text.UTF8Encoding($false)
# Windows PowerShell otherwise decodes native UTF-8 stdout with the console code page.
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$keywordArgs = @()
if ($SaluteNear) {
    if ($Locale -ne 'zh-CN') { throw 'SaluteNear requires zh-CN.' }
    $keywordArgs = @('--keywords', (Join-Path $PSScriptRoot 'keywords/salute-near.txt'))
    Write-Host 'Experimental near-pronunciation dictionary enabled (jing/jin + li/ni, all tones).'
}
if ($Segment) {
    $keywordArgs += '--segment'
    Write-Host 'Segmentation comparison enabled. Original recording will be preserved.'
}
& (Join-Path $PSScriptRoot 'voice-test.exe') --model-dir (Join-Path $PSScriptRoot 'model') --locale $Locale --record $wav --record-seconds $Seconds @keywordArgs | ForEach-Object {
    Write-Output $_
    [System.IO.File]::AppendAllText($report, $_ + [Environment]::NewLine, $utf8)
    if ($Segment) {
        try {
            $comparison = $_ | ConvertFrom-Json
            $before = $comparison.result | ConvertTo-Json -Compress
            $after = $comparison.segmentation.result | ConvertTo-Json -Compress
            Write-Host "Original result: $before"
            Write-Host "Segmented result: $after"
        } catch {
            Write-Warning 'Could not display comparison summary; inspect the saved JSONL report.'
        }
    }
}
$recordExit = $LASTEXITCODE
if (Test-Path -LiteralPath $wav) {
    Write-Host "Saved WAV: $wav"
    Write-Host "Report: $report"
    Write-Host 'Open the WAV in your audio player to compare it with samples/salute-zh.wav.'
}
exit $recordExit
