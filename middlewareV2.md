Product Requirements Document — Express-like middleware for Hermes-MQ
Overview (goal)

Add an Express/Koa-like middleware system to Hermes-MQ that:

Allows global middleware via server.use(...) and per-handler middleware via server.registerHandler('CMD', mw1, mw2, handler).

Composes middleware once at registration time (no runtime composition on every message). Any server.use() calls after handlers are registered are allowed but ignored (documented). Consumers must call use() before registerHandler(); this decision is intentional for performance and simplicity.

Ships two built-in middleware initially:

validate(schemaOrAdapter) — input validation (adapters for Zod, Yup, Ajv etc.)

retry(policy) — override retry policy for a single command (per-handler)

Provides a simple client-side middleware surface limited to outgoing payload validation.

Has TypeScript-first typings (generics per handler for request/response).

Middleware execution order: global middlewares (in registration order) → handler middlewares (in registration order) → handler.

Middleware may short-circuit and return a value; returned values are treated as the response (convenient for community). Also support explicit ctx.reply(value) for clarity.

Focus on performance (compose once at registration; use arrow functions; minimal per-message allocation).

Non-goals

Dynamic runtime re-composition on every new use() call.

Full-featured client-side middleware system (only validation for outgoing payloads).

Adding many built-in middleware at first — start with validate and retry.

API Spec (developer-facing)
Types (TS)
type RpcPayload = any;

type RpcContext<Req = any, Res = any> = {
command: string;
payload: Req;
properties: Record<string, any>; // AMQP properties / headers
rawMessage?: any; // amqplib.Message
meta: Record<string, any>; // per-request store used by middleware
logger: Logger;
attempts?: number; // current attempt number
abortSignal?: AbortSignal;

// helpers
reply: (res: Res) => Promise<void>;
ack: () => void;
nack: (requeue?: boolean) => void;
};

type Middleware<Req = any, Res = any> = (ctx: RpcContext<Req, Res>, next: () => Promise<any>) => Promise<any> | any;
// note: Middleware may return a value; a returned non-undefined value is treated as the final response (short-circuit).

type Handler<Req = any, Res = any> = (payload: Req, ctx: RpcContext<Req, Res>) => Promise<Res | void> | Res | void;

RpcServer API
class RpcServer {
use(...mws: Middleware[]): void;
registerHandler<Req = any, Res = any>(
command: string,
...middlewaresAndHandler: Array<Middleware<Req, Res> | Handler<Req, Res>>
): void;
start(): Promise<void>;
// existing constructor options remain unchanged
}

Notes:

server.use() must be called before any registerHandler() if you want those globals to apply to handlers. Any use() calls after the first handler registration will be no-op (they must be logged and documented).

registerHandler accepts n middleware functions followed by the handler function. The library composes globalMiddlewares + handlerMiddlewares + handlerWrapper at registration and caches the composed function in a handlers map for the command.

RpcClient API (light)
class RpcClient {
use(...clientMiddlewares: ClientMiddleware[]): void; // optional
send<Req, Res>(command: string, payload: Req, opts?: SendOptions): Promise<Res>;
}

type ClientMiddleware = (command: string, payload: any) => Promise<{command: string, payload: any}> | {command: string, payload: any};

For v1 only include support for validate style middleware (schema adapters). Keep client middleware small and opt-in.

Built-in middleware

1. validate(adapterOrSchema)

Purpose: validate incoming payload and optionally coerce/transform it.

Accepts:

A schema object (for the default adapter) or

An adapter object { type: 'zod' | 'yup' | 'ajv' | 'custom', validate: (payload) => { success: boolean, value?, errors? } }

Behavior:

If validation passes: set ctx.payload to the parsed/coerced value (if provided).

If validation fails: return a standardized error object (shortcut response), e.g. { error: 'ValidationError', details: [...] }. This returned value is treated as the final reply. Alternatively, allow the middleware to ctx.reply(...).

Example usage:

