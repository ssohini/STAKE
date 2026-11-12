'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useNowMs } from '@/hooks/useNowMs';
import {
  isContractSettled,
  MAX_PROOF_BYTES,
  type Contract,
} from '@/lib/types';
import { AuditTrailPanel } from './AuditTrailPanel';
import { PayPalAuthorizeButton } from './PayPalAuthorizeButton';
import {
  PixelAlertIcon,
  PixelBoltIcon,
  PixelCheckIcon,
  PixelClockIcon,
  PixelCopyIcon,
  PixelDollarIcon,
  PixelRefreshIcon,
  PixelShieldIcon,
  PixelSkullIcon,
  PixelUploadIcon,
} from './PixelIcons';
import { StatusBadge } from './StatusBadge';

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '00:00:00';
  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

export function ContractWorkbench({
  initialContract,
  paypalClientId,
  storageKind,
}: {
  initialContract: Contract;
  paypalClientId: string;
  storageKind: string;
}) {
  const [contract, setContract] = useState<Contract>(initialContract);
  const nowMs = useNowMs();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Proof upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<{
    message: string;
    debugId?: string | null;
  } | null>(null);

  // Refresh / resolve state
  const [refreshing, setRefreshing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveMessage, setResolveMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const refreshContract = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/contracts/${encodeURIComponent(contract.id)}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.contract) setContract(data.contract as Contract);
      }
    } finally {
      setRefreshing(false);
    }
  }, [contract.id]);

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(
        () => setCopiedKey((curr) => (curr === key ? null : curr)),
        1500
      );
    } catch {
      // Clipboard unavailable
    }
  }

  function handleFileSelected(file: File | null) {
    setUploadError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    if (file.size > MAX_PROOF_BYTES) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadError({
        message: `Image exceeds ${(MAX_PROOF_BYTES / (1024 * 1024)).toFixed(0)} MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB).`,
      });
      return;
    }

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type.toLowerCase())) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadError({
        message:
          'Unsupported format. Please choose a JPEG, PNG, or WEBP image.',
      });
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleProofSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('proof', selectedFile);

      const res = await fetch(
        `/api/contracts/${encodeURIComponent(contract.id)}/proof`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const data = await res.json();
      if (!res.ok) {
        setUploadError({
          message: data.error || 'Proof judgment failed.',
          debugId: data.debugId,
        });
        await refreshContract();
        return;
      }

      if (data.contract) {
        setContract(data.contract as Contract);
      }
      if (data.outcome !== 'needs_retry') {
        setSelectedFile(null);
      }
    } catch {
      setUploadError({
        message: 'Network error uploading proof to Coach Razor.',
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleResolveExpired() {
    setResolving(true);
    setResolveMessage(null);
    try {
      const res = await fetch('/api/cron/resolve', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setResolveMessage(data.error || 'Expiration sweep failed.');
      } else {
        setResolveMessage(
          `Cron sweep processed ${data.resolvedCount} of ${data.expiredFound} expired contracts.`
        );
      }
      await refreshContract();
    } finally {
      setResolving(false);
    }
  }

  const settled = isContractSettled(contract.status);
  const deadlineMs = Date.parse(contract.deadlineAt);
  const remainingMs = nowMs === null ? null : deadlineMs - nowMs;
  const isOverdue = remainingMs !== null && remainingMs <= 0 && !settled;
  const canUploadProof =
    (contract.status === 'authorized' || contract.status === 'needs_retry') &&
    !isOverdue;

  const rematchHref = `/?goal=${encodeURIComponent(
    contract.goal
  )}&stake=${encodeURIComponent(
    String(contract.stakeCents / 100)
  )}&beneficiary=${encodeURIComponent(
    contract.beneficiary
  )}&minutes=${encodeURIComponent(String(contract.durationMinutes))}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      {/* Top Action & Share Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-white pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={contract.status} />
          <span className="border-2 border-white bg-black px-2.5 py-1 font-mono text-xs text-white">
            ID: {contract.id}
          </span>
          <span className="hidden sm:inline-block border border-neutral-600 bg-black px-2.5 py-1 font-pixel text-[9px] uppercase text-neutral-300">
            STORE: {storageKind}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              copyText(
                'url',
                typeof window !== 'undefined'
                  ? window.location.href
                  : `/c/${contract.id}`
              )
            }
            className="inline-flex cursor-pointer items-center gap-1.5 border-2 border-white bg-black px-3 py-1.5 font-pixel text-[10px] uppercase text-white shadow-[3px_3px_0px_#404040] transition hover:border-[#facc15] hover:text-[#facc15] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
          >
            {copiedKey === 'url' ? (
              <PixelCheckIcon className="h-3.5 w-3.5 text-[#facc15]" />
            ) : (
              <PixelCopyIcon className="h-3.5 w-3.5" />
            )}
            {copiedKey === 'url' ? 'COPIED' : 'SHARE LINK'}
          </button>

          <button
            type="button"
            onClick={refreshContract}
            disabled={refreshing}
            className="inline-flex cursor-pointer items-center gap-1.5 border-2 border-white bg-black px-3 py-1.5 font-pixel text-[10px] uppercase text-white shadow-[3px_3px_0px_#404040] transition hover:border-[#facc15] hover:text-[#facc15] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
            title="Refresh contract & webhook events"
          >
            <PixelRefreshIcon className="h-3.5 w-3.5" />
            {refreshing ? 'SYNCING…' : 'SYNC'}
          </button>

          {!settled && (
            <button
              type="button"
              onClick={handleResolveExpired}
              disabled={resolving}
              className={`inline-flex cursor-pointer items-center gap-1.5 border-2 px-3.5 py-1.5 font-pixel text-[10px] font-bold uppercase transition active:translate-x-[3px] active:translate-y-[3px] active:shadow-none ${
                isOverdue
                  ? 'border-white bg-[#facc15] text-black shadow-[3px_3px_0px_#ffffff] hover:bg-[#fde047]'
                  : 'border-white bg-black text-white shadow-[3px_3px_0px_#404040] hover:border-[#facc15] hover:text-[#facc15]'
              }`}
            >
              <PixelBoltIcon className="h-3.5 w-3.5" />
              {resolving ? 'RESOLVING…' : 'RESOLVE EXPIRED'}
            </button>
          )}
        </div>
      </div>

      {resolveMessage && (
        <div className="border-2 border-[#facc15] bg-black px-4 py-2.5 font-mono text-xs text-[#facc15]">
          {resolveMessage}
        </div>
      )}

      {/* Hero Stake + Goal + Countdown Block */}
      <section className="pixel-card p-6 sm:p-8">
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <p className="font-pixel text-[10px] uppercase tracking-widest text-[#facc15]">
              COMMITMENT GOAL
            </p>
            <h1 className="mt-2.5 text-2xl sm:text-3xl font-black tracking-tight text-white leading-tight">
              {contract.goal}
            </h1>
            <p className="mt-3 text-sm text-neutral-300">
              If failed or expired, stake forfeits to{' '}
              <span className="border-b-2 border-[#facc15] font-bold text-[#facc15]">
                {contract.beneficiary}
              </span>
              .
            </p>
          </div>

          {/* Stake & Countdown Box */}
          <div className="border-2 border-[#facc15] bg-black p-5 text-left md:text-right shadow-[4px_4px_0px_#facc15]">
            <span className="font-pixel text-[10px] uppercase tracking-widest text-neutral-300">
              STAKE AT RISK
            </span>
            <div className="mt-1.5 text-5xl sm:text-6xl font-black tracking-tighter tabular-nums text-[#facc15]">
              ${contract.stakeFormatted}
            </div>

            <div className="mt-3 flex items-center gap-2 md:justify-end">
              <PixelClockIcon className="h-4 w-4 text-white" />
              {settled ? (
                <span className="font-mono text-xs text-neutral-300">
                  Settled{' '}
                  {contract.settledAt
                    ? `${contract.settledAt.replace('T', ' ').slice(0, 19)} UTC`
                    : ''}
                </span>
              ) : remainingMs === null ? (
                <span className="font-mono text-sm text-neutral-400">
                  --:--:--
                </span>
              ) : isOverdue ? (
                <span className="border border-[#facc15] bg-[#facc15] px-2 py-0.5 font-pixel text-[10px] font-bold uppercase text-black">
                  DEADLINE PASSED
                </span>
              ) : (
                <span className="font-mono text-lg font-bold tabular-nums text-white">
                  {formatCountdown(remainingMs)} left
                </span>
              )}
            </div>
          </div>
        </div>

        {/* PayPal Telemetry Bar */}
        <div className="mt-6 grid gap-3 border-t-2 border-white pt-5 sm:grid-cols-3">
          <div className="border-2 border-white bg-black px-3.5 py-2.5">
            <span className="block font-pixel text-[9px] uppercase tracking-wider text-neutral-400">
              PAYPAL ORDER ID
            </span>
            <span className="mt-1 block truncate font-mono text-xs text-white">
              {contract.paypalOrderId ?? 'Not created yet'}
            </span>
          </div>

          <div className="border-2 border-white bg-black px-3.5 py-2.5">
            <span className="block font-pixel text-[9px] uppercase tracking-wider text-neutral-400">
              AUTHORIZATION ID
            </span>
            <span className="mt-1 block truncate font-mono text-xs text-[#facc15]">
              {contract.paypalAuthorizationId ?? 'Pending buyer approval'}
            </span>
          </div>

          <div className="border-2 border-white bg-black px-3.5 py-2.5">
            <span className="block font-pixel text-[9px] uppercase tracking-wider text-neutral-400">
              SETTLEMENT / CAPTURE ID
            </span>
            <span className="mt-1 block truncate font-mono text-xs text-white">
              {contract.paypalCaptureId
                ? `${contract.paypalCaptureId} (${contract.paypalAuthStatus ?? 'CAPTURED'})`
                : contract.paypalAuthStatus ?? 'Open hold'}
            </span>
          </div>
        </div>
      </section>

      {/* Result & Coach Razor Roast Block */}
      {(contract.latestVerdict || settled) && (
        <section
          className={`p-6 sm:p-7 ${
            contract.status === 'voided'
              ? 'pixel-card-yellow'
              : 'pixel-card'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center border-2 ${
                  contract.status === 'voided'
                    ? 'border-white bg-[#facc15] text-black'
                    : contract.status === 'needs_retry'
                    ? 'border-[#facc15] bg-black text-[#facc15]'
                    : 'border-white bg-white text-black'
                }`}
              >
                {contract.status === 'voided' ? (
                  <PixelShieldIcon className="h-6 w-6" />
                ) : contract.status === 'needs_retry' ? (
                  <PixelAlertIcon className="h-6 w-6" />
                ) : (
                  <PixelSkullIcon className="h-6 w-6" />
                )}
              </div>

              <div>
                <p className="font-pixel text-[10px] uppercase tracking-widest text-[#facc15]">
                  COACH RAZOR VERDICT &amp; PAYPAL SETTLEMENT
                </p>
                <h2 className="mt-1.5 text-xl sm:text-2xl font-black tracking-tight text-white">
                  {contract.status === 'voided' &&
                    `PASSED — Authorization Voided, You Keep $${contract.stakeFormatted}`}
                  {contract.status === 'captured' &&
                    `FAILED — $${contract.stakeFormatted} Captured for ${contract.beneficiary}`}
                  {contract.status === 'expired_captured' &&
                    `EXPIRED — $${contract.stakeFormatted} Auto-Captured`}
                  {contract.status === 'expired_unfunded' &&
                    'EXPIRED — Closed Before PayPal Authorization'}
                  {contract.status === 'needs_retry' &&
                    'NEEDS RETRY — Zero Money Moved'}
                </h2>
              </div>
            </div>

            {settled && (
              <Link
                href={rematchHref}
                className="inline-flex items-center gap-2 border-2 border-white bg-[#facc15] px-4 py-2.5 font-pixel text-[10px] font-bold uppercase tracking-wider text-black shadow-[3px_3px_0px_#ffffff] transition hover:bg-[#fde047] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
              >
                <PixelRefreshIcon className="h-3.5 w-3.5" />
                REMATCH
              </Link>
            )}
          </div>

          {contract.latestVerdict && (
            <div className="mt-5 border-2 border-white bg-black p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-pixel text-[10px] font-bold uppercase tracking-wider text-[#facc15]">
                  COACH RAZOR SAYS:
                </span>
                <span className="font-mono text-xs text-neutral-300">
                  Verdict:{' '}
                  <strong className="uppercase text-white">
                    {contract.latestVerdict.verdict}
                  </strong>{' '}
                  · Confidence:{' '}
                  <strong className="text-[#facc15]">
                    {(contract.latestVerdict.confidence * 100).toFixed(0)}%
                  </strong>{' '}
                  (min 50%)
                </span>
              </div>

              <blockquote className="mt-3 text-lg font-bold leading-snug text-white">
                &ldquo;{contract.latestVerdict.feedback ?? contract.latestVerdict.roast}&rdquo;
              </blockquote>

              {contract.latestVerdict.reason && (
                <p className="mt-2.5 border-t border-neutral-800 pt-2.5 font-mono text-xs text-neutral-300">
                  <span className="text-[#facc15]">REASON:</span>{' '}
                  {contract.latestVerdict.reason}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Action Panel: Step 1 PayPal Authorization OR Step 2 Proof Upload */}
      {contract.status === 'pending_auth' && !isOverdue && (
        <section className="pixel-card p-6 sm:p-7">
          <div className="mb-4 flex items-center gap-2.5 border-b-2 border-white pb-3">
            <PixelDollarIcon className="h-5 w-5 text-[#facc15]" />
            <h2 className="font-pixel text-sm font-bold uppercase tracking-wider text-white">
              STEP 01: AUTHORIZE YOUR ${contract.stakeFormatted} STAKE
            </h2>
          </div>

          <PayPalAuthorizeButton
            contractId={contract.id}
            stakeFormatted={contract.stakeFormatted}
            clientId={paypalClientId}
            onAuthorized={(updated) => setContract(updated)}
            onContractRefresh={refreshContract}
          />
        </section>
      )}

      {(contract.status === 'authorized' ||
        contract.status === 'needs_retry') && (
        <section className="pixel-card p-6 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b-2 border-white pb-3">
            <div className="flex items-center gap-2.5">
              <PixelUploadIcon className="h-5 w-5 text-[#facc15]" />
              <h2 className="font-pixel text-sm font-bold uppercase tracking-wider text-white">
                STEP 02: UPLOAD PHOTO PROOF
              </h2>
            </div>
            <span className="font-mono text-[11px] text-neutral-300">
              JPEG / PNG / WEBP · MAX 4 MB · STRICT JSON
            </span>
          </div>

          {isOverdue ? (
            <div className="border-2 border-[#facc15] bg-black p-5 text-sm text-white">
              <p className="font-pixel text-xs uppercase text-[#facc15]">
                DEADLINE HAS PASSED
              </p>
              <p className="mt-2 text-xs text-neutral-300">
                Proof uploads are locked. Click <strong>RESOLVE EXPIRED</strong>{' '}
                above to simulate the cron sweep and capture the PayPal
                authorization.
              </p>
            </div>
          ) : (
            <form onSubmit={handleProofSubmit} className="space-y-4">
              {contract.status === 'needs_retry' && (
                <div className="border-2 border-[#facc15] bg-black p-4 text-xs text-[#facc15]">
                  <strong>REVIEW / RETRY ALLOWED:</strong> Previous submission
                  triggered manual review or retry (
                  {contract.proofAttempts.at(-1)?.errorReason ??
                    'confidence < 0.50'}
                  ). Zero PayPal money moved — upload a clearer photo.
                </div>
              )}

              <label className="flex cursor-pointer flex-col items-center justify-center border-2 border-dashed border-white bg-black px-6 py-8 text-center transition hover:border-[#facc15]">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) =>
                    handleFileSelected(e.target.files?.[0] ?? null)
                  }
                />
                {previewUrl ? (
                  <div className="space-y-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Selected proof preview"
                      className="mx-auto max-h-64 border-2 border-white object-contain"
                    />
                    <p className="font-mono text-xs text-[#facc15]">
                      {selectedFile?.name} (
                      {((selectedFile?.size ?? 0) / 1024).toFixed(0)} KB) — CLICK
                      TO SWAP
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <PixelUploadIcon className="mx-auto h-9 w-9 text-[#facc15]" />
                    <p className="font-pixel text-xs uppercase text-white">
                      DROP PROOF PHOTO OR CLICK TO BROWSE
                    </p>
                    <p className="text-xs text-neutral-400">
                      Coach Razor rejects screenshots of screenshots, stock
                      photos, and embedded text prompt injections.
                    </p>
                  </div>
                )}
              </label>

              {uploadError && (
                <div className="border-2 border-[#facc15] bg-black p-3.5 text-xs text-[#facc15]">
                  <p className="font-bold">{uploadError.message}</p>
                  {uploadError.debugId && (
                    <p className="mt-1 font-mono text-[11px] text-white">
                      PayPal-Debug-Id: {uploadError.debugId}
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={!selectedFile || uploading || !canUploadProof}
                className="flex w-full cursor-pointer items-center justify-center gap-2 border-2 border-white bg-[#facc15] px-6 py-4 font-pixel text-xs font-bold uppercase tracking-wider text-black shadow-[4px_4px_0px_#ffffff] transition hover:bg-[#fde047] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading
                  ? 'COACH RAZOR IS JUDGING & SERVER IS SETTLING…'
                  : 'SUBMIT PROOF TO COACH RAZOR'}
              </button>
            </form>
          )}
        </section>
      )}

      {/* Audit Trail Panel */}
      <AuditTrailPanel entries={contract.auditTrail} />
    </div>
  );
}
