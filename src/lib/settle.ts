import { createAuditEntry } from './audit';
import { judgeProofWithCoachRazor, type JudgeResult } from './judge';
import {
  captureAuthorization,
  getAuthorizationDetails,
  PayPalApiError,
  voidAuthorization,
  type AuthorizationDetailsResult,
  type CaptureAuthorizationResult,
  type VoidAuthorizationResult,
} from './paypal';
import {
  getContractStore,
  withAuditEntries,
  type ContractStore,
} from './store';
import {
  isContractSettled,
  type AuditTrailEntry,
  type Contract,
  type JudgeVerdict,
  type ProofSubmission,
} from './types';
import { decideSettlement } from './verdict';

export class ContractActionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly debugId?: string | null;

  constructor(
    message: string,
    status: number,
    code: string,
    debugId?: string | null
  ) {
    super(message);
    this.name = 'ContractActionError';
    this.status = status;
    this.code = code;
    this.debugId = debugId;
  }
}

export interface SettlementDependencies {
  store: ContractStore;
  judgeFn: typeof judgeProofWithCoachRazor;
  verifyAuthFn: (authorizationId: string) => Promise<AuthorizationDetailsResult>;
  voidFn: (params: { authorizationId: string }) => Promise<VoidAuthorizationResult>;
  captureFn: (params: {
    authorizationId: string;
    contractId: string;
  }) => Promise<CaptureAuthorizationResult>;
  nowFn: () => Date;
}

function defaultDeps(): SettlementDependencies {
  return {
    store: getContractStore(),
    judgeFn: judgeProofWithCoachRazor,
    verifyAuthFn: (authorizationId) => getAuthorizationDetails(authorizationId),
    voidFn: ({ authorizationId }) => voidAuthorization({ authorizationId }),
    captureFn: ({ authorizationId, contractId }) =>
      captureAuthorization({ authorizationId, contractId }),
    nowFn: () => new Date(),
  };
}

export interface ProofEvaluationResult {
  contract: Contract;
  outcome: 'voided' | 'captured' | 'needs_retry';
  verdict?: JudgeVerdict;
  reason?: string;
}

function isReconcilableError(error: unknown): boolean {
  if (!(error instanceof PayPalApiError)) return false;
  if (error.isTransient) return true;
  const codeUpper = error.code.toUpperCase();
  return (
    codeUpper.includes('ALREADY_CAPTURED') ||
    codeUpper.includes('ALREADY_VOIDED') ||
    codeUpper === 'AUTHORIZATION_VOIDED'
  );
}

/**
 * Runs Coach Razor on the validated proof image, validates JSON on the server,
 * verifies PayPal authorization eligibility, and settles PayPal (void or capture)
 * OR enters REVIEW (needs_retry) without moving money.
 */
