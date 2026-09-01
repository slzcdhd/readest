import { chapterSummarySkill } from './chapterSummary';
import { quoteFinderSkill } from './quoteFinder';
import { spoilerFreeSkill } from './spoilerFree';
import { delegateReaderSkill } from './delegateReader';
import type { Skill } from '../types';

/** The four v1 seed skills SkillRegistry plants on first boot. */
export const BUILTIN_SKILLS: Skill[] = [
  spoilerFreeSkill,
  chapterSummarySkill,
  quoteFinderSkill,
  delegateReaderSkill,
];

export { spoilerFreeSkill, chapterSummarySkill, quoteFinderSkill, delegateReaderSkill };
