import { NextResponse } from 'next/server';
import { buildNewContract, validateCreateContractInput } from '@/lib/contracts';
import { getContractStore, StorageConfigError } from '@/lib/store';

function storageErrorResponse(error: unknown, fallback: string) {
  const status = error instanceof StorageConfigError ? 503 : 500;
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const store = getContractStore();
    const contracts = await store.listAll();
    return NextResponse.json({
      storage: store.kind,
      contracts,
    });
  } catch (error) {
    return storageErrorResponse(error, 'Failed to load contracts.');
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request body.' },
      { status: 400 }
    );
  }

  const validation = validateCreateContractInput(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const contract = buildNewContract(validation.data);
  try {
    const store = getContractStore();
    await store.create(contract);
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    return storageErrorResponse(error, 'Failed to persist new contract.');
  }
}
