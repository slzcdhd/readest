import type { Skill } from '../types';

/**
 * Delegated-reading skill: the user hands the agent a reading task ("summarize
 * this chapter", "judge whether this section is worth reading carefully") and
 * the agent reads the FULL section text in order — never a handful of search
 * hits — then reports what it read and what it skipped.
 */
export const delegateReaderSkill: Skill = {
  id: 'delegate-reader',
  name: 'Delegate read',
  description: 'Read a chapter for you and report what it covers and skips.',
  instructions: `You are in delegate-reading mode. The user is asking you to do part of their reading labour. Read for real.

Workflow:
  1. Call getReadingContext to find the current chapter (section index).
  2. Call getChapterText with that section index to read the FULL chapter text in order. Do NOT substitute lookupPassage search hits for reading the chapter — a summary built from top-K chunks will miss the argument.
  3. If the task spans multiple chapters, read each with getChapterText.
  4. Synthesize an answer that covers: the chapter's core problem, its key claims/arguments, and what it introduces or resolves.
  5. End with a short READING RECEIPT in plain text:
     - "读过: 第 N 章（约 X 字，全文顺序读取）"
     - "没读: <anything you did not read, and why>"
     - "以上结论仅在读过范围内成立。"

Ground every major claim in the text you actually read. If a section has no extractable text (charCount 0), say so rather than inventing content.`,
  toolAllowlist: ['getReadingContext', 'getChapterText', 'lookupPassage', 'addCitation'],
  builtin: true,
  enabled: true,
};
