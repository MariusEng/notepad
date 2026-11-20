import { create } from "zustand";
import type { LanguageId } from "../editors/languages";

export type Eol = "\n" | "\r\n";

export interface Tab {
  id: string;
  /** null for untitled tabs that have never been saved. */
  path: string | null;
  title: string;
  language: LanguageId;
  /** Editor text, always with \n line endings; `eol` is restored on save. */
  content: string;
  eol: Eol;
  bom: boolean;
  dirty: boolean;
  /** On-disk modification time when the file was last loaded or saved. */
  mtime: number | null;
  /** Markdown tabs: show raw source instead of the formatted editor. */
  mdSource: boolean;
  cursor: number;
  scroll: number;
  /** Set when the file changed or vanished on disk while open. */
  external?: "modified" | "deleted";
  /** Bumped when content is replaced from outside the editor (reload, format) to remount it. */
  version: number;
}

interface TabState {
  tabs: Tab[];
  activeId: string | null;
  status: { line: number; col: number; selected: number };
  notice: { text: string; kind: "info" | "error" } | null;

  addTab: (tab: Tab, opts?: { replaceId?: string; activate?: boolean }) => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  update: (id: string, patch: Partial<Tab>) => void;
  /** Content changed by the user inside the editor. */
  edit: (id: string, content: string) => void;
  /** Content replaced programmatically; editors remount to show it. */
  replaceContent: (id: string, content: string, patch?: Partial<Tab>) => void;
  move: (fromId: string, toId: string) => void;
  cycle: (dir: 1 | -1) => void;
  activateIndex: (i: number) => void;
  setStatus: (s: TabState["status"]) => void;
  notify: (text: string, kind?: "info" | "error") => void;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useTabs = create<TabState>((set, get) => ({
  tabs: [],
  activeId: null,
  status: { line: 1, col: 1, selected: 0 },
  notice: null,

  addTab: (tab, { replaceId, activate = true } = {}) =>
    set((s) => {
      const tabs = [...s.tabs];
      const i = replaceId ? tabs.findIndex((t) => t.id === replaceId) : -1;
      if (i >= 0) tabs[i] = tab;
      else {
        // Insert right after the active tab, like browsers do.
        const at = tabs.findIndex((t) => t.id === s.activeId);
        tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, tab);
      }
      return { tabs, activeId: activate ? tab.id : s.activeId };
    }),

  removeTab: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      if (i < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
      return { tabs, activeId };
    }),

  setActive: (id) => set({ activeId: id }),

  update: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  edit: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.content !== content ? { ...t, content, dirty: true } : t)),
    })),

  replaceContent: (id, content, patch = {}) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch, content, version: t.version + 1 } : t)),
    })),

  move: (fromId, toId) =>
    set((s) => {
      const tabs = [...s.tabs];
      const from = tabs.findIndex((t) => t.id === fromId);
      const to = tabs.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0 || from === to) return s;
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab);
      return { tabs };
    }),

  cycle: (dir) => {
    const { tabs, activeId } = get();
    if (tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === activeId);
    set({ activeId: tabs[(i + dir + tabs.length) % tabs.length].id });
  },

  activateIndex: (i) => {
    const { tabs } = get();
    const tab = i < 0 ? tabs[tabs.length - 1] : tabs[i];
    if (tab) set({ activeId: tab.id });
  },

  setStatus: (status) => set({ status }),

  notify: (text, kind = "info") => {
    clearTimeout(noticeTimer);
    set({ notice: { text, kind } });
    noticeTimer = setTimeout(() => set({ notice: null }), kind === "error" ? 8000 : 3500);
  },
}));

export const activeTab = () => {
  const { tabs, activeId } = useTabs.getState();
  return tabs.find((t) => t.id === activeId) ?? null;
};

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
