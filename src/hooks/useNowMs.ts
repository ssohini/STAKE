'use client';

import { useSyncExternalStore } from 'react';

let currentNowMs = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (intervalId === null && typeof window !== 'undefined') {
    currentNowMs = Date.now();
    intervalId = setInterval(() => {
      currentNowMs = Date.now();
      listeners.forEach((fn) => fn());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  return currentNowMs;
}

function getServerSnapshot(): number | null {
  return null;
}

/**
 * Hydration-safe 1-second live clock hook: returns null during SSR/hydration
 * and ticks once per second on the client without setState-in-effect warnings.
 */
export function useNowMs(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