import { validate } from 'hermes-mq/middleware';

server.registerHandler('ADD', validate(zodSchema), async (payload) => { ... });

Provide adapters for Zod and Yup out of the box:

validate(zodSchema) -> detect Zod by duck typing (schema.parse / safeParse)

validate(yupSchema) -> detect Yup (schema.validate)

For Ajv accept compiled validate function or schema + internal ajv instance

Provide validateAdapter({ type: 'zod', validate: fn }) extensibility pattern.

2. retry(policy)

Purpose: override per-command retry/delivery policy (max attempts, backoff strategy).

Accepts options:

type RetryPolicy = {
maxAttempts?: number; // e.g. 3
backoffStrategy?: 'fixed' | 'exponential' | ((attempt)=>number); // returns ms
requeueOnFail?: boolean; // default true or false per project semantics
}

Behavior:

Sets metadata on handler context (e.g., ctx.meta.retryPolicy) so central server delivery/error logic can read it when message processing fails.

The middleware itself should call await next() and not reply; it's a metadata injector that influences downstream error/ack logic.

Example:

server.registerHandler('COMMAND', retry({ maxAttempts: 5, backoffStrategy: 'exponential' }), handler);

Middleware semantics & execution rules

Order: global use() in registration order → per-handler middlewares in registration order → handler.

Composition: performed once at registerHandler() time. A composed function (ctx) => Promise<void|any> is stored per-command.

Short-circuit:

If middleware/handler returns a non-undefined value (sync or Promise-resolved), that value is treated as the final response and the chain stops (no further middleware).

If middleware calls await ctx.reply(value) and does not call next(), the chain stops.

If middleware neither calls ctx.reply() nor returns a value nor calls next(), it effectively blocks — document this as erroneous (and tests must catch this).

next() constraints:

next() must be called at most once in a middleware. Multiple calls should throw (Koa-style next() protection).

Error handling:

If any middleware or handler throws, the composed caller (message dispatch logic) will catch and apply server-level error handling (existing ack/retry/DLQ logic).

The retry policy middleware should be read by that central error handler to decide requeue/DLQ/backoff.

Replying:

If a handler returns a value, the library should send the reply automatically (unless handler used ctx.reply manually). If the middleware already replied, the reply should not be sent again.

ctx typing:

Generics must ensure ctx.payload typed as request type and ctx.reply typed to accept response type.

Implementation plan (developer tasks for Copilot)

Add src/middleware.ts

Implement compose(middlewares: Middleware[]) with Koa-like semantics.

Provide TS types for RpcContext, Middleware, Handler.

Ensure compose implemented as an arrow function and follows performance-friendly patterns.

Update src/rpc-server.ts

Add private globalMiddlewares: Middleware[] = [];

Implement use(...mws: Middleware[]): void

If this.handlers.size > 0, log a warning and ignore newly provided middleware (no re-composition).

Document this behavior in README and log message like: "[hermes-mq] server.use() after handler registration ignored for performance. Call use() before registerHandler()"

Modify registerHandler(command, ...middlewaresAndHandler):

Separate last function as handler.

Validate types: last param must be a function with handler signature.

Build handlerWrapper that:

Calls handler with typed payload and ctx.

If handler returns value (not undefined) and ctx.reply wasn't already called, send reply automatically.

Compose globalMiddlewares.concat(handlerMiddlewares).concat([handlerWrapper]) using compose and store in handlers map (e.g. this.handlers.set(command, { composed, meta })).

Modify message dispatch code to:

Build ctx quickly per message with minimal allocations; keep helpers as arrow functions.

await composed(ctx) and handle returned value (if compose returns a value) — but per compose spec, the handlerWrapper will handle reply, so the dispatcher mostly needs to catch thrown errors and apply retry/DLQ logic.

Ensure the retry middleware simply sets ctx.meta.retryPolicy so central logic uses it; central code that already handles retries must be extended to consult ctx.meta.retryPolicy before deciding default retry parameters.

