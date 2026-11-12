import { Suspense } from 'react';
import { CreateContractForm } from '@/components/CreateContractForm';
import { RecentContractsPanel } from '@/components/RecentContractsPanel';
import { StakeHero } from '@/components/StakeHero';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-black">
      {/* Opening Cinematic 3D Coin -> STaKE Reveal (Preserved Photorealistic Hero) */}
      <StakeHero />

      {/* Minecraft-Inspired Pixel Block Interface */}
      <div className="pixel-divider" />

      <div className="pixel-grid-bg py-14">
        <div className="mx-auto max-w-4xl space-y-10 px-4 sm:px-6">
          <Suspense
            fallback={
              <div className="h-[520px] border-2 border-white bg-black" />
            }
          >
            <CreateContractForm />
          </Suspense>

          <RecentContractsPanel />
        </div>
      </div>
    </div>
  );
}
