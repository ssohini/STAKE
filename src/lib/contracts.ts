import crypto from 'node:crypto';
import { createAuditEntry } from './audit';
import {
  MAX_DEADLINE_MINUTES,
  MAX_STAKE_USD,
  MIN_DEADLINE_MINUTES,
  MIN_STAKE_USD,
  type Contract,
} from './types';

export interface CreateContractInput {
  goal: string;
  beneficiary: string;
  stakeUsd: number;
  durationMinutes: number;
}

export type CreateContractValidation =
  | { valid: true; data: CreateContractInput }
  | { valid: false; error: string };

export function generateContractId(): string {
  return crypto.randomBytes(6).toString('base64url');
}

export function validateCreateContractInput(
  raw: unknown
): CreateContractValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const body = raw as Record<string, unknown>;
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  const beneficiary =
    typeof body.beneficiary === 'string' ? body.beneficiary.trim() : '';
  const stakeUsd = Number(body.stakeUsd);
  const durationMinutes = Number(body.durationMinutes);

  if (goal.length < 3 || goal.length > 300) {
    return {
      valid: false,
      error: 'Goal must be between 3 and 300 characters.',
    };
  }

  if (beneficiary.length < 2 || beneficiary.length > 100) {
    return {
      valid: false,
      error: 'Beneficiary label must be between 2 and 100 characters.',
    };
  }

  if (
    !Number.isFinite(stakeUsd) ||
    stakeUsd < MIN_STAKE_USD ||
    stakeUsd > MAX_STAKE_USD
  ) {
    return {
      valid: false,
      error: `Stake must be between $${MIN_STAKE_USD} and $${MAX_STAKE_USD} USD.`,
    };
  }

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < MIN_DEADLINE_MINUTES ||
    durationMinutes > MAX_DEADLINE_MINUTES
  ) {
    return {
      valid: false,
      error: `Deadline must be an integer between ${MIN_DEADLINE_MINUTES} minute and ${MAX_DEADLINE_MINUTES} minutes (3 days).`,
    };
  }

  const stakeCents = Math.round(stakeUsd * 100);
  const normalizedStakeUsd = stakeCents / 100;

  return {
    valid: true,
    data: {
      goal,
      beneficiary,
      stakeUsd: normalizedStakeUsd,
      durationMinutes,
    },
  };
}

export function buildNewContract(
  input: CreateContractInput,
  now: Date = new Date()
): Contract {
  const stakeCents = Math.round(input.stakeUsd * 100);
  const stakeFormatted = (stakeCents / 100).toFixed(2);
  const createdAt = now.toISOString();
  const deadlineAt = new Date(
    now.getTime() + input.durationMinutes * 60_000
  ).toISOString();

  return {
    id: generateContractId(),
    goal: input.goal,
    beneficiary: input.beneficiary,
    stakeCents,
    stakeFormatted,
    currency: 'USD',
    durationMinutes: input.durationMinutes,
    createdAt,
    deadlineAt,
    status: 'pending_auth',
    proofAttempts: [],
    processedWebhookEventIds: [],
    auditTrail: [
      createAuditEntry({
        actor: 'system',
        endpoint: 'POST /api/contracts',
        httpStatus: 201,
        summary: `Contract created: $${stakeFormatted} USD stake against "${input.beneficiary}" (${input.durationMinutes}m window). Awaiting PayPal authorization.`,
        timestamp: createdAt,
      }),
    ],
  };
}
