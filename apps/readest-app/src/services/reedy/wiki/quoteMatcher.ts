/**
 * Robust quote → text-offset matching for llm-wiki ingest.
 *
 * The LLM is asked to quote the source verbatim, but in practice it
 * "polishes" quotes — full-width/half-width conversions, quote-mark and
 * dash normalization, dropped particles, punctuation changes. A bare
 * `indexOf` therefore misses far more often than it hits on real books.
 *
 * Resolution order (plan §2.3 "引文鲁棒匹配"):
 *   1. exact indexOf
 *   2. normalized indexOf (full-width→half-width, quote/dash normalization,
 *      whitespace collapse) then map back to the original offsets
 *   3. 8-char anchor prefix substring match
 *   4. give up — return null; the caller drops only this evidence, not the
 *      whole proposal.
 *
 * All functions are pure and unit-testable without a DB.
 */

export interface QuoteMatch {
  start: number;
  end: number;
  /** How the match was found — surfaced for telemetry (quote_hit_rate). */
  method: 'exact' | 'normalized' | 'anchor';
}

/** Normalize a single code point for lenient matching. */
function normalizeChar(ch: string): string {
  const code = ch.codePointAt(0)!;
  // Full-width ASCII (FF01–FF5E) → half-width (21–7E).
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCodePoint(code - 0xfee0);
  // Full-width space → space.
  if (code === 0x3000) return ' ';
  // Curly/smart quotes and CJK quotes → straight quote.
  if ('\u2018\u2019\u201c\u201d\u300c\u300d\u300e\u300f\u00ab\u00bb'.includes(ch)) return '"';
  // Dashes → hyphen.
  if ('\u2013\u2014\u2015\u2500'.includes(ch)) return '-';
  // Horizontal ellipsis → three dots.
  if (code === 0x2026) return '...';
  return ch;
}

/**
 * Normalize for lenient matching AND record, for every normalized char
 * position, the index in the original it came from. This makes the
 * normalized→original index mapping exact (no fragile lockstep).
 */
function normalizeWithMap(s: string): { text: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const code = ch.codePointAt(0)!;
    // Collapse a whitespace run (incl. full-width space) to a single space.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || code === 0x3000) {
      // Emit one space for the run, mapping it to the run's first char.
      if (chars[chars.length - 1] !== ' ') {
        chars.push(' ');
        map.push(i);
      }
      i++;
      continue;
    }
    chars.push(normalizeChar(ch));
    map.push(i);
    i++;
  }
  // Trim a leading/trailing space.
  if (chars[0] === ' ') {
    chars.shift();
    map.shift();
  }
  if (chars[chars.length - 1] === ' ') {
    chars.pop();
    map.pop();
  }
  return { text: chars.join(''), map };
}

/** Normalize for lenient matching: width, quotes, dashes, whitespace. */
export function normalizeForMatch(s: string): string {
  return normalizeWithMap(s).text;
}

/**
 * Locate `quote` within `chapterText`. Returns null when it can't be found
 * unambiguously enough to trust.
 */
export function matchQuote(chapterText: string, quote: string): QuoteMatch | null {
  const q = quote.trim();
  if (q.length === 0) return null;

  // 1. exact
  const exact = chapterText.indexOf(q);
  if (exact >= 0) {
    return { start: exact, end: exact + q.length, method: 'exact' };
  }

  // 2. normalized
  const { text: normChapter, map: chapterMap } = normalizeWithMap(chapterText);
  const normQuote = normalizeForMatch(q);
  const normIdx = normChapter.indexOf(normQuote);
  if (normIdx >= 0) {
    const start = chapterMap[normIdx] ?? 0;
    // Prefer a clean exact span at the mapped start.
    const slice = chapterText.slice(start, start + q.length);
    if (slice === q) return { start, end: start + q.length, method: 'normalized' };
    // Otherwise map the span end through the map for the best estimate.
    const endIdx = normIdx + normQuote.length;
    const end = chapterMap[Math.min(endIdx, chapterMap.length - 1)] ?? start + q.length;
    return { start, end: Math.max(end, start + 1), method: 'normalized' };
  }

  // 3. 8-char anchor prefix
  if (q.length >= 8) {
    const anchor = q.slice(0, 8);
    const anchorNorm = normalizeForMatch(anchor);
    const anchorIdx = normChapter.indexOf(anchorNorm);
    if (anchorIdx >= 0) {
      const start = chapterMap[anchorIdx] ?? 0;
      return { start, end: start + q.length, method: 'anchor' };
    }
  }

  return null;
}

/** Compute the hit rate (0–1) for a set of quote-matching attempts. */
export function quoteHitRate(results: Array<QuoteMatch | null>): number {
  if (results.length === 0) return 1;
  return results.filter((r) => r !== null).length / results.length;
}
