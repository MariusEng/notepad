/** Pure, in-process formatters (no Tauri dependencies, so they can be tested with plain Node). */

export class FormatError extends Error {}

export function formatJson(text: string, indent = 2): string {
  if (!text.trim()) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, indent) + "\n";
  } catch (e) {
    // Turn "at position 123" into a line/column the user can find.
    const m = /position (\d+)/.exec(String(e));
    if (m) {
      const before = text.slice(0, Number(m[1]));
      const line = before.split("\n").length;
      const col = Number(m[1]) - before.lastIndexOf("\n");
      throw new FormatError(`Invalid JSON at line ${line}, column ${col}`);
    }
    const msg = (e as Error).message;
    const lc = /line (\d+) column (\d+)/.exec(msg);
    if (lc) throw new FormatError(`Invalid JSON at line ${lc[1]}, column ${lc[2]}`);
    // V8 appends the whole document in quotes; keep only the description.
    throw new FormatError(`Invalid JSON: ${msg.split(', "')[0]}`);
  }
}

async function prettierFormat(text: string, parser: "yaml" | "markdown"): Promise<string> {
  const prettier = await import("prettier/standalone");
  const plugin = parser === "yaml" ? await import("prettier/plugins/yaml") : await import("prettier/plugins/markdown");
  try {
    return await prettier.format(text, { parser, plugins: [plugin], proseWrap: "preserve" });
  } catch (e) {
    throw new FormatError(String((e as Error).message).split("\n")[0]);
  }
}

export const formatYaml = (text: string) => prettierFormat(text, "yaml");
export const formatMarkdown = (text: string) => prettierFormat(text, "markdown");

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
