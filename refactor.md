PRD: Middleware Context Type Safety & Error Handling Improvements
Overview
Improve type safety in middleware context handling and implement RabbitMQ best practices for error handling across RpcServer and Subscriber components.

Problem Statement

1. Type Safety Issues
   Current State:

Using (context as any).metadata to bypass TypeScript in RpcServer
Using (context as any).rawMessage in Subscriber
Type information is lost, reducing IDE support and compile-time safety

Impact:

Harder to maintain and refactor
No autocomplete for extended context properties
Runtime errors possible due to missing type checks

2. Subscriber Context Duplication
   Current State:

Creates legacyCtx object in handleMessage()
Converts to MessageContext in stored handler wrapper
Double conversion: raw message → legacy context → MessageContext

Impact:

Unnecessary object creation on every message
Harder to follow data flow
Performance overhead from double marshaling

3. Non-Standard Error Handling
   Current State:

Both RpcServer and Subscriber ACK messages even on handler errors
No distinction between transient and permanent failures
Errors are lost instead of being retried or dead-lettered

Impact:

Transient errors (DB timeout, network issues) are not retried
No way to debug failed messages (no DLQ)
Goes against RabbitMQ best practices

Goals

Type Safety: Eliminate all as any casts in context handling
Performance: Remove double context conversion in Subscriber
Reliability: Implement RabbitMQ error handling best practices
Maintainability: Clear, self-documenting code for context extension

Detailed Requirements
Requirement 1: Type-Safe Context Extension
Acceptance Criteria:

No as any casts in RpcServer or Subscriber
All context properties properly typed
IDE autocomplete works for extended properties
Backward compatible with existing middleware

Implementation Options:
Option A: Extend MessageContext interface (RECOMMENDED)
typescript// core/types.ts
export interface MessageContext {
messageId: string;
timestamp: Date;
headers: Record<string, any>;
// ... existing fields

// Extension fields (optional to maintain compatibility)
metadata?: Record<string, any>;
rawMessage?: any; // or ConsumeMessage from amqplib
method?: string;
routingKey?: string;
eventName?: string;

// Methods
reply?: (data: any) => Promise<void>;
ack?: () => Promise<void>;
nack?: (requeue?: boolean) => Promise<void>;
}
Option B: Generic context with extras
typescriptexport interface MessageContext<TExtras = any> {
messageId: string;
timestamp: Date;
headers: Record<string, any>;
extras: TExtras; // Extensible extras object
// ... other fields
}

// Usage in RpcServer
type RpcContext = MessageContext<{
metadata?: Record<string, any>;
method: string;
}>;

```

**Decision:** Use **Option A** (simpler, more ergonomic for users)

---

### Requirement 2: Single MessageContext Creation in Subscriber

**Acceptance Criteria:**
- [ ] MessageContext created once in `handleMessage()`
- [ ] No intermediate legacy context object
- [ ] Adapter converts MessageContext to legacy signature
- [ ] No performance regression

**Current Flow:**
```

Raw Message → Legacy Context → Stored Handler → MessageContext → Middleware → Adapter → Legacy Handler

```

**Target Flow:**
```

Raw Message → MessageContext → Middleware → Adapter → Legacy Handler
Implementation:
typescript// In handleMessage()
private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
if (!msg || !this.channel) return;

try {
const envelope = this.config.serializer.decode(msg.content);
const eventName = envelope.eventName || msg.fields.routingKey;

    // Create MessageContext ONCE
    const context: MessageContext = {
      messageId: msg.properties.messageId || randomUUID(),
      timestamp: new Date(envelope.timestamp || Date.now()),
      eventName,
      routingKey: msg.fields.routingKey,
      headers: msg.properties.headers || {},
      metadata: envelope.metadata,
      rawMessage: msg,
      ack: async () => {
        if (this.channel) await this.channel.ack(msg);
      },
      nack: async (requeue = false) => {
        if (this.channel) await this.channel.nack(msg, false, requeue);
      },
    };

    // Find matching handlers
    const matchingHandlers = this.handlers.filter((h) => h.regex.test(eventName));

    if (matchingHandlers.length === 0) {
      await this.channel.ack(msg);
      return;
    }

    // Execute handlers directly with MessageContext
    await Promise.all(
      matchingHandlers.map(({ composedHandler }) =>
        composedHandler(envelope.data, context)
      )
    );

    await this.channel.ack(msg);

} catch (error) {
// ... error handling (see Requirement 3)
}
}

// In on() registration
on(eventPattern: string, ...args: any[]): this {
// ... validation ...

const userHandler: EventHandler = last as EventHandler;
const perHandlerMiddlewares: Middleware[] = args.slice(0, -1);

// Adapter converts MessageContext to legacy EventHandler signature
const adapter: Handler = (message: any, ctx: MessageContext) => {
return userHandler(message, {
eventName: ctx.eventName!,
timestamp: ctx.timestamp.getTime(),
metadata: ctx.metadata,
rawMessage: ctx.rawMessage,
});
};

// Compose once at registration
const fullStack = [...this.globalMiddlewares, ...perHandlerMiddlewares, adapter];
const composedHandler = compose(...fullStack);

this.handlers.push({
pattern: eventPattern,
composedHandler, // Store composed handler directly
regex: this.patternToRegex(eventPattern),
});

return this;
}
Storage changes:
typescriptinterface HandlerRegistration {
pattern: string;
composedHandler: Handler; // Changed from `handler: EventHandler`
regex: RegExp;
}

Requirement 3: RabbitMQ Error Handling Best Practices
Acceptance Criteria:

Distinguish between transient and permanent errors
Transient errors are NACK'd with requeue
Permanent errors are NACK'd without requeue (DLQ)
Configurable retry behavior per error type
Logged with proper context for debugging

