'use client';

import { useRouter } from 'next/navigation';

export function NewStakeButton() {
  const router = useRouter();

  function handleClick() {
    if (typeof window === 'undefined') return;

    if (window.location.pathname !== '/') {
      router.push('/#create-stake');
      return;
    }

    if (window.location.search) {
      router.replace('/');
    }
    const el = document.getElementById('create-stake');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.dispatchEvent(new CustomEvent('stake:focus-create'));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="cursor-pointer border-2 border-black bg-[#facc15] px-4 py-1.5 font-pixel text-[11px] font-bold uppercase tracking-wider text-black shadow-[3px_3px_0px_#ffffff] transition hover:bg-[#fde047] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none focus:outline-2 focus:outline-offset-2 focus:outline-[#facc15]"
    >
      + NEW STAKE
    </button>
  );
}
