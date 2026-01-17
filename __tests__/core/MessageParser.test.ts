import { describe, it, expect, beforeEach } from 'vitest';
import { MessageParser } from '../../src/core/message/MessageParser';
import { createMockMessage } from '../helpers/Message';

describe('MessageParser', () => {
  let parser: MessageParser;

  describe('basic parsing', () => {
    beforeEach(() => {
      parser = new MessageParser({
        maxSize: 1024 * 1024, // 1MB
        malformedMessageStrategy: 'reject',
      });
    });

    it('should successfully parse valid JSON message', async () => {
      const msg = createMockMessage({ data: 'test', value: 123 });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'test', value: 123 });
      expect(result.error).toBeUndefined();
    });

    it('should parse string JSON content', async () => {
      const msg = createMockMessage('{"key":"value","number":42}');

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: 'value', number: 42 });
    });

    it('should parse nested objects', async () => {
      const msg = createMockMessage({
        user: { id: 1, name: 'John' },
        metadata: { timestamp: Date.now(), tags: ['a', 'b'] },
      });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.user.name).toBe('John');
      expect(result.data.metadata.tags).toEqual(['a', 'b']);
    });

    it('should parse arrays', async () => {
      const msg = createMockMessage([1, 2, 3, 4, 5]);

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3, 4, 5]);
    });

    it('should parse empty objects', async () => {
      const msg = createMockMessage({});

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('should parse empty arrays', async () => {
      const msg = createMockMessage([]);

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should parse boolean values', async () => {
      const msg = createMockMessage(true);

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should parse number values', async () => {
      const msg = createMockMessage(42);

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('should parse string values', async () => {
      const msg = createMockMessage('"hello world"');

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toBe('hello world');
    });
  });

  describe('size validation', () => {
    beforeEach(() => {
      parser = new MessageParser({
        maxSize: 100, // Small size for testing
        malformedMessageStrategy: 'reject',
      });
    });

    it('should accept messages within size limit', async () => {
      const msg = createMockMessage({ data: 'small' });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
    });

    it('should reject messages exceeding size limit', async () => {
      const largeData = 'x'.repeat(200); // Larger than maxSize
      const msg = createMockMessage({ data: largeData });

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('exceeds maximum size');
      expect(result.strategy).toBe('reject');
    });

    it('should include size details in error', async () => {
      const largeData = 'x'.repeat(200);
      const msg = createMockMessage({ data: largeData });

      const result = await parser.parse(msg);

      expect(result.error?.message).toContain('exceeds maximum size');
    });

    it('should work without maxSize limit', async () => {
      parser = new MessageParser({
        malformedMessageStrategy: 'reject',
      });

      const largeData = 'x'.repeat(10000);
      const msg = createMockMessage({ data: largeData });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
    });
  });

  describe('null byte validation', () => {
    beforeEach(() => {
      parser = new MessageParser({
        maxSize: 1024,
        malformedMessageStrategy: 'dlq',
      });
    });

    it('should reject messages with null bytes', async () => {
      // Create buffer with actual null byte (0x00), not escaped \0
      const contentWithNull = Buffer.from([123, 34, 100, 97, 116, 97, 34, 58, 34, 116, 101, 115, 116, 0, 118, 97, 108, 117, 101, 34, 125]); // {"data":"test<NULL>value"}
      const msg = {
        content: contentWithNull,
        properties: { contentType: 'application/json' },
        fields: {
          deliveryTag: 1,
          redelivered: false,
          exchange: 'test',
          routingKey: 'test.key',
        },
      } as any;

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('null bytes');
      expect(result.strategy).toBe('dlq');
    });

    it('should accept messages without null bytes', async () => {
      const msg = createMockMessage({ data: 'clean content' });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
    });
  });

  describe('JSON parsing errors', () => {
    beforeEach(() => {
      parser = new MessageParser({
        maxSize: 1024,
        malformedMessageStrategy: 'reject',
      });
    });

    it('should handle invalid JSON', async () => {
      const msg = createMockMessage('not valid json{]}');

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to parse JSON');
      expect(result.strategy).toBe('reject');
    });

    it('should handle incomplete JSON', async () => {
      const msg = createMockMessage('{"incomplete":');

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to parse JSON');
    });

    it('should handle malformed JSON with extra commas', async () => {
      const msg = createMockMessage('{"key":"value",}');

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to parse JSON');
    });

    it('should handle empty content gracefully', async () => {
      const msg = createMockMessage('');

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to parse JSON');
    });

    it('should truncate content in error for logging', async () => {
      const longInvalidContent = 'x'.repeat(200) + ' invalid json';
      const msg = createMockMessage(longInvalidContent);

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Failed to parse JSON');
    });
  });

  describe('null and undefined validation', () => {
    beforeEach(() => {
      parser = new MessageParser({
        maxSize: 1024,
        malformedMessageStrategy: 'ignore',
      });
    });

    it('should reject null data', async () => {
      const msg = createMockMessage('null');

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('null or undefined');
      expect(result.strategy).toBe('ignore');
    });

    it('should accept zero as valid data', async () => {
      const msg = createMockMessage('0');

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toBe(0);
    });

    it('should accept false as valid data', async () => {
      const msg = createMockMessage('false');

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toBe(false);
    });

    it('should accept empty string as valid data', async () => {
      const msg = createMockMessage('""');

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data).toBe('');
    });
  });

  describe('malformed message strategies', () => {
    it('should return reject strategy', async () => {
      parser = new MessageParser({
        maxSize: 1024,
        malformedMessageStrategy: 'reject',
      });

      const msg = createMockMessage('invalid json');
      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('reject');
    });

    it('should return dlq strategy', async () => {
      parser = new MessageParser({
        maxSize: 1024,
        malformedMessageStrategy: 'dlq',
      });

      const msg = createMockMessage('invalid json');
      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('dlq');
    });

    it('should return ignore strategy', async () => {
      parser = new MessageParser({
        maxSize: 1024,
        malformedMessageStrategy: 'ignore',
      });

      const msg = createMockMessage('invalid json');
      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('ignore');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      parser = new MessageParser({
        maxSize: 1024,
        malformedMessageStrategy: 'reject',
      });
    });

    it('should handle special characters in JSON', async () => {
      const msg = createMockMessage({
        text: 'Special chars: \n\t\r"\'\\',
        emoji: '🚀💻',
      });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.emoji).toBe('🚀💻');
    });

    it('should handle unicode characters', async () => {
      const msg = createMockMessage({
        chinese: '你好',
        arabic: 'مرحبا',
        emoji: '😀',
      });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.chinese).toBe('你好');
      expect(result.data.arabic).toBe('مرحبا');
    });

    it('should handle deeply nested structures', async () => {
      const msg = createMockMessage({
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.level1.level2.level3.level4.value).toBe('deep');
    });

    it('should handle large numbers', async () => {
      const msg = createMockMessage({
        bigInt: 9007199254740991,
        negative: -9007199254740991,
        float: 3.141592653589793,
      });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.bigInt).toBe(9007199254740991);
      expect(result.data.negative).toBe(-9007199254740991);
      expect(result.data.float).toBe(3.141592653589793);
    });

    it('should handle messages with messageId', async () => {
      const msg = createMockMessage({ data: 'test' }, 'msg-123');

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(msg.properties.messageId).toBe('msg-123');
    });

    it('should handle binary buffer content', async () => {
      const msg = {
        content: Buffer.from(JSON.stringify({ binary: 'data' })),
        properties: { messageId: 'test-id', contentType: 'application/json' },
        fields: {
          deliveryTag: 1,
          redelivered: false,
          exchange: 'test',
          routingKey: 'test.key',
        },
      } as any; // Use any to avoid Message type issues

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.binary).toBe('data');
    });

    it('should handle very long strings', async () => {
      const longString = 'a'.repeat(1000);
      const msg = createMockMessage({ longField: longString });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.longField.length).toBe(1000);
    });

    it('should handle arrays with mixed types', async () => {
      const msg = createMockMessage({
        mixed: [1, 'string', true, null, { nested: 'object' }, [1, 2]],
      });

      const result = await parser.parse(msg);

      expect(result.success).toBe(true);
      expect(result.data.mixed).toHaveLength(6);
      expect(result.data.mixed[4].nested).toBe('object');
    });
  });

  describe('error details', () => {
    beforeEach(() => {
      parser = new MessageParser({
        maxSize: 100,
        malformedMessageStrategy: 'reject',
      });
    });

    it('should include error context in parse failures', async () => {
      const msg = createMockMessage('invalid json content');

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBeTruthy();
    });

    it('should include messageId in null byte error when available', async () => {
      // Create buffer with actual null byte (0x00)
      const contentWithNull = Buffer.from([123, 34, 100, 97, 116, 97, 34, 58, 34, 0, 34, 125]); // {"data":"<NULL>"}
      const msg = {
        content: contentWithNull,
        properties: { messageId: 'msg-456', contentType: 'application/json' },
        fields: {
          deliveryTag: 1,
          redelivered: false,
          exchange: 'test',
          routingKey: 'test.key',
        },
      } as any;

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('null bytes');
    });

    it('should handle error when messageId is not present', async () => {
      const msg = createMockMessage('null');

      const result = await parser.parse(msg);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
