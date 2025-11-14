import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Subscriber } from '../../src/server/pubsub/Subscriber';
import { ConnectionManager } from '../../src/core';

// Mock ConnectionManager (same as other Subscriber tests)
vi.mock('../../src/core', async () => {
  const actual = await vi.importActual('../../src/core');

  const mockConnection = new EventEmitter();
  (mockConnection as any).createChannel = vi.fn().mockResolvedValue({
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue-123' }),
    bindQueue: vi.fn().mockResolvedValue({}),
    prefetch: vi.fn().mockResolvedValue({}),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
    ack: vi.fn(),
    nack: vi.fn(),
    cancel: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
  });

  return {
    ...actual,
    ConnectionManager: {
      getInstance: vi.fn().mockReturnValue({
        getConnection: vi.fn().mockResolvedValue(mockConnection),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

describe('Subscriber middleware', () => {
  let subscriber: Subscriber;
  let mockConnection: any;
  let mockChannel: any;

  beforeEach(async () => {
    const manager = (ConnectionManager as any).getInstance();
    mockConnection = await manager.getConnection();
    mockChannel = await (mockConnection as any).createChannel();
  });

  afterEach(async () => {
    if (subscriber?.isRunning()) {
      await subscriber.stop();
    }
    vi.clearAllMocks();
  });

  it('should run global middleware and allow it to modify the message before handler', async () => {
    subscriber = new Subscriber({ connection: { url: 'amqp://localhost' }, exchange: 'events' });

    // global middleware that modifies the message
    const globalMw = vi.fn(async (msg: any, ctx: any, next: any) => {
      const modified = { ...msg, addedByMw: true };
      return next(modified);
    });

    subscriber.use(globalMw);

    const handler = vi.fn();
    let consumeCallback: any;

    mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
      consumeCallback = callback;
      return Promise.resolve({ consumerTag: 'test' });
    });

    subscriber.on('user.created', handler);
    await subscriber.start();

    const message = {
      content: Buffer.from(
        JSON.stringify({ eventName: 'user.created', data: { id: 1 }, timestamp: Date.now() })
      ),
      fields: { routingKey: 'user.created' },
      properties: { messageId: 'msg-1', headers: {} },
    };

    await consumeCallback(message);

    expect(globalMw).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ addedByMw: true, id: 1 }),
      expect.objectContaining({ eventName: 'user.created' })
    );
  });

  it('should run per-handler middlewares in order before handler', async () => {
    subscriber = new Subscriber({ connection: { url: 'amqp://localhost' }, exchange: 'events' });

    const order: string[] = [];

    const mw1 = vi.fn(async (msg: any, ctx: any, next: any) => {
      order.push('mw1');
      return next(msg);
    });

    const mw2 = vi.fn(async (msg: any, ctx: any, next: any) => {
      order.push('mw2');
      return next(msg);
    });

    const handler = vi.fn(async (_data: any, _ctx: any) => {
      order.push('handler');
    });

    let consumeCallback: any;
    mockChannel.consume.mockImplementation((_queue: any, callback: any) => {
      consumeCallback = callback;
      return Promise.resolve({ consumerTag: 'test' });
    });

    // Register per-handler middleware (mw1, mw2) then handler
    subscriber.on('user.created', mw1 as any, mw2 as any, handler as any);
    await subscriber.start();

    const message = {
      content: Buffer.from(
        JSON.stringify({ eventName: 'user.created', data: {}, timestamp: Date.now() })
      ),
      fields: { routingKey: 'user.created' },
      properties: { messageId: 'msg-2', headers: {} },
    };

    await consumeCallback(message);

    expect(order).toEqual(['mw1', 'mw2', 'handler']);
  });
});
