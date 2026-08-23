# Real music Chromaprint recognition validation

## Corpus and baseline

- 20 indexed and 8 unknown-only recordings from the Ondrosik Free Music Library, licensed CC0 1.0. Source audio remains ignored; this repository retains only the manifest, raw-result data, and report.
- Baseline used the existing quantized-frame-shingle retrieval, Top-20 segment handoff, existing detailed matcher, and the previously calibrated conservative rule unchanged.

## Retrieval (known indexed queries)

| Recall@1 | @5 | @10 | @20 | @50 | Missing rate |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 17.4% | 17.4% | 17.4% | 17.4% | 17.4% | 82.6% |

## Existing matcher decision rule

- average bit similarity ≥ 0.99; strong-frame proportion ≥ 0.3; longest strong run ≥ 120; aligned evidence ≥ 40 frames.
- Known queries: TP 0, FP 0, FN 109; precision 0.0%, recall 0.0%.
- Unknown-only queries: 8/8 rejected; 0 falsely matched (unknown-query FPR 0.0%).

## Duration and transformations

- MP3 64 kbps: 0/20 correctly accepted; retrieval@20 20.0%.
- MP3 128 kbps: 0/20 correctly accepted; retrieval@20 15.0%.
- MP3 320 kbps: 0/20 correctly accepted; retrieval@20 20.0%.
- Opus 96 kbps: 0/20 correctly accepted; retrieval@20 10.0%.
- 10-second MP3 128 kbps: 0/10 correctly accepted; retrieval@20 20.0%.
- 30-second MP3 128 kbps: 0/10 correctly accepted; retrieval@20 20.0%.
- loudnorm: 0/1 correctly accepted; retrieval@20 0.0%.
- double-transcode: 0/1 correctly accepted; retrieval@20 0.0%.
- gain: 0/1 correctly accepted; retrieval@20 0.0%.
- mild-eq: 0/1 correctly accepted; retrieval@20 0.0%.
- mono: 0/1 correctly accepted; retrieval@20 100.0%.
- low-level tone overlay: 0/2 correctly accepted; retrieval@20 0.0%.
- low-level noise overlay: 0/2 correctly accepted; retrieval@20 50.0%.

## Failure analysis

- Accepted wrong matches: 0; rejected or wrongly selected known queries: 109.
- FN: rm01; retrieval-missing; MP3 64 kbps; correct retrieval rank missing.
- FN: rm01; retrieval-missing; MP3 128 kbps; correct retrieval rank missing.
- FN: rm01; retrieval-missing; MP3 320 kbps; correct retrieval rank missing.
- FN: rm01; retrieval-missing; Opus 96 kbps; correct retrieval rank missing.
- FN: rm02; retrieval-missing; MP3 64 kbps; correct retrieval rank missing.
- FN: rm02; retrieval-missing; MP3 128 kbps; correct retrieval rank missing.
- FN: rm02; retrieval-missing; MP3 320 kbps; correct retrieval rank missing.
- FN: rm02; retrieval-missing; Opus 96 kbps; correct retrieval rank missing.
- FN: rm03; retrieval-missing; MP3 64 kbps; correct retrieval rank missing.
- FN: rm03; retrieval-missing; MP3 128 kbps; correct retrieval rank missing.

## Interpretation

- Retrieval did not retain enough correct recordings by Top-20 on this limited CC0 corpus. Candidate retrieval is the primary bottleneck; the existing detailed matcher/rule also rejected every candidate that did reach it.
- The dominant failure is exact token scarcity after a non-identical offset/transcode: the current sampled shingle tokens are strongly offset-sensitive, so most correct recordings never reach detailed matching. This is not a matcher-threshold problem.
- This is not a production readiness claim. The corpus is one CC0 catalogue and has no real radio capture, station processing, or broad commercial-music coverage. A next experiment should retain this baseline and investigate offset-tolerant retrieval on a separated real-music split before any real-radio trial.
