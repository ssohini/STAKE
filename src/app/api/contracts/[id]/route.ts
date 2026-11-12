import { NextResponse } from 'next/server';
import { getContractStore } from '@/lib/store';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const store = getContractStore();
  const contract = await store.get(id);

  if (!contract) {
    return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });
  }

  return NextResponse.json({ contract });
}
