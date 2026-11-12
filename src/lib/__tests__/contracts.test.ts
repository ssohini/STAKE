import { describe, expect, it } from 'vitest';
import { buildNewContract, validateCreateContractInput } from '../contracts';

describe('contract creation & stake amount validation', () => {
  it('accepts valid contract inputs and normalizes cents cleanly', () => {
    const res = validateCreateContractInput({
      goal: 'Run 5km outdoors',
      beneficiary: 'EFF',
      stakeUsd: 12.5,
      durationMinutes: 30,
    });
    expect(res.valid).toBe(true);
    if (res.valid) {
      const c = buildNewContract(res.data, new Date('2026-11-12T00:00:00.000Z'));
      expect(c.stakeCents).toBe(1250);
      expect(c.stakeFormatted).toBe('12.50');
      expect(c.status).toBe('pending_auth');
      expect(c.auditTrail).toHaveLength(1);
    }
  });

  it('rejects zero, negative, NaN, Infinity, or out-of-range stake amounts', () => {
    for (const stakeUsd of [0, -5, 4.99, 50.01, Number.NaN, Infinity, 'abc']) {
      const res = validateCreateContractInput({
        goal: 'Valid goal text',
        beneficiary: 'EFF',
        stakeUsd,
        durationMinutes: 15,
      });
      expect(res.valid).toBe(false);
    }
  });

  it('rejects invalid deadline minutes or short goal/beneficiary', () => {
    expect(
      validateCreateContractInput({
        goal: 'ab',
        beneficiary: 'EFF',
        stakeUsd: 10,
        durationMinutes: 15,
      }).valid
    ).toBe(false);

    expect(
      validateCreateContractInput({
        goal: 'Valid goal',
        beneficiary: 'A',
        stakeUsd: 10,
        durationMinutes: 15,
      }).valid
    ).toBe(false);

    expect(
      validateCreateContractInput({
        goal: 'Valid goal',
        beneficiary: 'EFF',
        stakeUsd: 10,
        durationMinutes: 0,
      }).valid
    ).toBe(false);

    expect(
      validateCreateContractInput({
        goal: 'Valid goal',
        beneficiary: 'EFF',
        stakeUsd: 10,
        durationMinutes: 4321,
      }).valid
    ).toBe(false);
  });
});
