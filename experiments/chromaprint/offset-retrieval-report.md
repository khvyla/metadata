# Offset-tolerant real-music retrieval experiment

## Preserved baseline

| Method | Recall@20 | Missing rate |
| --- | ---: | ---: |
| Prior exact-shingle baseline | 17.4% | 82.6% |
| Best offset-aware holdout (medium-frame, 2-frame bucket) | 100.0% | 0.0% |

## Design and split

- Position-aware tokens vote for `recordingId + quantized(indexedFrame - queryFrame)`; ranking rewards the dominant offset cluster, distinct query positions, and evidence span.
- Deterministic split by recording ID: odd-numbered indexed recordings calibration; even-numbered indexed recordings holdout. Queries remain non-identical transformed windows.

## Calibration versus holdout approaches

| Token kind | Bucket frames | Calibration R@20 | Holdout R@1 | @5 | @10 | @20 | @50 | Holdout missing | Median ms | Tokens / postings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coarse-frame | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.158 | 1723 / 5600 |
| coarse-frame | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.158 | 1723 / 5600 |
| coarse-frame | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.132 | 1723 / 5600 |
| medium-frame | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.087 | 3521 / 5600 |
| medium-frame | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.069 | 3521 / 5600 |
| medium-frame | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.071 | 3521 / 5600 |
| coarse-pair | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.116 | 2917 / 5560 |
| coarse-pair | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.103 | 2917 / 5560 |
| coarse-pair | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.104 | 2917 / 5560 |

## Transformation diagnostics (all known queries; not used to select the approach)

- MP3 64 kbps: Recall@20 100.0%; missing 0.0% (7.5 average candidates).
- MP3 128 kbps: Recall@20 100.0%; missing 0.0% (7.4 average candidates).
- MP3 320 kbps: Recall@20 100.0%; missing 0.0% (7.5 average candidates).
- Opus 96 kbps: Recall@20 100.0%; missing 0.0% (7.3 average candidates).
- 10-second MP3 128 kbps: Recall@20 100.0%; missing 0.0% (3.2 average candidates).
- 30-second MP3 128 kbps: Recall@20 100.0%; missing 0.0% (9.3 average candidates).
- loudnorm: Recall@20 100.0%; missing 0.0% (3.0 average candidates).
- double-transcode: Recall@20 100.0%; missing 0.0% (11.0 average candidates).
- gain: Recall@20 100.0%; missing 0.0% (6.0 average candidates).
- mild-eq: Recall@20 100.0%; missing 0.0% (8.0 average candidates).
- mono: Recall@20 100.0%; missing 0.0% (4.0 average candidates).
- low-level tone overlay: Recall@20 100.0%; missing 0.0% (6.0 average candidates).
- low-level noise overlay: Recall@20 100.0%; missing 0.0% (10.5 average candidates).
- Duration groups: 10s 100.0%; 20s 100.0%; 30s 100.0%.

## Offset and unknown-query evidence

- Correct holdout candidates: median dominant-offset consistency 0.558 across 54 retrieved matches; dominant clusters come from sustained matching query positions rather than shared tokens anywhere.
- Unknown-only queries: 8; median 8 candidate recordings, dominant-cluster votes 5.0, consistency 0.250. They can retrieve candidates but their vote patterns are retained only as future confidence-gate signals, not recognition decisions.
- The strongest unknown cluster reached consistency 0.833 but only 5 dominant votes over span 3; offset consistency alone is therefore not a recognition gate.

## Retrieval miss sample

- No holdout retrieval misses.

## Conclusion

- Temporal offset voting materially improves the real-music shortlist over the preserved 17.4% baseline on the separated holdout.
- The detailed matcher was intentionally not recalibrated. The next bottleneck, if retrieval becomes high-recall, remains validation/calibration of that matcher on a separately held-out real-music corpus before real-radio testing.
