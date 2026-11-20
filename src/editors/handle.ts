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
  find(): void;
  /** Replace the whole document as one undoable edit. Returns false if unsupported. */
  replaceAll(text: string): boolean;
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
