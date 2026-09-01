import type { WikiDb } from './WikiDb';
import type { WikiPage } from './types';

/**
 * Read-side query for the word-lookup card (plan §2.5 "三态卡片").
 *
 * Maps a selected word/phrase to one of three states:
 *   - 'multi'  : compiled, mentioned in ≥2 books → cross-book emphasis
 *   - 'single' : compiled, mentioned in 1 book → weakened single-book card
 *   - 'none'   : not compiled → fall through to Wikipedia/dictionary
 *
 * A draft page (never user-accepted) is surfaced with `verified: false` so
 * the UI can label it "AI 草稿 · 未校验" and withhold the cross-book claim.
 */

export type WikiLookupState = 'multi' | 'single' | 'none';

export interface WikiLookupResult {
  state: WikiLookupState;
  /** The matched page, when state !== 'none'. */
  page: WikiPage | null;
  /** Distinct books with evidence (the "N books" number). */
  bookCount: number;
  /** False when the page is still a draft (not user-accepted). */
  verified: boolean;
  /** Evidence snippets to render inline with jump-back anchors. */
  evidence: Array<{ snippet: string; bookHash: string }>;
}

export async function wikiLookup(wiki: WikiDb, term: string): Promise<WikiLookupResult> {
  const matches = await wiki.searchPages(term);
  if (matches.length === 0) {
    return { state: 'none', page: null, bookCount: 0, verified: false, evidence: [] };
  }
  // Prefer an active page; fall back to the first draft.
  const active = matches.find((m) => m.page.status === 'active') ?? matches[0]!;
  const page = active.page;
  const bookCount = active.bookCount;
  const verified = page.status === 'active';
  const evidence = await wiki.listEvidence(page.id);
  return {
    state: bookCount >= 2 ? 'multi' : 'single',
    page,
    bookCount,
    verified,
    evidence: evidence.map((e) => ({ snippet: e.snippet, bookHash: e.bookHash })),
  };
}
