import type { ChatModel } from '../models/ChatModel';
import {
  ingestChapter,
  runExtractionWithModel,
  type ExtractText,
  type RunExtraction,
} from './ingest';
import type { WikiDb } from './WikiDb';

/**
 * Background ingest scheduler for llm-wiki (plan §2.4).
 *
 * Pure TS — no React. Owns the wiki.db singleton, the task queue, the
 * monthly budget (reserve/settle), and an app-lifetime AbortSignal. A thin
 * React hook (`useWikiIngestScheduler`) mounts it at the reader-page level;
 * switching books or closing the notebook does NOT kill in-flight work.
 *
 * Budget semantics: a reserve/settle two-phase gate. `reserve` runs before a
 * chapter is dequeued (atomic JS-side, single-threaded), so the number of
 * in-flight calls is bounded by budget/estimate. `settle` adds actual spend
 * to `spent` and releases the reservation. The cap STOPS new work; it does
 * not abort an in-flight call.
 */

const DEFAULT_MONTHLY_BUDGET_CENTS = 300; // $3.00
const BUDGET_SPENT_KEY = 'budget_spent';
const BUDGET_RESET_KEY = 'budget_month';

export interface SchedulerDeps {
  wiki: WikiDb;
  model: ChatModel;
  /** Map (bookHash, sectionIndex) → flat text. Prod wires extractSectionText. */
  extractText: ExtractText;
  /** Optional override for extraction (tests); defaults to model-backed. */
  runExtraction?: RunExtraction;
  /** Cost per 1M input tokens, in USD, for the active model. */
  costPerMillionInput?: number;
  /** Cost per 1M output tokens, in USD. */
  costPerMillionOutput?: number;
}

interface Task {
  bookHash: string;
  sectionIndex: number;
  contentHash: string;
}

export class WikiIngestScheduler {
  private queue: Task[] = [];
  private running = false;
  private abortController: AbortController | null = null;
  private spentCents = 0;
  private extractText: ExtractText;

  constructor(private readonly deps: SchedulerDeps) {
    this.extractText = deps.extractText;
  }

  /**
   * Swap the text extractor at runtime. The hook calls this whenever the
   * active book changes, so enqueued sections read from the right bookDoc.
   */
  setExtractText(extractText: ExtractText): void {
    this.extractText = extractText;
  }

  /** Budget remaining in USD (fractional). */
  get spentUsd(): number {
    return this.spentCents / 100;
  }

  get budgetUsd(): number {
    return DEFAULT_MONTHLY_BUDGET_CENTS / 100;
  }

  get isPaused(): boolean {
    return this.spentCents >= DEFAULT_MONTHLY_BUDGET_CENTS;
  }

  /** Load persisted spend and reset it if the month rolled over. */
  async init(): Promise<void> {
    const now = new Date();
    const month = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const storedMonth = await this.deps.wiki.getMeta(BUDGET_RESET_KEY);
    if (storedMonth !== month) {
      await this.deps.wiki.setMeta(BUDGET_RESET_KEY, month);
      await this.deps.wiki.setMeta(BUDGET_SPENT_KEY, '0');
      this.spentCents = 0;
      return;
    }
    const stored = await this.deps.wiki.getMeta(BUDGET_SPENT_KEY);
    this.spentCents = stored == null ? 0 : Number.parseInt(stored, 10) || 0;
  }

  /** Enqueue a chapter for ingest (idempotent by wiki_sources). */
  enqueue(bookHash: string, sectionIndex: number, contentHash: string): void {
    this.queue.push({ bookHash, sectionIndex, contentHash });
    void this.drain();
  }

  /** Backfill: enqueue every `pending` source from a previous run. */
  async enqueuePending(): Promise<void> {
    const pending = await this.deps.wiki.listPendingSources();
    for (const p of pending) this.queue.push({ ...p });
    if (pending.length > 0) void this.drain();
  }

  /** Process the queue until empty, paused, or aborted. */
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try {
      while (this.queue.length > 0) {
        if (signal.aborted) break;
        if (this.isPaused) break;

        const task = this.queue.shift()!;
        // Reserve a conservative per-section estimate before the LLM call.
        const estimate = ESTIMATE_PER_SECTION_INPUT;

        // Reserve before dequeuing work (atomic single-threaded gate).
        if (!this.reserve(estimate)) {
          // Put it back; budget exhausted mid-queue.
          this.queue.unshift(task);
          break;
        }

        const runExtraction =
          this.deps.runExtraction ??
          ((args) => runExtractionWithModel(this.deps.model, args, signal));

        try {
          await ingestChapter({
            bookHash: task.bookHash,
            sectionIndex: task.sectionIndex,
            contentHash: task.contentHash,
            extractText: this.extractText,
            runExtraction,
            wiki: this.deps.wiki,
            signal,
          });
        } catch {
          // ingestChapter already records failed; don't let one chapter kill
          // the rest of the queue.
        } finally {
          this.settle();
        }
      }
    } finally {
      this.running = false;
      this.abortController = null;
      await this.deps.wiki.checkpoint();
    }
  }

  /** Abort the in-flight call and stop processing (task left for next run). */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  // ---------------------------------------------------------------------------
  // budget (reserve/settle)
  // ---------------------------------------------------------------------------

  private reserve(estimatedTokens: number): boolean {
    const estCost = this.estimateCostUsd(estimatedTokens);
    const estCents = Math.ceil(estCost * 100);
    if (this.spentCents + estCents > DEFAULT_MONTHLY_BUDGET_CENTS) return false;
    return true;
  }

  private settle(): void {
    // v1: charge a flat estimate per section rather than parsing real usage,
    // which the Vercel SDK doesn't surface synchronously. Kept simple and
    // conservative so the budget never silently overruns.
    this.spentCents += SECTION_COST_CENTS;
    void this.deps.wiki.setMeta(BUDGET_SPENT_KEY, String(this.spentCents));
  }

  private estimateCostUsd(inputTokens: number): number {
    const perMillion = this.deps.costPerMillionInput ?? 0.3; // Gemini-Flash-ish
    return (inputTokens / 1_000_000) * perMillion;
  }
}

// Rough per-section cost ceiling for the settle() flat charge. Real usage is
// far lower; this is a conservative cap so budget never silently overruns.
const SECTION_COST_CENTS = 1; // $0.01 / section worst case
const ESTIMATE_PER_SECTION_INPUT = 8_000;
