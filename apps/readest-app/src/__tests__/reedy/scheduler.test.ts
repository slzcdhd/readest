import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { WikiDb } from '@/services/reedy/wiki/WikiDb';
import { WikiIngestScheduler } from '@/services/reedy/wiki/scheduler';
import type { DatabaseService } from '@/types/database';
import type { ChatModel } from '@/services/reedy/models/ChatModel';

const CHAPTER = 'Entropy is central to thermodynamics and measures disorder.';

function fakeModel(): ChatModel {
  return {
    id: 'fake',
    contextWindow: 8192,
    reservedOutput: 1024,
    supportsTools: true,
    getLanguageModel: () => ({ __mock: 'lm' }) as never,
  };
}

describe('WikiIngestScheduler — budget + queue', () => {
  let db: DatabaseService;
  let wiki: WikiDb;
  let scheduler: WikiIngestScheduler;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(db, getMigrations('wiki'));
    wiki = await WikiDb.fromService(db);
    scheduler = new WikiIngestScheduler({
      wiki,
      model: fakeModel(),
      extractText: async () => CHAPTER,
      runExtraction: async () => [
        {
          op: 'create_page',
          title: 'Entropy',
          type: 'concept',
          aliases: [],
          summary: 'disorder',
          evidence: [{ quote: 'Entropy is central to thermodynamics' }],
        },
      ],
    });
    await scheduler.init();
  });

  afterEach(async () => {
    await db.close();
  });

  it('processes an enqueued chapter end-to-end', async () => {
    scheduler.enqueue('bk1', 0, 'hash1');
    // Give the drain a tick to run (fire-and-forget promise chain).
    await new Promise((r) => setTimeout(r, 30));
    const page = await wiki.findPageByTitle('concept', 'Entropy');
    expect(page).not.toBeNull();
  });

  it('backfills pending sources on enqueuePending', async () => {
    await wiki.upsertSource('bk1', 0, 'hash1', 'pending');
    await wiki.upsertSource('bk1', 1, 'hash2', 'pending');
    await scheduler.enqueuePending();
    await new Promise((r) => setTimeout(r, 30));
    const source0 = await wiki.getSource('bk1', 0);
    const source1 = await wiki.getSource('bk1', 1);
    expect(source0!.status).toBe('ingested');
    expect(source1!.status).toBe('ingested');
  });

  it('stops processing new work once the budget is exhausted', async () => {
    // Burn the budget so every reserve fails.
    await wiki.setMeta('budget_spent', '99999');
    await scheduler.init();
    scheduler.enqueue('bk1', 0, 'hash1');
    await new Promise((r) => setTimeout(r, 30));
    // Nothing should have been ingested.
    expect(await wiki.findPageByTitle('concept', 'Entropy')).toBeNull();
  });

  it('persists spend across init via wiki_meta', async () => {
    await wiki.setMeta('budget_spent', '150');
    await scheduler.init();
    expect(scheduler.spentUsd).toBe(1.5);
  });
});
