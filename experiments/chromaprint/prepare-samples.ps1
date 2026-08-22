param([Parameter(Mandatory = $true)] [string] $FfmpegPath)
$ErrorActionPreference = "Stop"
$sampleDir = Join-Path $PSScriptRoot "samples"
New-Item -ItemType Directory -Force -Path $sampleDir | Out-Null
function Invoke-Ffmpeg([string[]] $Arguments) { & $FfmpegPath @Arguments; if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed" } }
# Seeded noise is generated locally; no copyrighted music is included. It avoids repeating tone patterns in the different-recording control.
Invoke-Ffmpeg @("-y", "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=44100:duration=60:seed=100", (Join-Path $sampleDir "source-a.wav"))
Invoke-Ffmpeg @("-y", "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=44100:duration=60:seed=200", (Join-Path $sampleDir "source-b.wav"))
function Cut([string] $source, [string] $name, [int] $offset, [int] $duration) { Invoke-Ffmpeg @("-y", "-ss", $offset, "-t", $duration, "-i", (Join-Path $sampleDir $source), (Join-Path $sampleDir $name)) }
Cut "source-a.wav" "a-0-10.wav" 0 10; Cut "source-a.wav" "a-0-20.wav" 0 20; Cut "source-a.wav" "a-0-30.wav" 0 30; Cut "source-a.wav" "a-10-20.wav" 10 20; Cut "source-a.wav" "a-30-20.wav" 30 20; Cut "source-b.wav" "b-0-30.wav" 0 30
Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "a-0-30.wav"), "-b:a", "64k", (Join-Path $sampleDir "a-0-30-64.mp3")); Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "a-0-30.wav"), "-b:a", "128k", (Join-Path $sampleDir "a-0-30-128.mp3")); Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "a-0-30.wav"), "-b:a", "320k", (Join-Path $sampleDir "a-0-30-320.mp3")); Invoke-Ffmpeg @("-y", "-i", (Join-Path $sampleDir "a-0-30.wav"), "-c:a", "libopus", "-b:a", "96k", (Join-Path $sampleDir "a-0-30-96.opus"))
