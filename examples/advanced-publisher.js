// Advanced Publisher Example
const { Publisher, ConsoleLogger, JsonSerializer } = require('../dist');

const main = async () => {
  const publisher = new Publisher({
    connection: {
      url: 'amqp://localhost',
      reconnect: true,
      reconnectInterval: 1000,
      maxReconnectAttempts: 5,
      heartbeat: 30,
      logger: new ConsoleLogger(),
    },
    exchange: 'events',
    exchangeType: 'topic',
    persistent: true,
    serializer: new JsonSerializer(),
    logger: new ConsoleLogger(),
    exchanges: [
      { name: 'audit', type: 'fanout' },
      { name: 'notifications', type: 'direct' }
    ]
  });

  await publisher.publish('user.updated', { userId: '123', name: 'Bob' }, {
    routingKey: 'user.profile',
    metadata: { updatedBy: 'admin' }
  });

  // Publish to multiple exchanges
  await publisher.publishToMany(['events', 'audit'], 'user.deleted', { userId: '123' });

  await publisher.close();
};

main().catch(console.error);
