import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineContract, v, createContractServer, createContractClient } from '../../src';
import { startRabbitMQ, stopRabbitMQ } from '../integration/testContainer';

describe('Contract Validation Flag', () => {
  beforeAll(async () => {
    await startRabbitMQ();
  });

  afterAll(async () => {
    await stopRabbitMQ();
  });

  const contract = defineContract({
    serviceName: 'validation_test',
    commands: {
      VALIDATE_UUID: {
        req: v.object({ id: v.string().uuid() }),
        res: v.object({ success: v.boolean() }),
      },
      VALIDATE_EMAIL: {
        req: v.object({ email: v.string().email() }),
        res: v.object({ valid: v.boolean() }),
      },
    },
  });

  describe('With validation enabled (default)', () => {
    it('should validate request and reject invalid data', async () => {
      const server = await createContractServer(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        validate: true, // explicitly enabled
      });

      server.registerHandler('VALIDATE_UUID', async () => ({ success: true }));
      await server.start();

      const client = await createContractClient(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        validate: true, // explicitly enabled
        timeout: 5000,
      });

      // Valid UUID should work
      const validResult = await client.send('VALIDATE_UUID', {
        id: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(validResult.success).toBe(true);

      // Invalid UUID should throw ValidationError
      await expect(
        client.send('VALIDATE_UUID', { id: 'not-a-uuid' } as any)
      ).rejects.toThrow('Invalid request');

      await client.close();
      await server.stop();
    });

    it('should use validation by default when flag is omitted', async () => {
      const server = await createContractServer(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        // validate flag omitted - should default to true
      });

      server.registerHandler('VALIDATE_EMAIL', async () => ({ valid: true }));
      await server.start();

      const client = await createContractClient(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        // validate flag omitted - should default to true
        timeout: 5000,
      });

      // Valid email should work
      const validResult = await client.send('VALIDATE_EMAIL', {
        email: 'test@example.com',
      });
      expect(validResult.valid).toBe(true);

      // Invalid email should throw ValidationError
      await expect(
        client.send('VALIDATE_EMAIL', { email: 'not-an-email' } as any)
      ).rejects.toThrow('Invalid request');

      await client.close();
      await server.stop();
    });
  });

  describe('With validation disabled', () => {
    it('should skip validation and allow any data (TypeScript only)', async () => {
      const server = await createContractServer(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        validate: false, // disable validation
      });

      let receivedData: any;
      server.registerHandler('VALIDATE_UUID', async (request) => {
        receivedData = request;
        return { success: true };
      });
      await server.start();

      const client = await createContractClient(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        validate: false, // disable validation
        timeout: 5000,
      });

      // Valid UUID should work
      const validResult = await client.send('VALIDATE_UUID', {
        id: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(validResult.success).toBe(true);
      expect(receivedData.id).toBe('550e8400-e29b-41d4-a716-446655440000');

      // Invalid UUID should also work (no validation)
      const invalidResult = await client.send('VALIDATE_UUID', {
        id: 'not-a-uuid',
      } as any);
      expect(invalidResult.success).toBe(true);
      expect(receivedData.id).toBe('not-a-uuid'); // Invalid data passed through

      await client.close();
      await server.stop();
    });

    it('should maintain TypeScript type safety even without runtime validation', async () => {
      const server = await createContractServer(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        validate: false,
      });

      server.registerHandler('VALIDATE_EMAIL', async (request) => {
        // TypeScript knows request.email is string
        expect(typeof request.email).toBe('string');
        return { valid: true };
      });
      await server.start();

      const client = await createContractClient(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        validate: false,
        timeout: 5000,
      });

      // TypeScript autocomplete still works
      const result = await client.send('VALIDATE_EMAIL', {
        email: 'any-string', // TypeScript ensures it's a string at compile time
      });

      expect(result.valid).toBe(true);

      await client.close();
      await server.stop();
    });
  });

  describe('Mixed validation (client validates, server does not)', () => {
    it('should allow different validation settings on client and server', async () => {
      const server = await createContractServer(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        queueName: 'mixed_validation',
        validate: false, // Server: no validation
      });

      server.registerHandler('VALIDATE_UUID', async () => ({ success: true }));
      await server.start();

      const client = await createContractClient(contract, {
        connection: { url: process.env.RABBITMQ_URL || 'amqp://localhost' },
        queueName: 'mixed_validation',
        validate: true, // Client: validates
        timeout: 5000,
      });

      // Client should reject invalid data before sending
      await expect(
        client.send('VALIDATE_UUID', { id: 'not-a-uuid' } as any)
      ).rejects.toThrow('Invalid request');

      await client.close();
      await server.stop();
    });
  });
});
