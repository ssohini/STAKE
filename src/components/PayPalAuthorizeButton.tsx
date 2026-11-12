'use client';

import { useEffect, useRef, useState } from 'react';
import { loadScript } from '@paypal/paypal-js';
import type { Contract } from '@/lib/types';
import { PixelAlertIcon, PixelShieldIcon } from './PixelIcons';

interface PayPalAuthorizeButtonProps {
  contractId: string;
  stakeFormatted: string;
  clientId: string;
  disabled?: boolean;
  onAuthorized: (updated: Contract) => void;
  onContractRefresh?: () => Promise<void>;
}

export function PayPalAuthorizeButton({
  contractId,
  stakeFormatted,
  clientId,
  disabled = false,
  onAuthorized,
  onContractRefresh,
}: PayPalAuthorizeButtonProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{
    message: string;
    code?: string;
    debugId?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!clientId || disabled) return;

    let cancelled = false;
    let buttonsInstance: { close?: () => Promise<void> } | null = null;

    async function initButtons() {
      try {
        const paypal = await loadScript({
          clientId,
          currency: 'USD',
          intent: 'authorize',
          components: 'buttons',
        });

        if (cancelled || !paypal?.Buttons || !containerRef.current) return;

        containerRef.current.innerHTML = '';

        const buttons = paypal.Buttons({
          style: {
            layout: 'vertical',
            color: 'gold',
            shape: 'rect',
            label: 'paypal',
            height: 48,
          },
          createOrder: async () => {
            setErrorBanner(null);
            setProcessing(true);

            const res = await fetch(
              `/api/contracts/${encodeURIComponent(contractId)}/paypal/create-order`,
              { method: 'POST' }
            );
            const data = await res.json();

            if (!res.ok || !data.orderId) {
              setProcessing(false);
              setErrorBanner({
                message: data.error || 'Failed to create PayPal order.',
                code: data.code,
                debugId: data.debugId,
              });
              await onContractRefresh?.();
              throw new Error(data.error || 'Create order failed');
            }

            if (data.contract) {
              onAuthorized(data.contract);
            }
            return data.orderId as string;
          },
          onApprove: async (data) => {
            setProcessing(true);
            setErrorBanner(null);
            try {
              const res = await fetch(
                `/api/contracts/${encodeURIComponent(contractId)}/paypal/authorize`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderID: data.orderID }),
                }
              );
              const payload = await res.json();
              if (!res.ok || !payload.contract) {
                setErrorBanner({
                  message:
                    payload.error || 'Failed to authorize approved PayPal order.',
                  code: payload.code,
                  debugId: payload.debugId,
                });
                await onContractRefresh?.();
                return;
              }
              onAuthorized(payload.contract as Contract);
            } finally {
              setProcessing(false);
            }
          },
          onCancel: () => {
            setProcessing(false);
            setErrorBanner({
              message:
                'PayPal checkout was canceled before authorization. No money was held or captured.',
              code: 'BUYER_CANCELED',
            });
          },
          onError: (err) => {
            setProcessing(false);
            const msg =
              err instanceof Error
                ? err.message
                : 'PayPal Smart Button encountered an error.';
            setErrorBanner((prev) =>
              prev ?? {
                message: msg,
                code: 'PAYPAL_SDK_ERROR',
              }
            );
          },
        });

        buttonsInstance = buttons;
        if (buttons.isEligible() && containerRef.current) {
          await buttons.render(containerRef.current);
          if (!cancelled) setSdkReady(true);
        } else if (!cancelled) {
          setErrorBanner({
            message:
              'PayPal Smart Buttons are not eligible in this browser context.',
          });
        }
      } catch (err) {
        if (!cancelled) {
          setErrorBanner({
            message:
              err instanceof Error
                ? err.message
                : 'Failed to load PayPal JS SDK.',
          });
        }
      }
    }

    initButtons();

    return () => {
      cancelled = true;
      buttonsInstance?.close?.().catch(() => undefined);
    };
  }, [clientId, contractId, disabled, onAuthorized, onContractRefresh]);

  if (!clientId) {
    return (
      <div className="border-2 border-[#facc15] bg-black p-4 text-xs text-white">
        <p className="font-pixel text-[11px] uppercase text-[#facc15]">
          MISSING NEXT_PUBLIC_PAYPAL_CLIENT_ID
        </p>
        <p className="mt-2 font-mono text-neutral-300">
          Add your PayPal Sandbox client ID to <code>.env</code> and restart{' '}
          <code>npm run dev</code> to render the PayPal Smart Buttons.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 border-2 border-white bg-black p-4 text-xs text-neutral-200">
        <PixelShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#facc15]" />
        <div>
          <p className="font-pixel text-[10px] uppercase tracking-wider text-[#facc15]">
            PAYPAL JS SDK (INTENT=AUTHORIZE) · HOLD ONLY
          </p>
          <p className="mt-1.5 text-neutral-300">
            Approving places a{' '}
            <strong className="text-white">${stakeFormatted} USD</strong>{' '}
            authorization hold. Win and we void it; fail or miss the deadline
            and the server captures it.
          </p>
        </div>
      </div>

      {!sdkReady && !disabled && (
        <div className="border-2 border-white bg-black py-4 text-center font-pixel text-[10px] uppercase text-[#facc15]">
          LOADING PAYPAL SANDBOX SMART BUTTONS…
        </div>
      )}

      <div
        ref={containerRef}
        className={`min-h-[52px] border-2 border-white bg-white p-2 transition-opacity ${
          processing || disabled ? 'pointer-events-none opacity-60' : ''
        }`}
      />

      {processing && (
        <div className="border-2 border-[#facc15] bg-black px-3 py-2 font-pixel text-[10px] uppercase text-[#facc15]">
          EXECUTING SERVER-SIDE PAYPAL REST V2 AUTHORIZATION…
        </div>
      )}

      {errorBanner && (
        <div className="border-2 border-[#facc15] bg-black p-4 text-xs text-white">
          <div className="flex items-start gap-3">
            <PixelAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#facc15]" />
            <div className="space-y-1">
              <p className="font-bold text-[#facc15]">{errorBanner.message}</p>
              {(errorBanner.code || errorBanner.debugId) && (
                <p className="font-mono text-[11px] text-neutral-300">
                  {errorBanner.code ? `Code: ${errorBanner.code}` : ''}
                  {errorBanner.code && errorBanner.debugId ? ' · ' : ''}
                  {errorBanner.debugId
                    ? `PayPal-Debug-Id: ${errorBanner.debugId}`
                    : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
