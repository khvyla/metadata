# Chromaprint matching experiment

This isolated harness uses the v0.6 `createAudioFingerprint()` API and `fpcalc -raw` to inspect local fingerprints. It generates seeded synthetic noise with FFmpeg, so no commercial audio is stored or committed.

Run the sample preparation with an installed FFmpeg binary, then put the directory containing `fpcalc` on `PATH` and run:

```powershell
.\experiments\chromaprint\prepare-samples.ps1 -FfmpegPath "C:\path\to\ffmpeg.exe"
npm run build --silent
node .\experiments\chromaprint\run.js
```

`comparison.js` implements an experimental sliding raw-frame Hamming-bit score because `fpcalc` does not provide a high-level local matcher. It is experiment-only and must not be treated as a stable matching API or production threshold.
