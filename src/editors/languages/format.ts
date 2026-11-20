import { backend } from "../../lib/backend";
import type { LanguageId } from ".";
import { FormatError, formatIni, formatJson, formatMarkdown, formatYaml, tidyWhitespace } from "./formatters";

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
    case "ini":
      return formatIni(text);
    case "shell":
      return external("shfmt", text, 2);
    case "perl":
      return external("perltidy", text, 4);
    case "powershell":
      return external("pwsh", text, 4);
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
