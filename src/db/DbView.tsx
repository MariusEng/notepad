import { useCallback, useEffect, useRef, useState } from "react";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { ask } from "@tauri-apps/plugin-dialog";
import { Menu } from "@tauri-apps/api/menu";
import { cmHighlight, cmTheme } from "../editors/cmTheme";
import { findAndReplace, findStep, openFind, useSelectionForFind } from "../editors/FindPanel";
import { registerEditor } from "../editors/handle";
import { db, isMac, type DbRunResult, type DbSchema, type DbTable, type DbValue } from "../lib/backend";
import { newTab } from "../actions";
import { newId, useTabs, type Tab } from "../tabs/store";
import { NewTableDialog } from "./NewTable";
import { quoteId, toCsv } from "./sql";

/** Rows kept per statement; more would make the grid slow and say little. */
const MAX_ROWS = 1000;
const RUN_KEY = isMac ? "⌘↵" : "Ctrl+Enter";

/** What the results area shows: the last run, or a table's rows from the list on the left. */
interface Shown {
  run: DbRunResult;
  /** Set when the rows are a table's, opened from the list. */
  table?: string;
}

/**
 * An SQLite database: tables and views on the left, a SQL editor on top, results below. Every run is one
 * connection (db.rs), so changes are written at once and there is nothing to save.
 */
