import { describe, it, expect, beforeEach } from 'vitest';
import { MockRpcClient } from '../mocks/MockRpcClient';
import { MockPublisher } from '../mocks/MockPublisher';

/**
 * Integration test for correlationId tracing across RPC and PubSub
 * Simulates a real-world scenario where an API gateway receives a request
 * and needs to track it through RPC calls and event publishing
 */
describe('CorrelationId Tracing Integration', () => {
  let rpcClient: MockRpcClient;
  let publisher: MockPublisher;

  beforeEach(() => {
    rpcClient = new MockRpcClient();
    publisher = new MockPublisher();
  });

  it('should propagate correlationId through complete flow', async () => {
    // Simulate API Gateway receiving HTTP request with trace ID
    const traceId = 'trace-abc-123-xyz';

    // Mock RPC response
    rpcClient.mockResponse('CREATE_USER', { userId: 456, name: 'John Doe' });

    // Step 1: API Gateway calls RPC with trace ID
    const userResult = await rpcClient.send(
      'CREATE_USER',
      { name: 'John Doe', email: 'john@example.com' },
      {
        correlationId: traceId,
        metadata: { source: 'api-gateway', requestId: 'req-789' },
      }
    );

    // Verify RPC call tracked the correlationId
    const rpcCalls = rpcClient.getCallHistory();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].options?.correlationId).toBe(traceId);

    // Step 2: After RPC success, publish event with same trace ID
    await publisher.publish(
      'user.created',
      {
        userId: userResult.userId,
        name: userResult.name,
      },
      {
        correlationId: traceId,
        metadata: { source: 'user-service', triggeredBy: 'CREATE_USER' },
      }
    );

    // Verify event publishing tracked the same correlationId
    const events = publisher.getPublishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].options?.correlationId).toBe(traceId);

    // Verify end-to-end tracing is possible
    expect(rpcCalls[0].options?.correlationId).toBe(events[0].options?.correlationId);
  });

  it('should handle multiple operations with same correlationId', async () => {
    const traceId = 'trace-multi-op-456';

    // Mock multiple RPC responses
    rpcClient.mockResponse('VALIDATE_USER', { valid: true });
    rpcClient.mockResponse('CREATE_ORDER', { orderId: 999, total: 150.0 });

    // Simulate complex operation: validate then create
    await rpcClient.send('VALIDATE_USER', { userId: 123 }, { correlationId: traceId });

    await rpcClient.send(
      'CREATE_ORDER',
      { userId: 123, items: [{ id: 1, qty: 2 }] },
      { correlationId: traceId }
    );

    // Publish events for both operations
    await publisher.publish('user.validated', { userId: 123 }, { correlationId: traceId });

    await publisher.publish(
      'order.created',
      { orderId: 999, userId: 123 },
      { correlationId: traceId }
    );

    // Verify all operations share the same correlationId
    const rpcCalls = rpcClient.getCallHistory();
    const events = publisher.getPublishedEvents();

    expect(rpcCalls.every((call) => call.options?.correlationId === traceId)).toBe(true);
    expect(events.every((event) => event.options?.correlationId === traceId)).toBe(true);
  });

  it('should support different correlationIds for concurrent requests', async () => {
    const traceId1 = 'trace-request-1';
    const traceId2 = 'trace-request-2';

    rpcClient.mockResponse('GET_USER', { userId: 1, name: 'Alice' });

    // Simulate two concurrent API requests with different trace IDs
    await rpcClient.send('GET_USER', { id: 1 }, { correlationId: traceId1 });

    await rpcClient.send('GET_USER', { id: 2 }, { correlationId: traceId2 });

    await publisher.publish('user.fetched', { userId: 1 }, { correlationId: traceId1 });

    await publisher.publish('user.fetched', { userId: 2 }, { correlationId: traceId2 });

    // Verify each request has its own correlationId
    const rpcCalls = rpcClient.getCallHistory();
    const events = publisher.getPublishedEvents();

    expect(rpcCalls[0].options?.correlationId).toBe(traceId1);
    expect(rpcCalls[1].options?.correlationId).toBe(traceId2);
    expect(events[0].options?.correlationId).toBe(traceId1);
    expect(events[1].options?.correlationId).toBe(traceId2);
  });

  it('should combine correlationId with metadata for rich tracing', async () => {
    const traceId = 'trace-rich-metadata-789';

    rpcClient.mockResponse('PROCESS_PAYMENT', { transactionId: 'txn-001', status: 'success' });

    // RPC call with correlationId and rich metadata
    await rpcClient.send(
      'PROCESS_PAYMENT',
      { amount: 99.99, currency: 'USD' },
      {
        correlationId: traceId,
        metadata: {
          userId: '123',
          sessionId: 'sess-456',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      }
    );

    // Event publishing with same correlationId and additional context
    await publisher.publish(
      'payment.processed',
      { transactionId: 'txn-001', amount: 99.99 },
      {
        correlationId: traceId,
        metadata: {
          processingTime: 1234,
          gateway: 'stripe',
          result: 'success',
        },
      }
    );

    // Verify both have the same correlationId but different metadata
    const rpcCalls = rpcClient.getCallHistory();
    const events = publisher.getPublishedEvents();

    expect(rpcCalls[0].options?.correlationId).toBe(traceId);
    expect(events[0].options?.correlationId).toBe(traceId);

    // Metadata is independent but correlationId links them
    expect(rpcCalls[0].options?.metadata?.userId).toBe('123');
    expect(events[0].options?.metadata?.gateway).toBe('stripe');
  });

  it('should work without correlationId (backward compatibility)', async () => {
    rpcClient.mockResponse('TEST_COMMAND', { result: 'ok' });

    // Call without correlationId - should still work
    await rpcClient.send('TEST_COMMAND', { data: 'test' });

    await publisher.publish('test.event', { data: 'test' });

    const rpcCalls = rpcClient.getCallHistory();
    const events = publisher.getPublishedEvents();

    // No correlationId specified, should be undefined
    expect(rpcCalls[0].options?.correlationId).toBeUndefined();
    expect(events[0].options?.correlationId).toBeUndefined();
  });
});
