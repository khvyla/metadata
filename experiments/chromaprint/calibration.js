function frameSimilarity(left, right) { return (32 - popcount((left ^ right) >>> 0)) / 32; }
function popcount(value) { let count = 0; while (value) { value &= value - 1; count += 1; } return count; }

function matcherMetrics(left, right, maxShiftFrames = 180) {
  const minimumFrames = Math.max(16, Math.ceil(Math.min(left.length, right.length) * 0.6));
  let best = { averageBitSimilarity: 0, comparedFrames: 0, strongFrameProportion: 0, longestStrongRun: 0, offsetFrames: 0 };
  for (let shift = -maxShiftFrames; shift <= maxShiftFrames; shift += 1) {
    const leftStart = Math.max(0, -shift); const rightStart = Math.max(0, shift); const length = Math.min(left.length - leftStart, right.length - rightStart);
    if (length < minimumFrames) continue;
    let total = 0; let strong = 0; let run = 0; let longest = 0;
    for (let index = 0; index < length; index += 1) {
      const similarity = frameSimilarity(left[leftStart + index], right[rightStart + index]); total += similarity;
      if (similarity >= 0.9) { strong += 1; run += 1; longest = Math.max(longest, run); } else run = 0;
    }
    const candidate = { averageBitSimilarity: total / length, comparedFrames: length, strongFrameProportion: strong / length, longestStrongRun: longest, offsetFrames: shift };
    if (candidate.averageBitSimilarity > best.averageBitSimilarity || candidate.averageBitSimilarity === best.averageBitSimilarity && candidate.longestStrongRun > best.longestStrongRun) best = candidate;
  }
  return best;
}

function applyRule(metrics, rule) { return metrics.averageBitSimilarity >= rule.minimumAverage && metrics.strongFrameProportion >= rule.minimumStrongProportion && metrics.longestStrongRun >= rule.minimumRun && metrics.comparedFrames >= rule.minimumFrames; }
function evaluate(pairs, rule) { const counts = { tp: 0, tn: 0, fp: 0, fn: 0 }; for (const pair of pairs) { const observed = applyRule(pair.metrics, rule); if (pair.expectedMatch && observed) counts.tp += 1; else if (pair.expectedMatch) counts.fn += 1; else if (observed) counts.fp += 1; else counts.tn += 1; } return counts; }
function distribution(values) { const sorted = [...values].sort((a, b) => a - b); return { min: sorted[0] ?? 0, median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0, max: sorted.at(-1) ?? 0 }; }
function rates({ tp, tn, fp, fn }) { return { precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, specificity: tn + fp ? tn / (tn + fp) : 0, falsePositiveRate: tn + fp ? fp / (tn + fp) : 0 }; }
module.exports = { applyRule, distribution, evaluate, matcherMetrics, rates };
