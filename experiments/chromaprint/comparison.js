function parseRawFingerprint(output) {
  const line = output.split(/\r?\n/).find((value) => value.startsWith("FINGERPRINT="));
  if (!line) throw new Error("fpcalc raw output did not contain FINGERPRINT.");
  const frames = line.slice("FINGERPRINT=".length).split(",").map(Number);
  if (!frames.length || frames.some((frame) => !Number.isInteger(frame))) throw new Error("fpcalc raw fingerprint was malformed.");
  return frames;
}

function experimentalSimilarity(left, right, maxShiftFrames = 120) {
  let best = { similarity: 0, shiftFrames: 0, comparedFrames: 0 };
  for (let shift = -maxShiftFrames; shift <= maxShiftFrames; shift += 1) {
    const leftStart = Math.max(0, -shift); const rightStart = Math.max(0, shift);
    const length = Math.min(left.length - leftStart, right.length - rightStart);
    if (length < 8) continue;
    let equalBits = 0;
    for (let index = 0; index < length; index += 1) equalBits += 32 - popcount((left[leftStart + index] ^ right[rightStart + index]) >>> 0);
    const similarity = equalBits / (length * 32);
    if (similarity > best.similarity) best = { similarity, shiftFrames: shift, comparedFrames: length };
  }
  return best;
}

function popcount(value) { let count = 0; while (value) { value &= value - 1; count += 1; } return count; }
module.exports = { experimentalSimilarity, parseRawFingerprint };