export async function evaluateAndSettleProof(
  params: {
    contractId: string;
    imageBytes: Uint8Array;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    filename?: string;
  },
  overrides?: Partial<SettlementDependencies>
): Promise<ProofEvaluationResult> {
  const deps: SettlementDependencies = { ...defaultDeps(), ...overrides };

  return deps.store.withLock(params.contractId, async () => {
    const contract = await deps.store.get(params.contractId);
    if (!contract) {
      throw new ContractActionError('Contract not found.', 404, 'NOT_FOUND');
    }

    // Double-settlement guard: never capture or void an already settled contract.
    if (isContractSettled(contract.status)) {
      throw new ContractActionError(
        `Contract is already settled (${contract.status}). Cannot settle twice.`,
        409,
        'ALREADY_SETTLED'
      );
    }

    if (contract.status === 'pending_auth' || !contract.paypalAuthorizationId) {
      throw new ContractActionError(
        'Contract does not have an active PayPal authorization yet.',
        400,
        'NOT_AUTHORIZED'
      );
    }

    const now = deps.nowFn();
    if (now.getTime() > Date.parse(contract.deadlineAt)) {
      throw new ContractActionError(
        'Contract deadline has already passed. Run "Resolve expired" to settle overdue contracts.',
        409,
        'DEADLINE_PASSED'
      );
    }

    const submittedAt = now.toISOString();
    const uploadAudit = createAuditEntry({
      actor: 'system',
      endpoint: 'POST /api/contracts/[id]/proof',
      httpStatus: 200,
      summary: `Proof uploaded (${params.filename ?? 'image'}, ${params.mimeType}, ${(params.sizeBytes / 1024).toFixed(1)} KB, sha256=${params.sha256.slice(0, 12)}…). AI evaluation started.`,
      timestamp: submittedAt,
    });

    // Step 1: AI Judge runs in complete isolation from PayPal credentials/API.
    // On AI errors/timeouts, preserve authorization in REVIEW (needs_retry) with zero money moved.
    let judgeResult: JudgeResult;
    try {
      judgeResult = await deps.judgeFn({
        goal: contract.goal,
        stakeFormatted: contract.stakeFormatted,
        beneficiary: contract.beneficiary,
        imageBytes: params.imageBytes,
        mimeType: params.mimeType,
      });
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Vision model evaluation failed.';
      const errEntry = createAuditEntry({
        actor: 'ai_judge',
        endpoint: 'GEMINI Coach Razor',
        httpStatus: 503,
        summary: `AI evaluation error (${msg}). Marked REVIEW (needs_retry) — zero PayPal money moved.`,
      });
      const submission: ProofSubmission = {
        submittedAt,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        sha256: params.sha256,
        outcome: 'needs_retry',
        errorReason: `AI service unavailable: ${msg}`,
      };
      const updated = await deps.store.update(contract.id, (curr) => ({
        ...withAuditEntries(curr, [uploadAudit, errEntry]),
        status: 'needs_retry',
        proofAttempts: [...curr.proofAttempts, submission],
      }));
      return {
        contract: updated ?? contract,
        outcome: 'needs_retry',
        reason: `AI evaluation failed cleanly (${msg}). Authorization preserved in REVIEW — please retry.`,
      };
    }

    // Step 2: Deterministic server-side JSON validation & settlement decision.
    const decision = decideSettlement(judgeResult.validation);

    if (decision.action === 'needs_retry') {
      const reviewAudit = createAuditEntry({
        actor: 'system',
        endpoint: 'POST /api/contracts/[id]/proof',
        httpStatus: 200,
        summary: `Marked REVIEW / needs_retry (${decision.reason}). PayPal authorization preserved; zero money moved.`,
      });

      const submission: ProofSubmission = {
        submittedAt,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        sha256: params.sha256,
        outcome: 'needs_retry',
        model: judgeResult.model,
        verdict: decision.verdict,
        errorReason: decision.reason,
      };

      const updated = await deps.store.update(contract.id, (curr) => ({
        ...withAuditEntries(curr, [
          uploadAudit,
          judgeResult.auditEntry,
          reviewAudit,
        ]),
        status: 'needs_retry',
        latestVerdict: decision.verdict ?? curr.latestVerdict,
        proofAttempts: [...curr.proofAttempts, submission],
      }));

      return {
        contract: updated ?? contract,
        outcome: 'needs_retry',
        verdict: decision.verdict,
        reason: decision.reason,
      };
    }

    // Step 3: Server initiates PayPal resolution after verifying authorization eligibility.
    const authorizationId = contract.paypalAuthorizationId;
    const resolutionInitAudit = createAuditEntry({
      actor: 'system',
      endpoint: `RESOLVE (${decision.action.toUpperCase()})`,
      httpStatus: null,
      summary: `Resolution initiated for contract ${contract.id}: verdict=${decision.verdict.verdict} (confidence=${decision.verdict.confidence.toFixed(2)}) -> ${decision.action.toUpperCase()} authorization ${authorizationId}.`,
    });

    const trailBuffer: AuditTrailEntry[] = [
      uploadAudit,
      judgeResult.auditEntry,
      resolutionInitAudit,
    ];

    // Pre-settlement verification against PayPal (eligibility + timeout reconciliation).
    try {
      const authState = await deps.verifyAuthFn(authorizationId);
      trailBuffer.push(...authState.auditEntries);

      if (
        authState.currencyCode &&
        authState.currencyCode !== contract.currency
      ) {
        throw new ContractActionError(
          `Authorization currency mismatch (${authState.currencyCode} vs ${contract.currency}).`,
          422,
          'CURRENCY_MISMATCH'
        );
      }

      if (
        authState.amountValue &&
        Math.round(Number(authState.amountValue) * 100) !== contract.stakeCents
      ) {
        throw new ContractActionError(
          `Authorization amount mismatch ($${authState.amountValue} vs $${contract.stakeFormatted}).`,
          422,
          'AMOUNT_MISMATCH'
        );
      }

      // If PayPal already settled this authorization (e.g. via webhook or prior retry), reconcile!
      if (authState.status === 'VOIDED') {
        const reconciled = await finalizeSettledContract({
          store: deps.store,
          contractId: contract.id,
          outcome: 'voided',
          paypalAuthStatus: 'VOIDED',
          verdict: decision.verdict,
          submission: {
            submittedAt,
            filename: params.filename,
            mimeType: params.mimeType,
            sizeBytes: params.sizeBytes,
            sha256: params.sha256,
            outcome: 'voided',
            model: judgeResult.model,
            verdict: decision.verdict,
          },
          settledAt: deps.nowFn().toISOString(),
          auditEntries: [
            ...trailBuffer,
            createAuditEntry({
              actor: 'system',
              endpoint: 'RECONCILE',
              httpStatus: 200,
              summary: `PayPal confirmed authorization ${authorizationId} was already VOIDED. Reconciled contract without double void.`,
            }),
          ],
        });
        return {
          contract: reconciled,
          outcome: 'voided',
          verdict: decision.verdict,
        };
      }

      if (authState.status === 'CAPTURED') {
        const reconciled = await finalizeSettledContract({
          store: deps.store,
          contractId: contract.id,
          outcome: 'captured',
          paypalAuthStatus: 'CAPTURED',
          verdict: decision.verdict,
          submission: {
            submittedAt,
            filename: params.filename,
            mimeType: params.mimeType,
            sizeBytes: params.sizeBytes,
            sha256: params.sha256,
            outcome: 'captured',
            model: judgeResult.model,
            verdict: decision.verdict,
          },
          settledAt: deps.nowFn().toISOString(),
          auditEntries: [
            ...trailBuffer,
            createAuditEntry({
              actor: 'system',
              endpoint: 'RECONCILE',
              httpStatus: 200,
              summary: `PayPal confirmed authorization ${authorizationId} was already CAPTURED. Reconciled contract without double capture.`,
            }),
          ],
        });
        return {
          contract: reconciled,
          outcome: 'captured',
          verdict: decision.verdict,
        };
      }

      if (authState.status === 'EXPIRED' || authState.status === 'DENIED') {
        throw new PayPalApiError({
          message: `PayPal authorization ${authorizationId} is "${authState.status}" and can no longer be settled.`,
          status: 422,
          debugId: null,
          code: `AUTHORIZATION_${authState.status}`,
          auditEntries: [],
          isTransient: false,
        });
      }
    } catch (error) {
      if (error instanceof ContractActionError) {
        await deps.store.update(contract.id, (curr) =>
          withAuditEntries(curr, [
            ...trailBuffer,
            createAuditEntry({
              actor: 'system',
              endpoint: 'VERIFY AUTHORIZATION',
              httpStatus: error.status,
              summary: error.message,
            }),
          ])
        );
        throw error;
      }
      // If verifyAuthFn failed with a non-transient PayPal error (like 422 EXPIRED), record & throw.
      if (error instanceof PayPalApiError && !error.isTransient) {
        await recordPayPalSettlementFailure(deps.store, contract.id, trailBuffer, error);
        throw error;
      }
      // On transient verification network error, log warning and still attempt idempotent settlement.
      trailBuffer.push(
        createAuditEntry({
          actor: 'paypal',
          endpoint: `GET /v2/payments/authorizations/${authorizationId}`,
          httpStatus: error instanceof PayPalApiError ? error.status : 502,
          paypalDebugId: error instanceof PayPalApiError ? error.debugId : null,
          summary: `Pre-check verification experienced transient error; proceeding with idempotent PayPal-Request-Id call.`,
        })
      );
    }

    if (decision.action === 'void') {
      try {
        const voidRes = await deps.voidFn({ authorizationId });
        const resolvedAudit = createAuditEntry({
          actor: 'system',
          endpoint: 'CONTRACT RESOLVED',
          httpStatus: 200,
          summary: `Contract ${contract.id} marked PASSED (voided). $${contract.stakeFormatted} USD hold released.`,
        });
        const updated = await finalizeSettledContract({
          store: deps.store,
          contractId: contract.id,
          outcome: 'voided',
          paypalAuthStatus: voidRes.status,
          verdict: decision.verdict,
          submission: {
            submittedAt,
            filename: params.filename,
            mimeType: params.mimeType,
            sizeBytes: params.sizeBytes,
            sha256: params.sha256,
            outcome: 'voided',
            model: judgeResult.model,
            verdict: decision.verdict,
          },
          settledAt: deps.nowFn().toISOString(),
          auditEntries: [...trailBuffer, ...voidRes.auditEntries, resolvedAudit],
        });

        return {
          contract: updated,
          outcome: 'voided',
          verdict: decision.verdict,
        };
      } catch (error) {
        // Timeout / transient error reconciliation: check if PayPal actually voided it.
        if (isReconcilableError(error)) {
          const reconciled = await tryReconcileAfterError({
            store: deps.store,
            verifyAuthFn: deps.verifyAuthFn,
            contractId: contract.id,
            authorizationId,
            expectedTarget: 'VOIDED',
            verdict: decision.verdict,
            submission: {
              submittedAt,
              filename: params.filename,
              mimeType: params.mimeType,
              sizeBytes: params.sizeBytes,
              sha256: params.sha256,
              outcome: 'voided',
              model: judgeResult.model,
              verdict: decision.verdict,
            },
            priorEntries: trailBuffer,
            originalError: error,
            nowFn: deps.nowFn,
          });
          if (reconciled) {
            return {
              contract: reconciled,
              outcome: 'voided',
              verdict: decision.verdict,
            };
          }
        }

        await recordPayPalSettlementFailure(deps.store, contract.id, trailBuffer, error);
        throw error;
      }
    }

    // decision.action === 'capture'
    try {
      const capRes = await deps.captureFn({
        authorizationId,
        contractId: contract.id,
      });
      const resolvedAudit = createAuditEntry({
        actor: 'system',
        endpoint: 'CONTRACT RESOLVED',
        httpStatus: 200,
        summary: `Contract ${contract.id} marked FAILED (captured). Capture ID: ${capRes.captureId} ($${contract.stakeFormatted} USD).`,
      });
      const updated = await finalizeSettledContract({
        store: deps.store,
        contractId: contract.id,
        outcome: 'captured',
        paypalCaptureId: capRes.captureId,
        paypalAuthStatus: capRes.status,
        verdict: decision.verdict,
        submission: {
          submittedAt,
          filename: params.filename,
          mimeType: params.mimeType,
          sizeBytes: params.sizeBytes,
          sha256: params.sha256,
          outcome: 'captured',
          model: judgeResult.model,
          verdict: decision.verdict,
        },
        settledAt: deps.nowFn().toISOString(),
        auditEntries: [...trailBuffer, ...capRes.auditEntries, resolvedAudit],
      });

      return {
        contract: updated,
        outcome: 'captured',
        verdict: decision.verdict,
      };
    } catch (error) {
      if (isReconcilableError(error)) {
        const reconciled = await tryReconcileAfterError({
          store: deps.store,
          verifyAuthFn: deps.verifyAuthFn,
          contractId: contract.id,
          authorizationId,
          expectedTarget: 'CAPTURED',
          verdict: decision.verdict,
          submission: {
            submittedAt,
            filename: params.filename,
            mimeType: params.mimeType,
            sizeBytes: params.sizeBytes,
            sha256: params.sha256,
            outcome: 'captured',
            model: judgeResult.model,
            verdict: decision.verdict,
          },
          priorEntries: trailBuffer,
          originalError: error,
          nowFn: deps.nowFn,
        });
        if (reconciled) {
          return {
            contract: reconciled,
            outcome: 'captured',
            verdict: decision.verdict,
          };
        }
      }

      await recordPayPalSettlementFailure(deps.store, contract.id, trailBuffer, error);
      throw error;
    }
  });
}

