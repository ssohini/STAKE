import { NextResponse } from 'next/server';
import { createAuditEntry } from '@/lib/audit';
import { authorizeOrder, PayPalApiError } from '@/lib/paypal';
import { getContractStore, withAuditEntries } from '@/lib/store';
import { isContractSettled } from '@/lib/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const store = getContractStore();

  let body: { orderID?: string; orderId?: string } = {};
  try {
    body = (await request.json()) as { orderID?: string; orderId?: string };
  } catch {
    // Allow fallback to stored paypalOrderId when body is omitted
  }

  try {
    return await store.withLock(id, async () => {
      const contract = await store.get(id);
      if (!contract) {
        return NextResponse.json(
          { error: 'Contract not found.' },
          { status: 404 }
        );
      }

      if (isContractSettled(contract.status)) {
        return NextResponse.json(
          {
            error: `Contract is already settled (${contract.status}).`,
          },
          { status: 409 }
        );
      }

      const providedOrderId = body.orderID?.trim() || body.orderId?.trim();
      const targetOrderId = providedOrderId || contract.paypalOrderId;

      if (!targetOrderId) {
        return NextResponse.json(
          { error: 'Missing PayPal orderID to authorize.' },
          { status: 400 }
        );
      }

      // Security: never allow authorizing an arbitrary unrelated order against this contract.
      if (
        contract.paypalOrderId &&
        providedOrderId &&
        providedOrderId !== contract.paypalOrderId
      ) {
        return NextResponse.json(
          {
            error:
              'Provided PayPal orderID does not match the order created for this contract.',
            code: 'ORDER_ID_MISMATCH',
          },
          { status: 409 }
        );
      }

      // Idempotent guard if this exact order was already authorized on this contract.
      if (
        contract.paypalAuthorizationId &&
        contract.paypalOrderId === targetOrderId
      ) {
        return NextResponse.json({
          contract,
          authorizationId: contract.paypalAuthorizationId,
        });
      }

      if (contract.paypalAuthorizationId) {
        return NextResponse.json(
          {
            error: 'Contract already holds an active authorization.',
          },
          { status: 409 }
        );
      }

      try {
        const authRes = await authorizeOrder({
          orderId: targetOrderId,
          expectedAmount: contract.stakeFormatted,
          expectedCurrency: contract.currency,
          expectedContractId: contract.id,
        });

        const verifiedAudit = createAuditEntry({
          actor: 'system',
          endpoint: 'VERIFY AUTHORIZATION',
          httpStatus: 200,
          summary: `Verified PayPal authorization ${authRes.authorizationId}: status=${authRes.authorizationStatus}, amount=$${authRes.amountValue ?? contract.stakeFormatted} ${authRes.currencyCode ?? contract.currency}.`,
        });

        const updated = await store.update(contract.id, (curr) => ({
          ...withAuditEntries(curr, [...authRes.auditEntries, verifiedAudit]),
          status: 'authorized',
          paypalOrderId: authRes.orderId,
          paypalAuthorizationId: authRes.authorizationId,
          paypalAuthStatus: authRes.authorizationStatus,
          authorizedAt: new Date().toISOString(),
          authorizationExpiresAt: authRes.expirationTime,
        }));

        return NextResponse.json({
          authorizationId: authRes.authorizationId,
          status: authRes.authorizationStatus,
          contract: updated,
        });
      } catch (error) {
        if (error instanceof PayPalApiError) {
          await store.update(contract.id, (curr) =>
            withAuditEntries(curr, error.auditEntries)
          );
          return NextResponse.json(
            {
              error: error.message,
              code: error.code,
              debugId: error.debugId,
            },
            { status: error.status >= 400 ? error.status : 502 }
          );
        }
        throw error;
      }
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to authorize PayPal order.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
