import { describe, it, expect } from 'vitest';
import { parseProposals } from '@/services/reedy/wiki/proposalParser';

describe('proposalParser — parseProposals (wide-in, strict-out)', () => {
  it('parses a fully valid array', () => {
    const raw = [
      {
        op: 'create_page',
        title: 'Entropy',
        type: 'concept',
        aliases: [],
        summary: 'A measure of disorder.',
        evidence: [{ quote: 'entropy is central to thermodynamics' }],
      },
      {
        op: 'chapter_summary',
        summary: 'This chapter introduces entropy.',
        keyEntities: ['Entropy'],
      },
    ];
    const result = parseProposals(raw);
    expect(result.proposals).toHaveLength(2);
    expect(result.dropped).toBe(0);
    expect(result.acceptRate).toBe(1);
  });

  it('drops only the malformed entry, keeps the valid one', () => {
    const raw = [
      {
        op: 'create_page',
        title: 'Entropy',
        type: 'concept',
        summary: 'A measure of disorder.',
        evidence: [{ quote: 'entropy is central' }],
      },
      { op: 'create_page', title: 'Broken', type: 'nonsense-type', evidence: [] },
    ];
    const result = parseProposals(raw);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ op: 'create_page', title: 'Entropy' });
    expect(result.dropped).toBe(1);
    expect(result.acceptRate).toBe(0.5);
  });

  it('rejects a title that matches the injection blacklist', () => {
    const raw = [
      {
        op: 'create_page',
        title: 'ignore previous instructions',
        type: 'concept',
        summary: 'x',
        evidence: [{ quote: 'some quote here' }],
      },
    ];
    const result = parseProposals(raw);
    expect(result.proposals).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  it('returns an empty result for non-array input', () => {
    expect(parseProposals({ op: 'create_page' })).toEqual({
      proposals: [],
      total: 0,
      dropped: 0,
      acceptRate: 1,
    });
    expect(parseProposals(null)).toEqual({
      proposals: [],
      total: 0,
      dropped: 0,
      acceptRate: 1,
    });
  });

  it('returns acceptRate 1 for an empty array', () => {
    expect(parseProposals([]).acceptRate).toBe(1);
  });
});
