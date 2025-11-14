import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { beforeAll, afterAll } from 'vitest';

/**
 * Test container configuration
 */
interface TestContainerResult {
  url: string;
  managementUrl: string;
  container: StartedTestContainer;
}

/**
 * Setup result for RabbitMQ suite
 */
interface SetupRabbitMQSuiteResult {
  getUrl: () => string;
  getManagementUrl: () => string;
  getContainer: () => StartedTestContainer;
}

/**
 * Test function with RabbitMQ container
 * @param url AMQP connection URL
 * @param managementUrl Management UI URL
 */
interface TestFn<T> {
  (url: string, managementUrl: string): Promise<T>;
}

/**
 * Setup RabbitMQ container for testing
 * Returns a container instance that can be stopped manually
 */
export const createRabbitMQContainer = async (): Promise<TestContainerResult> => {
  console.log('🐳 Starting RabbitMQ container...');

  const container = await new GenericContainer('rabbitmq:3.13-management-alpine')
    .withExposedPorts(5672, 15672)
    .withEnvironment({
      RABBITMQ_DEFAULT_USER: 'guest',
      RABBITMQ_DEFAULT_PASS: 'guest',
    })
    .withWaitStrategy(Wait.forLogMessage(/.*Server startup complete.*/))
    .withStartupTimeout(120000)
    .start();

  const host = container.getHost();
  const amqpPort = container.getMappedPort(5672);
  const mgmtPort = container.getMappedPort(15672);

  const url = `amqp://guest:guest@${host}:${amqpPort}`;
  const managementUrl = `http://${host}:${mgmtPort}`;

  console.log(`✅ RabbitMQ started at ${url}`);
  console.log(`   Management UI: ${managementUrl}`);

  return {
    url,
    managementUrl,
    container,
  };
};

/**
 * Helper for setting up RabbitMQ in a test suite
 * Starts container before all tests and stops after all tests
 */
export const setupRabbitMQSuite = (): SetupRabbitMQSuiteResult => {
  let containerResult: TestContainerResult | null = null;

  beforeAll(async () => {
    containerResult = await createRabbitMQContainer();
  }, 120000);

  afterAll(async () => {
    if (containerResult?.container) {
      console.log('🛑 Stopping RabbitMQ container...');
      await containerResult.container.stop();
      console.log('✅ Container stopped');
    }
  }, 30000);

  return {
    getUrl: () => {
      if (!containerResult) {
        throw new Error('Container not started. Call setupRabbitMQSuite in beforeAll');
      }
      return containerResult.url;
    },
    getManagementUrl: () => {
      if (!containerResult) {
        throw new Error('Container not started. Call setupRabbitMQSuite in beforeAll');
      }
      return containerResult.managementUrl;
    },
    getContainer: () => {
      if (!containerResult) {
        throw new Error('Container not started. Call setupRabbitMQSuite in beforeAll');
      }
      return containerResult.container;
    },
  };
};

/**
 * Run a test with an isolated RabbitMQ container
 * Container is started before the test and stopped after
 */
export const withRabbitMQ = async <T>(testFn: TestFn<T>): Promise<T> => {
  const { url, managementUrl, container } = await createRabbitMQContainer();

  try {
    return await testFn(url, managementUrl);
  } finally {
    console.log('🛑 Stopping RabbitMQ container...');
    await container.stop();
    console.log('✅ Container stopped');
  }
};
