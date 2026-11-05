const TYPES: Record<string, string> = {
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  xml: "application/xml",
  json: "application/json",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  sh: "application/x-sh",
  py: "text/x-python",
  go: "text/x-go",
  rs: "text/x-rust",
  sql: "application/sql",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
};

export function mimeOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? TYPES[name.slice(dot + 1).toLowerCase()]
    : undefined;
}

// SVG is served as an image: every inline response also carries
// `Content-Security-Policy: default-src 'none'; sandbox`, so its scripts never run,
// even when the URL is opened directly.
const INLINE_SAFE = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|svg\+xml)|video\/|audio\/|application\/pdf$)/;
const TEXTUAL = /^(?:text\/|application\/(?:json|xml|yaml|toml|sql|x-sh)$)/;

/**
 * Content-Type to serve inline (callers add the sandbox CSP). Script-capable
 * documents (html, js …) are downgraded to text/plain; anything else unknown
 * returns undefined (serve as attachment).
 */
export function inlineType(mime: string | undefined): string | undefined {
  if (!mime)
    return undefined;
  if (INLINE_SAFE.test(mime))
    return mime;
  if (TEXTUAL.test(mime))
    return "text/plain; charset=utf-8";
  return undefined;
}
