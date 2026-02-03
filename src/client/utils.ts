import { RESERVED_HEADER_PREFIXES } from '../core';

/** Headers reserved for internal use - filter from user metadata */
export const filterReservedHeaders = (
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!metadata) return undefined;

  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    const isReserved = RESERVED_HEADER_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
    if (!isReserved) {
      filtered[key] = value;
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
};
