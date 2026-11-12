import { describe, expect, it } from 'vitest';
import {
  clampToTwoSentences,
  decideSettlement,
  parseAndValidateVerdict,
} from '../verdict';

describe('parseAndValidateVerdict', () => {
  it('accepts structured PASS verdict JSON with reason & feedback', () => {
    const res = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'PASS',
        confidence: 0.91,
        reason: 'Running watch shows 5.04 km completed outdoors.',
        feedback: 'Fine, you actually ran the 5k. Keep your lunch money this time.',
      })
    );

    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.verdict.verdict).toBe('PASS');
      expect(res.verdict.confidence).toBe(0.91);
      expect(res.verdict.reason).toContain('5.04 km');
      expect(res.verdict.feedback).toContain('actually ran');
      expect(res.verdict.roast).toBe(res.verdict.feedback);
    }
  });

  it('accepts REVIEW verdict and legacy roast field cleanly', () => {
    const reviewRes = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'REVIEW',
        confidence: 0.62,
        reason: 'Photo is too dark to confirm whether dishes are washed.',
        feedback: 'Turn on the kitchen lights and shoot it again.',
      })
    );
    expect(reviewRes.valid).toBe(true);
    if (reviewRes.valid) {
      expect(reviewRes.verdict.verdict).toBe('REVIEW');
    }

    const legacy = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'pass',
        confidence: 0.85,
        roast: 'Legacy payload passed.',
      })
    );
    expect(legacy.valid).toBe(true);
    if (legacy.valid) {
      expect(legacy.verdict.verdict).toBe('PASS');
      expect(legacy.verdict.feedback).toBe('Legacy payload passed.');
    }
  });

  it('rejects non-JSON or markdown-wrapped output', () => {
    const res = parseAndValidateVerdict(
      '```json\n{"verdict":"PASS","confidence":0.9,"reason":"ok","feedback":"Nice"}\n```'
    );
    expect(res.valid).toBe(false);
  });

  it('rejects invalid verdict enum values and missing reason/feedback', () => {
    expect(
      parseAndValidateVerdict(
        JSON.stringify({ verdict: 'MAYBE', confidence: 0.8, reason: 'x', feedback: 'y' })
      ).valid
    ).toBe(false);

    expect(
      parseAndValidateVerdict(
        JSON.stringify({ verdict: 'PASS', confidence: 0.9, feedback: 'Missing reason' })
      ).valid
    ).toBe(false);
  });

  it('rejects out-of-range or NaN confidence', () => {
    expect(
      parseAndValidateVerdict(
        JSON.stringify({ verdict: 'PASS', confidence: 1.2, reason: 'x', feedback: 'No.' })
      ).valid
    ).toBe(false);

    expect(
      parseAndValidateVerdict(
        JSON.stringify({ verdict: 'FAIL', confidence: -0.1, reason: 'x', feedback: 'No.' })
      ).valid
    ).toBe(false);
  });

  it('clamps feedback/roast to maximum 2 sentences', () => {
    const res = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'FAIL',
        confidence: 0.88,
        reason: 'Stock watermark detected.',
        feedback: 'Sentence one. Sentence two! Sentence three should be cut.',
      })
    );
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.verdict.feedback).toBe('Sentence one. Sentence two!');
      expect(res.verdict.roast).toBe('Sentence one. Sentence two!');
    }
  });

  it('preserves decimal measurements (5.24 km) and currency ($25.00) when clamping feedback', () => {
    expect(
      clampToTwoSentences(
        'You actually laced up and smashed 5.24 km in under 28 minutes. Your $25.00 stake is safe today!'
      )
    ).toBe(
      'You actually laced up and smashed 5.24 km in under 28 minutes. Your $25.00 stake is safe today!'
    );

    expect(
      clampToTwoSentences(
        'You ran 5.24 km? Say goodbye to your $25.00! Next time show up on time.'
      )
    ).toBe('You ran 5.24 km? Say goodbye to your $25.00!');

    expect(
      clampToTwoSentences(
        'Your confidence was 0.49. Try again for your $25.00. Seriously now.'
      )
    ).toBe('Your confidence was 0.49. Try again for your $25.00.');

    const res = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'FAIL',
        confidence: 0.96,
        reason: 'Blank image.',
        feedback:
          'You logged 0.00 km instead of 5.24 km. Say goodbye to your $25.00. Better luck tomorrow.',
      })
    );
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.verdict.feedback).toBe(
        'You logged 0.00 km instead of 5.24 km. Say goodbye to your $25.00.'
      );
      expect(res.verdict.roast).toBe(
        'You logged 0.00 km instead of 5.24 km. Say goodbye to your $25.00.'
      );
    }
  });
});

describe('decideSettlement', () => {
  it('voids authorization when PASS and confidence >= 0.5', () => {
    const validation = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'PASS',
        confidence: 0.5,
        reason: 'Goal evidenced.',
        feedback: 'Barely made it.',
      })
    );
    expect(decideSettlement(validation).action).toBe('void');
  });

  it('captures authorization when FAIL and confidence >= 0.5', () => {
    const validation = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'FAIL',
        confidence: 0.85,
        reason: 'Stock image.',
        feedback: 'That is a Google Images watermark. Pay up.',
      })
    );
    expect(decideSettlement(validation).action).toBe('capture');
  });

  it('returns needs_retry for REVIEW verdict regardless of confidence', () => {
    const review = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'REVIEW',
        confidence: 0.78,
        reason: 'Text obscured by glare.',
        feedback: 'Retake without glare.',
      })
    );
    expect(decideSettlement(review).action).toBe('needs_retry');
  });

  it('returns needs_retry when confidence < 0.5 (even if verdict is PASS or FAIL)', () => {
    const lowPass = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'PASS',
        confidence: 0.49,
        reason: 'Blurry.',
        feedback: 'Too blurry to tell.',
      })
    );
    const lowFail = parseAndValidateVerdict(
      JSON.stringify({
        verdict: 'FAIL',
        confidence: 0.25,
        reason: 'Dark.',
        feedback: 'Lighting is terrible.',
      })
    );

    expect(decideSettlement(lowPass).action).toBe('needs_retry');
    expect(decideSettlement(lowFail).action).toBe('needs_retry');
  });

  it('returns needs_retry when JSON is invalid', () => {
    const invalid = parseAndValidateVerdict('not json at all');
    const decision = decideSettlement(invalid);
    expect(decision.action).toBe('needs_retry');
  });
});
