PRD: Middleware System per Hermes MQ
📋 Panoramica
Obiettivo
Implementare un sistema di middleware Express-style per Hermes MQ che permetta di processare messaggi attraverso una pipeline di funzioni prima di raggiungere l'handler finale. Il sistema deve essere consistente tra tutti i pattern (RPC Server/Client, Publisher/Subscriber).
Scope

✅ Core middleware system (types, compose, chain execution)
✅ Integrazione in RpcServer, RpcClient, Publisher, Subscriber
✅ Support per middleware globali e per-handler
❌ Middleware built-in (saranno aggiunti in futuro)
❌ Schema validation middleware (sarà aggiunto in futuro)

🏗️ Architettura
Core Types
typescript// src/core/middleware/types.ts

export interface MessageContext {
messageId: string;
timestamp: Date;
routingKey?: string; // per pub/sub
method?: string; // per RPC
headers: Record<string, any>;

// Metodi per gestione messaggio (opzionali, popolati dal sistema)
reply?: (data: any) => Promise<void>; // per RPC server
ack?: () => Promise<void>; // per consumer
nack?: (requeue?: boolean) => Promise<void>; // per consumer

// Extensibile per dati custom
[key: string]: any;
}

export type NextFunction<T = any> = () => Promise<T>;

export type Middleware<TIn = any, TOut = any> = (
message: TIn,
context: MessageContext,
next: NextFunction<TOut>
) => Promise<TOut> | TOut;

export type Handler<TIn = any, TOut = any> = (
message: TIn,
context: MessageContext
) => Promise<TOut> | TOut;
Compose Function
typescript// src/core/middleware/compose.ts

import { Middleware, Handler, MessageContext } from './types';

/\*\*

- Compone multiple middleware e un handler finale in una singola funzione
-
- @param fns Array di middleware seguito da un handler finale
- @returns Handler componibile
-
- @example
- const composed = compose(
- middleware1,
- middleware2,
- handler
- );
  \*/
  export function compose<T = any>(...fns: [...Middleware[], Handler]): Handler<T>;
  Type Guards
  typescript// src/core/middleware/guards.ts

export function isMiddleware(fn: any): fn is Middleware {
// Middleware ha 3 parametri: message, context, next
return fn.length >= 3;
}

export function isHandler(fn: any): fn is Handler {
// Handler ha max 2 parametri: message, context
return fn.length <= 2;
}
📦 Integrazione nelle Classi Esistenti
RpcServer
typescript// src/server/RpcServer.ts

export class RpcServer {
private globalMiddlewares: Middleware[] = [];
private handlers = new Map<string, Handler>();

/\*\*

- Aggiunge uno o più middleware globali che verranno eseguiti per ogni handler
-
- @example
- server.use(middleware1)
- server.use(middleware1, middleware2, middleware3)
  \*/
  use(...middlewares: Middleware[]): this {
  this.globalMiddlewares.push(...middlewares);
  return this;
  }

/\*\*

- Registra un handler con middleware opzionali
- Supporta multiple signature per flessibilità
-
- @example
- // Solo handler
- server.registerHandler('GET_USER', handler)
-
- // Handler con middleware
- server.registerHandler('GET_USER', middleware1, middleware2, handler)
  \*/
  registerHandler(
  method: string,
  ...stack: [...Middleware[], Handler] | [Handler]
  ): this {
  // Validazione: almeno un elemento e l'ultimo deve essere un handler
  if (stack.length === 0) {
  throw new Error('At least one handler is required');
  }

  const lastFn = stack[stack.length - 1];
  if (!isHandler(lastFn)) {
  throw new Error('Last argument must be a handler (function with max 2 parameters)');
  }

  // Combina: global middlewares + handler-specific stack
  const fullStack = [...this.globalMiddlewares, ...stack] as [...Middleware[], Handler];
  const composed = compose(...fullStack);

  this.handlers.set(method, composed);
  return this;

}

// Modifica del metodo interno di processing
private async processMessage(method: string, data: any, originalMessage: Message): Promise<any> {
const handler = this.handlers.get(method);
if (!handler) {
throw new Error(`No handler registered for method: ${method}`);
}

    // Crea il context
    const context: MessageContext = {
      messageId: originalMessage.properties.messageId || generateId(),
      timestamp: new Date(originalMessage.properties.timestamp || Date.now()),
      method,
      headers: originalMessage.properties.headers || {},
      reply: async (response) => {
        // Implementazione esistente del reply
      },
      ack: async () => {
        // Implementazione esistente dell'ack
      },
      nack: async (requeue = true) => {
        // Implementazione esistente del nack
      }
    };

    // Esegue handler (che ora include tutti i middleware)
    return handler(data, context);

}
}
RpcClient
typescript// src/client/RpcClient.ts

