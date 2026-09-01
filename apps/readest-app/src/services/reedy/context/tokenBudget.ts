/**
 * Cheap token-count heuristic used by PromptContextBuilder for shrink
 * decisions. Real tokenization needs the active model's tokenizer; pulling
 * one in (`tiktoken`, model-specific BPE, …) is gigabytes of byte-pair
 * tables for marginal accuracy at the prompt-budgeting layer.
 *
 * The estimate is charset-aware: CJK (and other wide/ideographic scripts)
 * tokenize far denser than Latin prose — roughly one token per ~1.5
 * characters for Chinese/Japanese/Korean, versus ~3.7–4 characters per
 * token for English. A single flat `chars / 4` estimate undercounts CJK by
 * ~2.67x, which silently overflows the budget on Ollama's 4K window (the
 * shrink layer never fires because it thinks there's room). Splitting by
 * script keeps the estimate within a usable margin for both.
 *
 * Replace this with a tokenizer-backed estimate if/when latency or
 * accuracy becomes the bottleneck (see Phase 2.5 follow-up).
 */

/** Characters per token for Latin/ASCII prose. ~3.7 for English. */
const CHARS_PER_TOKEN_LATIN = 4;

/**
 * Characters per token for CJK and other ideographic scripts. Chinese
 * typically lands ~1.5 chars/token in BPE tokenizers; treat it as one
 * token per 1.5 chars (i.e. 2 chars ≈ 1.33 tokens) for budgeting.
 */
const CHARS_PER_TOKEN_CJK = 1.5;

/** Script blocks we classify as "dense" (≈ CJK tokenization). */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0xac00, 0xd7af], // Hangul Syllables
  [0x1100, 0x11ff], // Hangul Jamo
];

function isCjk(code: number): boolean {
  return CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

function classify(text: string): { cjk: number; latin: number } {
  let cjk = 0;
  let latin = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isCjk(code)) cjk++;
    // Spaces and punctuation are part of the Latin token stream (they
    // delimit words but still consume tokenizer budget), so count them on
    // the Latin side. Only true control chars (< 0x20, plus DEL) are
    // dropped — they're rare in prose and don't meaningfully tokenize.
    else if (code >= 0x20 && code !== 0x7f) latin++;
  }
  return { cjk, latin };
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const { cjk, latin } = classify(text);
  // Whitespace-only fragments still cost a token; guard against 0.
  const estimate = cjk / CHARS_PER_TOKEN_CJK + latin / CHARS_PER_TOKEN_LATIN;
  return Math.max(1, Math.ceil(estimate));
}

/**
 * Inverse: rough char budget for a given token budget. Useful when a
 * layer wants to truncate text to fit a per-layer cap.
 *
 * NOTE: this can no longer be a single division — the split depends on the
 * script mix of the *specific* text being truncated. Callers who need a
 * char budget should instead truncate incrementally and re-measure with
 * `estimateTokens`, or use `estimateCharsForCjk` when the text is known to
 * be predominantly CJK. Kept for source compatibility, biased toward the
 * conservative (CJK) end so a caller underestimates available room rather
 * than overflowing.
 */
export function estimateChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN_CJK));
}

/** Explicit CJK-aware inverse for callers that know their text is dense. */
export function estimateCharsForCjk(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN_CJK));
}

/** Explicit Latin-aware inverse for callers that know their text is ASCII. */
export function estimateCharsForLatin(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN_LATIN));
}
