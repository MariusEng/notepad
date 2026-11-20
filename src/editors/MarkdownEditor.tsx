import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "./markdown.css";
import { cmHighlight, cmTheme } from "./cmTheme";
import { activeEditor, setActiveEditor } from "./handle";
import { useTabs, type Tab } from "../tabs/store";
import { toggleMarkdownSource } from "../actions";
import { createMdFormat } from "./mdFormat";

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/**
 * Formatted Markdown editing: you see rendered text, and the file stays plain .md.
 * Formatting: select text for a floating toolbar, type "/" for blocks, Markdown
 * shortcuts (## , - , > , **bold**) and ⌘B/⌘I/⌘E. The fixed formatting bar above the
 * editor (FormatBar) drives it through the `md` handle.
 *
 * Uncontrolled like CodeEditor: the parent remounts it when needed.
 */
export function MarkdownEditor({ tab }: { tab: Tab }) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { edit, update } = useTabs.getState();
    let destroyed = false;
    let baseline: string | null = null;

    const crepe = new Crepe({
      root: host.current!,
      defaultValue: tab.content,
      features: {
        // The formatting bar is app-level (FormatBar), not inside the editor.
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.AI]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: "Start writing…", mode: "doc" },
        [Crepe.Feature.CodeMirror]: { theme: [cmTheme, cmHighlight] },
        // Pasted/dropped images are embedded so the .md stays self-contained
        // (the default would store blob: URLs that break after a restart).
        [Crepe.Feature.ImageBlock]: {
          onUpload: readAsDataUrl,
          inlineOnUpload: readAsDataUrl,
          blockOnUpload: readAsDataUrl,
        },
      },
    });

    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        // Milkdown re-serialises the document on load (e.g. "*" lists become "-").
        // That is not a user edit, so only mark dirty once the text really changes.
        if (destroyed) return;
        const current = useTabs.getState().tabs.find((t) => t.id === tab.id);
        if (markdown === baseline && !current?.dirty) return;
        edit(tab.id, markdown);
      });
    });

    crepe.create().then(() => {
      if (destroyed) return;
      baseline = crepe.getMarkdown();
      if (scroller.current) scroller.current.scrollTop = tab.scroll;
      (host.current?.querySelector(".ProseMirror") as HTMLElement | null)?.focus({ preventScroll: true });
    });

    setActiveEditor({
      md: createMdFormat(crepe),
      focus: () => (host.current?.querySelector(".ProseMirror") as HTMLElement | null)?.focus(),
      // Search lives in the source view.
      find: () => {
        toggleMarkdownSource(tab.id);
        setTimeout(() => activeEditor()?.find(), 50);
      },
      replaceAll: () => false,
    });

    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => update(tab.id, { scroll: scroller.current?.scrollTop ?? 0 }), 250);
    };
    const el = scroller.current;
    el?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      destroyed = true;
      clearTimeout(scrollTimer);
      el?.removeEventListener("scroll", onScroll);
      setActiveEditor(null);
      crepe.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="md-scroller" ref={scroller}>
      <div className="md-editor" ref={host} />
    </div>
  );
}
