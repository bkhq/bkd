import { z } from "zod";

export const ACTIONS = [
  "read",
  "write",
  "delete",
  "rename",
  "move",
  "copy",
] as const;
export type FmAction = typeof ACTIONS[number];

export const capsSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  delete: z.boolean(),
  rename: z.boolean(),
  move: z.boolean(),
  copy: z.boolean(),
});
export type FmCaps = z.infer<typeof capsSchema>;

export const ALL_CAPS: FmCaps = {
  read: true,
  write: true,
  delete: true,
  rename: true,
  move: true,
  copy: true,
};
export const READ_ONLY_CAPS: FmCaps = {
  read: true,
  write: false,
  delete: false,
  rename: false,
  move: false,
  copy: false,
};

export function intersectCaps(a: FmCaps, b: FmCaps): FmCaps {
  return {
    read: a.read && b.read,
    write: a.write && b.write,
    delete: a.delete && b.delete,
    rename: a.rename && b.rename,
    move: a.move && b.move,
    copy: a.copy && b.copy,
  };
}

export const entryKindSchema = z.enum(["file", "dir"]);
export type FmEntryKind = z.infer<typeof entryKindSchema>;

export const entrySchema = z.object({
  mount: z.string(),
  path: z.string(),
  name: z.string(),
  kind: entryKindSchema,
  size: z.number().int().nonnegative(),
  mtime: z.string(),
  mime: z.string().optional(),
  etag: z.string(),
  caps: capsSchema,
  /** Matched by an ignore rule such as .gitignore; set only by drivers that know. */
  ignored: z.boolean().optional(),
  /** Stable id from drivers that have one; it survives renames and moves. */
  id: z.string().optional(),
  /** Host data shown by the UI (owner, shared …). */
  /** Folders only: whether it holds folders; absent when the driver does not know cheaply. */
  hasSubfolders: z.boolean().optional(),
  extra: z.record(z.string(), z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ])).optional(),
});
export type FmEntry = z.infer<typeof entrySchema>;
export type FmEntryExtra = NonNullable<FmEntry["extra"]>;

export const mountInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  driver: z.string(),
  caps: capsSchema,
  /** Deletes go to a restorable trash. */
  trash: z.boolean(),
  /** `GET /thumb` serves resized images. */
  thumbnails: z.boolean(),
  /** `GET /changes` lists files that differ from a baseline (review). */
  changes: z.boolean(),
  /** Folders are implied by file paths; empty ones live only in the UI until a file lands in them. */
  implicitFolders: z.boolean(),
  /** `POST /uploads` sessions are available (else uploads are one request each). */
  uploadSessions: z.boolean(),
  /** Trash items older than this many days are deleted for good. */
  trashRetentionDays: z.number().int().positive().optional(),
  /** Host grouping of spaces (personal, team, shared with me …). */
  group: z.string().optional(),
  /** Bytes used, and the limit when there is one. */
  quota: z.object({
    used: z.number().nonnegative(),
    total: z.number().positive().optional(),
  }).optional(),
});
export type FmMountInfo = z.infer<typeof mountInfoSchema>;

export const SORT_KEYS = ["name", "mtime", "size"] as const;
export const sortKeySchema = z.enum(SORT_KEYS);
export type FmSortKey = z.infer<typeof sortKeySchema>;

export const listResultSchema = z.object({
  entry: entrySchema,
  items: z.array(entrySchema),
  cursor: z.string().optional(),
  total: z.number().int().nonnegative(),
  /** Entries in the directory marked ignored, counted before `ignored=0` drops them; present only when > 0. */
  ignored: z.number().int().nonnegative().optional(),
});
export type FmListResult = z.infer<typeof listResultSchema>;

export const searchResultSchema = z.object({
  items: z.array(entrySchema),
  /** The walk or hit limit stopped the search; more matches may exist. */
  truncated: z.boolean(),
});
export type FmSearchResult = z.infer<typeof searchResultSchema>;

