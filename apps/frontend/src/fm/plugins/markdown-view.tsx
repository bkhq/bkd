import type { Components, StreamdownProps, UrlTransform } from "streamdown";
import type { PreviewProps } from "../react/previewers";
import { code } from "@streamdown/code";
import { BookOpenIcon, Columns2Icon, FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useDefaultLayout } from "react-resizable-panels";
import { defaultComponents, defaultRehypePlugins, Streamdown } from "streamdown";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "../react/icon-button";
import { LazyTextPreview } from "../react/previewers";
import { isAllowedImageUrl, isAllowedSrcset } from "./markdown-images";

const MAX_BYTES = 2 * 1024 * 1024;

type Mode = "source" | "preview" | "side";

const DefaultImg = defaultComponents.img!;

type PluggableList = NonNullable<StreamdownProps["rehypePlugins"]>;
type Plugin = Extract<PluggableList[number], (...args: never[]) => unknown>;
interface SanitizeSchema { protocols?: Record<string, string[] | null | undefined> }
const [rehypeSanitize, sanitizeSchema] = defaultRehypePlugins.sanitize as [Plugin, SanitizeSchema];
/** streamdown's defaults, but the sanitizer keeps `data:` image sources; harden still admits only `data:image/...`. */
const REHYPE_PLUGINS: PluggableList = Object.values<PluggableList[number]>({
  ...defaultRehypePlugins,
  sanitize: [
    rehypeSanitize,
    {
      ...sanitizeSchema,
      protocols: {
        ...sanitizeSchema.protocols,
        src: [
          ...(sanitizeSchema.protocols?.src ?? []),
          "data",
        ],
      },
    },
  ],
});

/** Drops image URLs that would reach a third party; the element then renders without a request. */
const localImageSrc: UrlTransform = (url, key) => key === "src" && !isAllowedImageUrl(url, location.origin)
  ? undefined
  : url;

const LOCAL_IMAGES: Components = {
  // A blocked image shows its alt text instead.
  img: props => props.src
    ? <DefaultImg {...props} />
    : props.alt
      ? <span className="text-muted-foreground italic">{props.alt}</span>
      : null,
  // Raw `<picture><source srcset>` bypasses `urlTransform`, which only rewrites `src`.
  source: ({ node: _node, srcSet, ...props }) => (
    <source
      {...props}
      srcSet={typeof srcSet === "string" && isAllowedSrcset(srcSet, location.origin)
        ? srcSet
        : undefined}
    />
  ),
};

/** Rendered Markdown of `text`; follows the editor live. */
function Rendered({ text, remoteImages }: { text: string; remoteImages: boolean }) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-4 text-sm wrap-break-word">
      {remoteImages
        ? <Streamdown mode="static" plugins={{ code }} rehypePlugins={REHYPE_PLUGINS}>{text}</Streamdown>
        : <Streamdown mode="static" plugins={{ code }} rehypePlugins={REHYPE_PLUGINS} urlTransform={localImageSrc} components={LOCAL_IMAGES}>{text}</Streamdown>}
    </article>
  );
}

/**
 * Opens in the text editor like any text file. Header buttons show the rendered
 * Markdown instead of the editor or beside it; the preview follows the editor's
 * text, unsaved edits included. The editor stays mounted so drafts survive.
 */
function Markdown({ remoteImages, ...props }: PreviewProps & { remoteImages: boolean }) {
  const { entry, labels, actions } = props;
  const [mode, setMode] = useState<Mode>("source");
  const [text, setText] = useState("");
  const panes = useDefaultLayout({
    id: "fm-markdown:panels",
    panelIds: mode === "source"
      ? ["editor"]
      : ["editor", "preview"],
    ...(typeof localStorage !== "undefined"
      ? { storage: localStorage }
      : {}),
  });

  if (entry.size > MAX_BYTES)
    return <LazyTextPreview {...props} />;

  const editorShown = mode !== "preview";
  return (
    // Panels size by flex-grow: the editor hidden in preview mode leaves the preview the whole row.
    // The panel element has an inline `display`, so hiding it needs `!important`.
    <ResizablePanelGroup id="fm-markdown:panels" orientation="horizontal" className="min-h-0 [&>[data-fm-hidden]]:hidden!" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
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
          <ScrollArea className="h-full" data-fm-markdown-preview="">
            <Rendered text={text} remoteImages={remoteImages} />
          </ScrollArea>
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}

/** Images load only from relative, same-origin and `data:image/...` URLs. */
export function MarkdownPreview(props: PreviewProps) {
  return <Markdown {...props} remoteImages={false} />;
}

/** Images load from any URL (`markdownPlugin({ remoteImages: true })`). */
export function MarkdownPreviewRemoteImages(props: PreviewProps) {
  return <Markdown {...props} remoteImages />;
}
