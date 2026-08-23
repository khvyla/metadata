# Chromaprint candidate retrieval experiment

## Scope

- Core index: 120 time-indexed 20-second segments from 30 deterministic generated recordings.
- Queries: 105 transformed/non-identical windows (overlapping MP3, Opus, 10-second, and 30-second samples).
- Retrieval is intentionally cheap and recall-oriented; the existing experimental detailed matcher is only applied after the Top-20 handoff.

## Measured retrieval quality

| Approach | Recall@1 | @5 | @10 | @20 | @50 | Missing | Avg / median candidates (recordings) | Median query ms | Build ms | Approx. index memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sampled-frame-buckets | 88.6% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 1.3 / 1 | 0.005 | 0.992 | 3.0 KiB |
| quantized-frame-shingles | 94.3% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 1.3 / 1 | 0.005 | 0.452 | 5.7 KiB |

## Duration and handoff findings

- Best approach: **quantized-frame-shingles**. Its Recall@20/50 is 100.0%/100.0%; correct recording missing rate is 0.0%.
- 10s: Recall@20 100.0%; 20s overlapping MP3: 100.0%; 20s Opus: 100.0%; 30s: 100.0%.
- Top-20 → existing detailed matcher handoff on 30 transformed 20-second MP3 queries: 29/30 correct; 0 correct recordings were absent from the retrieval shortlist.
- Collision profile: 85 unique tokens, 302 postings, median token frequency 4, maximum 12. Highly common tokens are noisy and should be down-weighted or ignored in a future index.

## Measured scale behavior (synthetic distractor timing only)

The scale indexes retain the generated ground-truth segments and add deterministically salted token-level distractors. These measurements are valid for build/memory/query-cost direction only; they do not manufacture accuracy claims.

| Segments | Build ms | Median query ms | Avg / median candidates | Approx. index memory |
| ---: | ---: | ---: | ---: | ---: |
| 1 000 | 1.2 | 0.004 | 1.3 / 1 | 0.02 MiB |
| 10 000 | 10.1 | 0.004 | 1.3 / 1 | 0.25 MiB |
| 100 000 | 81.3 | 0.005 | 1.3 / 1 | 2.47 MiB |

## Interpretation

- At 100k measured token-level segments, the cheap index kept median query time at 0.005 ms with 1 median candidate recordings. A 1M-segment estimate is roughly 24.7 MiB index storage and 0.8 s single-process build time, assuming linear growth; query latency requires a real 1M measurement before any commitment.
- The evidence supports continuing with segmented, time-indexed fingerprints and a cheap inverted-token candidate stage ahead of detailed temporal matching. It does not establish production readiness: real music, radio transcoding, station overlays, and a much more diverse corpus remain unproven.
