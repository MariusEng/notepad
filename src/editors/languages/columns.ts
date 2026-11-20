import { EditorSelection, Facet, RangeSetBuilder, type Extension, type SelectionRange, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * Column colouring for CSV and log files: every field gets the colour of its column, so values that belong
 * together line up by colour even when they don't line up by position.
 *
 * Only the lines on screen are decorated (no parser, nothing proportional to the file size), so it costs the
 * same for a 1 KB file and a 300 MB one. A quoted CSV field that spans several lines is coloured per line.
 */

const COLOURS = 8;
const colMark = Array.from({ length: COLOURS }, (_, i) => Decoration.mark({ class: `cm-col cm-col-${i}` }));
const sepMark = Decoration.mark({ class: "cm-col-sep" });
const headLine = Decoration.line({ class: "cm-col-head" });
const errorLine = Decoration.line({ class: "cm-log-error-line" });
const warnLine = Decoration.line({ class: "cm-log-warn-line" });
const levelMark = {
  error: Decoration.mark({ class: "cm-log-level cm-log-error" }),
  warn: Decoration.mark({ class: "cm-log-level cm-log-warn" }),
  info: Decoration.mark({ class: "cm-log-level cm-log-info" }),
  debug: Decoration.mark({ class: "cm-log-level cm-log-debug" }),
};

/** Very long lines are only coloured at the start, so one huge line can't stall the editor. */
const MAX_SCAN = 4000;

function sampleLines(doc: string, max = 400): string[] {
  const out: string[] = [];
  let at = 0;
  while (out.length < max && at < doc.length) {
    let end = doc.indexOf("\n", at);
    if (end < 0) end = doc.length;
    if (end > at) out.push(doc.slice(at, Math.min(end, at + MAX_SCAN)));
    at = end + 1;
  }
  return out;
}

// ---------------------------------------------------------------- CSV

/** Positions of the delimiters in a line (outside "quoted" fields). */
function splitPoints(line: string, delim: string): number[] {
  const out: number[] = [];
  let quoted = false;
  const n = Math.min(line.length, MAX_SCAN);
  for (let i = 0; i < n; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === delim && !quoted) out.push(i);
  }
  return out;
}

/** The delimiter that splits the sample into the same number of columns most consistently. */
export function detectDelimiter(doc: string): string {
  const lines = sampleLines(doc, 100);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => splitPoints(l, d).length);
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 0;
    let modeN = 0;
    for (const [c, n] of freq) if (n > modeN || (n === modeN && c > mode)) [mode, modeN] = [c, n];
    // Consistency first, then more columns.
    const score = modeN * 1000 + mode;
    if (modeN > 0 && score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

function csvDecorations(view: EditorView, delim: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      if (line.number === 1 && doc.lines > 1) b.add(line.from, line.from, headLine);
      const cuts = splitPoints(line.text, delim);
      let start = 0;
      cuts.forEach((cut, i) => {
        if (cut > start) b.add(line.from + start, line.from + cut, colMark[i % COLOURS]);
        b.add(line.from + cut, line.from + cut + 1, sepMark);
        start = cut + 1;
      });
      const end = Math.min(line.length, MAX_SCAN);
      if (end > start) b.add(line.from + start, line.from + end, colMark[cuts.length % COLOURS]);
      pos = line.to + 1;
    }
  }
  return b.finish();
}

// ---------------------------------------------------------------- logs

/** A field: [bracketed], "quoted", or a run of non-spaces. */
const FIELD = /\[[^\]]*\]|"[^"]*"|\S+/g;
const LEVEL = /^[[(<]?(FATAL|CRIT(ICAL)?|ERR(OR)?|SEVERE|WARN(ING)?|INFO|NOTICE|DEBUG|TRACE|VERBOSE|[EWIDTF])[\])>:]?$/i;