export class RpcClient {
private globalMiddlewares: Middleware[] = [];

use(...middlewares: Middleware[]): this {
this.globalMiddlewares.push(...middlewares);
return this;
}

/\*\*

- Invia una richiesta RPC con middleware opzionali
-
- @example
- // Senza middleware aggiuntivi
- await client.send('GET_USER', { id: '123' })
-
- // Con middleware per questa specifica chiamata
- await client.send('GET_USER', { id: '123' }, middleware1, middleware2)
  \*/
  async send<TRequest = any, TResponse = any>(
  method: string,
  data: TRequest,
  ...middlewares: Middleware[]
  ): Promise<TResponse> {
  // Handler finale che fa l'invio effettivo
  const sendHandler: Handler = async (message, context) => {
  // Logica esistente di invio messaggio RPC
  return this.\_performRpcCall(method, message);
  };

  // Compone middleware globali + specifici + handler
  const stack = [...this.globalMiddlewares, ...middlewares, sendHandler] as [...Middleware[], Handler];
  const composed = compose(...stack);

  // Crea context
  const context: MessageContext = {
  messageId: generateId(),
  timestamp: new Date(),
  method,
  headers: {}
  };

  return composed(data, context);

}
}
Publisher
typescript// src/client/Publisher.ts

export class Publisher {
private globalMiddlewares: Middleware[] = [];

use(...middlewares: Middleware[]): this {
this.globalMiddlewares.push(...middlewares);
return this;
}

/\*\*

- Pubblica un messaggio con middleware opzionali
-
- @example
- await publisher.publish('user.created', userData)
- await publisher.publish('user.created', userData, middleware1, middleware2)
  \*/
  async publish(
  routingKey: string,
  data: any,
  ...middlewares: Middleware[]
  ): Promise<void> {
  const publishHandler: Handler = async (message, context) => {
  // Logica esistente di pubblicazione
  await this.channel.publish(
  this.exchange,
  routingKey,
  Buffer.from(JSON.stringify(message)),
  {
  messageId: context.messageId,
  timestamp: context.timestamp.getTime(),
  headers: context.headers
  }
  );
  };

  const stack = [...this.globalMiddlewares, ...middlewares, publishHandler] as [...Middleware[], Handler];
  const composed = compose(...stack);

  const context: MessageContext = {
  messageId: generateId(),
  timestamp: new Date(),
  routingKey,
  headers: {}
  };

  return composed(data, context);

}
}
Subscriber
typescript// src/server/Subscriber.ts

export class Subscriber {
private globalMiddlewares: Middleware[] = [];
private listeners = new Map<string, Handler[]>();

use(...middlewares: Middleware[]): this {
this.globalMiddlewares.push(...middlewares);
return this;
}

/\*\*

- Registra un listener con middleware opzionali
-
- @example
- subscriber.on('user.created', handler)
- subscriber.on('user.created', middleware1, middleware2, handler)
  \*/
  on(
  pattern: string,
  ...stack: [...Middleware[], Handler] | [Handler]
  ): this {
  // Validazione
  if (stack.length === 0) {
  throw new Error('At least one handler is required');
  }

  const lastFn = stack[stack.length - 1];
  if (!isHandler(lastFn)) {
  throw new Error('Last argument must be a handler');
  }

  // Combina middleware
  const fullStack = [...this.globalMiddlewares, ...stack] as [...Middleware[], Handler];
  const composed = compose(...fullStack);

  // Aggiungi a listeners
  const listeners = this.listeners.get(pattern) || [];
  listeners.push(composed);
  this.listeners.set(pattern, listeners);

  return this;

}

// Modifica del metodo interno di processing
private async processMessage(routingKey: string, data: any, originalMessage: Message): Promise<void> {
// Trova tutti i listener che matchano il pattern
const matchingListeners = this.findMatchingListeners(routingKey);

    const context: MessageContext = {
      messageId: originalMessage.properties.messageId || generateId(),
      timestamp: new Date(originalMessage.properties.timestamp || Date.now()),
      routingKey,
      headers: originalMessage.properties.headers || {},
      ack: async () => originalMessage.ack(),
      nack: async (requeue = true) => originalMessage.nack(requeue)
    };

    // Esegui tutti i listener
    await Promise.all(
      matchingListeners.map(handler => handler(data, context))
    );

}
}
🧪 Testing Requirements
Unit Tests
typescript// **tests**/core/middleware/compose.test.ts

