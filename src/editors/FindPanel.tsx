import { useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { EditorSelection, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, runScopeHandlers, type Panel, type ViewUpdate } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";

/**
 * Find and replace for the code editor, in place of CodeMirror's stock panel (its search state, match
 * highlighting and commands are still used). Extras: a match count, and "find in selection", which limits
 * find and replace to what was selected, e.g. a column picked with Ctrl+Space or Alt+drag.
 *
 * Shortcuts follow the OS (native menu, see lib.rs): Find ⌘F / Ctrl+F, Replace ⌥⌘F / Ctrl+H,
 * Next ⌘G / F3, Previous ⇧⌘G / Shift+F3, Use Selection for Find ⌘E (macOS).
 * In the panel: Enter = next, Shift+Enter = previous, Alt+Enter = select all matches,
 * Enter in Replace = replace, ⌘Enter / Ctrl+Enter = replace all, Esc = close.
 */

// ---------------------------------------------------------------- find in selection

type Scope = { from: number; to: number }[] | null;
const setScope = StateEffect.define<Scope>();

const scopeField = StateField.define<Scope>({
  create: () => null,
  update(scope, tr) {
    for (const e of tr.effects) if (e.is(setScope)) return e.value;
    if (!scope || !tr.docChanged) return scope;
    return scope.map((r) => ({ from: tr.changes.mapPos(r.from, -1), to: tr.changes.mapPos(r.to, 1) }));
  },
  provide: (f) =>
    EditorView.decorations.from(f, (scope) => {
      if (!scope) return Decoration.none;
      const mark = Decoration.mark({ class: "cm-find-scope" });
      const ranges: Range<Decoration>[] = scope.filter((r) => r.to > r.from).map((r) => mark.range(r.from, r.to));
      return Decoration.set(ranges, true);
    }),
});

const scopeOf = (view: EditorView) => view.state.field(scopeField, false) ?? null;

function selectionScope(view: EditorView): Scope {
  const ranges = view.state.selection.ranges.filter((r) => !r.empty).map((r) => ({ from: r.from, to: r.to }));
  return ranges.length ? ranges : null;
}

/** Matches inside the scope, in document order (at most `limit`). */
function scopedMatches(view: EditorView, query: SearchQuery, scope: NonNullable<Scope>, limit = Infinity) {
  const out: { from: number; to: number }[] = [];
  for (const r of [...scope].sort((a, b) => a.from - b.from)) {
    const cursor = query.getCursor(view.state, r.from, r.to);
    for (let m = cursor.next(); !m.done && out.length < limit; m = cursor.next()) {
      const v = m.value as { from: number; to: number };
      if (v.to > v.from) out.push({ from: v.from, to: v.to });
    }
  }
  return out;
}

const unquote = (s: string) => s.replace(/\\([nrt\\])/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : "\\"));

/** The replacement for one matched text, with $1-style groups for regular expressions. */
function replacementFor(query: SearchQuery, matched: string) {
  if (!query.regexp) return unquote(query.replace);
  try {
    return matched.replace(new RegExp(query.search, query.caseSensitive ? "u" : "iu"), unquote(query.replace));
  } catch {
    return query.replace;
  }
}

function select(view: EditorView, m: { from: number; to: number }) {
  view.dispatch({ selection: EditorSelection.single(m.from, m.to), scrollIntoView: true, userEvent: "select.search" });
}

/** Next/previous match, staying inside the scope when "in selection" is on. */
export function findStep(view: EditorView, dir: 1 | -1): boolean {
  const query = getSearchQuery(view.state);
  const scope = scopeOf(view);
  if (!query.valid) {
    openSearchPanel(view);
    return true;
  }
  if (!scope) return dir > 0 ? findNext(view) : findPrevious(view);
  const all = scopedMatches(view, query, scope);
  if (!all.length) return false;
  const sel = view.state.selection.main;
  const m = dir > 0 ? all.find((x) => x.from >= sel.to) ?? all[0] : [...all].reverse().find((x) => x.to <= sel.from) ?? all[all.length - 1];
  select(view, m);
  return true;
}

function replaceOne(view: EditorView) {
  const query = getSearchQuery(view.state);
  const scope = scopeOf(view);
  if (!query.valid) return;
  if (!scope) {
    replaceNext(view);
    return;
  }
  const sel = view.state.selection.main;
  const hit = scopedMatches(view, query, scope).find((m) => m.from === sel.from && m.to === sel.to);
  if (hit) {
    const text = replacementFor(query, view.state.sliceDoc(hit.from, hit.to));
    view.dispatch({ changes: { from: hit.from, to: hit.to, insert: text }, selection: EditorSelection.cursor(hit.from + text.length), userEvent: "input.replace" });
  }
  findStep(view, 1);
}

