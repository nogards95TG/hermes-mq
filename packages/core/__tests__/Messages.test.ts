import { describe, it, expect } from 'vitest';
import { JsonSerializer } from '../src/types/Messages';

describe('Messages', () => {
  describe('JsonSerializer', () => {
    it('should encode object to buffer', () => {
      const serializer = new JsonSerializer();
      const data = { foo: 'bar', num: 42 };

      const buffer = serializer.encode(data);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString()).toBe('{"foo":"bar","num":42}');
    });

    it('should decode buffer to object', () => {
      const serializer = new JsonSerializer();
      const buffer = Buffer.from('{"foo":"bar","num":42}');

      const data = serializer.decode(buffer);

      expect(data).toEqual({ foo: 'bar', num: 42 });
    });

    it('should handle round-trip encoding and decoding', () => {
      const serializer = new JsonSerializer();
      const original = { message: 'test', timestamp: Date.now(), nested: { a: 1 } };

      const buffer = serializer.encode(original);
      const decoded = serializer.decode(buffer);

      expect(decoded).toEqual(original);
    });

    it('should handle arrays', () => {
      const serializer = new JsonSerializer();
      const data = [1, 2, 3, 'test'];

      const buffer = serializer.encode(data);
      const decoded = serializer.decode(buffer);

      expect(decoded).toEqual(data);
    });

    it('should handle null and undefined', () => {
      const serializer = new JsonSerializer();

      expect(serializer.decode(serializer.encode(null))).toBe(null);
      expect(serializer.decode(serializer.encode({ value: undefined }))).toEqual({});
    });
  });
});
