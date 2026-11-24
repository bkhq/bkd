import type { ReactNode } from "react";
import type { PreviewProps } from "./previewers";
import { Columns2Icon, EyeIcon, FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "./icon-button";
import { LazyTextPreview, MAX_TEXT_BYTES } from "./previewers";

type Mode = "source" | "preview" | "side";

export interface SourcePreviewProps extends PreviewProps {
  /** Key of the stored pane sizes; one per format. */
  layoutId: string;
  /** What shows first. */
  initialMode?: "source" | "preview";
  /** The rendered view of `text` (the editor's text, unsaved edits included). */
  render: (text: string) => ReactNode;
}

/**
 * A text file in the editor, with header buttons that show its rendered view
 * instead of the editor or beside it; the view follows unsaved edits. The editor
 * stays mounted so drafts survive. For plugins previewing text formats
 * (Markdown, Mermaid). Files over `MAX_TEXT_BYTES` open in the editor alone.
 */
export function SourcePreview({ layoutId, initialMode = "source", render, ...props }: SourcePreviewProps) {
  const { labels, actions } = props;
  const [mode, setMode] = useState<Mode>(initialMode);
  const [text, setText] = useState("");
  const panes = useDefaultLayout({
    id: `${layoutId}:panels`,
    panelIds: mode === "source"
      ? ["editor"]
      : ["editor", "preview"],
    ...(typeof localStorage !== "undefined"
      ? { storage: localStorage }
      : {}),
  });

  // Too large to render as a whole: the editor alone.
  if (props.entry.size > MAX_TEXT_BYTES)
    return <LazyTextPreview {...props} />;

  const editorShown = mode !== "preview";
  return (
    // Panels size by flex-grow: the editor hidden in preview mode leaves the preview the whole row.
    // The panel element has an inline `display`, so hiding it needs `!important`.
    <ResizablePanelGroup id={`${layoutId}:panels`} orientation="horizontal" className="min-h-0 [&>[data-fm-hidden]]:hidden!" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
      {actions && createPortal(
        <>
          {mode === "preview"
            ? <IconButton label={labels.reopenSource} onClick={() => setMode("source")}><FileCodeIcon /></IconButton>
            : <IconButton label={labels.openPreview} onClick={() => setMode("preview")}><EyeIcon /></IconButton>}
          <IconButton
            label={labels.openPreviewToSide}
            aria-pressed={mode === "side"}
            onClick={() => setMode(mode === "side"
              ? "source"
              : "side")}
          >
            <Columns2Icon />
          </IconButton>
        </>,
        actions,
      )}
      <ResizablePanel
        id="editor"
        minSize="20%"
        className="min-w-0"
        data-fm-hidden={editorShown
          ? undefined
          : ""}
      >
        <LazyTextPreview
          {...props}
          // The Save button belongs in the header only while the editor is visible.
          actions={editorShown
            ? (actions ?? null)
            : null}
          onTextChange={setText}
        />
      </ResizablePanel>
      {mode === "side" && <ResizableHandle withHandle aria-label={labels.resizePanes} />}
      {mode !== "source" && (
        <ResizablePanel id="preview" minSize="20%" className="min-w-0">
          <ScrollArea className="h-full" data-fm-rendered="">
            {render(text)}
          </ScrollArea>
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}
