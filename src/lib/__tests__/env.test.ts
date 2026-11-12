import { afterEach, describe, expect, it } from 'vitest';
import {
  assertGeminiEnv,
  assertPayPalServerEnv,
  getEnvDiagnostics,
  isConfiguredEnvValue,
} from '../env';

describe('environment variable validation & Sandbox safety', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects unset or placeholder values from .env.example', () => {
    expect(isConfiguredEnvValue(undefined)).toBe(false);
    expect(isConfiguredEnvValue('')).toBe(false);
    expect(isConfiguredEnvValue('your_paypal_sandbox_client_id')).toBe(false);
    expect(isConfiguredEnvValue('your_gemini_api_key')).toBe(false);
    expect(isConfiguredEnvValue('real-key-abc')).toBe(true);
  });

  it('throws clear EnvConfigError when PayPal or Gemini credentials are missing', () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;
    delete process.env.GEMINI_API_KEY;

    expect(() => assertPayPalServerEnv()).toThrow(/PAYPAL_CLIENT_ID/);
    expect(() => assertGeminiEnv()).toThrow(/GEMINI_API_KEY/);
  });

  it('blocks live PayPal base URL by default to guarantee Sandbox-only testing', () => {
    process.env.PAYPAL_CLIENT_ID = 'sb-client';
    process.env.PAYPAL_CLIENT_SECRET = 'sb-secret';
    process.env.PAYPAL_BASE_URL = 'https://api-m.paypal.com';
    delete process.env.ALLOW_PAYPAL_LIVE;

    expect(() => assertPayPalServerEnv()).toThrow(/Sandbox/);
  });

  it('reports non-secret diagnostics cleanly without leaking secret strings', () => {
    process.env.PAYPAL_CLIENT_ID = 'sb-cid';
    process.env.PAYPAL_CLIENT_SECRET = 'super-secret-do-not-expose';
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID = 'sb-cid';
    process.env.GEMINI_API_KEY = 'gem-secret-do-not-expose';
    process.env.PAYPAL_WEBHOOK_ID = 'WH-123';
    process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';

    const diag = getEnvDiagnostics();
    expect(diag.ready).toBe(true);
    expect(diag.paypalSandbox).toBe(true);
    expect(diag.missingRequired).toEqual([]);
    expect(JSON.stringify(diag)).not.toContain('super-secret');
    expect(JSON.stringify(diag)).not.toContain('gem-secret');
  });
});
