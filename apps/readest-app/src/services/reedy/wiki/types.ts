import { z } from 'zod';

/**
 * llm-wiki (Karpathy "compile, don't retrieve") — a library-wide, cross-book
 * knowledge base compiled from the books the user reads.
 *
 * This module holds the shared types and the ingest proposal schema. See
 * `readest-ainative-reader-plan.md` §2 for the full design (v2.4).
 */

/** Global page types (aggregate perspectives across books). */
export const GLOBAL_PAGE_TYPES = ['concept', 'person', 'work', 'event'] as const;
/** Book-scoped page types. */
export const BOOK_PAGE_TYPES = ['claim', 'chapter_summary'] as const;
/** Deferred types (enum reserved, no v1 logic). */
export const DEFERRED_PAGE_TYPES = ['comparison', 'index'] as const;

export const PAGE_TYPES = [
  ...GLOBAL_PAGE_TYPES,
  ...BOOK_PAGE_TYPES,
  ...DEFERRED_PAGE_TYPES,
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

export type WikiPageStatus =
  | 'draft'
  | 'active'
  | 'disputed'
  | 'disambiguation'
  | 'merged'
  | 'orphaned';

export type EvidenceStatus = 'attached' | 'orphaned';

export type SourceStatus = 'pending' | 'ingested' | 'failed' | 'skipped_image_only';

export interface WikiPage {
  id: string;
  type: PageType;
  title: string;
  aliases: string;
  bodyMd: string;
  bookHash: string | null;
  sectionIndex: number | null;
  statementHash: string | null;
  status: WikiPageStatus;
  mergedInto: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WikiEvidence {
  id: string;
  pageId: string;
  bookHash: string;
  sectionIndex: number;
  startOffset: number;
  endOffset: number;
  snippet: string;
  status: EvidenceStatus;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Ingest proposal schema
//
// Core principle (plan §2.3): the proposal carries only natural-language
// identifiers (title + quote); ids and text offsets are assigned by the
// matcher/application code, never trusted from the LLM.
// ---------------------------------------------------------------------------

/** A verbatim quote from the source chapter — the only factual anchor. */
export const EvidenceRefSchema = z.object({
  quote: z.string().min(6).max(200),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

const TITLE_BLACKLIST = /ignore|system|prompt|指令|忽略|override|<\/?[a-z]+>/i;

export const CreatePageSchema = z.object({
  op: z.literal('create_page'),
  title: z
    .string()
    .min(1)
    .max(100)
    .refine((t) => !TITLE_BLACKLIST.test(t), 'title matches injection blacklist'),
  type: z.enum(GLOBAL_PAGE_TYPES),
  aliases: z.array(z.string().max(100)).max(8).default([]),
  summary: z.string().max(2000),
  evidence: z.array(EvidenceRefSchema).min(1).max(5),
});

export const UpdatePageSchema = z.object({
  op: z.literal('update_page'),
  target: z.object({
    title: z
      .string()
      .max(100)
      .refine((t) => !TITLE_BLACKLIST.test(t), 'title matches injection blacklist'),
    typeHint: z.enum(GLOBAL_PAGE_TYPES),
  }),
  perspective: z.object({ body: z.string().max(1500) }),
  evidence: z.array(EvidenceRefSchema).min(1).max(5),
});

export const AddClaimSchema = z.object({
  op: z.literal('add_claim'),
  statement: z.string().min(10).max(1000),
  evidence: EvidenceRefSchema,
});

export const ChapterSummarySchema = z.object({
  op: z.literal('chapter_summary'),
  summary: z.string().max(3000),
  keyEntities: z.array(z.string().max(100)).max(10),
});

export const IngestProposalSchema = z.discriminatedUnion('op', [
  CreatePageSchema,
  UpdatePageSchema,
  AddClaimSchema,
  ChapterSummarySchema,
]);

export type IngestProposal = z.infer<typeof IngestProposalSchema>;
