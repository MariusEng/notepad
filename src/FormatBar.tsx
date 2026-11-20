import { useEffect, useState } from "react";
import { activeEditor, type MdAction, type MdFormatState } from "./editors/handle";
import { useSettings } from "./settings";
import { useTabs } from "./tabs/store";

const NONE: MdFormatState = { bold: false, italic: false, strike: false, code: false, link: false, heading: 0 };

type Item = { action: MdAction; label: string; title: string; style?: React.CSSProperties; key?: keyof MdFormatState };

const GROUPS: Item[][] = [
  [
    { action: "bold", label: "B", title: "Bold (⌘B)", key: "bold", style: { fontWeight: 700 } },
    { action: "italic", label: "I", title: "Italic (⌘I)", key: "italic", style: { fontStyle: "italic" } },
    { action: "strike", label: "S", title: "Strikethrough", key: "strike", style: { textDecoration: "line-through" } },
    { action: "code", label: "</>", title: "Inline code (⌘E)", key: "code", style: { fontFamily: "var(--font-mono)", fontSize: 12 } },
  ],
  [
    { action: "bullet", label: "•", title: "Bulleted list" },
    { action: "ordered", label: "1.", title: "Numbered list" },
    { action: "task", label: "☐", title: "Task list" },
  ],
  [
    { action: "link", label: "Link", title: "Link", key: "link" },
    { action: "table", label: "Table", title: "Insert table" },
  ],
  [
    { action: "quote", label: "❝", title: "Quote" },
    { action: "codeblock", label: "{ }", title: "Code block", style: { fontFamily: "var(--font-mono)", fontSize: 12 } },
    { action: "hr", label: "―", title: "Divider" },
  ],
];

/** Fixed formatting bar under the tabs. Always visible (when enabled in View), but only
 *  active while a document is being edited in the formatted Markdown view. */
export function FormatBar() {
  const visible = useSettings((s) => s.formatBar);
  const enabled = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return !!t && t.language === "markdown" && !t.mdSource;
  });
  const [state, setState] = useState<MdFormatState>(NONE);

  // Keep the pressed states in sync with the caret/selection.
  useEffect(() => {
    if (!enabled) {
      setState(NONE);
      return;
    }
    const sync = () => setState(activeEditor()?.md?.state() ?? NONE);
    document.addEventListener("selectionchange", sync);
    const t = setTimeout(sync, 100);
    return () => {
      document.removeEventListener("selectionchange", sync);
      clearTimeout(t);
    };
  }, [enabled]);

  if (!visible) return null;

  const run = (a: MdAction) => {
    activeEditor()?.md?.run(a);
    setState(activeEditor()?.md?.state() ?? NONE);
  };

  return (
    <div className="formatbar" role="toolbar" aria-label="Formatting" aria-disabled={!enabled}>
      <select
        className="fb-heading"
        disabled={!enabled}
        value={state.heading}
        title="Paragraph / heading"
        onChange={(e) => {
          activeEditor()?.md?.setHeading(Number(e.target.value));
          activeEditor()?.focus();
        }}
      >
        <option value={0}>Paragraph</option>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={n}>
            Heading {n}
          </option>
        ))}
      </select>
      {GROUPS.map((group, i) => (
        <div className="fb-group" key={i}>
          {group.map((it) => (
            <button
              key={it.action}
              className={`fb-btn${it.key && state[it.key] ? " on" : ""}`}
              style={it.style}
              title={it.title}
              disabled={!enabled}
              // Keep the editor's selection and focus when clicking a button.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(it.action)}
            >
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
