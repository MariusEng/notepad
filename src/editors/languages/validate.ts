/**
 * Syntax checks for JSON and XML, as pure functions (no DOM, no Tauri) so they behave the same on every platform
 * and can be tested in Node. Each reports the first error with its exact position, plus warnings found before it.
 * The JSON checker can also build the document's tree (for the tree view), keeping key order, duplicate keys and
 * numbers exactly as written.
 */

export interface Problem {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
}

/** 1-based line and column of an offset. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}

// ---------------------------------------------------------------- JSON

export type JsonValue =
  | { type: "object"; entries: [string, JsonValue][] }
  | { type: "array"; items: JsonValue[] }
  | { type: "string"; value: string }
  | { type: "number"; raw: string }
  | { type: "boolean"; value: boolean }
  | { type: "null" };

class Stop extends Error {}

const MAX_DEPTH = 2000;

/**
 * Checks JSON. Comments and trailing commas (JSONC, e.g. tsconfig.json) are warnings, not errors.
 * With `build`, also returns the parsed tree (null when there is an error).
 */
export function checkJson(text: string, build = false): { problems: Problem[]; value: JsonValue | null } {
  const problems: Problem[] = [];
  let i = 0;
  const n = text.length;

  const fail = (from: number, message: string, to = from + 1): never => {
    problems.push({ from, to: Math.min(Math.max(to, from + 1), Math.max(n, from + 1)), severity: "error", message });
    throw new Stop();
  };
  const warn = (from: number, to: number, message: string) => problems.push({ from, to, severity: "warning", message });

  const ws = () => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else if (c === 47 && text.charCodeAt(i + 1) === 47) {
        const s = i;
        while (i < n && text.charCodeAt(i) !== 10) i++;
        warn(s, i, "Comments aren't allowed in standard JSON");
      } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
        const s = i;
        const end = text.indexOf("*/", i + 2);
        if (end < 0) fail(s, "This comment is never closed (*/ missing)", s + 2);
        i = end + 2;
        warn(s, i, "Comments aren't allowed in standard JSON");
      } else if (c === 0xfeff && i === 0) i++;
      else return;
    }
  };

  const describe = (pos: number) => {
    if (pos >= n) return "the end of the file";
    const ch = text[pos];
    return ch === "\n" ? "a line break" : `"${ch}"`;
  };

  const string = (): string => {
    const start = i;
    i++; // opening quote
    let out = "";
    let chunk = i;
    for (;;) {
      if (i >= n) fail(start, "This string is never closed (\" missing)", i);
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (build) out += text.slice(chunk, i);
        i++;
        return out;
      }
      if (c === 92) {
        if (build) out += text.slice(chunk, i);
        const e = text[i + 1];
        if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(i, "\\u must be followed by four hex digits", i + 6);
          if (build) out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          const map: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (e === undefined || !(e in map)) fail(i, `"\\${e ?? ""}" isn't a valid escape`, i + 2);
          if (build) out += map[e];
          i += 2;
        }
        chunk = i;
        continue;
      }
      if (c < 32) fail(i, c === 10 ? "Line breaks inside a string must be written as \\n" : "Control characters inside a string must be escaped");
      i++;
    }
  };

  const number = (): string => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    const start = i;
    if (!m) fail(start, "Invalid number");
    i += m![0].length;
    const next = text[i];
    if (next !== undefined && /[0-9.eE]/.test(next)) {
      fail(start, /^-?0\d/.test(text.slice(start, i + 1)) ? "Numbers can't start with 0" : "Invalid number", i + 1);
    }
    return m![0];
  };

  const value = (depth: number): JsonValue | null => {
    if (depth > MAX_DEPTH) fail(i, "Nested too deeply to check");
    ws();
    const c = text[i];
    if (c === "{") {
      const open = i;
      i++;
      const entries: [string, JsonValue][] = [];
      const seen = new Set<string>();
      ws();
      if (text[i] === "}") {
        i++;
        return build ? { type: "object", entries } : null;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') {
          if (text[i] === "}" ) fail(i, "Expected a property name");
          fail(i, text[i] === "'" ? "Property names need double quotes" : `Expected a property name in double quotes, found ${describe(i)}`);
        }
        const keyStart = i;
        const key = string();
        const raw = text.slice(keyStart + 1, i - 1);
        if (seen.has(raw)) warn(keyStart, i, `Duplicate key "${raw.length > 40 ? raw.slice(0, 40) + "…" : raw}"`);
        seen.add(raw);
        ws();
        if (text[i] !== ":") fail(i, `Expected ":" after the property name, found ${describe(i)}`);
        i++;
        const v = value(depth + 1);
        if (build) entries.push([key, v!]);
        ws();
        if (text[i] === ",") {
          const comma = i;
          i++;
          ws();
          if (text[i] === "}") {
            warn(comma, comma + 1, "Trailing commas aren't allowed in standard JSON");
            i++;
            return build ? { type: "object", entries } : null;
          }
          continue;
        }
        if (text[i] === "}") {
          i++;
          return build ? { type: "object", entries } : null;
        }
        if (i >= n) fail(open, "This { is never closed (} missing)", open + 1);
        fail(i, `Expected "," or "}", found ${describe(i)}`);
      }
    }
    if (c === "[") {
      const open = i;
      i++;
      const items: JsonValue[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return build ? { type: "array", items } : null;
      }
      for (;;) {
        const v = value(depth + 1);
        if (build) items.push(v!);
        ws();
        if (text[i] === ",") {
          const comma = i;
          i++;
          ws();
          if (text[i] === "]") {
            warn(comma, comma + 1, "Trailing commas aren't allowed in standard JSON");
            i++;
            return build ? { type: "array", items } : null;
          }
          continue;
        }
        if (text[i] === "]") {
          i++;
          return build ? { type: "array", items } : null;
        }
        if (i >= n) fail(open, "This [ is never closed (] missing)", open + 1);
        fail(i, `Expected "," or "]", found ${describe(i)}`);
      }
    }
    if (c === '"') {
      const s = string();
      return build ? { type: "string", value: s } : null;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const raw = number();
      return build ? { type: "number", raw } : null;
    }
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return build ? (v === null ? { type: "null" } : { type: "boolean", value: v }) : null;
      }
    }
    if (c === "'") fail(i, "Strings need double quotes");
    if (/^(NaN|Infinity|-Infinity|undefined)\b/.test(text.slice(i, i + 10))) fail(i, "NaN, Infinity and undefined aren't JSON values", i + 3);
    if (i >= n) fail(Math.max(0, n - 1), "Expected a value, found the end of the file");
    fail(i, `Expected a value, found ${describe(i)}`);
    return null;
  };

  try {
    ws();
    if (i >= n) return { problems, value: null }; // empty file: nothing to say
    const v = value(0);
    ws();
    if (i < n) fail(i, "Unexpected text after the end of the JSON value", n);
    return { problems, value: build ? v : null };
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    return { problems, value: null };
  }
}

