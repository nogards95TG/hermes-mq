const { Publisher, Subscriber } = require('../dist');

const main = async () => {
  // Publisher with global middleware
  const publisher = new Publisher({
    connection: { url: 'amqp://localhost' },
    exchange: 'events',
  });

  // Global middleware runs for every publish on this publisher
  publisher.use(async (message, ctx, next) => {
    // add a trace id header
    ctx.headers = { ...(ctx.headers || {}), 'x-trace-id': 'trace-1' };
    console.log('[Publisher][middleware] trace-id added');
    return next();
  });

  // Subscriber with global middleware
  const subscriber = new Subscriber({
    connection: { url: 'amqp://localhost' },
    exchange: 'events',
    queueName: 'examples_middleware_pubsub',
  });

  subscriber.use(async (message, ctx, next) => {
    console.log('[Subscriber][global mw] received event', ctx.eventName);
    return next();
  });

  // per-handler middleware + handler
  subscriber.on(
    'user.created',
    async (message, ctx, next) => {
      console.log('[Subscriber][per-handler mw] before handler, headers=', ctx.headers);
      return next();
    },
    async (data) => {
      console.log('[Subscriber][handler] user.created payload:', data);
    }
  );

  await subscriber.start();

  // publish an event
  await publisher.publish('user.created', { userId: 'u1', email: 'u1@example.com' });

  // Example: per-publish middleware that can short-circuit (sampling)
  await publisher.publish(
    'user.created',
    { userId: 'u2', email: 'u2@example.com' },
    [
      async (msg, ctx, next) => {
        const sample = Math.random() > 0.5;
        if (!sample) {
          console.log('[per-publish mw] dropping event due to sampling');
          return; // short-circuit, do not call next() => event not published
        }
        return next();
      },
    ]
  );

  // Example: publisher middleware that observes after publish
  publisher.use(async (message, ctx, next) => {
    const start = Date.now();
    await next();
    console.log('[Publisher][middleware] published', ctx.routingKey, 'in', Date.now() - start, 'ms');
  });

  console.log('Example published event.');
};

main().catch(console.error);
