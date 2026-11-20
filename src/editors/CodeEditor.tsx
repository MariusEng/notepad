import { useEffect, useRef } from "react";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { LANGUAGES } from "./languages";
import { cmHighlight, cmTheme } from "./cmTheme";
import { registerEditor } from "./handle";
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
        rectangularSelection(),
        crosshairCursor(),
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
          if (u.docChanged) edit(tab.id, u.state.doc.toString());
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

    const view = new EditorView({ state, parent: host.current! });
    reportStatus(view.state);

    // Restore scroll after layout, and load the language grammar lazily.
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = tab.scroll;
      if (useTabs.getState().activeId === tab.id) view.focus();
    });
    let cancelled = false;
    lang.load().then((ext) => {
      if (!cancelled) view.dispatch({ effects: language.reconfigure(ext) });
    });

    const unregister = registerEditor(tab.id, {
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
      unregister();
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="code-editor" ref={host} />;
}