async function finalizeSettledContract(params: {
  store: ContractStore;
  contractId: string;
  outcome: 'voided' | 'captured';
  paypalAuthStatus: string;
  paypalCaptureId?: string;
  verdict: JudgeVerdict;
  submission: ProofSubmission;
  settledAt: string;
  auditEntries: AuditTrailEntry[];
}): Promise<Contract> {
  const updated = await params.store.update(params.contractId, (curr) => {
    if (isContractSettled(curr.status)) return curr;
    return {
      ...withAuditEntries(curr, params.auditEntries),
      status: params.outcome,
      paypalAuthStatus: params.paypalAuthStatus,
      ...(params.paypalCaptureId
        ? { paypalCaptureId: params.paypalCaptureId }
        : {}),
      settledAt: params.settledAt,
      latestVerdict: params.verdict,
      proofAttempts: [...curr.proofAttempts, params.submission],
    };
  });

  if (!updated) {
    throw new ContractActionError('Contract disappeared during settlement.', 404, 'NOT_FOUND');
  }
  return updated;
}

async function tryReconcileAfterError(params: {
  store: ContractStore;
  verifyAuthFn: (authorizationId: string) => Promise<AuthorizationDetailsResult>;
  contractId: string;
  authorizationId: string;
  expectedTarget: 'VOIDED' | 'CAPTURED';
  verdict: JudgeVerdict;
  submission: ProofSubmission;
  priorEntries: AuditTrailEntry[];
  originalError: unknown;
  nowFn: () => Date;
}): Promise<Contract | null> {
  try {
    const authState = await params.verifyAuthFn(params.authorizationId);
    if (authState.status !== params.expectedTarget) {
      return null;
    }
    const errEntries =
      params.originalError instanceof PayPalApiError
        ? params.originalError.auditEntries
        : [];
    const reconcileEntry = createAuditEntry({
      actor: 'system',
      endpoint: 'TIMEOUT RECONCILIATION',
      httpStatus: 200,
      summary: `Reconciled authorization ${params.authorizationId}: PayPal confirmed state is ${authState.status} after transient error.`,
    });
    const outcome = params.expectedTarget === 'VOIDED' ? 'voided' : 'captured';
    return await finalizeSettledContract({
      store: params.store,
      contractId: params.contractId,
      outcome,
      paypalAuthStatus: authState.status,
      verdict: params.verdict,
      submission: params.submission,
      settledAt: params.nowFn().toISOString(),
      auditEntries: [
        ...params.priorEntries,
        ...errEntries,
        ...authState.auditEntries,
        reconcileEntry,
      ],
    });
  } catch {
    return null;
  }
}

