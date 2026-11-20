import { EditorSelection, Prec, StateEffect, StateField, countColumn, findColumn, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, rectangularSelection, crosshairCursor } from "@codemirror/view";

/**
 * Column (block / rectangular) selection.
 *
 *  - Mouse: Alt+drag (Option+drag on macOS), the convention of VS Code, Visual Studio, Notepad++ and JetBrains.
 *  - Keyboard: Shift+Alt+Arrow on Windows/Linux (Notepad++, Visual Studio), also Ctrl+Shift+Alt+Arrow (VS Code);
 *    ⇧⌥⌘+Arrow on macOS (VS Code; ⇧⌥+Arrow already selects by word/paragraph there).
 *
 * The block is kept in visual columns (tabs count to the next tab stop), so it stays a rectangle across lines
 * with tabs; lines that are too short get an empty selection at their end. Typing, deleting, copying and pasting
 * then work on every line at once (CodeMirror's multiple selections).
 */

interface Block {
  anchorLine: number;
  anchorCol: number;
  headLine: number;
  headCol: number;
}

const setBlock = StateEffect.define<Block>();

/** The block being built with the keyboard; forgotten as soon as the selection changes any other way. */
const blockField = StateField.define<Block | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setBlock)) return e.value;
    return tr.selection || tr.docChanged ? null : value;
  },
});

const colAt = (state: EditorState, pos: number) => {
  const line = state.doc.lineAt(pos);
  return { line: line.number, col: countColumn(line.text, state.tabSize, pos - line.from) };
};

/** Starts a block from the current selection (one range, or a rectangle made with Alt+drag). */
function currentBlock(state: EditorState): Block {
  const kept = state.field(blockField, false);
  if (kept) return kept;
  const { ranges, main, mainIndex } = state.selection;
  // With several ranges, the one farthest from the main range is where the block started.
  const start = ranges.length > 1 ? ranges[mainIndex === 0 ? ranges.length - 1 : 0] : main;
  const a = colAt(state, start.anchor);
  const h = colAt(state, main.head);
  return { anchorLine: a.line, anchorCol: a.col, headLine: h.line, headCol: h.col };
}

function selectBlock(view: EditorView, b: Block) {
  const { state } = view;
  const top = Math.min(b.anchorLine, b.headLine);
  const bottom = Math.max(b.anchorLine, b.headLine);
  const ranges = [];
  for (let n = top; n <= bottom; n++) {
    const line = state.doc.line(n);
    const from = line.from + findColumn(line.text, b.anchorCol, state.tabSize);
    const to = line.from + findColumn(line.text, b.headCol, state.tabSize);
    ranges.push(EditorSelection.range(from, to));
  }
  const main = b.headLine - top;
  view.dispatch({
    selection: EditorSelection.create(ranges, main),
    effects: [setBlock.of(b), EditorView.scrollIntoView(ranges[main].head)],
    userEvent: "select.block",
  });
  return true;
}

const extend = (dLine: number, dCol: number) => (view: EditorView) => {
  const b = currentBlock(view.state);
  const headLine = Math.min(view.state.doc.lines, Math.max(1, b.headLine + dLine));
  const headCol = Math.max(0, b.headCol + dCol);
  return selectBlock(view, { ...b, headLine, headCol });
};

const bindings = (prefix: { key: string; mac: string }) => [
  { key: `${prefix.key}ArrowUp`, mac: `${prefix.mac}ArrowUp`, run: extend(-1, 0), preventDefault: true },
  { key: `${prefix.key}ArrowDown`, mac: `${prefix.mac}ArrowDown`, run: extend(1, 0), preventDefault: true },
  { key: `${prefix.key}ArrowLeft`, mac: `${prefix.mac}ArrowLeft`, run: extend(0, -1), preventDefault: true },
  { key: `${prefix.key}ArrowRight`, mac: `${prefix.mac}ArrowRight`, run: extend(0, 1), preventDefault: true },
  { key: `${prefix.key}PageUp`, mac: `${prefix.mac}PageUp`, run: extend(-20, 0), preventDefault: true },
  { key: `${prefix.key}PageDown`, mac: `${prefix.mac}PageDown`, run: extend(20, 0), preventDefault: true },
];

export function columnSelection(): Extension {
  return [
    blockField,
    // Mouse: Alt/Option + drag; the pointer turns into a crosshair while Alt is held.
    rectangularSelection(),
    crosshairCursor(),
    // Ahead of the default keymap, where Shift+Alt+↑/↓ would copy the line.
    Prec.high(
      keymap.of([
        ...bindings({ key: "Shift-Alt-", mac: "Shift-Alt-Mod-" }),
        ...bindings({ key: "Shift-Alt-Mod-", mac: "Shift-Alt-Mod-" }),
      ]),
    ),
  ];
}
