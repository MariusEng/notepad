import { setLanguage, toggleEol, toggleMarkdownSource } from "./actions";
import { LANGUAGE_LIST, type LanguageId } from "./editors/languages";
import { useTabs } from "./tabs/store";

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
