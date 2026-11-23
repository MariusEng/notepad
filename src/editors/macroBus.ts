/**
 * Where editor actions report themselves while a macro is being recorded (editors/macro.tsx sets the recorder).
 * A separate module so the find panel and the editors can record without importing the macro code.
 */

/** A search as the find panel ran it (CodeMirror SearchQuery fields). */
export interface QuerySpec {
  search: string;
  replace: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
  literal: boolean;
}

export type MacroStep =
  /** Typed text (goes through the editor's input handling: auto-closing brackets, indentation). */
  | { t: "text"; text: string }
  /** A key the editor handles: Enter, Backspace, arrows, Home/End, Tab, shortcuts with Ctrl/⌘… */
  | { t: "key"; key: string; code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
  /** Paste: plays back what was copied or cut earlier in the macro, else the text pasted while recording. */
  | { t: "paste"; text: string }
  | { t: "copy" }
  | { t: "cut" }
  | { t: "undo" }
  | { t: "redo" }
  | { t: "find"; dir: 1 | -1; q: QuerySpec }
  | { t: "replace"; q: QuerySpec }
  | { t: "replaceAll"; q: QuerySpec }
  | { t: "selectMatches"; q: QuerySpec }
  | { t: "selectColumn" };

let recorder: ((step: MacroStep) => void) | null = null;

export const setMacroRecorder = (f: typeof recorder) => {
  recorder = f;
};

/** True while recording (playback never records). */
export const macroRecording = () => recorder !== null;

export function macroRecord(step: MacroStep) {
  recorder?.(step);
}
