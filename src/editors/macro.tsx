import { useState } from "react";
import { create } from "zustand";
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { macroRecording, setMacroRecorder, type MacroStep } from "./macroBus";
import { playSearch } from "./FindPanel";
import { selectColumn } from "./languages/columns";
import { activeEditor } from "./handle";
import { useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { isMac } from "../lib/backend";

/**
 * Macros, like Notepad++: record what you do in a code editor (typing, editing keys, cursor movement, selection
 * keys, find/replace, copy/cut/paste, undo), then play it back, several times or until the end of the file.
 * Edit → Macro: Start/Stop Recording (⇧⌘R · Ctrl+Shift+R), Play (⇧⌘P · Ctrl+Shift+P), Macros… (run several times,
 * save with a name, saved macros). Mouse clicks aren't recorded (as in Notepad++). Works in the code editor and the
 * Markdown/HTML source views, not in formatted Markdown.
 */

export type { MacroStep };
export interface SavedMacro {
  name: string;
  steps: MacroStep[];
}

interface MacroState {
  recording: boolean;
  steps: MacroStep[];
  playing: boolean;
  dialog: boolean;
}

export const useMacros = create<MacroState>(() => ({ recording: false, steps: [], playing: false, dialog: false }));
const notify = (text: string, kind?: "info" | "error") => useTabs.getState().notify(text, kind);
const RECORD_KEY = isMac ? "⇧⌘R" : "Ctrl+Shift+R";
const PLAY_KEY = isMac ? "⇧⌘P" : "Ctrl+Shift+P";

/** The code editor of the focused pane, if it has one. */
const activeView = (): EditorView | null => activeEditor()?.view?.() ?? null;

// ---------------------------------------------------------------- recording

const IGNORED_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Process", "Unidentified", "Fn", "Hyper", "Super"]);

/** Keys the editor acts on itself. Plain characters arrive as text input instead. */
function keyStep(e: KeyboardEvent): MacroStep | null {
  if (e.isComposing || IGNORED_KEYS.has(e.key)) return null;
  // The macro's own shortcuts (Start/Stop Recording, Play) aren't part of it.
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyR" || e.code === "KeyP")) return null;
  if (e.key.length > 1 || e.ctrlKey || e.metaKey)
    return { t: "key", key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
  return null;
}

const push = (step: MacroStep) => {
  const { steps } = useMacros.getState();
  // Consecutive typing becomes one text step (shorter to store, same result).
  const last = steps[steps.length - 1];
  if (step.t === "text" && last?.t === "text") useMacros.setState({ steps: [...steps.slice(0, -1), { t: "text", text: last.text + step.text }] });
  else useMacros.setState({ steps: [...steps, step] });
};

/** Added to every code editor: reports what happens in it while recording. */
export function macroRecorder(): Extension {
  const inEditor = (view: EditorView, e: Event) => e.target instanceof Node && view.contentDOM.contains(e.target);
  return [
    Prec.highest(
      EditorView.inputHandler.of((_view, _from, _to, text) => {
        if (macroRecording()) push({ t: "text", text });
        return false; // only watching
      }),
    ),
    EditorView.domEventObservers({
      keydown(e, view) {
        if (!macroRecording() || !inEditor(view, e)) return;
        const step = keyStep(e);
        if (step) push(step);
      },
      paste(e, view) {
        if (!macroRecording() || !inEditor(view, e)) return;
        push({ t: "paste", text: e.clipboardData?.getData("text/plain") ?? "" });
      },
      copy(e, view) {
        if (macroRecording() && inEditor(view, e)) push({ t: "copy" });
      },
      cut(e, view) {
        if (macroRecording() && inEditor(view, e)) push({ t: "cut" });
      },
      beforeinput(e, view) {
        // Undo/Redo from the Edit menu (macOS) arrive this way, not as keys.
        if (!macroRecording() || !inEditor(view, e)) return;
        if (e.inputType === "historyUndo") push({ t: "undo" });
        else if (e.inputType === "historyRedo") push({ t: "redo" });
      },
    }),
  ];
}

/** Edit → Macro → Start/Stop Recording. */
export function toggleRecording() {
  const { recording, steps, playing } = useMacros.getState();
  if (playing) return;
  if (!recording) {
    if (!activeView()) {
      notify("Macros work in code editors and source views (⌘/ · Ctrl+/ shows the source of formatted Markdown).");
      return;
    }
    useMacros.setState({ recording: true, steps: [] });
    setMacroRecorder(push);
    activeEditor()?.focus();
    return;
  }
  setMacroRecorder(null);
  useMacros.setState({ recording: false });
  if (!steps.length) {
    notify("Nothing was recorded.");
    return;
  }
  useSettings.getState().update({ lastMacro: steps });
  notify(`Macro recorded (${steps.length} ${steps.length === 1 ? "step" : "steps"}). ${PLAY_KEY} plays it.`);
}

// ---------------------------------------------------------------- playback

/** What copy/cut put aside during this playback, for the paste steps after it. */
let clip: string | null = null;

function insertText(view: EditorView, text: string) {
  const sel = view.state.selection;
  const tr = () => view.state.update(view.state.replaceSelection(text), { userEvent: "input.type", scrollIntoView: true });
  // One cursor: through the input handlers, so auto-closing brackets and the like behave as when typing.
  if (sel.ranges.length === 1)
    for (const h of view.state.facet(EditorView.inputHandler)) if (h(view, sel.main.from, sel.main.to, text, tr)) return;
  view.dispatch(tr());
}

/** Typed text, one character at a time as it was typed (input handlers such as auto-closing brackets only act on
 *  single characters). Long text (a merged run of typing) is inserted in one go. */
function typeText(view: EditorView, text: string) {
  if (text.length > 200) return insertText(view, text);
  for (const ch of text) insertText(view, ch);
}

const selectedText = (view: EditorView) =>
  view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to)).join(view.state.lineBreak);

