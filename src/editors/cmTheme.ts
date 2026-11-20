import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** One CodeMirror theme for both light and dark: every colour is a CSS variable
 *  from theme/tokens.css, so a theme switch needs no editor reconfiguration. */
export const cmTheme = EditorView.theme({
  "&": {
    color: "var(--fg)",
    backgroundColor: "var(--bg)",
    height: "100%",
    fontSize: "14px",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--accent)", padding: "10px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-gutters": {
    backgroundColor: "var(--bg)",
    color: "var(--faint)",
    border: "none",
    paddingLeft: "6px",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--bg-sunken)",
    border: "1px solid var(--border)",
    color: "var(--muted)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--match)" },
  ".cm-searchMatch": { backgroundColor: "var(--match)", outline: "1px solid var(--faint)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--selection)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--match)", outline: "none" },
  ".cm-panels": { backgroundColor: "var(--bg-subtle)", color: "var(--fg)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 10px", fontFamily: "var(--font-ui)", fontSize: "13px" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield, .cm-button": {
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    backgroundColor: "var(--bg)",
    backgroundImage: "none",
    color: "var(--fg)",
    padding: "3px 8px",
  },
  ".cm-panel.cm-search label": { fontSize: "13px", color: "var(--muted)" },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-subtle)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow)",
  },
});

export const cmHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: "var(--syn-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
    { tag: [t.variableName, t.special(t.variableName)], color: "var(--syn-variable)" },
    { tag: [t.function(t.variableName), t.standard(t.variableName), t.labelName], color: "var(--syn-function)" },
    { tag: [t.typeName, t.className, t.namespace], color: "var(--syn-type)" },
    {
      tag: [t.propertyName, t.attributeName, t.definition(t.propertyName), t.definition(t.variableName)],
      color: "var(--syn-property)",
    },
    { tag: [t.operator, t.punctuation], color: "var(--syn-operator)" },
    { tag: [t.meta, t.processingInstruction], color: "var(--syn-meta)" },
    { tag: t.heading, color: "var(--syn-heading)", fontWeight: "700" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "var(--accent)", textDecoration: "underline" },
    { tag: t.monospace, color: "var(--syn-string)" },
    { tag: t.invalid, color: "var(--danger)" },
  ]),
);
