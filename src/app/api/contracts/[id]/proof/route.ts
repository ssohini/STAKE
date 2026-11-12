import { NextResponse } from 'next/server';
import { validateProofImage } from '@/lib/image-validation';
import { PayPalApiError } from '@/lib/paypal';
import { ContractActionError, evaluateAndSettleProof } from '@/lib/settle';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data with an image upload.' },
      { status: 400 }
    );
  }

  const fileEntry = formData.get('proof') ?? formData.get('file');
  if (!(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: 'Missing proof image file in form field "proof".' },
      { status: 400 }
    );
  }

  const arrayBuffer = await fileEntry.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const imageCheck = validateProofImage(bytes, fileEntry.type, fileEntry.name);

  if (!imageCheck.valid) {
    return NextResponse.json({ error: imageCheck.error }, { status: 400 });
  }

  try {
    const result = await evaluateAndSettleProof({
      contractId: id,
      imageBytes: bytes,
      mimeType: imageCheck.mimeType,
      sizeBytes: imageCheck.sizeBytes,
      sha256: imageCheck.sha256,
      filename: imageCheck.sanitizedFilename,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ContractActionError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          debugId: error.debugId ?? null,
        },
        { status: error.status }
      );
    }

    if (error instanceof PayPalApiError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          debugId: error.debugId,
        },
        { status: error.status >= 400 ? error.status : 502 }
      );
    }

    const message =
      error instanceof Error ? error.message : 'Unexpected proof evaluation error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
