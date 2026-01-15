# Hermes MQ - Roadmap & Future Enhancements

This document tracks potential future enhancements for Hermes MQ. These are **not critical issues** but nice-to-have features for specific use cases.

## Status Legend

- 🟢 **Low Priority** - Implement only if specifically needed
- 🟡 **Medium Priority** - Useful for production setups with specific requirements
- 🔴 **High Priority** - Important for most production use cases

---

## Planned Enhancements

### 🟡 1. Quorum Queues Support

**Priority**: Medium
**RabbitMQ Version**: 3.8+
**Use Case**: High availability and data safety in clustered environments

**Description**:
Quorum queues are RabbitMQ's modern replicated queue type, offering better data safety and availability compared to classic durable queues.

**Benefits**:

- Automatic replication across cluster nodes
- Better consistency guarantees (Raft consensus)
- Poison message handling
- Lower memory footprint for large queues

**Implementation**:

```typescript
// Add to QueueAssertionOptions interface
export interface QueueAssertionOptions {
  // ... existing options
  queueType?: 'classic' | 'quorum' | 'stream';
}

// Example usage
const manager = ConnectionManager.getInstance({
  url: 'amqp://localhost',
});

await manager.assertQueue('critical-queue', {
  durable: true,
  queueType: 'quorum', // Enable quorum queue
});
```

**Files to modify**:

- `src/core/connection/ConnectionManager.ts` - Add `queueType` to interface and conversion logic
- `src/core/types/Messages.ts` - Update type definitions
- `README.md` - Document new feature with examples

**Related Documentation**: https://www.rabbitmq.com/quorum-queues.html

---

### 🟢 2. Single Active Consumer

**Priority**: Low
**RabbitMQ Version**: 3.8+
**Use Case**: Strict FIFO message ordering

**Description**:
Ensures only one consumer processes messages from a queue at a time, guaranteeing message ordering even with multiple consumer instances.

**Benefits**:

- Strict message ordering
- Automatic failover to standby consumers
- No need for manual consumer coordination

**Implementation**:

```typescript
// Add to QueueAssertionOptions interface
export interface QueueAssertionOptions {
  // ... existing options
  singleActiveConsumer?: boolean;
}

// Example usage
await manager.assertQueue('ordered-events', {
  durable: true,
  singleActiveConsumer: true, // Only one consumer active at a time
});
```

**Use Cases**:

- Order processing systems requiring strict sequencing
- Event sourcing where order matters
- State machine transitions

**Files to modify**:

- `src/core/connection/ConnectionManager.ts`
- `README.md`

**Related Documentation**: https://www.rabbitmq.com/consumers.html#single-active-consumer

---

### 🟢 3. Lazy Queues

**Priority**: Low
**RabbitMQ Version**: 3.6+
**Use Case**: Queues with millions of messages

**Description**:
Lazy queues move messages to disk as early as possible, keeping only a small subset in RAM. Ideal for very long queues.

**Benefits**:

- Lower memory consumption
- Better handling of message spikes
- Predictable performance with large backlogs

**Trade-offs**:

- Slightly higher latency
- More disk I/O

**Implementation**:

```typescript
// Add to QueueAssertionOptions interface
export interface QueueAssertionOptions {
  // ... existing options
  lazyQueue?: boolean;
}

// Example usage
await manager.assertQueue('analytics-events', {
  durable: true,
  lazyQueue: true, // Keep messages on disk
  maxLength: 10000000, // 10M messages
});
```

**Use Cases**:

- Analytics event queues with high ingestion rates
- Batch processing systems
- Queues that buffer data for offline processing

**Files to modify**:

- `src/core/connection/ConnectionManager.ts`
- `README.md`

**Related Documentation**: https://www.rabbitmq.com/lazy-queues.html

---

### 🟢 4. Alternate Exchange

**Priority**: Low
**RabbitMQ Version**: 3.0+
**Use Case**: Declarative handling of unroutable messages

**Description**:
An alternate exchange receives messages that cannot be routed to any queue, providing a declarative alternative to the `mandatory` flag.

