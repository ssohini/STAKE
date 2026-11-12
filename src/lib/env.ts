/**
 * Centralized environment variable validation and non-secret readiness diagnostics.
 * Never returns or logs actual secret values.
 */

export class EnvConfigError extends Error {
  readonly missingVars: string[];

  constructor(message: string, missingVars: string[]) {
    super(message);
    this.name = 'EnvConfigError';
    this.missingVars = missingVars;
  }
}

const PLACEHOLDER_PREFIXES = ['your_', 'replace_', 'changeme', '<'];

export function isConfiguredEnvValue(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const lower = trimmed.toLowerCase();
  return !PLACEHOLDER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function getPayPalBaseUrl(): string {
  const raw =
    process.env.PAYPAL_BASE_URL?.trim() || 'https://api-m.sandbox.paypal.com';
  return raw.replace(/\/+$/, '');
}

export function isPayPalSandboxUrl(baseUrl: string): boolean {
  return baseUrl.toLowerCase().includes('sandbox.paypal.com');
}

export function assertPayPalServerEnv(): {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
} {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const baseUrl = getPayPalBaseUrl();

  const missing: string[] = [];
  if (!isConfiguredEnvValue(clientId)) missing.push('PAYPAL_CLIENT_ID');
  if (!isConfiguredEnvValue(clientSecret)) missing.push('PAYPAL_CLIENT_SECRET');

  if (missing.length > 0) {
    throw new EnvConfigError(
      `Missing or placeholder PayPal configuration: ${missing.join(', ')}. See ENVIRONMENT_SETUP.md.`,
      missing
    );
  }

  // Safety guard: Stake hackathon mode strictly uses PayPal Sandbox unless explicitly overridden.
  if (!isPayPalSandboxUrl(baseUrl) && process.env.ALLOW_PAYPAL_LIVE !== 'true') {
    throw new EnvConfigError(
      `PAYPAL_BASE_URL (${baseUrl}) is not a PayPal Sandbox URL. Set PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com to prevent real-money charges.`,
      ['PAYPAL_BASE_URL']
    );
  }

  return {
    clientId: clientId!.trim(),
    clientSecret: clientSecret!.trim(),
    baseUrl,
  };
}

export function assertPayPalWebhookEnv(): string {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!isConfiguredEnvValue(webhookId)) {
    throw new EnvConfigError(
      'Missing or placeholder PAYPAL_WEBHOOK_ID in environment variables. See ENVIRONMENT_SETUP.md.',
      ['PAYPAL_WEBHOOK_ID']
    );
  }
  return webhookId.trim();
}

export function assertGeminiEnv(): { apiKey: string; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!isConfiguredEnvValue(apiKey)) {
    throw new EnvConfigError(
      'Missing or placeholder GEMINI_API_KEY in environment variables. See ENVIRONMENT_SETUP.md.',
      ['GEMINI_API_KEY']
    );
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  return { apiKey: apiKey.trim(), model };
}

export interface EnvDiagnostics {
  ready: boolean;
  paypalConfigured: boolean;
  paypalClientSdkConfigured: boolean;
  paypalWebhookConfigured: boolean;
  paypalSandbox: boolean;
  geminiConfigured: boolean;
  storageMode: 'upstash' | 'json';
  cronSecretConfigured: boolean;
  missingRequired: string[];
}

export function getEnvDiagnostics(): EnvDiagnostics {
  const paypalServerOk =
    isConfiguredEnvValue(process.env.PAYPAL_CLIENT_ID) &&
    isConfiguredEnvValue(process.env.PAYPAL_CLIENT_SECRET);
  const paypalClientOk = isConfiguredEnvValue(
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
  );
  const webhookOk = isConfiguredEnvValue(process.env.PAYPAL_WEBHOOK_ID);
  const geminiOk = isConfiguredEnvValue(process.env.GEMINI_API_KEY);
  const upstashOk =
    isConfiguredEnvValue(process.env.UPSTASH_REDIS_REST_URL) &&
    isConfiguredEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN);
  const sandbox = isPayPalSandboxUrl(getPayPalBaseUrl());

  const missingRequired: string[] = [];
  if (!isConfiguredEnvValue(process.env.PAYPAL_CLIENT_ID)) {
    missingRequired.push('PAYPAL_CLIENT_ID');
  }
  if (!isConfiguredEnvValue(process.env.PAYPAL_CLIENT_SECRET)) {
    missingRequired.push('PAYPAL_CLIENT_SECRET');
  }
  if (!paypalClientOk) {
    missingRequired.push('NEXT_PUBLIC_PAYPAL_CLIENT_ID');
  }
  if (!webhookOk) {
    missingRequired.push('PAYPAL_WEBHOOK_ID');
  }
  if (!geminiOk) {
    missingRequired.push('GEMINI_API_KEY');
  }

  return {
    ready:
      paypalServerOk &&
      paypalClientOk &&
      geminiOk &&
      sandbox,
    paypalConfigured: paypalServerOk,
    paypalClientSdkConfigured: paypalClientOk,
    paypalWebhookConfigured: webhookOk,
    paypalSandbox: sandbox,
    geminiConfigured: geminiOk,
    storageMode: upstashOk ? 'upstash' : 'json',
    cronSecretConfigured: isConfiguredEnvValue(process.env.CRON_SECRET),
    missingRequired,
  };
}
