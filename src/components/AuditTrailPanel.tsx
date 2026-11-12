'use client';

import { useState } from 'react';
import type { AuditActor, AuditTrailEntry } from '@/lib/types';
import {
  PixelCheckIcon,
  PixelCopyIcon,
  PixelTerminalIcon,
} from './PixelIcons';

const ACTOR_BADGES: Record<
  AuditActor,
  { label: string; classes: string }
> = {
  paypal: {
    label: 'PAYPAL API',
    classes: 'border-white bg-[#facc15] text-black',
  },
  ai_judge: {
    label: 'COACH RAZOR',
    classes: 'border-[#facc15] bg-black text-[#facc15]',
  },
  webhook: {
    label: 'WEBHOOK',
    classes: 'border-white bg-white text-black',
  },
  system: {
    label: 'SERVER',
    classes: 'border-white bg-black text-white',
  },
};

function httpStatusBadge(status: number | null) {
  if (status === null) {
    return (
      <span className="border border-neutral-600 bg-black px-2 py-0.5 font-pixel text-[9px] text-neutral-400">
        N/A
      </span>
    );
  }

  const classes =
    status >= 400
      ? 'border-[#facc15] bg-black text-[#facc15]'
      : 'border-white bg-white text-black';

  return (
    <span
      className={`border px-2 py-0.5 font-pixel text-[9px] font-bold ${classes}`}
    >
      HTTP {status}
    </span>
  );
}

export function AuditTrailPanel({ entries }: { entries: AuditTrailEntry[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyDebugId(debugId: string) {
    try {
      await navigator.clipboard.writeText(debugId);
      setCopiedId(debugId);
      setTimeout(
        () => setCopiedId((curr) => (curr === debugId ? null : curr)),
        1500
      );
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <section className="pixel-card p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b-2 border-white pb-4">
        <div className="flex items-center gap-3">
          <PixelTerminalIcon className="h-4 w-4 text-[#facc15]" />
          <h2 className="font-pixel text-xs font-bold uppercase tracking-wider text-white">
            AUDIT TRAIL
          </h2>
          <span className="border-2 border-white bg-[#facc15] px-2 py-0.5 font-pixel text-[10px] font-bold text-black">
            {entries.length} EVENTS
          </span>
        </div>
        <p className="font-mono text-[11px] text-neutral-400">
          Every PayPal REST call, AI verdict &amp; verified webhook · Secrets
          redacted
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="py-6 text-center font-mono text-xs text-neutral-400">
          No audit events recorded yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => {
            const actor = ACTOR_BADGES[entry.actor];
            return (
              <li
                key={entry.id}
                className="border-2 border-white bg-black p-4 shadow-[3px_3px_0px_#262626] transition hover:border-[#facc15]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`border px-2 py-0.5 font-pixel text-[9px] font-bold uppercase tracking-wider ${actor.classes}`}
                    >
                      {actor.label}
                    </span>
                    <code className="font-mono text-xs font-bold text-white break-all">
                      {entry.endpoint}
                    </code>
                    {httpStatusBadge(entry.httpStatus)}
                  </div>

                  <time
                    dateTime={entry.timestamp}
                    className="font-mono text-[11px] text-neutral-400"
                  >
                    {entry.timestamp.replace('T', ' ').slice(0, 19)} UTC
                  </time>
                </div>

                <p className="mt-2.5 text-xs leading-relaxed text-neutral-200">
                  {entry.summary}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-2">
                  <span className="font-mono text-[11px] text-neutral-400">
                    PayPal-Debug-Id:
                  </span>
                  {entry.paypalDebugId ? (
                    <button
                      type="button"
                      onClick={() => copyDebugId(entry.paypalDebugId!)}
                      className="inline-flex cursor-pointer items-center gap-1.5 border border-white bg-black px-2 py-0.5 font-mono text-[11px] text-[#facc15] transition hover:border-[#facc15]"
                      title="Copy PayPal-Debug-Id"
                    >
                      {entry.paypalDebugId}
                      {copiedId === entry.paypalDebugId ? (
                        <PixelCheckIcon className="h-3 w-3 text-[#facc15]" />
                      ) : (
                        <PixelCopyIcon className="h-3 w-3 text-white" />
                      )}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-neutral-500">
                      —
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
