import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuditEntry } from '../audit';
import { buildNewContract } from '../contracts';
import { PayPalApiError } from '../paypal';
import {
  ContractActionError,
  evaluateAndSettleProof,
  resolveExpiredContracts,
} from '../settle';
import { JsonFileContractStore } from '../store';
import { parseAndValidateVerdict } from '../verdict';

const tempDirs: string[] = [];

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stake-test-'));
  tempDirs.push(dir);
  return new JsonFileContractStore(path.join(dir, 'contracts.json'));
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);

function makeAuthVerifier(
  status: string,
  amountValue = '25.00',
  currencyCode = 'USD'
) {
  return vi.fn(async (authorizationId: string) => ({
    authorizationId,
    status,
    amountValue,
    currencyCode,
    auditEntries: [
      createAuditEntry({
        actor: 'paypal',
        endpoint: `GET /v2/payments/authorizations/${authorizationId}`,
        httpStatus: 200,
        paypalDebugId: 'dbg-verify',
        summary: `Verified authorization ${authorizationId}: status=${status}.`,
      }),
    ],
  }));
}

describe('evaluateAndSettleProof & resolveExpiredContracts (mocked PayPal/AI)', () => {
  it('voids authorization on PASS >= 0.5 and blocks duplicate void/capture', async () => {
    const store = await makeTempStore();
    const baseTime = new Date('2026-11-10T10:00:00.000Z');
    const contract = {
      ...buildNewContract(
        {
          goal: 'Run 5km outdoors',
          beneficiary: 'EFF',
          stakeUsd: 25,
          durationMinutes: 60,
        },
        baseTime
      ),
      status: 'authorized' as const,
      paypalOrderId: 'ORDER-1',
      paypalAuthorizationId: 'AUTH-1',
    };
    await store.create(contract);

    const verifyAuthFn = makeAuthVerifier('CREATED', '25.00', 'USD');
    const voidFn = vi.fn(async () => ({
      status: 'VOIDED',
      auditEntries: [
        createAuditEntry({
          actor: 'paypal',
          endpoint: 'POST /v2/payments/authorizations/AUTH-1/void',
          httpStatus: 204,
          paypalDebugId: 'dbg-void-1',
          summary: 'Voided authorization AUTH-1.',
        }),
      ],
    }));
    const captureFn = vi.fn();

    const result = await evaluateAndSettleProof(
      {
        contractId: contract.id,
        imageBytes: PNG_BYTES,
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength,
        sha256: 'abc123',
        filename: 'run.png',
      },
      {
        store,
        nowFn: () => new Date('2026-11-10T10:15:00.000Z'),
        verifyAuthFn,
        voidFn,
        captureFn,
        judgeFn: async () => {
          const rawText = JSON.stringify({
            verdict: 'PASS',
            confidence: 0.92,
            reason: 'GPS watch clearly displays 5.0 km completed.',
            feedback: 'Solid pace. Keep your $25, slowpoke.',
          });
          return {
            model: 'gemini-2.5-flash',
            rawText,
            validation: parseAndValidateVerdict(rawText),
            auditEntry: createAuditEntry({
              actor: 'ai_judge',
              endpoint: 'GEMINI gemini-2.5-flash (Coach Razor)',
              httpStatus: 200,
              summary: 'Coach Razor passed.',
            }),
          };
        },
      }
    );

    expect(result.outcome).toBe('voided');
    expect(result.contract.status).toBe('voided');
    expect(verifyAuthFn).toHaveBeenCalledTimes(1);
    expect(voidFn).toHaveBeenCalledTimes(1);
    expect(captureFn).not.toHaveBeenCalled();

    // Double-action guard: second submission on settled contract MUST reject with 409
    await expect(
      evaluateAndSettleProof(
        {
          contractId: contract.id,
          imageBytes: PNG_BYTES,
          mimeType: 'image/png',
          sizeBytes: PNG_BYTES.byteLength,
          sha256: 'abc123',
        },
        { store, verifyAuthFn, voidFn, captureFn }
      )
    ).rejects.toThrow(ContractActionError);
    expect(voidFn).toHaveBeenCalledTimes(1);
  });

  it('captures authorization on FAIL >= 0.5 and prevents duplicate capture', async () => {
    const store = await makeTempStore();
    const baseTime = new Date('2026-11-10T10:00:00.000Z');
    const contract = {
      ...buildNewContract(
        {
          goal: 'Wash every dish in the sink',
          beneficiary: 'Alice',
          stakeUsd: 15,
          durationMinutes: 30,
        },
        baseTime
      ),
      status: 'authorized' as const,
      paypalOrderId: 'ORDER-2',
      paypalAuthorizationId: 'AUTH-2',
    };
    await store.create(contract);

    const verifyAuthFn = makeAuthVerifier('CREATED', '15.00', 'USD');
    const voidFn = vi.fn();
    const captureFn = vi.fn(async () => ({
      captureId: 'CAP-2',
      status: 'COMPLETED',
      auditEntries: [
        createAuditEntry({
          actor: 'paypal',
          endpoint: 'POST /v2/payments/authorizations/AUTH-2/capture',
          httpStatus: 201,
          paypalDebugId: 'dbg-cap-2',
          summary: 'Captured AUTH-2.',
        }),
      ],
    }));

    const res = await evaluateAndSettleProof(
      {
        contractId: contract.id,
        imageBytes: PNG_BYTES,
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength,
        sha256: 'def456',
      },
      {
        store,
        nowFn: () => new Date('2026-11-10T10:10:00.000Z'),
        verifyAuthFn,
        voidFn,
        captureFn,
        judgeFn: async () => {
          const rawText = JSON.stringify({
            verdict: 'FAIL',
            confidence: 0.96,
            reason: 'Uploaded image is an unrelated cat meme.',
            feedback: 'Nice meme. Hand over the $15.',
          });
          return {
            model: 'gemini-2.5-flash',
            rawText,
            validation: parseAndValidateVerdict(rawText),
            auditEntry: createAuditEntry({
              actor: 'ai_judge',
              endpoint: 'GEMINI gemini-2.5-flash (Coach Razor)',
              httpStatus: 200,
              summary: 'Coach Razor failed.',
            }),
          };
        },
      }
    );

    expect(res.outcome).toBe('captured');
    expect(res.contract.status).toBe('captured');
    expect(res.contract.paypalCaptureId).toBe('CAP-2');
    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(voidFn).not.toHaveBeenCalled();

    // Prevent duplicate capture on already-captured contract
    await expect(
      evaluateAndSettleProof(
        {
          contractId: contract.id,
          imageBytes: PNG_BYTES,
          mimeType: 'image/png',
          sizeBytes: PNG_BYTES.byteLength,
          sha256: 'def456',
        },
        { store, verifyAuthFn, voidFn, captureFn }
      )
    ).rejects.toThrow(ContractActionError);
    expect(captureFn).toHaveBeenCalledTimes(1);
  });

  it('triggers REVIEW / needs_retry with zero PayPal calls on REVIEW verdict, low confidence, invalid JSON, or AI error, then allows resubmit', async () => {
    const store = await makeTempStore();
    const baseTime = new Date('2026-11-10T10:00:00.000Z');
    const contract = {
      ...buildNewContract(
        {
          goal: 'Finish reading 20 pages',
          beneficiary: 'Bob',
          stakeUsd: 10,
          durationMinutes: 60,
        },
        baseTime
      ),
      status: 'authorized' as const,
      paypalOrderId: 'ORDER-3',
      paypalAuthorizationId: 'AUTH-3',
    };
    await store.create(contract);

    const verifyAuthFn = makeAuthVerifier('CREATED', '10.00', 'USD');
    const voidFn = vi.fn(async () => ({
      status: 'VOIDED',
      auditEntries: [],
    }));
    const captureFn = vi.fn();

    // Attempt 1: explicit REVIEW verdict -> zero PayPal calls
    const first = await evaluateAndSettleProof(
      {
        contractId: contract.id,
        imageBytes: PNG_BYTES,
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength,
        sha256: 'hash1',
      },
      {
        store,
        nowFn: () => new Date('2026-11-10T10:05:00.000Z'),
        verifyAuthFn,
        voidFn,
        captureFn,
        judgeFn: async () => {
          const raw = JSON.stringify({
            verdict: 'REVIEW',
            confidence: 0.72,
            reason: 'Page numbers are cropped out.',
            feedback: 'Show the page number clearly.',
          });
          return {
            model: 'gemini-2.5-flash',
            rawText: raw,
            validation: parseAndValidateVerdict(raw),
            auditEntry: createAuditEntry({
              actor: 'ai_judge',
              endpoint: 'GEMINI',
              httpStatus: 200,
              summary: 'Review requested.',
            }),
          };
        },
      }
    );
    expect(first.outcome).toBe('needs_retry');
    expect(first.contract.status).toBe('needs_retry');
    expect(voidFn).not.toHaveBeenCalled();
    expect(captureFn).not.toHaveBeenCalled();

    // Attempt 2: Gemini API error -> preserved safely in REVIEW, zero capture!
    const second = await evaluateAndSettleProof(
      {
        contractId: contract.id,
        imageBytes: PNG_BYTES,
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength,
        sha256: 'hash2',
      },
      {
        store,
        nowFn: () => new Date('2026-11-10T10:08:00.000Z'),
        verifyAuthFn,
        voidFn,
        captureFn,
        judgeFn: async () => {
          throw new Error('Gemini 503 temporary overload');
        },
      }
    );
    expect(second.outcome).toBe('needs_retry');
    expect(second.contract.status).toBe('needs_retry');
    expect(voidFn).not.toHaveBeenCalled();
    expect(captureFn).not.toHaveBeenCalled();

    // Attempt 3: invalid JSON -> needs_retry
    const third = await evaluateAndSettleProof(
      {
        contractId: contract.id,
        imageBytes: PNG_BYTES,
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength,
        sha256: 'hash3',
      },
      {
        store,
        nowFn: () => new Date('2026-11-10T10:12:00.000Z'),
        verifyAuthFn,
        voidFn,
        captureFn,
        judgeFn: async () => ({
          model: 'gemini-2.5-flash',
          rawText: 'not json',
          validation: parseAndValidateVerdict('not json'),
          auditEntry: createAuditEntry({
            actor: 'ai_judge',
            endpoint: 'GEMINI',
            httpStatus: 200,
            summary: 'Invalid JSON.',
          }),
        }),
      }
    );
    expect(third.outcome).toBe('needs_retry');
    expect(voidFn).not.toHaveBeenCalled();
    expect(captureFn).not.toHaveBeenCalled();

    // Attempt 4: PASS >= 0.5 -> voids cleanly
    const passRaw = JSON.stringify({
      verdict: 'PASS',
      confidence: 0.95,
      reason: 'Open book page 22 clearly legible.',
      feedback: 'Clear shot. Enjoy the book.',
    });
    const fourth = await evaluateAndSettleProof(
      {
        contractId: contract.id,
        imageBytes: PNG_BYTES,
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength,
        sha256: 'hash4',
      },
      {
        store,
        nowFn: () => new Date('2026-11-10T10:15:00.000Z'),
        verifyAuthFn,
        voidFn,
        captureFn,
        judgeFn: async () => ({
          model: 'gemini-2.5-flash',
          rawText: passRaw,
          validation: parseAndValidateVerdict(passRaw),
          auditEntry: createAuditEntry({
            actor: 'ai_judge',
            endpoint: 'GEMINI',
            httpStatus: 200,
            summary: 'Passed.',
          }),
        }),
      }
    );
    expect(fourth.outcome).toBe('voided');
    expect(fourth.contract.proofAttempts).toHaveLength(4);
    expect(voidFn).toHaveBeenCalledTimes(1);
  });

  it('reconciles payment state cleanly if network timeout occurs after PayPal actually settled', async () => {
    const store = await makeTempStore();
    const baseTime = new Date('2026-11-10T10:00:00.000Z');
    const contract = {
      ...buildNewContract(
        {
          goal: 'Clean desk',
          beneficiary: 'EFF',
          stakeUsd: 25,
          durationMinutes: 60,
        },
        baseTime
      ),
      status: 'authorized' as const,
      paypalOrderId: 'ORDER-TO',
      paypalAuthorizationId: 'AUTH-TO',
    };
    await store.create(contract);

    // First verifyAuthFn returns CREATED; second call (after timeout) returns VOIDED!
    const verifyAuthFn = vi
      .fn()
      .mockResolvedValueOnce({
        authorizationId: 'AUTH-TO',
        status: 'CREATED',
        amountValue: '25.00',
        currencyCode: 'USD',
        auditEntries: [],
      })
      .mockResolvedValueOnce({
        authorizationId: 'AUTH-TO',
        status: 'VOIDED',
        amountValue: '25.00',
        currencyCode: 'USD',
        auditEntries: [],
      });

    const voidFn = vi.fn(async () => {
      throw new PayPalApiError({
        message: 'PayPal request timed out after 15s.',
        status: 504,
        debugId: null,
        code: 'PAYPAL_TIMEOUT',
        isTransient: true,
      });
    });

    const res = await evaluateAndSettleProof(
      {
        contractId: contract.id,
        imageBytes: PNG_BYTES,
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength,
        sha256: 'hash-to',
      },
      {
        store,
        nowFn: () => new Date('2026-11-10T10:15:00.000Z'),
        verifyAuthFn,
        voidFn,
        captureFn: vi.fn(),
        judgeFn: async () => {
          const raw = JSON.stringify({
            verdict: 'PASS',
            confidence: 0.94,
            reason: 'Desk is completely clean.',
            feedback: 'Spotless.',
          });
          return {
            model: 'gemini-2.5-flash',
            rawText: raw,
            validation: parseAndValidateVerdict(raw),
            auditEntry: createAuditEntry({
              actor: 'ai_judge',
              endpoint: 'GEMINI',
              httpStatus: 200,
              summary: 'Passed.',
            }),
          };
        },
      }
    );

    expect(res.outcome).toBe('voided');
    expect(res.contract.status).toBe('voided');
    expect(verifyAuthFn).toHaveBeenCalledTimes(2);
    expect(
      res.contract.auditTrail.some((e) => e.endpoint === 'TIMEOUT RECONCILIATION')
    ).toBe(true);
  });

  it('resolveExpiredContracts captures overdue authorized contracts, closes pending_auth as unfunded, and preserves REVIEW contracts', async () => {
    const store = await makeTempStore();
    const createdAt = new Date('2026-11-10T10:00:00.000Z');

    const overdueAuthorized = {
      ...buildNewContract(
        { goal: 'Gym selfie', beneficiary: 'Charity', stakeUsd: 20, durationMinutes: 10 },
        createdAt
      ),
      status: 'authorized' as const,
      paypalAuthorizationId: 'AUTH-EXP',
    };
    const overdueReview = {
      ...buildNewContract(
        { goal: 'Needs manual review', beneficiary: 'Charity', stakeUsd: 15, durationMinutes: 10 },
        createdAt
      ),
      status: 'needs_retry' as const,
      paypalAuthorizationId: 'AUTH-REV',
    };
    const overduePending = buildNewContract(
      { goal: 'Never paid', beneficiary: 'Friend', stakeUsd: 10, durationMinutes: 10 },
      createdAt
    );
    const activeFuture = {
      ...buildNewContract(
        { goal: 'Still active', beneficiary: 'Friend', stakeUsd: 30, durationMinutes: 120 },
        createdAt
      ),
      status: 'authorized' as const,
      paypalAuthorizationId: 'AUTH-ACTIVE',
    };

    await store.create(overdueAuthorized);
    await store.create(overdueReview);
    await store.create(overduePending);
    await store.create(activeFuture);

    const captureFn = vi.fn(async ({ authorizationId }: { authorizationId: string }) => ({
      captureId: `CAP-${authorizationId}`,
      status: 'COMPLETED',
      auditEntries: [],
    }));

    const summary = await resolveExpiredContracts({
      store,
      captureFn,
      nowFn: () => new Date('2026-11-10T10:15:00.000Z'),
    });

    expect(summary.expiredFound).toBe(3);
    expect(summary.resolvedCount).toBe(3);
    expect(captureFn).toHaveBeenCalledTimes(1);
    expect(captureFn).toHaveBeenCalledWith({
      authorizationId: 'AUTH-EXP',
      contractId: overdueAuthorized.id,
    });

    expect((await store.get(overdueAuthorized.id))?.status).toBe('expired_captured');
    expect((await store.get(overduePending.id))?.status).toBe('expired_unfunded');
    // REVIEW contract must be preserved untouched (no capture, no void!)
    expect((await store.get(overdueReview.id))?.status).toBe('needs_retry');
    expect((await store.get(activeFuture.id))?.status).toBe('authorized');
  });
});
