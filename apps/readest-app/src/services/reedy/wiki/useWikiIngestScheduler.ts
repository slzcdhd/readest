'use client';

import { useEffect, useRef } from 'react';
import type { AppService } from '@/types/system';
import type { AISettings } from '@/services/ai/types';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { createReedyModels } from '../models/registry';
import { WikiDb } from './WikiDb';
import { WikiIngestScheduler } from './scheduler';
import { extractSectionText } from './extractText';

/**
 * Mounts the llm-wiki background ingest scheduler at reader-page level.
 *
 * Watches the active book's reading progress; when the reader crosses into a
 * new section (chapter), the section is enqueued for background compilation.
 * The scheduler is app-lifetime, not book-lifetime: switching books or closing
 * the notebook does NOT abort in-flight work — the section stays `pending` in
 * wiki_sources and is backfilled on next start.
 *
 * Gated on `aiSettings.enabled` (and, in practice, the Tauri platform, since
 * the whole agent path is gated on `isTauri()` elsewhere).
 */

export function useWikiIngestScheduler(
  appService: AppService | null,
  bookKey: string | null,
): void {
  const settings = useSettingsStore((s) => s.settings);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const progress = useBookProgress(bookKey);

  const schedulerRef = useRef<WikiIngestScheduler | null>(null);
  const lastSectionRef = useRef<number | null>(null);

  // Construct the scheduler once the app service + AI settings are ready.
  useEffect(() => {
    if (!appService) return;
    const ai: AISettings | undefined = settings?.aiSettings;
    if (!ai?.enabled) return;

    let alive = true;
    void (async () => {
      const models = createReedyModels(ai);
      const wiki = await WikiDb.open(appService.openDatabase.bind(appService));
      const scheduler = new WikiIngestScheduler({
        wiki,
        model: models.chat,
        extractText: async (_bookHash, _sectionIndex) => {
          // Extraction is wired per-book below; the scheduler's extractText is
          // replaced when a book is active. This default is a no-op guard.
          return '';
        },
      });
      await scheduler.init();
      await scheduler.enqueuePending();
      if (!alive) return;
      schedulerRef.current = scheduler;
    })();

    return () => {
      alive = false;
      schedulerRef.current?.abort();
      schedulerRef.current = null;
    };
  }, [appService, settings?.aiSettings]);

  // When the reader crosses into a new section, bind the active book's
  // extractor and enqueue the section. `bookDoc` comes from the active book's
  // data; extraction reads section.createDocument().
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler || !bookKey) return;
    const bookData = getBookData(bookKey);
    const bookDoc = bookData?.bookDoc;
    if (!bookDoc) return;

    const bookHash = bookKey.split('-')[0] ?? bookKey;

    // Bind extraction to the active book so enqueued sections read real text.
    scheduler.setExtractText(async (_bh, sectionIndex) =>
      extractBookSectionText(bookDoc, sectionIndex),
    );

    const sectionIndex = progress?.section?.current ?? 0;
    if (sectionIndex === lastSectionRef.current) return;
    lastSectionRef.current = sectionIndex;

    const section = bookDoc.sections[sectionIndex];
    if (!section) return;

    // Content hash: section CFI + size, stable enough for idempotency.
    const contentHash = `${section.cfi ?? ''}:${section.size}`;
    scheduler.enqueue(bookHash, sectionIndex, contentHash);
  }, [progress?.section?.current, bookKey, getBookData]);
}

/**
 * Extract a section's text for ingest. Exported for the scheduler wiring and
 * for tests. Uses the section's own createDocument() so the text offsets match
 * the reader's CFI resolution coordinate system.
 */
export async function extractBookSectionText(
  bookDoc: { sections: Array<{ createDocument: () => Promise<Document> }> },
  sectionIndex: number,
): Promise<string> {
  const section = bookDoc.sections[sectionIndex];
  if (!section) return '';
  const doc = await section.createDocument();
  return extractSectionText(doc);
}
