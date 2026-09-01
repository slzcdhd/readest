'use client';

import type { ReadingReceipt } from '../../wiki/readingReceipt';

/**
 * Renders a turn's observed reading receipt (delegated reading). Shows what
 * the agent actually read and what it skipped, so the user can see the
 * coverage behind an answer — the structural guarantee that the agent can't
 * hide what it read.
 */

export function ReceiptPart({ receipt }: { receipt: ReadingReceipt }) {
  const fullReads = receipt.read.filter((e) => e.mode === 'full');
  const retrieved = receipt.read.filter((e) => e.mode === 'retrieved');
  const hasCoverage = receipt.read.length > 0 || receipt.skipped.length > 0;
  if (!hasCoverage) return null;

  return (
    <div className='eink-bordered bg-base-200/40 border-base-300 mt-1 rounded-md border px-3 py-2 text-xs'>
      <div className='mb-1 flex items-center justify-between'>
        <span className='font-medium text-base-content/80'>阅读回执</span>
        <span className='text-base-content/50'>
          覆盖 {receipt.coveredChars > 0 ? `${receipt.coveredChars} 字` : '—'}
        </span>
      </div>

      {fullReads.length > 0 && (
        <div className='flex flex-col gap-0.5'>
          <span className='text-base-content/60'>读过（全文）</span>
          {fullReads.map((e, i) => (
            <span key={i} className='pl-2 text-base-content/70'>
              {e.locator.label} · {e.chars} 字
            </span>
          ))}
        </div>
      )}

      {retrieved.length > 0 && (
        <div className='mt-1 flex flex-col gap-0.5'>
          <span className='text-base-content/60'>读过（检索命中）</span>
          {retrieved.slice(0, 3).map((e, i) => (
            <span key={i} className='pl-2 text-base-content/70'>
              {e.locator.label} · {e.chars} 字
            </span>
          ))}
          {retrieved.length > 3 && (
            <span className='pl-2 text-base-content/50'>…另 {retrieved.length - 3} 处</span>
          )}
        </div>
      )}

      {receipt.skipped.length > 0 && (
        <div className='mt-1 flex flex-col gap-0.5'>
          <span className='text-base-content/60'>没读</span>
          {receipt.skipped.slice(0, 3).map((e, i) => (
            <span key={i} className='pl-2 text-base-content/70'>
              {e.locator.label}
            </span>
          ))}
        </div>
      )}

      <p className='text-base-content/50 mt-1.5 border-t border-base-300 pt-1.5'>
        以上结论仅在上述范围内成立，超出部分未经阅读，相关推断属猜测。
      </p>
    </div>
  );
}
