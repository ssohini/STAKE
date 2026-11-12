import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redactSecrets } from '../audit';
import {
  authorizeOrder,
  captureAuthorization,
  clearPayPalTokenCacheForTests,
  createAuthorizeOrder,
  getAuthorizationDetails,
  PayPalApiError,
  voidAuthorization,
} from '../paypal';

describe('PayPal REST v2 client (mocked fetch)', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearPayPalTokenCacheForTests();
    process.env.PAYPAL_CLIENT_ID = 'test-client-id';
    process.env.PAYPAL_CLIENT_SECRET = 'super-secret-value-123';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('caches OAuth token and executes create -> authorize (verified) -> void (204) with PayPal-Request-Id and debug IDs', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = url.toString();
      if (target.endsWith('/v1/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok-sandbox-abc', expires_in: 32400 }),
          { status: 200, headers: { 'paypal-debug-id': 'dbg-tok' } }
        );
      }
      if (target.endsWith('/v2/checkout/orders')) {
        const body = JSON.parse(String(init?.body));
        expect(body.intent).toBe('AUTHORIZE');
        expect((init?.headers as Record<string, string>)['PayPal-Request-Id']).toBeTruthy();
        return new Response(
          JSON.stringify({ id: 'ORD-99', status: 'CREATED' }),
          { status: 201, headers: { 'paypal-debug-id': 'dbg-ord' } }
        );
      }
      if (target.endsWith('/v2/checkout/orders/ORD-99/authorize')) {
        expect((init?.headers as Record<string, string>)['PayPal-Request-Id']).toBeTruthy();
        return new Response(
          JSON.stringify({
            id: 'ORD-99',
            purchase_units: [
              {
                custom_id: 'c123',
                amount: { currency_code: 'USD', value: '25.00' },
                payments: {
                  authorizations: [
                    {
                      id: 'AUTH-99',
                      status: 'CREATED',
                      amount: { currency_code: 'USD', value: '25.00' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 201, headers: { 'paypal-debug-id': 'dbg-auth' } }
        );
      }
      if (target.endsWith('/v2/payments/authorizations/AUTH-99')) {
        return new Response(
          JSON.stringify({
            id: 'AUTH-99',
            status: 'CREATED',
            custom_id: 'c123',
            amount: { currency_code: 'USD', value: '25.00' },
          }),
          { status: 200, headers: { 'paypal-debug-id': 'dbg-get-auth' } }
        );
      }
      if (target.endsWith('/v2/payments/authorizations/AUTH-99/void')) {
        expect((init?.headers as Record<string, string>)['PayPal-Request-Id']).toBeTruthy();
        return new Response(null, {
          status: 204,
          headers: { 'paypal-debug-id': 'dbg-void' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${target}`);
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const order = await createAuthorizeOrder({
      contractId: 'c123',
      stakeFormatted: '25.00',
      beneficiary: 'Charity',
    });
    expect(order.orderId).toBe('ORD-99');
    expect(order.auditEntries.map((e) => e.paypalDebugId)).toEqual([
      'dbg-tok',
      'dbg-ord',
    ]);

    const auth = await authorizeOrder({
      orderId: 'ORD-99',
      expectedAmount: '25.00',
      expectedCurrency: 'USD',
      expectedContractId: 'c123',
    });
    expect(auth.authorizationId).toBe('AUTH-99');
    expect(auth.amountValue).toBe('25.00');
    expect(auth.auditEntries).toHaveLength(1);
    expect(auth.auditEntries[0]?.paypalDebugId).toBe('dbg-auth');

    const details = await getAuthorizationDetails('AUTH-99');
    expect(details.status).toBe('CREATED');
    expect(details.amountValue).toBe('25.00');

    const voided = await voidAuthorization({ authorizationId: 'AUTH-99' });
    expect(voided.status).toBe('VOIDED');
    expect(voided.auditEntries[0]?.httpStatus).toBe(204);

    // OAuth endpoint was hit exactly once across 4 calls
    const tokenCalls = fetchMock.mock.calls.filter(([u]) =>
      u.toString().endsWith('/v1/oauth2/token')
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it('rejects authorization when PayPal amount or contract custom_id mismatches expected stake', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target.endsWith('/v1/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          id: 'ORD-MISMATCH',
          purchase_units: [
            {
              custom_id: 'c123',
              payments: {
                authorizations: [
                  {
                    id: 'AUTH-LOW',
                    status: 'CREATED',
                    amount: { currency_code: 'USD', value: '5.00' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 201, headers: { 'paypal-debug-id': 'dbg-mismatch' } }
      );
    }) as unknown as typeof fetch;

    await expect(
      authorizeOrder({
        orderId: 'ORD-MISMATCH',
        expectedAmount: '25.00',
        expectedCurrency: 'USD',
        expectedContractId: 'c123',
      })
    ).rejects.toMatchObject({
      code: 'AMOUNT_MISMATCH',
      status: 422,
    });
  });

  it('surfaces PayPal error details & debug id on capture failure', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const target = url.toString();
      if (target.endsWith('/v1/oauth2/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok-xyz', expires_in: 3600 }),
          { status: 200, headers: { 'paypal-debug-id': 'dbg-t' } }
        );
      }
      return new Response(
        JSON.stringify({
          name: 'UNPROCESSABLE_ENTITY',
          message: 'The requested action could not be performed.',
          debug_id: 'dbg-expired',
          details: [{ issue: 'AUTHORIZATION_EXPIRED' }],
        }),
        { status: 422, headers: { 'paypal-debug-id': 'dbg-expired' } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      captureAuthorization({ authorizationId: 'AUTH-DEAD', contractId: 'c1' })
    ).rejects.toMatchObject({
      name: 'PayPalApiError',
      status: 422,
      code: 'AUTHORIZATION_EXPIRED',
      debugId: 'dbg-expired',
    } satisfies Partial<PayPalApiError>);
  });

  it('redacts secrets and tokens from audit summaries', () => {
    const dirty =
      'Bearer eyJhbGciOi.secretToken Basic dXNlcjpwYXNz client_secret="xyz123" AIzaSyDummyKey123456789012345';
    const clean = redactSecrets(dirty);
    expect(clean).not.toContain('secretToken');
    expect(clean).not.toContain('dXNlcjpwYXNz');
    expect(clean).not.toContain('xyz123');
    expect(clean).not.toContain('AIzaSyDummyKey');
  });
});
