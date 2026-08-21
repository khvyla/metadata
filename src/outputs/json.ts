import type { CanonicalMetadata } from "../core/types";
export const toJson = (metadata: CanonicalMetadata) => JSON.stringify(metadata, null, 2);
