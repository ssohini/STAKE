import crypto from 'node:crypto';
import type { AuditActor, AuditTrailEntry } from './types';

const SENSITIVE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Basic\s+[A-Za-z0-9+/=]{8,}/gi,
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /("?(?:access_token|client_secret|PAYPAL_CLIENT_SECRET|GEMINI_API_KEY|UPSTASH_REDIS_REST_TOKEN)"?\s*[:=]\s*"?)([^"\s,}]+)/gi,
];

/**
 * Strips any accidental credential or bearer/basic token fragments before storing or logging.
 */
export function redactSecrets(input: string): string {
  let output = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    output = output.replace(pattern, (match, prefix?: string) => {
      if (prefix) return `${prefix}[REDACTED]`;
      if (match.toLowerCase().startsWith('bearer ')) return 'Bearer [REDACTED]';
      if (match.toLowerCase().startsWith('basic ')) return 'Basic [REDACTED]';
      return '[REDACTED]';
    });
  }
  return output;
}

export function createAuditEntry(params: {
  actor: AuditActor;
  endpoint: string;
  httpStatus: number | null;
  paypalDebugId?: string | null;
  summary: string;
  timestamp?: string;
}): AuditTrailEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: params.timestamp ?? new Date().toISOString(),
    actor: params.actor,
    endpoint: params.endpoint,
    httpStatus: params.httpStatus,
    paypalDebugId: params.paypalDebugId ?? null,
    summary: redactSecrets(params.summary),
  };
}
