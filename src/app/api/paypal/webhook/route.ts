import { NextResponse } from 'next/server';
import { createAuditEntry } from '@/lib/audit';
import { assertPayPalWebhookEnv, EnvConfigError } from '@/lib/env';
import {
  PayPalApiError,
  verifyPayPalWebhookSignature,
} from '@/lib/paypal';
import { getContractStore, withAuditEntries } from '@/lib/store';
import { isContractSettled, type Contract } from '@/lib/types';

interface PayPalWebhookResource {
  id?: string;
  status?: string;
  custom_id?: string;
  supplementary_data?: {
    related_ids?: {
      order_id?: string;
      authorization_id?: string;
      capture_id?: string;
    };
  };
}

interface PayPalWebhookEvent {
  id?: string;
  event_type?: string;
  summary?: string;
  create_time?: string;
  resource?: PayPalWebhookResource;
}

const LOGGED_EVENT_TYPES = new Set([
  'PAYMENT.AUTHORIZATION.CREATED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.AUTHORIZATION.VOIDED',
]);

export async function POST(request: Request) {
  let webhookId: string;
  try {
    webhookId = assertPayPalWebhookEnv();
  } catch (error) {
    const message =
      error instanceof EnvConfigError
        ? error.message
        : 'PAYPAL_WEBHOOK_ID is not configured on the server.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const authAlgo = request.headers.get('paypal-auth-algo');
  const certUrl = request.headers.get('paypal-cert-url');
  const transmissionId = request.headers.get('paypal-transmission-id');
  const transmissionSig = request.headers.get('paypal-transmission-sig');
  const transmissionTime = request.headers.get('paypal-transmission-time');

  if (
    !authAlgo ||
    !certUrl ||
    !transmissionId ||
    !transmissionSig ||
    !transmissionTime
  ) {
    return NextResponse.json(
      { error: 'Missing required PayPal webhook signature headers.' },
      { status: 400 }
    );
  }

  let webhookEvent: PayPalWebhookEvent & Record<string, unknown>;
  try {
    webhookEvent = (await request.json()) as PayPalWebhookEvent &
      Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON webhook payload.' },
      { status: 400 }
    );
  }

  try {
    const verification = await verifyPayPalWebhookSignature({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
      webhookId,
      webhookEvent,
    });

    if (!verification.verified) {
      return NextResponse.json(
        {
          error: 'Webhook signature verification failed.',
          verificationStatus: verification.verificationStatus,
          debugId: verification.debugId,
        },
        { status: 401 }
      );
    }

    const eventId =
      typeof webhookEvent.id === 'string' ? webhookEvent.id : transmissionId;
    const eventType =
      typeof webhookEvent.event_type === 'string'
        ? webhookEvent.event_type
        : 'UNKNOWN_EVENT';
    const resource = webhookEvent.resource ?? {};
    const related = resource.supplementary_data?.related_ids;

    const authorizationId =
      related?.authorization_id ??
      (eventType.startsWith('PAYMENT.AUTHORIZATION.') ? resource.id : undefined);
    const orderId =
      related?.order_id ??
      (eventType.startsWith('CHECKOUT.ORDER.') ? resource.id : undefined);

    const store = getContractStore();
    const matched = await store.findByPayPalRefs({
      customId: resource.custom_id ?? null,
      authorizationId: authorizationId ?? null,
      orderId: orderId ?? null,
    });

    if (!matched) {
      return NextResponse.json({
        received: true,
        verified: true,
        matchedContract: false,
        eventType,
        eventId,
      });
    }

    await store.withLock(matched.id, async () => {
      const fresh = await store.get(matched.id);
      if (!fresh) return;

      if (fresh.processedWebhookEventIds.includes(eventId)) {
        return;
      }

      const webhookEntry = createAuditEntry({
        actor: 'webhook',
        endpoint: `WEBHOOK ${eventType}`,
        httpStatus: 200,
        paypalDebugId: verification.debugId,
        summary: LOGGED_EVENT_TYPES.has(eventType)
          ? `Verified PayPal webhook ${eventType} (event ${eventId}, resource ${resource.id ?? 'n/a'}, status ${resource.status ?? 'n/a'}).`
          : `Verified PayPal webhook ${eventType} (event ${eventId}).`,
      });

      await store.update(fresh.id, (curr) => {
        if (curr.processedWebhookEventIds.includes(eventId)) return curr;

        let next: Contract = {
          ...withAuditEntries(curr, [
            ...verification.auditEntries,
            webhookEntry,
          ]),
          processedWebhookEventIds: [...curr.processedWebhookEventIds, eventId],
        };

        // Reconcile state cleanly if webhook reports terminal dashboard/async settlement
        // while never overriding an already settled contract.
        if (eventType === 'PAYMENT.AUTHORIZATION.CREATED') {
          next = {
            ...next,
            paypalAuthorizationId:
              curr.paypalAuthorizationId ?? resource.id ?? authorizationId,
            paypalAuthStatus: resource.status ?? curr.paypalAuthStatus ?? 'CREATED',
            status:
              curr.status === 'pending_auth' ? 'authorized' : curr.status,
          };
        } else if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
          next = {
            ...next,
            paypalCaptureId: curr.paypalCaptureId ?? resource.id,
            paypalAuthStatus: 'CAPTURED',
            status: isContractSettled(curr.status) ? curr.status : 'captured',
            settledAt: curr.settledAt ?? new Date().toISOString(),
          };
        } else if (eventType === 'PAYMENT.AUTHORIZATION.VOIDED') {
          next = {
            ...next,
            paypalAuthStatus: 'VOIDED',
            status: isContractSettled(curr.status) ? curr.status : 'voided',
            settledAt: curr.settledAt ?? new Date().toISOString(),
          };
        }

        return next;
      });
    });

    return NextResponse.json({
      received: true,
      verified: true,
      matchedContract: true,
      contractId: matched.id,
      eventType,
      eventId,
    });
  } catch (error) {
    if (error instanceof PayPalApiError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          debugId: error.debugId,
        },
        { status: error.status >= 400 ? error.status : 502 }
      );
    }

    const message =
      error instanceof Error ? error.message : 'Webhook processing failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
