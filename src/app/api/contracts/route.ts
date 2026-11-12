import { NextResponse } from 'next/server';
import { buildNewContract, validateCreateContractInput } from '@/lib/contracts';
import { getContractStore } from '@/lib/store';

export async function GET() {
  const store = getContractStore();
  const contracts = await store.listAll();
  return NextResponse.json({
    storage: store.kind,
    contracts,
  });
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
  const store = getContractStore();
  await store.create(contract);

  return NextResponse.json({ contract }, { status: 201 });
}