describe('compose', () => {
it('should execute middlewares in order', async () => {
const order: number[] = [];

    const middleware1: Middleware = async (msg, ctx, next) => {
      order.push(1);
      const result = await next();
      order.push(4);
      return result;
    };

    const middleware2: Middleware = async (msg, ctx, next) => {
      order.push(2);
      const result = await next();
      order.push(3);
      return result;
    };

    const handler: Handler = async (msg, ctx) => {
      order.push(3);
      return 'done';
    };

    const composed = compose(middleware1, middleware2, handler);
    const result = await composed('test', {} as MessageContext);

    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(result).toBe('done');

});

it('should handle errors in middleware', async () => {
const middleware: Middleware = async (msg, ctx, next) => {
throw new Error('Middleware error');
};

    const handler: Handler = async () => 'success';

    const composed = compose(middleware, handler);

    await expect(composed('test', {} as MessageContext))
      .rejects.toThrow('Middleware error');

});

it('should pass modified message through middleware chain', async () => {
const transformer: Middleware = async (msg, ctx, next) => {
const modified = { ...msg, transformed: true };
return next.call(null, modified);
};

    const handler: Handler = async (msg) => msg;

    const composed = compose(transformer, handler);
    const result = await composed({ value: 1 }, {} as MessageContext);

    expect(result).toEqual({ value: 1, transformed: true });

});

it('should detect and reject if no handler provided', () => {
const middleware1: Middleware = async (msg, ctx, next) => next();
const middleware2: Middleware = async (msg, ctx, next) => next();

    expect(() => compose(middleware1, middleware2))
      .toThrow('Last argument must be a handler');

});
});
Integration Tests
typescript// **tests**/integration/middleware.test.ts

describe('Middleware Integration', () => {
describe('RpcServer with middleware', () => {
it('should apply global middleware to all handlers', async () => {
const server = new RpcServer({ /_ config _/ });
const logs: string[] = [];

      const loggingMiddleware: Middleware = async (msg, ctx, next) => {
        logs.push(`before ${ctx.method}`);
        const result = await next();
        logs.push(`after ${ctx.method}`);
        return result;
      };

      server.use(loggingMiddleware);

      server.registerHandler('METHOD1', async () => 'result1');
      server.registerHandler('METHOD2', async () => 'result2');

      // Simula chiamate
      await server.processMessage('METHOD1', {});
      await server.processMessage('METHOD2', {});

      expect(logs).toEqual([
        'before METHOD1',
        'after METHOD1',
        'before METHOD2',
        'after METHOD2'
      ]);
    });

    it('should apply handler-specific middleware', async () => {
      const server = new RpcServer({ /* config */ });

      const middleware1: Middleware = async (msg, ctx, next) => {
        const result = await next();
        return { ...result, middleware1: true };
      };

      const middleware2: Middleware = async (msg, ctx, next) => {
        const result = await next();
        return { ...result, middleware2: true };
      };

      server.registerHandler(
        'TEST',
        middleware1,
        middleware2,
        async () => ({ base: true })
      );

      const result = await server.processMessage('TEST', {});

      expect(result).toEqual({
        base: true,
        middleware1: true,
        middleware2: true
      });
    });

});

// Test simili per RpcClient, Publisher, Subscriber
});
📐 Criteri di Accettazione

Compose Function

✅ Deve comporre N middleware + 1 handler in una singola funzione
✅ Deve eseguire middleware nell'ordine corretto (onion model)
✅ Deve propagare errori correttamente
✅ Deve permettere a middleware di modificare il messaggio
✅ Deve validare che l'ultimo argomento sia un handler

Integrazione Classes

✅ Tutte le classi (RpcServer, RpcClient, Publisher, Subscriber) devono avere metodo use()
✅ Middleware globali devono essere applicati a tutti gli handler/operazioni
✅ Deve supportare middleware per-handler/operazione
✅ L'ordine deve essere: global middlewares → specific middlewares → handler

MessageContext

✅ Deve contenere metadata del messaggio (messageId, timestamp, etc.)
✅ Deve essere estensibile per dati custom
✅ Deve fornire metodi helper dove appropriato (ack, nack, reply)

Type Safety

✅ TypeScript deve inferire correttamente i tipi
✅ Deve fornire error messages chiari per uso scorretto
✅ Generics devono fluire attraverso la chain

Backward Compatibility

✅ API esistenti devono continuare a funzionare
✅ registerHandler(method, handler) deve ancora funzionare
✅ Non deve rompere test esistenti

🚀 Implementazione Step-by-Step

Phase 1: Implementa core types e compose function
Phase 2: Aggiungi type guards e validazione
Phase 3: Integra in RpcServer con test
Phase 4: Integra in RpcClient con test
Phase 5: Integra in Publisher con test
Phase 6: Integra in Subscriber con test
Phase 7: Update documentazione ed esempi

📊 Metriche di Successo

Zero breaking changes nelle API esistenti
100% code coverage per il nuovo codice
Tutti i test esistenti devono ancora passare
Performance: overhead middleware < 1ms per chiamata
Type inference funziona senza annotazioni esplicite

❌ Out of Scope

Implementazione di middleware built-in (logger, retry, timeout, etc.)
Schema validation middleware
Middleware async storage context
Middleware per batching
GUI o tools per debug middleware

Questi saranno implementati in PR separate dopo che il sistema core è stabile.RiprovaClaude può commettere errori. Verifica sempre le risposte con attenzione.
