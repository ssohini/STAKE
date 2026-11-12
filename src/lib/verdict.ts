import type { JudgeVerdict, VerdictValue } from './types';

export const CONFIDENCE_THRESHOLD = 0.5;

export type VerdictValidationResult =
  | { valid: true; verdict: JudgeVerdict }
  | { valid: false; error: string };

export type SettlementDecision =
  | { action: 'void'; verdict: JudgeVerdict }
  | { action: 'capture'; verdict: JudgeVerdict }
  | { action: 'needs_retry'; reason: string; verdict?: JudgeVerdict };

/**
 * Caps user-facing feedback/roast to at most 2 sentences cleanly while preserving punctuation.
 */
export function clampToTwoSentences(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  // Do not treat decimal points (e.g. 5.24 km, $25.00, .50) as sentence terminators.
  const sentences = cleaned.match(/(?:[^.!?]|(?<=[\d$\s]|^)\.(?=\d))+(?:[.!?]+|$)/g);
  if (!sentences || sentences.length <= 2) return cleaned;
  return sentences
    .slice(0, 2)
    .map((s) => s.trim())
    .join(' ')
    .trim();
}

function normalizeVerdictValue(raw: unknown): VerdictValue | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'PASS' || upper === 'FAIL' || upper === 'REVIEW') {
    return upper;
  }
  return null;
}

/**
 * Strictly validates raw text output from the vision model against the required schema:
 * {
 *   "verdict": "PASS" | "FAIL" | "REVIEW",
 *   "confidence": 0.0..1.0,
 *   "reason": "Explanation",
 *   "feedback": "User-facing feedback (max 2 sentences)"
 * }
 * Also supports legacy { verdict, confidence, roast } shape cleanly.
 */
export function parseAndValidateVerdict(rawOutput: string): VerdictValidationResult {
  if (typeof rawOutput !== 'string' || rawOutput.trim().length === 0) {
    return { valid: false, error: 'Model returned an empty response.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput.trim());
  } catch {
    return { valid: false, error: 'Model output was not valid strict JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: 'Model JSON must be a top-level object.' };
  }

  const candidate = parsed as Record<string, unknown>;

  const verdict = normalizeVerdictValue(candidate.verdict);
  if (!verdict) {
    return {
      valid: false,
      error: 'Field "verdict" must be strictly "PASS", "FAIL", or "REVIEW".',
    };
  }

  if (
    typeof candidate.confidence !== 'number' ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    return {
      valid: false,
      error: 'Field "confidence" must be a finite number between 0 and 1.',
    };
  }

  const rawFeedback =
    typeof candidate.feedback === 'string' && candidate.feedback.trim().length > 0
      ? candidate.feedback
      : typeof candidate.roast === 'string' && candidate.roast.trim().length > 0
      ? candidate.roast
      : null;

  if (!rawFeedback) {
    return {
      valid: false,
      error: 'Field "feedback" (or "roast") must be a non-empty string.',
    };
  }

  const feedback = clampToTwoSentences(rawFeedback);
  if (feedback.length > 600) {
    return {
      valid: false,
      error: 'Field "feedback" exceeds maximum allowed length.',
    };
  }

  const rawReason =
    typeof candidate.reason === 'string' && candidate.reason.trim().length > 0
      ? candidate.reason.trim().replace(/\s+/g, ' ')
      : typeof candidate.feedback === 'string'
      ? null
      : feedback;

  if (!rawReason) {
    return {
      valid: false,
      error: 'Field "reason" must be a non-empty explanation string.',
    };
  }

  if (rawReason.length > 800) {
    return {
      valid: false,
      error: 'Field "reason" exceeds maximum allowed length.',
    };
  }

  return {
    valid: true,
    verdict: {
      verdict,
      confidence: Number(candidate.confidence.toFixed(4)),
      reason: rawReason,
      feedback,
      roast: feedback,
    },
  };
}

/**
 * Server-side money routing policy. The AI model never calls PayPal directly;
 * this deterministic rule maps validated JSON + confidence to PayPal actions.
 * REVIEW, invalid JSON, or confidence < 0.50 moves NO money.
 */
export function decideSettlement(
  validation: VerdictValidationResult
): SettlementDecision {
  if (!validation.valid) {
    return {
      action: 'needs_retry',
      reason: validation.error,
    };
  }

  const { verdict } = validation;

  if (verdict.verdict === 'REVIEW') {
    return {
      action: 'needs_retry',
      reason: `AI returned REVIEW: ${verdict.reason}`,
      verdict,
    };
  }

  if (verdict.confidence < CONFIDENCE_THRESHOLD) {
    return {
      action: 'needs_retry',
      reason: `Confidence ${verdict.confidence.toFixed(2)} is below the ${CONFIDENCE_THRESHOLD.toFixed(2)} threshold.`,
      verdict,
    };
  }

  if (verdict.verdict === 'PASS') {
    return { action: 'void', verdict };
  }

  return { action: 'capture', verdict };
}
