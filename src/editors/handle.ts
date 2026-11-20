/** Lets app-level actions (menu, shortcuts) talk to whichever editor is mounted. */
export interface EditorHandle {
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