function replaceEvery(view: EditorView): number {
  const query = getSearchQuery(view.state);
  const scope = scopeOf(view);
  if (!query.valid) return 0;
  if (!scope) {
    const before = countMatches(view, query).count;
    replaceAll(view);
    return before;
  }
  const matches = scopedMatches(view, query, scope);
  if (!matches.length) return 0;
  view.dispatch({
    changes: matches.map((m) => ({ from: m.from, to: m.to, insert: replacementFor(query, view.state.sliceDoc(m.from, m.to)) })),
    userEvent: "input.replace.all",
  });
  return matches.length;
}

const COUNT_LIMIT = 9999;

/** Number of matches (in the scope, if any) and which one is selected; stops early in huge documents. */
function countMatches(view: EditorView, query: SearchQuery): { count: number; current: number; more: boolean } {
  if (!query.valid) return { count: 0, current: 0, more: false };
  const sel = view.state.selection.main;
  const scope = scopeOf(view);
  const doc = view.state.doc;
  const slices = scope ?? [{ from: 0, to: doc.length }];
  const started = performance.now();
  let count = 0;
  let current = 0;
  for (const r of slices) {
    const cursor = query.getCursor(view.state, r.from, r.to);
    for (let m = cursor.next(); !m.done; m = cursor.next()) {
      const v = m.value as { from: number; to: number };
      count++;
      if (v.from === sel.from && v.to === sel.to) current = count;
      if (count >= COUNT_LIMIT || (count % 500 === 0 && performance.now() - started > 60)) return { count, current, more: true };
    }
  }
  return { count, current, more: false };
}

// ---------------------------------------------------------------- the panel

/** What the menus ask for: open Find (optionally with Replace) on this editor. */
const wantReplace = new WeakMap<EditorView, boolean>();
const panelControl = new WeakMap<EditorView, (replace: boolean) => void>();

export function openFind(view: EditorView, replace: boolean) {
  // A selection over several lines (or a column) becomes the search scope, as in VS Code.
  const sel = view.state.selection;
  const multi = sel.ranges.length > 1 || view.state.doc.lineAt(sel.main.from).number !== view.state.doc.lineAt(sel.main.to).number;
  const control = panelControl.get(view);
  if (control) control(replace);
  else wantReplace.set(view, replace);
  if (!searchPanelOpen(view.state)) {
    openSearchPanel(view);
    if (multi) view.dispatch({ effects: setScope.of(selectionScope(view)) });
  } else openSearchPanel(view); // focuses and selects the find field
}

/** ⌘E on macOS: put the selected text into the find field without opening the panel. */
export function useSelectionForFind(view: EditorView) {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const q = getSearchQuery(view.state);
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({ ...q, search: view.state.sliceDoc(sel.from, sel.to), regexp: false, replace: q.replace }),
    ),
  });
}

