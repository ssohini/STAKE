import type { Metadata } from 'next';
import { Geist, Geist_Mono, Silkscreen } from 'next/font/google';
import Link from 'next/link';
import { NewStakeButton } from '@/components/NewStakeButton';
import { PixelDollarIcon } from '@/components/PixelIcons';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const silkscreen = Silkscreen({
  weight: ['400', '700'],
  variable: '--font-pixel',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'STAKE — AI-Judged PayPal Commitment Contracts',
  description:
    'Put $5–$50 USD into a PayPal authorization hold. Prove your commitment before the deadline — or Coach Razor captures your stake.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${silkscreen.variable} h-full dark antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white font-sans selection:bg-[#facc15] selection:text-black">
        <header className="sticky top-0 z-40 border-b-2 border-white bg-black">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
            <Link
              href="/"
              className="group inline-flex items-center gap-3 focus:outline-none"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center border-2 border-white bg-[#facc15] text-black shadow-[3px_3px_0px_#ffffff] transition-transform group-hover:translate-x-[1px] group-hover:translate-y-[1px] group-hover:shadow-[2px_2px_0px_#ffffff]">
                <PixelDollarIcon className="h-4 w-4" />
              </span>
              <div className="flex flex-col">
                <span className="font-pixel text-base font-bold tracking-[0.14em] text-white leading-none">
                  STAKE
                </span>
                <span className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-neutral-400">
                  BLOCK ESCROW
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-block border-2 border-white bg-black px-2.5 py-1 font-pixel text-[10px] tracking-wider text-[#facc15]">
                PAYPAL V2 · SANDBOX
              </span>
              <NewStakeButton />
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t-2 border-white bg-black py-6 text-xs text-neutral-400">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="font-mono">
              STAKE — Authorization holds settled deterministically on server.
            </p>
            <p className="font-pixel text-[10px] uppercase tracking-wider text-[#facc15]">
              HONOR WINDOW ~3 DAYS · AUTH VALID 29D
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
