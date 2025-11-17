// Basic RPC Server Example
const { RpcServer } = require('../dist');

const main = async () => {
  const server = new RpcServer({
    connection: { url: 'amqp://localhost' },
    queueName: 'calculator',
  });

  server.registerHandler('ADD', ({ a, b }) => ({ sum: a + b }));

  await server.start();
  console.log('RPC Server started. Listening for requests...');
};

main().catch(console.error);
