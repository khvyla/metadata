param([Parameter(Mandatory = $true)] [string] $FfmpegPath)
$ErrorActionPreference = "Stop"
$sampleDir = Join-Path $PSScriptRoot "samples\calibration"
New-Item -ItemType Directory -Force -Path $sampleDir | Out-Null
function Invoke-Ffmpeg([string[]] $Arguments) { & $FfmpegPath @Arguments 2>$null; if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed" } }
function Cut([string] $source, [string] $name, [int] $offset, [int] $duration) { Invoke-Ffmpeg @("-y", "-ss", $offset, "-t", $duration, "-i", (Join-Path $sampleDir $source), (Join-Path $sampleDir $name)) }

for ($recording = 0; $recording -lt 30; $recording += 1) {
  $id = "r{0:D2}" -f $recording
  $base = Join-Path $sampleDir "$id-source.wav"
  $fundamental = 160 + ($recording * 17)
  $harmony = 230 + (($recording * 29) % 330)
  $accent = 370 + (($recording * 43) % 410)
  $rhythm = 1 + ($recording % 5)
  $noiseSeed = 1000 + $recording
  # Deterministic multi-voice, modulated, rhythmic source; intentionally generated, not commercial audio.
  $expression = "0.24*sin(2*PI*$fundamental*t+0.4*sin(2*PI*0.11*t))+0.16*sin(2*PI*$harmony*t)*(0.2+abs(sin(PI*$rhythm*t)))+0.10*sin(2*PI*$accent*t+0.3*sin(2*PI*0.07*t))"
  Invoke-Ffmpeg @("-y", "-f", "lavfi", "-i", "aevalsrc=${expression}:s=44100:d=45", "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=44100:d=45:seed=$noiseSeed", "-filter_complex", "[0:a][1:a]amix=inputs=2:weights='1 0.08'", $base)
  Cut "$id-source.wav" "$id-0-10.wav" 0 10; Cut "$id-source.wav" "$id-0-20.wav" 0 20; Cut "$id-source.wav" "$id-0-30.wav" 0 30; Cut "$id-source.wav" "$id-5-25.wav" 5 20; Cut "$id-source.wav" "$id-10-30.wav" 10 20; Cut "$id-source.wav" "$id-20-40.wav" 20 20
  Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "$id-5-25.wav"), "-b:a", "128k", (Join-Path $sampleDir "$id-5-25-128.mp3"))
  if ($recording -lt 15) {
    Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "$id-0-20.wav"), "-b:a", "64k", (Join-Path $sampleDir "$id-0-20-64.mp3")); Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "$id-0-20.wav"), "-b:a", "128k", (Join-Path $sampleDir "$id-0-20-128.mp3")); Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "$id-0-20.wav"), "-b:a", "320k", (Join-Path $sampleDir "$id-0-20-320.mp3")); Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "$id-0-20.wav"), "-c:a", "libopus", "-b:a", "96k", (Join-Path $sampleDir "$id-0-20-96.opus"))
  }
  Remove-Item -LiteralPath $base
}