function runStep(view: EditorView, s: MacroStep) {
  switch (s.t) {
    case "text":
      return typeText(view, s.text);
    case "key": {
      const ev = new KeyboardEvent("keydown", { key: s.key, code: s.code, ctrlKey: s.ctrl, altKey: s.alt, shiftKey: s.shift, metaKey: s.meta, bubbles: true, cancelable: true });
      runScopeHandlers(view, ev, "editor");
      return;
    }
    case "copy":
    case "cut": {
      const text = selectedText(view);
      if (!text) return;
      clip = text;
      void navigator.clipboard?.writeText(text).catch(() => {});
      if (s.t === "cut")
        view.dispatch(view.state.changeByRange((r) => ({ changes: { from: r.from, to: r.to }, range: EditorSelection.cursor(r.from) })), { userEvent: "delete.cut" });
      return;
    }
    case "paste":
      return insertText(view, clip ?? s.text);
    case "undo":
      undo(view);
      return;
    case "redo":
      redo(view);
      return;
    case "find":
      return playSearch(view, "find", s.q, s.dir);
    case "replace":
    case "replaceAll":
    case "selectMatches":
      return playSearch(view, s.t, s.q);
    case "selectColumn":
      selectColumn(view);
      return;
  }
}

export type RunMode = { times: number } | { toEnd: true };
const MAX_RUNS = 100_000;

/** Plays a macro in the focused editor: once, n times, or until the end of the file. */
export async function playMacro(steps: MacroStep[], mode: RunMode = { times: 1 }) {
  const view = activeView();
  if (!view) {
    notify("Macros play in code editors and source views (⌘/ · Ctrl+/ shows the source of formatted Markdown).");
    return;
  }
  const st = useMacros.getState();
  if (st.recording || st.playing || !steps.length) return;
  useMacros.setState({ playing: true });
  clip = null;
  let runs = 0;
  let started = performance.now();
  try {
    const total = "times" in mode ? Math.min(mode.times, MAX_RUNS) : MAX_RUNS;
    // Until the end of the file: every run must bring the cursor closer to the end, i.e. leave less text after it.
    // Otherwise it stops: a run that stays on the last line (e.g. a macro ending with Home), Find Next wrapping
    // around to the top, or a run that does nothing would repeat forever. Text the macro inserts before the cursor
    // doesn't count, so a macro that edits each line and moves on still works.
    const after = () => view.state.doc.length - view.state.selection.main.head;
    while (runs < total) {
      const left = after();
      if ("toEnd" in mode && left <= 0) break;
      for (const s of steps) runStep(view, s);
      runs++;
      if ("toEnd" in mode && after() >= left) break;
      // Keep the window responsive during long runs.
      if (performance.now() - started > 100) {
        await new Promise((r) => setTimeout(r, 0));
        started = performance.now();
        if (!useMacros.getState().playing) break; // stopped
      }
    }
    if (runs > 1) notify(`Macro played ${runs.toLocaleString()} times.`);
  } catch (e) {
    notify(`The macro stopped: ${e}`, "error");
  } finally {
    useMacros.setState({ playing: false });
    view.focus();
  }
}