function levelOf(token: string): keyof typeof levelMark | null {
  const m = LEVEL.exec(token);
  if (!m) return null;
  const w = m[1].toUpperCase();
  // Single letters (Android style "E/Tag") only count in upper case.
  if (w.length === 1 && m[1] !== w) return null;
  if (/^(FATAL|CRIT|CRITICAL|ERR|ERROR|SEVERE|E|F)$/.test(w)) return "error";
  if (/^(WARN|WARNING|W)$/.test(w)) return "warn";
  if (/^(INFO|NOTICE|I)$/.test(w)) return "info";
  return "debug";
}

/** "2024-01-02T10:00:00.123Z" → "9-9-9A9:9:9.9A": what a field looks like, for spotting columns. */
function shape(token: string): string {
  if (token.startsWith("[")) return "[]";
  if (token.startsWith('"')) return '""';
  if (levelOf(token)) return "LEVEL";
  return token.replace(/[0-9]+/g, "9").replace(/[A-Z]+/g, "A").replace(/[a-z]+/g, "a");
}

/**
 * How many leading fields of a log line are columns (timestamp, level, [thread], logger…) rather than the
 * free-text message: a field position is a column while most lines have the same kind of value in it.
 */
export function detectLogColumns(doc: string): number {
  const lines = sampleLines(doc).filter((l) => !/^\s/.test(l)); // skip stack-trace continuation lines
  if (lines.length < 3) return 0;
  const fields = lines.map((l) => l.match(FIELD) ?? []);
  const isColumn = (i: number) => {
    const shapes = new Map<string, number>();
    const values = new Set<string>();
    let have = 0;
    for (const f of fields) {
      if (f.length <= i + 1) continue; // the last field is part of the message
      have++;
      values.add(f[i]);
      const s = shape(f[i]);
      shapes.set(s, (shapes.get(s) ?? 0) + 1);
    }
    if (have < lines.length * 0.6) return false;
    const [topShape, top] = [...shapes].sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    if (top < have * 0.7) return false;
    // Plain words ("Started", "user") are only a column when few values repeat (host names, components),
    // otherwise they are the message.
    if (/^(A|a|Aa)[.,:;!?]?$/.test(topShape) && values.size > Math.max(2, have * 0.2)) return false;
    return true;
  };
  // One irregular field between columns is allowed ("-" or a user name in access logs); two in a row is
  // where the message starts.
  let cols = 0;
  let misses = 0;
  for (let i = 0; i < 10 && misses < 2; i++) {
    if (isColumn(i)) {
      cols = i + 1;
      misses = 0;
    } else misses++;
  }
  return cols;
}

function logDecorations(view: EditorView, cols: number): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc: Text = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      const text = line.text.slice(0, MAX_SCAN);
      if (!text || /^\s/.test(text)) continue;
      FIELD.lastIndex = 0;
      const marks: [number, number, Decoration][] = [];
      let level: keyof typeof levelMark | null = null;
      // Look a little past the columns for the level: some formats put it after the logger name.
      for (let i = 0, m: RegExpExecArray | null; i < Math.max(cols, 1) + 2 && (m = FIELD.exec(text)); i++) {
        const lv: keyof typeof levelMark | null = !level && i < cols + 2 ? levelOf(m[0]) : null;
        if (lv) {
          level = lv;
          marks.push([m.index, m.index + m[0].length, levelMark[lv]]);
        } else if (i < cols) marks.push([m.index, m.index + m[0].length, colMark[i % COLOURS]]);
      }
      if (level === "error") b.add(line.from, line.from, errorLine);
      else if (level === "warn") b.add(line.from, line.from, warnLine);
      for (const [a, z, d] of marks) b.add(line.from + a, line.from + z, d);
    }
  }
  return b.finish();
}

// ---------------------------------------------------------------- plugins

function columnPlugin(build: (view: EditorView) => DecorationSet): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export const csvColumns = (doc: string): Extension => {
  const delim = detectDelimiter(doc);
  return [columnPlugin((view) => csvDecorations(view, delim)), columnInfo.of({ kind: "csv", delim })];
};

