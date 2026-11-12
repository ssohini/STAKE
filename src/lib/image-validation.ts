import crypto from 'node:crypto';
import path from 'node:path';
import { MAX_PROOF_BYTES } from './types';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const ALLOWED_MIMES: ReadonlySet<string> = new Set<SupportedImageMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXTENSION_TO_MIME: Record<string, SupportedImageMime> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export type ImageValidationResult =
  | {
      valid: true;
      mimeType: SupportedImageMime;
      sizeBytes: number;
      sha256: string;
      sanitizedFilename?: string;
    }
  | { valid: false; error: string };

/**
 * Detects real image format from file magic bytes and structural headers
 * so spoofed Content-Type headers, SVG/HTML polyglots, or corrupt payloads are rejected.
 */
export function detectImageMimeFromBytes(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length < 12) return null;

  // Reject text/HTML/SVG payloads disguised as images
  const headAscii = Buffer.from(bytes.subarray(0, Math.min(64, bytes.length)))
    .toString('utf8')
    .trimStart()
    .toLowerCase();
  if (
    headAscii.startsWith('<svg') ||
    headAscii.startsWith('<?xml') ||
    headAscii.startsWith('<!doctype') ||
    headAscii.startsWith('<html') ||
    headAscii.startsWith('<script')
  ) {
    return null;
  }

  // JPEG: FF D8 FF followed by valid JPEG marker byte (0xC0..0xFE)
  if (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[3] >= 0xc0
  ) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A; if >= 24 bytes also verify IHDR chunk and non-zero dimensions
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    if (bytes.length >= 24) {
      const chunkType = String.fromCharCode(
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
      );
      if (chunkType !== 'IHDR') return null;
      const width =
        (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height =
        (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (width <= 0 || height <= 0) return null;
    }
    return 'image/png';
  }

  // WEBP: "RIFF" .... "WEBP", and if >= 16 bytes check "VP8" chunk signature
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === 'RIFF' && webp === 'WEBP') {
    if (bytes.length >= 16) {
      const vp8 = String.fromCharCode(bytes[12], bytes[13], bytes[14]);
      if (vp8 !== 'VP8') return null;
    }
    return 'image/webp';
  }

  return null;
}

export function normalizeDeclaredMime(mime: string): string {
  const lowered = mime.trim().toLowerCase();
  if (lowered === 'image/jpg') return 'image/jpeg';
  return lowered;
}

export function sanitizeFilename(rawName?: string): string | undefined {
  if (!rawName) return undefined;
  const base = path.basename(rawName).replace(/[^\w.\- ]+/g, '_').trim();
  if (!base || base === 'blob') return undefined;
  return base.slice(0, 120);
}

export function validateProofImage(
  bytes: Uint8Array,
  declaredMimeType: string,
  filename?: string
): ImageValidationResult {
  if (bytes.byteLength === 0) {
    return { valid: false, error: 'Uploaded file is empty.' };
  }

  if (bytes.byteLength > MAX_PROOF_BYTES) {
    return {
      valid: false,
      error: `Image exceeds the ${(MAX_PROOF_BYTES / (1024 * 1024)).toFixed(0)} MB limit (${(bytes.byteLength / (1024 * 1024)).toFixed(2)} MB uploaded).`,
    };
  }

  const normalizedDeclared = normalizeDeclaredMime(declaredMimeType);
  if (!ALLOWED_MIMES.has(normalizedDeclared)) {
    return {
      valid: false,
      error: 'Unsupported file type. Upload a JPEG, PNG, or WEBP image.',
    };
  }

  const sanitizedFilename = sanitizeFilename(filename);
  if (sanitizedFilename) {
    const ext = path.extname(sanitizedFilename).toLowerCase();
    if (!ext) {
      return {
        valid: false,
        error: 'Uploaded image filename must include a .jpg, .jpeg, .png, or .webp extension.',
      };
    }
    const extMime = EXTENSION_TO_MIME[ext];
    if (!extMime) {
      return {
        valid: false,
        error: `Unsupported file extension "${ext}". Allowed extensions: .jpg, .jpeg, .png, .webp.`,
      };
    }
    if (extMime !== normalizedDeclared) {
      return {
        valid: false,
        error: `File extension (${ext}) does not match declared MIME type (${normalizedDeclared}).`,
      };
    }
  }

  const detected = detectImageMimeFromBytes(bytes);
  if (!detected) {
    return {
      valid: false,
      error: 'File contents do not match a valid JPEG, PNG, or WEBP image.',
    };
  }

  if (detected !== normalizedDeclared) {
    return {
      valid: false,
      error: `Image signature (${detected}) does not match declared MIME type (${normalizedDeclared}).`,
    };
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  return {
    valid: true,
    mimeType: detected,
    sizeBytes: bytes.byteLength,
    sha256,
    sanitizedFilename,
  };
}
