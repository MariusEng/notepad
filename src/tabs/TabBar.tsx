import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { closeOtherTabs, closeTab, encodingMenuItems, newTab, saveTab, setLanguage } from "../actions";
import { LANGUAGE_LIST } from "../editors/languages";
import { useTabs, type Tab } from "./store";
import { useGit } from "../git/store";
import { useSettings } from "../settings";
import { gitMarkText, refreshGitMarks, useGitMarks } from "../sidebar/actions";
import { GitGlyph } from "../sidebar/Sidebar";

async function showTabMenu(tab: Tab) {
  const { tabs, splitId } = useTabs.getState();
  const menu = await Menu.new({
    items: [
      {
        id: "split-right",
        text: "Open to the Right",
        enabled: tabs.length > 1 && tab.id !== splitId,
        action: () => useTabs.getState().openInSplit(tab.id),
      },
      { id: "split-close", text: "Close Split View", enabled: !!splitId, action: () => useTabs.getState().closeSplit() },
      { item: "Separator" },
      { id: "close", text: "Close", action: () => closeTab(tab.id) },
      { id: "close-others", text: "Close Others", action: () => closeOtherTabs(tab.id) },
      { id: "close-right", text: "Close to the Right", action: () => closeOtherTabs(tab.id, true) },
      { item: "Separator" },
      {
        id: "file-type",
        text: "File Type",
        items: LANGUAGE_LIST.map((l) => ({
          id: `type-${l.id}`,
          text: l.label,
          checked: l.id === tab.language,
          action: () => setLanguage(tab.id, l.id),
        })),
      },
      { id: "encoding", text: "Encoding", items: encodingMenuItems(tab) },
      { item: "Separator" },
      { id: "save", text: "Save", action: () => saveTab(tab.id) },
      {
        id: "copy-path",
        text: "Copy Path",
        enabled: !!tab.path,
        action: () => tab.path && navigator.clipboard.writeText(tab.path).catch(() => {}),
      },
    ],
  });
  await menu.popup();
}

/** Tabs shown side by side (split view) form one group; every other tab is a group of one. */
function groupsOf(tabs: Tab[], mainId: string | null, splitId: string | null): Tab[][] {
  const out: Tab[][] = [];
  for (let i = 0; i < tabs.length; i++) {
    if (splitId && tabs[i].id === mainId && tabs[i + 1]?.id === splitId) {
      out.push([tabs[i], tabs[i + 1]]);
      i++;
    } else out.push([tabs[i]]);
  }
  return out;
}

interface Drag {
  ids: string[];
  startX: number;
  x: number;
  /** Pointer offset from the group's left edge when the drag started. */
  grab: number;
  /** Current visual offset of the dragged group from where the layout puts it. */
  shift: number;
  started: boolean;
}

/**
 * Drag tabs to reorder them. Done with pointer events: HTML5 drag-and-drop doesn't reach the page
 * while the window accepts dropped files (Tauri's dragDropEnabled).
 */
