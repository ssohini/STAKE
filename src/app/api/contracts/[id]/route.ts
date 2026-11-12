import { NextResponse } from 'next/server';
import { getContractStore, StorageConfigError } from '@/lib/store';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const store = getContractStore();
    const contract = await store.get(id);

    if (!contract) {
      return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });
    }

    return NextResponse.json({ contract });
  } catch (error) {
    const status = error instanceof StorageConfigError ? 503 : 500;
    const message =
      error instanceof Error ? error.message : 'Failed to load contract.';
    return NextResponse.json({ error: message }, { status });
  }
}
