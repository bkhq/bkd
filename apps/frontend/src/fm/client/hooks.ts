import type { FmOpsRequest, FmSearchMode, FmSortKey } from "../core/schema";
import type { FmClient, FmListFilter } from "./client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const fmKeys = {
  all: (client: FmClient) => ["fm", client.baseUrl] as const,
  mounts: (client: FmClient) => [
    ...fmKeys.all(client),
    "mounts",
  ] as const,
  lists: (client: FmClient, mount: string) => [
    ...fmKeys.all(client),
    "list",
    mount,
  ] as const,
  list: (client: FmClient, mount: string, path: string, sort: FmSortKey, order: "asc" | "desc", q = "", filter: FmListFilter = {}) =>
    [
      ...fmKeys.lists(client, mount),
      path,
      sort,
      order,
      q,
      filter.hidden ?? true,
      filter.ignored ?? true,
    ] as const,
  search: (client: FmClient, mount: string, path: string, q: string, mode: FmSearchMode = "substring", filter: FmListFilter = {}) => [
    ...fmKeys.lists(client, mount),
    "search",
    path,
    q,
    mode,
    filter.hidden ?? true,
    filter.ignored ?? true,
  ] as const,
  trash: (client: FmClient, mount: string) => [
    ...fmKeys.all(client),
    "trash",
    mount,
  ] as const,
  usage: (client: FmClient, mount: string, path: string) => [
    ...fmKeys.lists(client, mount),
    "usage",
    path,
  ] as const,
  text: (client: FmClient, mount: string, path: string) => [
    ...fmKeys.all(client),
    "text",
    mount,
    path,
  ] as const,
};

export function useMounts(client: FmClient) {
  return useQuery({
    queryKey: fmKeys.mounts(client),
    queryFn: () => client.mounts(),
  });
}

const PAGE = 500;

/** Directory listing, paged by the server cursor; `q` filters names, `filter` drops hidden / ignored entries. */
export function useListing(client: FmClient, mount: string | undefined, path: string, sort: FmSortKey, order: "asc" | "desc", q = "", filter: FmListFilter = {}) {
  return useInfiniteQuery({
    queryKey: fmKeys.list(client, mount ?? "", path, sort, order, q, filter),
    enabled: !!mount,
    // Keep rows on screen while a new filter loads.
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.list(mount!, path, {
      cursor: pageParam,
      limit: PAGE,
      sort,
      order,
      q,
      hidden: filter.hidden,
      ignored: filter.ignored,
    }),
    getNextPageParam: last => last.cursor,
  });
}

/** Name matches at any depth below `path`. */
export function useSearch(client: FmClient, mount: string | undefined, path: string, q: string, enabled = true, mode: FmSearchMode = "substring", filter: FmListFilter = {}) {
  return useQuery({
    queryKey: fmKeys.search(client, mount ?? "", path, q, mode, filter),
    queryFn: () => client.search(mount!, path, q, {
      mode,
      hidden: filter.hidden,
      ignored: filter.ignored,
    }),
    enabled: enabled && !!mount && !!q.trim(),
    // Keep results on screen while the next query loads.
    placeholderData: keepPreviousData,
  });
}

export function useTrash(client: FmClient, mount: string | undefined, enabled = true) {
  return useQuery({
    queryKey: fmKeys.trash(client, mount ?? ""),
    queryFn: () => client.trash(mount!),
    enabled: enabled && !!mount,
  });
}

export function useUsage(client: FmClient, mount: string, path: string, enabled = true) {
  return useQuery({
    queryKey: fmKeys.usage(client, mount, path),
    queryFn: () => client.usage(mount, path),
    enabled,
  });
}

export function useFileText(client: FmClient, mount: string, path: string, enabled = true) {
  return useQuery({
    queryKey: fmKeys.text(client, mount, path),
    queryFn: () => client.readText(mount, path),
    enabled,
    staleTime: 0,
  });
}

/** Query of a mount's changes against its baseline; under the mount's list keys, so every change refreshes it. Polls while shown. */
export function changesQuery(client: FmClient, mount: string) {
  return {
    queryKey: [
      ...fmKeys.lists(client, mount),
      "changes",
    ],
    queryFn: () => client.changes(mount),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  };
}

/** Mutations that refresh every listing (and the trash) of the mount on success. */
export function useFmMutations(client: FmClient, mount: string) {
  const qc = useQueryClient();
  const invalidateMount = (m: string) => Promise.all([
    qc.invalidateQueries({
      queryKey: fmKeys.lists(client, m),
    }),
    qc.invalidateQueries({
      queryKey: fmKeys.trash(client, m),
    }),
  ]);
  const invalidate = () => invalidateMount(mount);
  return {
    mkdir: useMutation({
      mutationFn: (path: string) => client.mkdir(mount, path),
      onSuccess: invalidate,
    }),
    /** Runs on this mount, or on `v.mount` (e.g. a cross-mount source); refreshes `destMount` too. */
    ops: useMutation({
      mutationFn: (v: FmOpsRequest | { mount: string; req: FmOpsRequest; message?: string | undefined }) => "req" in v
        ? client.ops(v.mount, v.req, { message: v.message })
        : client.ops(mount, v),
      onSuccess: async (_res, v) => {
        const [m, req] = "req" in v
          ? [v.mount, v.req]
          : [mount, v];
        const dest = "destMount" in req
          ? req.destMount
          : undefined;
        await Promise.all([
          invalidateMount(m),
          dest && dest !== m && invalidateMount(dest),
        ]);
      },
    }),
    restore: useMutation({
      mutationFn: (v: { ids: string[]; message?: string | undefined }) => client.restore(mount, v.ids, { message: v.message }),
      onSuccess: invalidate,
    }),
    /** Without `ids`, empties the trash. */
    purge: useMutation({
      mutationFn: (v: { ids?: string[] | undefined; message?: string | undefined }) => client.purge(mount, v.ids, { message: v.message }),
      onSuccess: invalidate,
    }),
    save: useMutation({
      mutationFn: (v: { path: string; text: string; etag: string; message?: string | undefined }) => client.write(mount, v.path, v.text, { ifMatch: v.etag, message: v.message }),
      onSuccess: async (entry) => {
        await invalidate();
        qc.removeQueries({
          queryKey: fmKeys.text(client, mount, entry.path),
        });
      },
    }),
    invalidate,
  };
}
