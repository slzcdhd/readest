import { create } from 'zustand';
import type { TextSelection } from '@/utils/sel';

/**
 * Global single source of truth for the active text selection.
 *
 * Historically `selection` lived as local state inside `Annotator` and was
 * duplicated into `notebookStore.notebookNewAnnotation` / `notebookEditAnnotation`.
 * The llm-wiki word card and the future "ask AI" popup need to read the current
 * selection from a stable place, so the Annotator mirrors its selection here
 * whenever it changes (setSelection → setActiveSelection).
 */

interface SelectionState {
  /** The active selection, or null when nothing is selected. */
  selection: TextSelection | null;
  setSelection: (selection: TextSelection | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection }),
}));

/** Imperative read for non-React code (e.g. tool providers). */
export const getActiveSelection = (): TextSelection | null =>
  useSelectionStore.getState().selection;
