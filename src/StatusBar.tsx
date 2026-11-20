import { setLanguage, showEncodingMenu, toggleEol, toggleSource } from "./actions";
import { encodingName } from "./editors/encodings";
import { LANGUAGE_LIST, type LanguageId } from "./editors/languages";
import { useTabs } from "./tabs/store";
import { useGit } from "./git/store";
import { showBranchMenu, syncNow, toggleSidebar } from "./git/actions";
import { useSettings } from "./settings";

/** Branch (click: branch menu) and sync state (click: sync now) of the open repository. */
function RepoStatus() {
  const repo = useGit((s) => s.repo);
  const sync = useGit((s) => s.sync);
  if (!repo) return null;
  const icon = { idle: "↻", syncing: "↻", synced: "✓", local: "", error: "!", conflict: "⚠", auth: "⚠" }[sync.state];
  const counts = `${repo.ahead ? `↑${repo.ahead} ` : ""}${repo.behind ? `↓${repo.behind} ` : ""}`;
  const title = sync.message || "Sync with the remote";
  return (
    <>
      <button className="sb-item sb-btn" title="Switch or create a branch" onClick={() => void showBranchMenu()}>
        {repo.branch ?? "(no branch)"}
      </button>
      {(icon || counts) && (
        <button
          className={`sb-item sb-btn sb-git ${sync.state}`}
          title={`${title}${sync.conflicts.length ? `\nConflicts: ${sync.conflicts.join(", ")}` : ""}\nClick to sync now`}
          onClick={() => void syncNow()}
        >
          {counts}
          {icon}
        </button>
      )}
    </>
  );
}

/** Shown only while a repository is open and its sidebar is hidden. */
function SidebarToggle() {
  const repo = useGit((s) => s.repo);
  const visible = useSettings((s) => s.sidebar);
  if (!repo || visible) return null;
  return (
    <button className="sb-item sb-btn sb-icon" title="Show repository sidebar (⇧⌘E · Ctrl+Shift+E)" aria-label="Show repository sidebar" onClick={toggleSidebar}>
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 3v10" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </button>
  );
}

/** Deliberately quiet: position (or word count) and language. Line endings and
 *  encoding appear only when they differ from the default (LF, UTF-8). */
export function StatusBar() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  const status = useTabs((s) => s.status);
  if (!tab)
    return (
      <footer className="statusbar">
        <SidebarToggle />
      </footer>
    );

  if (tab.loading)
    return (
      <footer className="statusbar">
        <SidebarToggle />
        <span className="sb-spacer" />
        <RepoStatus />
        <span className="sb-item">Loading…</span>
      </footer>
    );
  const wysiwyg = tab.language === "markdown" && !tab.mdSource;
  const preview = tab.language === "html" && !tab.mdSource;
  const words = wysiwyg ? (tab.content.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length : 0;

  return (
    <footer className="statusbar">
      <SidebarToggle />
      <span className="sb-spacer" />
      <RepoStatus />
      <span className="sb-item">
        {wysiwyg
          ? `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`
          : preview
            ? "Preview"
            : `Ln ${status.line}, Col ${status.col}${status.selected ? ` · ${status.selected} sel` : ""}`}
      </span>
      {tab.eol === "\r\n" && (
        <button className="sb-item sb-btn" onClick={() => toggleEol(tab.id)} title="Line endings: click to switch to LF">
          CRLF
        </button>
      )}
      {(tab.encoding !== "utf-8" || tab.bom) && (
        <button
          className={`sb-item sb-btn${tab.lossy ? " sb-warn" : ""}`}
          title={`${encodingName(tab.encoding, false)}${tab.bom ? " with BOM" : ""}${tab.lossy ? " (some bytes couldn't be read)" : ""}. Click to reopen or save with another encoding.`}
          onClick={() => void showEncodingMenu(tab.id)}
        >
          {encodingName(tab.encoding)}
          {tab.bom ? " BOM" : ""}
        </button>
      )}
      {tab.language === "markdown" && (
        <button className="sb-item sb-btn" onClick={() => toggleSource(tab.id)} title="Toggle source (⌘/ · Ctrl+/)">
          {tab.mdSource ? "Source" : "Formatted"}
        </button>
      )}
      {tab.language === "html" && (
        // HTML: the button says what it does: preview the page, or go back to its source.
        <button
          className="sb-item sb-btn"
          onClick={() => toggleSource(tab.id)}
          title={tab.mdSource ? "Preview the page (⌘/ · Ctrl+/)" : "Back to the source (⌘/ · Ctrl+/)"}
        >
          {tab.mdSource ? "Preview" : "Source"}
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
