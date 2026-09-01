'use client';

import { useCallback } from 'react';
import { useSelectionStore } from '@/store/selectionStore';
import { useAiPromptStore } from '@/store/aiPromptStore';
import { useNotebookStore } from '@/store/notebookStore';

/**
 * The "ask AI" entry in the word-lookup popup (plan §3).
 *
 * Always shown (unlike the wiki card, which only appears on a hit). Tapping a
 * preset question composes a prompt from the active selection + the question,
 * opens the AI notebook tab, and hands the prompt to ReedyAssistant to send.
 * The popup is a pre-fill entry to the panel, not a second chat box.
 */

const PRESET_QUESTIONS = [
  { key: 'explain', label: '解释这个概念' },
  { key: 'background', label: '它的背景是什么' },
  { key: 'why-here', label: '作者为什么在这里提它' },
] as const;

export const AskAiBar: React.FC = () => {
  const selection = useSelectionStore((s) => s.selection);
  const setPendingPrompt = useAiPromptStore((s) => s.setPendingPrompt);
  const setNotebookActiveTab = useNotebookStore((s) => s.setNotebookActiveTab);
  const setNotebookVisible = useNotebookStore((s) => s.setNotebookVisible);

  const ask = useCallback(
    (question: string) => {
      const text = selection?.text?.trim();
      if (!text) return;
      const prompt = `「${text}」\n\n${question}`;
      setPendingPrompt(prompt);
      setNotebookActiveTab('ai');
      setNotebookVisible(true);
    },
    [selection, setPendingPrompt, setNotebookActiveTab, setNotebookVisible],
  );

  if (!selection?.text?.trim()) return null;

  return (
    <div className='ask-ai-bar flex flex-col gap-1.5 border-t border-base-300 px-4 py-3'>
      <span className='text-xs text-base-content/50'>Ask AI</span>
      <div className='flex flex-wrap gap-1.5'>
        {PRESET_QUESTIONS.map((q) => (
          <button
            key={q.key}
            type='button'
            onClick={() => ask(q.label)}
            className='rounded-full border border-base-400 px-2.5 py-1 text-xs hover:bg-base-200'
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default AskAiBar;
