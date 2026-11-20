import { useEffect, useRef } from "react";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { LANGUAGES } from "./languages";
import { cmHighlight, cmTheme } from "./cmTheme";
import { registerEditor } from "./handle";
import { columnSelection } from "./blockSelect";
import { useTabs, type Tab } from "../tabs/store";

/** Uncontrolled: it reads the tab once on mount. The parent remounts it (via `key`)
 *  when the tab, its language or its version changes. */
export function CodeEditor({ tab }: { tab: Tab }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { edit, update, setStatus } = useTabs.getState();
    const lang = LANGUAGES[tab.language];
    const language = new Compartment();
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    // Copying a big document into the store on every keystroke would be slow; do it when typing pauses
    // (and whenever something needs the text: see flushEdits).
    const large = tab.content.length > 2_000_000;
    let editTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    // eslint-disable-next-line prefer-const
    let view!: EditorView;
    const flush = () => {
      clearTimeout(editTimer);
      if (!pending) return;
      pending = false;
      edit(tab.id, view.state.doc.toString());
    };

    const reportStatus = (state: EditorState) => {
      // Only the focused pane drives the status bar.
      if (useTabs.getState().activeId !== tab.id) return;
      const sel = state.selection.main;
      const line = state.doc.lineAt(sel.head);
      setStatus({ line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) });
    };

    const state = EditorState.create({
      doc: tab.content,
      selection: EditorSelection.cursor(Math.min(tab.cursor, tab.content.length)),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        columnSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        indentUnit.of(tab.language === "yaml" || tab.language === "json" ? "  " : "    "),
        keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        lang.wrap ? EditorView.lineWrapping : [],
        cmTheme,
        cmHighlight,
        language.of([]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            if (!large) edit(tab.id, u.state.doc.toString());
            else {
              if (!useTabs.getState().tabs.find((t) => t.id === tab.id)?.dirty) update(tab.id, { dirty: true });
              pending = true;
              clearTimeout(editTimer);
              editTimer = setTimeout(flush, 600);
            }
          }
          if (u.docChanged || u.selectionSet) {
            reportStatus(u.state);
            update(tab.id, { cursor: u.state.selection.main.head });
          }
        }),
        EditorView.domEventHandlers({
          focus(_e, view) {
            reportStatus(view.state);
          },
          scroll(_e, view) {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => update(tab.id, { scroll: view.scrollDOM.scrollTop }), 250);
          },
        }),
      ],
    });

    view = new EditorView({ state, parent: host.current! });
    reportStatus(view.state);

    // Restore scroll after layout, and load the language grammar lazily.
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = tab.scroll;
      if (useTabs.getState().activeId === tab.id) view.focus();
    });
    let cancelled = false;
    lang.load(tab.content).then((ext) => {
      if (!cancelled) view.dispatch({ effects: language.reconfigure(ext) });
    });

    const unregister = registerEditor(tab.id, {
      flush,
      focus: () => view.focus(),
      find: () => {
        view.focus();
        openSearchPanel(view);
      },
      replaceAll: (text) => {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: EditorSelection.cursor(Math.min(view.state.selection.main.head, text.length)),
        });
        return true;
      },
    });

    return () => {
      cancelled = true;
      clearTimeout(scrollTimer);
      flush();
      unregister();
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="code-editor" ref={host} />;
}
