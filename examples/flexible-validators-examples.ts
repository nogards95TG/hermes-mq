/**
 * Example: Flexible Validators - Generic Objects and Arrays
 *
 * This demonstrates when to use generic validators (v.object(), v.array())
 * vs typed validators (v.object({ schema }), v.array(itemValidator))
 */

import { v } from '../src';

console.log('=== Flexible Validators Examples ===\n');

// ============================================================================
// Example 1: Generic Object (no schema)
// ============================================================================
console.log('1. Generic Object (v.object()):');
const anyObject = v.object();

console.log('  ✓ Empty object:', anyObject.validate({}).success);
console.log('  ✓ User object:', anyObject.validate({ name: 'John', age: 30 }).success);
console.log('  ✓ Config object:', anyObject.validate({ api: 'https://api.com', timeout: 5000 }).success);
console.log('  ✓ Nested data:', anyObject.validate({ user: { profile: { name: 'John' } } }).success);
console.log('  ✗ Not an object:', anyObject.validate('string').success);
console.log('  ✗ Array:', anyObject.validate([1, 2, 3]).success);
console.log();

// ============================================================================
// Example 2: Typed Object vs Generic Object
// ============================================================================
console.log('2. Typed vs Generic Object:\n');

// Typed - validates specific fields
const typedUser = v.object({
  name: v.string().min(2),
  email: v.string().email(),
});

console.log('  Typed object:');
console.log('    ✓ Valid user:', typedUser.validate({ name: 'John', email: 'john@test.com' }).success);
console.log('    ✗ Missing email:', typedUser.validate({ name: 'John' }).success);
console.log('    ✗ Invalid email:', typedUser.validate({ name: 'John', email: 'invalid' }).success);

// Generic - accepts any object structure
const genericUser = v.object();

console.log('  Generic object:');
console.log('    ✓ Valid user:', genericUser.validate({ name: 'John', email: 'john@test.com' }).success);
console.log('    ✓ Missing email:', genericUser.validate({ name: 'John' }).success);
console.log('    ✓ Invalid email:', genericUser.validate({ name: 'John', email: 'invalid' }).success);
console.log('    ✓ Extra fields:', genericUser.validate({ name: 'John', extra: 'data' }).success);
console.log();

// ============================================================================
// Example 3: Real-World Use Cases
// ============================================================================
console.log('3. Real-World Use Cases:\n');

// Use case 1: API with flexible metadata
const apiRequest = v.object({
  endpoint: v.string(),
  method: v.string(),
  metadata: v.object().optional(), // Any metadata structure
});

console.log('  API Request with flexible metadata:');
const req1 = {
  endpoint: '/users',
  method: 'GET',
  metadata: { userId: 123, traceId: 'abc' },
};
console.log('    ✓ With metadata:', apiRequest.validate(req1).success);

const req2 = {
  endpoint: '/users',
  method: 'GET',
  // No metadata
};
console.log('    ✓ Without metadata:', apiRequest.validate(req2).success);
console.log();

// Use case 2: Event with flexible payload
const eventSchema = v.object({
  eventType: v.string(),
  timestamp: v.number(),
  payload: v.object(), // Any payload structure
});

console.log('  Event with flexible payload:');
const event1 = {
  eventType: 'user.created',
  timestamp: Date.now(),
  payload: { userId: '123', name: 'John' },
};
console.log('    ✓ User created:', eventSchema.validate(event1).success);

const event2 = {
  eventType: 'payment.processed',
  timestamp: Date.now(),
  payload: { orderId: 'ord_123', amount: 99.99, currency: 'USD' },
};
console.log('    ✓ Payment processed:', eventSchema.validate(event2).success);
console.log();

// Use case 3: Configuration with typed and flexible parts
const configSchema = v.object({
  appName: v.string().min(2),
  port: v.number().min(1).max(65535),
  database: v.object({
    host: v.string(),
    port: v.number(),
    name: v.string(),
  }),
  features: v.object(), // Flexible feature flags
  customSettings: v.object().optional(), // Optional custom settings
});

console.log('  Configuration (typed + flexible):');
const config = {
  appName: 'MyApp',
  port: 3000,
  database: {
    host: 'localhost',
    port: 5432,
    name: 'mydb',
  },
  features: {
    enableAuth: true,
    enableCache: false,
    enableLogs: true,
  },
  customSettings: {
    theme: 'dark',
    language: 'en',
    customFeatureX: { enabled: true, config: { key: 'value' } },
  },
};
console.log('    ✓ Full config:', configSchema.validate(config).success);
console.log();

// Use case 4: Mixed array and object flexibility
const logSchema = v.object({
  level: v.string(),
  message: v.string(),
  tags: v.array(), // Any array
  context: v.object().optional(), // Any object
});

console.log('  Log Entry (flexible tags and context):');
const log = {
  level: 'info',
  message: 'User logged in',
  tags: ['auth', 'success', 123, { custom: 'tag' }], // Mixed types OK
  context: {
    userId: '123',
    ip: '192.168.1.1',
    customData: { anything: 'goes' },
  },
};
console.log('    ✓ Flexible log:', logSchema.validate(log).success);
console.log();

// ============================================================================
// Example 4: When to use what
// ============================================================================
console.log('4. Decision Guide:\n');

console.log('  Use v.object() when:');
console.log('    • API returns unknown/dynamic structure');
console.log('    • Flexible metadata or context fields');
console.log('    • Feature flags with unknown keys');
console.log('    • Plugin configurations');
console.log('    • You only care that it\'s an object');
console.log();

console.log('  Use v.object({ schema }) when:');
console.log('    • You know the exact structure');
console.log('    • You need field-level validation');
console.log('    • You want type safety');
console.log('    • Critical business data');
console.log();

console.log('  Use v.array() when:');
console.log('    • API returns unknown array content');
console.log('    • Mixed-type arrays acceptable');
console.log('    • You only care about array length');
console.log('    • Flexible metadata lists');
console.log();

console.log('  Use v.array(itemValidator) when:');
console.log('    • You know the item type');
console.log('    • You need item-level validation');
console.log('    • Homogeneous arrays expected');
console.log('    • Type safety is important');
console.log();

console.log('=== Best Practice ===');
console.log('✓ Start with typed validators (v.object({ schema }), v.array(v.string()))');
console.log('✓ Use generic validators (v.object(), v.array()) only when truly needed');
console.log('✓ This provides maximum type safety while maintaining flexibility');