**Benefits**:

- Declarative configuration (set once at queue creation)
- No need for per-message `mandatory` flag
- Can route to DLQ, logging queue, or alert queue

**Implementation**:

```typescript
// Add to queue/exchange options
export interface QueueAssertionOptions {
  // ... existing options
  alternateExchange?: string;
}

// Example usage
await manager.assertExchange('orders', 'topic', {
  durable: true,
  alternateExchange: 'unroutable-orders', // Where to send unroutable messages
});

// Create the alternate exchange and queue
await manager.assertExchange('unroutable-orders', 'fanout', { durable: true });
await manager.assertQueue('unroutable-orders-queue', { durable: true });
await manager.bindQueue('unroutable-orders-queue', 'unroutable-orders', '');
```

**Use Cases**:

- Monitoring and alerting on routing failures
- Debugging message routing issues
- Compliance/audit logging of all messages

**Files to modify**:

- `src/core/connection/ConnectionManager.ts`
- `src/client/pubsub/Publisher.ts` - Add to exchange assertion options
- `README.md`

**Related Documentation**: https://www.rabbitmq.com/ae.html

---

### 🟢 5. Consumer Priority

**Priority**: Very Low
**RabbitMQ Version**: 3.2+
**Use Case**: Preferred and fallback consumers

**Description**:
Assign priority to consumers on the same queue. Higher priority consumers receive messages first.

**Benefits**:

- Better resource utilization
- Preferred consumers on powerful nodes
- Fallback consumers on secondary nodes

**Implementation**:

```typescript
// Add to RpcServerConfig and SubscriberConfig
export interface RpcServerConfig {
  // ... existing options
  consumerPriority?: number; // 0-255, higher = more priority
}

// Example usage
const primaryServer = new RpcServer({
  connection: { url: 'amqp://localhost' },
  queueName: 'tasks',
  consumerPriority: 10, // High priority
});

const fallbackServer = new RpcServer({
  connection: { url: 'amqp://localhost' },
  queueName: 'tasks',
  consumerPriority: 1, // Low priority (only if primary is busy)
});
```

**Use Cases**:

- Geographic distribution (prefer local consumers)
- Resource-based routing (powerful vs weak nodes)
- Testing in production (route small % to new version)

**Files to modify**:

- `src/server/rpc/RpcServer.ts`
- `src/server/pubsub/Subscriber.ts`
- `README.md`

**Related Documentation**: https://www.rabbitmq.com/consumer-priority.html

---

## Implementation Priority Order

When implementing these features, suggested order:

1. **Quorum Queues** 🟡 - Most valuable for production HA setups
2. **Single Active Consumer** 🟢 - Useful for specific ordering requirements
3. **Alternate Exchange** 🟢 - Nice alternative to mandatory flag
4. **Lazy Queues** 🟢 - Only if you have huge queue backlogs
5. **Consumer Priority** 🟢 - Very niche use case

---

## Testing Requirements

For each feature, ensure:

- [ ] Unit tests with mocked amqplib
- [ ] Integration tests with real RabbitMQ (Testcontainers)
- [ ] Documentation with clear examples
- [ ] README section explaining when/why to use
- [ ] TypeScript types are complete

---

## Related RabbitMQ Best Practices

Consider implementing these if needed:

### Performance Optimizations

- [ ] Channel pooling for Publisher (reuse channels across publishes)
- [ ] Batch acknowledgments (ack multiple messages at once)
- [ ] Message batching (publish multiple messages as one)

### Monitoring & Observability

- [ ] Metrics export (Prometheus format)
- [ ] Health check endpoints
- [ ] Detailed connection/channel event logging

### Advanced Patterns

- [ ] Request/reply with temporary reply queues per client
- [ ] Priority queues (x-max-priority)
- [x] Message scheduling/delayed delivery (TTL+DLX strategy)
- [ ] RabbitMQ delayed message plugin support (for millisecond precision)
- [ ] Consistent hash exchange

**Last Updated**: 2026-01-15
