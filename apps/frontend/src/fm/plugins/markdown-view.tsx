import type { PreviewProps } from "../react/previewers";
import { code } from "@streamdown/code";
import { cn } from "cn";
import { BookOpenIcon, Columns2Icon, FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "../react/icon-button";
import { LazyTextPreview } from "../react/previewers";

const MAX_BYTES = 2 * 1024 * 1024;

type Mode = "source" | "preview" | "side";

/** Rendered Markdown of `text`; follows the editor live. */
function Rendered({ text }: { text: string }) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-4 text-sm wrap-break-word">
      <Streamdown mode="static" plugins={{ code }}>{text}</Streamdown>
    </article>
  );
}

/**
 * Opens in the text editor like any text file. Header buttons show the rendered
 * Markdown instead of the editor or beside it; the preview follows the editor's
 * text, unsaved edits included. The editor stays mounted so drafts survive.
 */
export function MarkdownPreview(props: PreviewProps) {
  const { entry, labels, actions } = props;
  const [mode, setMode] = useState<Mode>("source");
  const [text, setText] = useState("");

  if (entry.size > MAX_BYTES)
    return <LazyTextPreview {...props} />;

  const editorShown = mode !== "preview";
  return (
    <div className="flex h-full min-h-0">
      {actions && createPortal(
        <>
          {mode === "preview"
            ? <IconButton label={labels.reopenSource} onClick={() => setMode("source")}><FileCodeIcon /></IconButton>
            : <IconButton label={labels.openPreview} onClick={() => setMode("preview")}><BookOpenIcon /></IconButton>}
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
      <div className={cn("h-full min-w-0 flex-1", !editorShown && "hidden")}>
        <LazyTextPreview
          {...props}
          // The Save button belongs in the header only while the editor is visible.
          actions={editorShown
            ? (actions ?? null)
            : null}
          onTextChange={setText}
        />
      </div>
      {mode !== "source" && (
        <ScrollArea className={cn("h-full min-w-0 flex-1", mode === "side" && "border-l")} data-fm-markdown-preview="">
          <Rendered text={text} />
        </ScrollArea>
      )}
    </div>
  );
}
