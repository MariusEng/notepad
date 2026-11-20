import { useEffect, useRef, useState } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { closeOtherTabs, closeTab, newTab, saveTab } from "../actions";
import { useTabs, type Tab } from "./store";

async function showTabMenu(tab: Tab) {
  const menu = await Menu.new({
    items: [
      { id: "close", text: "Close", action: () => closeTab(tab.id) },
      { id: "close-others", text: "Close Others", action: () => closeOtherTabs(tab.id) },
      { id: "close-right", text: "Close to the Right", action: () => closeOtherTabs(tab.id, true) },
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

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const setActive = useTabs((s) => s.setActive);
  const move = useTabs((s) => s.move);
  const [dragId, setDragId] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  // Keep the active tab visible when switching with the keyboard.
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

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
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            title={tab.path ?? tab.title}
            className={`tab${tab.id === activeId ? " active" : ""}${tab.dirty ? " dirty" : ""}${dragId === tab.id ? " dragging" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragId(tab.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragId && dragId !== tab.id) {
                e.preventDefault();
                move(dragId, tab.id);
              }
            }}
            onDragEnd={() => setDragId(null)}
            onMouseDown={(e) => {
              if (e.button === 0) setActive(tab.id);
            }}
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
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onMouseDown={(e) => e.stopPropagation()}
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
        ))}
      </div>
      <button className="tab-new" aria-label="New tab" title="New (⌘N / Ctrl+N)" onClick={() => newTab()}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
