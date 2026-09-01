/**
 * Reading Receipt — the transparency contract for delegated reading
 * (plan §3.2 / §3.8). It records, from OBSERVED tool-call traffic (never
 * the model's own self-report), what the agent actually read and what it
 * skipped, so the user can see the coverage behind an answer.
 *
 * All functions are pure and unit-testable without a runtime.
 */

export interface ReceiptLocator {
  /** Human label, e.g. a chapter title or section id. */
  label: string;
  /** Section index, when known. */
  sectionIndex?: number;
  /** CFI, when the tool resolved one. */
  cfi?: string;
}

export interface ReadEntry {
  locator: ReceiptLocator;
  /** 'full' = sequential full-text read; 'retrieved' = a semantic/lexical hit. */
  mode: 'full' | 'retrieved';
  /** Characters of source text the read covered. */
  chars: number;
}

export interface SkippedEntry {
  locator: ReceiptLocator;
  reason: 'no_relevance' | 'budget_exhausted' | 'unsupported_content';
}

export interface ReadingReceipt {
  read: ReadEntry[];
  skipped: SkippedEntry[];
  /** Total source characters covered by `read` (deduplicated by locator). */
  coveredChars: number;
  /** Number of lookups performed (semantic/lexical retrievals). */
  lookups: number;
  /** Number of navigable citations produced. */
  citations: number;
}

/**
 * Accrue observed tool-call traffic into a receipt. The runtime calls
 * `recordRead` / `recordLookup` / `recordCitation` as it streams tool
 * results, so the receipt reflects what actually happened, not what the
 * model claimed.
 */
export class ReadingReceiptTracker {
  private read = new Map<string, ReadEntry>();
  private skipped: SkippedEntry[] = [];
  private lookups = 0;
  private citations = 0;

  /** Record a full-text read of a section (e.g. getChapterText). */
  recordFullRead(locator: ReceiptLocator, chars: number): void {
    const key = locatorKey(locator);
    const prior = this.read.get(key);
    if (prior) {
      // A full read supersedes a prior retrieval: keep the widest coverage
      // and the most precise locator, and upgrade the mode.
      prior.chars = Math.max(prior.chars, chars);
      prior.locator = { ...prior.locator, ...locator };
      prior.mode = 'full';
      return;
    }
    this.read.set(key, { locator, mode: 'full', chars });
  }

  /** Record a retrieval hit (lookupPassage). */
  recordRetrieved(locator: ReceiptLocator, chars: number): void {
    this.lookups++;
    const key = locatorKey(locator);
    if (!this.read.has(key)) {
      this.read.set(key, { locator, mode: 'retrieved', chars });
    }
  }

  /** Record a skip. */
  recordSkipped(locator: ReceiptLocator, reason: SkippedEntry['reason']): void {
    this.skipped.push({ locator, reason });
  }

  /** Record a citation. */
  recordCitation(): void {
    this.citations++;
  }

  build(): ReadingReceipt {
    const read = [...this.read.values()];
    const coveredChars = read.reduce((sum, e) => sum + e.chars, 0);
    return {
      read,
      skipped: this.skipped,
      coveredChars,
      lookups: this.lookups,
      citations: this.citations,
    };
  }
}

function locatorKey(locator: ReceiptLocator): string {
  return locator.sectionIndex != null ? `s:${locator.sectionIndex}` : `l:${locator.label}`;
}

/** Coverage ratio (0–1) against a total source size in characters. */
export function coverageRatio(receipt: ReadingReceipt, totalChars: number): number {
  if (totalChars <= 0) return 0;
  return Math.min(1, receipt.coveredChars / totalChars);
}
