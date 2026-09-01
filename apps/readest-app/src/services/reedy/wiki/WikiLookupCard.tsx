'use client';

import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { WikiDb } from './WikiDb';
import { wikiLookup, type WikiLookupResult } from './wikiQuery';

/**
 * The llm-wiki layer of the word-lookup popup (plan §2.5 "三态卡片").
 *
 * Reads the active selection from `selectionStore`, queries the cross-book
 * wiki, and renders one of three states:
 *   - multi  : "你在另外 N 本书里遇到过它" (cross-book emphasis)
 *   - single : single-book card (weakened)
 *   - none   : nothing compiled → render nothing (host falls back to dict)
 *
 * A draft (not user-accepted) page is labelled "AI 草稿 · 未校验" and withholds
 * the cross-book claim. Evidence snippets render inline with a provenance
 * marker; the host wires the jump-back via `onJumpToCfi`.
 */
export interface WikiLookupCardProps {
  word: string;
}

export const WikiLookupCard: React.FC<WikiLookupCardProps> = ({ word }) => {
  const { appService } = useEnv();
  const [result, setResult] = useState<WikiLookupResult | null>(null);

  useEffect(() => {
    let alive = true;
    if (!appService || !word.trim()) return;
    void (async () => {
      try {
        const wiki = await WikiDb.open(appService.openDatabase.bind(appService));
        const r = await wikiLookup(wiki, word);
        if (alive) setResult(r);
      } catch (err) {
        console.warn('[Wiki] lookup failed', err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [appService, word]);

  if (!result || result.state === 'none') return null;

  const { state, page, bookCount, verified, evidence } = result;

  return (
    <div className='wiki-lookup-card flex flex-col gap-2 border-t border-base-300 px-4 py-3 text-sm'>
      <div className='flex items-center gap-2'>
        {/* Provenance head — icon + line style, not color (e-ink safe). */}
        <span className='font-medium'>
          {state === 'multi'
            ? `你在另外 ${bookCount} 本书里遇到过「${page!.title}」`
            : `你的知识库 · ${page!.title}`}
        </span>
        {!verified && (
          <span className='rounded border border-dashed border-base-400 px-1.5 text-xs text-base-content/70'>
            AI 草稿 · 未校验
          </span>
        )}
      </div>

      {page!.bodyMd && <p className='whitespace-pre-wrap text-base-content/80'>{page!.bodyMd}</p>}

      {evidence.length > 0 && (
        <div className='flex flex-col gap-1'>
          {evidence.slice(0, 2).map((e, i) => (
            <div
              key={i}
              className='border-l-2 border-solid border-base-400 pl-2 text-xs text-base-content/60'
            >
              「{e.snippet}」
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WikiLookupCard;
