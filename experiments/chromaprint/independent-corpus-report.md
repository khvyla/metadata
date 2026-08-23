# Independent corpus validation

## Frozen configuration

- This corpus was not used for retrieval or matcher calibration. The configuration was fixed before source audio was downloaded: medium-frame tokens, two-frame offset buckets, Top-5 retrieval shortlist, and the specified matcher thresholds.
- Matcher: average similarity ≥ 0.92; strong-frame proportion ≥ 0.6; longest strong run ≥ 24; aligned frames ≥ 40; dominant retrieval votes ≥ 2; runner-up margin ≥ 0.03.
- Corpus: 20 indexed and 8 unknown-only CC0 recordings, across three independent OpenGameArt submissions by different creators. Downloaded audio is ignored; this repository contains only provenance, code, and results.

## Retrieval and final decisions

- Retrieval Recall@1/5: 100.0% / 100.0%; correct-recording missing rate from Top-5: 0.0%.
- Known queries: correct/wrong/rejected 90/0/37 of 127.
- Unknown queries: rejected/falsely accepted 8/0 of 8.
- Precision 100.0%; recall 70.9%; unknown false-positive rate 0.0%; rejection rate 33.3%.

## Transformation diagnostics (descriptive; no retuning)

| Transformation | Queries | Correct | Wrong | Rejected | Retrieval Recall@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| double-transcode | 1 | 0 | 0 | 1 | 100.0% |
| duration-10 | 20 | 10 | 0 | 10 | 100.0% |
| duration-30 | 20 | 20 | 0 | 0 | 100.0% |
| gain | 1 | 1 | 0 | 0 | 100.0% |
| loudnorm | 1 | 1 | 0 | 0 | 100.0% |
| mild-eq | 1 | 0 | 0 | 1 | 100.0% |
| mono | 1 | 1 | 0 | 0 | 100.0% |
| mp3-128 | 20 | 16 | 0 | 4 | 100.0% |
| mp3-320 | 20 | 16 | 0 | 4 | 100.0% |
| mp3-64 | 20 | 12 | 0 | 8 | 100.0% |
| noise-overlay | 1 | 0 | 0 | 1 | 100.0% |
| opus-96 | 20 | 13 | 0 | 7 | 100.0% |
| tone-overlay | 1 | 0 | 0 | 1 | 100.0% |

## Evidence distributions

- Known correct matches (90): {"count":90,"bestSimilarity":{"min":0.935937,"median":0.949375,"max":0.975893},"margin":{"min":0.052436,"median":0.350349,"max":0.972321},"dominantVotes":{"min":26,"median":114.5,"max":239},"evidenceSpan":{"min":49,"median":138,"max":220}}.
- Unknown queries (8): {"count":8,"bestSimilarity":{"min":0.549063,"median":0.576046,"max":0.606534},"margin":{"min":0.002691,"median":0.029606,"max":0.574483},"dominantVotes":{"min":1,"median":1,"max":2},"evidenceSpan":{"min":0,"median":0,"max":4}}.
- Similarity alone is not treated as recognition: acceptance also requires sustained aligned frames, retrieval votes, and a runner-up margin.

## Failure diagnosis

- insufficient-evidence: 27.
- short-sample-or-insufficient-evidence: 10.
- No unknown query was accepted.

## Cross-corpus comparison

| Corpus | Precision | Recall | Unknown FPR | Known correct/wrong/rejected |
| --- | ---: | ---: | ---: | --- |
| Previous Ondrosik holdout | 100.0% | 72.2% | 0.0% | 39 / 0 / 15 |
| Independent CC0 corpus | 100.0% | 70.9% | 0.0% | 90 / 0 / 37 |

## Interpretation

- The frozen pipeline is a strong continuation signal on this small independent corpus.
- This remains R&D evidence only. Larger source diversity, real-radio stream captures, station overlays, and operational retrieval scaling remain unproven before any production Recognition Index or radio validation.
