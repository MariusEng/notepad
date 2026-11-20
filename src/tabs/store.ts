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
  /** The tab that has the keyboard focus (and the one the status bar, format bar and menus act on).
   *  It is always the tab in the left pane (`mainId`) or the right pane (`splitId`). */
  activeId: string | null;
  mainId: string | null;
  /** Tab shown in the right pane; null when there is no split view. */
  splitId: string | null;
  /** Share of the width used by the left pane while split (0.2–0.8). */
  splitRatio: number;
  status: { line: number; col: number; selected: number };
  notice: { text: string; kind: "info" | "error" } | null;

  addTab: (tab: Tab, opts?: { replaceId?: string; activate?: boolean }) => void;
  removeTab: (id: string) => void;
  /** Shows the tab in the focused pane (or just focuses the pane that already shows it). */
  setActive: (id: string) => void;
  /** Shows the tab in a right-hand pane next to the current one. */
  openInSplit: (id: string) => void;
  closeSplit: () => void;
  setSplitRatio: (r: number) => void;
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
  mainId: null,
  splitId: null,
  splitRatio: 0.5,
  status: { line: 1, col: 1, selected: 0 },
  notice: null,

  addTab: (tab, { replaceId, activate = true } = {}) =>
    set((s) => {
      const tabs = [...s.tabs];
      const i = replaceId ? tabs.findIndex((t) => t.id === replaceId) : -1;
      let { mainId, splitId, activeId } = s;
      let placed = false;
      if (i >= 0) {
        tabs[i] = tab;
        // The new tab takes over the pane (and focus) of the one it replaces.
        if (mainId === replaceId) mainId = tab.id;
        if (splitId === replaceId) splitId = tab.id;
        if (activeId === replaceId) activeId = tab.id;
        placed = mainId === tab.id || splitId === tab.id;
      } else {
        // Insert right after the active tab, like browsers do.
        const at = tabs.findIndex((t) => t.id === s.activeId);
        tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, tab);
      }
      if (activate) {
        if (!placed) {
          // New tabs open in the pane that has the focus.
          if (splitId && activeId === splitId) splitId = tab.id;
          else mainId = tab.id;
        }
        activeId = tab.id;
      }
      return { tabs, mainId, splitId, activeId };
    }),

  removeTab: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      if (i < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      let { mainId, splitId, activeId } = s;
      if (id === splitId) {
        splitId = null;
        if (activeId === id) activeId = mainId;
      } else if (id === mainId) {
        // The left pane moves to a neighbouring tab that the right pane isn't showing.
        const rest = tabs.filter((t) => t.id !== splitId);
        const next = rest[Math.min(i, rest.length - 1)]?.id ?? null;
        if (next) {
          mainId = next;
          if (activeId === id) activeId = next;
        } else if (splitId) {
          // Only the right pane's tab is left: it becomes the single pane.
          mainId = splitId;
          splitId = null;
          activeId = mainId;
        } else {
          mainId = null;
          activeId = null;
        }
      }
      if (!tabs.length) mainId = splitId = activeId = null;
      return { tabs, mainId, splitId, activeId };
    }),

  setActive: (id) =>
    set((s) => {
      if (s.activeId === id || !s.tabs.some((t) => t.id === id)) return s;
      if (id === s.mainId || id === s.splitId) return { activeId: id };
      if (s.splitId && s.activeId === s.splitId) return { splitId: id, activeId: id };
      return { mainId: id, activeId: id };
    }),

  openInSplit: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      if (i < 0 || s.tabs.length < 2) return s;
      if (id === s.splitId) return { activeId: id };
      let mainId = s.mainId;
      if (id === mainId) {
        // A file can't be open twice, so the left pane moves to a neighbouring tab.
        mainId = (s.tabs[i + 1] ?? s.tabs[i - 1]).id;
      }
      return { mainId, splitId: id, activeId: id };
    }),

  closeSplit: () =>
    set((s) => (s.splitId ? { splitId: null, activeId: s.activeId === s.splitId ? s.mainId : s.activeId } : s)),

  setSplitRatio: (r) => set({ splitRatio: Math.min(0.8, Math.max(0.2, r)) }),

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
    const { tabs, activeId, mainId, splitId, setActive } = get();
    // With a split view, the tab in the other pane is skipped.
    const other = !splitId ? null : activeId === splitId ? mainId : splitId;
    const list = tabs.filter((t) => t.id !== other);
    if (list.length < 2) return;
    const i = list.findIndex((t) => t.id === activeId);
    setActive(list[(i + dir + list.length) % list.length].id);
  },

  activateIndex: (i) => {
    const { tabs, setActive } = get();
    const tab = i < 0 ? tabs[tabs.length - 1] : tabs[i];
    if (tab) setActive(tab.id);
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
