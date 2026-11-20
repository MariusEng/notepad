import { setLanguage, toggleEol, toggleMarkdownSource } from "./actions";
import { LANGUAGE_LIST, type LanguageId } from "./editors/languages";
import { useTabs } from "./tabs/store";
import { useGit } from "./git/store";
import { syncNow } from "./git/actions";

/** Branch and sync state of the open repository; click to sync now. */
function RepoStatus() {
  const repo = useGit((s) => s.repo);
  const sync = useGit((s) => s.sync);
  if (!repo) return null;
  const icon = { idle: "", syncing: "↻", synced: "✓", local: "", error: "!", conflict: "⚠", auth: "⚠" }[sync.state];
  const counts = `${repo.ahead ? ` ↑${repo.ahead}` : ""}${repo.behind ? ` ↓${repo.behind}` : ""}`;
  const title = sync.message || "Sync with the remote";
  return (
    <button
      className={`sb-item sb-btn sb-git ${sync.state}`}
      title={`${title}${sync.conflicts.length ? `\nConflicts: ${sync.conflicts.join(", ")}` : ""}`}
      onClick={() => void syncNow()}
    >
      {repo.branch ?? "(no branch)"}
      {counts} {icon}
    </button>
  );
}

/** Deliberately quiet: position (or word count) and language. Line endings and
 *  encoding appear only when they differ from the default (LF, UTF-8). */
export function StatusBar() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  const status = useTabs((s) => s.status);
  if (!tab) return <footer className="statusbar" />;

  const wysiwyg = tab.language === "markdown" && !tab.mdSource;
  const words = wysiwyg ? (tab.content.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length : 0;

  return (
    <footer className="statusbar">
      <span className="sb-spacer" />
      <RepoStatus />
      <span className="sb-item">
        {wysiwyg
          ? `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`
          : `Ln ${status.line}, Col ${status.col}${status.selected ? ` · ${status.selected} sel` : ""}`}
      </span>
      {tab.eol === "\r\n" && (
        <button className="sb-item sb-btn" onClick={() => toggleEol(tab.id)} title="Line endings: click to switch to LF">
          CRLF
        </button>
      )}
      {tab.bom && <span className="sb-item">BOM</span>}
      {tab.language === "markdown" && (
        <button className="sb-item sb-btn" onClick={() => toggleMarkdownSource(tab.id)} title="Toggle source (⌘/ · Ctrl+/)">
          {tab.mdSource ? "Source" : "Formatted"}
        </button>
      )}
      <label className="sb-item sb-select" title="Language">
        <select value={tab.language} onChange={(e) => setLanguage(tab.id, e.target.value as LanguageId)}>
          {LANGUAGE_LIST.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
