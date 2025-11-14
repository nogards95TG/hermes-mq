import { Middleware, Handler } from './types';

export const isMiddleware = (fn: any): fn is Middleware => {
  // Middleware has 3 parameters: message, context, next
  return typeof fn === 'function' && fn.length >= 3;
};

export const isHandler = (fn: any): fn is Handler => {
  // Handler has max 2 parameters: message, context
  return typeof fn === 'function' && fn.length <= 2;
};
