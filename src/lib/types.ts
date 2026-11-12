/**
 * Core domain types for Stake commitment contracts, AI judge verdicts,
 * proof submissions, and the PayPal + AI audit trail.
 */

export type ContractStatus =
  | 'pending_auth'
  | 'authorized'
  | 'needs_retry'
  | 'voided'
  | 'captured'
  | 'expired_captured'
  | 'expired_unfunded';

export type VerdictValue = 'PASS' | 'FAIL' | 'REVIEW';

export interface JudgeVerdict {
  verdict: VerdictValue;
  confidence: number;
  reason: string;
  feedback: string;
  /** Alias of feedback kept for UI clarity and backwards compatibility */
  roast: string;
}

export interface ProofSubmission {
  submittedAt: string;
  filename?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  outcome: 'voided' | 'captured' | 'needs_retry';
  model?: string;
  verdict?: JudgeVerdict;
  errorReason?: string;
}

export type AuditActor = 'paypal' | 'ai_judge' | 'webhook' | 'system';

export interface AuditTrailEntry {
  id: string;
  timestamp: string;
  actor: AuditActor;
  endpoint: string;
  httpStatus: number | null;
  paypalDebugId: string | null;
  summary: string;
}

export interface Contract {
  id: string;
  goal: string;
  beneficiary: string;
  stakeCents: number;
  stakeFormatted: string;
  currency: 'USD';
  durationMinutes: number;
  createdAt: string;
  deadlineAt: string;
  status: ContractStatus;

  // PayPal Checkout / Payments v2 identifiers
  paypalOrderId?: string;
  paypalAuthorizationId?: string;
  paypalCaptureId?: string;
  paypalAuthStatus?: string;
  authorizedAt?: string;
  authorizationExpiresAt?: string;
  settledAt?: string;

  // AI Judge evaluation history
  latestVerdict?: JudgeVerdict;
  proofAttempts: ProofSubmission[];

  // Webhook event deduplication
  processedWebhookEventIds: string[];

  // Ordered chronological audit log (never contains secrets or tokens)
  auditTrail: AuditTrailEntry[];
}

export const SETTLED_STATUSES: ReadonlySet<ContractStatus> = new Set([
  'voided',
  'captured',
  'expired_captured',
  'expired_unfunded',
]);

export function isContractSettled(status: ContractStatus): boolean {
  return SETTLED_STATUSES.has(status);
}

export const MIN_STAKE_USD = 5;
export const MAX_STAKE_USD = 50;
export const MIN_DEADLINE_MINUTES = 1;
export const MAX_DEADLINE_MINUTES = 3 * 24 * 60; // 3 days (matches PayPal ~3-day honor period)
// 4 MB cap keeps uploads strictly under both the 5 MB spec limit and Vercel's 4.5 MB serverless body limit.
export const MAX_PROOF_BYTES = 4 * 1024 * 1024;
