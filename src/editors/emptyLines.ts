import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { paragraphSchema } from "@milkdown/kit/preset/commonmark";

/**
 * Milkdown saves an empty paragraph as "<br />" so it survives a reload. Our files are plain Markdown, so empty
 * paragraphs are left out instead. (Placeholders in existing files still load as empty paragraphs.)
 */
export const plainEmptyParagraphs = paragraphSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toMarkdown: {
      ...base.toMarkdown,
      runner: (state, node) => {
        if (node.content.size > 0) base.toMarkdown.runner(state, node);
      },
    },
  };
});

/**
 * Config for the above: a list item or quote with only an empty paragraph now has no children at all, and
 * mdast-util-to-markdown's own join rule reads `children.length`. Custom join rules run first, so fill it in here.
 */
export function allowEmptyContainers(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (o) => ({
    ...o,
    join: [
      ...(o.join ?? []),
      (left) => {
        type Loose = { type: string; children?: Loose[] };
        let node = left as unknown as Loose | undefined;
        while (node && ["blockquote", "list", "listItem"].includes(node.type)) {
          node.children ??= [];
          node = node.children[node.children.length - 1];
        }
        return undefined;
      },
    ],
  }));
}

const BR_LINE = /^ {0,3}<br\s*\/?\s*>[ \t]*$/i;
const FENCE = /^[\s>]*(?:[-*+]\s+|\d+[.)]\s+)?(`{3,}|~{3,})(.*)$/;

/**
 * A line with only `<br />` starts an HTML block that runs to the next blank line, so Markdown directly below it
 * (e.g. an image) would show as literal text. Adds the missing blank line. Code fences, `<pre>` and comments are
 * left alone; a `<br>` inside a paragraph doesn't start an HTML block either.
 */
export function separateBrLines(text: string): string {
  if (!/<br/i.test(text)) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let fence = "";
  let raw: RegExp | null = null; // what ends the <pre>/comment we are in
  let fresh = true; // a new block can start on this line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = "";
      fresh = !fence;
      continue;
    }
    if (raw) {
      if (raw.test(line)) raw = null;
      fresh = !raw;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const open = /^ {0,3}<(?:(pre|script|style|textarea)\b|!--)/i.exec(line);
    if (open) {
      const end = open[1] ? /<\/(pre|script|style|textarea)>/i : /-->/;
      if (!end.test(line)) raw = end;
      fresh = !raw;
      continue;
    }
    if (fresh && BR_LINE.test(line)) {
      if (i + 1 < lines.length && lines[i + 1].trim()) out.push("");
      continue; // still fresh: the next line starts a new block
    }
    fresh = !line.trim();
  }
  return out.join("\n");
}
