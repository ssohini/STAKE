import { NextResponse } from 'next/server';
import { createAuthorizeOrder, PayPalApiError } from '@/lib/paypal';
import { getContractStore, withAuditEntries } from '@/lib/store';
import { isContractSettled } from '@/lib/types';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const store = getContractStore();

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
            error: `Contract is already settled (${contract.status}). Cannot create a new PayPal order.`,
          },
          { status: 409 }
        );
      }

      if (contract.paypalAuthorizationId) {
        return NextResponse.json(
          {
            error: 'Contract already has an active PayPal authorization.',
          },
          { status: 409 }
        );
      }

      if (Date.now() > Date.parse(contract.deadlineAt)) {
        return NextResponse.json(
          {
            error: 'Contract deadline has passed before authorization.',
          },
          { status: 409 }
        );
      }

      try {
        const orderRes = await createAuthorizeOrder({
          contractId: contract.id,
          stakeFormatted: contract.stakeFormatted,
          beneficiary: contract.beneficiary,
        });

        const updated = await store.update(contract.id, (curr) => ({
          ...withAuditEntries(curr, orderRes.auditEntries),
          paypalOrderId: orderRes.orderId,
        }));

        return NextResponse.json({
          orderId: orderRes.orderId,
          status: orderRes.status,
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
      error instanceof Error ? error.message : 'Failed to create PayPal order.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
