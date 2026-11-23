import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { newDatabase, newTab, saveTabAs } from "./actions";
import { LANGUAGE_LIST, type LanguageId } from "./editors/languages";
import { useTabs } from "./tabs/store";

/** `saveAs`: the tab being saved (Save As… picks the type first); otherwise a new document. */
const usePicker = create<{ open: boolean; saveAs: string | null }>(() => ({ open: false, saveAs: null }));

/** ⇧⌘N / Ctrl+Shift+N: choose the type of a new document. */
export const openTypePicker = () => usePicker.setState({ open: true, saveAs: null });
/** Save As… (⇧⌘S): choose the file type, then where to save. The current type is preselected. */
export const openSaveAsPicker = (id = useTabs.getState().activeId) => {
  const tab = useTabs.getState().tabs.find((t) => t.id === id);
  if (!tab || tab.loading) return;
  if (tab.kind) void saveTabAs(tab.id); // a database has no other type: straight to the save dialog
  else usePicker.setState({ open: true, saveAs: tab.id });
};

/** Not a text type: "New file of type" also offers an SQLite database (File → New Database…). */
const DATABASE = { id: "sqlite-db", label: "SQLite Database", extensions: ["sqlite", "db"] } as const;
const close = () => usePicker.setState({ open: false, saveAs: null });

/** A small, keyboard-first list: type to filter, ↑/↓ to move, Enter to create, Esc to cancel. */
export function TypePicker() {
  const open = usePicker((s) => s.open);
  return open ? <Picker /> : null;
}

function Picker() {
  const saveAs = usePicker((s) => s.saveAs);
  const current = useTabs((s) => s.tabs.find((t) => t.id === saveAs)?.language);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(() => Math.max(0, LANGUAGE_LIST.findIndex((l) => l.id === current)));
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\./, "");
    const all = saveAs ? LANGUAGE_LIST : [...LANGUAGE_LIST, DATABASE];
    if (!q) return all;
    return all.filter(
      (l) => l.label.toLowerCase().includes(q) || l.extensions.some((e) => e.startsWith(q)) || (l === DATABASE && "database".startsWith(q)),
    );
  }, [query, saveAs]);

  useEffect(() => input.current?.focus(), []);
  // Filtering starts at the top; until then the preselected (current) type stays.
  const lastQuery = useRef(query);
  useEffect(() => {
    if (lastQuery.current !== query) setIndex(0);
    lastQuery.current = query;
  }, [query]);
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (id: LanguageId | typeof DATABASE.id) => {
    close();
    if (id === DATABASE.id) void newDatabase();
    else if (saveAs) void saveTabAs(saveAs, id);
    else newTab(id);
  };

  return (
    <div className="picker-backdrop" onMouseDown={close}>
      <div
        className="picker"
        role="dialog"
        aria-label={saveAs ? "Save as type" : "New file of type"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (items[index]) choose(items[index].id);
          }
        }}
      >
        <input
          ref={input}
          className="picker-input"
          placeholder={saveAs ? "Save as type… (Enter keeps the current type)" : "New file of type…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <ul className="picker-list" ref={list} role="listbox">
          {items.map((l, i) => (
            <li
              key={l.id}
              role="option"
              aria-selected={i === index}
              className={`picker-item${i === index ? " sel" : ""}`}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(l.id)}
            >
              <span>{l.label}</span>
              <span className="picker-ext">.{l.extensions[0]}</span>
            </li>
          ))}
          {items.length === 0 && <li className="picker-empty">No matching type</li>}
        </ul>
      </div>
    </div>
  );
}
