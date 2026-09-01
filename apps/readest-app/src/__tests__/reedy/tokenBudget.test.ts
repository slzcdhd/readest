import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateChars,
  estimateCharsForCjk,
  estimateCharsForLatin,
} from '@/services/reedy/context/tokenBudget';

describe('tokenBudget — charset-aware token estimate', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ASCII prose at ~4 chars per token', () => {
    // 40 ASCII chars → ~10 tokens (within the old flat model's ballpark)
    const text = 'The quick brown fox jumps over the dog.'.repeat(2);
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it('counts CJK far denser than the flat 4-char model', () => {
    const text = '人工智能正在改变阅读的方式。'.repeat(10); // 120 CJK chars
    const dense = estimateTokens(text);
    const flatLegacy = Math.ceil(text.length / 4);
    // 120 CJK chars ≈ 80 tokens (1.5 chars/token), vs legacy 30 — the whole
    // point of the fix: the old estimate undercounts by ~2.67x.
    expect(dense).toBeGreaterThan(flatLegacy);
    expect(dense).toBeCloseTo(text.length / 1.5, -1);
  });

  it('mixes CJK and Latin correctly', () => {
    // '中文内容' ×5 = 20 CJK chars; 'English words here' ×2 = 36 latin
    // chars (spaces counted as Latin). Expected = ceil(20/1.5 + 36/4) = 23.
    const mixed = '中文内容'.repeat(5) + 'English words here'.repeat(2);
    expect(estimateTokens(mixed)).toBe(Math.ceil(20 / 1.5 + 36 / 4));
  });

  it('never returns 0 for non-empty whitespace-ish input', () => {
    expect(estimateTokens('   ')).toBeGreaterThanOrEqual(1);
  });

  it('inverse estimateChars stays conservative (CJK-biased)', () => {
    // 100 tokens → CJK-biased char budget = floor(100 * 1.5) = 150
    expect(estimateChars(100)).toBe(150);
  });

  it('explicit inverses use their own charset rate', () => {
    expect(estimateCharsForCjk(100)).toBe(150);
    expect(estimateCharsForLatin(100)).toBe(400);
  });
});
