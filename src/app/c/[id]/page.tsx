import { Suspense } from 'react';
import Link from 'next/link';
import { ContractWorkbench } from '@/components/ContractWorkbench';
import { PixelAlertIcon, PixelArrowRightIcon } from '@/components/PixelIcons';
import { getContractStore } from '@/lib/store';

async function ContractLoader({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = getContractStore();
  const contract = await store.get(id);

  if (!contract) {
    return (
      <div className="pixel-grid-bg min-h-[calc(100vh-140px)] py-20 px-4">
        <div className="mx-auto max-w-xl">
          <div className="pixel-card-yellow p-8 text-center">
            <PixelAlertIcon className="mx-auto h-10 w-10 text-[#facc15]" />
            <h1 className="mt-4 font-pixel text-xl font-bold uppercase text-white">
              CONTRACT NOT FOUND
            </h1>
            <p className="mt-3 font-mono text-xs text-neutral-300">
              No commitment contract exists with ID{' '}
              <code className="border border-white bg-black px-1.5 py-0.5 text-[#facc15]">
                {id}
              </code>
              .
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center gap-2 border-2 border-white bg-[#facc15] px-5 py-2.5 font-pixel text-xs font-bold uppercase tracking-wider text-black shadow-[4px_4px_0px_#ffffff] transition hover:bg-[#fde047] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
            >
              CREATE A NEW STAKE
              <PixelArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const paypalClientId =
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim() ||
    process.env.PAYPAL_CLIENT_ID?.trim() ||
    '';

  return (
    <div className="pixel-grid-bg min-h-[calc(100vh-140px)]">
      <ContractWorkbench
        initialContract={contract}
        paypalClientId={paypalClientId}
        storageKind={store.kind}
      />
    </div>
  );
}

export default function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="pixel-grid-bg min-h-[calc(100vh-140px)] px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="h-48 border-2 border-white bg-[#0a0a0a]" />
            <div className="h-64 border-2 border-white bg-[#0a0a0a]" />
          </div>
        </div>
      }
    >
      <ContractLoader params={params} />
    </Suspense>
  );
}