function FindPanel({ view, subscribe }: { view: EditorView; subscribe: (f: () => void) => () => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [replaceOpen, setReplaceOpen] = useState(() => wantReplace.get(view) ?? false);
  const findInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [counted, setCounted] = useState({ count: 0, current: 0, more: false });
  const [note, setNote] = useState("");

  useEffect(() => subscribe(rerender), [subscribe]);
  useEffect(() => {
    panelControl.set(view, (r) => {
      setReplaceOpen((open) => open || r);
      if (r) setTimeout(() => replaceInput.current?.focus(), 0);
    });
    if (wantReplace.get(view)) setTimeout(() => replaceInput.current?.focus(), 0);
    wantReplace.delete(view);
    return () => void panelControl.delete(view);
  }, [view]);

  const query = getSearchQuery(view.state);
  const scope = scopeOf(view);

  // Count after typing pauses briefly (the document may be huge).
  const key = `${query.search}|${query.caseSensitive}|${query.regexp}|${query.wholeWord}|${view.state.doc.length}|${view.state.selection.main.from}|${view.state.selection.main.to}|${scope?.length ?? 0}`;
  useEffect(() => {
    const t = setTimeout(() => setCounted(countMatches(view, getSearchQuery(view.state))), view.state.doc.length > 2_000_000 ? 250 : 30);
    return () => clearTimeout(t);
  }, [key, view]);

  const setQuery = (patch: Partial<{ search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }>) => {
    const q = getSearchQuery(view.state);
    setNote("");
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord, ...patch }),
      ),
    });
  };

  const toggleScope = () => {
    view.dispatch({ effects: setScope.of(scope ? null : selectionScope(view)) });
    if (!scope && !selectionScope(view)) setNote("Select text first");
  };

  const close = () => {
    closeSearchPanel(view);
    view.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    // Esc, ⌘G/F3 and the other search keys from CodeMirror's "search-panel" scope.
    if (runScopeHandlers(view, e.nativeEvent, "search-panel")) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const mod = (e: React.KeyboardEvent) => e.metaKey || e.ctrlKey;
  const status = !query.search
    ? ""
    : !query.valid
      ? "Invalid"
      : counted.count === 0
        ? "No results"
        : `${counted.current ? `${counted.current} of ` : ""}${counted.count.toLocaleString()}${counted.more ? "+" : ""}`;

  return (
    <div className="find" onKeyDown={onKey}>
      <button
        className={`find-toggle${replaceOpen ? " open" : ""}`}
        title={replaceOpen ? "Hide Replace" : "Show Replace"}
        aria-label="Toggle Replace"
        onClick={() => setReplaceOpen(!replaceOpen)}
      >
        ›
      </button>
      <div className="find-rows">
        <div className="find-row">
          <div className="find-field">
            <input
              ref={findInput}
              main-field="true"
              className="find-input"
              placeholder="Find"
              aria-label="Find"
              spellCheck={false}
              value={query.search}
              onChange={(e) => setQuery({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.altKey) {
                  e.preventDefault();
                  if (selectMatches(view)) view.focus();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (!findStep(view, e.shiftKey ? -1 : 1)) setNote("No results");
                }
              }}
            />
            <Opt on={query.caseSensitive} title="Match Case" onClick={() => setQuery({ caseSensitive: !query.caseSensitive })}>
              Aa
            </Opt>
            <Opt on={query.wholeWord} title="Match Whole Word" onClick={() => setQuery({ wholeWord: !query.wholeWord })}>
              <u>ab</u>
            </Opt>
            <Opt on={query.regexp} title="Use Regular Expression" onClick={() => setQuery({ regexp: !query.regexp })}>
              .*
            </Opt>
          </div>
          <span className={`find-count${query.search && (!query.valid || counted.count === 0) ? " none" : ""}`}>{note || status}</span>
          <button className="find-btn" title="Previous Match (⇧⌘G · Shift+F3 · Shift+Enter)" aria-label="Previous match" onClick={() => findStep(view, -1)}>
            ↑
          </button>
          <button className="find-btn" title="Next Match (⌘G · F3 · Enter)" aria-label="Next match" onClick={() => findStep(view, 1)}>
            ↓
          </button>
          <Opt on={!!scope} title="Find in Selection" onClick={toggleScope}>
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M2 4h12M2 8h8M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <rect x="1" y="6" width="11" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1" opacity=".7" />
            </svg>
          </Opt>
          <button className="find-btn" title="Close (Esc)" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        {replaceOpen && (
          <div className="find-row">
            <div className="find-field">
              <input
                ref={replaceInput}
                className="find-input"
                placeholder="Replace"
                aria-label="Replace"
                spellCheck={false}
                value={query.replace}
                onChange={(e) => setQuery({ replace: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (mod(e) || (e.ctrlKey && e.altKey))) {
                    e.preventDefault();
                    const n = replaceEvery(view);
                    setNote(n ? `Replaced ${n.toLocaleString()}` : "No results");
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    replaceOne(view);
                  }
                }}
              />
            </div>
            <button className="find-btn text" title="Replace (Enter)" onClick={() => replaceOne(view)}>
              Replace
            </button>
            <button
              className="find-btn text"
              title={`Replace All${scope ? " in Selection" : ""} (⌘Enter · Ctrl+Enter)`}
              onClick={() => {
                const n = replaceEvery(view);
                setNote(n ? `Replaced ${n.toLocaleString()}` : "No results");
              }}
            >
              All
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Opt({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`find-opt${on ? " on" : ""}`} title={title} aria-label={title} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function createPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "find-panel";
  const root = createRoot(dom);
  const listeners = new Set<() => void>();
  const subscribe = (f: () => void) => {
    listeners.add(f);
    return () => void listeners.delete(f);
  };
  return {
    dom,
    top: true,
    mount() {
      flushSync(() => root.render(<FindPanel view={view} subscribe={subscribe} />));
      const input = dom.querySelector<HTMLInputElement>("[main-field]");
      input?.focus();
      input?.select();
    },
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.length)) listeners.forEach((f) => f());
    },
    destroy() {
      // Clear the scope when the panel closes; unmount after CodeMirror has removed the panel.
      queueMicrotask(() => {
        root.unmount();
        try {
          if (scopeOf(view)) view.dispatch({ effects: setScope.of(null) });
        } catch {
          /* the editor itself is gone */
        }
      });
    },
  };
}

/** The search extension with this panel. */
export function findAndReplace(): Extension {
  return [scopeField, search({ top: true, createPanel })];
}
