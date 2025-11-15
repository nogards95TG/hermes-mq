const { Publisher, Subscriber } = require('../dist');

const main = async () => {
  // Publisher (no client-side middleware)
  const publisher = new Publisher({
    connection: { url: 'amqp://localhost' },
    exchange: 'events',
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
  console.log('Example published event.');
};

main().catch(console.error);
