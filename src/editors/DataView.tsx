import { createContext, useContext, useMemo, useState } from "react";
import type { Tab } from "../tabs/store";
import { checkJson, lineCol, validateXml, type JsonValue, type Problem } from "./languages/validate";
import { revealProblem } from "./validation";
import { toggleSource } from "../actions";

/**
 * Read-only tree view of a JSON or XML document (⌘/ switches back to the source). Rows expand and collapse;
 * long child lists are shown 200 at a time so huge documents stay responsive.
 */

const CHUNK = 200;
/** Above this the tree would use too much memory; the source view still works. */
const MAX_CHARS = 50_000_000;

/** Expand all / collapse all: remounts the tree with every node open or closed (deep trees stop at depth 30). */
const Mode = createContext<{ mode: "auto" | "all" | "none" }>({ mode: "auto" });
const startOpen = (mode: "auto" | "all" | "none", depth: number) =>
  mode === "all" ? depth < 30 : mode === "none" ? depth === 0 : depth < 2;

type Parsed =
  | { kind: "tooBig" }
  | { kind: "empty" }
  | { kind: "error"; error: Problem; text: string }
  | { kind: "json"; json: JsonValue }
  | { kind: "xml"; xml: Document };

export function DataView({ tab }: { tab: Tab }) {
  const [state, setState] = useState<{ mode: "auto" | "all" | "none"; gen: number }>({ mode: "auto", gen: 0 });
  const kind = tab.language === "xml" ? "XML" : "JSON";

  const parsed = useMemo((): Parsed => {
    const text = tab.content;
    if (text.length > MAX_CHARS) return { kind: "tooBig" };
    if (!text.trim()) return { kind: "empty" };
    if (tab.language === "json") {
      const { problems, value } = checkJson(text, true);
      const error = problems.find((p) => p.severity === "error");
      return error ? { kind: "error", error, text } : { kind: "json", json: value! };
    }
    const error = validateXml(text).find((p) => p.severity === "error");
    if (error) return { kind: "error", error, text };
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const pe = doc.getElementsByTagName("parsererror")[0];
    if (pe) return { kind: "error", error: { from: 0, to: 1, severity: "error", message: pe.textContent ?? "Invalid XML" }, text };
    return { kind: "xml", xml: doc };
    // version: the text was replaced from outside (reload, format)
  }, [tab.content, tab.language, tab.version]);

  const bar = (
    <div className="dv-bar">
      <span className="dv-kind">{kind}</span>
      {(parsed.kind === "json" || parsed.kind === "xml") && (
        <>
          <button className="dv-btn" onClick={() => setState((s) => ({ mode: "all", gen: s.gen + 1 }))}>
            Expand all
          </button>
          <button className="dv-btn" onClick={() => setState((s) => ({ mode: "none", gen: s.gen + 1 }))}>
            Collapse all
          </button>
        </>
      )}
      <span className="dv-spacer" />
      <button className="dv-btn" title="Edit the source (⌘/ · Ctrl+/)" onClick={() => toggleSource(tab.id)}>
        Source
      </button>
    </div>
  );

  let body;
  if (parsed.kind === "tooBig") body = <p className="dv-note">This file is too big for the tree view. The source view still works.</p>;
  else if (parsed.kind === "empty") body = <p className="dv-note">The document is empty.</p>;
  else if (parsed.kind === "error") body = <ErrorNote kind={kind} text={parsed.text} problem={parsed.error} tabId={tab.id} />;
  else
    body = (
      <Mode.Provider value={{ mode: state.mode }}>
        <div className="dv-tree" key={state.gen} role="tree">
          {parsed.kind === "json" ? <JsonNode value={parsed.json} depth={0} /> : <XmlChildren node={parsed.xml} depth={0} />}
        </div>
      </Mode.Provider>
    );

  return (
    <div className="data-view">
      {bar}
      <div className="dv-scroll">{body}</div>
    </div>
  );
}

function ErrorNote({ kind, text, problem, tabId }: { kind: string; text: string; problem: Problem; tabId: string }) {
  const { line, col } = lineCol(text, problem.from);
  return (
    <div className="dv-error">
      <p>
        <strong>
          Invalid {kind} at line {line}, column {col}
        </strong>
        <br />
        {problem.message}
      </p>
      <button className="dv-btn" onClick={() => void revealProblem(tabId, problem)}>
        Show in the source
      </button>
    </div>
  );
}

