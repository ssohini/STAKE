'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useNowMs } from '@/hooks/useNowMs';
import type { Contract } from '@/lib/types';
import { isContractSettled } from '@/lib/types';
import {
  PixelArrowRightIcon,
  PixelBoltIcon,
  PixelClockIcon,
  PixelRefreshIcon,
} from './PixelIcons';
import { StatusBadge } from './StatusBadge';

export function RecentContractsPanel() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [storageKind, setStorageKind] = useState<string>('json');
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolveBanner, setResolveBanner] = useState<string | null>(null);
  const nowMs = useNowMs();

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/contracts', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && Array.isArray(data.contracts)) {
        setContracts(data.contracts);
        if (data.storage) setStorageKind(data.storage);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      void fetchContracts();
    }, 0);
    return () => clearTimeout(id);
  }, [fetchContracts]);

  async function handleResolveExpired() {
    setResolving(true);
    setResolveBanner(null);
    try {
      const res = await fetch('/api/cron/resolve', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setResolveBanner(data.error || 'Failed to run expiration sweep.');
      } else {
        setResolveBanner(
          `Cron sweep complete: scanned ${data.scannedCount}, found ${data.expiredFound} expired, resolved ${data.resolvedCount}.`
        );
        await fetchContracts();
      }
    } finally {
      setResolving(false);
    }
  }

  const overdueCount =
    nowMs === null
      ? 0
      : contracts.filter(
          (c) => !isContractSettled(c.status) && nowMs > Date.parse(c.deadlineAt)
        ).length;

  return (
    <section className="pixel-card p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-white pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-pixel text-sm font-bold uppercase tracking-wider text-white">
              CONTRACTS LEDGER
            </h2>
            <span className="border border-white bg-black px-2 py-0.5 font-pixel text-[9px] uppercase text-[#facc15]">
              STORE: {storageKind}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-neutral-400">
            Shareable routes at <code className="text-white">/c/[id]</code>.
            Overdue contracts without proof capture on expiration sweep.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={fetchContracts}
            disabled={loading}
            className="inline-flex cursor-pointer items-center gap-2 border-2 border-white bg-black px-3.5 py-2 font-pixel text-[10px] uppercase tracking-wider text-white shadow-[3px_3px_0px_#404040] transition hover:border-[#facc15] hover:text-[#facc15] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
          >
            <PixelRefreshIcon className="h-3.5 w-3.5" />
            {loading ? 'SYNCING…' : 'REFRESH'}
          </button>

          <button
            type="button"
            onClick={handleResolveExpired}
            disabled={resolving}
            className="inline-flex cursor-pointer items-center gap-2 border-2 border-white bg-[#facc15] px-4 py-2 font-pixel text-[10px] font-bold uppercase tracking-wider text-black shadow-[3px_3px_0px_#ffffff] transition hover:bg-[#fde047] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:opacity-50"
          >
            <PixelBoltIcon className="h-3.5 w-3.5" />
            {resolving ? 'RESOLVING…' : 'RESOLVE EXPIRED'}
            {overdueCount > 0 && (
              <span className="border border-black bg-black px-1.5 py-0.5 font-pixel text-[9px] text-[#facc15]">
                {overdueCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {resolveBanner && (
        <div className="mt-4 border-2 border-[#facc15] bg-black px-4 py-2.5 font-mono text-xs text-[#facc15]">
          {resolveBanner}
        </div>
      )}

      {loading && contracts.length === 0 ? (
        <div className="py-10 text-center font-pixel text-xs text-neutral-400">
          LOADING LEDGER…
        </div>
      ) : contracts.length === 0 ? (
        <div className="py-10 text-center font-mono text-xs text-neutral-400">
          No contracts created yet. Authorize a stake above to begin.
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {contracts.slice(0, 8).map((c) => {
            const isOverdue =
              nowMs !== null &&
              !isContractSettled(c.status) &&
              nowMs > Date.parse(c.deadlineAt);

            return (
              <Link
                key={c.id}
                href={`/c/${c.id}`}
                className="group flex flex-col justify-between border-2 border-white bg-black p-4 shadow-[4px_4px_0px_#262626] transition hover:border-[#facc15] hover:shadow-[4px_4px_0px_#facc15]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-2xl font-black tabular-nums text-[#facc15]">
                      ${c.stakeFormatted}
                    </span>
                    <span className="ml-2 font-mono text-xs text-neutral-400">
                      /{c.id}
                    </span>
                  </div>
                  <StatusBadge status={c.status} />
                </div>

                <p className="mt-3 line-clamp-2 text-xs font-medium text-white">
                  {c.goal}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-neutral-800 pt-2.5 font-mono text-[11px] text-neutral-400">
                  <span className="inline-flex items-center gap-1.5">
                    <PixelClockIcon className="h-3.5 w-3.5 text-[#facc15]" />
                    {isOverdue ? (
                      <span className="font-pixel text-[10px] text-[#facc15]">
                        OVERDUE
                      </span>
                    ) : (
                      `DUE ${c.deadlineAt.slice(11, 19)} UTC`
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1 font-pixel text-[10px] text-white group-hover:text-[#facc15]">
                    OPEN
                    <PixelArrowRightIcon className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
