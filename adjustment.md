Executive Summary
This PRD outlines critical improvements needed to make Hermes MQ production-ready by addressing message reliability, error handling, and RabbitMQ best practices. The implementation focuses on preventing message loss, ensuring proper resource management, and providing configurable failure recovery strategies.
Goals & Objectives
Primary Goals

Zero Message Loss: Ensure messages are never lost during processing failures or network issues
Production Safety: Implement proper ACK/NACK strategies and Dead Letter Queue handling
Resource Management: Prevent memory leaks and ensure proper cleanup
Error Resilience: Handle poison messages and prevent cascading failures

Success Metrics

100% message delivery guarantee (at-least-once semantics)
Zero memory leaks after 24h continuous operation
<1ms overhead for duplicate detection
Graceful handling of 100% malformed messages without crashes

Technical Specification

1. Message Acknowledgment Strategy
   Current State

No explicit ACK/NACK handling
Messages may remain unacknowledged on failures
No configurable retry strategy

Proposed Implementation
typescriptinterface AckStrategy {
mode: 'auto' | 'manual';
requeue: boolean | ((error: Error, attempts: number) => boolean);
maxRetries?: number;
retryDelay?: number | ((attempt: number) => number);
}

interface RpcServerOptions {
// ... existing options
ackStrategy?: AckStrategy;
}

class RpcServer {
private async handleMessage(msg: Message, handler: Handler): Promise<void> {
const context: MessageContext = this.createContext(msg);

    try {
      const result = await handler(data, context);

      if (this.options.ackStrategy?.mode === 'auto') {
        await this.channel.ack(msg);
      }
      // Manual mode: user calls context.ack()

      return result;
    } catch (error) {
      await this.handleError(msg, error, context);
      throw error;
    }

}

private async handleError(msg: Message, error: Error, context: MessageContext): Promise<void> {
const strategy = this.options.ackStrategy;
const attempts = (msg.properties.headers?.['x-retry-count'] || 0) + 1;

    if (strategy?.mode === 'manual') {
      // Let user handle via context.nack()
      return;
    }

    const shouldRequeue = typeof strategy?.requeue === 'function'
      ? strategy.requeue(error, attempts)
      : strategy?.requeue ?? true;

    if (shouldRequeue && attempts < (strategy?.maxRetries || 3)) {
      // Requeue with retry count
      msg.properties.headers = {
        ...msg.properties.headers,
        'x-retry-count': attempts,
        'x-first-failure': msg.properties.headers?.['x-first-failure'] || Date.now()
      };

      if (strategy?.retryDelay) {
        const delay = typeof strategy.retryDelay === 'function'
          ? strategy.retryDelay(attempts)
          : strategy.retryDelay;

        // Implement delay using temporary queue or delayed message plugin
        await this.scheduleRetry(msg, delay);
      } else {
        await this.channel.nack(msg, false, true);
      }
    } else {
      // Send to DLQ
      await this.channel.nack(msg, false, false);
    }

}
} 2. Dead Letter Queue Configuration
Proposed Implementation
typescriptinterface DLQOptions {
enabled: boolean;
exchange?: string; // Default: 'dlx'
routingKey?: string; // Default: `${queueName}.dead`
ttl?: number; // Message TTL in DLQ (ms)
maxLength?: number; // Max messages in DLQ
processHandler?: (msg: any) => Promise<void>; // Optional DLQ processor
}

interface QueueAssertionOptions {
dlq?: DLQOptions;
maxPriority?: number;
messageTtl?: number;
maxLength?: number;
}

class ConnectionManager {
protected async assertQueue(
queueName: string,
options?: QueueAssertionOptions
): Promise<void> {
const queueArgs: Record<string, any> = {};

    // Configure DLQ
    if (options?.dlq?.enabled) {
      const dlqExchange = options.dlq.exchange || 'dlx';
      const dlqRoutingKey = options.dlq.routingKey || `${queueName}.dead`;

      // Assert DLQ exchange
      await this.channel.assertExchange(dlqExchange, 'direct', { durable: true });

      // Assert DLQ queue
      const dlqName = `${queueName}.dlq`;
      await this.channel.assertQueue(dlqName, {
        durable: true,
        arguments: {
          'x-message-ttl': options.dlq.ttl,
          'x-max-length': options.dlq.maxLength
        }
      });

      // Bind DLQ
      await this.channel.bindQueue(dlqName, dlqExchange, dlqRoutingKey);

      // Set dead letter arguments
      queueArgs['x-dead-letter-exchange'] = dlqExchange;
      queueArgs['x-dead-letter-routing-key'] = dlqRoutingKey;
    }

    // Assert main queue with DLQ config
    await this.channel.assertQueue(queueName, {
      durable: true,
      arguments: queueArgs
    });

    // Setup DLQ processor if provided
    if (options?.dlq?.processHandler) {
      await this.consumeDLQ(`${queueName}.dlq`, options.dlq.processHandler);
    }

}

private async consumeDLQ(queueName: string, handler: Function): Promise<void> {
await this.channel.consume(queueName, async (msg) => {
if (!msg) return;

      try {
        const content = JSON.parse(msg.content.toString());
        await handler(content);
        await this.channel.ack(msg);
      } catch (error) {
        // DLQ processing failed - log but don't requeue
        this.logger.error('DLQ processing failed', { error, queue: queueName });
        await this.channel.nack(msg, false, false);
      }
    });

}
} 3. Poison Message Protection
Proposed Implementation
typescriptinterface MessageValidation {
maxSize?: number; // Max message size in bytes
schemaValidation?: boolean; // Enable JSON schema validation
malformedMessageStrategy: 'reject' | 'dlq' | 'ignore';
}