/** A row with an optional caret; children are indented below it when open. */
function Row({
  depth,
  open,
  onToggle,
  children,
}: {
  depth: number;
  open?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`dv-row${onToggle ? " dv-toggle" : ""}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      role="treeitem"
      aria-expanded={onToggle ? open : undefined}
      onClick={onToggle}
    >
      <span className="dv-caret">{onToggle ? (open ? "▾" : "▸") : ""}</span>
      {children}
    </div>
  );
}

/** Renders `count` children `CHUNK` at a time, with a "Show more" row. */
function Chunked({ count, depth, render }: { count: number; depth: number; render: (i: number) => React.ReactNode }) {
  const [shown, setShown] = useState(CHUNK);
  const rows = [];
  for (let i = 0; i < Math.min(count, shown); i++) rows.push(render(i));
  return (
    <>
      {rows}
      {count > shown && (
        <Row depth={depth}>
          <button className="dv-more" onClick={() => setShown((s) => s + CHUNK * 5)}>
            Show more ({(count - shown).toLocaleString()} left)
          </button>
        </Row>
      )}
    </>
  );
}

// ---------------------------------------------------------------- JSON

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function JsonScalar({ v }: { v: JsonValue }) {
  switch (v.type) {
    case "string":
      return <span className="dv-string">{JSON.stringify(v.value)}</span>;
    case "number":
      return <span className="dv-number">{v.raw}</span>;
    case "boolean":
      return <span className="dv-keyword">{String(v.value)}</span>;
    case "null":
      return <span className="dv-keyword">null</span>;
    default:
      return null;
  }
}

function JsonNode({ name, value, depth }: { name?: string | number; value: JsonValue; depth: number }) {
  const { mode } = useContext(Mode);
  const [open, setOpen] = useState(() => startOpen(mode, depth));
  const label =
    name === undefined ? null : typeof name === "number" ? (
      <span className="dv-index">{name}: </span>
    ) : (
      <span className="dv-key">{name}: </span>
    );
  if (value.type !== "object" && value.type !== "array") {
    return (
      <Row depth={depth}>
        {label}
        <JsonScalar v={value} />
      </Row>
    );
  }
  const count = value.type === "object" ? value.entries.length : value.items.length;
  const summary =
    value.type === "object" ? `{} ${plural(count, "key", "keys")}` : `[] ${plural(count, "item", "items")}`;
  return (
    <>
      <Row depth={depth} open={open} onToggle={count ? () => setOpen(!open) : undefined}>
        {label}
        <span className="dv-muted">{summary}</span>
      </Row>
      {open && count > 0 && (
        <Chunked
          count={count}
          depth={depth + 1}
          render={(i) =>
            value.type === "object" ? (
              <JsonNode key={i} name={value.entries[i][0]} value={value.entries[i][1]} depth={depth + 1} />
            ) : (
              <JsonNode key={i} name={i} value={value.items[i]} depth={depth + 1} />
            )
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- XML

/** Child nodes worth showing: elements, non-blank text, comments, CDATA, processing instructions. */
function visibleChildren(node: Node): Node[] {
  const out: Node[] = [];
  node.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE && !c.textContent?.trim()) return;
    if (c.nodeType === Node.DOCUMENT_TYPE_NODE) return;
    out.push(c);
  });
  return out;
}

function XmlChildren({ node, depth }: { node: Node; depth: number }) {
  const kids = useMemo(() => visibleChildren(node), [node]);
  return <Chunked count={kids.length} depth={depth} render={(i) => <XmlNode key={i} node={kids[i]} depth={depth} />} />;
}

function Attrs({ el }: { el: Element }) {
  return (
    <>
      {Array.from(el.attributes).map((a) => (
        <span key={a.name}>
          {" "}
          <span className="dv-attr">{a.name}</span>=<span className="dv-string">"{a.value}"</span>
        </span>
      ))}
    </>
  );
}

function XmlNode({ node, depth }: { node: Node; depth: number }) {
  const { mode } = useContext(Mode);
  const [open, setOpen] = useState(() => startOpen(mode, depth));
  switch (node.nodeType) {
    case Node.TEXT_NODE:
      return (
        <Row depth={depth}>
          <span className="dv-text">{node.textContent!.trim()}</span>
        </Row>
      );
    case Node.CDATA_SECTION_NODE:
      return (
        <Row depth={depth}>
          <span className="dv-muted">CDATA </span>
          <span className="dv-text">{node.textContent}</span>
        </Row>
      );
    case Node.COMMENT_NODE:
      return (
        <Row depth={depth}>
          <span className="dv-comment">&lt;!--{node.textContent}--&gt;</span>
        </Row>
      );
    case Node.PROCESSING_INSTRUCTION_NODE:
      return (
        <Row depth={depth}>
          <span className="dv-muted">
            &lt;?{(node as ProcessingInstruction).target} {node.textContent}?&gt;
          </span>
        </Row>
      );
    case Node.ELEMENT_NODE:
      break;
    default:
      return null;
  }
  const el = node as Element;
  const kids = visibleChildren(el);
  const tag = <span className="dv-tag">{el.tagName}</span>;
  // <title>Short text</title> stays on one row.
  const onlyText = kids.length === 1 && kids[0].nodeType === Node.TEXT_NODE ? kids[0].textContent!.trim() : null;
  if (!kids.length || (onlyText !== null && onlyText.length <= 200 && !onlyText.includes("\n"))) {
    return (
      <Row depth={depth}>
        <span className="dv-punct">&lt;</span>
        {tag}
        <Attrs el={el} />
        {onlyText === null ? (
          <span className="dv-punct"> /&gt;</span>
        ) : (
          <>
            <span className="dv-punct">&gt;</span>
            <span className="dv-text">{onlyText}</span>
            <span className="dv-punct">&lt;/</span>
            {tag}
            <span className="dv-punct">&gt;</span>
          </>
        )}
      </Row>
    );
  }
  return (
    <>
      <Row depth={depth} open={open} onToggle={() => setOpen(!open)}>
        <span className="dv-punct">&lt;</span>
        {tag}
        <Attrs el={el} />
        <span className="dv-punct">&gt;</span>
        {!open && <span className="dv-muted"> {plural(kids.length, "child", "children")}</span>}
      </Row>
      {open && <XmlChildren node={el} depth={depth + 1} />}
    </>
  );
}
