import type { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  emphasisSchema,
  headingSchema,
  hrSchema,
  inlineCodeSchema,
  isMarkSelectedCommand,
  linkSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  selectTextNearPosCommand,
  setBlockTypeCommand,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import { createTable, strikethroughSchema, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { MdAction, MdFormat, MdFormatState } from "./handle";


/** Formatting commands for the formatted Markdown editor, built on Milkdown's command API. */
export function createMdFormat(crepe: Crepe): MdFormat {
  const act = <T,>(fn: (ctx: Ctx) => T): T | undefined => {
    try {
      return crepe.editor.action(fn);
    } catch {
      return undefined; // editor not created yet or already destroyed
    }
  };

  const markActive = (ctx: Ctx, mark: ReturnType<typeof strongSchema.type>) => {
    const commands = ctx.get(commandsCtx);
    if (commands.call(isMarkSelectedCommand.key, mark)) return true;
    const { state } = ctx.get(editorViewCtx);
    if (state.storedMarks) return state.storedMarks.some((m) => m.type === mark);
    const cursor = (state.selection as { $cursor?: { marks(): readonly { type: unknown }[] } }).$cursor;
    return !!cursor && cursor.marks().some((m) => m.type === mark);
  };

  /** Inline marks on an empty selection toggle the "stored" mark, as Crepe's own bar does. */
  const toggleStored = (ctx: Ctx, mark: ReturnType<typeof strongSchema.type>, command: () => void) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    if (state.selection.empty) {
      view.dispatch(markActive(ctx, mark) ? state.tr.removeStoredMark(mark) : state.tr.addStoredMark(mark.create()));
    } else {
      command();
    }
  };

  return {
    run(action: MdAction) {
      act((ctx) => {
        const commands = ctx.get(commandsCtx);
        switch (action) {
          case "bold":
            commands.call(toggleStrongCommand.key);
            break;
          case "italic":
            commands.call(toggleEmphasisCommand.key);
            break;
          case "strike":
            commands.call(toggleStrikethroughCommand.key);
            break;
          case "code":
            toggleStored(ctx, inlineCodeSchema.type(ctx), () => commands.call(toggleInlineCodeCommand.key));
            break;
          case "bullet":
            commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) });
            break;
          case "ordered":
            commands.call(wrapInBlockTypeCommand.key, { nodeType: orderedListSchema.type(ctx) });
            break;
          case "task":
            commands.call(wrapInBlockTypeCommand.key, { nodeType: listItemSchema.type(ctx), attrs: { checked: false } });
            break;
          case "link": {
            const view = ctx.get(editorViewCtx);
            const mark = linkSchema.type(ctx);
            if (view.state.selection.empty && markActive(ctx, mark)) {
              view.dispatch(view.state.tr.removeStoredMark(mark));
            } else {
              commands.call(toggleLinkCommand.key);
            }
            break;
          }
          case "quote":
            commands.call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) });
            break;
          case "codeblock":
            commands.call(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(ctx) });
            break;
          case "hr":
            commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) });
            break;
          case "table": {
            const { from } = ctx.get(editorViewCtx).state.selection;
            commands.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) });
            commands.call(selectTextNearPosCommand.key, { pos: from });
            break;
          }
        }
      });
    },

    setHeading(level: number) {
      act((ctx) => {
        const commands = ctx.get(commandsCtx);
        if (level === 0) commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
        else commands.call(setBlockTypeCommand.key, { nodeType: headingSchema.type(ctx), attrs: { level } });
      });
    },

    state(): MdFormatState {
      return (
        act((ctx): MdFormatState => {
          const parent = ctx.get(editorViewCtx).state.selection.$from.parent;
          return {
            bold: markActive(ctx, strongSchema.type(ctx)),
            italic: markActive(ctx, emphasisSchema.type(ctx)),
            strike: markActive(ctx, strikethroughSchema.type(ctx)),
            code: markActive(ctx, inlineCodeSchema.type(ctx)),
            link: markActive(ctx, linkSchema.type(ctx)),
            heading: parent.type === headingSchema.type(ctx) ? (parent.attrs.level as number) : 0,
          };
        }) ?? { bold: false, italic: false, strike: false, code: false, link: false, heading: 0 }
      );
    },
  };
}
