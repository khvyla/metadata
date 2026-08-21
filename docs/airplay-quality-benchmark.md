# Airplay quality re-analysis

This experiment applies `assessAirplayEligibility()` to the 22 resolved observations in the PR #6 field benchmark. It does not change the original resolution results.

## Summary

| Metric | Count |
| --- | ---: |
| Resolved observations assessed | 22 |
| Eligible | 14 |
| Ineligible | 8 |

## Rejection reasons

| Reason | Count |
| --- | ---: |
| missing-artist | 5 |
| unknown-value | 1 |
| encoding-corruption | 1 |
| station-identifier | 1 |
| service-message | 1 |

## Ineligible observations

| Stream URL | Artist | Title | Reasons |
| --- | --- | --- | --- |
| https://live2.radioec.com.ua/kiev128s.mp3 |  | КОСИВ БАТЬКО КОСИВ Я | missing-artist |
| https://icecast.armyfm.com.ua:8443/ArmyFM_320 | LAZUTKIN, SEVASTYANOV, ARTERIA | ��� ����� | encoding-corruption |
| http://stream4.nadaje.com:9888/lux | &#1055;&#1110;&#1076;&#1090;&#1088;&#1080;&#1084;&#1072;&#1081; &#1088;&#1072;&#1076;&#1110;&#1086; "&#1052;&#1080; &#1079; &#1059;&#1082;&#1088;&#1072;&#1111;&#1085;&#1080;" 4 | PayPal myzukrainy@gmail.com | service-message |
| https://cast108372.customer.uar.net/live320 |  | VilneRADIO.com.ua | missing-artist |
| https://live.radiom.ua/stream_mp3 |  | Dj Online | missing-artist |
| https://cdn.vsnw.net:8943/kyiv_fm_128k | Kyiv 98FM | OnAir | station-identifier |
| https://stream.zeno.fm/01aa53zvgchvv |  | Fm Галичина | missing-artist |
| https://icecast.luxnet.ua/luxlviv |  | Unknown | missing-artist, unknown-value |

The 8 ineligible resolved streams are additional candidates for future audio-recognition recovery or verification. This assessment is deterministic and does not repair or rewrite source metadata.
