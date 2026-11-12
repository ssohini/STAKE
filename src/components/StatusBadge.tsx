import type { ContractStatus } from '@/lib/types';

const STATUS_META: Record<
  ContractStatus,
  { label: string; classes: string; blockColor: string }
> = {
  pending_auth: {
    label: 'AWAITING PAYPAL AUTH',
    classes: 'border-white bg-black text-white',
    blockColor: 'bg-white',
  },
  authorized: {
    label: 'FUNDS HELD · AUTHORIZED',
    classes: 'border-[#facc15] bg-[#facc15] text-black',
    blockColor: 'bg-black',
  },
  needs_retry: {
    label: 'NEEDS RETRY · $0 MOVED',
    classes: 'border-[#facc15] bg-black text-[#facc15]',
    blockColor: 'bg-[#facc15]',
  },
  voided: {
    label: 'VOIDED · YOU KEPT IT',
    classes: 'border-white bg-[#facc15] text-black',
    blockColor: 'bg-black',
  },
  captured: {
    label: 'CAPTURED · STAKE LOST',
    classes: 'border-white bg-white text-black',
    blockColor: 'bg-black',
  },
  expired_captured: {
    label: 'EXPIRED · CAPTURED',
    classes: 'border-white bg-white text-black',
    blockColor: 'bg-black',
  },
  expired_unfunded: {
    label: 'EXPIRED · UNFUNDED',
    classes: 'border-neutral-500 bg-black text-neutral-400',
    blockColor: 'bg-neutral-500',
  },
};

export function StatusBadge({ status }: { status: ContractStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-2 border-2 px-2.5 py-1 font-pixel text-[10px] font-bold uppercase tracking-wider ${meta.classes}`}
    >
      <span className={`inline-block h-2 w-2 ${meta.blockColor}`} />
      {meta.label}
    </span>
  );
}
