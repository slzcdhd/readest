import { IngestProposalSchema, type IngestProposal } from './types';

/**
 * Parse an LLM's raw structured-output response into ingest proposals.
 *
 * "Wide in, strict out" (plan §2.3): we do NOT require the whole chapter's
 * response to validate as one array. Instead we accept any JSON array and
 * validate each entry independently, dropping only the malformed entries so
 * a single bad object doesn't discard the rest of a chapter's good work.
 *
 * This matters because Ollama (openai-compatible, no native JSON schema) and
 * OpenRouter (mixed upstream models) frequently emit a partially-valid array.
 */

export interface ProposalParseResult {
  /** Entries that passed schema validation, in order. */
  proposals: IngestProposal[];
  /** Total entries the model produced (valid + invalid). */
  total: number;
  /** Number of entries dropped because they failed validation. */
  dropped: number;
  /** Fraction of entries accepted (0–1; 1 when total === 0). */
  acceptRate: number;
}

/**
 * Parse a raw value (already `JSON.parse`d by the caller, or the object a
 * tool-mode call returned) into validated proposals.
 */
export function parseProposals(raw: unknown): ProposalParseResult {
  if (!Array.isArray(raw)) {
    return { proposals: [], total: 0, dropped: 0, acceptRate: 1 };
  }

  const proposals: IngestProposal[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const parsed = IngestProposalSchema.safeParse(entry);
    if (parsed.success) proposals.push(parsed.data);
    else dropped++;
  }

  const total = raw.length;
  const acceptRate = total === 0 ? 1 : proposals.length / total;
  return { proposals, total, dropped, acceptRate };
}
