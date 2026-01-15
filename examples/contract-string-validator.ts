/**
 * Example: String Validator with Type Inference
 *
 * This file demonstrates how the string validator works with TypeScript type inference.
 * Run `npx tsx examples/contract-string-validator.ts` to see it in action.
 */

import { v } from '../src/core/contract/validators';

// Example 1: Required string
const requiredString = v.string();

const result1 = requiredString.validate('hello');
if (result1.success) {
  // ✅ Type: string
  console.log('Required string:', result1.data);
}

const result2 = requiredString.validate(undefined);
if (!result2.success) {
  // ❌ Error: Field is required
  console.log('Required string error:', result2.errors?.[0].message);
}

// Example 2: Optional string
const optionalString = v.string().optional();

const result3 = optionalString.validate(undefined);
if (result3.success) {
  // ✅ Type: string | undefined
  console.log('Optional string (undefined):', result3.data);
}

const result4 = optionalString.validate('world');
if (result4.success) {
  // ✅ Type: string | undefined
  console.log('Optional string (value):', result4.data);
}

// Example 3: String with length constraints
const nameValidator = v.string().min(2).max(50);

const result5 = nameValidator.validate('John Doe');
if (result5.success) {
  console.log('Valid name:', result5.data);
}

const result6 = nameValidator.validate('J');
if (!result6.success) {
  console.log('Invalid name (too short):', result6.errors?.[0].message);
}

// Example 4: Email validation
const emailValidator = v.string().email();

const result7 = emailValidator.validate('user@example.com');
if (result7.success) {
  console.log('Valid email:', result7.data);
}

const result8 = emailValidator.validate('not-an-email');
if (!result8.success) {
  console.log('Invalid email:', result8.errors?.[0].message);
}

// Example 5: UUID validation
const idValidator = v.string().uuid();

const result9 = idValidator.validate('550e8400-e29b-41d4-a716-446655440000');
if (result9.success) {
  console.log('Valid UUID:', result9.data);
}

const result10 = idValidator.validate('not-a-uuid');
if (!result10.success) {
  console.log('Invalid UUID:', result10.errors?.[0].message);
}

// Example 6: MongoDB ObjectId validation
const mongoIdValidator = v.string().mongoId();

const result11 = mongoIdValidator.validate('507f1f77bcf86cd799439011');
if (result11.success) {
  console.log('Valid MongoDB ObjectId:', result11.data);
}

const result12 = mongoIdValidator.validate('invalid-id');
if (!result12.success) {
  console.log('Invalid MongoDB ObjectId:', result12.errors?.[0].message);
}

// Example 7: Chaining validators
const usernameValidator = v.string().min(3).max(20).optional();

const result13 = usernameValidator.validate('john_doe');
if (result13.success) {
  console.log('Valid username:', result13.data);
}

const result14 = usernameValidator.validate(undefined);
if (result14.success) {
  console.log('Optional username (undefined):', result14.data);
}

const result15 = usernameValidator.validate('ab');
if (!result15.success) {
  console.log('Invalid username (too short):', result15.errors?.[0].message);
}

// Example 8: Required after optional
const flexibleValidator = v.string().optional().required();

const result16 = flexibleValidator.validate('value');
if (result16.success) {
  console.log('Flexible validator (with value):', result16.data);
}

const result17 = flexibleValidator.validate(undefined);
if (!result17.success) {
  console.log('Flexible validator (undefined):', result17.errors?.[0].message);
}
