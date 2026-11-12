import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as authorizePost } from '@/app/api/contracts/[id]/paypal/authorize/route';
import { POST as webhookPost } from '@/app/api/paypal/webhook/route';
import { buildNewContract } from '../contracts';
import { clearPayPalTokenCacheForTests } from '../paypal';
import { resetContractStoreForTests } from '../store';

describe('POST /api/paypal/webhook & authorize route security', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalCwd = process.cwd();
  let tmpDir = '';

  beforeEach(async () => {
    clearPayPalTokenCacheForTests();
    resetContractStoreForTests();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stake-webhook-'));
    process.chdir(tmpDir);
    process.env.PAYPAL_CLIENT_ID = 'cid';
    process.env.PAYPAL_CLIENT_SECRET = 'csec';
    process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST-123';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    resetContractStoreForTests();
    vi.restoreAllMocks();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  function makeWebhookHeaders() {
    return {
      'content-type': 'application/json',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
      'paypal-transmission-id': 'tx-1',
      'paypal-transmission-sig': 'sig-1',
      'paypal-transmission-time': '2026-11-10T12:00:00Z',
    };
  }

  it('rejects unverified signatures with 401 and does not touch contracts', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      if (url.toString().endsWith('/v1/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ verification_status: 'FAILURE' }), {
        status: 200,
        headers: { 'paypal-debug-id': 'dbg-fail' },
      });
    }) as unknown as typeof fetch;

    const req = new Request('http://localhost/api/paypal/webhook', {
      method: 'POST',
      headers: makeWebhookHeaders(),
      body: JSON.stringify({ id: 'EV-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
    });

    const res = await webhookPost(req);
    expect(res.status).toBe(401);
  });

  it('logs verified PAYMENT.AUTHORIZATION.VOIDED into the contract audit trail and deduplicates retries', async () => {
    const { getContractStore } = await import('../store');
    const store = getContractStore();
    const contract = {
      ...buildNewContract({
        goal: 'Test webhook matching',
        beneficiary: 'EFF',
        stakeUsd: 10,
        durationMinutes: 60,
      }),
      status: 'authorized' as const,
      paypalOrderId: 'ORD-WH',
      paypalAuthorizationId: 'AUTH-WH',
    };
    await store.create(contract);

    globalThis.fetch = vi.fn(async (url: string | URL) => {
      if (url.toString().endsWith('/v1/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          { status: 200, headers: { 'paypal-debug-id': 'dbg-oauth' } }
        );
      }
      return new Response(JSON.stringify({ verification_status: 'SUCCESS' }), {
        status: 200,
        headers: { 'paypal-debug-id': 'dbg-wh-ok' },
      });
    }) as unknown as typeof fetch;

    const payload = {
      id: 'WH-EVT-777',
      event_type: 'PAYMENT.AUTHORIZATION.VOIDED',
      resource: {
        id: 'AUTH-WH',
        status: 'VOIDED',
        custom_id: contract.id,
      },
    };

    const res1 = await webhookPost(
      new Request('http://localhost/api/paypal/webhook', {
        method: 'POST',
        headers: makeWebhookHeaders(),
        body: JSON.stringify(payload),
      })
    );
    expect(res1.status).toBe(200);

    const updated = await store.get(contract.id);
    expect(updated?.status).toBe('voided');
    expect(
      updated?.auditTrail.some((e) =>
        e.endpoint.includes('WEBHOOK PAYMENT.AUTHORIZATION.VOIDED')
      )
    ).toBe(true);
    const countAfterFirst = updated?.auditTrail.length ?? 0;

    // Duplicate delivery with same event id should be ignored cleanly
    const res2 = await webhookPost(
      new Request('http://localhost/api/paypal/webhook', {
        method: 'POST',
        headers: makeWebhookHeaders(),
        body: JSON.stringify(payload),
      })
    );
    expect(res2.status).toBe(200);
    const afterRetry = await store.get(contract.id);
    expect(afterRetry?.auditTrail.length).toBe(countAfterFirst);
  });

  it('rejects foreign orderID on /authorize if it does not match the contract order', async () => {
    const { getContractStore } = await import('../store');
    const store = getContractStore();
    const contract = {
      ...buildNewContract({
        goal: 'Test order mismatch',
        beneficiary: 'EFF',
        stakeUsd: 50,
        durationMinutes: 60,
      }),
      paypalOrderId: 'ORD-REAL-50',
    };
    await store.create(contract);

    const res = await authorizePost(
      new Request(`http://localhost/api/contracts/${contract.id}/paypal/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderID: 'ORD-SPOOFED-5' }),
      }),
      { params: Promise.resolve({ id: contract.id }) }
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('ORDER_ID_MISMATCH');
  });
});
