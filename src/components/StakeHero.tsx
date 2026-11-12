'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CoinAnimationState, DollarCoin3D } from './DollarCoin3D';
import { PixelArrowDownIcon, PixelRefreshIcon } from './PixelIcons';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Cinematic opening hero:
 * 1) Photorealistic 3D US Dollar coin enters rapidly from the right and slows at center.
 * 2) Rotates smoothly in 3D catching studio reflections while zooming out to lowercase 'a' scale.
 * 3) Curved white stroke completes lowercase 'a' while S, T slide left and K, E slide right from behind the coin.
 */
export function StakeHero() {
  const coinAnimRef = useRef<CoinAnimationState>({
    rotY: -0.5,
    rotX: 0.08,
    rotZ: 0,
  });

  const coinWrapperRef = useRef<HTMLDivElement | null>(null);
  const sRef = useRef<HTMLSpanElement | null>(null);
  const tRef = useRef<HTMLSpanElement | null>(null);
  const kRef = useRef<HTMLSpanElement | null>(null);
  const eRef = useRef<HTMLSpanElement | null>(null);
  const aStrokeRef = useRef<SVGPathElement | null>(null);
  const aStemWrapRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);

  const [replaySeed, setReplaySeed] = useState(0);
  const [settled, setSettled] = useState(false);

  const handleReplay = useCallback(() => {
    setSettled(false);
    setReplaySeed((s) => s + 1);
  }, []);

  useEffect(() => {
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    const startMs = performance.now();

    // Total reveal duration in ms:
    // 0..850ms: Fast entrance from far right -> center at 3.2x macro scale
    // 850..2150ms: 3D rotation + zoom-out from 3.2x -> 1.0x ('a' bowl size)
    // 1600..2650ms: S, T slide left & K, E slide right from behind coin + 'a' white stroke draws
    // 2550..3050ms: Understated subtitle & CTA fade in
    const ENTRANCE_END = 850;
    const ZOOM_START = 850;
    const ZOOM_END = 2200;
    const LETTERS_START = 1620;
    const LETTERS_END = 2600;
    const STROKE_START = 1850;
    const STROKE_END = 2480;
    const CAPTION_START = 2500;
    const CAPTION_END = 3050;

    function applyFrame(elapsedMs: number) {
      const t = reducedMotion ? 4000 : elapsedMs;

      // 1. Coin translation (far right -> center) & scale (3.2 -> 1.0)
      const enterP = easeOutExpo(clamp01(t / ENTRANCE_END));
      const zoomP = easeInOutCubic(
        clamp01((t - ZOOM_START) / (ZOOM_END - ZOOM_START))
      );

      const xVw = (1 - enterP) * 62;
      const scale = 3.2 - zoomP * 2.2;

      if (coinWrapperRef.current) {
        coinWrapperRef.current.style.transform = `translate3d(${xVw.toFixed(
          3
        )}vw, 0px, 0px) scale(${scale.toFixed(4)})`;
      }

      // 2. Coin 3D rotation: quick angled glide-in -> smooth 360° showcase spin -> subtle living glint
      if (t < ENTRANCE_END) {
        const p = clamp01(t / ENTRANCE_END);
        coinAnimRef.current.rotY = -0.75 + easeOutCubic(p) * 1.1;
        coinAnimRef.current.rotX = 0.14 * (1 - p);
        coinAnimRef.current.rotZ = -0.06 * (1 - p);
      } else if (t < ZOOM_END) {
        const p = easeInOutCubic(
          clamp01((t - ZOOM_START) / (ZOOM_END - ZOOM_START))
        );
        // Spin cleanly from +0.35 rad through a full showcase turn back to exact 0 front face (2*PI)
        coinAnimRef.current.rotY = 0.35 + p * (Math.PI * 2 - 0.35);
        coinAnimRef.current.rotX = Math.sin(p * Math.PI) * 0.22;
        coinAnimRef.current.rotZ = 0;
      } else {
        // Gentle idle studio reflection sweep so metal keeps catching highlights
        const idleSec = (t - ZOOM_END) / 1000;
        coinAnimRef.current.rotY = Math.sin(idleSec * 1.05) * 0.19;
        coinAnimRef.current.rotX = Math.cos(idleSec * 0.75) * 0.06;
        coinAnimRef.current.rotZ = 0;
      }

      // 3. Letters emerging from behind the coin (ST to the left, KE to the right)
      const lp = clamp01((t - LETTERS_START) / (LETTERS_END - LETTERS_START));
      const sProgress = easeOutCubic(clamp01((lp - 0.12) / 0.88));
      const tProgress = easeOutCubic(clamp01(lp / 0.78));
      const kProgress = easeOutCubic(clamp01(lp / 0.78));
      const eProgress = easeOutCubic(clamp01((lp - 0.12) / 0.88));

      // Letters start tucked horizontally behind the coin center and slide out
      if (tRef.current) {
        const tx = (1 - tProgress) * 1.15;
        tRef.current.style.transform = `translate3d(${tx.toFixed(3)}em, 0, 0)`;
        tRef.current.style.opacity = String(clamp01(tProgress * 1.4));
      }
      if (sRef.current) {
        const sx = (1 - sProgress) * 1.95;
        sRef.current.style.transform = `translate3d(${sx.toFixed(3)}em, 0, 0)`;
        sRef.current.style.opacity = String(clamp01(sProgress * 1.4));
      }
      if (kRef.current) {
        const kx = -(1 - kProgress) * 1.15;
        kRef.current.style.transform = `translate3d(${kx.toFixed(3)}em, 0, 0)`;
        kRef.current.style.opacity = String(clamp01(kProgress * 1.4));
      }
      if (eRef.current) {
        const ex = -(1 - eProgress) * 1.95;
        eRef.current.style.transform = `translate3d(${ex.toFixed(3)}em, 0, 0)`;
        eRef.current.style.opacity = String(clamp01(eProgress * 1.4));
      }

      // 4. Curved white stroke completing lowercase 'a' right beside the coin
      const sp = easeOutCubic(
        clamp01((t - STROKE_START) / (STROKE_END - STROKE_START))
      );
      if (aStemWrapRef.current) {
        aStemWrapRef.current.style.opacity = String(sp);
      }
      if (aStrokeRef.current) {
        const len = 120;
        aStrokeRef.current.style.strokeDasharray = `${len}`;
        aStrokeRef.current.style.strokeDashoffset = `${(1 - sp) * len}`;
      }

      // 5. Minimal footer tagline + scroll cue fades in cleanly at the end
      const cp = easeOutCubic(
        clamp01((t - CAPTION_START) / (CAPTION_END - CAPTION_START))
      );
      if (captionRef.current) {
        captionRef.current.style.opacity = String(cp);
        captionRef.current.style.transform = `translate3d(0, ${(
          (1 - cp) *
          10
        ).toFixed(2)}px, 0)`;
      }

      if (t >= CAPTION_END) {
        setSettled((prev) => (prev ? prev : true));
      }
    }

    const tick = (now: number) => {
      applyFrame(now - startMs);
      rafId = requestAnimationFrame(tick);
    };

    applyFrame(0);
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [replaySeed]);

  function scrollToCreate() {
    const el = document.getElementById('create-stake');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <section className="relative flex min-h-[calc(100vh-65px)] w-full flex-col items-center justify-center overflow-hidden bg-[#050506] px-4 py-10 select-none">
      {/* Subtle overhead spotlight halo only behind hero stage — no loud colored gradients */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.02] blur-3xl"
      />

      {/* Wordmark Assembly: S T [coin + a-stroke] K E */}
      <div
        aria-label="STAKE"
        className="relative flex items-baseline justify-center font-sans text-[56px] sm:text-[90px] md:text-[116px] font-extrabold leading-none tracking-[-0.03em] text-white"
      >
        {/* Left letters emerging from behind the coin */}
        <div className="relative z-10 flex items-baseline pr-[0.02em]">
          <span
            ref={sRef}
            style={{ opacity: 0 }}
            className="inline-block will-change-transform"
          >
            S
          </span>
          <span
            ref={tRef}
            style={{ opacity: 0 }}
            className="inline-block will-change-transform"
          >
            T
          </span>
        </div>

        {/* Lowercase 'a': 3D Metallic US Dollar Coin as the bowl + curved white stem */}
        <div
          className="relative z-20 mx-[0.02em] inline-flex items-end"
          style={{ width: '0.84em', height: '0.66em' }}
        >
          {/* 3D WebGL Coin (bowl of lowercase 'a') */}
          <div
            ref={coinWrapperRef}
            style={{ width: '0.66em', height: '0.66em' }}
            className="relative z-20 shrink-0 will-change-transform"
          >
            <DollarCoin3D animRef={coinAnimRef} />
          </div>

          {/* Clean curved white geometric stroke completing the lowercase 'a' */}
          <div
            ref={aStemWrapRef}
            style={{
              opacity: 0,
              width: '0.84em',
              height: '0.66em',
            }}
            className="pointer-events-none absolute inset-0 z-30"
          >
            <svg
              viewBox="0 0 96 76"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-full w-full overflow-visible"
              aria-hidden="true"
            >
              {/* Clean curved geometric stroke hugging the right shoulder of the coin down to the baseline */}
              <path
                ref={aStrokeRef}
                d="M 48 6 C 67 6, 75 18, 75 34 L 75 64 Q 75 70, 82 70"
                stroke="#FFFFFF"
                strokeWidth="11.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Right letters emerging from behind the coin */}
        <div className="relative z-10 flex items-baseline pl-[0.04em]">
          <span
            ref={kRef}
            style={{ opacity: 0 }}
            className="inline-block will-change-transform"
          >
            K
          </span>
          <span
            ref={eRef}
            style={{ opacity: 0 }}
            className="inline-block will-change-transform"
          >
            E
          </span>
        </div>
      </div>

      {/* Quiet post-reveal tagline & sharp rectangular CTA */}
      <div
        ref={captionRef}
        style={{ opacity: 0 }}
        className="mt-10 flex flex-col items-center gap-6 text-center will-change-transform"
      >
        <p className="max-w-md text-sm sm:text-base font-normal tracking-wide text-neutral-300">
          Put <span className="font-bold text-[#facc15]">$5–$50 USD</span> in a
          PayPal authorization hold. Prove your commitment before the deadline
          — or forfeit the stake.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={scrollToCreate}
            className="inline-flex cursor-pointer items-center gap-2 border-2 border-white bg-[#facc15] px-6 py-3 font-pixel text-xs font-bold uppercase tracking-wider text-black shadow-[4px_4px_0px_#ffffff] transition hover:bg-[#fde047] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none focus:outline-2 focus:outline-offset-2 focus:outline-[#facc15]"
          >
            Lock a Stake
            <PixelArrowDownIcon className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={handleReplay}
            disabled={!settled}
            className="inline-flex cursor-pointer items-center gap-2 border-2 border-white bg-black px-5 py-3 font-pixel text-[11px] uppercase tracking-wider text-white shadow-[4px_4px_0px_#404040] transition hover:border-[#facc15] hover:text-[#facc15] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PixelRefreshIcon className="h-3.5 w-3.5" />
            Replay
          </button>
        </div>
      </div>
    </section>
  );
}
