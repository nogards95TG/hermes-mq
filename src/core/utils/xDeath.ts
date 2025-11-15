/**
 * Helper to extract retry count from RabbitMQ x-death header
 * x-death is an array of objects with a `count` field. We optionally filter
 * entries by queue/exchange/routingKey before summing counts.
 *
 * @param headers - message properties.headers
 * @param opts - optional filters: queue, exchange, routingKey
 */
export function getXDeathCount(
  headers: Record<string, any> | undefined,
  opts?: { queue?: string; exchange?: string; routingKey?: string }
): number {
  if (!headers) return 0;

  const xDeath = headers['x-death'] || headers['xDeath'] || headers['x_death'];
  if (!xDeath) return 0;

  const entries = Array.isArray(xDeath) ? xDeath : [xDeath];

  const matched = entries.filter((entry: any) => {
    if (!entry || typeof entry !== 'object') return false;

    if (opts?.queue && entry.queue && entry.queue !== opts.queue) return false;
    if (opts?.exchange && entry.exchange && entry.exchange !== opts.exchange) return false;

    // routing-keys might be an array or single value
    if (opts?.routingKey && entry['routing-keys']) {
      const rks = Array.isArray(entry['routing-keys']) ? entry['routing-keys'] : [entry['routing-keys']];
      if (!rks.includes(opts.routingKey)) return false;
    }

    return true;
  });

  return matched.reduce((acc: number, e: any) => acc + (Number(e.count) || 0), 0);
}
