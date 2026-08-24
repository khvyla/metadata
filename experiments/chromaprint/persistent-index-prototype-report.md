# Persistent Recognition Index prototype acceptance

- Corpus: 10 indexed and 3 unknown-only recordings from the already documented CC0 independent-corpus fixtures. Audio and the SQLite file are ignored; only this measurement is committed.
- Frozen pipeline: medium-frame tokens, two-frame offset buckets, Top-5 candidates; average ≥0.92, strong-frame proportion ≥0.60, longest run ≥24, aligned frames ≥40, dominant votes ≥2, margin ≥0.03.

## Persistence

- SQLite file size: 73728 bytes.
- Recording count / segment count after reopen: 10 / 20.
- Open/load time: 1.694 ms; in-memory retrieval rebuild: 1.397 ms.

## Recognition

- Known transformed queries matched: 7/10.
- Unknown queries rejected: 3/3.
- Median recognition query time: 2.491 ms.
- Known query record IDs: ic01, ic02, ic03, ic04, ic05, ic06, ic07, ic08, ic09, ic10.
- Unknown result reasons: insufficient-evidence, insufficient-evidence, insufficient-evidence.

## Result

- Persistence acceptance passed: create → ingest → close → reopen → count verification → known recognition → unknown rejection → close.
- This is a local persistence prototype, not a production Recognition Index or real-radio validation.