export const logColumns = (doc: string): Extension => {
  const cols = detectLogColumns(doc);
  return [columnPlugin((view) => logDecorations(view, cols)), columnInfo.of({ kind: "log", cols })];
};

// ---------------------------------------------------------------- selecting columns

type ColumnInfo = { kind: "csv"; delim: string } | { kind: "log"; cols: number };

/** How the open document is split into columns (only CSV and log editors have this). */
export const columnInfo = Facet.define<ColumnInfo, ColumnInfo | null>({ combine: (v) => v[0] ?? null });

/** Field i of a line as [start, end) offsets, for every field; null for lines without columns. */
function fieldsOf(text: string, info: ColumnInfo): [number, number][] | null {
  if (info.kind === "csv") {
    const out: [number, number][] = [];
    let start = 0;
    for (const cut of splitPoints(text, info.delim)) {
      out.push([start, cut]);
      start = cut + 1;
    }
    out.push([start, text.length]);
    return out;
  }
  // Logs: the detected columns, then the message as one last column. Continuation lines have none.
  if (!text || /^\s/.test(text) || info.cols === 0) return null;
  const out: [number, number][] = [];
  FIELD.lastIndex = 0;
  for (let m: RegExpExecArray | null; out.length < info.cols && (m = FIELD.exec(text)); ) out.push([m.index, m.index + m[0].length]);
  if (out.length < info.cols) return out;
  const rest = /\S/.exec(text.slice(out[out.length - 1][1]));
  if (rest) out.push([out[out.length - 1][1] + rest.index, text.length]);
  return out;
}

/** The column an offset in a line belongs to (a delimiter belongs to the column before it). */
function fieldAt(fields: [number, number][], offset: number): number {
  let i = 0;
  while (i < fields.length - 1 && offset > fields[i][1]) i++;
  return i;
}

const MAX_COLUMN_LINES = 200_000;

/**
 * Selects whole columns (Ctrl+Space, like Excel): the columns the selection touches, on every line; or only on
 * the selected lines when the selection covers several lines (part of a column). Returns false when the
 * document has no columns. Each line gets its own selection range, so typing, copying and pasting work per line.
 */
export function selectColumn(view: EditorView, at?: number): boolean | "too-many" {
  const info = view.state.facet(columnInfo);
  if (!info) return false;
  const { state } = view;
  const doc = state.doc;
  const sel = state.selection;
  const ranges: readonly SelectionRange[] = at === undefined ? sel.ranges : [EditorSelection.cursor(at)];
  const first = doc.lineAt(Math.min(...ranges.map((r) => r.from)));
  const last = doc.lineAt(Math.max(...ranges.map((r) => r.to)));

  // Which columns: from the column at the start of the selection to the one at its end.
  let lo = Infinity;
  let hi = -1;
  for (const r of ranges) {
    for (const pos of [r.from, r.to]) {
      const line = doc.lineAt(pos);
      const f = fieldsOf(line.text, info);
      if (!f?.length) continue;
      const i = fieldAt(f, pos - line.from);
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
    }
  }
  if (hi < 0) return false;

  // Which lines: all of them, unless the selection already covers several.
  const [top, bottom] = first.number === last.number ? [1, doc.lines] : [first.number, last.number];
  if (bottom - top + 1 > MAX_COLUMN_LINES) return "too-many";
  const out: SelectionRange[] = [];
  let mainIndex = 0;
  for (let n = top; n <= bottom; n++) {
    const line = doc.line(n);
    const f = fieldsOf(line.text, info);
    if (!f || f.length <= lo) continue;
    const a = f[lo];
    const z = f[Math.min(hi, f.length - 1)];
    if (n === doc.lineAt(sel.main.head).number) mainIndex = out.length;
    out.push(EditorSelection.range(line.from + a[0], line.from + z[1]));
  }
  if (!out.length) return false;
  view.dispatch({ selection: EditorSelection.create(out, mainIndex), userEvent: "select.column", scrollIntoView: true });
  return true;
}