export const SEARCH_MODES = ["substring", "fuzzy"] as const;
export const searchModeSchema = z.enum(SEARCH_MODES);
export type FmSearchMode = z.infer<typeof searchModeSchema>;

export const CONFLICT_MODES = ["fail", "rename", "overwrite"] as const;
export const conflictSchema = z.enum(CONFLICT_MODES);
export type FmConflict = z.infer<typeof conflictSchema>;

export const opsRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("delete"),
    paths: z.array(z.string()).min(1).max(200),
    /** Skip the trash even when the mount has one. */
    permanent: z.boolean().default(false),
  }),
  z.object({
    op: z.literal("rename"),
    path: z.string(),
    name: z.string().min(1).max(255),
  }),
  z.object({
    op: z.enum(["move", "copy"]),
    paths: z.array(z.string()).min(1).max(200),
    dest: z.string(),
    /** Mount of `dest`; defaults to the source mount. */
    destMount: z.string().optional(),
    conflict: conflictSchema.default("fail"),
  }),
]);
export type FmOpsRequest = z.input<typeof opsRequestSchema>;

export const opResultSchema = z.object({
  path: z.string(),
  ok: z.boolean(),
  entry: entrySchema.optional(),
  /** Set when a delete went to the trash. */
  trashId: z.string().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
});
export type FmOpResult = z.infer<typeof opResultSchema>;

export const opsResultSchema = z.object({
  results: z.array(opResultSchema),
});
export type FmOpsResult = z.infer<typeof opsResultSchema>;

export const trashItemSchema = z.object({
  id: z.string(),
  /** Original path. */
  path: z.string(),
  name: z.string(),
  kind: entryKindSchema,
  size: z.number().int().nonnegative(),
  deletedAt: z.string(),
  /** Set when the mount has a retention period. */
  expiresAt: z.string().optional(),
});
export type FmTrashItem = z.infer<typeof trashItemSchema>;

export const trashIdsSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
});

export const usageSchema = z.object({
  bytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  dirs: z.number().int().nonnegative(),
  /** The walk stopped at the entry limit; numbers are lower bounds. */
  truncated: z.boolean(),
});
export type FmUsage = z.infer<typeof usageSchema>;

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type FmErrorBody = z.infer<typeof errorBodySchema>;

/** `chunked`: the client PUTs parts to the router; `s3-multipart`: to presigned `urls`. */
export const uploadModeSchema = z.enum(["chunked", "s3-multipart"]);
export type FmUploadMode = z.infer<typeof uploadModeSchema>;

export const uploadCreateSchema = z.object({
  path: z.string().min(2),
  size: z.number().int().nonnegative(),
  conflict: conflictSchema.default("rename"),
});
export type FmUploadCreate = z.input<typeof uploadCreateSchema>;

export const uploadSessionSchema = z.object({
  id: z.string(),
  mode: uploadModeSchema,
  /** Target path; for conflict `rename` the free name chosen at create time. */
  path: z.string(),
  size: z.number(),
  partSize: z.number(),
  /** Part count. */
  parts: z.number(),
  /** Part numbers already stored. */
  received: z.array(z.number()),
  /** `s3-multipart` only; `urls[i]` is part `i + 1`. */
  urls: z.array(z.string()).optional(),
  /** Epoch milliseconds. */
  expiresAt: z.number(),
});
export type FmUploadSession = z.infer<typeof uploadSessionSchema>;

export const zipEntrySchema = z.object({
  /** Name inside the archive; folders end with `/`. */
  path: z.string(),
  dir: z.boolean(),
  size: z.number().int().nonnegative(),
  compressedSize: z.number().int().nonnegative(),
  mtime: z.string(),
  encrypted: z.boolean(),
});
export type FmZipEntry = z.infer<typeof zipEntrySchema>;

export const changeSchema = z.object({
  path: z.string(),
  status: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "untracked",
  ]),
  /** Path in the baseline, for renames. */
  previousPath: z.string().optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});
export type FmChangeEntry = z.infer<typeof changeSchema>;