export const validateJson = (text: string) => checkJson(text).problems;

// ---------------------------------------------------------------- XML

const NAME_START = /[A-Za-z_:\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
const NAME_CHAR = /[-.0-9\u00B7\u0300-\u036F\u203F-\u2040A-Za-z_:\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
const PREDEFINED = new Set(["lt", "gt", "amp", "apos", "quot"]);

/** Checks that XML is well-formed (tags match and nest, attributes are quoted, entities are known…). */
export function validateXml(text: string): Problem[] {
  const problems: Problem[] = [];
  const n = text.length;
  let i = 0;
  const stack: { name: string; from: number }[] = [];
  let rootSeen = false;
  let rootClosed = false;
  let doctype = false; // a DOCTYPE may declare its own entities
  const at = (pos: number) => {
    const { line } = lineCol(text, pos);
    return `line ${line}`;
  };

  const fail = (from: number, message: string, to = from + 1): never => {
    problems.push({ from, to: Math.min(Math.max(to, from + 1), Math.max(n, from + 1)), severity: "error", message });
    throw new Stop();
  };

  const isWs = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const skipWs = () => {
    while (isWs(text[i])) i++;
  };

  const name = (what: string): string => {
    const start = i;
    if (!NAME_START.test(text[i] ?? "")) fail(i, `Expected ${what}, found ${text[i] === undefined ? "the end of the file" : `"${text[i]}"`}`);
    i++;
    while (i < n && NAME_CHAR.test(text[i])) i++;
    return text.slice(start, i);
  };

  /** Checks & references in text or an attribute value between `from` and `to`. */
  const references = (from: number, to: number) => {
    // Search only this piece: indexOf on the whole text would scan to the end every time (quadratic).
    const piece = text.slice(from, to);
    let a = piece.indexOf("&");
    while (a >= 0) {
      const semi = piece.indexOf(";", a);
      const ref = semi > a ? piece.slice(a + 1, semi) : null;
      if (ref === null || !/^(#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z_:][-.\w:]*)$/.test(ref)) {
        fail(from + a, "A bare & must be written as &amp;");
      }
      if (!ref!.startsWith("#") && !PREDEFINED.has(ref!) && !doctype) {
        fail(from + a, `Unknown entity &${ref};`, from + semi + 1);
      }
      a = piece.indexOf("&", semi);
    }
  };

  try {
    if (text.charCodeAt(0) === 0xfeff) i = 1;
    while (i < n) {
      const lt = text.indexOf("<", i);
      const textEnd = lt < 0 ? n : lt;
      if (textEnd > i) {
        const chunk = text.slice(i, textEnd);
        if (stack.length === 0 && chunk.trim()) {
          const off = i + chunk.search(/\S/);
          fail(off, rootClosed ? "Text after the end of the root element" : "Text before the root element");
        }
        references(i, textEnd);
        const cdataEnd = chunk.indexOf("]]>");
        if (cdataEnd >= 0) fail(i + cdataEnd, '"]]>" isn\'t allowed in text', i + cdataEnd + 3);
      }
      if (lt < 0) break;
      i = lt;
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        if (end < 0) fail(i, "This comment is never closed (--> missing)", i + 4);
        const dash = text.indexOf("--", i + 4);
        if (dash < end) fail(dash, '"--" isn\'t allowed inside a comment', dash + 2);
        i = end + 3;
      } else if (text.startsWith("<![CDATA[", i)) {
        if (stack.length === 0) fail(i, "CDATA sections must be inside the root element", i + 9);
        const end = text.indexOf("]]>", i + 9);
        if (end < 0) fail(i, "This CDATA section is never closed (]]> missing)", i + 9);
        i = end + 3;
      } else if (text.startsWith("<!DOCTYPE", i)) {
        if (rootSeen) fail(i, "DOCTYPE must come before the root element", i + 9);
        doctype = true;
        let depth = 0;
        let j = i + 9;
        let quote = "";
        for (; j < n; j++) {
          const ch = text[j];
          if (quote) {
            if (ch === quote) quote = "";
          } else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === "[") depth++;
          else if (ch === "]") depth--;
          else if (ch === ">" && depth <= 0) break;
        }
        if (j >= n) fail(i, "This DOCTYPE is never closed (> missing)", i + 9);
        i = j + 1;
      } else if (text.startsWith("<?", i)) {
        const end = text.indexOf("?>", i + 2);
        if (end < 0) fail(i, "This processing instruction is never closed (?> missing)", i + 2);
        const target = /^[^\s?]+/.exec(text.slice(i + 2, end))?.[0] ?? "";
        if (!target) fail(i, "Expected a name after <?", i + 2);
        const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
        if (target.toLowerCase() === "xml" && i !== start) {
          fail(i, "The XML declaration (<?xml …?>) must be at the very start of the file", end + 2);
        }
        i = end + 2;
      } else if (text.startsWith("</", i)) {
        const open = i;
        i += 2;
        const nm = name("a tag name after </");
        skipWs();
        if (text[i] !== ">") fail(i, `Expected ">" to end </${nm}>`);
        i++;
        const top = stack.pop();
        if (!top) fail(open, `</${nm}> has no matching opening tag`, i);
        if (top!.name !== nm) {
          fail(open, `Expected </${top!.name}> (opened on ${at(top!.from)}), found </${nm}>`, i);
        }
        if (stack.length === 0) rootClosed = true;
      } else {
        const open = i;
        i++;
        if (rootClosed && stack.length === 0) fail(open, "Only one root element is allowed");
        const nm = name("a tag name after <");
        const attrs = new Set<string>();
        for (;;) {
          const hadSpace = isWs(text[i]);
          skipWs();
          if (text.startsWith("/>", i)) {
            i += 2;
            rootSeen = true;
            if (stack.length === 0) rootClosed = true;
            break;
          }
          if (text[i] === ">") {
            i++;
            rootSeen = true;
            stack.push({ name: nm, from: open });
            break;
          }
          if (i >= n) fail(open, `<${nm}> is never finished (> missing)`, open + 1 + nm.length);
          if (!hadSpace) fail(i, "Expected a space before the next attribute");
          const attrStart = i;
          const an = name("an attribute name or >");
          if (attrs.has(an)) fail(attrStart, `Duplicate attribute ${an}`, i);
          attrs.add(an);
          skipWs();
          if (text[i] !== "=") fail(i, `Attribute ${an} needs a value (${an}="…")`);
          i++;
          skipWs();
          const q = text[i];
          if (q !== '"' && q !== "'") fail(i, `The value of ${an} must be in quotes`);
          const end = text.indexOf(q, i + 1);
          if (end < 0) fail(i, `The value of ${an} is never closed (${q} missing)`);
          const lt2 = text.indexOf("<", i + 1);
          if (lt2 >= 0 && lt2 < end) fail(lt2, `"<" isn't allowed in an attribute value (write &lt;)`);
          references(i + 1, end);
          i = end + 1;
        }
      }
    }
    if (stack.length) {
      const top = stack[stack.length - 1];
      fail(top.from, `<${top.name}> (${at(top.from)}) is never closed`, top.from + 1 + top.name.length);
    }
    if (!rootSeen && text.trim()) fail(0, "No root element");
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  return problems;
}
