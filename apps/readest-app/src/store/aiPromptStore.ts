import { create } from 'zustand';

/**
 * Cross-component channel for "ask AI about this selection".
 *
 * The word-lookup popup writes a composed prompt here when the user taps a
 * preset question; the AI notebook (ReedyAssistant) consumes it on mount,
 * switches to the AI tab, and sends it. This is the "popup is a pre-fill
 * entry to the panel" model from the design (§3), kept out of the heavier
 * notebook store so the popup doesn't import the whole notebook surface.
 */

interface AiPromptState {
  /** A composed prompt waiting to be sent, or null when none is pending. */
  pendingPrompt: string | null;
  /** Set a prompt and flag that the AI panel should open + send it. */
  setPendingPrompt: (prompt: string | null) => void;
}

export const useAiPromptStore = create<AiPromptState>((set) => ({
  pendingPrompt: null,
  setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),
}));