async function recordPayPalSettlementFailure(
  store: ContractStore,
  contractId: string,
  priorEntries: AuditTrailEntry[],
  error: unknown
): Promise<void> {
  const entries: AuditTrailEntry[] = [...priorEntries];
  if (error instanceof PayPalApiError && error.auditEntries.length > 0) {
    entries.push(...error.auditEntries);
  } else {
    entries.push(
      createAuditEntry({
        actor: 'paypal',
        endpoint: 'PayPal Settlement',
        httpStatus: error instanceof PayPalApiError ? error.status : 500,
        paypalDebugId: error instanceof PayPalApiError ? error.debugId : null,
        summary: `PayPal settlement error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    );
  }
  await store.update(contractId, (curr) => withAuditEntries(curr, entries));
}

export interface ResolveExpiredItem {
  contractId: string;
  previousStatus: Contract['status'];
  newStatus: Contract['status'];
  outcome: 'captured' | 'marked_unfunded' | 'preserved_for_review' | 'error';
  captureId?: string;
  debugId?: string | null;
  error?: string;
}

export interface ResolveExpiredSummary {
  checkedAt: string;
  scannedCount: number;
  expiredFound: number;
  resolvedCount: number;
  results: ResolveExpiredItem[];
}

/**
 * Simulates a cron sweep:
 * - Overdue `authorized` contracts (no proof submitted) -> auto-fail and capture.
 * - Overdue `pending_auth` contracts (no PayPal hold) -> mark expired_unfunded.
 * - Overdue `needs_retry` (REVIEW) contracts -> preserve authorization for safe review (NEVER auto-capture/void).
 */
export async function resolveExpiredContracts(
  overrides?: Partial<
    Pick<SettlementDependencies, 'store' | 'captureFn' | 'verifyAuthFn' | 'nowFn'>
  >
): Promise<ResolveExpiredSummary> {
  const store = overrides?.store ?? getContractStore();
  const captureFn =
    overrides?.captureFn ??
    (({ authorizationId, contractId }) =>
      captureAuthorization({ authorizationId, contractId }));
  const verifyAuthFn =
    overrides?.verifyAuthFn ??
    ((authorizationId) => getAuthorizationDetails(authorizationId));
  const nowFn = overrides?.nowFn ?? (() => new Date());

  const now = nowFn();
  const nowMs = now.getTime();
  const all = await store.listAll();
  const overdue = all.filter(
    (c) => !isContractSettled(c.status) && nowMs > Date.parse(c.deadlineAt)
  );

  const results: ResolveExpiredItem[] = [];

  for (const candidate of overdue) {
    const item = await store.withLock<ResolveExpiredItem>(
      candidate.id,
      async () => {
        const fresh = await store.get(candidate.id);
        if (!fresh || isContractSettled(fresh.status)) {
          return {
            contractId: candidate.id,
            previousStatus: candidate.status,
            newStatus: fresh?.status ?? candidate.status,
            outcome: 'error',
            error: 'Already settled concurrently.',
          };
        }

        // Contracts currently marked REVIEW (needs_retry) must NOT be automatically captured or voided.
        if (fresh.status === 'needs_retry') {
          const alreadyLogged = fresh.auditTrail.some((e) =>
            e.summary.includes('Preserved in REVIEW past deadline')
          );
          if (!alreadyLogged) {
            const entry = createAuditEntry({
              actor: 'system',
              endpoint: 'POST /api/cron/resolve',
              httpStatus: 200,
              summary:
                'Preserved in REVIEW past deadline: authorization left untouched (no automatic capture or void).',
            });
            await store.update(fresh.id, (curr) =>
              withAuditEntries(curr, [entry])
            );
          }
          return {
            contractId: fresh.id,
            previousStatus: fresh.status,
            newStatus: fresh.status,
            outcome: 'preserved_for_review',
          };
        }

        // Never authorized with PayPal -> close cleanly without calling PayPal capture.
        if (fresh.status === 'pending_auth' || !fresh.paypalAuthorizationId) {
          const entry = createAuditEntry({
            actor: 'system',
            endpoint: 'POST /api/cron/resolve',
            httpStatus: 200,
            summary:
              'Deadline passed before PayPal authorization was completed. Marked expired_unfunded (no money held).',
          });
          await store.update(fresh.id, (curr) => ({
            ...withAuditEntries(curr, [entry]),
            status: 'expired_unfunded',
            settledAt: nowFn().toISOString(),
          }));
          return {
            contractId: fresh.id,
            previousStatus: fresh.status,
            newStatus: 'expired_unfunded',
            outcome: 'marked_unfunded',
          };
        }

        // Overdue `authorized` contract with no proof -> auto-fail & capture!
        try {
          const capRes = await captureFn({
            authorizationId: fresh.paypalAuthorizationId,
            contractId: fresh.id,
          });
          const cronEntry = createAuditEntry({
            actor: 'system',
            endpoint: 'POST /api/cron/resolve',
            httpStatus: 200,
            summary: `Deadline passed without proof. Auto-failed contract and captured $${fresh.stakeFormatted} USD.`,
          });
          const verdict: JudgeVerdict = {
            verdict: 'FAIL',
            confidence: 1,
            reason: 'Deadline elapsed with no proof uploaded.',
            feedback:
              'Clock ran out with no proof on the table. Coach Razor collects the stake.',
            roast:
              'Clock ran out with no proof on the table. Coach Razor collects the stake.',
          };

          await store.update(fresh.id, (curr) => {
            if (isContractSettled(curr.status)) return curr;
            return {
              ...withAuditEntries(curr, [cronEntry, ...capRes.auditEntries]),
              status: 'expired_captured',
              paypalCaptureId: capRes.captureId,
              paypalAuthStatus: capRes.status,
              settledAt: nowFn().toISOString(),
              latestVerdict: curr.latestVerdict ?? verdict,
            };
          });

          return {
            contractId: fresh.id,
            previousStatus: fresh.status,
            newStatus: 'expired_captured',
            outcome: 'captured',
            captureId: capRes.captureId,
          };
        } catch (error) {
          if (isReconcilableError(error)) {
            // Attempt reconciliation if capture failed transiently
            try {
              const authState = await verifyAuthFn(fresh.paypalAuthorizationId);
              if (authState.status === 'CAPTURED') {
                await store.update(fresh.id, (curr) => ({
                  ...withAuditEntries(curr, [
                    ...authState.auditEntries,
                    createAuditEntry({
                      actor: 'system',
                      endpoint: 'POST /api/cron/resolve',
                      httpStatus: 200,
                      summary: `Reconciled expired authorization ${fresh.paypalAuthorizationId} as CAPTURED.`,
                    }),
                  ]),
                  status: 'expired_captured',
                  paypalAuthStatus: 'CAPTURED',
                  settledAt: nowFn().toISOString(),
                }));
                return {
                  contractId: fresh.id,
                  previousStatus: fresh.status,
                  newStatus: 'expired_captured',
                  outcome: 'captured',
                };
              }
            } catch {
              // Fall through to error handling
            }
          }

          const debugId =
            error instanceof PayPalApiError ? error.debugId : null;
          const message =
            error instanceof Error
              ? error.message
              : 'PayPal capture failed during expiration sweep.';

          const failAudit =
            error instanceof PayPalApiError && error.auditEntries.length > 0
              ? error.auditEntries
              : [
                  createAuditEntry({
                    actor: 'paypal',
                    endpoint: `POST /v2/payments/authorizations/${fresh.paypalAuthorizationId}/capture`,
                    httpStatus:
                      error instanceof PayPalApiError ? error.status : 500,
                    paypalDebugId: debugId,
                    summary: `Expiration capture failed: ${message}`,
                  }),
                ];

          await store.update(fresh.id, (curr) =>
            withAuditEntries(curr, failAudit)
          );

          return {
            contractId: fresh.id,
            previousStatus: fresh.status,
            newStatus: fresh.status,
            outcome: 'error',
            debugId,
            error: message,
          };
        }
      }
    );

    results.push(item);
  }

  return {
    checkedAt: now.toISOString(),
    scannedCount: all.length,
    expiredFound: overdue.length,
    resolvedCount: results.filter((r) => r.outcome !== 'error').length,
    results,
  };
}
