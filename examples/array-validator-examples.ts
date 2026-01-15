/**
 * Example: Array Validator - Typed vs Untyped Arrays
 *
 * This demonstrates the difference between:
 * 1. v.array() - accepts any array without item validation
 * 2. v.array(itemValidator) - validates each item in the array
 */

import { v } from '../src';

console.log('=== Array Validator Examples ===\n');

// ============================================================================
// Example 1: Any Array (no item type specified)
// ============================================================================
console.log('1. Any Array (untyped):');
const anyArray = v.array();

console.log('  ✓ Empty array:', anyArray.validate([]).success);
console.log('  ✓ Numbers:', anyArray.validate([1, 2, 3]).success);
console.log('  ✓ Strings:', anyArray.validate(['a', 'b', 'c']).success);
console.log('  ✓ Mixed types:', anyArray.validate([1, 'a', true, { key: 'value' }]).success);
console.log('  ✗ Not an array:', anyArray.validate('not array').success);
console.log();

// ============================================================================
// Example 2: Array with min/max (untyped)
// ============================================================================
console.log('2. Any Array with constraints:');
const constrainedArray = v.array().min(2).max(5);

console.log('  ✗ Too short [1]:', constrainedArray.validate([1]).success);
console.log('  ✓ Valid [1, 2]:', constrainedArray.validate([1, 2]).success);
console.log('  ✓ Valid mixed [1, "a", true]:', constrainedArray.validate([1, 'a', true]).success);
console.log('  ✗ Too long [1,2,3,4,5,6]:', constrainedArray.validate([1, 2, 3, 4, 5, 6]).success);
console.log();

// ============================================================================
// Example 3: Array of Strings (typed)
// ============================================================================
console.log('3. Array of Strings (typed):');
const stringArray = v.array(v.string());

console.log('  ✓ Valid strings:', stringArray.validate(['a', 'b', 'c']).success);
console.log('  ✗ Mixed types:', stringArray.validate(['a', 1, 'c']).success);
console.log('  ✗ Contains number:', stringArray.validate(['a', 'b', 123]).success);
console.log();

// ============================================================================
// Example 4: Array of Numbers with constraints
// ============================================================================
console.log('4. Array of Numbers (typed with constraints):');
const numberArray = v.array(v.number().min(0).max(100));

console.log('  ✓ Valid numbers:', numberArray.validate([0, 50, 100]).success);
console.log('  ✗ Negative number:', numberArray.validate([0, -5, 100]).success);
console.log('  ✗ Too large:', numberArray.validate([0, 50, 150]).success);
console.log();

// ============================================================================
// Example 5: Optional Arrays
// ============================================================================
console.log('5. Optional Arrays:');
const optionalAnyArray = v.array().optional();
const optionalStringArray = v.array(v.string()).optional();

console.log('  Any array:');
console.log('    ✓ undefined:', optionalAnyArray.validate(undefined).success);
console.log('    ✓ array:', optionalAnyArray.validate([1, 'a']).success);

console.log('  String array:');
console.log('    ✓ undefined:', optionalStringArray.validate(undefined).success);
console.log('    ✓ strings:', optionalStringArray.validate(['a', 'b']).success);
console.log('    ✗ mixed:', optionalStringArray.validate(['a', 1]).success);
console.log();

// ============================================================================
// Example 6: Real-world use cases
// ============================================================================
console.log('6. Real-world use cases:\n');

// Use case 1: API response with unknown array structure
const apiResponse = v.object({
  status: v.string(),
  data: v.array(), // Accept any array from API
  metadata: v.object({
    count: v.number(),
  }).optional(),
});

console.log('  API Response (untyped data array):');
const validResponse = {
  status: 'success',
  data: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
};
console.log('    ✓ Valid response:', apiResponse.validate(validResponse).success);
console.log();

// Use case 2: User tags (array of strings)
const userProfile = v.object({
  username: v.string(),
  tags: v.array(v.string()), // Must be strings
});

console.log('  User Profile (typed tags):');
const validProfile = {
  username: 'john_doe',
  tags: ['developer', 'nodejs', 'typescript'],
};
console.log('    ✓ Valid profile:', userProfile.validate(validProfile).success);

const invalidProfile = {
  username: 'john_doe',
  tags: ['developer', 123, 'typescript'], // Number in tags!
};
console.log('    ✗ Invalid profile (number in tags):', userProfile.validate(invalidProfile).success);
console.log();

// Use case 3: Flexible metadata
const logEntry = v.object({
  timestamp: v.string(),
  level: v.string(),
  message: v.string(),
  metadata: v.array().optional(), // Any array, optional
});

console.log('  Log Entry (flexible metadata):');
const log1 = {
  timestamp: '2026-01-15T17:00:00Z',
  level: 'info',
  message: 'User logged in',
  metadata: ['userId:123', { ip: '192.168.1.1' }], // Mixed types OK
};
console.log('    ✓ With metadata:', logEntry.validate(log1).success);

const log2 = {
  timestamp: '2026-01-15T17:00:00Z',
  level: 'info',
  message: 'User logged in',
  // No metadata
};
console.log('    ✓ Without metadata:', logEntry.validate(log2).success);
console.log();

console.log('=== Summary ===');
console.log('✓ v.array()             → Any array (no item validation)');
console.log('✓ v.array(v.string())   → Array of strings (validates each item)');
console.log('✓ v.array().min(2)      → Any array with length constraints');
console.log('✓ v.array().optional()  → Optional array (any type)');
console.log('✓ v.object()            → Any object (no field validation)');
console.log('✓ v.object({ ... })     → Object with typed fields (validates each field)');
