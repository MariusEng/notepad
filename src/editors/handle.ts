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

let active: EditorHandle | null = null;

export const setActiveEditor = (h: EditorHandle | null) => {
  active = h;
};
export const activeEditor = () => active;
