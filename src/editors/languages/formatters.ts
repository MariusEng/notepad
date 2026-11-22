/** Pure, in-process formatters (no Tauri dependencies, so they can be tested with plain Node). */

import { checkJson, lineCol, validateXml, type JsonValue, type Problem } from "./validate";

export class FormatError extends Error {}

/** "Invalid XML at line 3, column 5: …" from the first error a checker found. */
function firstError(kind: string, text: string, problems: Problem[]): FormatError | null {
  const p = problems.find((x) => x.severity === "error");
  if (!p) return null;
  const { line, col } = lineCol(text, p.from);
  return new FormatError(`Invalid ${kind} at line ${line}, column ${col}: ${p.message}`);
}

/** Prints a parsed JSON tree; numbers keep their exact text, keys their order (and duplicates). */
function printJson(v: JsonValue, indent: string, depth = 0): string {
  const pad = indent.repeat(depth + 1);
  const close = indent.repeat(depth);
  switch (v.type) {
    case "object":
      if (!v.entries.length) return "{}";
      return `{\n${v.entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${printJson(x, indent, depth + 1)}`).join(",\n")}\n${close}}`;
    case "array":
      if (!v.items.length) return "[]";
      return `[\n${v.items.map((x) => pad + printJson(x, indent, depth + 1)).join(",\n")}\n${close}]`;
    case "string":
      return JSON.stringify(v.value);
    case "number":
      return v.raw;
    case "boolean":
      return String(v.value);
    case "null":
      return "null";
  }
}

/**
 * Pretty-prints JSON. Big numbers keep every digit (JSON.parse would round them) and keys keep their order.
 * JSON with comments (JSONC, e.g. tsconfig.json) goes through Prettier, which keeps the comments.
 */
export async function formatJson(text: string, indent = 2): Promise<string> {
  if (!text.trim()) return text;
  const { problems, value } = checkJson(text, true);
  const err = firstError("JSON", text, problems);
  if (err) throw err;
  if (problems.some((p) => p.message.startsWith("Comments"))) return prettierFormat(text, "jsonc");
  return printJson(value!, " ".repeat(indent)) + "\n";
}

async function prettierFormat(text: string, parser: "yaml" | "markdown" | "babel" | "html" | "xml" | "jsonc"): Promise<string> {
  const prettier = await import("prettier/standalone");
  const plugins =
    parser === "xml"
      ? [(await import("@prettier/plugin-xml")).default] // the plugin is the module's default export
      : parser === "jsonc"
      ? [await import("prettier/plugins/babel"), await import("prettier/plugins/estree")]
      : parser === "yaml"
      ? [await import("prettier/plugins/yaml")]
      : parser === "markdown"
        ? [await import("prettier/plugins/markdown")]
        : parser === "babel"
          ? [await import("prettier/plugins/babel"), await import("prettier/plugins/estree")]
          : // HTML: the others format embedded <script> and <style>.
            await Promise.all([
              import("prettier/plugins/html"),
              import("prettier/plugins/babel"),
              import("prettier/plugins/estree"),
              import("prettier/plugins/postcss"),
            ]);
  try {
    return await prettier.format(text, {
      parser,
      plugins: plugins as never,
      proseWrap: "preserve",
      // XML: "preserve" indents minified documents but leaves text content (and mixed content) as it was;
      // "ignore" would wrap short text onto lines of its own, changing the values.
      ...(parser === "xml" ? { xmlWhitespaceSensitivity: "preserve", printWidth: 120 } : {}),
    } as never);
  } catch (e) {
    throw new FormatError(String((e as Error).message).split("\n")[0]);
  }
}

export const formatYaml = (text: string) => prettierFormat(text, "yaml");
export const formatMarkdown = (text: string) => prettierFormat(text, "markdown");
export const formatJavaScript = (text: string) => prettierFormat(text, "babel");
export const formatHtml = (text: string) => prettierFormat(text, "html");
export async function formatXml(text: string): Promise<string> {
  if (!text.trim()) return text;
  const err = firstError("XML", text, validateXml(text));
  if (err) throw err;
  return prettierFormat(text, "xml");
}

/**
 * INI: trims lines, normalises "key=value" to "key = value", aligns the "=" within
 * each section, puts one blank line before each [section], and collapses blank runs.
 * Comments (; and #) are kept as they are.
 */
export function formatIni(text: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  type Row = { kind: "kv"; key: string; value: string } | { kind: "raw"; text: string };
  const sections: Row[][] = [[]];
  for (const line of lines) {
    if (/^\[.*\]$/.test(line)) {
      sections.push([{ kind: "raw", text: line }]);
      continue;
    }
    const kv = /^([^=;#][^=]*?)\s*=\s*(.*)$/.exec(line);
    sections[sections.length - 1].push(kv ? { kind: "kv", key: kv[1], value: kv[2] } : { kind: "raw", text: line });
  }
  const out: string[] = [];
  for (const rows of sections) {
    const width = Math.max(0, ...rows.map((r) => (r.kind === "kv" ? r.key.length : 0)));
    const rendered = rows.map((r) => (r.kind === "kv" ? `${r.key.padEnd(width)} = ${r.value}`.trimEnd() : r.text));
    // Trim blank lines at the edges of the section.
    while (rendered.length && rendered[rendered.length - 1] === "") rendered.pop();
    while (rendered.length && rendered[0] === "") rendered.shift();
    if (!rendered.length) continue;
    if (out.length) out.push("");
    out.push(...rendered);
  }
  return collapseBlank(out.join("\n")) + "\n";
}

function collapseBlank(text: string) {
  return text.replace(/\n{3,}/g, "\n\n");
}

/** Fallback for languages without a real formatter: trailing whitespace and final newline. */
export function tidyWhitespace(text: string): string {
  if (!text) return text;
  return text.replace(/[ \t]+$/gm, "").replace(/\n*$/, "\n");
}

/** SQL via sql-formatter. Keyword case is left as written; indentation is 4 spaces. */
export async function formatSql(text: string, language: "sql" | "postgresql" | "transactsql"): Promise<string> {
  if (!text.trim()) return text;
  const { format } = await import("sql-formatter");
  try {
    return format(text, { language, tabWidth: 4, keywordCase: "preserve", linesBetweenQueries: 1 }).replace(/\n*$/, "\n");
  } catch (e) {
    throw new FormatError(`SQL: ${String((e as Error).message).split("\n")[0]}`);
  }
}