Add built-in middleware

src/middleware/validate.ts

Implementation:

If argument is Zod schema (duck-typed safeParse), call safeParse and act accordingly.

If Yup schema (duck-typed validate), call validate.

If Ajv, use provided validate function.

Accept a generic adapter: { validate: (payload) => { success: boolean; value?: any; errors?: any } }.

On failure: return { error: 'ValidationError', details: errors } (this will be sent as reply).

On success: set ctx.payload = value (if available) and await next().

src/middleware/retry.ts

Implementation:

Accepts RetryPolicy.

Middleware sets ctx.meta.retryPolicy = policy.

Calls await next().

Client-side validation

Implement a small validate helper or client.use(validate(...)) that hooks into send() to run validation before sending. If invalid, send() should reject with a clear ValidationError; optionally, if client middleware returns transformed payload, use that.

Types

Add generics to registerHandler so handler payload and response types are enforced.

Export types from index.d.ts.

Tests

Unit tests for compose:

next-called-multiple-times throws

short-circuit via returned value

ctx.reply short-circuit

order of execution

Integration tests:

register handler with global + per-handler middleware, send RPC and assert middleware order and result.

validate middleware with Zod and Yup schemas (mock both; add devDependencies).

retry middleware sets ctx.meta.retryPolicy and central retry logic reads it.

use() after registerHandler() should be ignored and logged (test that behavior).

Performance/basic benchmark test: measure composition does not happen per message (spy on compose / ensure not invoked per message).

