import { useTabs } from "../tabs/store";

/** Lets app-level actions (menu, shortcuts) talk to whichever editor is mounted. */
export type MdAction =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bullet"
  | "ordered"
  | "task"
  | "link"
  | "quote"
  | "codeblock"
  | "hr"
  | "table";

export interface MdFormatState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  /** 0 = paragraph, 1-6 = heading level */
  heading: number;
}

/** Formatting commands, offered only by the formatted Markdown editor. */
export interface MdFormat {
  run(action: MdAction): void;
  setHeading(level: number): void;
  state(): MdFormatState;
}

export interface EditorHandle {
  /** Present only in the formatted Markdown editor; the formatting bar is disabled without it. */
  md?: MdFormat;
  focus(): void;
  /** Opens Find (with the Replace row when `replace`). */
  find(replace?: boolean): void;
  /** Find Next / Previous (⌘G / F3). */
  findNext?(dir: 1 | -1): void;
  /** ⌘E: use the selected text as the search text. */
  useSelectionForFind?(): void;
  /** CSV/log: select the column(s) at the selection (Ctrl+Space). False when the file has no columns. */
  selectColumn?(): boolean;
  /** Replace the whole document as one undoable edit. Returns false if unsupported. */
  replaceAll(text: string): boolean;
  /** Big documents copy their text into the tab store lazily; this does it now. */
  flush?(): void;
  /** Selects a range and scrolls it into view (code editor only). */
  select?(from: number, to: number): void;
}

// One handle per mounted editor (there are two while the view is split).
const editors = new Map<string, EditorHandle>();

/** Registers a tab's editor. Returns the function that unregisters it. */
export function registerEditor(tabId: string, handle: EditorHandle) {
  editors.set(tabId, handle);
  return () => {
    if (editors.get(tabId) === handle) editors.delete(tabId);
  };
}

export const editorFor = (tabId: string) => editors.get(tabId) ?? null;

/** The editor that has the keyboard focus. */
export const activeEditor = () => {
  const id = useTabs.getState().activeId;
  return id ? editors.get(id) ?? null : null;
};

/** Makes every tab's `content` current (call before reading it to save, format, write the session…). */
export const flushEdits = () => editors.forEach((e) => e.flush?.());
