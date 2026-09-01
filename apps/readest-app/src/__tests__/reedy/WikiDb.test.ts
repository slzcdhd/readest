import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { WikiDb } from '@/services/reedy/wiki/WikiDb';
import type { DatabaseService } from '@/types/database';

describe('WikiDb — cross-book knowledge base', () => {
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

  it('registers a non-empty migration set under the "wiki" schema', () => {
    const ms = getMigrations('wiki');
    expect(ms.length).toBeGreaterThan(0);
    expect(ms[0]!.name).toBe('2026090101_wiki_init');
  });

  it('creates the four wiki tables', async () => {
    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'wiki_%'",
    );
    const names = tables.map((t) => t.name);
    for (const t of ['wiki_pages', 'wiki_evidence', 'wiki_sources', 'wiki_meta']) {
      expect(names).toContain(t);
    }
  });

  it('creates a page and finds it by title', async () => {
    const id = await wiki.createPage({ type: 'concept', title: 'Entropy' });
    expect(id).not.toBeNull();
    const page = await wiki.findPageByTitle('concept', 'Entropy');
    expect(page).not.toBeNull();
    expect(page!.id).toBe(id);
    expect(page!.status).toBe('draft');
  });

  it('returns null on createPage when (type, title) already exists', async () => {
    await wiki.createPage({ type: 'concept', title: 'Freedom' });
    const second = await wiki.createPage({ type: 'concept', title: 'Freedom' });
    expect(second).toBeNull();
  });

  it('appends body paragraphs atomically without dropping concurrent appends', async () => {
    const id = (await wiki.createPage({ type: 'concept', title: 'Entropy' }))!;
    // Two appends fired without awaiting the first — both must land.
    await Promise.all([
      wiki.appendPageBody({
        pageId: id,
        bodyMd: '\n\n《书 A》视角：定义。',
        evidence: [
          { bookHash: 'a', sectionIndex: 0, startOffset: 0, endOffset: 5, snippet: 'quote A' },
        ],
      }),
      wiki.appendPageBody({
        pageId: id,
        bodyMd: '\n\n《书 B》视角：应用。',
        evidence: [
          { bookHash: 'b', sectionIndex: 1, startOffset: 0, endOffset: 5, snippet: 'quote B' },
        ],
      }),
    ]);
    const page = await wiki.getPageById(id);
    expect(page!.bodyMd).toContain('书 A');
    expect(page!.bodyMd).toContain('书 B');
    const evidence = await wiki.listEvidence(id);
    expect(evidence).toHaveLength(2);
  });

  it('matches a page by alias', async () => {
    await wiki.createPage({ type: 'concept', title: '熵', aliases: ['entropy', 'Entropie'] });
    const byAlias = await wiki.findPageByAlias('concept', 'entropy');
    expect(byAlias).not.toBeNull();
    expect(byAlias!.title).toBe('熵');
  });

  it('tracks source ingest idempotency and lists pending', async () => {
    await wiki.upsertSource('bk1', 0, 'hash1', 'pending');
    await wiki.upsertSource('bk1', 1, 'hash2', 'pending');
    const pending = await wiki.listPendingSources();
    expect(pending).toHaveLength(2);

    await wiki.upsertSource('bk1', 0, 'hash1', 'ingested');
    const stillPending = await wiki.listPendingSources();
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0]!.sectionIndex).toBe(1);
  });

  it('stores and reads meta', async () => {
    await wiki.setMeta('embedding_model', 'text-embedding-3-small');
    expect(await wiki.getMeta('embedding_model')).toBe('text-embedding-3-small');
    await wiki.setMeta('embedding_model', 'updated-model');
    expect(await wiki.getMeta('embedding_model')).toBe('updated-model');
  });

  it('orphans evidence for a deleted book', async () => {
    const id = (await wiki.createPage({ type: 'concept', title: 'X' }))!;
    await wiki.appendPageBody({
      pageId: id,
      bodyMd: 'body',
      evidence: [{ bookHash: 'gone', sectionIndex: 0, startOffset: 0, endOffset: 3, snippet: 'q' }],
    });
    await wiki.orphanEvidenceForBook('gone');
    expect(await wiki.listEvidence(id)).toHaveLength(0);
  });

  it('sets page status (draft → active)', async () => {
    const id = (await wiki.createPage({ type: 'concept', title: 'Y' }))!;
    await wiki.setPageStatus(id, 'active');
    const page = await wiki.getPageById(id);
    expect(page!.status).toBe('active');
  });
});
