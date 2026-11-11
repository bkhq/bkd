/** Resolves relative URLs; `.invalid` never resolves, so only relative input lands here. */
const RELATIVE_BASE = new URL("https://relative.invalid/");

/**
 * Whether a Markdown image URL may load without contacting a third party:
 * relative URLs, absolute URLs on `origin` and `data:image/...`. Everything
 * else (other hosts, protocol-relative `//host`, other schemes, malformed) is
 * refused. Parsing goes through `URL`, as the browser does, so tabs, newlines
 * and backslashes cannot disguise a remote host.
 */
export function isAllowedImageUrl(url: string, origin: string): boolean {
  if (url.trim() === "")
    return false;
  let resolved: URL;
  try {
    resolved = new URL(url, RELATIVE_BASE);
  }
  catch {
    return false;
  }
  if (resolved.protocol === "data:")
    return /^image\//i.test(resolved.pathname);
  return resolved.origin === RELATIVE_BASE.origin || resolved.origin === origin;
}

/**
 * Whether every candidate URL of a `srcset` passes {@link isAllowedImageUrl}.
 * Splits like the browser: a URL is a run of non-space characters (trailing
 * commas dropped), its descriptors run to the next comma.
 */
export function isAllowedSrcset(srcset: string, origin: string): boolean {
  const urls: string[] = [];
  let rest = srcset;
  for (let m = /^[\s,]*(\S+)/.exec(rest); m; m = /^[\s,]*(\S+)/.exec(rest)) {
    const url = m[1]!;
    rest = rest.slice(m[0].length);
    if (url.endsWith(",")) {
      urls.push(url.replace(/,+$/, ""));
    }
    else {
      urls.push(url);
      const comma = rest.indexOf(",");
      rest = comma < 0
        ? ""
        : rest.slice(comma + 1);
    }
  }
  return urls.length > 0 && urls.every(u => isAllowedImageUrl(u, origin));
}
