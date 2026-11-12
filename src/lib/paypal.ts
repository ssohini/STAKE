import crypto from 'node:crypto';
import { createAuditEntry } from './audit';
import { assertPayPalServerEnv, EnvConfigError } from './env';
import type { AuditTrailEntry } from './types';

export interface PayPalErrorDetail {
  issue?: string;
  description?: string;
  field?: string;
  value?: string;
}

export class PayPalApiError extends Error {
  readonly status: number;
  readonly debugId: string | null;
  readonly code: string;
  readonly details: PayPalErrorDetail[];
  readonly auditEntries: AuditTrailEntry[];
  readonly isTransient: boolean;

  constructor(params: {
    message: string;
    status: number;
    debugId: string | null;
    code: string;
    details?: PayPalErrorDetail[];
    auditEntries?: AuditTrailEntry[];
    isTransient?: boolean;
  }) {
    super(params.message);
    this.name = 'PayPalApiError';
    this.status = params.status;
    this.debugId = params.debugId;
    this.code = params.code;
    this.details = params.details ?? [];
    this.auditEntries = params.auditEntries ?? [];
    this.isTransient = params.isTransient ?? params.status >= 500;
  }
}

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

const PAYPAL_TIMEOUT_MS = 15_000;

// Module-level token cache + single-flight promise to avoid redundant OAuth requests.
let cachedToken: TokenCache | null = null;
let inflightTokenRequest: Promise<{
  token: string;
  auditEntry: AuditTrailEntry;
}> | null = null;

export function clearPayPalTokenCacheForTests(): void {
  cachedToken = null;
  inflightTokenRequest = null;
}

