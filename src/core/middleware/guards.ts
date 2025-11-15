import { Middleware, Handler } from './types';

export const isMiddleware = (fn: any): fn is Middleware => {
  // Middleware has 3 parameters: message, context, next
  // Note: fn.length does not count rest parameters, so we parse the function signature to check for a rest parameter as the third argument.
  if (typeof fn !== 'function') return false;
  if (fn.length >= 3) return true;
  // Fallback: check for rest parameter as third argument
  const fnStr = fn.toString();
  // Match the parameter list of the function
  const match = fnStr.match(/^[\s\(]*function[^(]*\(([^)]*)\)|^\s*\(([^)]*)\)\s*=>|^([a-zA-Z0-9_$]+)\s*=>/);
  let params = '';
  if (match) {
    params = match[1] || match[2] || match[3] || '';
  }
  // Split parameters, trim whitespace
  const paramList = params.split(',').map(p => p.trim()).filter(Boolean);
  // Check if the third parameter is a rest parameter
  if (paramList[2] && paramList[2].startsWith('...')) {
    return true;
  }
  return false;
};

export const isHandler = (fn: any): fn is Handler => {
  // Handler has max 2 parameters: message, context
  return typeof fn === 'function' && fn.length <= 2;
};
