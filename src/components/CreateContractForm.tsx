'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  MAX_DEADLINE_MINUTES,
  MAX_STAKE_USD,
  MIN_DEADLINE_MINUTES,
  MIN_STAKE_USD,
} from '@/lib/types';
import {
  PixelAlertIcon,
  PixelArrowRightIcon,
  PixelDollarIcon,
} from './PixelIcons';

const GOAL_EXAMPLES = [
  'Finish a 5km run and photograph my watch summary',
  'Clear every dish and wipe down the kitchen counter',
  'Read 25 pages of a physical book and snap the page',
];

const DEADLINE_PRESETS = [
  { label: '2m', minutes: 2 },
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '24h', minutes: 24 * 60 },
  { label: '3d', minutes: 3 * 24 * 60 },
];

const STAKE_PRESETS = [5, 10, 25, 50];

const BENEFICIARY_EXAMPLES = [
  'Electronic Frontier Foundation',
  'GiveDirectly',
  'Alex (coffee bet)',
];

function clampStake(val: number): number {
  if (!Number.isFinite(val)) return MIN_STAKE_USD;
  return (
    Math.round(
      Math.min(MAX_STAKE_USD, Math.max(MIN_STAKE_USD, val)) * 100
    ) / 100
  );
}

export function CreateContractForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramGoal = searchParams.get('goal') ?? '';
  const paramStake = Number(searchParams.get('stake'));
  const paramMinutes = Number(searchParams.get('minutes'));
  const paramBeneficiary = searchParams.get('beneficiary') ?? '';

  const initialStake =
    Number.isFinite(paramStake) &&
    paramStake >= MIN_STAKE_USD &&
    paramStake <= MAX_STAKE_USD
      ? clampStake(paramStake)
      : 25;

  const [goal, setGoal] = useState(
    paramGoal || 'Clear every dish and wipe down the kitchen counter'
  );
  const [stakeUsd, setStakeUsd] = useState<number>(initialStake);
  const [stakeInput, setStakeInput] = useState<string>(String(initialStake));
  const [durationMinutes, setDurationMinutes] = useState<number>(
    Number.isInteger(paramMinutes) &&
      paramMinutes >= MIN_DEADLINE_MINUTES &&
      paramMinutes <= MAX_DEADLINE_MINUTES
      ? paramMinutes
      : 15
  );
  const [beneficiary, setBeneficiary] = useState(
    paramBeneficiary || 'Electronic Frontier Foundation'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const [freshNotice, setFreshNotice] = useState(false);

  const goalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const stakeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    function onFocusCreate() {
      setGoal('');
      setStakeUsd(25);
      setStakeInput('25');
      setDurationMinutes(15);
      setError(null);
      setHighlighted(true);
      setFreshNotice(true);
      requestAnimationFrame(() => goalInputRef.current?.focus());
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setHighlighted(false), 1100);
    }

    window.addEventListener('stake:focus-create', onFocusCreate);
    return () => {
      window.removeEventListener('stake:focus-create', onFocusCreate);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  function selectStake(nextValue: number) {
    const clamped = clampStake(nextValue);
    setStakeUsd(clamped);
    setStakeInput(String(clamped));
  }

  function handleStakeInputChange(raw: string) {
    setStakeInput(raw);
    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setStakeUsd(clampStake(parsed));
    }
  }

  function handleStakeInputBlur() {
    const parsed = Number(stakeInput);
    const clamped =
      stakeInput.trim() === '' || !Number.isFinite(parsed)
        ? MIN_STAKE_USD
        : clampStake(parsed);
    setStakeUsd(clamped);
    setStakeInput(String(clamped));
  }

  const formattedStake = clampStake(stakeUsd).toFixed(2);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFreshNotice(false);
    const finalStake = clampStake(
      stakeInput.trim() === '' ? stakeUsd : Number(stakeInput)
    );
    setStakeUsd(finalStake);
    setStakeInput(String(finalStake));
    setSubmitting(true);

    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal,
          stakeUsd: finalStake,
          durationMinutes,
          beneficiary,
        }),
      });
      const rawText = await res.text();
      let data: { contract?: { id?: string }; error?: string } = {};
      try {
        data = rawText ? (JSON.parse(rawText) as typeof data) : {};
      } catch {
        data = {};
      }
      if (!res.ok || !data.contract?.id) {
        setError(
          data.error ||
            `Could not create contract (HTTP ${res.status}). Check /api/health and deployment environment variables.`
        );
        setSubmitting(false);
        return;
      }

      router.push(`/c/${data.contract.id}`);
    } catch {
      setError('Network error reaching server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <form
      id="create-stake"
      onSubmit={handleSubmit}
      className={`border-2 bg-[#0a0a0a] p-6 sm:p-8 transition-colors ${
        highlighted
          ? 'border-[#facc15] shadow-[6px_6px_0px_#facc15]'
          : 'border-white shadow-[6px_6px_0px_#262626]'
      }`}
    >
      {/* Header Block */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-white pb-5">
        <div>
          <span className="inline-block border-2 border-[#facc15] bg-[#facc15] px-2 py-0.5 font-pixel text-[10px] font-bold uppercase tracking-wider text-black">
            STEP 01 · CONTRACT BUILDER
          </span>
          <h2 className="mt-2.5 text-xl sm:text-2xl font-black uppercase tracking-tight text-white">
            Lock Funds Under PayPal Authorization
          </h2>
        </div>

        {freshNotice && (
          <span className="border-2 border-[#facc15] bg-black px-2.5 py-1 font-pixel text-[10px] uppercase text-[#facc15]">
            READY · ENTER GOAL
          </span>
        )}
      </div>

      {/* Stake Block */}
      <div className="mt-6 border-2 border-white bg-black p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-pixel text-[10px] uppercase tracking-wider text-neutral-300">
            <PixelDollarIcon className="h-3.5 w-3.5 text-[#facc15]" />
            COMMITMENT STAKE ($5–$50 USD)
          </span>
          <span className="border border-white px-2 py-0.5 font-pixel text-[9px] uppercase text-white">
            INTENT: AUTHORIZE
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              stakeInputRef.current?.focus();
              stakeInputRef.current?.select();
            }}
            title="Click to edit dollar amount"
            className="flex cursor-pointer items-baseline gap-2 text-left transition hover:opacity-85 focus:outline-2 focus:outline-offset-4 focus:outline-[#facc15]"
          >
            <span className="text-5xl sm:text-6xl font-black tracking-tighter tabular-nums text-[#facc15]">
              ${formattedStake}
            </span>
            <span className="font-pixel text-xs text-white">USD</span>
          </button>

          <div className="flex flex-wrap gap-2">
            {STAKE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => selectStake(preset)}
                className={`cursor-pointer border-2 px-3.5 py-1.5 font-pixel text-xs font-bold transition ${
                  stakeUsd === preset
                    ? 'border-white bg-[#facc15] text-black shadow-[3px_3px_0px_#ffffff]'
                    : 'border-white bg-black text-white hover:border-[#facc15] hover:text-[#facc15]'
                }`}
              >
                ${preset}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <input
            type="range"
            min={MIN_STAKE_USD}
            max={MAX_STAKE_USD}
            step={1}
            value={stakeUsd}
            onChange={(e) => selectStake(Number(e.target.value))}
            aria-label="Stake amount slider"
            className="pixel-slider w-full"
          />
          <div className="flex items-center border-2 border-white bg-black px-3 py-1.5 focus-within:border-[#facc15]">
            <span className="font-pixel text-xs text-[#facc15]">$</span>
            <input
              ref={stakeInputRef}
              type="number"
              min={MIN_STAKE_USD}
              max={MAX_STAKE_USD}
              step="0.01"
              value={stakeInput}
              onChange={(e) => handleStakeInputChange(e.target.value)}
              onBlur={handleStakeInputBlur}
              aria-label="Stake amount USD"
              className="w-16 bg-transparent text-right font-mono text-sm font-bold text-white focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Goal */}
      <div className="mt-6 space-y-2.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="goal-input"
            className="font-pixel text-[11px] uppercase tracking-wider text-white"
          >
            01. PROOF GOAL
          </label>
          <span className="font-mono text-xs text-neutral-400">
            {goal.length}/300
          </span>
        </div>

        <textarea
          ref={goalInputRef}
          id="goal-input"
          rows={3}
          required
          minLength={3}
          maxLength={300}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe concrete photo proof Coach Razor can verify..."
          className="w-full border-2 border-white bg-black px-4 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-[#facc15] focus:outline-none"
        />

        <div className="flex flex-wrap gap-2 pt-0.5">
          {GOAL_EXAMPLES.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setGoal(preset)}
              className="cursor-pointer border border-neutral-600 bg-black px-2.5 py-1 font-mono text-[11px] text-neutral-300 transition hover:border-[#facc15] hover:text-[#facc15]"
            >
              [{preset.slice(0, 32)}…]
            </button>
          ))}
        </div>
      </div>

      {/* Deadline & Beneficiary Grid */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="space-y-2.5 border-2 border-white bg-black p-4">
          <label
            htmlFor="deadline-input"
            className="block font-pixel text-[11px] uppercase tracking-wider text-white"
          >
            02. DEADLINE WINDOW
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {DEADLINE_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                onClick={() => setDurationMinutes(preset.minutes)}
                className={`cursor-pointer border-2 px-2.5 py-1 font-pixel text-[11px] font-bold transition ${
                  durationMinutes === preset.minutes
                    ? 'border-white bg-[#facc15] text-black'
                    : 'border-white bg-black text-white hover:border-[#facc15] hover:text-[#facc15]'
                }`}
              >
                {preset.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5 border-2 border-white bg-black px-2.5 py-1 focus-within:border-[#facc15]">
              <input
                id="deadline-input"
                type="number"
                min={MIN_DEADLINE_MINUTES}
                max={MAX_DEADLINE_MINUTES}
                required
                value={durationMinutes}
                onChange={(e) =>
                  setDurationMinutes(
                    Math.max(1, Math.round(Number(e.target.value)))
                  )
                }
                className="w-14 bg-transparent text-right font-mono text-xs font-bold text-white focus:outline-none"
              />
              <span className="font-pixel text-[10px] text-[#facc15]">M</span>
            </div>
          </div>
          <p className="font-mono text-[11px] text-neutral-400">
            1 min – 3 days (PayPal ~3-day honor period)
          </p>
        </div>

        <div className="space-y-2.5 border-2 border-white bg-black p-4">
          <label
            htmlFor="beneficiary-input"
            className="block font-pixel text-[11px] uppercase tracking-wider text-white"
          >
            03. BENEFICIARY (IF FAILED)
          </label>
          <input
            id="beneficiary-input"
            type="text"
            required
            minLength={2}
            maxLength={100}
            value={beneficiary}
            onChange={(e) => setBeneficiary(e.target.value)}
            placeholder="Friend or charity name"
            className="w-full border-2 border-white bg-black px-3.5 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#facc15] focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            {BENEFICIARY_EXAMPLES.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setBeneficiary(label)}
                className="cursor-pointer border border-neutral-600 bg-black px-2 py-0.5 font-mono text-[11px] text-neutral-300 transition hover:border-[#facc15] hover:text-[#facc15]"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-5 flex items-center gap-2.5 border-2 border-[#facc15] bg-black px-4 py-3 text-xs font-semibold text-[#facc15]">
          <PixelAlertIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-7 flex flex-col gap-4 border-t-2 border-white pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs text-neutral-400">
          HOLD ONLY VIA PAYPAL · AI NEVER TOUCHES MONEY
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex cursor-pointer items-center justify-center gap-2.5 border-2 border-white bg-[#facc15] px-6 py-3.5 font-pixel text-xs font-bold uppercase tracking-wider text-black shadow-[4px_4px_0px_#ffffff] transition hover:bg-[#fde047] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 focus:outline-2 focus:outline-offset-2 focus:outline-[#facc15]"
        >
          {submitting ? (
            'LOCKING CONTRACT…'
          ) : (
            <>
              AUTHORIZE ${formattedStake} STAKE
              <PixelArrowRightIcon className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
