// Advanced RPC Server Example
const { RpcServer, ConsoleLogger, JsonSerializer } = require('../dist');

const main = async () => {
  const server = new RpcServer({
    connection: {
      url: 'amqp://localhost',
      reconnect: true,
      reconnectInterval: 1000,
      maxReconnectAttempts: 10,
      heartbeat: 60,
      logger: new ConsoleLogger(),
    },
    queueName: 'calculator',
    prefetch: 5,
    serializer: new JsonSerializer(),
    logger: new ConsoleLogger(),
    assertQueue: true,
    queueOptions: { durable: true, autoDelete: false },
  });

  server.registerHandler('ADD', ({ a, b }, meta) => {
    console.log('Meta:', meta);
    return { sum: a + b };
  });

  await server.start();
  console.log('Advanced RPC Server started.');
};

main().catch(console.error);
