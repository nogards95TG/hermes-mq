import { Connection } from 'amqplib';
import { vi } from 'vitest';

export type MockMessageContent = string | object | Buffer | number | boolean;

export type MockConnection = Connection & { createConfirmChannel: ReturnType<typeof vi.fn> };
