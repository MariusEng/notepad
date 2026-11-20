import { useEffect, useRef } from "react";
import { toggleSource } from "../actions";
import { activeEditor, registerEditor } from "./handle";
import { useTabs, type Tab } from "../tabs/store";

/**
 * Rendered view of an HTML tab (read-only; edit in the source view, ⌘/ · Ctrl+/).
 * The page is sandboxed: no scripts, forms or navigation of the app window.
 */
export function HtmlPreview({ tab }: { tab: Tab }) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(
    () =>
      registerEditor(tab.id, {
        focus: () => frame.current?.focus(),
        // Search and Format Document work on the source.
        find: () => {
          toggleSource(tab.id);
          setTimeout(() => activeEditor()?.find(), 50);
        },
        replaceAll: () => false,
      }),
    [tab.id],
  );

  return (
    <iframe
      ref={frame}
      className="html-preview"
      title={`Preview of ${tab.title}`}
      sandbox=""
      srcDoc={tab.content}
      onDoubleClick={() => toggleSource(tab.id)}
      onFocus={() => useTabs.getState().setActive(tab.id)}
    />
  );
}