/** Edit → Macro → Play: the last recorded macro, once. */
export function playLast() {
  const steps = useSettings.getState().lastMacro;
  if (!steps?.length) {
    notify(`No macro yet: ${RECORD_KEY} starts recording.`);
    return;
  }
  void playMacro(steps);
}

export const openMacroDialog = () => useMacros.setState({ dialog: true });
const closeDialog = () => useMacros.setState({ dialog: false });

// ---------------------------------------------------------------- UI

/** Status bar: shown while recording (click to stop) and while a long playback runs (click to stop it). */
export function MacroStatus() {
  const recording = useMacros((s) => s.recording);
  const playing = useMacros((s) => s.playing);
  const n = useMacros((s) => s.steps.length);
  if (recording)
    return (
      <button className="sb-item sb-btn sb-rec" title={`Stop recording (${RECORD_KEY})`} onClick={toggleRecording}>
        ● Recording macro{n ? ` · ${n}` : ""}
      </button>
    );
  if (playing)
    return (
      <button className="sb-item sb-btn" title="Stop playing" onClick={() => useMacros.setState({ playing: false })}>
        Playing macro… (click to stop)
      </button>
    );
  return null;
}

/** Edit → Macro → Macros…: run several times, save the last recording under a name, saved macros. */
export function MacroDialog() {
  const open = useMacros((s) => s.dialog);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const last = useSettings((s) => s.lastMacro);
  const saved = useSettings((s) => s.macros);
  const update = useSettings((s) => s.update);
  const [choice, setChoice] = useState<string>(last?.length ? "" : saved[0]?.name ?? "");
  const [how, setHow] = useState<"once" | "times" | "end">("once");
  const [times, setTimes] = useState(10);
  const [name, setName] = useState("");
  const steps = choice === "" ? last ?? [] : saved.find((m) => m.name === choice)?.steps ?? [];
  const taken = saved.some((m) => m.name === name.trim());

  const run = () => {
    closeDialog();
    void playMacro(steps, how === "end" ? { toEnd: true } : { times: how === "times" ? Math.max(1, times) : 1 });
  };
  const save = () => {
    const n = name.trim();
    if (!n || !last?.length) return;
    update({ macros: [...saved.filter((m) => m.name !== n), { name: n, steps: last }].sort((a, b) => a.name.localeCompare(b.name)) });
    setChoice(n);
    setName("");
  };

  return (
    <div className="picker-backdrop" onMouseDown={closeDialog}>
      <div className="dialog" role="dialog" aria-label="Macros" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && closeDialog()}>
        <h2>Macros</h2>
        {!last?.length && !saved.length ? (
          <p className="note">
            No macros yet. Choose Edit → Macro → Start Recording ({RECORD_KEY}), do what you want to repeat, and stop recording with the same keys.
          </p>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Macro</span>
              <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                {!!last?.length && <option value="">Last recorded ({last.length} steps)</option>}
                {saved.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field-label">Run</span>
              <label className="check">
                <input type="radio" checked={how === "once"} onChange={() => setHow("once")} /> Once
              </label>
              <label className="check">
                <input type="radio" checked={how === "times"} onChange={() => setHow("times")} />
                <input
                  type="number"
                  min={1}
                  max={MAX_RUNS}
                  value={times}
                  aria-label="Number of times"
                  style={{ width: 80 }}
                  onFocus={() => setHow("times")}
                  onChange={(e) => setTimes(Number(e.target.value) || 1)}
                />
                times
              </label>
              <label className="check">
                <input type="radio" checked={how === "end"} onChange={() => setHow("end")} /> Until the end of the file
              </label>
            </div>
            <div className="dialog-actions">
              {choice !== "" && (
                <button className="btn ghost" onClick={() => update({ macros: saved.filter((m) => m.name !== choice) })}>
                  Delete “{choice}”
                </button>
              )}
              <span className="sb-spacer" />
              <button className="btn" onClick={closeDialog}>
                Close
              </button>
              <button className="btn primary" disabled={!steps.length} onClick={run} autoFocus>
                Run
              </button>
            </div>
          </>
        )}
        {!!last?.length && (
          <>
            <h3>Save the last recorded macro</h3>
            <div className="dialog-actions" style={{ marginTop: 4 }}>
              <input
                value={name}
                placeholder="Name"
                aria-label="Macro name"
                spellCheck={false}
                style={{ flex: 1 }}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <button className="btn" disabled={!name.trim()} onClick={save}>
                {taken ? "Replace" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
