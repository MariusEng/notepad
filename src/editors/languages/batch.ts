import type { StreamParser } from "@codemirror/language";

/** Highlighting for Windows batch files (.bat / .cmd). CodeMirror ships no mode for these. */
const KEYWORDS = new Set(
  (
    "if else for do in goto call exit not exist defined errorlevel cmdextversion equ neq lss leq gtr geq " +
    "set setlocal endlocal enabledelayedexpansion disabledelayedexpansion enableextensions shift"
  ).split(" "),
);
const BUILTINS = new Set(
  (
    "echo cd chdir pushd popd md mkdir rd rmdir del erase copy xcopy robocopy move ren rename type dir cls pause " +
    "title start choice timeout where findstr find sort more color mode path prompt ver vol assoc ftype attrib " +
    "tasklist taskkill net reg sc powershell cmd wmic icacls mklink"
  ).split(" "),
);

interface State {
  lineStart: boolean;
  inString: boolean;
}

export const batch: StreamParser<State> = {
  name: "batch",
  startState: () => ({ lineStart: true, inString: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.lineStart = true;
      state.inString = false;
    }
    if (stream.eatSpace()) return null;

    if (state.inString) {
      if (stream.skipTo('"')) {
        stream.next();
        state.inString = false;
      } else stream.skipToEnd();
      return "string";
    }

    const atStart = state.lineStart;
    state.lineStart = false;

    if (atStart) {
      if (stream.match("::") || stream.match(/^rem(\s|$)/i)) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^:[\w.-]+/)) return "labelName";
      if (stream.eat("@")) {
        state.lineStart = true; // "@echo off" — the command follows
        return "meta";
      }
    }

    // Variables: %VAR%, %~dp0, %1, %%i, !VAR!
    if (stream.match(/^%%~?[a-z]/i) || stream.match(/^%~[a-z]*\d/i) || stream.match(/^%\d/) || stream.match(/^%[^%\s]+%/) || stream.match(/^![^!\s]+!/))
      return "variableName";

    if (stream.eat('"')) {
      state.inString = true;
      if (stream.skipTo('"')) {
        stream.next();
        state.inString = false;
      } else stream.skipToEnd();
      return "string";
    }

    if (stream.match(/^(&&|\|\||>>|2>&1|[<>|&()])/)) {
      if (stream.current() === "&" || stream.current() === "&&" || stream.current() === "||" || stream.current() === "(")
        state.lineStart = true; // a new command follows
      return "operator";
    }
    if (stream.match(/^-?\d+\b/)) return "number";

    if (stream.match(/^[\w.-]+/)) {
      const w = stream.current().toLowerCase();
      if (KEYWORDS.has(w)) return "keyword";
      if (BUILTINS.has(w)) return "builtin";
      if (w === "goto" || w === "call") return "keyword";
      return null;
    }
    if (stream.match(/^:[\w.-]+/)) return "labelName"; // goto :label
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "REM" } },
};
