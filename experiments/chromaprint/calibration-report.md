# Chromaprint matcher calibration

## Corpus and split

- 30 deterministic synthetic, multi-voice/rhythmic recordings with distinct seeded noise beds; generated audio is ignored.
- 240 expected-match pairs and 630 expected-non-match pairs (870 total).
- Deterministic split: 696 calibration pairs / 174 untouched holdout pairs.

## Score distributions

| Group | Min | Median | Max |
| --- | ---: | ---: | ---: |
| Expected match | 0.985 | 1.000 | 1.000 |
| Expected non-match | 0.587 | 0.781 | 1.000 |

## Most conservative tested rule

Accept only when average bit similarity ≥ 0.99, strong-frame proportion ≥ 0.3, longest strong run ≥ 120 frames, and aligned evidence ≥ 40 frames. It was selected by minimum calibration false positives, then maximum true positives.

## Holdout

| TP | TN | FP | FN | Precision | Recall | Specificity | FPR |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 42 | 120 | 6 | 6 | 87.50% | 87.50% | 95.24% | 4.76% |

## Query simulation

Unknown 20-second MP3 windows queried against 30 candidate 20-second index segments: 11 correct top-1, 1 incorrect top-1, 3 rejected/ambiguous.

## Findings

- Same-recording transcoded and overlapping windows often have sustained aligned evidence, but are not reliably separated from every different synthetic recording by this matcher.
- False positives are raw-frame collisions among structurally similar generated sources; low-level seeded noise does not reliably survive into distinct Chromaprint evidence. This corpus remains insufficiently diverse for production calibration.
- The strict long-run requirement causes false negatives for shorter or weaker evidence, including 10-second windows (about 59 raw frames).
- Non-overlapping portions of the same synthetic recording are intentionally treated as no confident match unless shared fingerprint evidence exists.
- 20 seconds remains the practical initial candidate: it supplies more sustained evidence than 10 seconds while avoiding extra latency of 30 seconds, but it is not yet validated on real music/radio.
- A future index should retain multiple time-indexed 20-second frame sequences per recording, not one complete-recording fingerprint.
- Chromaprint is promising enough to continue R&D, but the observed false-positive rate is unsuitable for airplay use; representative music/radio captures, matcher calibration, and retrieval design remain unproven before production.

## Scale sanity check

| Recordings | 20s segments (3/recording) | Raw-frame storage | Naive frame comparisons/query |
| ---: | ---: | ---: | ---: |
| 1 000 | 3 000 | 1.6 MiB | 58 800 000 |
| 10 000 | 30 000 | 16.0 MiB | 588 000 000 |
| 100 000 | 300 000 | 160.2 MiB | 5 880 000 000 |
| 1 000 000 | 3 000 000 | 1602.2 MiB | 58 800 000 000 |

Naive detailed comparison becomes impractical at large scale; a retrieval/indexing stage is required before production, but is not implemented here.
