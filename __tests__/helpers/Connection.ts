import type { ConfirmChannel } from 'amqplib';
import { vi } from 'vitest';
import { MockConnection } from './types';

export const createMockConnection = (): MockConnection =>
  ({
    createConfirmChannel: vi.fn(),
    on: vi.fn(),
    close: vi.fn(),
  }) as any as MockConnection;

export const createMockChannel = (): ConfirmChannel =>
  ({
    close: vi.fn().mockResolvedValue(undefined),
    checkQueue: vi.fn().mockResolvedValue({ queue: 'test', messageCount: 0, consumerCount: 0 }),
    on: vi.fn(),
    removeListener: vi.fn(),
    emit: vi.fn(),
  }) as any;
