// Advanced Subscriber Example
const { Subscriber, ConsoleLogger, JsonSerializer } = require('../dist');

const main = async () => {
  const subscriber = new Subscriber({
    connection: {
      url: 'amqp://localhost',
      reconnect: true,
      reconnectInterval: 2000,
      maxReconnectAttempts: 5,
      heartbeat: 30,
      logger: new ConsoleLogger(),
    },
    exchange: 'events',
    exchangeType: 'topic',
    exchangeOptions: { durable: true, autoDelete: false },
    queueName: 'user-events',
    queueOptions: { durable: true, exclusive: false, autoDelete: false },
    prefetch: 20,
    serializer: new JsonSerializer(),
    logger: new ConsoleLogger(),
  });

  subscriber.on('user.*', (data, ctx) => {
    console.log('Wildcard event:', ctx.eventName, data);
  });

  subscriber.on('user.deleted', (data, ctx) => {
    console.log('User deleted:', data, ctx);
  });

  await subscriber.start();
  console.log('Advanced Subscriber started.');
};

main().catch(console.error);
