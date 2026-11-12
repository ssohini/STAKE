import { NextResponse } from 'next/server';
import { getEnvDiagnostics } from '@/lib/env';

export async function GET() {
  const diagnostics = getEnvDiagnostics();
  return NextResponse.json(
    {
      status: diagnostics.ready ? 'ok' : 'unconfigured',
      ...diagnostics,
      checkedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}
