import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { WikiDb } from '@/services/reedy/wiki/WikiDb';
import { wikiLookup } from '@/services/reedy/wiki/wikiQuery';
import type { DatabaseService } from '@/types/database';

describe('wikiLookup — three-state word card', () => {
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

  async function seedConcept(title: string, books: string[]): Promise<void> {
    const id = (await wiki.createPage({ type: 'concept', title }))!;
    await wiki.setPageStatus(id, 'active');
    for (const b of books) {
      await wiki.appendPageBody({
        pageId: id,
        bodyMd: '',
        evidence: [
          { bookHash: b, sectionIndex: 0, startOffset: 0, endOffset: 3, snippet: `${b} quote` },
        ],
      });
    }
  }

  it('returns none when nothing is compiled', async () => {
    const r = await wikiLookup(wiki, 'entropy');
    expect(r.state).toBe('none');
  });

  it('returns single + verified when mentioned in one book', async () => {
    await seedConcept('Entropy', ['bk1']);
    const r = await wikiLookup(wiki, 'entropy');
    expect(r.state).toBe('single');
    expect(r.bookCount).toBe(1);
    expect(r.verified).toBe(true);
    expect(r.evidence).toHaveLength(1);
  });

  it('returns multi when mentioned in ≥2 books', async () => {
    await seedConcept('Entropy', ['bk1', 'bk2']);
    const r = await wikiLookup(wiki, 'entropy');
    expect(r.state).toBe('multi');
    expect(r.bookCount).toBe(2);
  });

  it('returns verified=false for a draft page', async () => {
    const id = (await wiki.createPage({ type: 'concept', title: 'Entropy' }))!;
    await wiki.appendPageBody({
      pageId: id,
      bodyMd: '',
      evidence: [{ bookHash: 'bk1', sectionIndex: 0, startOffset: 0, endOffset: 3, snippet: 'q' }],
    });
    const r = await wikiLookup(wiki, 'entropy');
    expect(r.verified).toBe(false);
    expect(r.state).toBe('single');
  });

  it('matches by alias (case-insensitive)', async () => {
    const id = (await wiki.createPage({ type: 'concept', title: '熵', aliases: ['entropy'] }))!;
    await wiki.setPageStatus(id, 'active');
    const r = await wikiLookup(wiki, 'ENTROPY');
    expect(r.state).toBe('single');
    expect(r.page!.title).toBe('熵');
  });
});
