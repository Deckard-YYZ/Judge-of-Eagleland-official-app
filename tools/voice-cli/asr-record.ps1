param(
    [ValidateSet('zh-CN', 'en-US')][string]$Locale = 'zh-CN',
    [ValidateRange(1, 60)][int]$Seconds = 8
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$recordings = Join-Path $PSScriptRoot 'recordings'
New-Item -ItemType Directory -Force -Path $recordings | Out-Null
$name = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$wav = Join-Path $recordings ($name + '.wav')
$report = Join-Path $recordings ($name + '.jsonl')
Write-Host "SenseVoice ASR recording: $wav"
& (Join-Path $PSScriptRoot 'asr-test.exe') --model-dir (Join-Path $PSScriptRoot 'model') --locale $Locale --record $wav --record-seconds $Seconds | ForEach-Object {
    Write-Output $_
    [System.IO.File]::AppendAllText($report, $_ + [Environment]::NewLine, $utf8)
    try {
        $asr = $_ | ConvertFrom-Json
        Write-Host "Transcript: $($asr.rawText)"
        Write-Host ('Action result: ' + ($asr.result | ConvertTo-Json -Compress))
    } catch {
        Write-Warning 'Inspect the saved JSONL report for details.'
    }
}
$recordExit = $LASTEXITCODE
if (Test-Path -LiteralPath $wav) {
    Write-Host "Saved WAV: $wav"
    Write-Host "Report: $report"
}
exit $recordExit
