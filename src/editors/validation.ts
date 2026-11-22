import { create } from "zustand";
import type { Problem } from "./languages/validate";
import { editorFor } from "./handle";
import { useTabs } from "../tabs/store";

/** The last syntax check of a tab's text (JSON, XML), for the status bar. Set by CodeEditor's linter. */
export interface Validation {
  errors: number;
  warnings: number;
  /** The first error, or else the first warning. */
  first: (Problem & { line: number; col: number }) | null;
  /** Too big to check while typing. */
  skipped?: boolean;
}

export const useValidation = create<Record<string, Validation>>(() => ({}));

export const setValidation = (tabId: string, v: Validation) => useValidation.setState({ [tabId]: v });

/** Shows the first problem in the editor (switching from the tree view to the source first if needed). */
export async function revealProblem(tabId: string, problem?: Problem) {
  const p = problem ?? useValidation.getState()[tabId]?.first;
  if (!p) return;
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (tab?.dataView) useTabs.getState().update(tabId, { dataView: false });
  // The editor mounts after the switch; wait for it (a moment at most).
  for (let i = 0; i < 50 && !editorFor(tabId)?.select; i++) await new Promise((r) => setTimeout(r, 20));
  editorFor(tabId)?.select?.(p.from, p.to);
}
