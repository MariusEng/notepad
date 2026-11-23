import type { DbValue } from "../lib/backend";

/** "my table" → "\"my table\"" (SQL identifier quoting; always quoted so keywords and spaces are safe). */
export const quoteId = (name: string) => `"${name.replace(/"/g, '""')}"`;

const quoteText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A cell as CSV text: NULL becomes an empty field, blobs their size (they aren't text). */
function csvField(v: DbValue): string {
  const s =
    v === null ? "" : typeof v === "number" ? String(v) : typeof v === "string" ? v : "int" in v ? v.int : `<blob ${v.blob} bytes>`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (columns: string[], rows: DbValue[][]) =>
  [columns, ...rows].map((r) => r.map((v) => csvField(v as DbValue)).join(",")).join("\n") + "\n";

export const COLUMN_TYPES = ["INTEGER", "TEXT", "REAL", "NUMERIC", "BLOB"] as const;

export interface ColumnDraft {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  /** As typed: a number, keyword or quoted text is used as is, anything else becomes a text literal. */
  default: string;
}

/** A DEFAULT value as SQL: `0`, `CURRENT_TIMESTAMP`, `'text'`, `(expression)` stay; plain words get quoted. */
export function defaultSql(v: string): string {
  const s = v.trim();
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return s;
  if (/^(null|true|false|current_timestamp|current_date|current_time)$/i.test(s)) return s.toUpperCase();
  if (/^'.*'$/s.test(s) || /^\(.*\)$/s.test(s) || /^x'[0-9a-f]*'$/i.test(s)) return s;
  return quoteText(s);
}

/** CREATE TABLE for the New Table dialog. One primary key column is declared inline (an INTEGER one is the rowid). */
export function createTableSql(table: string, columns: ColumnDraft[]): string {
  const cols = columns.filter((c) => c.name.trim());
  const pks = cols.filter((c) => c.pk);
  const lines = cols.map((c) => {
    const parts = [quoteId(c.name.trim())];
    if (c.type) parts.push(c.type);
    if (c.pk && pks.length === 1) parts.push("PRIMARY KEY");
    if (c.notNull && !(c.pk && pks.length === 1 && c.type === "INTEGER")) parts.push("NOT NULL");
    if (c.unique && !(c.pk && pks.length === 1)) parts.push("UNIQUE");
    if (c.default.trim()) parts.push(`DEFAULT ${defaultSql(c.default)}`);
    return `    ${parts.join(" ")}`;
  });
  if (pks.length > 1) lines.push(`    PRIMARY KEY (${pks.map((c) => quoteId(c.name.trim())).join(", ")})`);
  return `CREATE TABLE ${quoteId(table.trim())} (\n${lines.join(",\n")}\n);`;
}