export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const mainId = useTabs((s) => s.mainId);
  const splitId = useTabs((s) => s.splitId);
  const setActive = useTabs((s) => s.setActive);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const groups = groupsOf(tabs, mainId, splitId);
  const marks = useGitMarks((s) => s.marks);

  // Which open files are in a git repository (re-checked after commits, pulls, new files, repo changes).
  const paths = useTabs((s) => s.tabs.map((t) => t.path ?? "").filter(Boolean).join("\n"));
  const treeVersion = useGit((s) => s.treeVersion);
  const repoRoot = useGit((s) => s.repo?.root);
  useSettings((s) => s.autoCommit); // re-render: the git mark's tooltip depends on it
  useEffect(() => {
    void refreshGitMarks(paths ? paths.split("\n") : []);
  }, [paths, treeVersion, repoRoot]);

  // Keep the active tab visible when switching with the keyboard.
  useEffect(() => {
    if (drag.current?.started) return;
    strip.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const groupEl = (id: string) => strip.current?.querySelector<HTMLElement>(`[data-group="${id}"]`) ?? null;

  /** Keeps the dragged group under the pointer, wherever the layout has put it. */
  const place = () => {
    const d = drag.current;
    const el = d && groupEl(d.ids[0]);
    const box = strip.current?.getBoundingClientRect();
    if (!d || !el || !box) return;
    const layoutLeft = el.getBoundingClientRect().left - d.shift;
    const left = Math.min(Math.max(d.x - d.grab, box.left), box.right - el.offsetWidth);
    d.shift = left - layoutLeft;
    el.style.transform = `translateX(${d.shift}px)`;
  };

  // After a reorder re-renders the strip, put the dragged group back under the pointer.
  useLayoutEffect(() => {
    if (drag.current?.started) place();
  }, [tabs]);

  const onMove = (ev: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.x = ev.clientX;
    if (!d.started) {
      if (Math.abs(d.x - d.startX) < 5) return;
      const el = groupEl(d.ids[0]);
      if (!el) return;
      d.started = true;
      d.grab = d.startX - el.getBoundingClientRect().left;
      setDragKey(d.ids[0]);
      document.body.classList.add("tab-dragging");
    }
    const box = strip.current!.getBoundingClientRect();
    // Scroll the strip when dragging past its edges.
    if (d.x < box.left + 24) strip.current!.scrollLeft -= 12;
    else if (d.x > box.right - 24) strip.current!.scrollLeft += 12;

    const { tabs, mainId, splitId, moveGroup } = useTabs.getState();
    const list = groupsOf(tabs, mainId, splitId);
    const from = list.findIndex((g) => g[0].id === d.ids[0]);
    // Past the middle of another group: move beyond it (the farthest such group wins).
    let target: { id: string; after: boolean } | null = null;
    for (let i = 0; i < list.length; i++) {
      if (i === from) continue;
      const r = groupEl(list[i][0].id)?.getBoundingClientRect();
      if (!r) continue;
      const mid = r.left + r.width / 2;
      if (i > from && d.x > mid) target = { id: list[i][list[i].length - 1].id, after: true };
      else if (i < from && d.x < mid && !target) target = { id: list[i][0].id, after: false };
    }
    if (target) moveGroup(d.ids, target.id, target.after);
    place();
  };

  const onUp = () => {
    const d = drag.current;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    drag.current = null;
    if (d?.started) {
      const el = groupEl(d.ids[0]);
      if (el) el.style.transform = "";
      setDragKey(null);
      document.body.classList.remove("tab-dragging");
    }
  };

  const onPointerDown = (e: React.PointerEvent, tab: Tab) => {
    if (e.button !== 0) return;
    setActive(tab.id);
    // Activating can pair the tab with the other pane's tab, so look the group up afterwards.
    const s = useTabs.getState();
    const group = groupsOf(s.tabs, s.mainId, s.splitId).find((g) => g.some((t) => t.id === tab.id));
    // The split pair is pinned to the right end; only other tabs are dragged.
    if (!group || group.length > 1) return;
    drag.current = { ids: group.map((t) => t.id), startX: e.clientX, x: e.clientX, grab: 0, shift: 0, started: false };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  useEffect(() => onUp, []); // unmount mid-drag

  const renderTab = (tab: Tab) => {
    const mark = tab.path ? marks[tab.path] : null;
    const markText = mark ? gitMarkText(mark) : "";
    return (
    <div
      key={tab.id}
      data-tab-id={tab.id}
      role="tab"
      aria-selected={tab.id === activeId}
      title={mark ? `${tab.path}\n${markText}` : (tab.path ?? tab.title)}
      className={`tab${mark ? " in-git" : ""}${tab.id === activeId ? " active" : ""}${splitId && tab.id !== activeId && (tab.id === mainId || tab.id === splitId) ? " in-split" : ""}${tab.dirty ? " dirty" : ""}`}
      onPointerDown={(e) => onPointerDown(e, tab)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        showTabMenu(tab);
      }}
    >
      {mark && <GitGlyph title={markText} />}
      <span className="tab-title">{tab.title}</span>
      <button
        className="tab-close"
        aria-label={`Close ${tab.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
      >
        <span className="dot" aria-hidden />
        <svg className="x" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
    );
  };

  return (
    <div className="tabbar" onDoubleClick={(e) => e.target === e.currentTarget && newTab()}>
      <div
        className="tabs"
        ref={strip}
        role="tablist"
        onDoubleClick={(e) => e.target === e.currentTarget && newTab()}
        onWheel={(e) => {
          // Vertical mouse wheel scrolls the tab strip sideways.
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {groups.map((group) => (
          <div
            key={group[0].id}
            data-group={group[0].id}
            className={`tab-group${group.length > 1 ? " pair" : ""}${dragKey === group[0].id ? " dragging" : ""}`}
            title={group.length > 1 ? "Shown side by side (kept at the right)" : undefined}
          >
            {group.map(renderTab)}
          </div>
        ))}
      </div>
      <button className="tab-new" aria-label="New tab" title="New (⌘N · Ctrl+N). New file of type: ⇧⌘N · Ctrl+Shift+N" onClick={() => newTab()}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