Use existing test framework present in project (jest/vitest — follow project's current choice).

Examples

Add examples/middleware/ folder with:

rpc-server.js demonstrating server.use(logger), registerHandler('ADD', validate(zodSchema), retry({maxAttempts:3}), handler).

rpc-client.js demonstrating client validation middleware.

Docs / README

Update README:

Explain server.use() must be called before registerHandler(). Provide rationale: performance and simplicity.

Document middleware API, return semantics (return value treated as reply), ctx.reply vs return, and examples.

Document built-in validate and retry, and adapters for Zod/Yup/Ajv.

Add migration notes: backward-compatible; default behavior unchanged if not using middleware.

Performance considerations

Compose at registration time only.

Use arrow funcs for middleware and helpers.

Keep the composed function closure small; do not capture heavy objects.

Build minimal ctx object per message — avoid extra wrapper allocations; but ctx must be an object as middleware rely on it.

Avoid bind(); use arrow functions for reply, ack, nack.

Add a micro-benchmark in tests/bench to show handling 10k messages per second (if applicable) or at least show negligible overhead vs previous baseline.

Linting & formatting

Keep project ESLint/Prettier rules.

Use // arrow functions where appropriate; avoid function keyword in hot paths.

Acceptance criteria

server.use exists and accepts middleware; if called after handler registration, logs a warning and ignores new middleware.

registerHandler accepts middleware + handler, composes at registration, and stores composed handler.

Middleware chain executes: global → handler → handler function in expected order.

Middleware may return value to short-circuit and cause that value to be used as reply.

Built-in validate works with Zod and Yup via adapter detection; transforms ctx.payload on success; short-circuits with an error reply on failure.

Built-in retry middleware injects a retry policy into ctx.meta and central retry logic respects it.

Simple client-side validation middleware exists and blocks send() on invalid payload.

TypeScript typings enforce registerHandler<TReq, TRes> payload/response types.

Unit & integration tests cover compose, short-circuit, validate, retry, and use()-after-register behavior.

README updated with new API and migration notes.

No observable per-message composition overhead; tests demonstrate composition occurs at registration only.

Edge cases & notes

Multiple returns: If a middleware returns a value but also calls await next() (we should forbid this). The compose implementation must guard against multiple next() calls and document that returning a value and calling next() is undefined/bad behavior. Add tests to assert that next() thrown if called twice.

Handler already called ctx.reply: If handler returns a value and ctx.reply was already called, the library should not double-send. Implement ctx.\_replied flag.

Validation failure format: Choose a consistent error reply format for validation errors. Make it configurable in the future.

Backwards compatibility: Default behavior (no middleware) remains unchanged; handlers registered with single handler function should still work.

Public API stability: Prefer additive changes; keep version bump as minor or major depending on release policy.

Example snippets to include in PR (copy-paste ready)
Registration example (README snippet)
const server = new RpcServer({ connection: { url: 'amqp://localhost' }, queueName: 'calculator' });

// global middleware (must be called before registerHandler)
server.use(async (ctx, next) => {
ctx.logger.info('received', ctx.command);
await next();
});

const zod = require('zod');
const addSchema = zod.object({ a: zod.number(), b: zod.number() });

server.registerHandler(
'ADD',
validate(addSchema), // built-in validate (zod adapter auto-detected)
retry({ maxAttempts: 3 }), // built-in retry metadata injector
async (payload) => ({ sum: payload.a + payload.b })
);

await server.start();

Client-side validation (example)
const client = new RpcClient({ connection: {...} });
client.use(validate(zodSchema)); // will validate outgoing payloads and reject send() if invalid

const result = await client.send('ADD', { a: 1, b: 2 });

Developer notes for Copilot

Use the existing project structure and testing framework.

Prefer arrow functions in compose, handlerWrapper, ctx helpers.

Keep closure captures minimal when composing middleware.

Detect Zod by checking schema?.safeParse presence; Yup by schema?.validate presence.

Provide a small adapter interface and example adapter file for Zod and Yup.

Add thorough unit tests for compose and middleware short-circuit semantics.

Ensure ctx.reply sets ctx.\_replied = true so double-send avoided.

Keep code simple and readable; performance-minded but not premature-optimized.

at the end also go for test 
Test Plan

The following tests must be added or updated to ensure correct implementation, performance, and stability of the middleware feature.

1. Global Middleware Registration

Should register global middlewares only when called before any registerHandler() invocation.

Should ignore additional .use() calls made after the first handler registration.

Should preserve registration order.

2. Handler-Level Middleware Registration

Should register middlewares in the correct order:
global → handler-specific → final handler.

Should correctly accept multiple functions:
registerHandler('CMD', m1, m2, handler).

3. Execution Order

Middleware execution must follow Express-like sequencing.
Example order: global1 → global2 → local1 → handler.

Verify that each middleware receives:

context (parsed message)

metadata (AMQP properties)

a next() function that properly advances the chain.

4. Middleware Behavior

If a middleware:

returns synchronously, the chain continues normally.

throws an error, the error is propagated to the RPC reply system.

does NOT call next(), handler execution must stop.

Ensure middleware can:

mutate the request payload

add fields to the context

override retry policies (retry built-in middleware)

5. Built-in Middlewares
Validate Middleware

Should support schema adapters for Zod, Yup, Joi, Superstruct, etc.

Should reject invalid payloads with a typed error.

Should mutate or sanitize payloads if the schema library supports it.

Retry Middleware

Should allow overriding retry behavior per command.

Should ensure retry metadata is passed correctly to the internal retry logic.

Should not break existing retry behavior when unused.

6. Client-Side Middleware

Only validate outgoing payloads.

Should not run server middlewares.

Should reject invalid outgoing messages before publishing.

Should work for both RPC client and Subscriber client.

7. Performance Tests

Middleware chain overhead must stay minimal:

Ensure async/await and arrow functions do not introduce noticeable latency.

Ensure no middleware is rebuilt at runtime per request.

Ensure chain composition is done once at startup.

8. Backward Compatibility

Existing users without middlewares must run unaffected.

Handler behavior must remain identical if no middleware is provided.

No breaking changes to handler signatures.

9. Error Propagation Tests

Invalid schema → send a proper RPC error to the client.

Middleware exception → returned as server error.

Middleware timeout / no next() → should not hang; should return a controlled error.