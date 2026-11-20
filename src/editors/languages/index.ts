import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";

export type LanguageId =
  | "markdown"
  | "html"
  | "javascript"
  | "plaintext"
  | "log"
  | "csv"
  | "powershell"
  | "perl"
  | "shell"
  | "batch"
  | "ini"
  | "yaml"
  | "json"
  | "sql"
  | "pgsql"
  | "tsql";

export interface LanguageInfo {
  id: LanguageId;
  label: string;
  /** Extensions (lower case, no dot); the first is used for Save As. */
  extensions: string[];
  /** Soft-wrap long lines (prose) instead of scrolling horizontally (code). */
  wrap: boolean;
  /** The editor extension; `doc` is the text it opens with (CSV and logs look at it to find their columns). */
  load: (doc: string) => Promise<Extension>;
}

const legacy = async <T>(p: Promise<T>, pick: (m: T) => any) => StreamLanguage.define(pick(await p));

export const LANGUAGES: Record<LanguageId, LanguageInfo> = {
  markdown: {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    wrap: true,
    load: async () => (await import("@codemirror/lang-markdown")).markdown(),
  },
  html: {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm", "xhtml"],
    wrap: false,
    load: async () => (await import("@codemirror/lang-html")).html(),
  },
  javascript: {
    id: "javascript",
    label: "JavaScript",
    extensions: ["js", "mjs", "cjs", "jsx"],
    wrap: false,
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  },
  plaintext: {
    id: "plaintext",
    label: "Plain Text",
    extensions: ["txt", "text"],
    wrap: true,
    load: async () => [],
  },
  log: {
    id: "log",
    label: "Log",
    extensions: ["log", "out", "err"],
    wrap: false,
    load: async (doc) => (await import("./columns")).logColumns(doc),
  },
  csv: {
    id: "csv",
    label: "CSV / TSV",
    extensions: ["csv", "tsv", "tab", "psv"],
    wrap: false,
    load: async (doc) => (await import("./columns")).csvColumns(doc),
  },
  powershell: {
    id: "powershell",
    label: "PowerShell",
    extensions: ["ps1", "psm1", "psd1"],
    wrap: false,
    load: () => legacy(import("@codemirror/legacy-modes/mode/powershell"), (m) => m.powerShell),
  },
  perl: {
    id: "perl",
    label: "Perl",
    extensions: ["pl", "pm", "t"],
    wrap: false,
    load: () => legacy(import("@codemirror/legacy-modes/mode/perl"), (m) => m.perl),
  },
  shell: {
    id: "shell",
    label: "Shell",
    extensions: ["sh", "bash", "zsh", "ksh"],
    wrap: false,
    load: () => legacy(import("@codemirror/legacy-modes/mode/shell"), (m) => m.shell),
  },
  batch: {
    id: "batch",
    label: "Batch (cmd/bat)",
    extensions: ["bat", "cmd"],
    wrap: false,
    load: () => legacy(import("./batch"), (m) => m.batch),
  },
  ini: {
    id: "ini",
    label: "INI",
    extensions: ["ini", "cfg", "conf", "properties", "env"],
    wrap: false,
    load: () => legacy(import("@codemirror/legacy-modes/mode/properties"), (m) => m.properties),
  },
  yaml: {
    id: "yaml",
    label: "YAML",
    extensions: ["yaml", "yml"],
    wrap: false,
    load: async () => (await import("@codemirror/lang-yaml")).yaml(),
  },
  json: {
    id: "json",
    label: "JSON",
    extensions: ["json", "jsonc", "json5"],
    wrap: false,
    load: async () => (await import("@codemirror/lang-json")).json(),
  },
  sql: {
    id: "sql",
    label: "SQL (ANSI)",
    extensions: ["sql", "ddl", "dml"],
    wrap: false,
    load: async () => {
      const m = await import("@codemirror/lang-sql");
      return m.sql({ dialect: m.StandardSQL });
    },
  },
  pgsql: {
    id: "pgsql",
    label: "PostgreSQL",
    extensions: ["pgsql", "psql", "plpgsql"],
    wrap: false,
    load: async () => {
      const m = await import("@codemirror/lang-sql");
      return m.sql({ dialect: m.PostgreSQL });
    },
  },
  tsql: {
    id: "tsql",
    label: "T-SQL (SQL Server)",
    extensions: ["tsql"],
    wrap: false,
    load: async () => {
      const m = await import("@codemirror/lang-sql");
      return m.sql({ dialect: m.MSSQL });
    },
  },
};

/** Languages with a rendered view (Markdown: formatted editor, HTML: preview) next to the source. */
export const hasRenderedView = (id: LanguageId) => id === "markdown" || id === "html";

export const LANGUAGE_LIST = Object.values(LANGUAGES);

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * ".sql" says nothing about the dialect, so look for tell-tale syntax: T-SQL has GO batch
 * separators, @variables, [bracketed] identifiers and N'' strings; PostgreSQL has $$ bodies, ::
 * casts, RETURNING and psql meta-commands. Anything else is treated as ANSI SQL.
 */
export function sniffSql(content: string): LanguageId {
  const text = content.slice(0, 20000);
  const tsql = [
    /^\s*go\s*$/im,
    /\bset\s+nocount\b/i,
    /\bbegin\s+(try|catch)\b/i,
    /(^|[\s,(])@@?[a-z_]\w*/i,
    /\[[A-Za-z_][\w ]*\]\s*[.,)=]|\b(from|join|table|into)\s+\[/i,
    /\bn'/i,
    /\b(nvarchar|uniqueidentifier|datetime2|getdate\(\)|isnull\(|top\s*\(?\d+)/i,
    /\bexec(ute)?\s+(sp_|xp_|dbo\.)/i,
  ].filter((r) => r.test(text)).length;
  const pg = [
    /\$\w*\$/,
    /::\s*[a-z_]+/i,
    /\breturning\b/i,
    /\blanguage\s+plpgsql\b/i,
    /^\s*\\[a-z]+/im,
    /\b(ilike|serial|bigserial|jsonb|bytea|tsvector)\b/i,
    /\bcreate\s+(extension|or\s+replace\s+function)\b/i,
    /\b(on\s+conflict|generate_series|now\(\))/i,
  ].filter((r) => r.test(text)).length;
  if (tsql > pg && tsql >= 2) return "tsql";
  if (pg > tsql && pg >= 1) return "pgsql";
  return "sql";
}

/** Picks a language from the file extension, then from a shebang line. */
export function detectLanguage(path: string, content = ""): LanguageId {
  const name = fileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    for (const lang of LANGUAGE_LIST) {
      if (!lang.extensions.includes(ext)) continue;
      return lang.id === "sql" && ext === "sql" ? sniffSql(content) : lang.id;
    }
  }
  if (name === ".env" || name.startsWith(".env.")) return "ini";
  if (/\.log\.\d+$|\.log\.\d{4}-\d\d-\d\d$|\.log\.(old|bak|gz\.txt)$/.test(name)) return "log"; // rotated logs
  if (name === ".bashrc" || name === ".zshrc" || name === ".profile" || name === ".bash_profile") return "shell";
  const first = content.slice(0, 200).split("\n", 1)[0];
  if (first.startsWith("#!")) {
    if (/\b(ba|z|k|da)?sh\b/.test(first)) return "shell";
    if (/\bperl\b/.test(first)) return "perl";
    if (/\bpwsh\b|powershell/i.test(first)) return "powershell";
    if (/\b(node|deno|bun)\b/.test(first)) return "javascript";
  }
  return "plaintext";
}
