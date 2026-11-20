import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TabBar } from "./tabs/TabBar";
import { StatusBar } from "./StatusBar";
import { Banner } from "./Banner";
import { CodeEditor } from "./editors/CodeEditor";
import { useTabs } from "./tabs/store";

export function App() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  const notice = useTabs((s) => s.notice);

  // Window title: "notes.md • — Notepad"
  useEffect(() => {
    const title = tab ? `${tab.title}${tab.dirty ? " •" : ""} — Notepad` : "Notepad";
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [tab?.title, tab?.dirty]);

  return (
    <div className="app">
      <TabBar />
      {tab && <Banner tab={tab} />}
      <main className="editor-area">
        {tab && <CodeEditor key={`${tab.id}:${tab.version}:${tab.language}`} tab={tab} />}
      </main>
      <StatusBar />
      {notice && (
        <div className={`toast ${notice.kind}`} role="status">
          {notice.text}
        </div>
      )}
    </div>
  );
}
