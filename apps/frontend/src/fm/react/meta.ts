import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import { useQuery } from "@tanstack/react-query";
import { fmKeys } from "../client/hooks";

/** An entry by location. */
export interface FmRef {
  mount: string;
  path: string;
}

/**
 * Per-user metadata kept by the host (its own database or storage). Every part is
 * optional; the matching UI appears only when it is provided.
 */
export interface FmMeta {
  /** Starred entries, most relevant first. */
  starred?: (() => Promise<FmRef[]>) | undefined;
  setStarred?: ((ref: FmRef, starred: boolean) => Promise<void>) | undefined;
  /** Recently opened files, newest first. */
  recent?: (() => Promise<FmRef[]>) | undefined;
  /** A file was opened in the preview. */
  touch?: ((ref: FmRef) => void) | undefined;
}

export type FmMetaList = "starred" | "recent";

/** Entries per section; more refs than this are ignored. */
const MAX_REFS = 50;

export function metaKey(client: FmClient, list: FmMetaList) {
  return [
    ...fmKeys.all(client),
    "meta",
    list,
  ] as const;
}

/** Entries of a meta list, resolved with `stat`; refs that no longer resolve are skipped. */
export function useMetaEntries(client: FmClient, meta: FmMeta | undefined, list: FmMetaList) {
  const load = meta?.[list];
  return useQuery({
    queryKey: metaKey(client, list),
    enabled: !!load,
    queryFn: async () => {
      const refs = (await load!()).slice(0, MAX_REFS);
      const stats = await Promise.allSettled(refs.map(r => client.stat(r.mount, r.path)));
      return stats.flatMap(s => s.status === "fulfilled"
        ? [s.value]
        : []) satisfies FmEntry[];
    },
  });
}
