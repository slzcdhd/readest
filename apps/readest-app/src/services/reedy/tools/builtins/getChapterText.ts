import { z } from 'zod';
import type { ReedyTool } from '../types';

const inputSchema = z.object({
  sectionIndex: z.number().int().nonnegative(),
});

export interface GetChapterTextResult {
  sectionIndex: number;
  /** Full flat text of the section, or '' when it has no extractable text. */
  text: string;
  /** Character count (0 for image-only sections). */
  charCount: number;
}

/**
 * Full-text read of a section — the foundation for delegated reading
 * (plan §2.3 granularity ladder, the "chapter" rung). Unlike `lookupPassage`
 * (which returns top-K semantic chunks and is the wrong primitive for
 * "summarize this chapter"), this returns the section's ENTIRE text so the
 * agent can actually read it in order.
 *
 * The provider resolves the section DOM → flat text via the same TreeWalker
 * discipline as ingest (extractSectionText), so offsets align with CFI.
 */
export function createGetChapterTextTool(
  provider: (sectionIndex: number) => Promise<string>,
): ReedyTool<z.input<typeof inputSchema>, GetChapterTextResult> {
  return {
    name: 'getChapterText',
    description:
      "Read the FULL text of a chapter/section in reading order. Use this when the user asks you to summarize a chapter, explain its argument, or judge whether it's worth reading carefully — never approximate those with a handful of search hits. The section's CFI anchors let you cite back to it.",
    permission: 'read',
    parallelSafe: true,
    inputSchema,
    async run(args) {
      const text = await provider(args.sectionIndex);
      return { sectionIndex: args.sectionIndex, text, charCount: text.length };
    },
  };
}