class MessageParser {
constructor(private options: MessageValidation) {}

async parse(msg: Message): Promise<ParseResult> {
try {
// Size validation
if (this.options.maxSize && msg.content.length > this.options.maxSize) {
throw new MessageValidationError('Message exceeds maximum size');
}

      // Parse content
      const contentStr = msg.content.toString();

      // Check for null bytes or invalid characters
      if (/\0/.test(contentStr)) {
        throw new MessageValidationError('Message contains null bytes');
      }

      // Parse JSON
      const data = JSON.parse(contentStr);

      // Basic structure validation
      if (data === null || data === undefined) {
        throw new MessageValidationError('Message is null or undefined');
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error,
        strategy: this.options.malformedMessageStrategy
      };
    }

}
}

class RpcServer {
private messageParser: MessageParser;

private async handleMessage(msg: Message): Promise<void> {
const parseResult = await this.messageParser.parse(msg);

    if (!parseResult.success) {
      switch (parseResult.strategy) {
        case 'reject':
          // NACK without requeue - sends to DLQ
          await this.channel.nack(msg, false, false);
          this.logger.error('Rejected poison message', {
            error: parseResult.error,
            messageId: msg.properties.messageId
          });
          break;

        case 'dlq':
          // Send directly to DLQ with error metadata
          await this.sendToDLQ(msg, parseResult.error);
          await this.channel.ack(msg);
          break;

        case 'ignore':
          // ACK and ignore
          await this.channel.ack(msg);
          this.logger.warn('Ignored malformed message', {
            messageId: msg.properties.messageId
          });
          break;
      }
      return;
    }

    // Process valid message
    await this.processValidMessage(msg, parseResult.data);

}
} 4. Connection Recovery & Message Buffering
Proposed Implementation
typescriptinterface RecoveryOptions {
enableBuffer: boolean;
maxBufferSize: number;
bufferTTL: number;
reconnectStrategy: 'immediate' | 'exponential' | 'linear';
}

