import { describe, it, expect } from 'vitest';
import { getXDeathCount } from '../../src/core/utils/xDeath';

describe('getXDeathCount', () => {
  it('returns 0 for missing headers', () => {
    expect(getXDeathCount(undefined)).toBe(0);
  });

  it('sums counts for matching queue entries', () => {
    const headers = {
      'x-death': [
        { queue: 'q1', count: 1 },
        { queue: 'q2', count: 2 },
        { queue: 'q1', count: 3 },
      ],
    };

    expect(getXDeathCount(headers, { queue: 'q1' })).toBe(4);
    expect(getXDeathCount(headers, { queue: 'q2' })).toBe(2);
    expect(getXDeathCount(headers, { queue: 'unknown' })).toBe(0);
  });

  it('falls back when not an array and matches exchange', () => {
    const headers = {
      'x-death': { exchange: 'ex', count: 5 },
    };

    expect(getXDeathCount(headers, { exchange: 'ex' })).toBe(5);
    expect(getXDeathCount(headers, { exchange: 'other' })).toBe(0);
  });

  it('considers routing-keys entries', () => {
    const headers = {
      'x-death': [
        { queue: 'q', 'routing-keys': ['a.b'], count: 2 },
        { queue: 'q', 'routing-keys': ['c.d'], count: 3 },
      ],
    };

    expect(getXDeathCount(headers, { routingKey: 'a.b' })).toBe(2);
    expect(getXDeathCount(headers, { routingKey: 'c.d' })).toBe(3);
  });
});
