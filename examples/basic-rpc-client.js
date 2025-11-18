// Basic RPC Client Example
const { RpcClient } = require('../dist');

const main = async () => {
  const client = new RpcClient({
    connection: { url: 'amqp://localhost' },
    queueName: 'calculator',
  });

  const result = await client.send('ADD', { a: 2, b: 3 });
  console.log('Result:', result); // { sum: 5 }

  await client.close();
};

main().catch(console.error);
