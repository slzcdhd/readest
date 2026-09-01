import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import type {
  EvidenceStatus,
  PageType,
  SourceStatus,
  WikiEvidence,
  WikiPage,
  WikiPageStatus,
} from './types';

/**
 * Typed wrapper around a Turso DatabaseService opened against wiki.db.
 *
 * llm-wiki is library-wide and cross-book, so it lives in its OWN db file
 * (wiki.db) with its own connection and write queue — independent of
 * reedy.db so background ingest never blocks the interactive agent's
 * memory writes, and vice versa.
 *
 * This class is a module-level singleton (plan §2.4): the scheduler, the
 * knowledge-base UI, and lint all write through the SAME instance, because
 * the `enqueue` write queue is instance-scoped and Turso allows only one
 * BEGIN/COMMIT at a time. Two instances each queueing would be no queue.
 */

const DEFAULT_DB_KEY = 'wiki';
const DEFAULT_DB_FILE = 'wiki.db';

export class WikiDb {
  private writeQueue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly db: DatabaseService) {}

  /** Open (or return the cached) wiki.db. AppService.openDatabase is the source. */
  static async open(
    openDatabase: Pick<AppService, 'openDatabase'>['openDatabase'],
  ): Promise<WikiDb> {
    if (WikiDb.instance) return WikiDb.instance;
    const db = await openDatabase(DEFAULT_DB_KEY, DEFAULT_DB_FILE, 'Data');
    const wiki = new WikiDb(db);
    await wiki.assertSchema();
    WikiDb.instance = wiki;
    return wiki;
  }

  static instance: WikiDb | null = null;

  /**
   * Attach an already-migrated DatabaseService (used by tests and by the
   * scheduler when it owns the connection). Asserts the schema exists.
   */
  static async fromService(db: DatabaseService): Promise<WikiDb> {
    const wiki = new WikiDb(db);
    await wiki.assertSchema();
    return wiki;
  }

  /** Reset the singleton (tests only). */
  static reset(): void {
    WikiDb.instance = null;
  }

  /** Fail fast if migrations didn't create the tables (silent-empty-db guard). */
  private async assertSchema(): Promise<void> {
    const rows = await this.db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_pages'",
    );
    if (rows.length === 0) {
      throw new Error('wiki schema missing — the `wiki` migration key was not registered');
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  /** Fold the WAL after ingest bursts (Turso is WAL-only, no auto-checkpoint). */
  checkpoint(): Promise<void> {
    return this.enqueue(async () => {
      await this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => {});
    });
  }

  // ---------------------------------------------------------------------------
  // meta
  // ---------------------------------------------------------------------------

  async getMeta(key: string): Promise<string | null> {
    const rows = await this.db.select<{ value: string }>(
      'SELECT value FROM wiki_meta WHERE key = ?',
      [key],
    );
    return rows[0]?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.enqueue(() =>
      this.db.execute(
        'INSERT INTO wiki_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // sources (ingest idempotency)
  // ---------------------------------------------------------------------------

  async getSource(
    bookHash: string,
    sectionIndex: number,
  ): Promise<{
    contentHash: string;
    status: SourceStatus;
    ingestedAt: number;
  } | null> {
    const rows = await this.db.select<{
      content_hash: string;
      status: SourceStatus;
      ingested_at: number;
    }>(
      'SELECT content_hash, status, ingested_at FROM wiki_sources WHERE book_hash = ? AND section_index = ?',
      [bookHash, sectionIndex],
    );
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return { contentHash: r.content_hash, status: r.status, ingestedAt: r.ingested_at };
  }

  /**
   * Upsert a source row within the write queue. The status transition
   * (`pending` on schedule, `ingested` on success, `failed`/`skipped_*` on
   * error) is the ONLY thing this touches — the LLM call happens outside
   * the queue (plan §2.4).
   */
  async upsertSource(
    bookHash: string,
    sectionIndex: number,
    contentHash: string,
    status: SourceStatus,
  ): Promise<void> {
    await this.enqueue(() =>
      this.db.execute(
        `INSERT INTO wiki_sources (book_hash, section_index, content_hash, status, ingested_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(book_hash, section_index) DO UPDATE SET
           content_hash = excluded.content_hash,
           status = excluded.status,
           ingested_at = excluded.ingested_at`,
        [bookHash, sectionIndex, contentHash, status, Date.now()],
      ),
    );
  }

  /** List sections still pending ingest (startup backfill). */
  async listPendingSources(): Promise<
    Array<{ bookHash: string; sectionIndex: number; contentHash: string }>
  > {
    const rows = await this.db.select<{
      book_hash: string;
      section_index: number;
      content_hash: string;
    }>('SELECT book_hash, section_index, content_hash FROM wiki_sources WHERE status = ?', [
      'pending',
    ]);
    return rows.map((r) => ({
      bookHash: r.book_hash,
      sectionIndex: r.section_index,
      contentHash: r.content_hash,
    }));
  }

  // ---------------------------------------------------------------------------
  // pages
  // ---------------------------------------------------------------------------

  async getPageById(id: string): Promise<WikiPage | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      'SELECT * FROM wiki_pages WHERE id = ?',
      [id],
    );
    return rows[0] ? rowToPage(rows[0]) : null;
  }

  /**
   * Find an active (non-merged/orphaned) page by type + title. Returns the
   * first match on the unique index.
   */
  async findPageByTitle(type: PageType, title: string): Promise<WikiPage | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM wiki_pages
       WHERE type = ? AND lower(title) = lower(?)
         AND status IN ('draft','active','disputed','disambiguation')`,
      [type, title],
    );
    return rows[0] ? rowToPage(rows[0]) : null;
  }

  /** Find a page by an alias (exact, case-insensitive) within a type. */
  async findPageByAlias(type: PageType, alias: string): Promise<WikiPage | null> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM wiki_pages WHERE type = ? AND status IN ('draft','active','disputed','disambiguation')`,
      [type],
    );
    for (const r of rows) {
      const page = rowToPage(r);
      if (aliasesOf(page.aliases).some((a) => a.toLowerCase() === alias.toLowerCase())) return page;
    }
    return null;
  }

  /**
   * Create a page. Returns the created id, or null if a page with the same
   * (type, title) already exists (UNIQUE conflict) — callers fall back to
   * update in that case.
   */
  async createPage(args: {
    type: PageType;
    title: string;
    aliases?: string[];
    bodyMd?: string;
    bookHash?: string | null;
    sectionIndex?: number | null;
    statementHash?: string | null;
    status?: WikiPageStatus;
  }): Promise<string | null> {
    const id = randomId('page');
    const now = Date.now();
    const status = args.status ?? 'draft';
    try {
      await this.enqueue(() =>
        this.db.execute(
          `INSERT INTO wiki_pages (id, type, title, aliases, body_md, book_hash, section_index, statement_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            args.type,
            args.title,
            JSON.stringify(args.aliases ?? []),
            args.bodyMd ?? '',
            args.bookHash ?? null,
            args.sectionIndex ?? null,
            args.statementHash ?? null,
            status,
            now,
            now,
          ],
        ),
      );
      return id;
    } catch (err) {
      // UNIQUE violation on (type, lower(title)) — another task won the race.
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  /**
   * Append a perspective paragraph to a page's body and attach evidence,
   * atomically (plan §2.3). The read-modify-write runs inside a single
   * enqueue closure so two books ingesting the same concept can't drop each
   * other's paragraph. body append uses SQL `||` (atomic within the UPDATE).
   */
  async appendPageBody(args: {
    pageId: string;
    bodyMd: string;
    evidence: Array<{
      bookHash: string;
      sectionIndex: number;
      startOffset: number;
      endOffset: number;
      snippet: string;
    }>;
  }): Promise<void> {
    await this.enqueue(async () => {
      await this.db.execute(
        `UPDATE wiki_pages SET body_md = body_md || ?, updated_at = ? WHERE id = ?`,
        [args.bodyMd, Date.now(), args.pageId],
      );
      for (const ev of args.evidence) {
        await this.db.execute(
          `INSERT INTO wiki_evidence (id, page_id, book_hash, section_index, start_offset, end_offset, snippet, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'attached', ?)`,
          [
            randomId('ev'),
            args.pageId,
            ev.bookHash,
            ev.sectionIndex,
            ev.startOffset,
            ev.endOffset,
            ev.snippet,
            Date.now(),
          ],
        );
      }
    });
  }

  /** Set a page's status (draft→active on user acceptance, etc). */
  async setPageStatus(
    id: string,
    status: WikiPageStatus,
    mergedInto?: string | null,
  ): Promise<void> {
    await this.enqueue(() =>
      this.db.execute(
        'UPDATE wiki_pages SET status = ?, merged_into = ?, updated_at = ? WHERE id = ?',
        [status, mergedInto ?? null, Date.now(), id],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // evidence
  // ---------------------------------------------------------------------------

  async listEvidence(pageId: string): Promise<WikiEvidence[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      "SELECT * FROM wiki_evidence WHERE page_id = ? AND status = 'attached' ORDER BY created_at",
      [pageId],
    );
    return rows.map(rowToEvidence);
  }

  /** Mark all evidence for a book as orphaned (book deleted). */
  async orphanEvidenceForBook(bookHash: string): Promise<void> {
    await this.enqueue(() =>
      this.db.execute("UPDATE wiki_evidence SET status = 'orphaned' WHERE book_hash = ?", [
        bookHash,
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // query (read path — never queued)
  // ---------------------------------------------------------------------------

  /**
   * Find active pages matching a term by title or alias (case-insensitive).
   * Merged/orphaned pages are excluded. Returns the pages plus, per page, the
   * distinct books that contributed evidence (the "N books" signal).
   */
  async searchPages(term: string): Promise<Array<{ page: WikiPage; bookCount: number }>> {
    const needle = term.trim().toLowerCase();
    if (needle.length === 0) return [];

    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM wiki_pages
       WHERE status IN ('draft','active','disputed','disambiguation')`,
    );
    const out: Array<{ page: WikiPage; bookCount: number }> = [];
    for (const r of rows) {
      const page = rowToPage(r);
      const aliases = aliasesOf(page.aliases);
      const matched = [page.title, ...aliases].some((a) => a.toLowerCase() === needle);
      if (!matched) continue;
      const countRows = await this.db.select<{ n: number }>(
        "SELECT COUNT(DISTINCT book_hash) AS n FROM wiki_evidence WHERE page_id = ? AND status = 'attached'",
        [page.id],
      );
      out.push({ page, bookCount: countRows[0]?.n ?? 0 });
    }
    return out;
  }

  /**
   * Return all global (concept/person/work/event) pages in an active-ish
   * state, for the knowledge-base browser. Ordered by recency.
   */
  async listGlobalPages(): Promise<WikiPage[]> {
    const rows = await this.db.select<Record<string, unknown>>(
      `SELECT * FROM wiki_pages
       WHERE type IN ('concept','person','work','event')
         AND status IN ('draft','active','disputed','disambiguation')
       ORDER BY updated_at DESC`,
    );
    return rows.map(rowToPage);
  }
}

// ---------------------------------------------------------------------------
// row mapping + helpers
// ---------------------------------------------------------------------------

function rowToPage(row: Record<string, unknown>): WikiPage {
  return {
    id: String(row['id']),
    type: row['type'] as PageType,
    title: String(row['title']),
    aliases: String(row['aliases'] ?? '[]'),
    bodyMd: String(row['body_md'] ?? ''),
    bookHash: row['book_hash'] == null ? null : String(row['book_hash']),
    sectionIndex: row['section_index'] == null ? null : Number(row['section_index']),
    statementHash: row['statement_hash'] == null ? null : String(row['statement_hash']),
    status: row['status'] as WikiPageStatus,
    mergedInto: row['merged_into'] == null ? null : String(row['merged_into']),
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  };
}

function rowToEvidence(row: Record<string, unknown>): WikiEvidence {
  return {
    id: String(row['id']),
    pageId: String(row['page_id']),
    bookHash: String(row['book_hash']),
    sectionIndex: Number(row['section_index']),
    startOffset: Number(row['start_offset']),
    endOffset: Number(row['end_offset']),
    snippet: String(row['snippet']),
    status: row['status'] as EvidenceStatus,
    createdAt: Number(row['created_at']),
  };
}

function aliasesOf(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE|constraint failed/i.test(msg);
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
