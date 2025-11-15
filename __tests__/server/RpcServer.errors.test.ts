import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../src/core', async () => {
  const actual = await vi.importActual('../../src/core');

  const mockConnection = new EventEmitter();
  (mockConnection as any).createConfirmChannel = vi.fn().mockResolvedValue({
    assertQueue: vi.fn().mockResolvedValue({}),
    prefetch: vi.fn().mockResolvedValue({}),
    consume: vi.fn().mockImplementation((_queue, callback) => {
      (mockConnection as any)._consumeCallback = callback;
      return Promise.resolve({ consumerTag: 'test-consumer' });
    }),
    sendToQueue: vi.fn().mockImplementation((_queue, content, options) => {
      (mockConnection as any)._lastReply = { content, options };
      return true;
    }),
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
      }),
    },
  };
});

import { RpcServer } from '../../src/server/rpc/RpcServer';
import { ConnectionManager, TransientError, PermanentError } from '../../src/core';

describe('RpcServer error handling', () => {
  let server: RpcServer;
  let mockConnection: any;

  beforeEach(async () => {
    const manager = (ConnectionManager as any).getInstance();
    mockConnection = await manager.getConnection();
    server = new RpcServer({ connection: { url: 'amqp://localhost' }, queueName: 'err-queue' });
    await server.start();
  });

  afterEach(async () => {
    if (server && server.isServerRunning()) {
      await server.stop();
    }
    vi.clearAllMocks();
  });

  it('should NACK with requeue for TransientError', async () => {
    const handler = vi.fn().mockRejectedValue(new TransientError('Temporary failure'));
    server.registerHandler('TRANSIENT', handler);

    const request = {
      id: 'r1',
      command: 'TRANSIENT',
      timestamp: Date.now(),
      data: {},
    };

    const message = {
      content: Buffer.from(JSON.stringify(request)),
      properties: {
        correlationId: 'cid-1',
        replyTo: 'reply-queue',
      },
    };

    await mockConnection._consumeCallback(message);

    const channel = await mockConnection.createConfirmChannel();
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);

    const reply = JSON.parse(mockConnection._lastReply.content.toString());
    expect(reply.success).toBe(false);
    expect(reply.error.message).toBe('Temporary failure');
  });

  it('should ACK (remove) for PermanentError', async () => {
    const handler = vi.fn().mockRejectedValue(new PermanentError('Bad payload'));
    server.registerHandler('PERM', handler);

    const request = {
      id: 'r2',
      command: 'PERM',
      timestamp: Date.now(),
      data: {},
    };

    const message = {
      content: Buffer.from(JSON.stringify(request)),
      properties: {
        correlationId: 'cid-2',
        replyTo: 'reply-queue',
      },
    };

    await mockConnection._consumeCallback(message);

    const channel = await mockConnection.createConfirmChannel();
    expect(channel.ack).toHaveBeenCalledWith(message);

    const reply = JSON.parse(mockConnection._lastReply.content.toString());
    expect(reply.success).toBe(false);
    expect(reply.error.message).toBe('Bad payload');
  });
});