class ConnectionManager {
private messageBuffer: MessageBuffer;
private reconnecting = false;

constructor(options: ConnectionOptions) {
this.messageBuffer = new MessageBuffer({
maxSize: options.recovery?.maxBufferSize || 1000,
ttl: options.recovery?.bufferTTL || 30000
});
}

async send(data: any): Promise<any> {
if (this.reconnecting && this.options.recovery?.enableBuffer) {
// Buffer message during reconnection
return this.messageBuffer.add(data);
}

    try {
      return await this.performSend(data);
    } catch (error) {
      if (this.isConnectionError(error)) {
        await this.handleConnectionError();

        if (this.options.recovery?.enableBuffer) {
          return this.messageBuffer.add(data);
        }
      }
      throw error;
    }

}

private async handleReconnection(): Promise<void> {
this.reconnecting = true;

    try {
      await this.reconnect();

      // Process buffered messages
      const buffered = this.messageBuffer.flush();

      for (const { data, resolve, reject, timestamp } of buffered) {
        // Check if message expired
        if (Date.now() - timestamp > this.options.recovery.bufferTTL) {
          reject(new Error('Message expired during reconnection'));
          continue;
        }

        try {
          const result = await this.performSend(data);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }
    } finally {
      this.reconnecting = false;
    }

}
} 5. Duplicate Message Detection
Proposed Implementation
typescriptinterface DeduplicationOptions {
enabled: boolean;
cacheTTL: number; // How long to remember processed messages
cacheSize: number; // Max number of message IDs to track
keyExtractor?: (msg: any) => string; // Custom dedup key
}

class MessageDeduplicator {
private cache: LRUCache<string, any>;

constructor(private options: DeduplicationOptions) {
this.cache = new LRUCache({
max: options.cacheSize,
ttl: options.cacheTTL
});
}

async process<T>(
msg: Message,
handler: () => Promise<T>
): Promise<{ duplicate: boolean; result?: T }> {
const key = this.extractKey(msg);

    // Check cache
    if (this.cache.has(key)) {
      return {
        duplicate: true,
        result: this.cache.get(key)
      };
    }

    // Process new message
    const result = await handler();

    // Cache result
    this.cache.set(key, result);

    return { duplicate: false, result };

}

private extractKey(msg: Message): string {
if (this.options.keyExtractor) {
return this.options.keyExtractor(msg);
}

    // Default: use messageId or create hash
    return msg.properties.messageId ||
           this.hashMessage(msg.content);

}
} 6. Resource Management & Cleanup
Proposed Implementation
typescriptinterface ResourceTracker {
consumers: Map<string, ConsumerInfo>;
channels: Set<Channel>;
timers: Set<NodeJS.Timer>;
pendingMessages: Map<string, PendingMessage>;
}

class BaseServer {
protected resources: ResourceTracker = {
consumers: new Map(),
channels: new Set(),
timers: new Set(),
pendingMessages: new Map()
};

async stop(options?: { timeout?: number; force?: boolean }): Promise<void> {
const timeout = options?.timeout || 30000;

    try {
      // 1. Stop accepting new messages
      await this.pauseConsumers();

      // 2. Wait for in-flight messages
      if (!options?.force) {
        await this.waitForPendingMessages(timeout);
      }

      // 3. Cancel all consumers
      for (const [tag, info] of this.resources.consumers) {
        try {
          await this.channel.cancel(tag);
          this.logger.debug(`Cancelled consumer ${tag}`);
        } catch (error) {
          this.logger.error(`Failed to cancel consumer ${tag}`, error);
        }
      }

      // 4. Clear all timers
      for (const timer of this.resources.timers) {
        clearTimeout(timer);
      }

      // 5. Close all channels
      for (const channel of this.resources.channels) {
        try {
          await channel.close();
        } catch (error) {
          this.logger.error('Failed to close channel', error);
        }
      }

      // 6. Close connection
      if (this.connection) {
        await this.connection.close();
      }

      // 7. Clear resources
      this.resources.consumers.clear();
      this.resources.channels.clear();
      this.resources.timers.clear();
      this.resources.pendingMessages.clear();

    } catch (error) {
      this.logger.error('Error during shutdown', error);
      if (!options?.force) {
        throw error;
      }
    }

}

private async waitForPendingMessages(timeout: number): Promise<void> {
const start = Date.now();

    while (this.resources.pendingMessages.size > 0) {
      if (Date.now() - start > timeout) {
        throw new Error(
          `Shutdown timeout: ${this.resources.pendingMessages.size} messages still pending`
        );
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

}
} 7. Error Isolation for Pub/Sub
Proposed Implementation
typescriptinterface ErrorHandlingOptions {
isolateErrors: boolean; // Prevent one handler affecting others
errorHandler?: (error: Error, context: ErrorContext) => void;
continueOnError: boolean; // Continue processing other handlers
}

class Subscriber {
private async processMessage(
routingKey: string,
msg: Message
): Promise<void> {
const handlers = this.findMatchingHandlers(routingKey);

    if (handlers.length === 0) {
      // No handlers - ACK anyway to prevent queue buildup
      await this.channel.ack(msg);
      return;
    }

    const results = await Promise.allSettled(
      handlers.map(handler => this.executeHandler(handler, msg, routingKey))
    );

    // Analyze results
    const failures = results.filter(r => r.status === 'rejected');

    if (failures.length > 0) {
      if (!this.options.errorHandling?.continueOnError) {
        // At least one failed - NACK
        await this.channel.nack(msg, false, true);

        // Report failures
        failures.forEach((failure: any) => {
          this.handleHandlerError(failure.reason, msg, routingKey);
        });
      } else {
        // Continue on error - ACK anyway
        await this.channel.ack(msg);

        // Log failures
        failures.forEach((failure: any) => {
          this.logger.error('Handler failed but continuing', {
            error: failure.reason,
            routingKey
          });
        });
      }
    } else {
      // All succeeded
      await this.channel.ack(msg);
    }

}

private async executeHandler(
handler: Handler,
msg: Message,
routingKey: string
): Promise<any> {
try {
const data = JSON.parse(msg.content.toString());
const context = this.createContext(msg, routingKey);

      // Wrap in timeout if configured
      if (this.options.handlerTimeout) {
        return await this.withTimeout(
          handler(data, context),
          this.options.handlerTimeout
        );
      }

      return await handler(data, context);
    } catch (error) {
      if (this.options.errorHandling?.isolateErrors) {
        // Log but don't throw - isolation
        this.logger.error('Isolated handler error', {
          error,
          routingKey,
          messageId: msg.properties.messageId
        });

        if (this.options.errorHandling?.errorHandler) {
          this.options.errorHandling.errorHandler(error, {
            msg,
            routingKey,
            handler
          });
        }

        // Return special marker for failed but isolated
        return { __isolated_error__: true, error };
      }

      throw error;
    }

}
}
Implementation Plan
Phase 1: Critical Safety (Week 1)

ACK/NACK Strategy - Implement configurable acknowledgment
Poison Message Handling - Protect against malformed messages
Basic DLQ Configuration - Setup dead letter queues

Phase 2: Reliability (Week 2)

Connection Recovery - Implement message buffering during reconnection
Resource Cleanup - Proper shutdown and resource management
Error Isolation - Prevent cascading failures in pub/sub

Phase 3: Production Features (Week 3)

Duplicate Detection - Implement deduplication cache
Message Timeouts - Add handler timeout support
Prefetch Tuning - Make prefetch configurable

Phase 4: Testing & Documentation (Week 4)

Integration Tests - Test all failure scenarios
Load Testing - Verify no memory leaks
Documentation - Update README with new options

Testing Requirements
Unit Tests

ACK/NACK behavior with different strategies
DLQ message routing
Poison message handling
Duplicate detection accuracy
Resource cleanup verification

Integration Tests
typescriptdescribe('Reliability Tests', () => {
test('should handle 100% failure rate without message loss', async () => {
const server = new RpcServer({
ackStrategy: { mode: 'auto', maxRetries: 3 },
dlq: { enabled: true }
});

    let attempts = 0;
    server.registerHandler('FAIL', async () => {
      attempts++;
      throw new Error('Always fails');
    });

    await client.send('FAIL', { test: true });

    // Check message ended in DLQ
    const dlqMessages = await inspectDLQ();
    expect(dlqMessages).toHaveLength(1);
    expect(attempts).toBe(3);

});

test('should not leak memory after 10000 messages', async () => {
const initialMem = process.memoryUsage().heapUsed;

    for (let i = 0; i < 10000; i++) {
      await client.send('TEST', { index: i });
    }

    global.gc(); // Force garbage collection
    const finalMem = process.memoryUsage().heapUsed;

    // Memory should not grow more than 10MB
    expect(finalMem - initialMem).toBeLessThan(10 * 1024 * 1024);

});
});
Performance Benchmarks

Measure ACK/NACK overhead: < 0.5ms
Duplicate detection performance: < 1ms for 10k cache
Recovery time after connection loss: < 5s
Message throughput with all features: > 1000 msg/s

Success Criteria

Zero Message Loss: No messages lost during normal failures
Graceful Degradation: System remains operational with degraded RabbitMQ
Memory Stability: No memory growth after 24h operation
Error Isolation: Single bad handler doesn't affect others
Clean Shutdown: All resources properly released

Configuration Examples
Recommended Production Configuration
typescript// RPC Server - High Reliability
const rpcServer = new RpcServer({
connection: {
url: 'amqp://localhost',
heartbeat: 30
},
queueName: 'critical-service',

// Reliability
ackStrategy: {
mode: 'auto',
maxRetries: 3,
requeue: (error, attempts) => attempts < 3 && !error.fatal,
retryDelay: (attempt) => Math.min(1000 \* Math.pow(2, attempt), 30000)
},

// Dead Letter Queue
dlq: {
enabled: true,
ttl: 86400000, // 24 hours
maxLength: 10000
},

// Protection
messageValidation: {
maxSize: 1048576, // 1MB
malformedMessageStrategy: 'dlq'
},

// Performance
prefetch: 1,
handlerTimeout: 30000,

// Deduplication
deduplication: {
enabled: true,
cacheTTL: 300000,
cacheSize: 10000
}
});

// Pub/Sub - High Throughput
const subscriber = new Subscriber({
connection: { url: 'amqp://localhost' },
exchange: 'events',
queueName: 'analytics',

// Throughput optimized
prefetch: 100,

// Error handling
errorHandling: {
isolateErrors: true,
continueOnError: true
},

// Less strict for analytics
ackStrategy: {
mode: 'auto',
requeue: false // Don't retry analytics
}
});
Rollout Strategy

Alpha: Deploy to staging with monitoring
Beta: Progressive rollout to 10% production traffic
GA: Full production deployment after 1 week stability

Monitoring & Alerts
Required metrics:

Message ACK/NACK rates
DLQ depth
Connection failures/recovery
Memory usage
Handler execution time
Duplicate detection hit rate

Documentation Updates

Update README with new configuration options
Add production deployment best practices
