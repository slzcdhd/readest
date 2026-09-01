import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { WikiDb } from '@/services/reedy/wiki/WikiDb';
import { ingestChapter, applyProposal, hashStatement } from '@/services/reedy/wiki/ingest';
import type { DatabaseService } from '@/types/database';

const CHAPTER = 'The concept of entropy is central to thermodynamics. Entropy measures disorder.';

describe('ingest — ingestChapter orchestration', () => {
  let db: DatabaseService;
  let wiki: WikiDb;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(db, getMigrations('wiki'));
    wiki = await WikiDb.fromService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const extractText = async () => CHAPTER;
  const runExtraction = async () => [
    {
      op: 'create_page',
      title: 'Entropy',
      type: 'concept',
      aliases: [],
      summary: 'A measure of disorder.',
      evidence: [{ quote: 'entropy is central to thermodynamics' }],
    },
  ];

  it('ingests a chapter and creates a page with evidence', async () => {
    const result = await ingestChapter({
      bookHash: 'bk1',
      sectionIndex: 0,
      contentHash: 'hash1',
      extractText,
      runExtraction,
      wiki,
    });
    expect(result.status).toBe('ingested');
    expect(result.applied).toBe(1);

    const page = await wiki.findPageByTitle('concept', 'Entropy');
    expect(page).not.toBeNull();
    const evidence = await wiki.listEvidence(page!.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.snippet).toBe('entropy is central to thermodynamics');
  });

  it('skips a chapter whose content_hash is unchanged and already ingested', async () => {
    await ingestChapter({
      bookHash: 'bk1',
      sectionIndex: 0,
      contentHash: 'hash1',
      extractText,
      runExtraction,
      wiki,
    });
    const second = await ingestChapter({
      bookHash: 'bk1',
      sectionIndex: 0,
      contentHash: 'hash1',
      extractText,
      runExtraction,
      wiki,
    });
    expect(second.status).toBe('skipped');
    expect(second.applied).toBe(0);
  });

  it('marks image-only sections skipped_image_only', async () => {
    const result = await ingestChapter({
      bookHash: 'bk1',
      sectionIndex: 0,
      contentHash: 'hash1',
      extractText: async () => '   ',
      runExtraction,
      wiki,
    });
    expect(result.status).toBe('image_only');
  });

  it('marks failed when the extraction throws (non-abort)', async () => {
    const result = await ingestChapter({
      bookHash: 'bk1',
      sectionIndex: 0,
      contentHash: 'hash1',
      extractText,
      runExtraction: async () => {
        throw new Error('model exploded');
      },
      wiki,
    });
    expect(result.status).toBe('failed');
  });
});

describe('ingest — applyProposal evidence discipline', () => {
  let db: DatabaseService;
  let wiki: WikiDb;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(db, getMigrations('wiki'));
    wiki = await WikiDb.fromService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const ctx = (chapterText: string) => ({
    bookHash: 'bk1',
    sectionIndex: 0,
    chapterText,
    wiki,
  });

  it('drops a create_page whose evidence quotes do not match the text', async () => {
    const applied = await applyProposal(
      {
        op: 'create_page',
        title: 'Ghost',
        type: 'concept',
        aliases: [],
        summary: 'should not exist',
        evidence: [{ quote: 'a completely fabricated sentence' }],
      },
      ctx(CHAPTER),
    );
    expect(applied).toBe(false);
    expect(await wiki.findPageByTitle('concept', 'Ghost')).toBeNull();
  });

  it('drops only the bad evidence, keeping the good one', async () => {
    const applied = await applyProposal(
      {
        op: 'create_page',
        title: 'Entropy',
        type: 'concept',
        aliases: [],
        summary: 'measures disorder',
        evidence: [{ quote: 'entropy is central to thermodynamics' }, { quote: 'fake quote here' }],
      },
      ctx(CHAPTER),
    );
    expect(applied).toBe(true);
    const page = await wiki.findPageByTitle('concept', 'Entropy');
    expect(await wiki.listEvidence(page!.id)).toHaveLength(1);
  });

  it('appends an update_page perspective to an existing concept', async () => {
    const id = await wiki.createPage({ type: 'concept', title: 'Entropy', bodyMd: 'base' });
    const applied = await applyProposal(
      {
        op: 'update_page',
        target: { title: 'Entropy', typeHint: 'concept' },
        perspective: { body: '《书 A》视角：热力学中的无序度。' },
        evidence: [{ quote: 'entropy is central to thermodynamics' }],
      },
      ctx(CHAPTER),
    );
    expect(applied).toBe(true);
    const page = await wiki.getPageById(id!);
    expect(page!.bodyMd).toContain('书 A');
  });

  it('matches a claim by statement hash (idempotent)', async () => {
    const statement = 'Entropy measures disorder.';
    const h = hashStatement(statement);
    expect(hashStatement('  Entropy   measures disorder.  ')).toBe(h);
  });
});
