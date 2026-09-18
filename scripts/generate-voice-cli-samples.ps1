$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$sampleRoot = Join-Path $PSScriptRoot '../artifacts/voice-cli/samples'
New-Item -ItemType Directory -Force -Path $sampleRoot | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.SelectVoice('Microsoft Huihui Desktop')
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    # Code points keep this script compatible with Windows PowerShell's default encoding.
    $words = @{
        'salute-zh' = ([string][char]0x656c + [char]0x793c)
        'bow-zh' = ([string][char]0x884c + [char]0x793c)
        'wave-zh' = ([string][char]0x6325 + [char]0x624b)
    }
    foreach ($name in $words.Keys) {
        $synth.SetOutputToWaveFile((Join-Path (Resolve-Path $sampleRoot).Path "$name.wav"), $format)
        $synth.Speak($words[$name])
        $synth.SetOutputToNull()
    }
} finally {
    $synth.Dispose()
}
Write-Output "Samples ready: $sampleRoot"
