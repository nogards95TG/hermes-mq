export interface MessageContext {
  messageId: string;
  timestamp: Date;
  routingKey?: string; // for pub/sub
  method?: string; // for RPC
  eventName?: string; // backward compatibility for pub/sub
  headers: Record<string, any>;

  // Methods for message management (optional, populated by the system)
  reply?: (data: any) => Promise<void>; // for RPC server
  ack?: () => Promise<void>; // for consumer
  nack?: (requeue?: boolean) => Promise<void>; // for consumer

  // Extensible for custom data
  [key: string]: any;
}

export type NextFunction<T = any> = (modifiedMessage?: T) => Promise<T>;

export type Middleware<TIn = any, TOut = any> = (
  message: TIn,
  context: MessageContext,
  next: NextFunction<TOut>
) => Promise<TOut> | TOut;

export type Handler<TIn = any, TOut = any> = (
  message: TIn,
  context: MessageContext
) => Promise<TOut> | TOut;
