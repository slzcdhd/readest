import { describe, it, expect } from 'vitest';
import { ReadingReceiptTracker, coverageRatio } from '@/services/reedy/wiki/readingReceipt';
import { createGetChapterTextTool } from '@/services/reedy/tools/builtins/getChapterText';
import { ToolRegistry } from '@/services/reedy/tools/ToolRegistry';
import type { ToolContext } from '@/services/reedy/tools/types';

function ctxFor(): ToolContext {
  return {
    bookHash: 'bk1',
    sessionId: 's1',
    assistantMessageId: 'm1',
    signal: new AbortController().signal,
    requestPermission: async () => true,
  };
}

describe('ReadingReceiptTracker', () => {
  it('accumulates full reads and retrievals distinctly', () => {
    const t = new ReadingReceiptTracker();
    t.recordFullRead({ label: 'Ch1', sectionIndex: 0 }, 5000);
    t.recordRetrieved({ label: 'Ch1', sectionIndex: 0 }, 200);
    t.recordRetrieved({ label: 'Ch3', sectionIndex: 2 }, 150);
    const r = t.build();
    expect(r.read).toHaveLength(2);
    expect(r.lookups).toBe(2);
    const full = r.read.find((e) => e.mode === 'full');
    expect(full!.chars).toBe(5000);
  });

  it('merges a full read over a prior retrieval of the same locator', () => {
    const t = new ReadingReceiptTracker();
    t.recordRetrieved({ label: 'Ch1', sectionIndex: 0 }, 100);
    t.recordFullRead({ label: 'Ch1', sectionIndex: 0 }, 4000);
    const r = t.build();
    expect(r.read).toHaveLength(1);
    expect(r.read[0]!.mode).toBe('full');
    expect(r.read[0]!.chars).toBe(4000);
  });

  it('records skips and citations', () => {
    const t = new ReadingReceiptTracker();
    t.recordSkipped({ label: 'Ch2', sectionIndex: 1 }, 'no_relevance');
    t.recordCitation();
    t.recordCitation();
    const r = t.build();
    expect(r.skipped).toHaveLength(1);
    expect(r.citations).toBe(2);
  });

  it('computes coverage ratio', () => {
    const t = new ReadingReceiptTracker();
    t.recordFullRead({ label: 'Ch1', sectionIndex: 0 }, 500);
    const r = t.build();
    expect(coverageRatio(r, 1000)).toBeCloseTo(0.5);
    expect(coverageRatio(r, 0)).toBe(0);
    // Cap at 1.0 when coverage exceeds the total (overlap).
    expect(coverageRatio(r, 400)).toBe(1);
  });
});

describe('getChapterText tool', () => {
  it('returns the full section text and char count', async () => {
    const reg = new ToolRegistry();
    reg.register(createGetChapterTextTool(async (idx) => (idx === 0 ? 'full chapter text' : '')));
    const result = (await reg.invoke('getChapterText', { sectionIndex: 0 }, ctxFor())) as {
      text: string;
      charCount: number;
    };
    expect(result.text).toBe('full chapter text');
    expect(result.charCount).toBe(17);
  });

  it('returns empty for image-only sections', async () => {
    const reg = new ToolRegistry();
    reg.register(createGetChapterTextTool(async () => ''));
    const result = (await reg.invoke('getChapterText', { sectionIndex: 1 }, ctxFor())) as {
      charCount: number;
    };
    expect(result.charCount).toBe(0);
  });
});
