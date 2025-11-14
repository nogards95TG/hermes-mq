const { RpcServer, RpcClient } = require('../dist');

const startServer = async () => {
  const server = new RpcServer({
    connection: { url: 'amqp://localhost' },
    queueName: 'examples_rpc',
  });

  // global middleware on the server
  server.use(async (message, ctx, next) => {
    console.log('[RpcServer][global mw] method=', ctx.method);
    // you could validate auth here, add ctx.user, etc.
    return next();
  });

  // register handler with per-handler middleware
  server.registerHandler(
    'ECHO',
    async (message, ctx, next) => {
      console.log('[RpcServer][per-handler mw] incoming payload=', message);
      return next();
    },
    async (data, metadata) => {
      // legacy-style handler signature: (data, metadata)
      return { echoed: data, receivedMetadata: metadata };
    }
  );

  await server.start();
  console.log('RPC server started');
};

const startClient = async () => {
  const client = new RpcClient({
    connection: { url: 'amqp://localhost' },
    queueName: 'examples_rpc',
    timeout: 5000,
  });

  // Example: global client middleware to time RPC requests
  client.use(async (message, ctx, next) => {
    const start = Date.now();
    try {
      const res = await next();
      console.log('[RpcClient][global mw] response time', Date.now() - start, 'ms');
      return res;
    } catch (err) {
      console.log('[RpcClient][global mw] request error after', Date.now() - start, 'ms');
      throw err;
    }
  });

  // per-request middleware
  const requestMiddlewares = [
    async (message, ctx, next) => {
      ctx.headers = { ...(ctx.headers || {}), 'x-client': 'example' };
      console.log('[RpcClient][per-request mw] set header');
      return next();
    },
  ];

  const res = await client.send('ECHO', { hello: 'world' }, { middlewares: requestMiddlewares });
  console.log('Client received response:', res);
};

startServer().catch(console.error);
setTimeout(() => startClient().catch(console.error), 500);
