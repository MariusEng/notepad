import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { newTab } from "./actions";
import { LANGUAGE_LIST, type LanguageId } from "./editors/languages";

const usePicker = create<{ open: boolean }>(() => ({ open: false }));

/** ⇧⌘N / Ctrl+Shift+N: choose the type of a new document. */
export const openTypePicker = () => usePicker.setState({ open: true });
const close = () => usePicker.setState({ open: false });

/** A small, keyboard-first list: type to filter, ↑/↓ to move, Enter to create, Esc to cancel. */
export function TypePicker() {
  const open = usePicker((s) => s.open);
  return open ? <Picker /> : null;
}

function Picker() {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\./, "");
    if (!q) return LANGUAGE_LIST;
    return LANGUAGE_LIST.filter((l) => l.label.toLowerCase().includes(q) || l.extensions.some((e) => e.startsWith(q)));
  }, [query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (id: LanguageId) => {
    close();
    newTab(id);
  };

  return (
    <div className="picker-backdrop" onMouseDown={close}>
      <div
        className="picker"
        role="dialog"
        aria-label="New file of type"
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
          placeholder="New file of type…"
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
