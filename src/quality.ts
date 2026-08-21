import type { CanonicalMetadata } from "./core/types";

export type AirplayIneligibilityReason =
  | "missing-artist"
  | "missing-title"
  | "unknown-value"
  | "encoding-corruption"
  | "station-identifier"
  | "service-message";

export type AirplayEligibility = { eligible: boolean; reasons: AirplayIneligibilityReason[] };

const unknownValues = new Set(["unknown", "unknown artist", "unknown title"]);

/** Evaluates airplay suitability without modifying the original canonical metadata. */
export function assessAirplayEligibility(metadata: Pick<CanonicalMetadata, "track">): AirplayEligibility {
  const artist = metadata.track?.artist?.trim() ?? "";
  const title = metadata.track?.title?.trim() ?? "";
  const values = [artist, title];
  const combined = values.join(" ");
  const reasons: AirplayIneligibilityReason[] = [];

  if (!artist) reasons.push("missing-artist");
  if (!title) reasons.push("missing-title");
  if (values.some((value) => unknownValues.has(value.toLowerCase()))) reasons.push("unknown-value");
  if (/\uFFFD{2,}|(?:Ã.|Ð.|Ñ.){2,}/u.test(combined)) reasons.push("encoding-corruption");
  if (artist && /^(on[ -]?air|live)$/i.test(title)) reasons.push("station-identifier");
  if (/\b(?:paypal|donat(?:e|ion)|support us)\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|https?:\/\//i.test(combined)) reasons.push("service-message");

  return { eligible: reasons.length === 0, reasons };
}
