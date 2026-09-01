import { describe, it, expect } from 'vitest';
import { matchQuote, normalizeForMatch, quoteHitRate } from '@/services/reedy/wiki/quoteMatcher';

describe('quoteMatcher — matchQuote', () => {
  it('matches an exact quote', () => {
    const chapter = 'The concept of entropy is central to thermodynamics.';
    const m = matchQuote(chapter, 'entropy is central');
    expect(m).not.toBeNull();
    expect(m!.start).toBe(chapter.indexOf('entropy is central'));
    expect(m!.end).toBe(m!.start + 'entropy is central'.length);
    expect(m!.method).toBe('exact');
  });

  it('matches after full-width → half-width normalization', () => {
    const chapter = '这个概念的英文是 entropy。';
    // LLM renders the ASCII token in full-width.
    const m = matchQuote(chapter, 'ｅｎｔｒｏｐｙ');
    expect(m).not.toBeNull();
    expect(chapter.slice(m!.start, m!.end)).toContain('entropy');
    expect(m!.method).toBe('normalized');
  });

  it('matches when quotes/dashes are normalized', () => {
    // Curly quotes around the phrase, an em dash, and an ellipsis — the LLM
    // hands back straight quotes, a hyphen, and three dots.
    const chapter = 'He said \u201cthe end is nigh\u201d \u2014 and left\u2026';
    const m = matchQuote(chapter, 'He said "the end is nigh" - and left...');
    expect(m).not.toBeNull();
    expect(m!.method).toBe('normalized');
  });

  it('falls back to an 8-char anchor when only the prefix survives', () => {
    const chapter = 'Quantum entanglement is a curious phenomenon in physics.';
    // LLM rewrote the tail; only the prefix matches.
    const m = matchQuote(chapter, 'Quantum entanglement was deeply puzzling to Einstein');
    expect(m).not.toBeNull();
    expect(m!.method).toBe('anchor');
    expect(m!.start).toBe(0);
  });

  it('returns null when nothing matches', () => {
    const chapter = 'Nothing here relates to anything.';
    expect(matchQuote(chapter, 'a completely fabricated sentence')).toBeNull();
  });

  it('returns null for an empty quote', () => {
    expect(matchQuote('some text', '   ')).toBeNull();
  });
});

describe('quoteMatcher — normalizeForMatch', () => {
  it('converts full-width ASCII and full-width space', () => {
    expect(normalizeForMatch('ＡＢＣ　Ｄ')).toBe('ABC D');
  });

  it('normalizes curly quotes and dashes', () => {
    expect(normalizeForMatch('“hello”—world…')).toBe('"hello"-world...');
  });
});

describe('quoteMatcher — quoteHitRate', () => {
  it('computes hit rate', () => {
    expect(quoteHitRate([null, null, null])).toBe(0);
    expect(quoteHitRate([{ start: 0, end: 1, method: 'exact' }, null])).toBe(0.5);
    expect(quoteHitRate([])).toBe(1);
  });
});
