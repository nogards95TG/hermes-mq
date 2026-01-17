import { Message } from 'amqplib';
import { MockMessageContent } from './types';


// Helper to create a mock AMQP message
export const createMockMessage = (content: MockMessageContent, messageId?: string): Message => {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  return {
    content: Buffer.from(contentStr),
    properties: {
      messageId,
      contentType: 'application/json',
    },
    fields: {
      deliveryTag: 1,
      redelivered: false,
      exchange: 'test',
      routingKey: 'test.key',
    },
  } as Message;
};
