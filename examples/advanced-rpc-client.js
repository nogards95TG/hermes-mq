// Advanced RPC Client Example
const { RpcClient, SilentLogger, JsonSerializer } = require('../dist');

const main = async () => {
  const client = new RpcClient({
    connection: {
      url: 'amqp://localhost',
      reconnect: true,
      reconnectInterval: 2000,
      maxReconnectAttempts: 5,
      heartbeat: 30,
      logger: new SilentLogger(),
    },
    queueName: 'calculator',
    timeout: 10000, // 10s timeout
    serializer: new JsonSerializer(),
    logger: new SilentLogger(),
    assertQueue: true,
    queueOptions: { durable: true, autoDelete: false }
  });

  // Send with metadata and custom timeout
  const result = await client.send('ADD', { a: 10, b: 20 }, {
    timeout: 2000,
    metadata: { traceId: 'xyz-123' }
  });
  console.log('Result:', result);

  await client.close();
};

main().catch(console.error);
