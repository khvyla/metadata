# Real-music detailed matcher calibration

## Pipeline and split

- Fixed retrieval: medium single-frame tokens, two-frame offset buckets, then Top-K recording candidates only. The retrieval implementation was not changed.
- Calibration: odd-numbered indexed recordings plus odd-numbered unknown recordings. Holdout: even-numbered indexed recordings plus even-numbered unknown recordings.
- Rules were selected lexicographically on calibration outcomes: minimum false accepts, maximum precision, then recall. Holdout outcomes were not used for selection.

## Selected conservative rule

- recall-b: average similarity ≥ 0.92; strong-frame proportion ≥ 0.6; longest run ≥ 24; aligned frames ≥ 40; dominant retrieval votes ≥ 2; runner-up margin ≥ 0.03.
- Calibration: known correct/wrong/rejected 36/0/19; unknown rejected/false accepted 4/0; precision 100.0%, recall 65.5%.

## End-to-end holdout (Top-20 retrieval)

- Known correct/wrong/rejected: 39/0/15; retrieval lost 0/54 known recordings before matching.
- Unknown rejected/falsely accepted: 4/0.
- Precision 100.0%; recall 72.2%; unknown FPR 0.0%; overall rejection rate 32.8%.

## Shortlist size

| Top-K | Known correct | Known wrong | Known rejected | Unknown false accepted | Precision | Recall | FPR |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 39 | 0 | 15 | 0 | 100.0% | 72.2% | 0.0% |
| 10 | 39 | 0 | 15 | 0 | 100.0% | 72.2% | 0.0% |
| 20 | 39 | 0 | 15 | 0 | 100.0% | 72.2% | 0.0% |

## Transformation diagnostics (all queries; descriptive only)

- MP3 64 kbps: known 16/0/4; unknown false accepted 0.
- MP3 128 kbps: known 12/0/8; unknown false accepted 0.
- MP3 320 kbps: known 14/0/6; unknown false accepted 0.
- Opus 96 kbps: known 13/0/7; unknown false accepted 0.
- 10-second MP3 128 kbps: known 4/0/6; unknown false accepted 0.
- 30-second MP3 128 kbps: known 10/0/0; unknown false accepted 0.
- loudnorm: known 1/0/0; unknown false accepted 0.
- double-transcode: known 1/0/0; unknown false accepted 0.
- gain: known 0/0/1; unknown false accepted 0.
- mild-eq: known 1/0/0; unknown false accepted 0.
- mono: known 1/0/0; unknown false accepted 0.
- low-level tone overlay: known 1/0/1; unknown false accepted 0.
- low-level noise overlay: known 1/0/1; unknown false accepted 0.
- unknown MP3 128 kbps: known 0/0/0; unknown false accepted 0.
- Duration groups: 10s known correct/wrong/rejected 4/0/6; 20s 61/0/28; 30s 10/0/0.

## Margin and rejection findings

- Correct accepted known matches: 39; median runner-up margin 0.3590.
- Known rejection reasons: weak-similarity 15.
- Unknown false accepts: 0; accepted wrong known matches: 0.

## Interpretation

- On this limited CC0 holdout, the fixed retrieval plus calibrated confidence gate kept false accepts at zero while achieving 72.2% known recall.
- This is encouraging but not production readiness: the corpus is small, mostly one source catalogue, and no radio stream, station overlay, or diverse commercial-music validation has been performed.
