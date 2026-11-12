import { NextResponse } from 'next/server';
import { isConfiguredEnvValue } from '@/lib/env';
import { resolveExpiredContracts } from '@/lib/settle';

async function runResolve() {
  try {
    const summary = await resolveExpiredContracts();
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to resolve expired contracts.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Supports Vercel Cron invocations (which issue GET with Authorization: Bearer <CRON_SECRET>).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (isConfiguredEnvValue(cronSecret)) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret.trim()}`) {
      return NextResponse.json({ error: 'Unauthorized cron call.' }, { status: 401 });
    }
  }
  return runResolve();
}

export async function POST() {
  return runResolve();
}
