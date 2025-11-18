// Basic Pub/Sub Publisher Example
const { Publisher } = require('../dist');

const main = async () => {
  const publisher = new Publisher({
    connection: { url: 'amqp://localhost' },
    exchange: 'events',
  });

  await publisher.publish('user.created', { userId: '123', name: 'Alice' });
  console.log('Event published!');

  await publisher.close();
};

main().catch(console.error);
