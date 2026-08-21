import type { CanonicalMetadata } from "../core/types";
export const toIcy = (metadata: CanonicalMetadata) => {
  const value = [metadata.track?.artist, metadata.track?.title].filter(Boolean).join(" - ") || metadata.track?.title || "";
  return `StreamTitle='${value.replace(/'/g, "\\'")}';`;
};
