import type { Components, StreamdownProps, UrlTransform } from "streamdown";
import type { PreviewProps } from "../react/previewers";
import { code } from "@streamdown/code";
import { useMemo } from "react";
import { defaultComponents, defaultRehypePlugins, Streamdown } from "streamdown";
import { SourcePreview } from "../react/source-preview";
import { isAllowedImageUrl, isAllowedSrcset } from "./markdown-images";

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
function Rendered({ text, remoteImages, codeRenderers }: { text: string; remoteImages: boolean; codeRenderers: PreviewProps["codeRenderers"] }) {
  // Stable while the plugins are: a new object would re-render every block.
  const plugins = useMemo(() => ({
    code,
    renderers: (codeRenderers ?? []).map(({ language, component: Renderer }) => ({
      language,
      component: (p: { code: string; language: string }) => <Renderer code={p.code} language={p.language} />,
    })),
  }), [codeRenderers]);
  return (
    <article className="mx-auto max-w-3xl px-6 py-4 text-sm wrap-break-word">
      {remoteImages
        ? <Streamdown mode="static" plugins={plugins} rehypePlugins={REHYPE_PLUGINS}>{text}</Streamdown>
        : <Streamdown mode="static" plugins={plugins} rehypePlugins={REHYPE_PLUGINS} urlTransform={localImageSrc} components={LOCAL_IMAGES}>{text}</Streamdown>}
    </article>
  );
}

/**
 * Opens in the text editor like any text file; header buttons show the rendered
 * Markdown instead of the editor or beside it. Fenced blocks of a language a
 * plugin renders (e.g. `mermaid`) show that plugin's view.
 */
function Markdown({ remoteImages, ...props }: PreviewProps & { remoteImages: boolean }) {
  return (
    <SourcePreview
      {...props}
      layoutId="fm-markdown"
      render={text => <Rendered text={text} remoteImages={remoteImages} codeRenderers={props.codeRenderers} />}
    />
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