export function DbView({ tab }: { tab: Tab }) {
  const path = tab.path!;
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [schemaError, setSchemaError] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [newTable, setNewTable] = useState(false);
  const [ratio, setRatio] = useState(0.35);
  const host = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const runningRef = useRef<string | null>(null);
  const schemaConf = useRef(new Compartment());

  const loadSchema = useCallback(async () => {
    try {
      setSchema(await db.schema(path));
      setSchemaError("");
    } catch (e) {
      setSchemaError(String(e));
    }
  }, [path]);

  useEffect(() => {
    void loadSchema();
  }, [loadSchema]);

  const run = useCallback(
    async (sql: string, table?: string) => {
      if (!sql.trim() || runningRef.current) return;
      const id = newId();
      runningRef.current = id;
      setRunning(id);
      try {
        setShown({ run: await db.run(path, sql, MAX_ROWS, id), table });
      } catch (e) {
        setShown({ run: { results: [], error: String(e), ms: 0 } });
      } finally {
        runningRef.current = null;
        setRunning(null);
        void loadSchema(); // CREATE, DROP, ALTER… change the list
      }
    },
    [path, loadSchema],
  );
  const runRef = useRef(run);
  runRef.current = run;

  /** ⌘↵: the selection if there is one, otherwise everything in the editor. */
  const runEditor = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    void runRef.current(sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to));
  }, []);

  // The query editor (uncontrolled; the text is kept in tab.query for the session).
  useEffect(() => {
    const { update } = useTabs.getState();
    const text = tab.query ?? "";
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        selection: EditorSelection.cursor(text.length),
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          findAndReplace(),
          autocompletion(),
          placeholder(`SQL… ${RUN_KEY} runs it (or the selected part).`),
          keymap.of([
            { key: "Mod-Enter", run: () => (runEditor(), true), preventDefault: true },
            ...completionKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          cmTheme,
          cmHighlight,
          schemaConf.current.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) update(tab.id, { query: u.state.doc.toString() });
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (useTabs.getState().activeId === tab.id) view.focus();
    const unregister = registerEditor(tab.id, {
      focus: () => view.focus(),
      find: (replace) => openFind(view, !!replace),
      findNext: (dir) => findStep(view, dir),
      useSelectionForFind: () => useSelectionForFind(view),
      replaceAll: (t) => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
        return true;
      },
    });
    return () => {
      unregister();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SQLite highlighting, with completion of the database's table and column names.
  useEffect(() => {
    let cancelled = false;
    void import("@codemirror/lang-sql").then(({ sql, SQLite }) => {
      if (cancelled || !viewRef.current) return;
      const names: Record<string, string[]> = {};
      for (const t of schema?.tables ?? []) names[t.name] = t.columns.map((c) => c.name);
      viewRef.current.dispatch({ effects: schemaConf.current.reconfigure(sql({ dialect: SQLite, schema: names })) });
    });
    return () => {
      cancelled = true;
    };
  }, [schema]);

  /** Adds SQL to the end of the editor (on a new line) and selects it, ready to run with ⌘↵. */
  const insertSql = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    const sep = doc.length === 0 ? "" : doc.sliceString(doc.length - 1) === "\n" ? "\n" : "\n\n";
    const from = doc.length + sep.length;
    view.dispatch({
      changes: { from: doc.length, insert: sep + text },
      selection: EditorSelection.range(from, from + text.length),
      scrollIntoView: true,
    });
    view.focus();
  };

  const showRows = (t: DbTable) => void run(`SELECT * FROM ${quoteId(t.name)}`, t.name);

  const tableMenu = async (t: DbTable) => {
    const kind = t.kind === "view" ? "View" : "Table";
    const menu = await Menu.new({
      items: [
        { id: "rows", text: "Show Rows", action: () => showRows(t) },
        { id: "select", text: "Insert SELECT", action: () => insertSql(`SELECT * FROM ${quoteId(t.name)};`) },
        {
          id: "copy-sql",
          text: "Copy CREATE Statement",
          enabled: !!t.sql,
          action: () => void navigator.clipboard.writeText(`${t.sql};`).catch(() => {}),
        },
        { id: "copy-name", text: "Copy Name", action: () => void navigator.clipboard.writeText(t.name).catch(() => {}) },
        { item: "Separator" },
        { id: "new", text: "New Table…", enabled: !schema?.readOnly, action: () => setNewTable(true) },
        {
          id: "drop",
          text: `Drop ${kind}…`,
          enabled: !schema?.readOnly,
          action: async () => {
            const what = t.kind === "view" ? "view" : "table and all its rows";
            const ok = await ask(`Delete the ${what} “${t.name}”? This can't be undone.`, {
              title: `Drop ${kind}`,
              kind: "warning",
              okLabel: "Drop",
              cancelLabel: "Cancel",
            });
            if (ok) void run(`DROP ${kind.toUpperCase()} ${quoteId(t.name)}`);
          },
        },
      ],
    });
    await menu.popup();
  };

  // Drag the results header to resize the editor; double-click resets.
  const onBarDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const rect = body.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: MouseEvent) => setRatio(Math.min(0.85, Math.max(0.1, (ev.clientY - rect.top) / rect.height)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing-v");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("resizing-v");
  };

  const tables = schema?.tables.filter((t) => t.kind === "table") ?? [];
  const views = schema?.tables.filter((t) => t.kind === "view") ?? [];

  return (
    <div className="db-view">
      <aside className="db-schema">
        <div className="db-schema-head">
          <span>Tables</span>
          {schema?.readOnly && <span className="db-ro" title="The file can't be written: you can look, not change">read-only</span>}
          <span className="dv-spacer" />
          {!schema?.readOnly && (
            <button className="dv-btn" title="New Table…" aria-label="New table" onClick={() => setNewTable(true)}>
              +
            </button>
          )}
        </div>
        <div className="db-schema-list">
          {schemaError && <p className="db-error">{schemaError}</p>}
          {schema && !tables.length && !views.length && (
            <p className="db-empty">
              No tables yet. <button className="db-link" onClick={() => setNewTable(true)}>New Table…</button>
            </p>
          )}
          {tables.map((t) => (
            <TableItem key={t.name} t={t} onShow={() => showRows(t)} onMenu={() => void tableMenu(t)} />
          ))}
          {views.length > 0 && <div className="db-group">Views</div>}
          {views.map((t) => (
            <TableItem key={t.name} t={t} onShow={() => showRows(t)} onMenu={() => void tableMenu(t)} />
          ))}
        </div>
      </aside>
      <div className="db-main" ref={body} style={{ gridTemplateRows: `${ratio}fr auto ${1 - ratio}fr` }}>
        <div className="db-editor code-editor" ref={host} />
        <div className="db-bar" onMouseDown={onBarDown} onDoubleClick={() => setRatio(0.35)}>
          {running ? (
            <button className="dv-btn" onClick={() => void db.interrupt(running)} title="Stop the query">
              Stop
            </button>
          ) : (
            <button className="dv-btn db-run" onClick={runEditor} title={`Run the SQL, or the selected part (${RUN_KEY})`}>
              ▶ Run
            </button>
          )}
          <Summary shown={shown} running={!!running} />
          <span className="dv-spacer" />
          <CsvButton shown={shown} />
        </div>
        <Results shown={shown} />
      </div>
      {newTable && (
        <NewTableDialog
          existing={schema?.tables.map((t) => t.name) ?? []}
          onClose={() => setNewTable(false)}
          onEdit={(sql) => {
            setNewTable(false);
            insertSql(sql);
          }}
          onCreate={async (sql) => {
            const r = await db.run(path, sql, 0, newId());
            if (r.error) return r.error;
            await loadSchema();
            setNewTable(false);
            useTabs.getState().notify("Table created");
            return null;
          }}
        />
      )}
    </div>
  );
}

function TableItem({ t, onShow, onMenu }: { t: DbTable; onShow: () => void; onMenu: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="db-table">
      <div
        className="db-table-row"
        onClick={onShow}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu();
        }}
        title={`${t.name}: click to show its rows, right-click for more`}
      >
        <button
          className="db-caret"
          aria-label={open ? "Hide columns" : "Show columns"}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="db-name">{t.name}</span>
      </div>
      {open && (
        <ul className="db-cols">
          {t.columns.map((c) => (
            <li key={c.name} title={[c.declType, c.pk ? "PRIMARY KEY" : "", c.notNull ? "NOT NULL" : "", c.default !== null ? `DEFAULT ${c.default}` : ""].filter(Boolean).join(" ")}>
              <span className={c.pk ? "db-pk" : undefined}>{c.name}</span>
              <span className="db-type">{c.declType.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The last rows-returning statement of a run (what the grid shows). */
const lastRows = (r: DbRunResult) => [...r.results].reverse().find((x) => x.kind === "rows");

function Summary({ shown, running }: { shown: Shown | null; running: boolean }) {
  if (running) return <span className="db-msg">Running…</span>;
  if (!shown) return <span className="db-msg db-faint">Results show here.</span>;
  const { run, table } = shown;
  const time = `${run.ms < 10 ? run.ms.toFixed(1) : Math.round(run.ms)} ms`;
  if (run.error) {
    const done = run.results.length ? ` (after ${plural(run.results.length, "statement")} that ran)` : "";
    return (
      <span className="db-msg db-error" title={run.error}>
        {run.error}
        {done}
      </span>
    );
  }
  const rows = lastRows(run);
  const changes = run.results.reduce((n, r) => n + r.changes, 0);
  const parts: string[] = [];
  if (table) parts.push(table);
  if (rows?.kind === "rows") parts.push(rows.truncated ? `first ${plural(rows.rows.length, "row")}` : plural(rows.rows.length, "row"));
  if (changes || !rows) parts.push(`${plural(changes, "row")} changed`);
  if (run.results.length > 1) parts.push(plural(run.results.length, "statement"));
  parts.push(time);
  return <span className="db-msg">{parts.join(" · ")}</span>;
}

function CsvButton({ shown }: { shown: Shown | null }) {
  const rows = shown && lastRows(shown.run);
  if (rows?.kind !== "rows" || !rows.rows.length) return null;
  return (
    <button
      className="dv-btn"
      title="Open these rows in a new CSV tab"
      onClick={() => newTab("csv", toCsv(rows.columns, rows.rows))}
    >
      Open as CSV
    </button>
  );
}

function Cell({ v }: { v: DbValue }) {
  if (v === null) return <td className="db-null">NULL</td>;
  if (typeof v === "number") return <td className="db-num">{v}</td>;
  if (typeof v === "string")
    return <td title={v.length > 60 ? v.slice(0, 2000) : undefined}>{v.length > 500 ? `${v.slice(0, 500)}…` : v}</td>;
  if ("int" in v) return <td className="db-num">{v.int}</td>;
  return (
    <td className="db-null" title={`${v.hex}${v.blob > 32 ? "…" : ""}`}>
      BLOB {plural(v.blob, "byte")}
    </td>
  );
}

function Results({ shown }: { shown: Shown | null }) {
  const rows = shown && lastRows(shown.run);
  if (rows?.kind !== "rows") return <div className="db-results" />;
  return (
    <div className="db-results">
      <table className="db-grid">
        <thead>
          <tr>
            <th className="db-rownum" />
            {rows.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.rows.map((r, i) => (
            <tr key={i}>
              <td className="db-rownum">{i + 1}</td>
              {r.map((v, j) => (
                <Cell key={j} v={v} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.truncated && <p className="db-more">Showing the first {MAX_ROWS.toLocaleString()} rows. Add a WHERE or LIMIT to see others.</p>}
    </div>
  );
}
