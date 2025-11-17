// Basic Pub/Sub Subscriber Example
const { Subscriber } = require('../dist');

const main = async () => {
  const subscriber = new Subscriber({
    connection: { url: 'amqp://localhost' },
    exchange: 'events',
  });

  subscriber.on('user.created', (data) => {
    console.log('User created event received:', data);
  });

  await subscriber.start();
  console.log('Subscriber started. Waiting for events...');
};

main().catch(console.error);