function getPayPalConfig() {
  try {
    return assertPayPalServerEnv();
  } catch (err) {
    if (err instanceof EnvConfigError) {
      throw new PayPalApiError({
        message: err.message,
        status: 500,
        debugId: null,
        code: 'PAYPAL_CONFIG_MISSING',
        isTransient: false,
      });
    }
    throw err;
  }
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapFriendlyPayPalMessage(
  code: string,
  fallbackMessage: string,
  details: PayPalErrorDetail[]
): string {
  const firstIssue = details[0]?.issue ?? code;
  const issueUpper = firstIssue.toUpperCase();

  switch (issueUpper) {
    case 'INSTRUMENT_DECLINED':
      return 'Funding instrument was declined by PayPal. Try another sandbox payment method.';
    case 'AUTHORIZATION_EXPIRED':
    case 'AUTH_EXPIRED':
      return 'PayPal authorization has expired (sandbox honor/validity window elapsed).';
    case 'AUTHORIZATION_VOIDED':
    case 'AUTHORIZATION_ALREADY_VOIDED':
      return 'PayPal authorization was already voided.';
    case 'AUTHORIZATION_ALREADY_CAPTURED':
    case 'MAX_CAPTURE_EXCEEDED':
      return 'PayPal authorization was already captured.';
    case 'ORDER_NOT_APPROVED':
      return 'Buyer has not approved the PayPal order yet.';
    case 'ORDER_ALREADY_AUTHORIZED':
      return 'This PayPal order has already been authorized.';
    default:
      return details[0]?.description || fallbackMessage;
  }
}

function buildPayPalError(params: {
  endpoint: string;
  status: number;
  debugId: string | null;
  rawBody: string;
  priorAuditEntries?: AuditTrailEntry[];
}): PayPalApiError {
  const parsed = safeParseJson(params.rawBody);
  const details = Array.isArray(parsed?.details)
    ? (parsed.details as PayPalErrorDetail[])
    : [];

  const code =
    (typeof parsed?.name === 'string' && parsed.name) ||
    (typeof parsed?.error === 'string' && parsed.error) ||
    `HTTP_${params.status}`;

  const rawMessage =
    (typeof parsed?.message === 'string' && parsed.message) ||
    (typeof parsed?.error_description === 'string' && parsed.error_description) ||
    `PayPal API error (HTTP ${params.status})`;

  const debugId =
    params.debugId ??
    (typeof parsed?.debug_id === 'string' ? parsed.debug_id : null);

  const friendlyMessage = mapFriendlyPayPalMessage(code, rawMessage, details);
  const issueLabel = details[0]?.issue ? `${code}/${details[0].issue}` : code;

  const entry = createAuditEntry({
    actor: 'paypal',
    endpoint: params.endpoint,
    httpStatus: params.status,
    paypalDebugId: debugId,
    summary: `Failed (${issueLabel}): ${friendlyMessage}`,
  });

  return new PayPalApiError({
    message: friendlyMessage,
    status: params.status,
    debugId,
    code: details[0]?.issue || code,
    details,
    auditEntries: [...(params.priorAuditEntries ?? []), entry],
    isTransient: params.status >= 500 || params.status === 429,
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  endpointLabel: string,
  priorAuditEntries: AuditTrailEntry[] = []
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    const message = isTimeout
      ? `PayPal request timed out after ${PAYPAL_TIMEOUT_MS / 1000}s on ${endpointLabel}.`
      : `Network error calling PayPal on ${endpointLabel}: ${error instanceof Error ? error.message : 'Unknown network error'}`;

    const errEntry = createAuditEntry({
      actor: 'paypal',
      endpoint: endpointLabel,
      httpStatus: isTimeout ? 504 : 502,
      paypalDebugId: null,
      summary: message,
    });

    throw new PayPalApiError({
      message,
      status: isTimeout ? 504 : 502,
      debugId: null,
      code: isTimeout ? 'PAYPAL_TIMEOUT' : 'PAYPAL_NETWORK_ERROR',
      auditEntries: [...priorAuditEntries, errEntry],
      isTransient: true,
    });
  }
}

/**
 * Obtains a cached OAuth2 access token via POST /v1/oauth2/token (client_credentials).
 * Returns an audit entry whenever a fresh token fetch is performed.
 */
export async function getPayPalAccessToken(): Promise<{
  token: string;
  auditEntry?: AuditTrailEntry;
}> {
  const now = Date.now();
  // Refresh 60s before actual expiry to avoid clock skew failures.
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) {
    return { token: cachedToken.accessToken };
  }

  if (!inflightTokenRequest) {
    inflightTokenRequest = (async () => {
      const { clientId, clientSecret, baseUrl } = getPayPalConfig();
      const endpoint = 'POST /v1/oauth2/token';
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64'
      );

      const response = await fetchWithTimeout(
        `${baseUrl}/v1/oauth2/token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: 'grant_type=client_credentials',
          cache: 'no-store',
        },
        endpoint
      );

      const debugId = response.headers.get('paypal-debug-id');
      const rawText = await response.text();

      if (!response.ok) {
        throw buildPayPalError({
          endpoint,
          status: response.status,
          debugId,
          rawBody: rawText,
        });
      }

      const data = safeParseJson(rawText);
      const accessToken =
        typeof data?.access_token === 'string' ? data.access_token : null;
      const expiresInSec =
        typeof data?.expires_in === 'number' ? data.expires_in : 32400;

      if (!accessToken) {
        throw new PayPalApiError({
          message: 'PayPal OAuth response missing access_token.',
          status: response.status,
          debugId,
          code: 'INVALID_TOKEN_RESPONSE',
        });
      }

      cachedToken = {
        accessToken,
        expiresAtMs: Date.now() + expiresInSec * 1000,
      };

      const auditEntry = createAuditEntry({
        actor: 'paypal',
        endpoint,
        httpStatus: response.status,
        paypalDebugId: debugId,
        summary: `Minted OAuth2 sandbox bearer token (TTL ${expiresInSec}s; cached in memory).`,
      });

      return { token: accessToken, auditEntry };
    })().finally(() => {
      inflightTokenRequest = null;
    });
  }

  return inflightTokenRequest;
}

async function paypalRequest<T>(params: {
  method: 'POST' | 'GET';
  path: string;
  auditEndpointLabel?: string;
  body?: unknown;
  requestId?: string;
  summaryFormatter: (status: number, data: T | null) => string;
}): Promise<{
  data: T | null;
  status: number;
  debugId: string | null;
  auditEntries: AuditTrailEntry[];
}> {
  const { baseUrl } = getPayPalConfig();
  const { token, auditEntry: tokenAudit } = await getPayPalAccessToken();
  const priorAuditEntries = tokenAudit ? [tokenAudit] : [];
  const endpoint = params.auditEndpointLabel ?? `${params.method} ${params.path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    Prefer: 'return=representation',
  };

  if (params.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (params.requestId) {
    headers['PayPal-Request-Id'] = params.requestId;
  }

  const response = await fetchWithTimeout(
    `${baseUrl}${params.path}`,
    {
      method: params.method,
      headers,
      body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
      cache: 'no-store',
    },
    endpoint,
    priorAuditEntries
  );

  const debugId = response.headers.get('paypal-debug-id');
  const rawText = await response.text();

  if (!response.ok) {
    // If cached token was somehow revoked server-side, clear it for next attempt.
    if (response.status === 401) {
      cachedToken = null;
    }
    throw buildPayPalError({
      endpoint,
      status: response.status,
      debugId,
      rawBody: rawText,
      priorAuditEntries,
    });
  }

  const parsed = safeParseJson(rawText) as T | null;
  const entry = createAuditEntry({
    actor: 'paypal',
    endpoint,
    httpStatus: response.status,
    paypalDebugId: debugId,
    summary: params.summaryFormatter(response.status, parsed),
  });

  return {
    data: parsed,
    status: response.status,
    debugId,
    auditEntries: [...priorAuditEntries, entry],
  };
}

export interface CreateOrderResult {
  orderId: string;
  status: string;
  auditEntries: AuditTrailEntry[];
}

/**
 * Creates a PayPal Order with intent="AUTHORIZE" and PayPal-Request-Id idempotency.
 */
export async function createAuthorizeOrder(params: {
  contractId: string;
  stakeFormatted: string;
  beneficiary: string;
  requestId?: string;
}): Promise<CreateOrderResult> {
  const requestId =
    params.requestId ?? `stake-order-${params.contractId}-${crypto.randomUUID()}`;

  const description = `Stake $${params.stakeFormatted} USD vs ${params.beneficiary}`
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 127);

  const res = await paypalRequest<{
    id?: string;
    status?: string;
  }>({
    method: 'POST',
    path: '/v2/checkout/orders',
    requestId,
    body: {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: params.contractId,
          custom_id: params.contractId,
          description,
          amount: {
            currency_code: 'USD',
            value: params.stakeFormatted,
          },
        },
      ],
    },
    summaryFormatter: (_status, data) =>
      `Created AUTHORIZE order ${data?.id ?? 'unknown'} for $${params.stakeFormatted} USD (status: ${data?.status ?? 'CREATED'}).`,
  });

  const orderId = res.data?.id;
  if (!orderId) {
    throw new PayPalApiError({
      message: 'PayPal create order response did not include an order ID.',
      status: res.status,
      debugId: res.debugId,
      code: 'MISSING_ORDER_ID',
      auditEntries: res.auditEntries,
      isTransient: false,
    });
  }

  return {
    orderId,
    status: res.data?.status ?? 'CREATED',
    auditEntries: res.auditEntries,
  };
}

export interface AuthorizationDetailsResult {
  authorizationId: string;
  status: string;
  amountValue?: string;
  currencyCode?: string;
  customId?: string;
  expirationTime?: string;
  auditEntries: AuditTrailEntry[];
}

/**
 * Queries PayPal's live authorization state via GET /v2/payments/authorizations/{id}.
 * Used both to verify authorized amount/currency/eligibility and to reconcile after timeouts.
 */
export async function getAuthorizationDetails(
  authorizationId: string
): Promise<AuthorizationDetailsResult> {
  const res = await paypalRequest<{
    id?: string;
    status?: string;
    custom_id?: string;
    expiration_time?: string;
    amount?: {
      currency_code?: string;
      value?: string;
    };
  }>({
    method: 'GET',
    path: `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
    auditEndpointLabel: `GET /v2/payments/authorizations/${authorizationId}`,
    summaryFormatter: (_status, data) =>
      `Verified authorization ${authorizationId} state from PayPal: status=${data?.status ?? 'UNKNOWN'}, amount=${data?.amount?.value ?? '?'} ${data?.amount?.currency_code ?? ''}.`,
  });

  return {
    authorizationId: res.data?.id ?? authorizationId,
    status: (res.data?.status ?? 'UNKNOWN').toUpperCase(),
    amountValue: res.data?.amount?.value,
    currencyCode: res.data?.amount?.currency_code?.toUpperCase(),
    customId: res.data?.custom_id,
    expirationTime: res.data?.expiration_time,
    auditEntries: res.auditEntries,
  };
}

function amountsMatch(actual: string, expected: string): boolean {
  const a = Math.round(Number(actual) * 100);
  const b = Math.round(Number(expected) * 100);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

export interface AuthorizeOrderResult {
  orderId: string;
  authorizationId: string;
  authorizationStatus: string;
  amountValue?: string;
  currencyCode?: string;
  expirationTime?: string;
  auditEntries: AuditTrailEntry[];
}

interface PayPalOrderAuthorizeResponse {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: {
      currency_code?: string;
      value?: string;
    };
    payments?: {
      authorizations?: Array<{
        id?: string;
        status?: string;
        custom_id?: string;
        expiration_time?: string;
        amount?: {
          currency_code?: string;
          value?: string;
        };
      }>;
    };
  }>;
}

/**
 * Authorizes an approved PayPal Order, extracts purchase_units[0].payments.authorizations[0].id,
 * and verifies amount, currency, custom_id, and authorization status server-side.
 */
export async function authorizeOrder(params: {
  orderId: string;
  expectedAmount?: string;
  expectedCurrency?: string;
  expectedContractId?: string;
  requestId?: string;
}): Promise<AuthorizeOrderResult> {
  const requestId = params.requestId ?? `stake-auth-${params.orderId}`;

  const res = await paypalRequest<PayPalOrderAuthorizeResponse>({
    method: 'POST',
    path: `/v2/checkout/orders/${encodeURIComponent(params.orderId)}/authorize`,
    auditEndpointLabel: `POST /v2/checkout/orders/${params.orderId}/authorize`,
    requestId,
    body: {},
    summaryFormatter: (_status, data) => {
      const auth = data?.purchase_units?.[0]?.payments?.authorizations?.[0];
      return `Authorized order ${params.orderId} -> authorization ${auth?.id ?? 'unknown'} (status: ${auth?.status ?? 'UNKNOWN'}).`;
    },
  });

  const unit = res.data?.purchase_units?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  if (!auth?.id) {
    throw new PayPalApiError({
      message:
        'PayPal authorize response did not return purchase_units[0].payments.authorizations[0].id.',
      status: res.status,
      debugId: res.debugId,
      code: 'MISSING_AUTHORIZATION_ID',
      auditEntries: res.auditEntries,
      isTransient: false,
    });
  }

  let status = (auth.status ?? 'CREATED').toUpperCase();
  let amountValue = auth.amount?.value ?? unit?.amount?.value;
  let currencyCode = (
    auth.amount?.currency_code ?? unit?.amount?.currency_code
  )?.toUpperCase();
  let customId = auth.custom_id ?? unit?.custom_id ?? unit?.reference_id;
  let expirationTime = auth.expiration_time;
  const allAuditEntries = [...res.auditEntries];

  // If the caller expects amount/contract verification and /authorize response omitted details,
  // verify directly against GET /v2/payments/authorizations/{id}.
  if (
    params.expectedAmount &&
    (!amountValue || !currencyCode || (params.expectedContractId && !customId))
  ) {
    const verified = await getAuthorizationDetails(auth.id);
    allAuditEntries.push(...verified.auditEntries);
    status = verified.status;
    amountValue = amountValue ?? verified.amountValue;
    currencyCode = currencyCode ?? verified.currencyCode;
    customId = customId ?? verified.customId;
    expirationTime = expirationTime ?? verified.expirationTime;
  }

  if (status === 'DENIED' || status === 'VOIDED' || status === 'EXPIRED') {
    throw new PayPalApiError({
      message: `PayPal authorization returned non-holdable status "${status}".`,
      status: 422,
      debugId: res.debugId,
      code: `AUTHORIZATION_${status}`,
      auditEntries: allAuditEntries,
      isTransient: false,
    });
  }

  if (
    params.expectedContractId &&
    customId &&
    customId !== params.expectedContractId
  ) {
    throw new PayPalApiError({
      message: `PayPal order belongs to contract "${customId}", not "${params.expectedContractId}".`,
      status: 409,
      debugId: res.debugId,
      code: 'CONTRACT_ID_MISMATCH',
      auditEntries: allAuditEntries,
      isTransient: false,
    });
  }

  if (
    params.expectedCurrency &&
    currencyCode &&
    currencyCode !== params.expectedCurrency.toUpperCase()
  ) {
    throw new PayPalApiError({
      message: `PayPal authorization currency "${currencyCode}" does not match expected "${params.expectedCurrency}".`,
      status: 422,
      debugId: res.debugId,
      code: 'CURRENCY_MISMATCH',
      auditEntries: allAuditEntries,
      isTransient: false,
    });
  }

  if (
    params.expectedAmount &&
    amountValue &&
    !amountsMatch(amountValue, params.expectedAmount)
  ) {
    throw new PayPalApiError({
      message: `PayPal authorized amount "$${amountValue}" does not match contract stake "$${params.expectedAmount}".`,
      status: 422,
      debugId: res.debugId,
      code: 'AMOUNT_MISMATCH',
      auditEntries: allAuditEntries,
      isTransient: false,
    });
  }

  return {
    orderId: res.data?.id ?? params.orderId,
    authorizationId: auth.id,
    authorizationStatus: status,
    amountValue,
    currencyCode,
    expirationTime,
    auditEntries: allAuditEntries,
  };
}

export interface CaptureAuthorizationResult {
  captureId: string;
  status: string;
  auditEntries: AuditTrailEntry[];
}

/**
 * Captures a held PayPal authorization (loser forfeits stake).
 */
export async function captureAuthorization(params: {
  authorizationId: string;
  contractId: string;
  requestId?: string;
}): Promise<CaptureAuthorizationResult> {
  const requestId =
    params.requestId ?? `stake-capture-${params.authorizationId}`;

  const res = await paypalRequest<{
    id?: string;
    status?: string;
  }>({
    method: 'POST',
    path: `/v2/payments/authorizations/${encodeURIComponent(params.authorizationId)}/capture`,
    auditEndpointLabel: `POST /v2/payments/authorizations/${params.authorizationId}/capture`,
    requestId,
    body: {
      final_capture: true,
      note_to_payer: `Stake contract ${params.contractId} failed or expired.`,
    },
    summaryFormatter: (_status, data) =>
      `Captured authorization ${params.authorizationId} -> capture ${data?.id ?? 'unknown'} (status: ${data?.status ?? 'COMPLETED'}).`,
  });

  return {
    captureId: res.data?.id ?? params.authorizationId,
    status: (res.data?.status ?? 'COMPLETED').toUpperCase(),
    auditEntries: res.auditEntries,
  };
}

export interface VoidAuthorizationResult {
  status: string;
  auditEntries: AuditTrailEntry[];
}

/**
 * Voids a held PayPal authorization (winner keeps their money).
 * Handles both HTTP 204 No Content and HTTP 200 Prefer=return=representation.
 */
export async function voidAuthorization(params: {
  authorizationId: string;
  requestId?: string;
}): Promise<VoidAuthorizationResult> {
  const requestId = params.requestId ?? `stake-void-${params.authorizationId}`;

  const res = await paypalRequest<{
    id?: string;
    status?: string;
  }>({
    method: 'POST',
    path: `/v2/payments/authorizations/${encodeURIComponent(params.authorizationId)}/void`,
    auditEndpointLabel: `POST /v2/payments/authorizations/${params.authorizationId}/void`,
    requestId,
    summaryFormatter: (httpStatus, data) =>
      `Voided authorization ${params.authorizationId} (HTTP ${httpStatus}, status: ${data?.status ?? 'VOIDED'}). Money released.`,
  });

  return {
    status: (res.data?.status ?? 'VOIDED').toUpperCase(),
    auditEntries: res.auditEntries,
  };
}

export interface WebhookSignatureVerifyInput {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  webhookId: string;
  webhookEvent: Record<string, unknown>;
}

export interface WebhookSignatureVerifyResult {
  verified: boolean;
  verificationStatus: string;
  httpStatus: number;
  debugId: string | null;
  auditEntries: AuditTrailEntry[];
}

/**
 * Verifies an incoming PayPal webhook signature using POST /v1/notifications/verify-webhook-signature.
 */
export async function verifyPayPalWebhookSignature(
  input: WebhookSignatureVerifyInput
): Promise<WebhookSignatureVerifyResult> {
  const res = await paypalRequest<{
    verification_status?: string;
  }>({
    method: 'POST',
    path: '/v1/notifications/verify-webhook-signature',
    body: {
      auth_algo: input.authAlgo,
      cert_url: input.certUrl,
      transmission_id: input.transmissionId,
      transmission_sig: input.transmissionSig,
      transmission_time: input.transmissionTime,
      webhook_id: input.webhookId,
      webhook_event: input.webhookEvent,
    },
    summaryFormatter: (_httpStatus, data) =>
      `Webhook signature verification returned "${data?.verification_status ?? 'UNKNOWN'}".`,
  });

  const verificationStatus = res.data?.verification_status ?? 'FAILURE';
  return {
    verified: verificationStatus === 'SUCCESS',
    verificationStatus,
    httpStatus: res.status,
    debugId: res.debugId,
    auditEntries: res.auditEntries,
  };
}
