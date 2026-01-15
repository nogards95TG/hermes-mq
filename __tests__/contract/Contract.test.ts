import { describe, it, expect } from 'vitest';
import { defineContract, v } from '../../src';

describe('Contract Definition', () => {
  it('should create a contract with serviceName', () => {
    const contract = defineContract({
      serviceName: 'users',
      commands: {
        GET_USER: {
          req: v.string().uuid(),
          res: v.string(),
        },
      },
    });

    expect(contract.serviceName).toBe('users');
    expect(contract.commands).toHaveProperty('GET_USER');
  });

  it('should create a contract with multiple commands', () => {
    const contract = defineContract({
      serviceName: 'users',
      commands: {
        GET_USER: {
          req: v.string().uuid(),
          res: v.string(),
        },
        CREATE_USER: {
          req: v.string().min(2),
          res: v.string(),
        },
        DELETE_USER: {
          req: v.string().uuid(),
          res: v.string(),
        },
      },
    });

    expect(Object.keys(contract.commands)).toHaveLength(3);
    expect(contract.commands).toHaveProperty('GET_USER');
    expect(contract.commands).toHaveProperty('CREATE_USER');
    expect(contract.commands).toHaveProperty('DELETE_USER');
  });

  it('should create a contract with number validators', () => {
    const contract = defineContract({
      serviceName: 'math',
      commands: {
        ADD: {
          req: v.number(),
          res: v.number(),
        },
        MULTIPLY: {
          req: v.number().positive(),
          res: v.number(),
        },
      },
    });

    expect(contract.commands).toHaveProperty('ADD');
    expect(contract.commands).toHaveProperty('MULTIPLY');
  });

  it('should preserve validator configuration', () => {
    const contract = defineContract({
      serviceName: 'test',
      commands: {
        TEST_CMD: {
          req: v.string().min(5).max(10),
          res: v.number().min(0).max(100),
        },
      },
    });

    // Test request validator
    const reqValidator = contract.commands.TEST_CMD.req;
    expect(reqValidator.validate('test').success).toBe(false); // too short
    expect(reqValidator.validate('valid').success).toBe(true);
    expect(reqValidator.validate('too long string').success).toBe(false);

    // Test response validator
    const resValidator = contract.commands.TEST_CMD.res;
    expect(resValidator.validate(-1).success).toBe(false);
    expect(resValidator.validate(50).success).toBe(true);
    expect(resValidator.validate(101).success).toBe(false);
  });

  it('should handle optional fields', () => {
    const contract = defineContract({
      serviceName: 'test',
      commands: {
        TEST_CMD: {
          req: v.string().optional(),
          res: v.number().optional(),
        },
      },
    });

    const reqValidator = contract.commands.TEST_CMD.req;
    expect(reqValidator.validate(undefined).success).toBe(true);
    expect(reqValidator.validate('test').success).toBe(true);

    const resValidator = contract.commands.TEST_CMD.res;
    expect(resValidator.validate(undefined).success).toBe(true);
    expect(resValidator.validate(42).success).toBe(true);
  });

  it('should validate complex command schemas', () => {
    const contract = defineContract({
      serviceName: 'complex',
      commands: {
        PROCESS: {
          req: v.string().uuid(),
          res: v.number().integer().min(0).max(1000),
        },
      },
    });

    const reqValidator = contract.commands.PROCESS.req;
    const resValidator = contract.commands.PROCESS.res;

    // Request validation
    expect(reqValidator.validate('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
    expect(reqValidator.validate('not-a-uuid').success).toBe(false);

    // Response validation
    expect(resValidator.validate(500).success).toBe(true);
    expect(resValidator.validate(500.5).success).toBe(false); // not integer
    expect(resValidator.validate(-1).success).toBe(false); // below min
    expect(resValidator.validate(1001).success).toBe(false); // above max
  });
});
