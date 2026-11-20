import { setLanguage, toggleEol, toggleMarkdownSource } from "./actions";
import { LANGUAGE_LIST, type LanguageId } from "./editors/languages";
import { useTabs } from "./tabs/store";
import { useSettings } from "./settings";

const THEME_LABEL = { system: "Theme: System", light: "Theme: Light", dark: "Theme: Dark" } as const;
const NEXT_THEME = { system: "light", light: "dark", dark: "system" } as const;

export function StatusBar() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  const status = useTabs((s) => s.status);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  if (!tab) return <footer className="statusbar" />;

  const wysiwyg = tab.language === "markdown" && !tab.mdSource;
  const words = wysiwyg ? (tab.content.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length : 0;

  return (
    <footer className="statusbar">
      <span className="sb-path" title={tab.path ?? "Not saved yet"}>
        {tab.path ?? "Unsaved"}
      </span>
      <span className="sb-spacer" />
      {wysiwyg ? (
        <span className="sb-item">{words.toLocaleString()} words</span>
      ) : (
        <span className="sb-item">
          Ln {status.line}, Col {status.col}
          {status.selected > 0 && ` (${status.selected} selected)`}
        </span>
      )}
      {tab.language === "markdown" && (
        <button className="sb-item sb-btn" onClick={() => toggleMarkdownSource(tab.id)} title="Toggle source (⌘/)">
          {tab.mdSource ? "Source" : "Formatted"}
        </button>
      )}
      <button className="sb-item sb-btn sb-hide-narrow" onClick={() => toggleEol(tab.id)} title="Line endings">
        {tab.eol === "\r\n" ? "CRLF" : "LF"}
      </button>
      <span className="sb-item sb-hide-narrow">{tab.bom ? "UTF-8 BOM" : "UTF-8"}</span>
      <label className="sb-item sb-select" title="Language">
        <select value={tab.language} onChange={(e) => setLanguage(tab.id, e.target.value as LanguageId)}>
          {LANGUAGE_LIST.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <button className="sb-item sb-btn" onClick={() => setTheme(NEXT_THEME[theme])} title="Change theme">
        {THEME_LABEL[theme]}
      </button>
    </footer>
  );
}
