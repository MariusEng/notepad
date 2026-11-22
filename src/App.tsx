import { useEffect, useRef, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TabBar } from "./tabs/TabBar";
import { StatusBar } from "./StatusBar";
import { Banner } from "./Banner";
import { TypePicker } from "./TypePicker";
import { FormatBar } from "./FormatBar";
import { Sidebar } from "./sidebar/Sidebar";
import { GitDialogs } from "./git/Dialogs";
import { AboutDialog } from "./About";
import { CodeEditor } from "./editors/CodeEditor";
import { MarkdownEditor } from "./editors/MarkdownEditor";
import { HtmlPreview } from "./editors/HtmlPreview";
import { editorFor } from "./editors/handle";
import { useTabs } from "./tabs/store";
import { formatSize } from "./lib/backend";

export function App() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  const mainId = useTabs((s) => s.mainId);
  const splitId = useTabs((s) => s.splitId);
  const ratio = useTabs((s) => s.splitRatio);
  const notice = useTabs((s) => s.notice);
  const panes = useRef<HTMLDivElement>(null);

  // Window title: "notes.md • — Notepad"
  useEffect(() => {
    const title = tab ? `${tab.title}${tab.dirty ? " •" : ""} — Notepad` : "Notepad";
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [tab?.title, tab?.dirty]);

  return (
    <div className="app">
      <TabBar />
      <FormatBar />
      <div className="workspace">
        <Sidebar />
        <main className="editor-area">
          <div
            className="panes"
            ref={panes}
            style={{ gridTemplateColumns: splitId ? `${ratio}fr 1px ${1 - ratio}fr` : "1fr" }}
          >
            {mainId && <Pane key="main" id={mainId} split={!!splitId} />}
            {mainId && splitId && <Divider container={panes} />}
            {splitId && <Pane key="split" id={splitId} split />}
          </div>
        </main>
      </div>
      <StatusBar />
      <TypePicker />
      <GitDialogs />
      <AboutDialog />
      {notice && (
        <div className={`toast ${notice.kind}`} role="status">
          {notice.text}
        </div>
      )}
    </div>
  );
}

/** One editor with its banner. Focusing anything inside makes its tab the active one. */
function Pane({ id, split }: { id: string; split: boolean }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id));
  const focused = useTabs((s) => s.activeId === id);
  const setActive = useTabs((s) => s.setActive);
  const el = useRef<HTMLElement>(null);

  // When a tab click moves the focus to this pane, put the caret in its editor.
  useEffect(() => {
    if (focused && el.current && !el.current.contains(document.activeElement)) editorFor(id)?.focus();
  }, [focused, id]);

  if (!tab) return null;
  return (
    <section
      ref={el}
      className={`pane${split ? " split" : ""}${focused ? " focused" : ""}`}
      onFocusCapture={() => setActive(id)}
      onMouseDownCapture={() => setActive(id)}
    >
      <Banner tab={tab} />
      <div className="pane-body">
        <div className="pane-fill">
          {tab.loading ? (
            <Loading name={tab.title} {...tab.loading} />
          ) : tab.unloaded ? null /* being read back from disk (tabs/unload.ts); takes a moment */ :  tab.language === "markdown" && !tab.mdSource ? (
            <MarkdownEditor key={`md:${tab.id}:${tab.version}`} tab={tab} />
          ) : tab.language === "html" && !tab.mdSource ? (
            <HtmlPreview key={`html:${tab.id}`} tab={tab} />
          ) : (
            <CodeEditor key={`cm:${tab.id}:${tab.version}:${tab.language}`} tab={tab} />
          )}
        </div>
      </div>
    </section>
  );
}

/** Shown while a big file streams in from disk. */
function Loading({ name, loaded, total }: { name: string; loaded: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div className="loading" role="status">
      <div className="loading-text">
        Loading {name}… {formatSize(loaded)} of {formatSize(total)}
      </div>
      <div className="loading-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Drag to resize the panes; double-click to reset to 50/50. */
function Divider({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const setRatio = useTabs((s) => s.setSplitRatio);
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: MouseEvent) => setRatio((ev.clientX - rect.left) / rect.width);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("resizing");
  };
  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onDown}
      onDoubleClick={() => setRatio(0.5)}
    />
  );
}
