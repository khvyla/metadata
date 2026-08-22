# Chromaprint radio-matching experiment

Generated: 2026-08-22T21:55:29.368Z

The score below is an **experimental** sliding raw-frame Hamming-bit similarity. Chromaprint/fpcalc does not expose a high-level local matcher, so this is not a stable khvyla. API.

| Sample A | Sample B | Relationship | Scenario | Duration (s) | Exact equality | Experimental score | Best offset frames | Expected match | Observed ≥0.75 |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
| a-0-30.wav | a-0-30-64.mp3 | same-recording | encoding-64k | 30 / 30 | no | 0.983 | 0 | yes | yes |
| a-0-30.wav | a-0-30-128.mp3 | same-recording | encoding-128k | 30 / 30 | no | 0.989 | 0 | yes | yes |
| a-0-30.wav | a-0-30-320.mp3 | same-recording | encoding-320k | 30 / 30 | no | 1.000 | 0 | yes | yes |
| a-0-30.wav | a-0-30-96.opus | same-recording | encoding-opus-96k | 30 / 30 | no | 0.979 | 0 | yes | yes |
| a-0-10.wav | a-0-20.wav | same-recording | duration-10-vs-20 | 10 / 20 | no | 1.000 | 0 | yes | yes |
| a-0-20.wav | a-0-30.wav | same-recording | duration-20-vs-30 | 20 / 30 | no | 1.000 | 0 | yes | yes |
| a-0-20.wav | a-10-20.wav | same-recording | overlapping-offset | 20 / 20 | no | 0.978 | -81 | yes | yes |
| a-0-20.wav | a-30-20.wav | same-recording | non-overlapping-offset | 20 / 20 | no | 0.783 | -120 | yes | yes |
| a-0-30.wav | b-0-30.wav | different-recording | different-source | 30 / 30 | no | 0.765 | -63 | no | yes |

## Findings

### A. Encoding robustness

The same 30-second synthetic source survived MP3 64/128/320 kbps and Opus 96 kbps with experimental scores from 0.979 to 1.000. The encoded fingerprints were not exactly equal, so exact fingerprint-string equality is not a viable matching rule.

### B. Offset robustness

The overlapping 20-second windows scored 0.978 at a shifted alignment. The non-overlapping windows scored 0.783, but only over 20 frames and close to the unrelated-control score; this is not reliable evidence of a recording-level match without time-indexed data and a calibrated matcher.

### C. Sample duration

The 10/20 and 20/30 same-start comparisons aligned at 1.000. Ten seconds produced only 59 compared frames, so this corpus supports 20–30 seconds as the more practical initial radio window; ten seconds needs broader, music-like validation before adoption.

### D. False matches

The clearly different synthetic control scored 0.765, which would pass the provisional 0.75 marker. This is a suspicious false positive and shows the experimental score and threshold are not suitable for production matching.

### E. Radio suitability

Chromaprint is technically promising for surviving common transcoding, but this experiment does not establish reliable radio matching. No real-radio capture was run: the experiment deliberately used only generated legal material and did not have a known same-recording pair across stations.

### F. Index implications

Store multiple time-indexed fingerprint segments per recording rather than one fingerprint per recording. A future index also needs a calibrated local matcher and false-positive evaluation over representative music/radio captures before automatic recovery is considered.
