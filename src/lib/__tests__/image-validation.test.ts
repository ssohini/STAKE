import { describe, expect, it } from 'vitest';
import { validateProofImage } from '../image-validation';
import { MAX_PROOF_BYTES } from '../types';

const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
]);
const VALID_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
]);
const VALID_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, // WEBP + VP8
]);

describe('validateProofImage', () => {
  it('accepts valid PNG, JPEG, and WEBP magic signatures with matching extensions', () => {
    const png = validateProofImage(VALID_PNG, 'image/png', 'proof.png');
    const jpg = validateProofImage(VALID_JPEG, 'image/jpg', 'photo.JPG');
    const webp = validateProofImage(VALID_WEBP, 'image/webp', 'snap.webp');

    expect(png.valid).toBe(true);
    expect(jpg.valid).toBe(true);
    expect(webp.valid).toBe(true);
    if (jpg.valid) {
      expect(jpg.mimeType).toBe('image/jpeg');
      expect(jpg.sanitizedFilename).toBe('photo.JPG');
    }
  });

  it('rejects files over 4 MB limit', () => {
    const oversized = new Uint8Array(MAX_PROOF_BYTES + 1);
    oversized.set(VALID_PNG);
    const res = validateProofImage(oversized, 'image/png', 'big.png');
    expect(res.valid).toBe(false);
  });

  it('rejects empty files and SVG/HTML polyglots', () => {
    expect(validateProofImage(new Uint8Array(0), 'image/png', 'empty.png').valid).toBe(false);
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    expect(validateProofImage(svg, 'image/png', 'evil.png').valid).toBe(false);
  });

  it('rejects disallowed or mismatched file extensions', () => {
    expect(validateProofImage(VALID_PNG, 'image/png', 'proof.svg').valid).toBe(false);
    expect(validateProofImage(VALID_PNG, 'image/png', 'proof.jpg').valid).toBe(false);
    expect(validateProofImage(VALID_PNG, 'image/png', 'noextension').valid).toBe(false);
  });

  it('rejects spoofed MIME types and corrupt PNG dimensions', () => {
    expect(validateProofImage(VALID_JPEG, 'image/png', 'trick.png').valid).toBe(false);

    const zeroDimPng = new Uint8Array(VALID_PNG);
    zeroDimPng[19] = 0; // width = 0
    expect(validateProofImage(zeroDimPng, 'image/png', 'zero.png').valid).toBe(false);
  });
});