RabbitMQ Best Practices:
Error TypeExampleActionRationaleTransientDB timeout, network error, service unavailableNACK + requeueMay succeed on retryPermanentValidation error, malformed data, handler logic errorNACK without requeueWill never succeed, send to DLQPoisonMessage causes crash/infinite loopNACK without requeue after N attemptsProtect system
Implementation:
typescript// core/errors.ts
export class TransientError extends Error {
constructor(message: string, public readonly cause?: Error) {
super(message);
this.name = 'TransientError';
}
}

export class PermanentError extends Error {
constructor(message: string, public readonly cause?: Error) {
super(message);
this.name = 'PermanentError';
}
}

// Helper to classify errors
export function isTransientError(error: Error): boolean {
// Explicit TransientError
if (error instanceof TransientError) return true;

// Common transient error patterns
const transientPatterns = [
/timeout/i,
/ECONNREFUSED/,
/ETIMEDOUT/,
/ENOTFOUND/,
/503/,
/connection/i,
];

return transientPatterns.some(pattern =>
pattern.test(error.message) || pattern.test(error.name)
);
}
RpcServer error handling:
typescriptprivate async handleRequest(msg: ConsumeMessage | null): Promise<void> {
if (!msg || !this.channel) return;

const correlationId = msg.properties.correlationId;
const replyTo = msg.properties.replyTo;
let responseSent = false;

try {
// ... execute handler ...

} catch (error) {
this.logger.error('Error handling request', {
error,
correlationId,
command: request?.command,
});

    // Send error response to client
    if (replyTo && this.channel && !responseSent) {
      const response: ResponseEnvelope = {
        id: correlationId || 'unknown',
        timestamp: Date.now(),
        success: false,
        error: {
          code: (error as any).name || 'HANDLER_ERROR',
          message: (error as Error).message,
          details: (error as any).details,
        },
      };

      const content = this.serializer.encode(response);
      this.channel.sendToQueue(replyTo, content, {
        correlationId,
        contentType: 'application/json',
      });
    }

    // Classify error and decide ACK/NACK
    if (isTransientError(error as Error)) {
      // Transient error: NACK with requeue for retry
      if (this.channel) {
        this.logger.warn('Transient error, requeuing message', {
          correlationId,
          error: (error as Error).message,
        });
        this.channel.nack(msg, false, true); // requeue = true
      }
    } else {
      // Permanent error: ACK to remove from queue (avoid infinite retry)
      // Error response already sent to client above
      if (this.channel) {
        this.logger.error('Permanent error, removing message', {
          correlationId,
          error: (error as Error).message,
        });
        this.channel.ack(msg);
      }
    }

} finally {
if (correlationId) {
this.inFlightMessages.delete(correlationId);
}
}
}
Subscriber error handling:
typescriptprivate async handleMessage(msg: ConsumeMessage | null): Promise<void> {
if (!msg || !this.channel) return;

try {
// ... decode and execute handlers ...

    await this.channel.ack(msg);
    this.config.logger.debug(`Successfully processed event: ${eventName}`);

} catch (error) {
this.config.logger.error('Error handling message', {
error,
eventName: msg.fields.routingKey,
messageId: msg.properties.messageId,
});

    // Classify error
    if (isTransientError(error as Error)) {
      // Transient: requeue for retry
      this.config.logger.warn('Transient error, requeuing message', {
        eventName: msg.fields.routingKey,
        error: (error as Error).message,
      });
      await this.channel.nack(msg, false, true); // requeue = true
    } else {
      // Permanent: send to DLQ (no requeue)
      this.config.logger.error('Permanent error, sending to DLQ', {
        eventName: msg.fields.routingKey,
        error: (error as Error).message,
      });
      await this.channel.nack(msg, false, false); // requeue = false
    }

}
}
Configuration option (optional enhancement):
typescriptexport interface RpcServerConfig {
// ... existing fields ...
errorHandling?: {
requeueTransientErrors?: boolean; // default: true
maxRetries?: number; // default: 3 (track via x-death header)
};
}

Testing Requirements
Unit Tests

Context properties are correctly typed (TypeScript compilation test)
No as any in codebase (linter check)
Subscriber creates MessageContext only once (spy test)
TransientError → NACK with requeue
PermanentError → NACK without requeue
Unknown errors → classified correctly
Middleware receives properly typed context

Integration Tests

RpcServer retries transient errors
RpcServer sends permanent errors to DLQ
Subscriber retries transient errors
Subscriber sends permanent errors to DLQ
Error responses sent to client in RPC

Migration Guide
For Library Users (Breaking Changes)
None - These changes are backward compatible:

MessageContext is extended, not replaced
Error handling is improved but transparent
Existing handlers continue to work

For Library Developers
Changes needed:

Update MessageContext interface in core/types.ts
Remove all as any casts
Refactor Subscriber handleMessage() and on()
Add error classification logic
Update RpcServer and Subscriber error handling
Add new error classes to core/errors.ts

Success Metrics

Zero as any casts in middleware-related code
TypeScript strict mode passes with no suppressions
Subscriber context creation reduced from 2 to 1 per message
Transient errors successfully retried (observable in logs)
Permanent errors sent to DLQ (no infinite retry loops)
All tests passing

Timeline

Phase 1 (1-2 days): Type safety improvements

Update MessageContext interface
Remove as any casts
Update tests

Phase 2 (1 day): Subscriber context refactor

Refactor handleMessage()
Update handler registration
Update tests

Phase 3 (2-3 days): Error handling

Add error classification
Update RpcServer error handling
Update Subscriber error handling
Add integration tests

Total: 4-6 days
