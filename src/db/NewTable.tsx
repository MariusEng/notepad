import { useState } from "react";
import { COLUMN_TYPES, createTableSql, type ColumnDraft } from "./sql";

const blank = (): ColumnDraft => ({ name: "", type: "TEXT", pk: false, notNull: false, unique: false, default: "" });

/**
 * New Table: a name and its columns, with the CREATE TABLE statement it makes shown underneath. "Edit as SQL" puts
 * that statement in the query editor instead (for foreign keys, CHECKs and the like).
 */
export function NewTableDialog({
  existing,
  onClose,
  onCreate,
  onEdit,
}: {
  existing: string[];
  onClose: () => void;
  /** Runs the statement; resolves to an error message, or null when the table was created. */
  onCreate: (sql: string) => Promise<string | null>;
  onEdit: (sql: string) => void;
}) {
  const [name, setName] = useState("");
  const [cols, setCols] = useState<ColumnDraft[]>([
    { ...blank(), name: "id", type: "INTEGER", pk: true },
    blank(),
  ]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (i: number, patch: Partial<ColumnDraft>) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const named = cols.filter((c) => c.name.trim());
  const dupCol = named.find((c, i) => named.findIndex((d) => d.name.trim().toLowerCase() === c.name.trim().toLowerCase()) !== i);
  const taken = existing.some((t) => t.toLowerCase() === name.trim().toLowerCase());
  const problem = !name.trim()
    ? ""
    : taken
      ? `There is already a table or view called “${name.trim()}”.`
      : !named.length
        ? "Add at least one column."
        : dupCol
          ? `Two columns are called “${dupCol.name.trim()}”.`
          : "";
  const ready = !!name.trim() && !problem && !busy;
  const sql = createTableSql(name || "new_table", cols);

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    const err = await onCreate(sql);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="picker-backdrop" onMouseDown={onClose}>
      <div
        className="dialog db-dialog"
        role="dialog"
        aria-label="New table"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void create();
        }}
      >
        <h2>New table</h2>
        <label className="field">
          <span className="field-label">Table name</span>
          <input
            autoFocus
            value={name}
            spellCheck={false}
            placeholder="people"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
        </label>
        <table className="db-coledit">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th title="Primary key">Key</th>
              <th title="NOT NULL: a value is required">Required</th>
              <th title="UNIQUE: no two rows have the same value">Unique</th>
              <th>Default</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cols.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={c.name}
                    spellCheck={false}
                    placeholder="name"
                    aria-label="Column name"
                    onChange={(e) => {
                      set(i, { name: e.target.value });
                      // Typing in the last row adds a new empty one.
                      if (i === cols.length - 1 && e.target.value) setCols((cs) => [...cs, blank()]);
                    }}
                  />
                </td>
                <td>
                  <select value={c.type} aria-label="Type" onChange={(e) => set(i, { type: e.target.value })}>
                    {COLUMN_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="db-check">
                  <input type="checkbox" aria-label="Primary key" checked={c.pk} onChange={(e) => set(i, { pk: e.target.checked })} />
                </td>
                <td className="db-check">
                  <input type="checkbox" aria-label="Required" checked={c.notNull} onChange={(e) => set(i, { notNull: e.target.checked })} />
                </td>
                <td className="db-check">
                  <input type="checkbox" aria-label="Unique" checked={c.unique} onChange={(e) => set(i, { unique: e.target.checked })} />
                </td>
                <td>
                  <input
                    value={c.default}
                    spellCheck={false}
                    placeholder="none"
                    aria-label="Default value"
                    title="A number, text, NULL or CURRENT_TIMESTAMP"
                    onChange={(e) => set(i, { default: e.target.value })}
                  />
                </td>
                <td>
                  {cols.length > 1 && (
                    <button className="dv-btn" aria-label="Remove column" title="Remove column" onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre className="db-sql">{sql}</pre>
        {(problem || error) && <p className="error">{problem || error}</p>}
        <div className="dialog-actions">
          <button className="btn ghost" onClick={() => onEdit(sql)} title="Put the statement in the query editor to change it before running">
            Edit as SQL
          </button>
          <span className="sb-spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ready} onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
