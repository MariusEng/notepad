import { backend } from "../../lib/backend";
import type { LanguageId } from ".";
import { FormatError, formatIni, formatSql, formatJson, formatMarkdown, formatYaml, formatJavaScript, formatHtml, formatXml, tidyWhitespace } from "./formatters";

export { FormatError };

/** Formats a document. External tools (shfmt, perltidy, pwsh) are used when installed. */
export async function formatText(language: LanguageId, text: string): Promise<string> {
  switch (language) {
    case "json":
      return formatJson(text);
    case "yaml":
      return formatYaml(text);
    case "markdown":
      return formatMarkdown(text);
    case "javascript":
      return formatJavaScript(text);
    case "html":
      return formatHtml(text);
    case "xml":
      return formatXml(text);
    case "ini":
      return formatIni(text);
    case "shell":
      return external("shfmt", text, 2);
    case "perl":
      return external("perltidy", text, 4);
    case "powershell":
      return external("pwsh", text, 4);
    case "sql":
      return formatSql(text, "sql");
    case "pgsql":
      return formatSql(text, "postgresql");
    case "tsql":
      return formatSql(text, "transactsql");
    case "csv":
    case "log":
      throw new FormatError(`${language === "csv" ? "CSV" : "Log"} files are left as they are`);
    case "batch":
    case "plaintext":
      return tidyWhitespace(text);
  }
}

async function external(tool: "shfmt" | "perltidy" | "pwsh", text: string, indent: number) {
  try {
    return await backend.formatExternal(tool, text, indent);
  } catch (e) {
    throw new FormatError(String(e));
  }
}
